import * as vscode from "vscode";
import { createApiClient } from "../daemon/apiClient";
import type { DaemonManager } from "../daemon/lifecycle";
import { subscribeSse, type SseSubscriptionHandle } from "../proxy/events";
import { isRpcRequest, type EventMessage, type RpcMethod, type RpcResponse, type WebviewMessage } from "./protocol";

export function attachHostRouter(webview: vscode.Webview, daemon: DaemonManager): vscode.Disposable {
	const api = createApiClient(daemon);
	let events: SseSubscriptionHandle | undefined;
	let eventsRequested = false;
	let eventPort: number | undefined;
	const post = (message: RpcResponse | EventMessage): void => void webview.postMessage(message);
	const connectEvents = (port: number): void => {
		if (!eventsRequested || eventPort === port) return;
		events?.dispose();
		eventPort = port;
		events = subscribeSse(`http://127.0.0.1:${port}/api/v1/events`, undefined, {
			onOpen: () => undefined,
			onEvent: (event, data, lastEventId) => post({ kind: "ao-event", event, data, lastEventId }),
			onError: (error) => post({ kind: "ao-event", event: "proxy_error", data: JSON.stringify({ error }) }),
			onClosed: () => post({ kind: "ao-event", event: "proxy_closed", data: "" }),
		});
	};
	const statusListener = daemon.onDidChangeStatus((status) => {
		if (status.state === "ready") connectEvents(status.port);
		else { events?.dispose(); events = undefined; eventPort = undefined; }
	});
	const listener = webview.onDidReceiveMessage((message: WebviewMessage) => {
		if (message.kind === "events-subscribe") {
			eventsRequested = true;
			if (daemon.status.state === "ready") connectEvents(daemon.status.port);
			return;
		}
		if (message.kind === "events-unsubscribe") {
			eventsRequested = false;
			events?.dispose();
			events = undefined;
			eventPort = undefined;
			return;
		}
		if (!isRpcRequest(message)) return;
		void dispatch(api, message.method, message.params).then(
			(result) => post({ kind: "rpc-response", id: message.id, result }),
			(error: unknown) => post({ kind: "rpc-response", id: message.id, error: error instanceof Error ? error.message : String(error) }),
		);
	});
	return new vscode.Disposable(() => {
		listener.dispose();
		statusListener.dispose();
		events?.dispose();
	});
}

async function dispatch(api: ReturnType<typeof createApiClient>, method: RpcMethod, params: Record<string, unknown>): Promise<unknown> {
	switch (method) {
		case "projects.list": return api.listProjects();
		case "sessions.list": return api.listSessions(typeof params.projectId === "string" ? params.projectId : undefined);
		case "sessions.get": return api.getSession(stringParam(params, "sessionId"));
		case "sessions.spawn": return api.spawnSession({ projectId: stringParam(params, "projectId"), harness: optionalString(params, "harness") as never, prompt: optionalString(params, "prompt"), displayName: optionalString(params, "displayName") });
		case "sessions.kill": return api.killSession(stringParam(params, "sessionId"));
		case "conversation.get": return api.getConversation(stringParam(params, "sessionId"));
		case "conversation.send": return api.sendConversationMessage(stringParam(params, "sessionId"), stringParam(params, "text"));
		case "agents.list": return api.listAgents();
		case "agents.models": return api.listAgentModels(stringParam(params, "agent"));
		case "workspace.files": return api.listWorkspaceFiles(stringParam(params, "sessionId"));
		case "workspace.tree": return api.listWorkspaceTree(stringParam(params, "sessionId"), optionalString(params, "path"));
		case "workspace.file": return api.getWorkspaceFile(stringParam(params, "sessionId"), stringParam(params, "path"), optionalString(params, "section"));
		case "notifications.list": return api.listNotifications();
	}
}

function stringParam(params: Record<string, unknown>, key: string): string {
	const value = params[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing ${key}.`);
	return value;
}
function optionalString(params: Record<string, unknown>, key: string): string | undefined {
	return typeof params[key] === "string" ? params[key] as string : undefined;
}
