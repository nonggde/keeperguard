# KeeperGuard DoraHacks Submission Draft

Status: Pre-registered. Submission opens on 2026-07-27 and closes on 2026-08-13.

## Core Fields

**Project name**

KeeperGuard

**Tagline**

Policy before execution. Verifiable proof after execution.

**One-line description**

KeeperGuard is a safe-execution starter for agents using KeeperHub: it policy-checks an intent, simulates it, broadcasts idempotently, reconciles the final transaction, and emits a tamper-evident proof bundle.

**Target awards**

- KeeperHub Agents Onchain main prize
- Best Onboarding UX Improvement

## Submission Description

Agents can decide what to do, but a production agent also needs to prove that it did the right thing exactly once. KeeperGuard places a small, inspectable safety and evidence layer around KeeperHub's Direct Execution API.

Before a write reaches KeeperHub, KeeperGuard resolves the live chain registry and enforces a local policy over chain, value, recipient, and purpose. The default configuration only allows Ethereum Sepolia and Base Sepolia, forbids mainnet, and caps native value at zero. It then asks KeeperHub to simulate the exact intent. A reverting or policy-violating request fails closed before broadcast.

For an approved write, KeeperGuard supplies an idempotency key, records the returned execution ID, and polls the canonical status endpoint using KeeperHub's `X-Poll-Interval-Hint`. The final transaction hash, explorer link, sponsorship state, and execution metadata are written to a portable evidence bundle. Each event includes the previous event's SHA-256 digest, and the complete artifact has a final digest. The bundled browser console independently verifies the chain with Web Crypto before displaying a green proof seal.

Rehearsal mode is deliberately honest: it can teach the flow without credentials, but it never fabricates an execution ID or transaction hash. A real onchain claim appears only after KeeperHub reconciliation returns a real transaction.

## KeeperHub Integration

- `GET /api/chains` for live chain metadata and testnet enforcement
- `POST /api/execute/transfer` with `simulate: true` for preflight
- `POST /api/execute/transfer` with an `Idempotency-Key` for the real write
- `GET /api/execute/{executionId}/status` for final reconciliation
- Turnkey gas sponsorship when enabled by KeeperHub
- KeeperHub transaction hash and explorer link as the authoritative proof

## Reliability and Safety

- Exact integer decimal parsing; no floating-point amount comparison
- Mainnet forbidden by default
- Native value capped at zero by default
- Optional recipient allowlist
- Required purpose string
- Simulation required before broadcast
- Explicit broadcast flag
- Stable idempotency key for retry safety
- Server-directed polling interval
- Interrupted-execution resume command
- API-key redaction in errors and artifacts
- Event hash chain plus artifact digest
- Browser-side independent verification

## Onboarding Contribution

KeeperGuard provides a dependency-light path from local rehearsal to a verified first transaction. It also produced an upstream KeeperHub documentation contribution that adds a safe first-write sequence, aligns examples with canonical `chainId`, documents the HTTP 202 response, and corrects the gas-estimate unit.

Upstream PR: https://github.com/KeeperHub/keeperhub/pull/1788

## Public Links

- Repository: https://github.com/nonggde/keeperguard
- Evidence console: https://keeperguard-proof.a13553776411.workers.dev
- Upstream onboarding PR: https://github.com/KeeperHub/keeperhub/pull/1788
- Demo video: `PENDING_UNLISTED_VIDEO_URL`
- KeeperHub transaction: `PENDING_KEEPERHUB_TRANSACTION_URL`

## Reviewer Runbook

```bash
npm install
npm run demo
npm test
npm run serve
```

The rehearsal generates a proof without making an onchain claim. To verify the submitted live artifact, open the public evidence console or run:

```bash
node src/cli.js verify web/evidence/latest.json
```

## 90-Second Demo Script

**0:00-0:12 - Problem**

Show a transaction intent and state: an agent should not receive unlimited signing authority, and an execution ID alone is not reviewer-grade proof.

**0:12-0:30 - Fail closed**

Run an intent with a positive amount under the default zero-value policy. Show `amount_exceeds_limit` and confirm that no KeeperHub simulation or broadcast occurred.

**0:30-0:48 - Safe preflight**

Run the zero-value testnet intent without `--broadcast`. Show the live chain lookup, KeeperHub simulation, gas estimate, and `broadcast_withheld` event. Point out that rehearsal/simulation mode has no transaction hash.

**0:48-1:08 - Real KeeperHub execution**

Run the same intent with `--broadcast`. Show the idempotency key, KeeperHub execution ID, status polling, `sponsored: true`, and final transaction link. Open the transaction in the explorer.

**1:08-1:24 - Independent proof**

Open the evidence console. Show the verified seal, zero value moved, execution ID, transaction link, four integrity checks, and linked audit sequence.

**1:24-1:30 - Onboarding contribution**

Flash the public repository and KeeperHub PR #1788. End on: "Policy before execution. Proof after execution."

## Final Gate Checklist

- [x] DoraHacks pre-registration confirmed
- [x] Public repository
- [x] Public evidence console
- [x] Core policy/simulation/idempotency/reconciliation implementation
- [x] Browser-verifiable proof format
- [x] Automated tests
- [x] Upstream onboarding PR
- [ ] KeeperHub account authenticated
- [ ] Organization wallet address inserted into the live intent
- [ ] Authenticated simulation completed
- [ ] Zero-value testnet transaction completed through KeeperHub
- [ ] Live evidence verified locally and in the browser
- [ ] Public evidence bundle replaced and redeployed
- [ ] Demo video recorded and uploaded unlisted
- [ ] DoraHacks BUIDL form completed
- [ ] Final submission confirmed by the user
