import { createHash } from "node:crypto";

export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry === undefined ? null : entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digest(value) {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

export class EvidenceTrail {
  constructor({ runId, now = () => new Date() }) {
    this.runId = runId;
    this.now = now;
    this.events = [];
  }

  add(type, data) {
    const event = {
      sequence: this.events.length + 1,
      at: this.now().toISOString(),
      type,
      data,
      previousDigest: this.events.at(-1)?.digest || null
    };
    event.digest = digest(event);
    this.events.push(event);
    return event;
  }

  finalize({ mode, intent, chain, policyDecision, conclusion }) {
    const artifact = {
      schema: "keeperguard/evidence-v1",
      project: "KeeperGuard",
      runId: this.runId,
      mode,
      createdAt: this.events[0]?.at || this.now().toISOString(),
      intent,
      chain,
      policyDecision,
      events: this.events,
      conclusion
    };
    return { ...artifact, artifactDigest: digest(artifact) };
  }
}

export function verifyEvidence(artifact) {
  const errors = [];
  let previousDigest = null;
  for (const [index, event] of (artifact?.events || []).entries()) {
    const { digest: claimedDigest, ...eventWithoutDigest } = event;
    if (event.sequence !== index + 1) errors.push(`event_${index + 1}_sequence`);
    if (event.previousDigest !== previousDigest) errors.push(`event_${index + 1}_link`);
    const actualDigest = digest(eventWithoutDigest);
    if (claimedDigest !== actualDigest) errors.push(`event_${index + 1}_digest`);
    previousDigest = claimedDigest;
  }
  const { artifactDigest, ...artifactWithoutDigest } = artifact || {};
  if (artifactDigest !== digest(artifactWithoutDigest)) errors.push("artifact_digest");
  return { valid: errors.length === 0, errors };
}
