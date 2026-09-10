export type Project = { id: string; name: string; path: string; folderMissing?: boolean };
export type PullRequest = { number: number; url: string; state: "open" | "draft" | "merged" | "closed"; reviewComments: boolean };
export type Session = {
	id: string; projectId: string; displayName?: string; title?: string; harness?: string; model?: string;
	branch?: string; status: string; displayStatus: string; kanbanColumn: "building" | "validating" | "needs_review" | "ready" | "archive";
	isTerminated: boolean; updatedAt: string; activity?: { state: string; lastActivityAt: string }; prs: PullRequest[]; terminalHandleId?: string;
};
export type ConversationMessage = { id: string; role: "user" | "assistant"; text: string; createdAt: string; streaming: boolean; turnId?: string };
export type Conversation = { messages: ConversationMessage[]; controller: string; title?: string; turns: { id: string; state: string; errorMessage?: string }[] };
export type Agent = { id: string; label: string; authStatus?: string; usageCount?: number };
