const elements = {
  file: document.querySelector("#evidence-file"),
  mode: document.querySelector("#mode-chip"),
  title: document.querySelector("#verification-title"),
  detail: document.querySelector("#verification-detail"),
  seal: document.querySelector("#verification-seal"),
  chain: document.querySelector("#metric-chain"),
  chainId: document.querySelector("#metric-chain-id"),
  amount: document.querySelector("#metric-amount"),
  asset: document.querySelector("#metric-asset"),
  state: document.querySelector("#metric-state"),
  execution: document.querySelector("#metric-execution"),
  transaction: document.querySelector("#metric-transaction"),
  executionMeta: document.querySelector("#metric-execution-meta"),
  digest: document.querySelector("#artifact-digest"),
  copy: document.querySelector("#copy-digest"),
  decision: document.querySelector("#guard-decision"),
  checks: document.querySelector("#integrity-checks"),
  timeline: document.querySelector("#timeline"),
  count: document.querySelector("#event-count"),
  raw: document.querySelector("#raw-evidence"),
  download: document.querySelector("#download-evidence")
};

let loadedArtifact = null;

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry === undefined ? null : entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(canonicalize(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verify(artifact) {
  const errors = [];
  let previousDigest = null;
  for (const [index, event] of (artifact.events || []).entries()) {
    const { digest, ...withoutDigest } = event;
    if (event.sequence !== index + 1) errors.push("Event ordering");
    if (event.previousDigest !== previousDigest) errors.push("Hash linkage");
    if (digest !== await sha256(withoutDigest)) errors.push(`Event ${index + 1} digest`);
    previousDigest = digest;
  }
  const { artifactDigest, ...withoutArtifactDigest } = artifact;
  if (artifactDigest !== await sha256(withoutArtifactDigest)) errors.push("Artifact digest");
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function text(element, value, fallback = "--") {
  element.textContent = value === undefined || value === null || value === "" ? fallback : String(value);
}

function short(value, start = 14, end = 10) {
  if (!value || value.length <= start + end + 3) return value || "--";
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function setCheck(label, state) {
  const item = document.createElement("li");
  const name = document.createElement("span");
  const result = document.createElement("b");
  name.textContent = label;
  result.textContent = state ? "PASS" : "FAIL";
  result.className = state ? "pass" : "fail";
  item.append(name, result);
  return item;
}

function renderDefinitions(artifact) {
  const entries = [
    ["Decision", artifact.policyDecision?.approved ? "Approved" : `Blocked: ${(artifact.policyDecision?.reasons || []).join(", ")}`],
    ["Purpose", artifact.intent?.purpose],
    ["Recipient", artifact.intent?.recipientAddress],
    ["Limit", `${artifact.policyDecision?.constraints?.maxNativeAmount ?? "--"} native`]
  ];
  elements.decision.replaceChildren(...entries.map(([term, description]) => {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = description || "--";
    row.append(dt, dd);
    return row;
  }));
}

function renderTimeline(events = []) {
  elements.count.textContent = `${events.length} event${events.length === 1 ? "" : "s"}`;
  if (!events.length) {
    const empty = document.createElement("li");
    empty.className = "empty-row";
    empty.textContent = "No events loaded.";
    elements.timeline.replaceChildren(empty);
    return;
  }
  elements.timeline.replaceChildren(...events.map((event) => {
    const row = document.createElement("li");
    const index = document.createElement("span");
    const name = document.createElement("span");
    const time = document.createElement("time");
    const data = document.createElement("code");
    const hash = document.createElement("code");
    index.className = "event-index";
    name.className = "event-name";
    data.className = "event-data";
    hash.className = "event-hash";
    index.textContent = String(event.sequence).padStart(2, "0");
    name.textContent = event.type.replaceAll("_", " ");
    time.textContent = new Date(event.at).toLocaleString();
    name.append(time);
    data.textContent = JSON.stringify(event.data);
    hash.textContent = short(event.digest, 12, 12);
    row.append(index, name, data, hash);
    return row;
  }));
}

async function render(artifact) {
  loadedArtifact = artifact;
  const result = await verify(artifact);
  const state = artifact.conclusion?.state || "unknown";
  const isClaimedTransaction = Boolean(artifact.conclusion?.transactionHash && artifact.conclusion?.transactionLink);
  document.body.dataset.verification = result.valid ? "verified" : "failed";
  text(elements.mode, `${artifact.mode || "unknown"} / ${state}`.toUpperCase());
  text(elements.title, result.valid ? "Proof integrity verified" : "Proof integrity failed");
  text(elements.detail, result.valid
    ? `${artifact.events?.length || 0} linked events match artifact ${short(artifact.artifactDigest, 12, 12)}.`
    : result.errors.join(" / "));
  elements.seal.querySelector(".seal-core").textContent = result.valid ? "OK" : "!!";
  elements.seal.querySelector(".seal-label").textContent = result.valid ? "VERIFIED" : "FAILED";

  text(elements.chain, artifact.chain?.name);
  text(elements.chainId, `chain ${artifact.chain?.chainId ?? "--"}`);
  text(elements.amount, artifact.intent?.amount);
  text(elements.asset, `${artifact.chain?.symbol || "native"} / ${artifact.chain?.isTestnet ? "testnet" : "network"}`);
  text(elements.state, state.toUpperCase());
  text(elements.execution, artifact.conclusion?.executionId || "not submitted");
  const executionMeta = [];
  if (artifact.conclusion?.sponsored !== undefined) executionMeta.push(`sponsored ${artifact.conclusion.sponsored ? "yes" : "no"}`);
  const gasUsed = artifact.conclusion?.gasUsedUnits ?? artifact.conclusion?.gasUsedWei;
  if (gasUsed !== undefined) executionMeta.push(`gas ${gasUsed}`);
  text(elements.executionMeta, executionMeta.join(" / "), "execution metadata --");
  elements.transaction.removeAttribute("href");
  elements.transaction.textContent = "Not available";
  if (isClaimedTransaction && /^https:\/\//.test(artifact.conclusion.transactionLink)) {
    elements.transaction.href = artifact.conclusion.transactionLink;
    elements.transaction.textContent = short(artifact.conclusion.transactionHash, 12, 10);
  }

  text(elements.digest, artifact.artifactDigest);
  elements.copy.disabled = !artifact.artifactDigest;
  elements.download.disabled = false;
  renderDefinitions(artifact);
  elements.checks.replaceChildren(
    setCheck("Artifact digest", !result.errors.includes("Artifact digest")),
    setCheck("Event ordering", !result.errors.includes("Event ordering")),
    setCheck("Hash linkage", !result.errors.includes("Hash linkage")),
    setCheck("Transaction claim", state === "simulated" ? !artifact.conclusion?.transactionHash : isClaimedTransaction)
  );
  renderTimeline(artifact.events);
  elements.raw.textContent = JSON.stringify(artifact, null, 2);
}

async function loadUrl(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await render(await response.json());
}

elements.file.addEventListener("change", async () => {
  const [file] = elements.file.files;
  if (!file) return;
  try {
    await render(JSON.parse(await file.text()));
  } catch (error) {
    document.body.dataset.verification = "failed";
    text(elements.title, "Evidence could not be read");
    text(elements.detail, error.message);
  }
});

elements.copy.addEventListener("click", async () => {
  if (!loadedArtifact?.artifactDigest) return;
  await navigator.clipboard.writeText(loadedArtifact.artifactDigest);
  elements.copy.textContent = "Copied";
  setTimeout(() => { elements.copy.textContent = "Copy digest"; }, 1200);
});

elements.download.addEventListener("click", () => {
  if (!loadedArtifact) return;
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(loadedArtifact, null, 2)}\n`], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `keeperguard-${loadedArtifact.runId || "evidence"}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

const requestedEvidence = new URLSearchParams(location.search).get("evidence");
loadUrl(requestedEvidence || "./evidence/latest.json").catch(() => {});
