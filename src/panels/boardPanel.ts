import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import type { DaemonManager } from "../daemon/lifecycle";
import { attachHostRouter } from "../rpc/hostRouter";
import type { HostMessage } from "../rpc/protocol";

let panel: vscode.WebviewPanel | undefined;

export function openBoardPanel(context: vscode.ExtensionContext, daemon: DaemonManager): void {
	if (panel) { panel.reveal(vscode.ViewColumn.One); return; }
	const created = vscode.window.createWebviewPanel("ao.board", "AO Board", vscode.ViewColumn.One, {
		enableScripts: true,
		retainContextWhenHidden: true,
		localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "webview")],
	});
	panel = created;
	const router = attachHostRouter(created.webview, daemon);
	const status = daemon.onDidChangeStatus((value) => void created.webview.postMessage({ kind: "daemon-status", status: value } satisfies HostMessage));
	const commands = created.webview.onDidReceiveMessage((message: unknown) => {
		if (!message || typeof message !== "object") return;
		const request = message as { kind?: string; command?: string; sessionId?: string };
		if (request.kind !== "command") return;
		if (request.command === "ao.newTask") void vscode.commands.executeCommand("ao.newTask");
		if (request.command === "ao.sessions.openWorker" && request.sessionId) void vscode.commands.executeCommand("ao.sessions.openWorker", request.sessionId);
	});
	created.onDidDispose(() => { panel = undefined; router.dispose(); status.dispose(); commands.dispose(); });
	void render(created, context);
}

async function render(target: vscode.WebviewPanel, context: vscode.ExtensionContext): Promise<void> {
	try {
		const html = await readFile(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "index.html").fsPath, "utf8");
		const script = target.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "board.js"));
		const style = target.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "board.css"));
		target.webview.html = html
			.replace("__ENTRY_JS__", script.toString())
			.replace("__ENTRY_CSS__", style.toString())
			.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${csp(target.webview)}">`);
	} catch {
		target.webview.html = `<html><body><h2>AO Board</h2><p>Webview build missing. Run <code>npm run build:webview</code>.</p></body></html>`;
	}
}
function csp(webview: vscode.Webview): string { return `default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; connect-src ${webview.cspSource}`; }
