import test from "node:test";
import assert from "node:assert/strict";
import { attentionLane, sortAttentionSessions } from "../dist/test/sessionPresentation.js";
const base = (id, kanbanColumn, status = "working", updatedAt = "2026-01-01T00:00:00Z") => ({ id, kanbanColumn, status, updatedAt, isTerminated: false });
test("board attention path puts human action first", () => {
  assert.equal(attentionLane(base("a", "needs_review", "ci_failed")), "needs_review");
  assert.deepEqual(sortAttentionSessions([base("r", "ready"), base("n", "needs_review"), base("w", "building")]).map((s) => s.id), ["n", "w", "r"]);
});
