import { FormEvent, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { command, rpc, subscribeEvents } from "../lib/rpc";
import type { Conversation, ConversationMessage, Session } from "../lib/types";
import "../lib/styles.css";

type WorkerProps = { sessionId: string };
function messageList(snapshot: Conversation | null): ConversationMessage[] { return snapshot?.messages ?? []; }
function Worker({ sessionId }: WorkerProps) {
	const [session, setSession] = useState<Session | null>(null);
	const [conversation, setConversation] = useState<Conversation | null>(null);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState("");
	const [sending, setSending] = useState(false);
	const load = useCallback(async () => {
		try { setSession(await rpc<Session>("sessions.get", { sessionId })); setConversation(await rpc<Conversation>("conversation.get", { sessionId })); setError(""); }
		catch (err) { setError(err instanceof Error ? err.message : String(err)); }
	}, [sessionId]);
	useEffect(() => { void load(); }, [load]);
	useEffect(() => subscribeEvents((event) => { if (event === "session_updated" || event.includes("conversation")) void load(); }), [load]);
	const send = async (event: FormEvent) => { event.preventDefault(); const text = draft.trim(); if (!text || sending) return; setSending(true); setError(""); setDraft(""); try { await rpc("conversation.send", { sessionId, text }); await load(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); setDraft(text); } finally { setSending(false); } };
	if (!session) return <div className="app"><div className="status-line">{error || "Loading worker…"}</div></div>;
	const title = session.displayName || session.title || session.id;
	return <div className="worker"><header className="topbar" style={{ padding: "0 18px" }}><button className="secondary" type="button" onClick={() => command("ao.openBoard")}>← Board</button><span className="brand"><span className="brand-mark" aria-hidden="true" />{title}</span><span className="crumb">{session.harness || "agent"} · {session.status}</span><span className="topbar-spacer" /><button className="secondary" type="button" onClick={() => command("ao.sessions.openTerminal", { sessionId })}>Terminal</button><button className="secondary" type="button" onClick={() => command("ao.sessions.openFiles", { sessionId })}>Changes</button></header><div className="worker-main"><section className="chat" aria-label="Worker conversation"><div className="chat-scroll">{messageList(conversation).length === 0 ? <div className="status-line">No messages yet. Give this worker a clear next step.</div> : messageList(conversation).map((message) => <article className={`message ${message.role}`} key={message.id}><div className="message-role">{message.role} {message.streaming ? "· writing" : ""}</div><div className="message-body">{message.text}</div></article>)}{error && <div className="error" role="alert">{error}</div>}</div><form className="composer" onSubmit={send}><textarea aria-label="Message worker" disabled={sending} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Tell the worker what to do next…" /><button className="primary" disabled={sending || !draft.trim()} type="submit">{sending ? "Sending…" : "Send"}</button></form></section><aside className="inspector" aria-label="Worker details"><h2>Worker record</h2><section className="inspector-section"><div className="inspector-label">Status</div><div className="inspector-value">{session.displayStatus}</div></section><section className="inspector-section"><div className="inspector-label">Agent</div><div className="inspector-value">{session.harness || "Unknown"}{session.model ? ` · ${session.model}` : ""}</div></section><section className="inspector-section"><div className="inspector-label">Branch</div><div className="inspector-value mono">{session.branch || "No branch reported"}</div></section><section className="inspector-section"><div className="inspector-label">Pull requests</div>{session.prs.length === 0 ? <div className="inspector-value">No pull requests yet.</div> : session.prs.map((pr) => <a className="inspector-value" href={pr.url} target="_blank" rel="noreferrer" key={pr.number}>#{pr.number} · {pr.state}</a>)}</section><section className="inspector-section"><div className="inspector-label">Session ID</div><div className="inspector-value mono">{session.id}</div></section></aside></div></div>;
}
const sessionId = document.querySelector<HTMLMetaElement>('meta[name="ao-session-id"]')?.content || "";
createRoot(document.getElementById("root")!).render(sessionId ? <Worker sessionId={sessionId} /> : <div className="app error">Missing session ID.</div>);
