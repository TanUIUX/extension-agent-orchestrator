// Pure, side-effect-free parsing helpers for daemon discovery. Ported from
// `vendor/agent-orchestrator/frontend/src/shared/daemon-discovery.ts` — kept
// dependency-free (no node:* imports) so the decision logic in attach.ts can
// be exercised without touching the filesystem, a process, or a socket.
//
// The configured AO_PORT is only a request — the daemon may bind a different
// port (port 0, operator overrides), so callers trust what the daemon reports:
//   - the slog text line `msg="daemon listening" addr=127.0.0.1:<port>`
//     (backend/internal/httpd/server.go, written to stdout/stderr), and
//   - the running.json handshake file (backend/internal/runfile).
import type { RunFileInfo } from "./types";

/**
 * Parse one daemon log line for the listen announcement. slog's TextHandler
 * emits `time=… level=INFO msg="daemon listening" addr=127.0.0.1:3001 pid=…`;
 * the addr value never contains spaces, so it is unquoted. Returns the bound
 * port, or null when the line is not the announcement.
 */
export function parseDaemonListenPort(line: string): number | null {
	if (!line.includes('msg="daemon listening"')) return null;
	const addr = /(?:^|\s)addr=("?)([^"\s]+)\1/.exec(line)?.[2];
	if (!addr) return null;
	return portFromAddr(addr);
}

// Take the segment after the last ":" so IPv6 literals like [::1]:3001 parse too.
function portFromAddr(addr: string): number | null {
	const separator = addr.lastIndexOf(":");
	if (separator === -1) return null;
	const port = Number(addr.slice(separator + 1));
	return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/**
 * Incrementally scan a stdio stream for the listen announcement. Returns a
 * chunk consumer that line-buffers (chunks can split a line anywhere) and
 * invokes onPort exactly once, for the first announcement seen.
 */
export function createListenPortScanner(onPort: (port: number) => void): (chunk: string) => void {
	let pending = "";
	let done = false;
	return (chunk) => {
		if (done) return;
		pending += chunk;
		const lines = pending.split("\n");
		pending = lines.pop() ?? "";
		for (const line of lines) {
			const port = parseDaemonListenPort(line);
			if (port !== null) {
				done = true;
				onPort(port);
				return;
			}
		}
	};
}

/**
 * Parse running.json contents into the shape callers need for the attach
 * decision tree (startedAt as epoch ms, missing/malformed fields defaulted
 * rather than throwing). Returns null for malformed JSON or an invalid port.
 */
export function parseRunFile(contents: string): (RunFileInfo & { startedAtMs: number }) | null {
	let raw: unknown;
	try {
		raw = JSON.parse(contents);
	} catch {
		return null;
	}
	if (typeof raw !== "object" || raw === null) return null;
	const { pid, port, startedAt, owner, appRunId, browserRuntimeAddress } = raw as {
		pid?: unknown;
		port?: unknown;
		startedAt?: unknown;
		owner?: unknown;
		appRunId?: unknown;
		browserRuntimeAddress?: unknown;
	};
	if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
	const startedAtStr = typeof startedAt === "string" ? startedAt : "";
	const startedAtMs = startedAtStr ? Date.parse(startedAtStr) : NaN;
	return {
		pid: typeof pid === "number" && Number.isInteger(pid) ? pid : 0,
		port,
		startedAt: startedAtStr,
		startedAtMs: Number.isNaN(startedAtMs) ? 0 : startedAtMs,
		owner: owner === "app" || owner === "persistent" ? owner : "",
		appRunId: typeof appRunId === "string" ? appRunId : undefined,
		browserRuntimeAddress: typeof browserRuntimeAddress === "string" ? browserRuntimeAddress : undefined,
	};
}
