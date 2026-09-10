// Daemon lifecycle manager for the extension host: attach-first, spawn only
// when nothing already serves the port, with an OS-native supervisor link
// that lets a daemon we spawned self-stop when this window closes.
//
// Ported (with Electron/browser/telemetry/tmux/AppImage concerns dropped —
// see PLANNING.md "v1 scope") from:
//   vendor/agent-orchestrator/frontend/src/main.ts            (startDaemonInner, ~1343-1780)
//   vendor/agent-orchestrator/frontend/src/shared/daemon-launch.ts
//   vendor/agent-orchestrator/frontend/src/shared/daemon-discovery.ts
//   vendor/agent-orchestrator/frontend/src/shared/daemon-attach.ts
//   vendor/agent-orchestrator/frontend/src/shared/daemon-takeover.ts
//   vendor/agent-orchestrator/frontend/src/main/supervisor-link.ts
//
// See PLANNING.md "Phase 0" for the attach-vs-spawn decision tree and the
// supervise.sock liveness contract this implements.
import * as vscode from "vscode";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { expectedDaemonPort, resolveDaemonFromPort, resolveDaemonFromRunFile } from "./attach";
import { createListenPortScanner, parseRunFile } from "./discovery";
import { bundledTmuxExecutable, type DaemonLaunchSpec, resolveDaemonLaunch } from "./launch";
import { defaultRunFilePath, probeDaemon, readRunFileRaw } from "./runFile";
import { connectSupervisor, supervisorAddress, type SupervisorLinkHandle } from "./supervisorLink";
import { shouldReplacePortHolder } from "./takeover";
import type { DaemonStatus } from "./types";

// How long the manager waits for the daemon to confirm its bound port (via
// the listen log line or running.json) before reporting slow-but-still-alive
// progress rather than an outright failure.
const PORT_DISCOVERY_TIMEOUT_MS = 30_000;
const RUN_FILE_POLL_MS = 300;
// Accept run-files stamped slightly before our spawn timestamp: the daemon's
// clock reading and ours race within normal scheduling jitter.
const RUN_FILE_FRESHNESS_SKEW_MS = 2_000;
// Wedged-orphan takeover: how long to wait for a killed holder's port to free.
const TAKEOVER_TIMEOUT_MS = 8_000;
const TAKEOVER_POLL_MS = 200;
// How long to wait for a daemon we asked to stop (restart command) to
// actually go away before giving up and attempting to spawn anyway.
const STOP_TIMEOUT_MS = 8_000;

function processAlive(pid: number): boolean {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DaemonConfig {
	executablePath: string;
	dataDir: string;
	allowAttachExisting: boolean;
}

export class DaemonManager {
	private readonly emitter = new EventEmitter();
	private current: DaemonStatus = { state: "starting" };
	/** Set only when THIS manager spawned the daemon; null when merely attached. */
	private child: ChildProcess | null = null;
	private supervisorLink: SupervisorLinkHandle | null = null;
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	private runFileTimer: ReturnType<typeof setInterval> | undefined;
	private fallbackTimer: ReturnType<typeof setTimeout> | undefined;
	// Bumped on every restart()/dispose() to make in-flight attach/spawn probes
	// from a superseded attempt no-op instead of racing a newer one.
	private epoch = 0;
	private intentionalStop = false;
	private refreshing = false;
	private readonly configListener: vscode.Disposable;
	private readonly extensionPath: string;

	constructor(extensionPath: string) {
		this.extensionPath = extensionPath;
		this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("ao.daemon")) void this.refresh();
		});
	}

	get status(): DaemonStatus {
		return this.current;
	}

	onDidChangeStatus(listener: (status: DaemonStatus) => void): vscode.Disposable {
		this.emitter.on("status", listener);
		return new vscode.Disposable(() => this.emitter.off("status", listener));
	}

	private setStatus(next: DaemonStatus) {
		this.current = next;
		this.emitter.emit("status", next);
	}

	private config(): DaemonConfig {
		const cfg = vscode.workspace.getConfiguration("ao.daemon");
		return {
			executablePath: cfg.get<string>("executablePath", ""),
			dataDir: cfg.get<string>("dataDir", ""),
			allowAttachExisting: cfg.get<boolean>("allowAttachExisting", true),
		};
	}

	async start(): Promise<void> {
		await this.refresh();
		// Multi-window note: every window runs this same attach-first flow, so
		// only the window that actually spawns holds a child/supervisor link;
		// the rest just attach-poll here. No extension-side locking needed — the
		// daemon's own port-bind guard is the single source of truth.
		this.pollTimer = setInterval(() => void this.refresh(), 10_000);
	}

	/** Re-runs the attach-or-spawn decision, unless a daemon we spawned is already running/starting. */
	private async refresh(): Promise<void> {
		if (this.refreshing || this.child) return;
		this.refreshing = true;
		try {
			await this.attachOrSpawn();
		} finally {
			this.refreshing = false;
		}
	}

	private async attachOrSpawn(): Promise<void> {
		const epoch = this.epoch;
		const rfp = defaultRunFilePath();
		const runFileContents = await readRunFileRaw(rfp);

		const viaRunFile = await resolveDaemonFromRunFile({
			runFileContents,
			isProcessAlive: processAlive,
			probe: probeDaemon,
			parseRunFile,
		});
		if (epoch !== this.epoch) return;
		if (viaRunFile) {
			this.setStatus(viaRunFile);
			if (viaRunFile.state === "ready") {
				const info = runFileContents ? parseRunFile(runFileContents) : null;
				if (info?.owner === "app") this.linkSupervisor(rfp);
			}
			return;
		}

		// Backstop: a standalone `ao daemon` may be serving the expected port
		// while running.json is missing/stale/inconsistent (issue #367 upstream).
		const expectedPort = expectedDaemonPort(process.env);
		const viaPort = await resolveDaemonFromPort({ expectedPort, probe: probeDaemon });
		if (epoch !== this.epoch) return;
		if (viaPort) {
			this.setStatus(viaPort);
			if (viaPort.state === "ready") {
				// Best-effort owner lookup from whatever run-file we already read;
				// a narrow TOCTOU (the file could have changed since) is acceptable —
				// worst case we skip linking a daemon we do in fact own.
				const info = runFileContents ? parseRunFile(runFileContents) : null;
				if (info?.owner === "app") this.linkSupervisor(rfp);
			}
			return;
		}

		const { executablePath, dataDir, allowAttachExisting } = this.config();
		const launch = resolveDaemonLaunch(executablePath, homedir(), this.extensionPath);
		if (!launch) {
			this.setStatus({
				state: "stopped",
				message:
					'No AO desktop app install was found at its default location. Set "ao.daemon.executablePath" to the ao CLI binary to start a daemon, or start one externally (the AO desktop app, or `ao daemon`).',
				code: "not_configured",
			});
			return;
		}

		if (allowAttachExisting) {
			await this.takeoverWedgedOrphanIfAny(expectedPort, rfp);
			if (epoch !== this.epoch) return;
		}

		await this.spawn(launch, dataDir, epoch);
	}

	private linkSupervisor(rfp: string | null): void {
		const addr = supervisorAddress(rfp, process.platform);
		if (!addr) {
			console.warn("AO: supervisor link skipped; run-file path unavailable");
			return;
		}
		this.supervisorLink?.dispose();
		this.supervisorLink = connectSupervisor(addr, { log: (msg) => console.log(`AO: ${msg}`) });
	}

	/**
	 * Both attach paths returned null, but a process may still be holding the
	 * port: a hung/wedged holder whose run-file PID is alive but not answering
	 * /healthz. Kill it, wait for the port to free, and clear the stale
	 * run-file so a fresh spawn does not collide with it. A holder that *does*
	 * answer /healthz at this point is unexpected (resolveDaemonFromPort
	 * already returned null) but is replaced too, rather than colliding on
	 * spawn — see takeover.ts.
	 */
	private async takeoverWedgedOrphanIfAny(expectedPort: number, rfp: string): Promise<void> {
		const orphanProbe = await probeDaemon(expectedPort, "healthz");
		let runFilePid: number | null = null;
		const contents = await readRunFileRaw(rfp);
		if (contents) runFilePid = parseRunFile(contents)?.pid ?? null;
		const holderPidAlive = runFilePid !== null && processAlive(runFilePid);
		if (!shouldReplacePortHolder(orphanProbe, holderPidAlive)) return;

		const pidToKill = runFilePid ?? orphanProbe?.pid ?? null;
		if (pidToKill) {
			try {
				process.kill(-pidToKill, "SIGTERM");
			} catch {
				try {
					process.kill(pidToKill, "SIGTERM");
				} catch {
					// process already gone; proceed.
				}
			}
		}
		const deadline = Date.now() + TAKEOVER_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (!(await probeDaemon(expectedPort, "healthz"))) break;
			await delay(TAKEOVER_POLL_MS);
		}
		await rm(rfp, { force: true }).catch(() => undefined);
	}

	private async spawn(launch: DaemonLaunchSpec, dataDir: string, epoch: number): Promise<void> {
		if (!existsSync(launch.command)) {
			this.setStatus({
				state: "error",
				message: `AO daemon binary not found at ${launch.command}. Check "ao.daemon.executablePath".`,
				executablePath: launch.command,
				code: "binary_missing",
			});
			return;
		}
		try {
			await mkdir(launch.cwd, { recursive: true });
		} catch (err) {
			this.setStatus({
				state: "error",
				message: `Could not create the AO data directory at ${launch.cwd}: ${(err as Error).message}`,
				code: "binary_missing",
			});
			return;
		}
		if (epoch !== this.epoch) return;

		this.setStatus({ state: "starting" });

		let output = "";
		let child: ChildProcess;
		try {
			const tmuxPath = bundledTmuxExecutable(this.extensionPath);
			const spawnEnv = {
				...process.env,
				...(dataDir ? { AO_DATA_DIR: dataDir } : {}),
				...(tmuxPath ? { AO_TMUX_BINARY: tmuxPath, AO_TMUX_SOCKET_NAME: "ao" } : {}),
			};
			child = spawn(launch.command, launch.args, {
				cwd: launch.cwd,
				env: spawnEnv,
				// Own process group so a takeover kill (see takeoverWedgedOrphanIfAny)
				// reaches the whole tree, not just this immediate child.
				detached: true,
				windowsHide: true,
				stdio: "pipe",
			});
		} catch (err) {
			this.setStatus({
				state: "error",
				message: (err as Error).message,
				code: "spawn_failed",
			});
			return;
		}
		// The child's liveness is governed by the supervisor link, not by Node
		// holding its stdio pipes open — unref so this process can exit cleanly
		// independent of the daemon's lifetime.
		child.unref();
		this.child = child;

		const spawnedAtMs = Date.now();
		let confirmed = false;

		const stopDiscovery = () => {
			if (this.runFileTimer) clearInterval(this.runFileTimer);
			this.runFileTimer = undefined;
			if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
			this.fallbackTimer = undefined;
		};

		const reportBoundPort = (port: number) => {
			if (confirmed || this.child !== child) return;
			confirmed = true;
			stopDiscovery();
			this.setStatus({ state: "ready", port, pid: child.pid, executablePath: launch.command, workingDirectory: launch.cwd });
			// Called unconditionally on the spawn path: we always own this daemon.
			this.linkSupervisor(defaultRunFilePath());
		};

		// One scanner per stream: each keeps its own partial-line buffer.
		const scanStdout = createListenPortScanner(reportBoundPort);
		const scanStderr = createListenPortScanner(reportBoundPort);
		child.stdout?.on("data", (chunk: Buffer) => {
			const text = chunk.toString("utf8");
			output += text;
			scanStdout(text);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString("utf8");
			output += text;
			scanStderr(text);
		});

		const handshakePath = defaultRunFilePath();
		this.runFileTimer = setInterval(() => {
			void readRunFileRaw(handshakePath).then((contents) => {
				if (!contents) return; // absent until the daemon binds; keep polling
				const info = parseRunFile(contents);
				// Ignore a stale handshake left by a previous daemon: only trust a
				// file written at/after this spawn.
				if (info && info.startedAtMs >= spawnedAtMs - RUN_FILE_FRESHNESS_SKEW_MS) {
					reportBoundPort(info.port);
				}
			});
		}, RUN_FILE_POLL_MS);

		// Neither discovery source confirmed startup yet. The child is still
		// alive and both mechanisms remain active, so surface this as slow
		// progress rather than a failure — a later listen line or running.json
		// handshake still moves the same launch to ready.
		this.fallbackTimer = setTimeout(() => {
			if (confirmed || this.child !== child) return;
			this.fallbackTimer = undefined;
			const tail = output.trim();
			this.setStatus({
				state: "starting",
				message: `AO daemon is taking longer than expected to start.${tail ? ` Last output:\n${tail.slice(-2000)}` : ""}`,
			});
		}, PORT_DISCOVERY_TIMEOUT_MS);

		child.once("error", (error) => {
			stopDiscovery();
			if (this.child !== child) return;
			this.child = null;
			this.setStatus({
				state: "error",
				message: error.message,
				details: output.trim() || undefined,
				code: "spawn_failed",
			});
		});

		child.once("exit", (code, signal) => {
			stopDiscovery();
			if (this.child !== child) return;
			this.child = null;
			if (this.intentionalStop) {
				// An explicit restart() already asked for this stop; don't report it
				// as a failure (the caller drives what happens next).
				this.intentionalStop = false;
				this.setStatus({ state: "stopped" });
				return;
			}
			this.setStatus({
				state: "stopped",
				message: signal ? `AO daemon exited with signal ${signal}` : `AO daemon exited with code ${code ?? "unknown"}`,
				code: "exited",
			});
		});
	}

	/**
	 * Stop the daemon and re-run the spawn path. When this window spawned the
	 * daemon itself (the common case), signal it directly (SIGTERM its process
	 * group) rather than waiting out the passive supervisor grace period —
	 * this mirrors the desktop app's own `restartDaemon`/`stopDaemon`, which
	 * kills the child it owns outright instead of just dropping the link.
	 * When this window only attached to (and re-linked) an app-owned daemon it
	 * did not spawn, it has no process handle to signal: dropping our link is
	 * all we can do, and the daemon only actually stops if no other window's
	 * link keeps it alive — a daemon owned by a fully external process (e.g.
	 * the AO desktop app) is left alone either way, matching the "attach and
	 * never take over" default from PLANNING.md.
	 */
	async restart(): Promise<void> {
		if (!this.child && !this.supervisorLink) {
			void vscode.window.showWarningMessage(
				"AO: cannot restart — this window is attached to an externally managed daemon. Stop it via the AO desktop app or `ao stop`, then reload.",
			);
			return;
		}
		this.epoch++; // cancel any in-flight attach/spawn probe from a stale cycle
		this.intentionalStop = true;
		this.supervisorLink?.dispose();
		this.supervisorLink = null;

		const stoppingChild = this.child;
		const stoppingPort = this.current.state === "ready" ? this.current.port : undefined;
		this.setStatus({ state: "starting", message: "Restarting…" });

		if (stoppingChild) this.killChild(stoppingChild);
		await this.waitForStop(stoppingChild, stoppingPort);
		await this.refresh();
	}

	/** Signal the daemon's whole process group so the kill reaches the real daemon and any children it spawned, not just this direct handle. */
	private killChild(child: ChildProcess): void {
		if (child.pid === undefined) return;
		try {
			process.kill(-child.pid, "SIGTERM");
		} catch {
			try {
				child.kill("SIGTERM");
			} catch {
				// process already gone; proceed.
			}
		}
	}

	private waitForStop(child: ChildProcess | null, port: number | undefined): Promise<void> {
		if (child) {
			return new Promise((resolve) => {
				const timer = setTimeout(resolve, STOP_TIMEOUT_MS);
				child.once("exit", () => {
					clearTimeout(timer);
					resolve();
				});
			});
		}
		if (!port) return Promise.resolve();
		return (async () => {
			const deadline = Date.now() + STOP_TIMEOUT_MS;
			while (Date.now() < deadline) {
				if (!(await probeDaemon(port, "healthz"))) return;
				await delay(TAKEOVER_POLL_MS);
			}
		})();
	}

	dispose(): void {
		if (this.pollTimer) clearInterval(this.pollTimer);
		if (this.runFileTimer) clearInterval(this.runFileTimer);
		if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
		this.configListener.dispose();
		this.epoch++;
		// Close the supervisor link synchronously so a daemon we spawned starts
		// its self-stop grace period immediately as this window closes. Never
		// kill the child process directly — that would also kill any headless
		// worker terminals it manages instead of letting it shut down cleanly.
		this.supervisorLink?.dispose();
		this.supervisorLink = null;
		this.emitter.removeAllListeners();
	}
}
