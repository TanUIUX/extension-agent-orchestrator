#!/usr/bin/env node
import { build } from "esbuild";
import { mkdir, rm, stat, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const outDir = join(root, "dist", "webview");
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const entries = ["board", "worker", "newTask"];
for (const entry of entries) {
	await build({
		entryPoints: [`webview/${entry}/main.tsx`],
		bundle: true,
		format: "iife",
		platform: "browser",
		target: "es2022",
		jsx: "automatic",
		minify: true,
		outfile: join(outDir, `${entry}.js`),
		define: { "process.env.NODE_ENV": '"production"' },
		logLevel: "warning",
	});
}
await BunlessIndex();

async function BunlessIndex() {
	await BunlessWrite("index.html", `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent Orchestrator</title><link rel="stylesheet" href="__ENTRY_CSS__"></head><body><meta name="ao-session-id" content="__SESSION_ID__"><main id="root"></main><script src="__ENTRY_JS__"></script></body></html>`);
}
async function BunlessWrite(name, content) {
	await (await import("node:fs/promises")).writeFile(join(outDir, name), content);
}

const files = await readdir(outDir);
let total = 0;
for (const file of files) {
	const bytes = (await stat(join(outDir, file))).size;
	total += bytes;
	console.log(`${file}: ${bytes} bytes`);
}
console.log(`webview total: ${total} bytes`);
