import test from "node:test";
import assert from "node:assert/strict";
import { SseParser } from "../dist/test/sseParser.js";

test("SSE parser retains IDs across chunk boundaries", () => {
  const parser = new SseParser();
  assert.deepEqual(parser.push("id: 7\nevent: session_"), []);
  assert.deepEqual(parser.push("updated\ndata: {\"id\":\"s1\"}\n\n"), [{ event: "session_updated", data: '{"id":"s1"}', id: "7" }]);
  assert.equal(parser.lastEventId, "7");
});

test("SSE parser joins multiline data and ignores comments", () => {
  const parser = new SseParser();
  assert.deepEqual(parser.push(": heartbeat\r\nevent: x\r\ndata: a\r\ndata: b\r\n\r\n"), [{ event: "x", data: "a\nb", id: undefined }]);
});
