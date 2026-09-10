import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import type { DaemonManager } from "../daemon/lifecycle";
import { attachHostRouter } from "../rpc/hostRouter";

let panel: vscode.WebviewPanel | undefined;
export function openNewTaskPanel(context: vscode.ExtensionContext, daemon: DaemonManager): void {
	if (panel) { panel.reveal(vscode.ViewColumn.One); return; }
	panel = vscode.window.createWebviewPanel("ao.newTask", "AO New Task", vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "webview")] });
	const current = panel;
	const router = attachHostRouter(current.webview, daemon);
	const commands = current.webview.onDidReceiveMessage((message: unknown) => {
		if (!message || typeof message !== "object") return;
		const request = message as { kind?: string; command?: string; sessionId?: string };
		if (request.kind === "command" && request.command === "ao.openBoard") void vscode.commands.executeCommand("ao.openBoard");
		if (request.kind === "command" && request.command === "ao.sessions.openWorker" && request.sessionId) void vscode.commands.executeCommand("ao.sessions.openWorker", request.sessionId);
	});
	current.onDidDispose(() => { panel = undefined; router.dispose(); commands.dispose(); });
	void render(current, context);
}
async function render(panel: vscode.WebviewPanel, context: vscode.ExtensionContext): Promise<void> {
	try {
		const html = await readFile(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "index.html").fsPath, "utf8");
		const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "newTask.js"));
		const style = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "newTask.css"));
		panel.webview.html = html.replace("__ENTRY_JS__", script.toString()).replace("__ENTRY_CSS__", style.toString()).replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${csp(panel.webview)}">`); // URIs are injected after the build placeholder is loaded.
	} catch { panel.webview.html = "<html><body><h2>AO New Task</h2><p>Run npm run build:webview.</p></body></html>"; }
}
function csp(webview: vscode.Webview): string { return `default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; connect-src ${webview.cspSource}`; }
