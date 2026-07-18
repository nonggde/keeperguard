import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { appendStatusConfirmation, runGuard, resumeGuard } from "./agent.js";
import { verifyEvidence } from "./evidence.js";
import { KeeperHubClient, RehearsalKeeperHubClient } from "./keeperhub.js";

const command = process.argv[2] || "help";
const argumentsAfterCommand = process.argv.slice(3);

function options(definitions = {}) {
  return parseArgs({ args: argumentsAfterCommand, options: definitions, allowPositionals: true, strict: true });
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(path.resolve(file), "utf8"));
}

async function loadPolicy(file = process.env.KEEPERGUARD_POLICY || "keeperguard.config.json") {
  return readJson(file);
}

async function writeEvidence(artifact, directory = process.env.KEEPERGUARD_EVIDENCE_DIR || "artifacts") {
  await fs.mkdir(directory, { recursive: true });
  const filename = `evidence-${artifact.runId}.json`;
  const output = path.resolve(directory, filename);
  const temporary = `${output}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`);
  await fs.rename(temporary, output);
  return output;
}

function clientFromEnvironment() {
  return new KeeperHubClient({
    baseUrl: process.env.KEEPERHUB_API_URL,
    apiKey: process.env.KEEPERHUB_API_KEY
  });
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function runDemo() {
  const intent = await readJson("fixtures/zero-value-transfer.json");
  const policy = await loadPolicy();
  const artifact = await runGuard({
    intent,
    policy,
    keeperhub: new RehearsalKeeperHubClient(),
    mode: "rehearsal",
    broadcast: false
  });
  const evidence = await writeEvidence(artifact);
  print({ mode: artifact.mode, state: artifact.conclusion.state, evidence, verified: verifyEvidence(artifact).valid });
}

async function runDoctor() {
  const client = clientFromEnvironment();
  const chains = await client.listChains();
  const policy = await loadPolicy();
  const allowed = chains.filter((chain) => policy.allowedChainIds.includes(Number(chain.chainId)));
  print({
    api: client.baseUrl,
    apiReachable: true,
    apiKeyConfigured: Boolean(process.env.KEEPERHUB_API_KEY),
    policyFile: path.resolve(process.env.KEEPERGUARD_POLICY || "keeperguard.config.json"),
    allowedChains: allowed.map((chain) => ({ chainId: chain.chainId, name: chain.name, isTestnet: chain.isTestnet, isEnabled: chain.isEnabled }))
  });
}

async function runIntent() {
  const parsed = options({
    intent: { type: "string", short: "i" },
    policy: { type: "string", short: "p" },
    broadcast: { type: "boolean", default: false }
  });
  if (!parsed.values.intent) throw new Error("--intent <file> is required");
  const intent = await readJson(parsed.values.intent);
  const policy = await loadPolicy(parsed.values.policy);
  const artifact = await runGuard({
    intent,
    policy,
    keeperhub: clientFromEnvironment(),
    broadcast: parsed.values.broadcast
  });
  const evidence = await writeEvidence(artifact);
  print({ state: artifact.conclusion.state, executionId: artifact.conclusion.executionId, transactionLink: artifact.conclusion.transactionLink, evidence });
}

async function runResume() {
  const parsed = options({ timeout: { type: "string", default: "120000" } });
  const executionId = parsed.positionals[0];
  if (!executionId) throw new Error("resume requires an execution ID");
  print(await resumeGuard({ keeperhub: clientFromEnvironment(), executionId, timeoutMs: Number(parsed.values.timeout) }));
}

async function runRefresh() {
  const parsed = options({ timeout: { type: "string", default: "120000" } });
  const file = parsed.positionals[0];
  if (!file) throw new Error("refresh requires an evidence file");
  const artifact = await readJson(file);
  const executionId = artifact.conclusion?.executionId;
  if (!executionId) throw new Error("evidence does not contain an execution ID");
  const status = await resumeGuard({ keeperhub: clientFromEnvironment(), executionId, timeoutMs: Number(parsed.values.timeout) });
  const refreshed = appendStatusConfirmation({ artifact, status });
  const evidence = await writeEvidence(refreshed);
  print({ state: refreshed.conclusion.state, executionId, sponsored: refreshed.conclusion.sponsored, transactionLink: refreshed.conclusion.transactionLink, evidence, artifactDigest: refreshed.artifactDigest });
}

async function runVerify() {
  const parsed = options();
  const file = parsed.positionals[0];
  if (!file) throw new Error("verify requires an evidence file");
  const result = verifyEvidence(await readJson(file));
  print(result);
  if (!result.valid) process.exitCode = 1;
}

async function runStage() {
  const parsed = options();
  const file = parsed.positionals[0];
  if (!file) throw new Error("stage requires an evidence file");
  const artifact = await readJson(file);
  const result = verifyEvidence(artifact);
  if (!result.valid) throw new Error(`Evidence verification failed: ${result.errors.join(", ")}`);
  const directory = path.resolve("web", "evidence");
  const output = path.join(directory, "latest.json");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`);
  print({ staged: output, mode: artifact.mode, state: artifact.conclusion?.state, artifactDigest: artifact.artifactDigest });
}

function showHelp() {
  process.stdout.write(`KeeperGuard\n\nCommands:\n  demo\n  doctor\n  run --intent <file> [--policy <file>] [--broadcast]\n  resume <executionId> [--timeout <ms>]\n  refresh <evidence.json> [--timeout <ms>]\n  verify <evidence.json>\n  stage <evidence.json>\n  serve\n`);
}

try {
  if (command === "demo") await runDemo();
  else if (command === "doctor") await runDoctor();
  else if (command === "run") await runIntent();
  else if (command === "resume") await runResume();
  else if (command === "refresh") await runRefresh();
  else if (command === "verify") await runVerify();
  else if (command === "stage") await runStage();
  else if (command === "help" || command === "--help" || command === "-h") showHelp();
  else if (command === "serve") await import("./server.js");
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  process.stderr.write(`${error.name || "Error"}: ${error.message}\n`);
  if (error.body) process.stderr.write(`${JSON.stringify(error.body)}\n`);
  process.exitCode = 1;
}
