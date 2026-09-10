import * as vscode from "vscode";
import type { DaemonManager } from "../daemon/lifecycle";
import { createApiClient } from "../daemon/apiClient";

type Resource = { sessionId: string; path: string };
export class AoFileSystemProvider implements vscode.FileSystemProvider {
	private readonly api: ReturnType<typeof createApiClient>;
	private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	readonly onDidChangeFile = this.emitter.event;
	constructor(daemon: DaemonManager) { this.api = createApiClient(daemon); }
	watch(): vscode.Disposable { return new vscode.Disposable(() => undefined); }
	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const [sessionId, ...parts] = uri.path.split("/").filter(Boolean);
		if (!sessionId) return { type: vscode.FileType.Directory, ctime: 0, mtime: Date.now(), size: 0 };
		if (parts.length === 0) return { type: vscode.FileType.Directory, ctime: 0, mtime: Date.now(), size: 0 };
		const path = parts.join("/");
		try {
			const tree = await this.api.listWorkspaceTree(sessionId, path);
			if (tree.entries.length > 0) return { type: vscode.FileType.Directory, ctime: 0, mtime: Date.now(), size: 0 };
		} catch { /* fall through to file lookup */ }
		try {
			const file = await this.api.getWorkspaceFile(sessionId, path);
			return { type: vscode.FileType.File, ctime: 0, mtime: Date.now(), size: file.size };
		} catch { throw vscode.FileSystemError.FileNotFound(uri); }
	}
	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> { const [sessionId, ...parts] = uri.path.split("/").filter(Boolean); if (!sessionId) return []; const tree = await this.api.listWorkspaceTree(sessionId, parts.join("/") || undefined); return tree.entries.map((entry) => [entry.name, entry.type === "dir" ? vscode.FileType.Directory : vscode.FileType.File]); }
	createDirectory(): void { throw vscode.FileSystemError.NoPermissions("AO workspaces are read-only."); }
	delete(): void { throw vscode.FileSystemError.NoPermissions("AO workspaces are read-only."); }
	rename(): void { throw vscode.FileSystemError.NoPermissions("AO workspaces are read-only."); }
	writeFile(): void { throw vscode.FileSystemError.NoPermissions("AO workspaces are read-only."); }
	async readFile(uri: vscode.Uri): Promise<Uint8Array> { const resource = this.parse(uri); const file = await this.api.getWorkspaceFile(resource.sessionId, resource.path); return new TextEncoder().encode(file.content); }
	private parse(uri: vscode.Uri): Resource { const [sessionId, ...parts] = uri.path.split("/").filter(Boolean); if (!sessionId || parts.length === 0) throw vscode.FileSystemError.FileNotFound(uri); return { sessionId, path: parts.join("/") }; }
	refresh(sessionId?: string): void { this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri: sessionId ? vscode.Uri.parse(`ao:/${sessionId}`) : vscode.Uri.parse("ao:/") }]); }
}
