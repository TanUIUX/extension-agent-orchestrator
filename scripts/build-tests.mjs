import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const outDir = join(root, "dist", "test");
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await build({
	entryPoints: ["src/proxy/sseParser.ts", "src/proxy/muxFrames.ts", "src/daemon/sessionPresentation.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node20",
	outdir: outDir,
	entryNames: "[name]",
	logLevel: "warning",
});
