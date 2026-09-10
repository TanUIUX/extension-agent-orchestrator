import { readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
const root = new URL("..", import.meta.url).pathname;
const dir = join(root, "dist", "webview");
const files = await readdir(dir);
let totalGzip = 0;
for (const file of files) {
	if (!file.endsWith(".js")) continue;
	const source = await (await import("node:fs/promises")).readFile(join(dir, file));
	const gzipped = gzipSync(source).byteLength;
	console.log(`${file}: ${gzipped} bytes gzip`);
	if (file === "board.js" && gzipped > 250_000) throw new Error(`Board bundle exceeds 250 KB: ${gzipped}`);
	totalGzip += gzipped;
}
if (totalGzip > 500_000) throw new Error(`Webview payload exceeds 500 KB gzip: ${totalGzip}`);
console.log(`Webview JavaScript payload: ${totalGzip} bytes gzip`);
