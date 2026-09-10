import * as vscode from "vscode";
import {
	createApiClient,
	ProjectInitializationRequiredError,
	SPAWN_HARNESSES,
	type ControllersSessionView,
	type ProjectSummary,
	type SpawnHarness,
} from "./daemon/apiClient";
import { DaemonManager } from "./daemon/lifecycle";
import { createMuxPseudoterminal } from "./terminal/muxPseudoterminal";
import { ProjectsTreeProvider, ProjectTreeItem } from "./views/projectsTreeProvider";
import { SessionTreeItem, WorkersTreeProvider } from "./views/workersTreeProvider";
import { NotificationsTreeProvider } from "./views/notificationsTreeProvider";
import { openBoardPanel } from "./panels/boardPanel"; // Thin webview; VS Code owns the surrounding chrome.
import { openWorkerPanel } from "./panels/workerPanel";
import { openNewTaskPanel } from "./panels/newTaskPanel";
import { AoDiffContentProvider } from "./fs/aoDiffContentProvider";
import { AoFileSystemProvider } from "./fs/aoFileSystemProvider";

/** Both the project's own tree item (right-click) and a plain ProjectSummary (not currently used, kept for symmetry with extractSession) resolve here. */
function extractProject(arg: unknown): ProjectSummary | undefined {
	if (arg instanceof ProjectTreeItem) return arg.project;
	return undefined;
}

/** Resolves either the session's own tree item (right-click) or the raw ControllersSessionView passed as the tree item's default `command` argument (left-click). */
function extractSession(arg: unknown): ControllersSessionView | undefined {
	if (arg instanceof SessionTreeItem) return arg.session;
	if (arg && typeof arg === "object" && "id" in arg && "isTerminated" in arg) {
		return arg as ControllersSessionView;
	}
	return undefined;
}

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function sessionIdFromArg(arg: unknown): string | undefined {
	if (typeof arg === "string" && arg.length > 0) return arg;
	if (arg && typeof arg === "object" && "sessionId" in arg && typeof arg.sessionId === "string" && arg.sessionId.length > 0) return arg.sessionId;
	return extractSession(arg)?.id;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const daemon = new DaemonManager(context.extensionPath);
	context.subscriptions.push(new vscode.Disposable(() => daemon.dispose()));

	const apiClient = createApiClient(daemon);

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.command = "ao.daemon.showLogs";
	context.subscriptions.push(statusBarItem);
	context.subscriptions.push(
		daemon.onDidChangeStatus((status) => {
			switch (status.state) {
				case "ready":
					statusBarItem.text = "$(check) AO";
					statusBarItem.tooltip = `AO daemon ready on port ${status.port}`;
					break;
				case "starting":
					statusBarItem.text = "$(sync~spin) AO";
					statusBarItem.tooltip = status.message ?? "Connecting to AO daemon…";
					break;
				default:
					statusBarItem.text = "$(warning) AO";
					statusBarItem.tooltip = status.message ?? "AO daemon not running";
			}
		}),
	);
	statusBarItem.show();

	const projectsTreeProvider = new ProjectsTreeProvider(daemon);
	context.subscriptions.push(vscode.window.registerTreeDataProvider("ao.projects", projectsTreeProvider));

	const workersTreeProvider = new WorkersTreeProvider(daemon);
	context.subscriptions.push(workersTreeProvider);
	context.subscriptions.push(vscode.window.registerTreeDataProvider("ao.workers", workersTreeProvider));
	const notificationsTreeProvider = new NotificationsTreeProvider(daemon);
	context.subscriptions.push(notificationsTreeProvider);
	context.subscriptions.push(vscode.window.registerTreeDataProvider("ao.notifications", notificationsTreeProvider));
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider("ao", new AoFileSystemProvider(daemon), { isCaseSensitive: true, isReadonly: true }));
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("ao-diff", new AoDiffContentProvider(daemon)));

	context.subscriptions.push(
		vscode.commands.registerCommand("ao.openBoard", () => openBoardPanel(context, daemon)),
		vscode.commands.registerCommand("ao.newTask", () => openNewTaskPanel(context, daemon)),
		vscode.commands.registerCommand("ao.sessions.openWorker", async (arg: unknown) => {
			const sessionId = sessionIdFromArg(arg);
			if (sessionId) openWorkerPanel(context, daemon, sessionId);
		}),
		vscode.commands.registerCommand("ao.sessions.openFiles", async (arg: unknown) => {
			const session = extractSession(arg);
			const sessionId = sessionIdFromArg(arg);
			if (!sessionId) return;
			try {
				const files = await apiClient.listWorkspaceFiles(sessionId);
				const changed = files.files.find((file) => file.status !== "unmodified");
				if (!changed) { vscode.window.showInformationMessage("AO: no changed files in this worker."); return; }
				const before = vscode.Uri.parse(`ao-diff:/${sessionId}/before/${changed.path}`);
				const after = vscode.Uri.parse(`ao-diff:/${sessionId}/after/${changed.path}`);
				await vscode.commands.executeCommand("vscode.diff", before, after, `${changed.path} · ${session?.displayName || sessionId}`);
			} catch (err) { vscode.window.showErrorMessage(`AO: failed to open changes — ${errorText(err)}`); }
		}),
		vscode.commands.registerCommand("ao.daemon.restart", async () => {
			await daemon.restart();
		}),
		vscode.commands.registerCommand("ao.daemon.showLogs", async () => {
			const status = daemon.status;
			vscode.window.showInformationMessage(`AO daemon status: ${JSON.stringify(status)}`);
		}),

		vscode.commands.registerCommand("ao.projects.add", async () => {
			const uris = await vscode.window.showOpenDialog({
				canSelectFolders: true,
				canSelectFiles: false,
				canSelectMany: false,
				title: "Register AO Project",
			});
			if (!uris || uris.length === 0) return;
			const path = uris[0].fsPath;
			try {
				await apiClient.addProject({ path });
			} catch (err) {
				if (!(err instanceof ProjectInitializationRequiredError)) {
					vscode.window.showErrorMessage(`AO: failed to register project — ${errorText(err)}`);
					return;
				}
				const initialize = await vscode.window.showWarningMessage(
					"This folder needs Git initialization before AO can create agent workspaces. Initialize Git and create an initial commit?",
					{ modal: true, detail: err.message },
					"Initialize Git",
				);
				if (initialize !== "Initialize Git") return;
				try {
					await apiClient.initializeProject(path);
					await apiClient.addProject({ path });
				} catch (initializeErr) {
					vscode.window.showErrorMessage(`AO: failed to initialize/register project — ${errorText(initializeErr)}`);
					return;
				}
			}
			projectsTreeProvider.refresh();
		}),
		vscode.commands.registerCommand("ao.projects.remove", async (arg: unknown) => {
			const project = extractProject(arg);
			if (!project) return;
			const confirmed = await vscode.window.showWarningMessage(
				`Remove AO project "${project.name}"? This stops its sessions and cleans up its workspace.`,
				{ modal: true },
				"Remove",
			);
			if (confirmed !== "Remove") return;
			try {
				await apiClient.removeProject(project.id);
				projectsTreeProvider.refresh();
			} catch (err) {
				vscode.window.showErrorMessage(`AO: failed to remove project — ${errorText(err)}`);
			}
		}),
		vscode.commands.registerCommand("ao.projects.refresh", () => projectsTreeProvider.refresh()),

		vscode.commands.registerCommand("ao.sessions.spawn", async (arg: unknown) => {
			let projectId = extractProject(arg)?.id;
			if (!projectId) {
				// Triggered from a context with no project (e.g. the workers view) —
				// ask which registered project to spawn into.
				let projects: ProjectSummary[];
				try {
					projects = await apiClient.listProjects();
				} catch (err) {
					vscode.window.showErrorMessage(`AO: failed to list projects — ${errorText(err)}`);
					return;
				}
				if (projects.length === 0) {
					vscode.window.showErrorMessage("AO: no projects registered yet. Run \"AO: Register Project…\" first.");
					return;
				}
				const picked = await vscode.window.showQuickPick(
					projects.map((project) => ({ label: project.name, description: project.path, id: project.id })),
					{ title: "AO: spawn worker in which project?" },
				);
				if (!picked) return;
				projectId = picked.id;
			}

			const harness = await vscode.window.showQuickPick(SPAWN_HARNESSES, { title: "AO: select a harness" });
			if (!harness) return;
			const prompt = await vscode.window.showInputBox({
				title: "AO: initial prompt (optional)",
				prompt: "Leave blank to start with no prompt.",
			});

			try {
				const session = await apiClient.spawnSession({
					projectId,
					harness: harness as SpawnHarness,
					prompt: prompt || undefined,
				});
				vscode.window.showInformationMessage(`AO: spawned worker "${session.displayName || session.id}".`);
				// The session_created SSE event will also refresh the workers tree;
				// call it explicitly too so the UI doesn't wait on that round trip.
				workersTreeProvider.refresh();
			} catch (err) {
				vscode.window.showErrorMessage(`AO: failed to spawn worker — ${errorText(err)}`);
			}
		}),
		vscode.commands.registerCommand("ao.sessions.kill", async (arg: unknown) => {
			const session = extractSession(arg);
			if (!session) return;
			const confirmed = await vscode.window.showWarningMessage(
				`Kill AO worker "${session.displayName || session.id}"?`,
				{ modal: true },
				"Kill",
			);
			if (confirmed !== "Kill") return;
			try {
				await apiClient.killSession(session.id);
				workersTreeProvider.refresh();
			} catch (err) {
				vscode.window.showErrorMessage(`AO: failed to kill worker — ${errorText(err)}`);
			}
		}),
		vscode.commands.registerCommand("ao.sessions.openTerminal", async (arg: unknown) => {
			let session = extractSession(arg);
			const sessionId = sessionIdFromArg(arg);
			if (!session && sessionId) {
				try { session = await apiClient.getSession(sessionId); } catch (err) { vscode.window.showErrorMessage(`AO: failed to load worker — ${errorText(err)}`); return; }
			}
			if (!session?.terminalHandleId) {
				vscode.window.showErrorMessage("This session has no terminal yet.");
				return;
			}
			const terminal = vscode.window.createTerminal({
				name: session.displayName || session.id,
				pty: createMuxPseudoterminal(daemon, session.terminalHandleId),
			});
			terminal.show();
		}),
	);

	await daemon.start();
}

export { SseParser } from "./proxy/sseParser";
export { attentionLane, sortAttentionSessions } from "./daemon/sessionPresentation";

export function deactivate(): void {
	// Disposal happens via context.subscriptions, which calls DaemonManager.dispose()
	// synchronously — that closes the supervisor link so a daemon this window
	// spawned starts its self-stop grace period immediately.
}
