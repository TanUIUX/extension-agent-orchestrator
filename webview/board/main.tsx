import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { getDisplayStatusLabel, type BoardSessionPresentation } from "@aoagents/product-ui";
import { command, rpc, subscribeEvents } from "../lib/rpc";
import type { Project, Session } from "../lib/types";
import "../lib/styles.css";

const columns = ["needs_review", "building", "validating", "ready"] as const;
const columnLabels: Record<(typeof columns)[number], string> = { needs_review: "Needs you", building: "Working", validating: "In review", ready: "Ready" }; // Raked Signal Rack: lane order is the attention path.
const statusMap: Record<string, BoardSessionPresentation["status"]> = {
	working: "working", pr_open: "pr_open", draft: "draft", ci_failed: "ci_failed", review_pending: "review_pending",
	changes_requested: "changes_requested", approved: "approved", mergeable: "mergeable", merged: "merged", needs_input: "needs_input",
	exited: "exited", idle: "idle", terminated: "terminated", no_signal: "no_signal",
};

type BoardRow = { view: BoardSessionPresentation; source: Session };

function toBoardSession(session: Session): BoardSessionPresentation {
	return {
		id: session.id, title: session.displayName || session.title || session.id, provider: session.harness || "agent", branch: session.branch,
		status: statusMap[session.status] || "unknown", kanbanColumn: session.kanbanColumn, displayStatus: session.displayStatus,
		isTerminated: session.isTerminated, updatedAt: session.updatedAt, activity: session.activity as BoardSessionPresentation["activity"],
	};
}
function formatTime(timestamp: string): string {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return "—";
	return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}
function needsAttention(session: BoardSessionPresentation): boolean {
	return session.kanbanColumn === "needs_review" || ["ci_failed", "changes_requested", "needs_input"].includes(session.status);
}
function laneHas(row: BoardRow, column: (typeof columns)[number]): boolean {
	return column === "ready" ? row.view.kanbanColumn === "ready" || row.view.kanbanColumn === "archive" : row.view.kanbanColumn === column;
}
function statusClass(session: BoardSessionPresentation): string {
	if (needsAttention(session)) return "bad";
	if (session.status === "mergeable" || session.displayStatus === "Mergeable" || session.status === "approved") return "good";
	return "";
}
function ExternalLink({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) {
	return <a {...props} href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{children}</a>;
}
function Card({ row }: { row: BoardRow }) {
	const { source, view } = row;
	const title = view.title;
	const label = view.displayStatus ? getDisplayStatusLabel(view.displayStatus) : view.status;
	return <article className={`card ${needsAttention(view) ? "needs" : ""}`} tabIndex={0} role="button" onClick={() => command("ao.sessions.openWorker", { sessionId: view.id })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); command("ao.sessions.openWorker", { sessionId: view.id }); } }}>
		<div className="card-head"><span className={`mark ${needsAttention(view) ? "filled" : ""}`} aria-hidden="true" /><h3 className="card-title" title={title}>{title}</h3><div className="card-actions"><button className="icon-btn" type="button" title="Open worker" aria-label={`Open ${title}`} onClick={(event) => { event.stopPropagation(); command("ao.sessions.openWorker", { sessionId: view.id }); }}>↗</button></div></div>
		<div className="card-branch mono">{view.branch ? `⌁ ${view.branch}` : `${view.provider} · ${source.status}`}</div>
		{source.prs.length > 0 && <div className="pr" aria-label="Pull requests">{source.prs.map((pr) => <ExternalLink href={pr.url} key={pr.number}>↗ #{pr.number} · {pr.state}{pr.reviewComments ? " · comments" : ""}</ExternalLink>)}</div>}
		<div className="card-meta"><span className={`card-status ${statusClass(view)}`}><span className="mark filled" aria-hidden="true" />{label}</span><time className="card-time" dateTime={view.updatedAt}>{formatTime(view.updatedAt)}</time></div>
	</article>;
}
function Board() {
	const [projects, setProjects] = useState<Project[]>([]);
	const [rows, setRows] = useState<BoardRow[]>([]);
	const [projectId, setProjectId] = useState("");
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	const [error, setError] = useState("");
	const load = useCallback(async (nextProjectId = projectId) => {
		setState("loading");
		try {
			const loaded = await rpc<Project[]>("projects.list");
			setProjects(loaded);
			const sessions = await rpc<Session[]>("sessions.list", nextProjectId ? { projectId: nextProjectId } : {});
			setRows(sessions.map((source) => ({ source, view: toBoardSession(source) })));
			setState("ready"); setError("");
		} catch (err) { setState("error"); setError(err instanceof Error ? err.message : String(err)); }
	}, [projectId]);
	useEffect(() => { void load(); }, [load]);
	useEffect(() => subscribeEvents((event) => { if (event === "session_created" || event === "session_updated" || event.startsWith("pr_")) void load(); }), [load]);
	const needs = useMemo(() => rows.filter(({ view }) => needsAttention(view)).length, [rows]);
	return <div className="app board">
		<header className="topbar"><span className="brand"><span className="brand-mark" aria-hidden="true" />AO</span><span className="crumb">/</span><select aria-label="Project" value={projectId} onChange={(event) => { const next = event.target.value; setProjectId(next); void load(next); }}><option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><span className="topbar-spacer" /><span className="attention"><span className="mark filled" aria-hidden="true" />{needs} NEEDS YOU</span><button className="primary" type="button" onClick={() => command("ao.newTask")}>+ New task</button></header>
		{state === "loading" && <div className="status-line"><span className="mark filled" aria-hidden="true" />Reading live board…</div>}
		{state === "error" && <div className="error" role="alert">{error}<br /><button className="secondary" type="button" onClick={() => void load()}>Retry</button></div>}
		{state === "ready" && rows.length === 0 && <div className="empty"><div>No workers yet.<br /><button className="secondary" type="button" onClick={() => command("ao.newTask")}>Start a task</button></div></div>}
		{state === "ready" && rows.length > 0 && <div className="board-scroll"><div className="board-rail">{columns.map((column) => { const laneRows = rows.filter((row) => laneHas(row, column)); return <section className={`lane ${column === "needs_review" ? "needs" : ""}`} key={column}><div className="lane-head"><span className={`mark ${column === "needs_review" ? "filled" : ""}`} aria-hidden="true" />{columnLabels[column]}<span className="lane-count">{laneRows.length}</span></div><div className="lane-body">{laneRows.length === 0 ? <div className="lane-empty">—</div> : laneRows.map((row) => <Card key={row.view.id} row={row} />)}</div></section>; })}</div></div>}
	</div>;
}

createRoot(document.getElementById("root")!).render(<Board />);
