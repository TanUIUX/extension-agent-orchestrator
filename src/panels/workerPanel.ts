import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import type { DaemonManager } from "../daemon/lifecycle";
import { attachHostRouter } from "../rpc/hostRouter";
import type { HostMessage } from "../rpc/protocol";

const panels = new Map<string, vscode.WebviewPanel>();
export function openWorkerPanel(context: vscode.ExtensionContext, daemon: DaemonManager, sessionId: string): void {
	const existing = panels.get(sessionId);
	if (existing) { existing.reveal(vscode.ViewColumn.One); return; }
	const panel = vscode.window.createWebviewPanel("ao.worker", "AO Worker", vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "webview")] });
	panels.set(sessionId, panel);
	const router = attachHostRouter(panel.webview, daemon);
	const status = daemon.onDidChangeStatus((value) => void panel.webview.postMessage({ kind: "daemon-status", status: value } satisfies HostMessage));
	const commands = panel.webview.onDidReceiveMessage((message: unknown) => {
		if (!message || typeof message !== "object") return;
		const request = message as { kind?: string; command?: string; sessionId?: string };
		if (request.kind !== "command") return;
		if (request.command === "ao.openBoard") void vscode.commands.executeCommand("ao.openBoard");
		if (request.command === "ao.sessions.openTerminal" && request.sessionId) void vscode.commands.executeCommand("ao.sessions.openTerminal", request.sessionId);
		if (request.command === "ao.sessions.openFiles" && request.sessionId) void vscode.commands.executeCommand("ao.sessions.openFiles", request.sessionId);
	});
	panel.onDidDispose(() => { panels.delete(sessionId); router.dispose(); status.dispose(); commands.dispose(); });
	void render(panel, context, sessionId);
}
async function render(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, sessionId: string): Promise<void> {
	try {
		const html = await readFile(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "index.html").fsPath, "utf8");
		const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "worker.js"));
		const style = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "worker.css"));
		panel.webview.html = html
			.replace("__ENTRY_JS__", script.toString())
			.replace("__ENTRY_CSS__", style.toString())
			.replace("__SESSION_ID__", escapeHtmlAttribute(sessionId))
			.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${csp(panel.webview)}">`);
	} catch { panel.webview.html = "<html><body><h2>AO Worker</h2><p>Run npm run build:webview.</p></body></html>"; }
}
function escapeHtmlAttribute(value: string): string { return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function csp(webview: vscode.Webview): string { return `default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; connect-src ${webview.cspSource}`; }
