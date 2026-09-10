// Native terminal (Phase 2, M8): a vscode.Pseudoterminal backed directly by
// src/proxy/mux.ts's WebSocket client, with no webview hop at all — the split
// mirrors the vendored useTerminalSession.ts's AttachableTerminal structural
// trick (vendor/agent-orchestrator/frontend/src/renderer/hooks/useTerminalSession.ts)
// specifically so the transport half is unit-testable without a real terminal UI.
//
// Wire protocol (vendor/.../frontend/src/renderer/lib/terminal-mux.ts,
// backend/internal/terminal/protocol.go):
//   client → open{id,cols,rows} | data{id,data} | resize{id,cols,rows,force?} | close{id}
//   server → opened{id} | data{id,data} | exited{id} | error{id?,error}
// PTY bytes are base64 inside `data` because raw JSON strings cannot carry
// arbitrary bytes. openMuxConnection (src/proxy/mux.ts) already stamps every
// outgoing "open" frame with role:"secondary" (PLANNING.md risk register #4) —
// nothing here needs to repeat that.
import * as vscode from "vscode";
import type { DaemonManager } from "../daemon/lifecycle";
import { openMuxConnection } from "../proxy/mux";

interface ServerFrame {
	ch: string;
	id?: string;
	type: string;
	data?: string;
	error?: string;
}

function openFrame(id: string, cols: number, rows: number): string {
	return JSON.stringify({ ch: "terminal", type: "open", id, cols, rows });
}

function dataFrame(id: string, text: string): string {
	return JSON.stringify({ ch: "terminal", type: "data", id, data: Buffer.from(text, "utf8").toString("base64") });
}

function resizeFrame(id: string, cols: number, rows: number, force = false): string {
	return JSON.stringify({ ch: "terminal", type: "resize", id, cols, rows, ...(force ? { force: true } : {}) });
}

function closeFrame(id: string): string {
	return JSON.stringify({ ch: "terminal", type: "close", id });
}

export interface MuxTerminalSink {
	/** Decoded PTY output, ready to feed a terminal UI. */
	onData(text: string): void;
	/** Server "exited". */
	onExit(): void;
	/** Server "error", or a socket-level close/error before "exited". */
	onError(message: string): void;
	/** Server "opened" ack — optional, mainly useful for tests. */
	onOpened?(): void;
}

export interface MuxTerminalHandle {
	/** No-ops until the server has acked "opened". */
	sendInput(data: string): void;
	resize(cols: number, rows: number): void;
	close(): void;
}

/**
 * Pure, UI-agnostic mux attachment: opens the socket, sends the initial
 * `open` frame, and translates inbound frames into `sink` calls. No
 * reconnect logic in v1 (unlike the vendored hook's scheduleReattach) — a
 * dropped native terminal just reports itself closed via `sink.onError`;
 * this is a known, accepted v1 gap, documented the same way PLANNING.md
 * documents its others.
 */
export function attachMuxTerminal(
	url: string,
	handleId: string,
	sink: MuxTerminalSink,
	initialSize: { cols: number; rows: number } = { cols: 80, rows: 24 },
): MuxTerminalHandle {
	let ready = false;
	let settled = false; // true once exited/error has been reported — suppresses a redundant close/error report

	const connection = openMuxConnection(url, {
		onOpen: () => {
			connection.send(openFrame(handleId, initialSize.cols, initialSize.rows));
		},
		onMessage: (data) => {
			let frame: ServerFrame;
			try {
				frame = JSON.parse(data) as ServerFrame;
			} catch {
				return; // the protocol never sends non-JSON text frames; ignore rather than throw.
			}
			if (frame.ch !== "terminal") return;
			switch (frame.type) {
				case "opened":
					ready = true;
					sink.onOpened?.();
					break;
				case "data":
					if (frame.data !== undefined) {
						// Known v1 limitation: a multi-byte UTF-8 character split exactly
						// across two frames decodes incorrectly here — no cross-frame
						// reassembly buffering. Accepted for v1; see PLANNING.md M8 entry.
						sink.onData(Buffer.from(frame.data, "base64").toString("utf8"));
					}
					break;
				case "exited":
					settled = true;
					sink.onExit();
					break;
				case "error":
					settled = true;
					sink.onError(frame.error ?? "unknown terminal error");
					break;
			}
		},
		onClosed: () => {
			if (!settled) {
				settled = true;
				sink.onError("connection lost");
			}
		},
		onError: (message) => {
			if (!settled) {
				settled = true;
				sink.onError(message);
			}
		},
	});

	return {
		sendInput(data: string) {
			if (!ready) return;
			connection.send(dataFrame(handleId, data));
		},
		resize(cols: number, rows: number) {
			connection.send(resizeFrame(handleId, cols, rows));
		},
		close() {
			connection.send(closeFrame(handleId));
			connection.close();
		},
	};
}

/** Dim-ANSI styling matching the vendored useTerminalSession.ts's own exit/error lines. */
const EXIT_MESSAGE = "\r\n\x1b[2m[process exited]\x1b[0m\r\n";
function errorMessage(message: string): string {
	return `\r\n\x1b[2m[terminal error] ${message}\x1b[0m\r\n`;
}

/** Thin vscode.Pseudoterminal adapter over attachMuxTerminal. */
export function createMuxPseudoterminal(daemon: DaemonManager, handleId: string): vscode.Pseudoterminal {
	const writeEmitter = new vscode.EventEmitter<string>();
	const closeEmitter = new vscode.EventEmitter<number | void>();
	let handle: MuxTerminalHandle | undefined;

	return {
		onDidWrite: writeEmitter.event,
		onDidClose: closeEmitter.event,
		open(initialDimensions) {
			const status = daemon.status;
			if (status.state !== "ready") {
				writeEmitter.fire(errorMessage("AO daemon is not ready."));
				closeEmitter.fire(1);
				return;
			}
			const url = `ws://127.0.0.1:${status.port}/mux`;
			const initialSize = initialDimensions
				? { cols: initialDimensions.columns, rows: initialDimensions.rows }
				: { cols: 80, rows: 24 };
			handle = attachMuxTerminal(
				url,
				handleId,
				{
					onData: (text) => writeEmitter.fire(text),
					onExit: () => {
						writeEmitter.fire(EXIT_MESSAGE);
						closeEmitter.fire();
					},
					onError: (message) => {
						writeEmitter.fire(errorMessage(message));
						closeEmitter.fire(1);
					},
				},
				initialSize,
			);
		},
		close() {
			handle?.close();
			handle = undefined;
		},
		handleInput(data) {
			handle?.sendInput(data);
		},
		setDimensions(dimensions) {
			handle?.resize(dimensions.columns, dimensions.rows);
		},
	};
}
