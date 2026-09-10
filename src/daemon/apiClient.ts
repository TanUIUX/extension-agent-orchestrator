// Host-side typed REST client. The daemon port is resolved per call so restarts remain safe.
import createClient from "openapi-fetch";
import type { components, paths } from "../api/schema";
import type { DaemonManager } from "./lifecycle";

export type ProjectSummary = components["schemas"]["ProjectSummary"];
export type Project = components["schemas"]["Project"];
export type ControllersSessionView = components["schemas"]["ControllersSessionView"];
export type SpawnHarness = NonNullable<components["schemas"]["SpawnSessionRequest"]["harness"]>;
export const SPAWN_HARNESSES: SpawnHarness[] = ["claude-code","codex","aider","opencode","grok","droid","amp","agy","crush","cursor","qwen","copilot","goose","auggie","continue","devin","cline","kimi","muse","kiro","kilocode","vibe","pi","kimchi","omp","prime-agent","autohand"];

function errorMessage(error: unknown, fallback: string): string {
	if (error && typeof error === "object") {
		const record = error as Record<string, unknown>;
		if (typeof record.message === "string" && record.message) return record.message;
		if (typeof record.error === "string" && record.error) return record.error;
	}
	return fallback;
}
export class ProjectInitializationRequiredError extends Error { constructor(readonly path: string, message: string) { super(message); this.name = "ProjectInitializationRequiredError"; } }

export function createApiClient(daemon: DaemonManager) {
	function client() { const status = daemon.status; if (status.state !== "ready") throw new Error("AO daemon is not ready."); return createClient<paths>({ baseUrl: `http://127.0.0.1:${status.port}` }); }
	async function listProjects(): Promise<ProjectSummary[]> { const { data, error } = await client().GET("/api/v1/projects"); if (error) throw new Error(errorMessage(error, "Failed to list projects.")); return data.projects; }
	async function addProject(input: { path: string; name?: string }): Promise<Project> { const { data, error } = await client().POST("/api/v1/projects", { body: { path: input.path, name: input.name } }); if (error) { const message = errorMessage(error, "Failed to register project."); if ((error as { code?: string }).code === "NOT_A_GIT_REPO" || (error as { code?: string }).code === "PROJECT_UNBORN") throw new ProjectInitializationRequiredError(input.path, message); throw new Error(message); } return data.project; }
	async function initializeProject(path: string): Promise<void> { const { error } = await client().POST("/api/v1/projects/initialize", { body: { path } }); if (error) throw new Error(errorMessage(error, "Failed to initialize Git repository.")); }
	async function removeProject(id: string): Promise<void> { const { error } = await client().DELETE("/api/v1/projects/{id}", { params: { path: { id } } }); if (error) throw new Error(errorMessage(error, "Failed to remove project.")); }
	async function listSessions(projectId?: string): Promise<ControllersSessionView[]> { const { data, error } = await client().GET("/api/v1/sessions", { params: { query: projectId ? { project: projectId } : {} } }); if (error) throw new Error(errorMessage(error, "Failed to list sessions.")); return data.sessions; }
	async function spawnSession(input: { projectId: string; harness?: SpawnHarness; prompt?: string; displayName?: string }): Promise<ControllersSessionView> { const { data, error } = await client().POST("/api/v1/sessions", { body: { projectId: input.projectId, harness: input.harness, prompt: input.prompt, displayName: input.displayName } }); if (error) throw new Error(errorMessage(error, "Failed to spawn session.")); return data.session; }
	async function killSession(sessionId: string): Promise<void> { const { error } = await client().POST("/api/v1/sessions/{sessionId}/kill", { params: { path: { sessionId } } }); if (error) throw new Error(errorMessage(error, "Failed to kill session.")); }
	async function getSession(sessionId: string): Promise<ControllersSessionView> { const { data, error } = await client().GET("/api/v1/sessions/{sessionId}", { params: { path: { sessionId } } }); if (error) throw new Error(errorMessage(error, "Failed to fetch session.")); return data.session; }
	async function getConversation(sessionId: string) { const { data, error } = await client().GET("/api/v1/sessions/{sessionId}/conversation", { params: { path: { sessionId } } }); if (error) throw new Error(errorMessage(error, "Failed to fetch conversation.")); return data; }
	async function sendConversationMessage(sessionId: string, text: string) { if (!text.trim()) throw new Error("Message cannot be empty."); const { data, error } = await client().POST("/api/v1/sessions/{sessionId}/conversation/messages", { params: { path: { sessionId } }, body: { text } }); if (error) throw new Error(errorMessage(error, "Failed to send message.")); return data; }
	async function listAgents() { const { data, error } = await client().GET("/api/v1/agents"); if (error) throw new Error(errorMessage(error, "Failed to list agents.")); return data; }
	async function listAgentModels(agent: string) { const { data, error } = await client().GET("/api/v1/agents/{agent}/models", { params: { path: { agent } } }); if (error) throw new Error(errorMessage(error, "Failed to list agent models.")); return data; }
	async function listWorkspaceFiles(sessionId: string) { const { data, error } = await client().GET("/api/v1/sessions/{sessionId}/workspace/files", { params: { path: { sessionId } } }); if (error) throw new Error(errorMessage(error, "Failed to list workspace files.")); return data; }
	async function listWorkspaceTree(sessionId: string, path?: string) { const { data, error } = await client().GET("/api/v1/sessions/{sessionId}/workspace/tree", { params: { path: { sessionId }, query: path ? { path } : {} } }); if (error) throw new Error(errorMessage(error, "Failed to list workspace tree.")); return data; }
	async function getWorkspaceFile(sessionId: string, path: string, section?: string) { const { data, error } = await client().GET("/api/v1/sessions/{sessionId}/workspace/file", { params: { path: { sessionId }, query: { path, ...(section ? { section: section as never } : {}) } } }); if (error) throw new Error(errorMessage(error, "Failed to read workspace file.")); return data; }
	async function listNotifications() { const { data, error } = await client().GET("/api/v1/notifications", { params: { query: { status: "unread", limit: 100 } } }); if (error) throw new Error(errorMessage(error, "Failed to list notifications.")); return data; }
	async function getWorkspaceFileBlob(sessionId: string, path: string, side: "before" | "after" = "after") { const { data, error } = await client().GET("/api/v1/sessions/{sessionId}/workspace/file/blob", { params: { path: { sessionId }, query: { path, side } }, parseAs: "arrayBuffer" }); if (error) throw new Error(errorMessage(error, "Failed to read workspace file blob.")); return data; }
	return { listProjects, addProject, initializeProject, removeProject, listSessions, spawnSession, killSession, getSession, getConversation, sendConversationMessage, listAgents, listAgentModels, listWorkspaceFiles, listWorkspaceTree, getWorkspaceFile, listNotifications, getWorkspaceFileBlob };
}
export type ApiClient = ReturnType<typeof createApiClient>;
