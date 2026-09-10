---
version: 1
slug: "board"
primary_target: "board"
related_targets: []
---

# Board surface brief

## Job and audience
Operate surface for individual developers and tech leads monitoring multiple coding-agent workers inside VS Code. On open, triage items that need human attention before scanning healthy work. Mode: Operate.

## Outcome and proof
The visitor identifies blocked work, active work, review work, and merge-ready work within seconds, then opens, instructs, reviews, or stops one worker. Real proof is daemon-backed session state: task title, worker/agent, branch, activity, PR, CI, and review signals. No invented metrics.

## Selected direction
Raked Signal Rack: a horizontal rail of four operational lanes, derived from a 1971 pocket timetable and translated into VS Code theme tokens. Rank comes from weight, case, rules, filled/hollow marks, and alignment; no decorative gradients or competing brand palette. Needs You owns the strongest rule and marker. Cards stay dense and bounded. A selected card sends one focus tick to its lane and opens the worker surface; reduced motion leaves the rail static.

## Scope and boundaries
Board first viewport only for this brief. Desktop and narrow webview behavior: preserve horizontal lanes and readable card widths; allow horizontal scroll rather than collapsing cards. Keep VS Code native chrome outside the panel. Do not include browser, titlebar, cloud, mobile, or marketing claims. Board actions must remain keyboard accessible.

## States and ranges
Support daemon starting/ready/error, loading, empty project, empty lane, populated lanes, stale/live updates, selected/focused card, disabled action, and failed mutation with recovery copy. Typical board: 4 lanes and 1–30 worker cards. Long task names, missing PR, terminated workers, and narrow widths are normal.

## Interaction and layout
First viewport: compact AO/project header with Needs You count and New task action; four horizontal lane rails beneath. Needs You leads reading order. Each card exposes task name, worker/agent, branch/status signal, PR/CI/review signal, and only high-value quick actions. Lane headers carry plain-language counts. Cards scroll horizontally inside the board; focus rings and native keyboard semantics stay visible.

## Constraints and open decisions
React + Vite + TypeScript; reuse product-ui board/card presentation components and upstream adapter shapes without importing Electron renderer. Host-owned typed RPC proxies REST/SSE. VS Code light/dark custom properties are the palette. Target board payload under 250 KB gzipped. Signature motion uses one restrained rail/focus transition and respects prefers-reduced-motion.

## Direction contract

THESIS: This board is a field instrument for attention, not a decorative dashboard; it refuses the generic equal-weight card grid by making state, sequence, and human action legible on one horizontal rail.

OWN-WORLD: Tinted VS Code surfaces act as flat timetable stock; ink, rules, filled/hollow marks, and one status accent carry hierarchy. Condensed labels and readable system body copy share a strict baseline; cards are raked slides with a stable lateral axis, not floating rounded containers.

STORY: The visitor first sees how many things need them, locates the first actionable worker, then scans healthy work toward review and merge. Selecting a card proves its place on the rail and opens its conversation without losing the board's project context.

FIRST VIEWPORT: A 48px utility header spans the panel: AO mark/name at left, project selector next, Needs You count at right, New task as the sole filled action. A 1px rule introduces the board. Four lanes remain in one horizontal scroll track, each with a 32px title row and 280px-minimum cards; Needs You is first, visibly marked, and receives focus on initial load when data exists.

FORM: Raked Signal Rack, selected surface structure from seed key 0b1fdeee and direction seed c320d793; horizontal lane topology, one-scale operational labels, filled/hollow state marks, and lateral-only movement are binding.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
