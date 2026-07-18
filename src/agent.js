import { randomUUID } from "node:crypto";
import { EvidenceTrail, digest } from "./evidence.js";
import { evaluateIntent, normalizePolicy } from "./policy.js";

function publicChainSnapshot(chain) {
  if (!chain) return null;
  return {
    chainId: Number(chain.chainId),
    name: chain.name,
    symbol: chain.symbol,
    explorerUrl: chain.explorerUrl,
    isTestnet: Boolean(chain.isTestnet),
    isEnabled: Boolean(chain.isEnabled)
  };
}

function publicStatus(status) {
  if (!status) return null;
  return {
    executionId: status.executionId,
    status: status.status,
    type: status.type,
    sponsored: status.sponsored,
    transactionHash: status.transactionHash,
    transactionLink: status.transactionLink,
    gasUsedWei: status.gasUsedWei,
    error: status.error || null,
    createdAt: status.createdAt,
    completedAt: status.completedAt
  };
}

export async function runGuard({
  intent,
  policy: inputPolicy,
  keeperhub,
  broadcast = false,
  mode = broadcast ? "live" : "simulation",
  runId = randomUUID(),
  now,
  wait
}) {
  const policy = normalizePolicy(inputPolicy);
  const trail = new EvidenceTrail({ runId, now });
  trail.add("intent_received", intent);

  const chains = await keeperhub.listChains();
  const chain = chains.find((entry) => Number(entry.chainId) === intent.chainId);
  const chainSnapshot = publicChainSnapshot(chain);
  trail.add("chain_resolved", chainSnapshot);

  const decision = evaluateIntent(intent, policy, chain);
  trail.add("policy_evaluated", decision);
  if (!decision.approved) {
    return trail.finalize({
      mode,
      intent,
      chain: chainSnapshot,
      policyDecision: decision,
      conclusion: { state: "blocked", transactionHash: null, transactionLink: null }
    });
  }

  let simulation = null;
  if (policy.requireSimulation) {
    simulation = await keeperhub.simulateTransfer(intent);
    trail.add("keeperhub_simulated", simulation);
    if (!simulation?.success || simulation?.wouldRevert) {
      return trail.finalize({
        mode,
        intent,
        chain: chainSnapshot,
        policyDecision: decision,
        conclusion: { state: "simulation_failed", transactionHash: null, transactionLink: null }
      });
    }
  }

  if (!broadcast) {
    trail.add("broadcast_withheld", { reason: "explicit_broadcast_flag_not_set" });
    return trail.finalize({
      mode,
      intent,
      chain: chainSnapshot,
      policyDecision: decision,
      conclusion: {
        state: "simulated",
        simulation,
        executionId: null,
        transactionHash: null,
        transactionLink: null
      }
    });
  }

  const idempotencyKey = `kg-${digest({ runId, intent }).slice(0, 40)}`;
  trail.add("broadcast_authorized", { idempotencyKey });
  const submitted = await keeperhub.executeTransfer(intent, idempotencyKey);
  trail.add("keeperhub_submitted", submitted);
  if (!submitted?.executionId) throw new Error("KeeperHub response did not include executionId");

  const status = await keeperhub.waitForExecution(submitted.executionId, {
    timeoutMs: policy.pollTimeoutMs,
    wait,
    onPoll: ({ attempt, status: polled }) => trail.add("keeperhub_polled", {
      attempt,
      status: polled?.status,
      transactionHash: polled?.transactionHash || null
    })
  });
  const statusSnapshot = publicStatus(status);
  trail.add("keeperhub_reconciled", statusSnapshot);

  return trail.finalize({
    mode,
    intent,
    chain: chainSnapshot,
    policyDecision: decision,
    conclusion: {
      state: status.status,
      executionId: status.executionId || submitted.executionId,
      sponsored: status.sponsored,
      transactionHash: status.transactionHash || null,
      transactionLink: status.transactionLink || null,
      gasUsedWei: status.gasUsedWei,
      error: status.error || null
    }
  });
}

export async function resumeGuard({ keeperhub, executionId, timeoutMs = 120_000, wait }) {
  return keeperhub.waitForExecution(executionId, { timeoutMs, wait });
}
