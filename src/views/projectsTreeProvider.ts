// Real projects tree backed by GET /api/v1/projects (src/daemon/apiClient.ts).
// There is no project-level SSE event in the daemon's change log (only
// session_created/session_updated/pr/review events — see
// vendor/agent-orchestrator/backend/internal/cdc/event.go), so this refreshes
// only on a daemon-ready transition or an explicit user action (ao.projects.refresh,
// or after add/remove).
import * as vscode from "vscode";
import { createApiClient, type ProjectSummary } from "../daemon/apiClient";
import type { DaemonManager } from "../daemon/lifecycle";

/** Carries the full ProjectSummary through view/item/context commands (VS Code passes back this exact tree item on right-click). */
export class ProjectTreeItem extends vscode.TreeItem {
	constructor(
		label: string,
		public readonly project: ProjectSummary,
	) {
		super(label, vscode.TreeItemCollapsibleState.None);
	}
}

export class ProjectsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
	private readonly api: ReturnType<typeof createApiClient>;

	constructor(private readonly daemon: DaemonManager) {
		this.api = createApiClient(daemon);
		daemon.onDidChangeStatus(() => this.refresh());
	}

	refresh(): void {
		this.onDidChangeTreeDataEmitter.fire();
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(): Promise<vscode.TreeItem[]> {
		const status = this.daemon.status;
		if (status.state !== "ready") {
			const item = new vscode.TreeItem(
				status.state === "starting" ? "Connecting to AO daemon…" : "AO daemon not running",
				vscode.TreeItemCollapsibleState.None,
			);
			item.description = status.state === "stopped" || status.state === "error" ? status.message : undefined;
			item.iconPath = new vscode.ThemeIcon(status.state === "starting" ? "loading~spin" : "warning");
			return [item];
		}

		let projects: ProjectSummary[];
		try {
			projects = await this.api.listProjects();
		} catch (err) {
			const item = new vscode.TreeItem("Failed to load projects", vscode.TreeItemCollapsibleState.None);
			item.description = err instanceof Error ? err.message : String(err);
			item.iconPath = new vscode.ThemeIcon("error");
			return [item];
		}

		if (projects.length === 0) {
			const placeholder = new vscode.TreeItem("No projects registered yet", vscode.TreeItemCollapsibleState.None);
			placeholder.command = { command: "ao.projects.add", title: "Register Project" };
			return [placeholder];
		}

		return projects.map((project) => this.toTreeItem(project));
	}

	private toTreeItem(project: ProjectSummary): vscode.TreeItem {
		const item = new ProjectTreeItem(project.name, project);
		item.contextValue = "ao.project";
		item.description = project.folderMissing ? `${project.path} (folder missing)` : project.path;
		item.iconPath = new vscode.ThemeIcon("repo");
		item.id = project.id;
		return item;
	}
}
