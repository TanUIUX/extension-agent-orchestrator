import type { ControllersSessionView } from "./apiClient";

export type AttentionLane = "needs_review" | "building" | "validating" | "ready";
const laneOrder: AttentionLane[] = ["needs_review", "building", "validating", "ready"];
export function attentionLane(session: Pick<ControllersSessionView, "kanbanColumn" | "status">): AttentionLane {
	if (session.kanbanColumn === "needs_review") return "needs_review";
	if (session.kanbanColumn === "building") return "building";
	if (session.kanbanColumn === "validating") return "validating";
	if (session.kanbanColumn === "ready") return "ready";
	return session.status === "working" || session.status === "idle" ? "building" : "needs_review";
}
export function sortAttentionSessions(sessions: ControllersSessionView[]): ControllersSessionView[] {
	return [...sessions].sort((a, b) => laneOrder.indexOf(attentionLane(a)) - laneOrder.indexOf(attentionLane(b)) || b.updatedAt.localeCompare(a.updatedAt));
}
