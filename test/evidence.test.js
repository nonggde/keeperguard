import test from "node:test";
import assert from "node:assert/strict";
import { canonicalize, EvidenceTrail, verifyEvidence } from "../src/evidence.js";

function artifact() {
  const trail = new EvidenceTrail({ runId: "run-1", now: () => new Date("2026-07-18T00:00:00.000Z") });
  trail.add("intent_received", { amount: "0" });
  trail.add("policy_evaluated", { approved: true });
  return trail.finalize({
    mode: "simulation",
    intent: { amount: "0" },
    chain: { chainId: 11155111 },
    policyDecision: { approved: true },
    conclusion: { state: "simulated" }
  });
}

test("canonical JSON is independent of object key order", () => {
  assert.equal(canonicalize({ b: 2, a: 1 }), canonicalize({ a: 1, b: 2 }));
});

test("canonical JSON matches JSON serialization for undefined values", () => {
  const value = { keep: true, omitted: undefined, list: [undefined, 1] };
  assert.equal(canonicalize(value), canonicalize(JSON.parse(JSON.stringify(value))));
});

test("verifies an intact evidence chain", () => {
  assert.deepEqual(verifyEvidence(artifact()), { valid: true, errors: [] });
});

test("detects event tampering", () => {
  const value = artifact();
  value.events[0].data.amount = "1";
  const result = verifyEvidence(value);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("event_1_digest"));
  assert.ok(result.errors.includes("artifact_digest"));
});

test("detects broken event ordering", () => {
  const value = artifact();
  value.events.reverse();
  assert.equal(verifyEvidence(value).valid, false);
});
