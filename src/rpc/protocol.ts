import type { DaemonStatus } from "../daemon/types";

export type RpcMethod =
	| "projects.list"
	| "sessions.list"
	| "sessions.get"
	| "sessions.spawn"
	| "sessions.kill"
	| "conversation.get"
	| "conversation.send"
	| "agents.list"
	| "agents.models"
	| "workspace.files"
	| "workspace.tree"
	| "workspace.file"
	| "notifications.list";

export type RpcRequest = {
	kind: "rpc-request";
	id: string;
	method: RpcMethod;
	params: Record<string, unknown>;
};

export type RpcResponse = {
	kind: "rpc-response";
	id: string;
	result?: unknown;
	error?: string;
};

export type EventRequest = {
	kind: "events-subscribe" | "events-unsubscribe";
	id: string;
};

export type EventMessage = {
	kind: "ao-event";
	event: string;
	data: string;
	lastEventId?: string;
};

export type WebviewMessage = RpcRequest | EventRequest;
export function isRpcRequest(message: WebviewMessage): message is RpcRequest { return message.kind === "rpc-request"; }
export type CommandRequest = { kind: "command"; command: string; sessionId?: string };
export type HostMessage = RpcResponse | EventMessage | { kind: "daemon-status"; status: DaemonStatus };
