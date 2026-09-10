# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React + Vite + TypeScript webviews; VS Code Extension API for native surfaces; `@aoagents/product-ui` for portable presentation components; no additional UI framework.

## Users

- Individual developers working in a repository who need to run and supervise several coding-agent tasks without leaving VS Code.
- Tech leads and maintainers coordinating parallel workers, reviewing progress, CI, pull requests, and review feedback across a project.

## Product Purpose

AO for VS Code lets developers plan, run, and supervise coding agents from inside VS Code. It keeps each task's agent, isolated workspace, terminal, conversation, changed files, pull request, CI, and review state together. Success means a user can see what is moving, what needs attention, and what is ready to merge, then act without switching to a separate desktop app.

## Positioning

AO combines project-level multi-agent orchestration with strict per-task isolation: one task has one worker, agent, branch/worktree, conversation, and feedback loop. The system turns live worker, source-control, CI, and review facts into an operational board while preserving a direct path into each worker's native terminal and conversation.

## Operating Context

AO runs as a VS Code extension against the local AO Go daemon and the repository managed by the user. The extension host owns daemon lifecycle and loopback transport; VS Code owns editor chrome, terminals, Explorer, diff editor, commands, settings, and remote workspace placement. The product must work in VS Code desktop and code-server, including workspace-side execution where the repository lives. Users may have multiple AO projects and multiple workers active at once.

## Capabilities and Constraints

- Register, initialize, and remove AO projects.
- Show projects and workers in native VS Code trees.
- Show a live kanban board grouped by working, needs-you, in-review, and ready-to-merge attention states.
- Spawn, kill, rename, archive, and inspect workers.
- Open a worker's terminal through a native VS Code terminal backed by the AO mux WebSocket.
- Chat with a worker, receive live updates, resolve approvals and input requests, and act on conversation turns.
- Browse a worker's changed workspace files and open native VS Code diffs.
- Inspect pull request, CI, and review state attached to the worker.
- Use the existing AO daemon REST, SSE, and WebSocket API through a validated extension-host proxy.
- Use VS Code light and dark themes through host-provided theme tokens.
- Exclude the Electron-only agent browser, desktop titlebar/tray, mobile pairing, cloud onboarding, and desktop auto-update surfaces from v1.
- Pure web environments without a Node-capable extension host are out of scope for v1.

## Brand Commitments

The product name is Agent Orchestrator (AO). Existing upstream product truth, terminology, and project/worker/board concepts remain authoritative. The rebuild must feel native to VS Code rather than imitating an Electron desktop window.

## Evidence on Hand

- Upstream source and API: `vendor/agent-orchestrator/`.
- Portable shared UI and presentation models: `vendor/agent-orchestrator/packages/product-ui/`.
- Existing daemon lifecycle, transport proxy, native terminal, and tree implementations: `code-server/extensions/ao-vscode/`.
- Upstream product documentation and screenshots: `vendor/agent-orchestrator/README.md` and `vendor/agent-orchestrator/docs/assets/readme/`.
- No new customer testimonials, benchmarks, or marketing claims are available; do not fabricate them.

## Product Principles

1. Make attention legible before making activity impressive.
2. Keep every task's ownership and isolation explicit.
3. Let VS Code's native surfaces do the work they already do well.
4. Preserve a fast path from signal to action: inspect, instruct, open, review, or stop.
5. Treat live daemon state as the source of truth.
