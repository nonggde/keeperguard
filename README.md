# KeeperGuard

KeeperGuard is a safe-execution starter for agents using KeeperHub. It turns a transaction intent into a real KeeperHub execution only after enforcing a local policy and passing KeeperHub's onchain simulation. It then reconciles the final transaction and produces a tamper-evident evidence bundle.

The default policy cannot move value: it permits only Ethereum Sepolia and Base Sepolia, forbids mainnet, and caps native transfers at `0`. A state-changing request also requires the explicit `--broadcast` flag.

**Live evidence console:** https://keeperguard-proof.a13553776411.workers.dev

The staged public bundle is currently marked `rehearsal / simulated`. It will be replaced only after a real KeeperHub execution passes local and browser verification.

## Why this exists

An agent's first onchain transaction has three separate failure surfaces:

1. **Before execution:** wrong chain, wrong recipient, excessive value, malformed amount.
2. **During execution:** revert, gas estimation failure, duplicate retry, interrupted client.
3. **After execution:** an execution ID exists, but the builder cannot prove which transaction landed or whether the audit record was modified.

KeeperGuard addresses all three without taking custody of a key. KeeperHub remains the signer, simulator, gas sponsor, and execution layer. KeeperGuard is the policy and evidence layer around it.

## Safety invariants

- Exact integer amount comparison, never floating point.
- Testnet-only by default, checked against KeeperHub's live `/api/chains` response.
- Zero native value ceiling by default.
- Optional recipient allowlist.
- KeeperHub simulation must pass before broadcast.
- Broadcast requires an explicit CLI flag.
- A stable idempotency key prevents duplicate execution on retry.
- Status polling honors KeeperHub's `X-Poll-Interval-Hint` header.
- API keys are read from the environment and redacted from errors.
- Rehearsal mode never creates an execution ID or transaction hash.
- Every event is linked to the previous event with SHA-256.

## Run the local rehearsal

No account, wallet, dependency install, or network transaction is required:

```bash
npm run demo
npm test
```

`npm run demo` writes a rehearsal evidence bundle under `artifacts/`. The bundle is explicit about its `rehearsal` mode and contains no transaction claim.

## Check live readiness

Node.js 20 or newer is required. KeeperGuard has no runtime dependencies.

```bash
copy .env.example .env
npm run doctor
```

`doctor` reads KeeperHub's public chain registry and reports whether the local policy still points at enabled testnets. It never sends the API key to the public chains endpoint.

For authenticated simulation and execution, export an organization API key created in KeeperHub under **Settings > API Keys > Organisation**:

```bash
set KEEPERHUB_API_KEY=kh_replace_me
```

Do not commit `.env` or paste a key into an intent file.

## Simulate an intent

Create an intent JSON file:

```json
{
  "chainId": 11155111,
  "recipientAddress": "0x1111111111111111111111111111111111111111",
  "amount": "0",
  "purpose": "Prove the guarded KeeperHub execution path without moving value"
}
```

Then run without the broadcast flag:

```bash
node src/cli.js run --intent fixtures/zero-value-transfer.json
```

The request reaches KeeperHub with `simulate: true`. KeeperGuard records the chain snapshot, policy decision, and simulation response, then stops before execution.

## Execute through KeeperHub

After replacing the fixture recipient with the organization's own KeeperHub wallet address:

```bash
node src/cli.js run --intent fixtures/zero-value-transfer.json --broadcast
```

The live path is:

```text
intent -> live chain lookup -> local policy -> KeeperHub simulation
       -> idempotent KeeperHub execution -> hinted polling -> proof bundle
```

The default zero-value self-transfer moves no asset. On a sponsorship-enabled testnet organization, KeeperHub can sponsor the gas. If sponsorship is unavailable, the execution fails closed rather than falling back to a positive-value transfer.

## Recover an interrupted execution

If the client closes after KeeperHub returns an execution ID, reconciliation can resume without broadcasting again:

```bash
node src/cli.js resume direct_execution_id
```

## Verify and stage evidence

Every evidence event contains the digest of the previous event. The artifact also has a final digest over the complete bundle.

```bash
node src/cli.js verify artifacts/evidence-run-id.json
node src/cli.js stage artifacts/evidence-run-id.json
npm run serve
```

`stage` refuses invalid evidence and copies a verified bundle to the browser console. Open `http://127.0.0.1:4173` to inspect the policy decision, transaction claim, hash linkage, and raw JSON. A reviewer can also load any evidence file locally; verification runs again in the browser with Web Crypto.

The static console deploys as a Cloudflare Assets Worker:

```bash
npm run deploy:check
npm run deploy
```

## Evidence states

| State | Meaning | Transaction claim |
|---|---|---|
| `blocked` | Local policy rejected the intent | None |
| `simulation_failed` | KeeperHub predicted a revert or failure | None |
| `simulated` | Preflight passed; broadcast was withheld | None |
| `completed` | KeeperHub execution reconciled successfully | Hash and explorer link required |
| `failed` | KeeperHub execution reached a terminal failure | Error retained, no success claim |

## Hackathon fit

KeeperGuard targets the KeeperHub Agents Onchain judging criteria directly:

- **Execution:** the live proof comes from KeeperHub's Direct Execution API.
- **Reliability:** simulation, policy gating, idempotency, recovery, and hinted polling.
- **Observability:** a portable event trail plus final transaction reconciliation.
- **Developer experience:** a dependency-free starter with safe defaults and a browser-verifiable proof.
- **Onboarding:** a new builder can rehearse without credentials, simulate with a key, and make a zero-value testnet execution without risking principal.

The repository does not present a mock hash as an onchain result. The public evidence bundle will be replaced with a verified KeeperHub transaction after the hackathon opens.

## License

MIT
