// Wire format for the one postMessage channel between the webview and the
// extension host. See PLANNING.md "Phase 1, 1.3 Transport proxy — the
// CORS-driven design": the daemon's CORS policy hard-rejects any request
// carrying a `vscode-webview://` Origin header, so the webview never talks to
// the daemon directly — every REST/SSE/WS call is relayed through here to the
// extension host, which talks to the daemon as a native Node client (no
// Origin header, the same posture src/daemon/runFile.ts already has).
//
// This file is imported by BOTH the extension host (src/proxy/*) and the
// webview-side bridge bundle (src/webview/bridge/installBridge.ts) — it must
// stay free of node:*/vscode imports so esbuild can target it at "browser"
// for the bridge bundle.
//
// Every request carries a correlation `id`. REST is one request/one response;
// SSE and WS are long-lived logical channels identified by the same `id`
// until explicitly unsubscribed/closed.

import type { DaemonStatus } from "../../daemon/types";

/** The handful of Node/vscode-API capabilities the bridge stub (installBridge.ts) implements for real rather than as a no-op — see PLANNING.md "Phase 1, 1.2, Minimum bridge surface for v1 scope". */
export type BridgeCallMethod = "app.getVersion" | "app.openExternal" | "clipboard.writeText" | "clipboard.readText";

export type HostRequest =
	| { kind: "rest"; id: string; method: string; url: string; headers: Record<string, string>; body?: string }
	| { kind: "sse-subscribe"; id: string; url: string; lastEventId?: string }
	| { kind: "sse-unsubscribe"; id: string }
	| { kind: "ws-open"; id: string; url: string }
	| { kind: "ws-send"; id: string; data: string }
	| { kind: "ws-close"; id: string }
	| { kind: "bridge-call"; id: string; method: BridgeCallMethod; args: unknown[] }
	/** Sent once installBridge.ts has set `window.ao` — the host replies with the current daemon status so the shell does not sit on its initial "starting" placeholder until the next status change. */
	| { kind: "ao-bridge-ready" };

export type HostResponse =
	| {
			kind: "rest-result";
			id: string;
			status: number;
			statusText: string;
			headers: Record<string, string>;
			/** base64-encoded response body, or absent for an empty body. */
			body?: string;
			/** Set when the request never reached the daemon (network/abort error) — no status/headers are meaningful. */
			error?: string;
	  }
	| { kind: "sse-open"; id: string }
	| { kind: "sse-event"; id: string; event: string; data: string; lastEventId?: string }
	| { kind: "sse-error"; id: string; message: string }
	| { kind: "sse-closed"; id: string }
	| { kind: "ws-open-result"; id: string; ok: boolean; error?: string }
	/** `data` is the raw frame text — the daemon's `/mux` protocol is JSON-text-only (PTY bytes travel base64-encoded inside that JSON, per terminal-mux.ts), so no further transport-level encoding is needed. `binary` is set only in the unexpected case of a binary WS frame, in which case `data` is base64. */
	| { kind: "ws-message"; id: string; data: string; binary?: boolean }
	| { kind: "ws-closed"; id: string; code?: number; reason?: string }
	| { kind: "ws-error"; id: string; message: string }
	| { kind: "bridge-result"; id: string; result?: unknown; error?: string }
	| { kind: "ao-daemon-status"; status: DaemonStatus };

// Reach the Node `Buffer` global via `globalThis` rather than the bare
// `Buffer` identifier: this file compiles under two different tsconfigs (the
// extension host's Node lib, and the webview bridge bundle's DOM-only lib —
// see tsconfig.webview-bridge.json), and only the former has `@types/node`'s
// ambient `Buffer` type declared.
type NodeBufferInstance = Uint8Array & { toString(encoding: string): string };
interface NodeBufferLike {
	from(input: Uint8Array | string, encoding?: string): NodeBufferInstance;
}
function nodeBuffer(): NodeBufferLike | undefined {
	return (globalThis as { Buffer?: NodeBufferLike }).Buffer;
}

/** REST bodies cross the boundary as base64 — binary-safe for the workspace file/blob endpoint, negligible overhead for JSON. */
export function encodeBody(bytes: Uint8Array): string {
	const buffer = nodeBuffer();
	if (buffer) return buffer.from(bytes).toString("base64");
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

export function decodeBody(base64: string): Uint8Array {
	const buffer = nodeBuffer();
	if (buffer) return new Uint8Array(buffer.from(base64, "base64"));
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
