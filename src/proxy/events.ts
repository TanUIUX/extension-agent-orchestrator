// Extension-host side of the SSE leg of the transport proxy (PLANNING.md
// "Phase 1, 1.3 Transport proxy — the CORS-driven design", SSE section).
// Node has no EventSource; this runs a real `fetch` (no Origin header) and
// parses the raw `text/event-stream` body itself (see sseParser.ts), relaying
// named events back to the webview's fake EventSource shim over the RPC
// channel. On disconnect it retries with backoff and resumes from the last
// delivered cursor via `Last-Event-ID` — the daemon's durable change-log
// replay (confirmed in vendor/agent-orchestrator/backend/internal/httpd/events.go)
// means a dropped connection is not data loss.
import { SseParser } from "./sseParser";

const BACKOFF_INIT_MS = 500;
const BACKOFF_MAX_MS = 10_000;

export interface SseSubscriptionHandle {
	dispose(): void;
}

export interface SseCallbacks {
	/** Fired once the HTTP response itself succeeds — the daemon only heartbeats via SSE comments (dropped by the parser), so callers must not wait for the first real event to know the stream is live. */
	onOpen(): void;
	onEvent(event: string, data: string, lastEventId: string | undefined): void;
	onError(message: string): void;
	onClosed(): void;
}

/**
 * Defense in depth, mirroring rest.ts: this proxy only ever subscribes to the
 * loopback daemon, never an arbitrary URL a compromised webview bundle might
 * ask it to fetch.
 */
function isAllowedTarget(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.hostname === "127.0.0.1" && (parsed.protocol === "http:" || parsed.protocol === "https:");
	} catch {
		return false;
	}
}

export function subscribeSse(url: string, initialLastEventId: string | undefined, callbacks: SseCallbacks): SseSubscriptionHandle {
	let disposed = false;
	let lastEventId = initialLastEventId;
	let abortController: AbortController | null = null;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;
	let backoff = BACKOFF_INIT_MS;

	function scheduleReconnect() {
		if (disposed) return;
		const delay = backoff;
		backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
		retryTimer = setTimeout(() => {
			retryTimer = null;
			void connect();
		}, delay);
	}

	async function connect(): Promise<void> {
		if (disposed) return;
		if (!isAllowedTarget(url)) {
			callbacks.onError(`Refusing to subscribe to a non-loopback URL: ${url}`);
			return;
		}
		abortController = new AbortController();
		const parser = new SseParser();
		try {
			const headers: Record<string, string> = { Accept: "text/event-stream" };
			if (lastEventId) headers["Last-Event-ID"] = lastEventId;
			const response = await fetch(url, { headers, signal: abortController.signal });
			if (!response.ok || !response.body) {
				callbacks.onError(`SSE endpoint returned HTTP ${response.status}`);
				if (!disposed) scheduleReconnect();
				return;
			}
			backoff = BACKOFF_INIT_MS; // connected: reset the retry ladder
			callbacks.onOpen();
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			while (!disposed) {
				const { done, value } = await reader.read();
				if (done) break;
				const events = parser.push(decoder.decode(value, { stream: true }));
				for (const event of events) {
					if (event.id) lastEventId = event.id;
					callbacks.onEvent(event.event, event.data, event.id);
				}
			}
			if (!disposed) {
				callbacks.onClosed();
				scheduleReconnect();
			}
		} catch (err) {
			if (disposed) return;
			// An abort from dispose() is expected and not a failure to report.
			if (err instanceof Error && err.name === "AbortError") return;
			callbacks.onError(err instanceof Error ? err.message : String(err));
			scheduleReconnect();
		}
	}

	void connect();

	return {
		dispose() {
			disposed = true;
			if (retryTimer) clearTimeout(retryTimer);
			abortController?.abort();
		},
	};
}
