// Resolves how to spawn the `ao` daemon binary for this extension.
//
// The release build supplies a platform runtime under resources/<platform>-<arch>.
// Users can still override it with ao.daemon.executablePath, or attach to an
// already-running desktop-app daemon. A network download is deliberately not
// attempted: upstream publishes installers, not a standalone daemon asset.
//
// What IS reliable without network access: a user who already has the AO
// desktop app installed already has this exact binary on disk, bundled at
// `<install dir>/resources/daemon/ao[.exe]` (see the Electron app's own
// `daemon-launch.ts`: `resolveDaemonLaunch`'s "bundled" case). Auto-detecting
// the desktop app's default per-platform install location removes the manual
// `ao.daemon.executablePath` step for that common case — someone adopting
// this extension because they already use the desktop app — while degrading
// safely (falls through to requiring manual configuration, exactly like
// today) for anyone who installed elsewhere, hasn't installed it at all, or
// is on a platform/layout this guesses wrong for. It can only help, never
// regress, the zero-config experience.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DaemonLaunchSpec {
	command: string;
	args: string[];
	cwd: string;
}

function bundledDaemonExecutable(extensionPath: string, platform: NodeJS.Platform, architecture: string): string | undefined {
	const name = platform === "win32" ? "ao.exe" : "ao";
	const candidate = join(extensionPath, "resources", `${platform}-${architecture}`, name);
	return existsSync(candidate) ? candidate : undefined;
}

export function bundledTmuxExecutable(extensionPath: string, platform: NodeJS.Platform = process.platform, architecture: string = process.arch): string | undefined {
	const name = platform === "win32" ? "tmux.exe" : "tmux";
	const candidate = join(extensionPath, "resources", `${platform}-${architecture}`, name);
	return existsSync(candidate) ? candidate : undefined;
}

export function resolveDaemonLaunch(
	configuredExecutablePath: string | undefined,
	homeDir: string,
	extensionPath?: string,
	platform: NodeJS.Platform = process.platform,
	architecture: string = process.arch,
): DaemonLaunchSpec | null {
	const command = configuredExecutablePath?.trim() ||
		(extensionPath ? bundledDaemonExecutable(extensionPath, platform, architecture) : undefined) ||
		findDesktopDaemonExecutable(platform, homeDir);
	if (!command) return null;
	return {
		command,
		args: ["daemon"],
		cwd: join(homeDir, ".ao"),
	};
}

/**
 * Well-known default install locations for the AO desktop app's bundled
 * daemon binary, one per platform convention actually traced from the
 * vendored Electron app's packaging config
 * (`vendor/agent-orchestrator/frontend/forge.config.ts` + `makers/maker-nsis.ts`):
 *   - packagerConfig.name / NSIS productName: "Agent Orchestrator"
 *   - packagerConfig.executableName: "agent-orchestrator" (also the deb/rpm
 *     package name, via `bin: EXECUTABLE_NAME` in the deb maker's options)
 *   - Windows: MakerNSIS sets `perMachine: false` with no custom
 *     `installLocation`, so a user who accepted the installer's default
 *     lands at electron-builder's own per-user NSIS default,
 *     `%LOCALAPPDATA%\Programs\<productName>`. `allowToChangeInstallationDirectory`
 *     is also true, so this is a best guess, not a guarantee — a custom
 *     install location falls through to requiring manual configuration,
 *     same as before this existed.
 *   - macOS: electron-packager names the bundle `<name>.app`, dropped by
 *     convention into `/Applications` (or `~/Applications` for a per-user
 *     drag-install).
 *   - Linux: `@electron-forge/maker-deb`/`-rpm`'s default install prefix for
 *     a slugified package name is `/opt/<name>/`. AppImage is deliberately
 *     not covered — it is a self-contained portable file with no fixed
 *     install location to guess.
 *
 * Verified against the vendored source for the Windows path; the macOS/Linux
 * entries follow documented electron-packager/-forge conventions but were
 * not tested against a real install (no macOS/Linux machine was available
 * while writing this) — treat them as reasonable defaults, not guarantees.
 */
function defaultDesktopInstallCandidates(platform: NodeJS.Platform, homeDir: string, env: NodeJS.ProcessEnv): string[] {
	switch (platform) {
		case "win32": {
			const localAppData = env.LOCALAPPDATA ?? join(homeDir, "AppData", "Local");
			return [join(localAppData, "Programs", "Agent Orchestrator", "resources", "daemon", "ao.exe")];
		}
		case "darwin":
			return [
				join("/Applications", "Agent Orchestrator.app", "Contents", "Resources", "daemon", "ao"),
				join(homeDir, "Applications", "Agent Orchestrator.app", "Contents", "Resources", "daemon", "ao"),
			];
		case "linux":
			return [join("/opt", "agent-orchestrator", "resources", "daemon", "ao")];
		default:
			return [];
	}
}

/**
 * The first existing daemon binary among the desktop app's default install
 * locations for this platform, or undefined if none of them exist. Pure
 * filesystem probing — never a network call.
 */
export function findDesktopDaemonExecutable(
	platform: NodeJS.Platform = process.platform,
	homeDir: string = homedir(),
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	return defaultDesktopInstallCandidates(platform, homeDir, env).find((candidate) => existsSync(candidate));
}
