// Reads `~/.ao/running.json` and probes the daemon's HTTP health endpoints,
// the same way `vendor/agent-orchestrator/backend/internal/cli/client.go`
// (`resolveDaemonFromRunFile`) and `frontend/src/shared/daemon-discovery.ts`
// do. Never hardcode port 3001 — the daemon falls back to an OS-assigned
// ephemeral port if 3001 is taken (see `backend/internal/httpd/server.go`).
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseDaemonProbe, type DaemonProber } from "./attach";
import { parseRunFile } from "./discovery";
import type { RunFileInfo } from "./types";

export function defaultRunFilePath(): string {
	// AO_RUN_FILE lets a dev daemon (or a test harness) point this extension at
	// an isolated running.json instead of the shared production ~/.ao tree.
	return process.env.AO_RUN_FILE ?? join(homedir(), ".ao", "running.json");
}

/** Raw file contents, or null when the file is absent/unreadable. Feeds attach.ts's dependency-injected decision tree. */
export async function readRunFileRaw(path = defaultRunFilePath()): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

export async function readRunFile(path = defaultRunFilePath()): Promise<RunFileInfo | null> {
	const raw = await readRunFileRaw(path);
	if (raw === null) return null;
	return parseRunFile(raw);
}

const PROBE_TIMEOUT_MS = 2000;

/** Probes `/healthz` or `/readyz` and validates the response against the daemon contract. */
export const probeDaemon: DaemonProber = async (port, endpoint) => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
	try {
		const response = await fetch(`http://127.0.0.1:${port}/${endpoint}`, { signal: controller.signal });
		if (!response.ok) return null;
		return parseDaemonProbe(endpoint, await response.json());
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
};
