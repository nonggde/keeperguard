import test from "node:test";
import assert from "node:assert/strict";
import { evaluateIntent, parseDecimalUnits } from "../src/policy.js";

const baseIntent = {
  chainId: 11155111,
  recipientAddress: "0x1111111111111111111111111111111111111111",
  amount: "0",
  purpose: "proof"
};
const testnet = { chainId: 11155111, isTestnet: true, isEnabled: true };
const policy = { allowedChainIds: [11155111], maxNativeAmount: "0", allowMainnet: false, requirePurpose: true };

test("parses decimal amounts without floating point", () => {
  assert.equal(parseDecimalUnits("1.000000000000000001"), 1_000_000_000_000_000_001n);
});

test("rejects exponent notation and over-precision", () => {
  assert.throws(() => parseDecimalUnits("1e-3"));
  assert.throws(() => parseDecimalUnits("0.0000000000000000001"));
});

test("approves a zero-value testnet intent", () => {
  assert.deepEqual(evaluateIntent(baseIntent, policy, testnet).reasons, []);
});

test("forbids mainnet even when the numeric chain is allowlisted", () => {
  const result = evaluateIntent(
    { ...baseIntent, chainId: 1 },
    { ...policy, allowedChainIds: [1] },
    { chainId: 1, isTestnet: false, isEnabled: true }
  );
  assert.deepEqual(result.reasons, ["mainnet_forbidden"]);
});

test("enforces recipient allowlists case-insensitively", () => {
  const allowed = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
  const result = evaluateIntent(
    { ...baseIntent, recipientAddress: allowed.toLowerCase() },
    { ...policy, recipientAllowlist: [allowed] },
    testnet
  );
  assert.equal(result.approved, true);
});

test("reports disabled or missing chain metadata", () => {
  assert.deepEqual(evaluateIntent(baseIntent, policy, null).reasons, ["chain_metadata_unavailable"]);
  assert.deepEqual(evaluateIntent(baseIntent, policy, { ...testnet, isEnabled: false }).reasons, ["chain_disabled"]);
});
