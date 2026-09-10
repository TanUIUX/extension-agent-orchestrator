// Extension-host side of the REST leg of the transport proxy (PLANNING.md
// "Phase 1, 1.3 Transport proxy"). Runs a real `fetch` from the extension
// host — a native Node client with no `Origin` header, so it passes the
// daemon's loopback-only CORS gate the webview itself cannot get through.
import type { HostRequest, HostResponse } from "../webview/bridge/rpcEnvelope";
import { decodeBody, encodeBody } from "../webview/bridge/rpcEnvelope";

/**
 * Defense in depth: this proxy only ever forwards to the loopback daemon.
 * Restricting the allowed target here means a bug or compromise in the
 * webview bundle cannot turn this channel into an open internet-fetching
 * relay for the extension host process.
 */
function isAllowedTarget(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.hostname === "127.0.0.1" && (parsed.protocol === "http:" || parsed.protocol === "https:");
	} catch {
		return false;
	}
}

export async function handleRestRequest(request: HostRequest & { kind: "rest" }): Promise<HostResponse> {
	if (!isAllowedTarget(request.url)) {
		return { kind: "rest-result", id: request.id, status: 0, statusText: "", headers: {}, error: `Refusing to proxy a non-loopback URL: ${request.url}` };
	}
	try {
		const response = await fetch(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body !== undefined ? decodeBody(request.body) : undefined,
		});
		const headers: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			headers[key] = value;
		});
		const buffer = new Uint8Array(await response.arrayBuffer());
		return {
			kind: "rest-result",
			id: request.id,
			status: response.status,
			statusText: response.statusText,
			headers,
			body: buffer.byteLength > 0 ? encodeBody(buffer) : undefined,
		};
	} catch (err) {
		return {
			kind: "rest-result",
			id: request.id,
			status: 0,
			statusText: "",
			headers: {},
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
