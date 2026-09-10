import test from "node:test";
import assert from "node:assert/strict";
import { withSecondaryRole } from "../dist/test/muxFrames.js"

test("terminal open frames are always secondary", () => {
  assert.deepEqual(JSON.parse(withSecondaryRole(JSON.stringify({ ch: "terminal", type: "open", id: "h", cols: 80, rows: 24 }))), { ch: "terminal", type: "open", id: "h", cols: 80, rows: 24, role: "secondary" });
});
test("non-open frames remain byte-for-byte unchanged", () => {
  const frame = '{"ch":"terminal","type":"resize","id":"h","cols":100,"rows":40}';
  assert.equal(withSecondaryRole(frame), frame);
});
