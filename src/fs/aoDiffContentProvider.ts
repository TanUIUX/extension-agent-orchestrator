import * as vscode from "vscode";
import type { DaemonManager } from "../daemon/lifecycle";
import { createApiClient } from "../daemon/apiClient";
export class AoDiffContentProvider implements vscode.TextDocumentContentProvider {
	private readonly api: ReturnType<typeof createApiClient>;
	constructor(daemon: DaemonManager) { this.api = createApiClient(daemon); }
	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const [sessionId, side, ...parts] = uri.path.split("/").filter(Boolean);
		if (!sessionId || !side || parts.length === 0 || (side !== "before" && side !== "after")) throw vscode.FileSystemError.FileNotFound(uri);
		const path = parts.join("/");
		const file = await this.api.getWorkspaceFile(sessionId, path);
		if (file.binary) return `[Binary file: ${path}]`;
		if (side === "after") return file.content;
		if (file.deleted) return new TextDecoder().decode(await this.api.getWorkspaceFileBlob(sessionId, path, "before"));
		const base = await this.api.getWorkspaceFileBlob(sessionId, path, "before");
		return new TextDecoder().decode(base);
	}
}
