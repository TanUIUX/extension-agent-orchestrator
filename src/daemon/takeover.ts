// Pure decision helper for the wedged-orphan kill+replace path. Ported from
// `vendor/agent-orchestrator/frontend/src/shared/daemon-takeover.ts` (the
// `browserDaemonOwnershipDecision` half of that file is Electron's
// agent-browser-token ownership handoff — out of scope here, see
// PLANNING.md's "Agent browser is out of scope").
//
// Context: after both attach attempts in attach.ts fail (resolveDaemonFromRunFile
// and resolveDaemonFromPort both returned null), a process may still be
// holding the daemon port. Spawning a new daemon then makes the Go child
// collide on the port and exit 1. This helper encodes the decision: kill the
// holder when the run-file names a PID that is still alive (a hung/wedged
// holder that bound the port but is not answering /healthz). The probe
// disjunct (probe !== null) is kept as a defensive guard only: by the time
// this helper is called, resolveDaemonFromPort already returned null, so a
// holder that answers /healthz at this point is unexpected. If it does happen
// (e.g. a race), we still replace it rather than colliding on spawn.
//
// Gated by the `ao.daemon.allowAttachExisting` setting (see
// PLANNING.md Phase 0 item 3) — this is the only automatic takeover this
// extension performs; it never kills a daemon that is actually answering
// health checks.
import type { DaemonHealthProbe } from "./types";

/**
 * Reports whether something is holding the daemon port that we must kill
 * before spawning. By the time it is called, both healthy-reuse attach paths
 * have already returned null. The primary trigger is holderPidAlive: the
 * run-file names a PID that is still alive but is not answering /healthz (a
 * hung/wedged holder). The probe disjunct is a defensive guard: a holder that
 * answers at this point is unexpected (resolveDaemonFromPort already
 * returned null), but if it does appear, we replace it rather than colliding
 * on spawn.
 *
 * Returns true when the caller should kill the holder, wait for the port to
 * free, clear the stale run-file, then spawn a fresh daemon.
 *
 * Returns false when there is no detectable holder; spawn immediately.
 */
export function shouldReplacePortHolder(probe: DaemonHealthProbe | null, holderPidAlive: boolean): boolean {
	return probe !== null || holderPidAlive;
}
