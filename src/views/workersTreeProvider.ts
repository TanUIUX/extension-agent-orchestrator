// Worker list TreeView (Phase 2, M9's tree half — the part that makes M8's
// native terminal reachable). Flat list of sessions across all registered
// projects: GET /api/v1/sessions with no `project` filter already returns
// every project's sessions in one call (the query param is optional), so no
// N+1 per-project fetching is needed.
import * as vscode from "vscode";
import { createApiClient, type ControllersSessionView } from "../daemon/apiClient";
import type { DaemonManager } from "../daemon/lifecycle";
import { subscribeSse, type SseSubscriptionHandle } from "../proxy/events";
import { sortAttentionSessions } from "../daemon/sessionPresentation";

/** Carries the full ControllersSessionView through view/item/context commands (VS Code passes back this exact tree item on right-click), and through the item's own default `command` on left-click. */
export class SessionTreeItem extends vscode.TreeItem {
	constructor(
		label: string,
		public readonly session: ControllersSessionView,
	) {
		super(label, vscode.TreeItemCollapsibleState.None);
	}
}

export class WorkersTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
	private readonly api: ReturnType<typeof createApiClient>;
	private readonly statusListener: vscode.Disposable;
	private sse: SseSubscriptionHandle | undefined;
	private ssePort: number | undefined;

	constructor(private readonly daemon: DaemonManager) {
		this.api = createApiClient(daemon);
		this.statusListener = daemon.onDidChangeStatus((status) => {
			this.refresh();
			if (status.state === "ready") this.ensureSseSubscription(status.port);
			else this.teardownSse();
		});
		if (daemon.status.state === "ready") this.ensureSseSubscription(daemon.status.port);
	}

	refresh(): void {
		this.onDidChangeTreeDataEmitter.fire();
	}

	dispose(): void {
		this.teardownSse();
		this.statusListener.dispose();
	}

	/**
	 * Live updates: subscribe to /api/v1/events and refetch the whole session
	 * list on session_created/session_updated rather than parsing the event
	 * payload — this list is small and refreshed at human-perceptible cadence,
	 * not a hot path, so simplicity wins over incremental updates. Re-subscribes
	 * whenever the daemon transitions to a new ready port (a restart can move
	 * it), and tears down when the daemon stops being ready.
	 */
	private ensureSseSubscription(port: number): void {
		if (this.sse && this.ssePort === port) return;
		this.teardownSse();
		this.ssePort = port;
		this.sse = subscribeSse(`http://127.0.0.1:${port}/api/v1/events`, undefined, {
			onOpen: () => undefined,
			onEvent: (event) => {
				if (event === "session_created" || event === "session_updated") this.refresh();
			},
			onError: () => undefined,
			onClosed: () => undefined,
		});
	}

	private teardownSse(): void {
		this.sse?.dispose();
		this.sse = undefined;
		this.ssePort = undefined;
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

		let sessions: ControllersSessionView[];
		try {
			sessions = await this.api.listSessions();
		} catch (err) {
			const item = new vscode.TreeItem("Failed to load workers", vscode.TreeItemCollapsibleState.None);
			item.description = err instanceof Error ? err.message : String(err);
			item.iconPath = new vscode.ThemeIcon("error");
			return [item];
		}

		if (sessions.length === 0) {
			return [new vscode.TreeItem("No workers yet", vscode.TreeItemCollapsibleState.None)];
		}

		// Match the board's attention path so the native sidebar and webview never
		// disagree about which worker deserves the next glance.
		const sorted = sortAttentionSessions(sessions);
		return sorted.map((session) => this.toTreeItem(session));
	}

	private toTreeItem(session: ControllersSessionView): vscode.TreeItem {
		const item = new SessionTreeItem(session.displayName || session.id, session);
		item.id = session.id;
		item.description = `${session.harness ?? "?"} · ${session.displayStatus}`;
		item.contextValue = session.isTerminated ? "ao.session.terminated" : "ao.session.active";
		item.iconPath = new vscode.ThemeIcon(session.isTerminated ? "circle-slash" : "circle-filled");
		if (!session.isTerminated && session.terminalHandleId) {
			item.command = { command: "ao.sessions.openTerminal", title: "Open Terminal", arguments: [session] };
		}
		return item;
	}
}
