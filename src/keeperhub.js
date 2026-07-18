const TERMINAL_STATES = new Set(["completed", "failed"]);
const SECRET_PATTERN = /\b(?:kh_|Bearer\s+)[A-Za-z0-9._-]+/gi;

export class KeeperHubError extends Error {
  constructor(message, { status, body, retryAfter } = {}) {
    super(redactSecrets(message));
    this.name = "KeeperHubError";
    this.status = status;
    this.body = redactValue(body);
    this.retryAfter = retryAfter;
  }
}

export function redactSecrets(value) {
  return String(value).replace(SECRET_PATTERN, "[REDACTED]");
}

export function redactValue(value) {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      /authorization|api.?key|token|secret/i.test(key) ? "[REDACTED]" : redactValue(entry)
    ]));
  }
  return value;
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class KeeperHubClient {
  constructor({ baseUrl = "https://app.keeperhub.com", apiKey, fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(path, { method = "GET", body, idempotencyKey, authenticated = true } = {}) {
    if (authenticated && !this.apiKey) throw new KeeperHubError("KEEPERHUB_API_KEY is required");
    const headers = { accept: "application/json" };
    if (authenticated) headers.authorization = `Bearer ${this.apiKey}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new KeeperHubError(`KeeperHub request failed: ${error.message}`);
    }

    const payload = await readBody(response);
    if (!response.ok) {
      const detail = typeof payload === "string" ? payload : payload?.error || payload?.details || response.statusText;
      throw new KeeperHubError(`KeeperHub HTTP ${response.status}: ${detail}`, {
        status: response.status,
        body: payload,
        retryAfter: response.headers.get("retry-after")
      });
    }

    return {
      data: payload,
      pollHintSeconds: Number(response.headers.get("x-poll-interval-hint"))
    };
  }

  async listChains() {
    return (await this.request("/api/chains", { authenticated: false })).data;
  }

  async simulateTransfer(intent) {
    return (await this.request("/api/execute/transfer", {
      method: "POST",
      body: {
        chainId: intent.chainId,
        recipientAddress: intent.recipientAddress,
        amount: intent.amount,
        simulate: true
      }
    })).data;
  }

  async executeTransfer(intent, idempotencyKey) {
    return (await this.request("/api/execute/transfer", {
      method: "POST",
      idempotencyKey,
      body: {
        chainId: intent.chainId,
        recipientAddress: intent.recipientAddress,
        amount: intent.amount
      }
    })).data;
  }

  async getExecution(executionId) {
    return this.request(`/api/execute/${encodeURIComponent(executionId)}/status`);
  }

  async waitForExecution(executionId, { timeoutMs = 120_000, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), onPoll } = {}) {
    const startedAt = Date.now();
    let attempt = 0;
    while (Date.now() - startedAt <= timeoutMs) {
      attempt += 1;
      const response = await this.getExecution(executionId);
      onPoll?.({ attempt, status: response.data });
      if (TERMINAL_STATES.has(response.data?.status)) return response.data;
      const hint = Number.isFinite(response.pollHintSeconds) && response.pollHintSeconds >= 0
        ? response.pollHintSeconds
        : Math.min(2 ** attempt, 8);
      await wait(Math.max(hint, 0.25) * 1000);
    }
    throw new KeeperHubError(`Execution ${executionId} did not finish within ${timeoutMs}ms`);
  }
}

export class RehearsalKeeperHubClient {
  async listChains() {
    return [{
      chainId: 11155111,
      name: "Ethereum Sepolia",
      symbol: "ETH",
      explorerUrl: "https://sepolia.etherscan.io",
      isTestnet: true,
      isEnabled: true
    }];
  }

  async simulateTransfer(intent) {
    return {
      success: true,
      status: "simulated",
      from: "rehearsal-only",
      to: intent.recipientAddress,
      value: "0",
      gasEstimate: "21000",
      simulatedReturnValue: null,
      wouldRevert: false,
      provenance: "deterministic-local-rehearsal"
    };
  }

  async executeTransfer() {
    throw new Error("Rehearsal client cannot broadcast transactions");
  }
}
