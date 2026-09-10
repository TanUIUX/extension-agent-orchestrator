export type RpcMethod =
	| "projects.list" | "sessions.list" | "sessions.get" | "sessions.spawn" | "sessions.kill"
	| "conversation.get" | "conversation.send" | "agents.list" | "agents.models"
	| "workspace.files" | "workspace.tree" | "workspace.file" | "notifications.list";
type CommandName = "ao.openBoard" | "ao.newTask" | "ao.sessions.openWorker" | "ao.sessions.openTerminal" | "ao.sessions.openFiles";
type VsCodeApi = { postMessage(message: unknown): void };
const vscode = (globalThis as { acquireVsCodeApi?: () => VsCodeApi }).acquireVsCodeApi?.();
const listeners = new Map<string, (value: unknown, error?: string) => void>();
let counter = 0;

// Install one listener before any component can issue a request. New task has no
// event stream, so an effect-local listener would otherwise leave its promises pending.
window.addEventListener("message", (event: MessageEvent) => {
	const message = event.data as { kind?: string; id?: string; result?: unknown; error?: string };
	if (message.kind !== "rpc-response" || typeof message.id !== "string") return;
	const resolve = listeners.get(message.id);
	if (!resolve) return;
	listeners.delete(message.id);
	resolve(message.result, message.error);
});

export function rpc<T>(method: RpcMethod, params: Record<string, unknown> = {}): Promise<T> {
	if (!vscode) return Promise.reject(new Error("AO webview bridge is unavailable."));
	const id = `rpc-${++counter}`;
	return new Promise<T>((resolve, reject) => {
		listeners.set(id, (value, error) => error ? reject(new Error(error)) : resolve(value as T));
		vscode.postMessage({ kind: "rpc-request", id, method, params });
	});
}

export function subscribeEvents(onEvent: (event: string, data: string) => void): () => void {
	if (!vscode) return () => undefined;
	const listener = (event: MessageEvent) => {
		const message = event.data as { kind?: string; event?: string; data?: string };
		if (message.kind === "ao-event" && message.event && message.event !== "proxy_error") onEvent(message.event, message.data ?? "");
	};
	window.addEventListener("message", listener);
	vscode.postMessage({ kind: "events-subscribe", id: "events" });
	return () => { window.removeEventListener("message", listener); vscode.postMessage({ kind: "events-unsubscribe", id: "events" }); };
}

export function command(name: CommandName, params: Record<string, unknown> = {}): void { vscode?.postMessage({ kind: "command", command: name, ...params }); }
