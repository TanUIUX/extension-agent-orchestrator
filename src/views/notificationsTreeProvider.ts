import * as vscode from "vscode";
import type { DaemonManager } from "../daemon/lifecycle";
import { createApiClient } from "../daemon/apiClient";

export class NotificationsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
	private readonly api; private readonly emitter = new vscode.EventEmitter<void>(); readonly onDidChangeTreeData = this.emitter.event;
	constructor(daemon: DaemonManager) { this.api = createApiClient(daemon); }
	refresh(): void { this.emitter.fire(); }
	dispose(): void { this.emitter.dispose(); }
	getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
	async getChildren(): Promise<vscode.TreeItem[]> { try { const data = await this.api.listNotifications(); return data.notifications.map((n) => { const item = new vscode.TreeItem(n.title || "AO notification"); item.description = n.createdAt ? new Date(n.createdAt).toLocaleString() : undefined; item.contextValue = n.status === "read" ? "ao.notification.read" : "ao.notification.unread"; item.id = n.id; return item; }); } catch (error) { const item = new vscode.TreeItem("Failed to load notifications"); item.description = error instanceof Error ? error.message : String(error); item.iconPath = new vscode.ThemeIcon("error"); return [item]; } }
}
