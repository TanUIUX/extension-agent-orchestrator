// Extension-host side of the `/mux` WebSocket leg of the transport proxy
// (PLANNING.md "Phase 1, 1.3 Transport proxy — the CORS-driven design", mux
// section). Like rest.ts/events.ts, this runs a real client from the
// extension host (the `ws` package) rather than letting the webview dial the
// daemon directly, since the daemon's CORS gate rejects a `vscode-webview://`
// origin on the WebSocket upgrade too. `Origin: http://localhost` is pinned
// exactly as `packages/mobile/lib/mux.ts` does to get past that same gate.
import WebSocket from "ws";
import { withSecondaryRole } from "./muxFrames";

export interface MuxConnectionHandle {
	send(frame: string): void;
	close(): void;
}

export interface MuxCallbacks {
	onOpen(): void;
	onMessage(data: string, binary: boolean): void;
	onClosed(code: number, reason: string): void;
	onError(message: string): void;
}

function isAllowedTarget(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.hostname === "127.0.0.1" && (parsed.protocol === "ws:" || parsed.protocol === "wss:");
	} catch {
		return false;
	}
}

export function openMuxConnection(url: string, callbacks: MuxCallbacks): MuxConnectionHandle {
	if (!isAllowedTarget(url)) {
		queueMicrotask(() => callbacks.onError(`Refusing to open a non-loopback mux URL: ${url}`));
		return { send: () => undefined, close: () => undefined };
	}

	const socket = new WebSocket(url, { headers: { Origin: "http://localhost" } });
	let closed = false;

	socket.on("open", () => {
		if (!closed) callbacks.onOpen();
	});
	socket.on("message", (data, isBinary) => {
		if (closed) return;
		const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
		callbacks.onMessage(isBinary ? buffer.toString("base64") : buffer.toString("utf8"), isBinary);
	});
	socket.on("close", (code, reason) => {
		if (closed) return;
		closed = true;
		callbacks.onClosed(code, reason.toString("utf8"));
	});
	socket.on("error", (err) => {
		if (closed) return;
		callbacks.onError(err.message);
	});

	return {
		send(frame: string) {
			if (socket.readyState !== WebSocket.OPEN) return;
			socket.send(withSecondaryRole(frame));
		},
		close() {
			if (closed) return;
			closed = true;
			try {
				socket.close();
			} catch {
				// already closing/closed — nothing to do.
			}
		},
	};
}
