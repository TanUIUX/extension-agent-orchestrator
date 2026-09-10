# Rebuild AO UI as a native-first VS Code extension

## Context

[Agent Orchestrator](https://github.com/Untrivial-ai/agent-orchestrator) (AO) is an Electron desktop app: a Go daemon (`backend/`) serving loopback REST/SSE/WebSocket, plus a React renderer (349 source files) that talks to the daemon directly. Electron main is a *capability* layer (dialogs, `BrowserView`, auto-update, tray, native titlebar), not a data proxy.

Two divergent VS Code ports exist in this workspace today, both taking the same approach — **embed the entire vendored Electron renderer in one webview**:

| | [code-server/extensions/ao-vscode/](extensions/ao-vscode/) | [agent-orchestrator-vscode/](../agent-orchestrator-vscode/) |
|---|---|---|
| Git | submodule `@943fe2e`, dirty working tree | untracked |
| Daemon lifecycle | complete ([src/daemon/](extensions/ao-vscode/src/daemon/), 1149 lines) | partial (`src/ao-daemon.ts`) |
| Transport proxy | complete ([src/proxy/](extensions/ao-vscode/src/proxy/), 342 lines) | `src/ao-proxy.ts` |
| Native surfaces | terminal + 2 tree views | none |
| Webview | vendored renderer, `dist/webview` = **9.5 MB** | same approach |

**Why rebuild.** The embed approach carries costs that no amount of polish removes:

1. **9.5 MB bundle** for a UI that is mostly chrome VS Code already provides — its own titlebar, sidebar, tab strip, command palette, settings dialog, keyboard-shortcuts dialog, terminal emulator, file tree, diff viewer.
2. **Dead weight shipped and hidden with CSS.** [PLANNING.md](extensions/ao-vscode/PLANNING.md) §1.5 states the browser tab and native titlebar are "hidden via a small CSS override, not deleted." `BrowserPanel`, `BrowserTabsRail`, `BrowserProfileButton`, `BrowserDownloadsList`, `WindowTitlebar`, `TitlebarNav`, `TrayRuntime`, `MigrationPopup`, `RestartToUpdateDialog`, `ConnectMobileModal` are all Electron-only and all still in the bundle.
3. **Fights the host.** [src/webview/themeBridge.ts](extensions/ao-vscode/src/webview/themeBridge.ts) needs 45 `!important` declarations to force a dark-first design system to follow VS Code themes. [src/webview/bridge/installBridge.ts](extensions/ao-vscode/src/webview/bridge/installBridge.ts) is 641 lines shimming `fetch`/`EventSource`/`WebSocket` and stubbing ~40 `window.ao` methods that never work.
4. **Build coupling.** [scripts/build-webview.mjs](extensions/ao-vscode/scripts/build-webview.mjs) imports Vite by exact path out of `vendor/agent-orchestrator/frontend/node_modules` and strips a plugin from the vendored config at load time. Every upstream renderer change risks the build.
5. **Portability ceiling.** `retainContextWhenHidden: true` on a 9.5 MB React app with xterm/WebGL, plus a full Electron design system, is the opposite of what runs well in code-server or a remote window.

**The reusable asset is already isolated upstream.** `packages/product-ui` (`@aoagents/product-ui`) is a deliberately portable package — an [import-boundary test](extensions/ao-vscode/vendor/agent-orchestrator/packages/product-ui/src/import-boundary.test.ts) enforces that its production sources import nothing but `react`, `clsx`, `motion/react`, and `tailwind-merge`; no TanStack, no Electron, no bridge, no hooks, no stores, no API client. It contains `SessionsBoardGridView`, `SessionCardView`, `SessionInspectorView`, `TaskComposerView`, `ProjectViews`, `PRSummaryDisplay`, and all board/status/PR presentation logic (`session-presentation.ts`, `session-models.ts`, `scm-models.ts`, `pull-request-models.ts`). That is the design work worth keeping. Everything around it is Electron shell.

**Intended outcome.** A new standalone extension where VS Code owns the chrome and a small set of purpose-built webviews own only what VS Code has no widget for (kanban board, chat transcript, session inspector). Feature parity with PLANNING.md v1 scope, minus the agent browser. Target: **webview payload under ~500 KB**, no vendored-renderer build step, runs on VS Code desktop and code-server.

---

## Decisions (settled with the user)

- **UI**: VS Code-native chrome + thin purpose-built webviews. Reuse `@aoagents/product-ui`; do not embed the vendored renderer.
- **Codebase**: **new standalone repo at `/home/runner/workspace/code-server/project/`** (own git, sibling to both old copies), borrowing `src/daemon/` and `src/proxy/` from `code-server/extensions/ao-vscode`. Neither existing copy is modified.
- **Platforms v1**: VS Code desktop + code-server. (`extensionKind: ["workspace"]` also makes Remote-SSH/Dev Container work for free; pure-web/no-Node is explicitly out of scope.)
- **Scope v1**: projects, kanban board, spawn/kill worker, worker terminal, worker chat, workspace files/diff, PR/review/CI. Agent browser out.
- **Design method**: `/impeccable`, Operate mode.

---

## Feature inventory → surface assignment

Derived from the daemon's own API (65 top-level paths in [src/api/schema.ts](extensions/ao-vscode/src/api/schema.ts); the `/api/v1/sessions/{sessionId}/…` subtree alone has ~60 operations) cross-referenced with the renderer's 9 routes and 349 components.

### Native VS Code (no webview)

| Feature | Mechanism | Endpoints | Reuse |
|---|---|---|---|
| Projects list | `TreeView` | `GET/POST/DELETE /projects`, `/projects/initialize` | [projectsTreeProvider.ts](extensions/ao-vscode/src/views/projectsTreeProvider.ts) |
| Workers list, grouped by attention zone | `TreeView` + `ThemeIcon` | `GET /sessions`, SSE | [workersTreeProvider.ts](extensions/ao-vscode/src/views/workersTreeProvider.ts) + `attentionZone()` from product-ui |
| Worker terminal | `Pseudoterminal` | `/mux` WS | [muxPseudoterminal.ts](extensions/ao-vscode/src/terminal/muxPseudoterminal.ts) — done, verified |
| Shell terminals | `Pseudoterminal` | `/shell-terminals` | same transport |
| Changed files | `FileSystemProvider` (`ao:` scheme) | `/sessions/{id}/workspace/{tree,files,file}` | new, ~120 lines |
| Diff | `vscode.diff` + `TextDocumentContentProvider` | `workspace/file` before/after | PLANNING.md Phase 2 item 2 |
| Spawn / kill / rename / archive | commands + `QuickPick` + `InputBox` | `POST /sessions`, `/kill`, `/cleanup` | [extension.ts](extensions/ao-vscode/src/extension.ts) has spawn/kill |
| Agent + model picker | `QuickPick` | `/agents`, `/agents/{agent}/models` | replaces `AgentModelPicker.tsx` |
| Notifications | `TreeView` + `window.showInformationMessage` | `/notifications`, `/notifications/stream` | replaces `NotificationCenter.tsx` |
| Daemon health | `StatusBarItem` + `OutputChannel` | `/healthz`, `/endpoints` | existing status bar; replaces `DaemonFailureBanner`, `DaemonStartupLoader` |
| Settings | `contributes.configuration` + `/settings` sync | `/settings`, `/projects/{id}/config` | replaces `SettingsDialog.tsx`, `GlobalSettingsForm.tsx` (~1200 lines) |
| Open PR / links | `env.openExternal` | — | [bridgeCalls.ts](extensions/ao-vscode/src/webview/bridgeCalls.ts) |
| Command palette, keybindings, search, clipboard | **host built-ins** | — | deletes `CommandPalette.tsx`, `KeyboardShortcutsDialog.tsx`, `TerminalSearch.tsx`, `keybindings-store.ts` |

### Webviews (three, each single-purpose)

| Panel | Owns | product-ui reuse |
|---|---|---|
| **Board** (`ao.board`) | kanban lanes, cards, drag-to-reassign, empty states | `SessionsBoardGridView`, `SessionCardView`, `groupBoardPullRequests`, `boardKanbanColumnOrder`, `getKanbanColumnView` |
| **Worker** (`ao.worker`, one per session) | chat transcript, composer, approvals/inputs, turn actions (retry/edit/rollback/steer), inspector tabs (PR/CI/reviews/usage) | `SessionInspectorView` (1535 lines), `TaskComposerView`, `PRSummaryDisplay`, `getSessionStatusView`, `getSessionTimelinePillView` |
| **New task** (`ao.newTask`) | prompt + agent/model + file attachments | `TaskComposerView` |

Chat is the one surface with no native equivalent — the conversation API (~30 operations: streaming turns, approvals, input requests, branches, queue reorder, compact, skills, MCP reload) is far richer than the Chat Participant API models. Keep it a webview in v1; Chat Participant (`@ao`) stays a Phase-2 additive shortcut.

### Dropped (Electron-only, with the native replacement named)

`BrowserPanel` + `BrowserTabsRail` + `BrowserProfileButton` + `BrowserDownloadsList` + `/browser/*` (no CDP/`BrowserView` in a webview — `env.openExternal` on the preview URL instead) · `WindowTitlebar`/`TitlebarNav`/`useWindowFullScreen` (host chrome) · `TrayRuntime` (status bar) · `RestartToUpdateDialog`/`useUpdateStatus`/`useRequestUpdateInstall` (VSIX updates) · `MigrationPopup`/`MigrationSection` (desktop-app data migration) · `ConnectMobileModal` + `/mobile/*` + `/push/*` (desktop pairing) · `ResizeHandle`/`useResizable` (host layout) · `CloudOnboardingGate`/`CloudCredentialDialog`/`lib/cloud-cp` (separate product surface, deferred).

---

## Architecture

```
/home/runner/workspace/code-server/project/          ← new repo, own git, sibling to both old copies
  src/
    extension.ts              activation, commands, wiring
    daemon/                   ── PORTED verbatim from code-server/extensions/ao-vscode
      attach.ts discovery.ts launch.ts lifecycle.ts runFile.ts
      supervisorLink.ts takeover.ts types.ts apiClient.ts
    proxy/                    ── PORTED verbatim (mux.ts keeps role:"secondary")
      rest.ts events.ts sseParser.ts mux.ts
    api/schema.ts             regenerated from vendored openapi.yaml
    views/                    projects · workers · notifications tree providers
    terminal/                 muxPseudoterminal.ts  ── PORTED verbatim
    fs/                       aoFileSystemProvider.ts · aoDiffContentProvider.ts
    panels/                   boardPanel.ts · workerPanel.ts · newTaskPanel.ts
    rpc/                      typed host↔webview channel (replaces installBridge.ts)
  webview/                    NEW React app, no vendored renderer
    board/ worker/ newTask/
    lib/tokens.css            VS Code custom properties only — no !important
    lib/rpc.ts                client half of src/rpc
  vendor/agent-orchestrator   pinned submodule — openapi.yaml + product-ui only
```

**Transport keeps the proven design.** The daemon's CORS gate rejects a `vscode-webview://` origin, so every REST/SSE/WS call runs from the extension host. `src/proxy/*` already does this correctly, including the loopback-only allowlist in `rest.ts`/`mux.ts` and the `role:"secondary"` stamp in [mux.ts](extensions/ao-vscode/src/proxy/mux.ts) that stops this window's PTY dimensions from resizing a desktop-app user's shared terminal. Port unchanged.

**What replaces `installBridge.ts` (641 lines → ~120).** Instead of shimming `fetch`/`EventSource`/`WebSocket` so unmodified renderer code believes it is in Electron, the new webviews get an explicit typed RPC surface: `call(method, params)`, `subscribe(topic, handler)`. No global monkey-patching, no ~40 dead stubs, no `window.ao`.

**Theme.** New webview CSS consumes `--vscode-*` custom properties as the *source*, so zero `!important` and both light and dark work by construction. This is what deleting the vendored design system buys.

---

## Implementation phases

### P0 — Scaffold + port (no UI work)
Create the repo. Pin `vendor/agent-orchestrator` at the same commit the existing submodule uses (`943fe2e`'s recorded pin) so `api:generate` output matches. Copy `src/daemon/`, `src/proxy/`, `src/terminal/`, `src/api/schema.ts` verbatim; port `src/views/*` with imports adjusted. `esbuild` for the extension; Vite for webviews — **the extension's own Vite, not the vendored frontend's**, which removes the exact-path import in `build-webview.mjs`. Consume `@aoagents/product-ui` via `file:vendor/agent-orchestrator/packages/product-ui`.

**Done when**: `npm run build` compiles, F5 activates, status bar reflects a daemon, both trees populate from a real daemon, `ao.sessions.openTerminal` attaches. No webview yet.

### P1 — Design direction (`/impeccable`)
Run in the new repo, in order:
1. `/impeccable init` → `PRODUCT.md`. AO's product truth: parallel agent supervision, attention-driven board, one worker = one task = one worktree.
2. `/impeccable shape board` → **Operate** mode (the visitor completes a task; scanability and native expectations outrank expression). Decide the visual world for a surface living *inside* VS Code — this is the central design question, and the one the embed approach never got to ask: how much AO identity survives when the host owns the chrome. Constraint: VS Code theme tokens are the palette; brand lives in density, rhythm, iconography, and card structure, not in a competing color system.
3. `/impeccable shape worker` → chat transcript + inspector density.

**Done when**: `PRODUCT.md` + surface briefs exist, board and worker layouts approved before any component is written.

### P2 — Board panel
`boardPanel.ts` + `webview/board/`. `SessionsBoardGridView` + `SessionCardView` from product-ui; adapter mapping `ControllersSessionView` → `BoardSessionPresentation`. Reference (do not copy) the vendored [SessionsBoardAdapters.tsx](extensions/ao-vscode/vendor/agent-orchestrator/frontend/src/renderer/components/SessionsBoardAdapters.tsx) (407 lines) for the mapping shape. Live updates via `subscribe` over the proxied `/events` SSE. Card click → reveals the worker in the tree and opens the worker panel; card actions → host commands.

**Done when**: real lanes, real cards, live SSE updates, drag reassign persists, correct in light and dark, bundle under ~250 KB gzipped.

### P3 — Worker panel
`workerPanel.ts` + `webview/worker/`. Chat transcript + `TaskComposerView` + `SessionInspectorView`. Wire the conversation API: `messages`, `steer`, `interrupt`, `turns/{id}/{cancel,edit,retry,rollback}`, `approvals/{id}/resolve`, `inputs/{id}/resolve`, `queue/reorder`, `compact`. Inspector tabs read `/pr`, `/reviews`, `/usage/sessions`. Terminal and diff are **not** in this panel — buttons that invoke the native surfaces.

**Done when**: send/receive works against a real agent, approvals resolve, PR/CI/review tabs populate, turn actions work, reopening the panel restores state without leaking sockets.

### P4 — Files + diff
`aoFileSystemProvider.ts` (`ao:` scheme, `workspace/{tree,files}`) so changed files appear in the Explorer; `aoDiffContentProvider.ts` + `vscode.diff` for review. `workspace/events` SSE invalidates.

**Done when**: a worker's changed files browse in the Explorer, diffs open in VS Code's own diff editor with gutters and per-file navigation.

### P5 — New task + notifications + settings
`newTaskPanel.ts` (`TaskComposerView`, `/sessions` POST, `/agents` + models via `QuickPick`). Notifications tree + toasts. Settings mapped to `contributes.configuration`, synced with `/settings`.

### P6 — Finish
`/impeccable polish board`, `/impeccable polish worker`, `/impeccable audit` (a11y: keyboard nav, focus order, contrast against both theme kinds), `/impeccable document` → `DESIGN.md` derived from the shipped artifact.

---

## Verification

**Per phase** — each phase's "Done when" is the gate. All of it requires a real daemon; there is no meaningful mock.

```bash
# real daemon (borrow the built binary rather than rebuilding Go)
code-server/extensions/ao-vscode/resources/linux-x64/ao serve   # or the desktop app's bundled daemon
curl -s localhost:$PORT/api/v1/projects | jq   # confirm it is serving before touching the extension

# in the new repo
npm run api:generate && npm run typecheck && npm run build && npm test
# F5 → Extension Development Host
```

**End-to-end smoke** (run against a real repo, both light and dark theme):
1. Register a project → appears in the Projects tree.
2. Spawn a worker → appears in the Workers tree **and** on the board, in the right lane.
3. Open its terminal → native VS Code terminal accepts input; confirm a *desktop-app* terminal on the same worker does not resize (the `role:"secondary"` guarantee).
4. Chat: send a prompt, get a response, resolve an approval, retry a turn.
5. Browse changed files in the Explorer; open a diff.
6. PR/CI/review tabs populate from real GitHub state.
7. Toggle VS Code light↔dark → both webviews follow with no manual reload.
8. Close and reopen every panel → daemon connection count returns to baseline (`ao status`, or count `/events` subscribers). This is the leak check PLANNING.md §1.5 calls for.

**Automated** — `node --test` over the pure layers, no VS Code host needed:
- `withSecondaryRole()` frame stamping (port the existing coverage; this is the highest-consequence pure function in the codebase).
- `isAllowedTarget()` loopback allowlist in `rest.ts` and `mux.ts` — a security boundary, so it gets a test regardless of how small it is.
- SSE parser (`sseParser.ts`) — chunk-boundary splits.
- Board adapter: `ControllersSessionView` → `BoardSessionPresentation` for each attention zone.
- product-ui renders under `@testing-library/react` + jsdom, asserting the adapter's output produces the expected lane.

**Bundle budget** — CI assertion, not a hope: fail the build if `webview/board` exceeds 250 KB gzipped or the total webview payload exceeds 500 KB. Without a hard gate, "thin webview" decays back toward the 9.5 MB it replaced.

**Portability** — verify in a code-server instance, not only desktop, before calling any phase done. This is the whole reason for the rebuild and the failure mode that only shows up in the real host.

---

## Risks

| Risk | Mitigation |
|---|---|
| **Chat is the deep end.** ~30 conversation operations, streaming, approvals, branches. Underestimating it is the likeliest schedule miss. | P3 is its own phase, sequenced after the board proves the architecture. Cut scope to send/receive/approve if it overruns; turn-edit and branches are additive. |
| `product-ui` drifts on submodule bump | Its import-boundary test is upstream's own guard; run it after any bump. Pin deliberately, note in `UPSTREAM.md`. |
| Both existing copies rot further | They are untouched and still buildable. If this rebuild lands, retire them in one explicit commit — not silently. |
| Native surfaces lose board context | Tree items and board cards carry the same `sessionId`; every native surface titles itself with the worker's display name. |
| `SessionInspectorView` (1535 lines) may assume renderer-only props | Read its props before P3 planning; write a thin adapter, do not fork the component. |

---

## Not doing (and when to revisit)

- **Agent browser** — needs `BrowserView`/CDP. Revisit only if AO exposes preview over plain HTTP.
- **Pure-web / vscode.dev** — needs a remote-daemon mode (URL + token, browser-side fetch). Real work, own project; the RPC-proxy design does not block it.
- **Chat Participant (`@ao`)** — additive Phase 2 shortcut, after P3 is stable.
- **Orchestrator, usage dashboards, cloud, mobile pairing** — post-v1.
- **Modifying the two existing copies** — new repo means they stay as reference.
