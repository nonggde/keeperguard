import test from "node:test";
import assert from "node:assert/strict";
import { KeeperHubClient, KeeperHubError, redactValue } from "../src/keeperhub.js";

test("loads public chains without sending authorization", async () => {
  const client = new KeeperHubClient({
    apiKey: "kh_secret",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://app.keeperhub.com/api/chains");
      assert.equal(options.headers.authorization, undefined);
      return new Response(JSON.stringify([{ chainId: 11155111 }]), { status: 200 });
    }
  });
  assert.deepEqual(await client.listChains(), [{ chainId: 11155111 }]);
});

test("simulation uses canonical chainId and strict boolean flag", async () => {
  const client = new KeeperHubClient({
    apiKey: "kh_secret",
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.authorization, "Bearer kh_secret");
      assert.deepEqual(JSON.parse(options.body), {
        chainId: 11155111,
        recipientAddress: "0x1111111111111111111111111111111111111111",
        amount: "0",
        simulate: true
      });
      return new Response(JSON.stringify({ success: true, status: "simulated" }), { status: 200 });
    }
  });
  assert.equal((await client.simulateTransfer({
    chainId: 11155111,
    recipientAddress: "0x1111111111111111111111111111111111111111",
    amount: "0"
  })).status, "simulated");
});

test("broadcast attaches the caller idempotency key", async () => {
  const client = new KeeperHubClient({
    apiKey: "kh_secret",
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers["idempotency-key"], "kg-key");
      return new Response(JSON.stringify({ executionId: "direct-1" }), { status: 202 });
    }
  });
  assert.equal((await client.executeTransfer({ chainId: 11155111, recipientAddress: "0x1111111111111111111111111111111111111111", amount: "0" }, "kg-key")).executionId, "direct-1");
});

test("errors and nested payloads redact credentials", async () => {
  const client = new KeeperHubClient({
    apiKey: "kh_topsecret",
    fetchImpl: async () => new Response(JSON.stringify({ error: "bad Bearer kh_leaked", apiKey: "kh_nested" }), { status: 401 })
  });
  await assert.rejects(client.simulateTransfer({}), (error) => {
    assert.ok(error instanceof KeeperHubError);
    assert.doesNotMatch(error.message, /kh_/);
    assert.equal(error.body.apiKey, "[REDACTED]");
    return true;
  });
  assert.deepEqual(redactValue({ token: "abc", note: "Bearer kh_value" }), { token: "[REDACTED]", note: "[REDACTED]" });
});

test("polling honors the server hint and stops at a terminal state", async () => {
  const client = new KeeperHubClient({ apiKey: "kh_secret" });
  let calls = 0;
  const waits = [];
  client.getExecution = async () => {
    calls += 1;
    return calls === 1
      ? { data: { status: "running" }, pollHintSeconds: 3 }
      : { data: { status: "completed", executionId: "direct-1" }, pollHintSeconds: 0 };
  };
  const result = await client.waitForExecution("direct-1", { wait: async (ms) => waits.push(ms) });
  assert.equal(result.status, "completed");
  assert.deepEqual(waits, [3000]);
});
