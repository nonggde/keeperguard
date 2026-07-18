const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;

export const DEFAULT_POLICY = Object.freeze({
  allowedChainIds: [11155111, 84532],
  allowMainnet: false,
  maxNativeAmount: "0",
  recipientAllowlist: [],
  requirePurpose: true,
  requireSimulation: true,
  pollTimeoutMs: 120_000
});

export function parseDecimalUnits(value, decimals = 18) {
  if (typeof value !== "string") throw new TypeError("amount must be a string");
  const match = value.match(DECIMAL);
  if (!match) throw new TypeError("amount must be a plain non-negative decimal string");
  const fraction = match[1] || "";
  if (fraction.length > decimals) throw new RangeError(`amount supports at most ${decimals} decimals`);
  const [whole] = value.split(".");
  return BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

function normalizeAddress(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function normalizePolicy(input = {}) {
  return {
    ...DEFAULT_POLICY,
    ...input,
    allowedChainIds: [...(input.allowedChainIds || DEFAULT_POLICY.allowedChainIds)].map(Number),
    recipientAllowlist: [...(input.recipientAllowlist || [])].map(normalizeAddress)
  };
}

export function evaluateIntent(intent, inputPolicy, chain) {
  const policy = normalizePolicy(inputPolicy);
  const reasons = [];

  if (!Number.isSafeInteger(intent?.chainId)) reasons.push("invalid_chain_id");
  if (!policy.allowedChainIds.includes(intent?.chainId)) reasons.push("chain_not_allowed");
  if (!EVM_ADDRESS.test(intent?.recipientAddress || "")) reasons.push("invalid_recipient");
  if (policy.requirePurpose && !(typeof intent?.purpose === "string" && intent.purpose.trim())) {
    reasons.push("purpose_required");
  }

  let amountUnits;
  let maxUnits;
  try {
    amountUnits = parseDecimalUnits(intent?.amount);
  } catch {
    reasons.push("invalid_amount");
  }
  try {
    maxUnits = parseDecimalUnits(policy.maxNativeAmount);
  } catch {
    reasons.push("invalid_policy_limit");
  }
  if (amountUnits !== undefined && maxUnits !== undefined && amountUnits > maxUnits) {
    reasons.push("amount_exceeds_limit");
  }

  if (policy.recipientAllowlist.length > 0 && EVM_ADDRESS.test(intent?.recipientAddress || "")) {
    if (!policy.recipientAllowlist.includes(normalizeAddress(intent.recipientAddress))) {
      reasons.push("recipient_not_allowlisted");
    }
  }

  if (!chain) {
    reasons.push("chain_metadata_unavailable");
  } else {
    if (Number(chain.chainId) !== intent?.chainId) reasons.push("chain_metadata_mismatch");
    if (!chain.isEnabled) reasons.push("chain_disabled");
    if (!policy.allowMainnet && !chain.isTestnet) reasons.push("mainnet_forbidden");
  }

  return {
    approved: reasons.length === 0,
    reasons,
    constraints: {
      allowedChainIds: policy.allowedChainIds,
      allowMainnet: policy.allowMainnet,
      maxNativeAmount: policy.maxNativeAmount,
      recipientAllowlist: policy.recipientAllowlist,
      requirePurpose: policy.requirePurpose,
      requireSimulation: policy.requireSimulation
    }
  };
}
