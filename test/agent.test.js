import test from "node:test";
import assert from "node:assert/strict";
import { appendStatusConfirmation, runGuard } from "../src/agent.js";
import { verifyEvidence } from "../src/evidence.js";

const intent = {
  chainId: 11155111,
  recipientAddress: "0x1111111111111111111111111111111111111111",
  amount: "0",
  purpose: "zero-value execution proof"
};
const chain = {
  chainId: 11155111,
  name: "Ethereum Sepolia",
  symbol: "ETH",
  explorerUrl: "https://sepolia.etherscan.io",
  isTestnet: true,
  isEnabled: true
};
const policy = {
  allowedChainIds: [11155111],
  allowMainnet: false,
  maxNativeAmount: "0",
  requirePurpose: true,
  requireSimulation: true,
  pollTimeoutMs: 1000
};

test("blocks an unsafe intent before simulation", async () => {
  let simulated = false;
  const artifact = await runGuard({
    intent: { ...intent, amount: "0.0001" },
    policy,
    keeperhub: {
      listChains: async () => [chain],
      simulateTransfer: async () => { simulated = true; }
    },
    runId: "blocked-run"
  });
  assert.equal(artifact.conclusion.state, "blocked");
  assert.equal(simulated, false);
  assert.deepEqual(artifact.policyDecision.reasons, ["amount_exceeds_limit"]);
});

test("simulation mode never invents an execution or transaction hash", async () => {
  let broadcast = false;
  const artifact = await runGuard({
    intent,
    policy,
    keeperhub: {
      listChains: async () => [chain],
      simulateTransfer: async () => ({ success: true, status: "simulated", wouldRevert: false, gasEstimate: "21000" }),
      executeTransfer: async () => { broadcast = true; }
    },
    runId: "simulation-run"
  });
  assert.equal(artifact.conclusion.state, "simulated");
  assert.equal(artifact.conclusion.executionId, null);
  assert.equal(artifact.conclusion.transactionHash, null);
  assert.equal(broadcast, false);
  assert.equal(verifyEvidence(artifact).valid, true);
});

test("broadcast mode simulates, executes once, then reconciles proof", async () => {
  let submittedKey;
  let submittedIntent;
  const artifact = await runGuard({
    intent,
    policy,
    broadcast: true,
    keeperhub: {
      listChains: async () => [chain],
      simulateTransfer: async () => ({ success: true, status: "simulated", wouldRevert: false }),
      executeTransfer: async (value, key) => {
        submittedIntent = value;
        submittedKey = key;
        return { executionId: "direct-1", status: "completed" };
      },
      waitForExecution: async (id, { onPoll }) => {
        onPoll({ attempt: 1, status: { status: "completed", transactionHash: "0xabc" } });
        return {
          executionId: id,
          status: "completed",
          result: {
            sponsored: true,
            transactionHash: "0xabc",
            transactionLink: "https://sepolia.etherscan.io/tx/0xabc",
            gasUsedUnits: "80521",
            effectiveGasPrice: "1092643469"
          }
        };
      }
    },
    runId: "live-run"
  });
  assert.deepEqual(submittedIntent, intent);
  assert.match(submittedKey, /^kg-[a-f0-9]{40}$/);
  assert.equal(artifact.conclusion.state, "completed");
  assert.equal(artifact.conclusion.sponsored, true);
  assert.equal(artifact.conclusion.transactionHash, "0xabc");
  assert.equal(artifact.conclusion.gasUsedUnits, "80521");
  assert.equal(artifact.conclusion.gasPriceWei, "1092643469");
  assert.equal(verifyEvidence(artifact).valid, true);
});

test("appends a canonical status confirmation without rewriting prior events", async () => {
  const original = await runGuard({
    intent,
    policy,
    broadcast: true,
    keeperhub: {
      listChains: async () => [chain],
      simulateTransfer: async () => ({ success: true, wouldRevert: false }),
      executeTransfer: async () => ({ executionId: "direct-refresh", status: "completed" }),
      waitForExecution: async () => ({
        executionId: "direct-refresh",
        status: "completed",
        transactionHash: "0xdef",
        transactionLink: "https://sepolia.etherscan.io/tx/0xdef"
      })
    },
    runId: "refresh-run"
  });
  const originalEvents = structuredClone(original.events);
  const refreshed = appendStatusConfirmation({
    artifact: original,
    status: {
      executionId: "direct-refresh",
      status: "completed",
      result: {
        sponsored: true,
        transactionHash: "0xdef",
        transactionLink: "https://sepolia.etherscan.io/tx/0xdef",
        gasUsedUnits: "80521"
      }
    },
    now: () => new Date("2026-07-19T00:00:00.000Z")
  });
  assert.deepEqual(refreshed.events.slice(0, -1), originalEvents);
  assert.equal(refreshed.events.at(-1).type, "keeperhub_status_confirmed");
  assert.equal(refreshed.conclusion.sponsored, true);
  assert.equal(refreshed.conclusion.gasUsedUnits, "80521");
  assert.notEqual(refreshed.artifactDigest, original.artifactDigest);
  assert.equal(verifyEvidence(refreshed).valid, true);
});

test("a reverting simulation prevents broadcast", async () => {
  let broadcast = false;
  const artifact = await runGuard({
    intent,
    policy,
    keeperhub: {
      listChains: async () => [chain],
      simulateTransfer: async () => ({ success: false, status: "simulated", wouldRevert: true }),
      executeTransfer: async () => { broadcast = true; }
    },
    broadcast: true,
    runId: "revert-run"
  });
  assert.equal(artifact.conclusion.state, "simulation_failed");
  assert.equal(broadcast, false);
});
