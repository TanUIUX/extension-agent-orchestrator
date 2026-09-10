// Mirrors `DaemonStatus` from the vendored
// `vendor/agent-orchestrator/frontend/src/shared/daemon-status.ts` and the
// `Info` struct from `vendor/agent-orchestrator/backend/internal/runfile/runfile.go`.
// Keep these in sync manually until scripts/api:generate covers non-OpenAPI
// shared types too — they are small and change rarely upstream.

export type DaemonState = "starting" | "ready" | "stopped" | "error";

export type DaemonStatusCode =
	| "not_configured"
	| "binary_missing"
	| "spawn_failed"
	| "exited"
	| "not_ready"
	| "daemon_unreachable";

export type DaemonStatus =
	| { state: "ready"; port: number; pid?: number; executablePath?: string; workingDirectory?: string }
	| { state: "starting"; message?: string }
	| { state: "stopped"; message?: string; code?: DaemonStatusCode }
	| {
			state: "error";
			message: string;
			port?: number;
			pid?: number;
			executablePath?: string;
			workingDirectory?: string;
			code?: DaemonStatusCode;
			details?: string;
	  };

/** `~/.ao/running.json` contents, written atomically by the daemon on bind. */
export interface RunFileInfo {
	pid: number;
	port: number;
	startedAt: string;
	owner?: "app" | "persistent" | "";
	appRunId?: string;
	browserRuntimeAddress?: string;
}

export interface DaemonHealthProbe {
	status: string;
	service: string;
	pid: number;
	executablePath?: string;
	workingDirectory?: string;
	startupWorkingDirectory?: string;
	appImagePath?: string;
}
