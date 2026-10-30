# Frozen contract — adapt @mpd-dsh/silicon to DeepSeek Harness 0.2.1-rc.2 / @mpd-dsh/mpd 0.15.1

**Status**: frozen for independent verification, 2026-10-21.
**Verifier rule**: verify from THIS contract + the documentation (`AGENTS.md`, `README.md`,
`README.zh-CN.md`, `docs/**`, `packages/*/README*.md`) + black-box commands. Do not read the
implementation to decide whether a claim is true; run the command and compare with the documented
outcome. A finding must cite the document that promises the behaviour and the measured fact.

## Objective

Make the silicon bundle installable and working against the current baseline — DeepSeek Harness
`0.2.1-rc.2` with `@mpd-dsh/mpd 0.15.1` — alone and alongside mpd, with the adapter contract, the
row-id gate, the retired rtl-ip data, the HDL MCP row and the documentation all consistent.

## Required outcomes (all must be demonstrated)

| # | Outcome | Acceptance evidence (black box) |
|---|---|---|
| R1 | The copied adapter is a fidelity port of mpd v0.15.1's adapter, with only the recorded D1-D6 divergence. | `diff -u ../my-power-dsh/packages/mpd-dsh-adapter-plugin/src/index.ts packages/mpd-dsh-adapter-plugin/src/index.ts` shows exactly 16 `@@` hunks; `cmp` shared.ts identical; `cmp` against `../my-power-dsh/packages/mpd-mcp-shared/log-sink.ts` identical; dist exports `SERVICE_NAME === "siliconDsh"` and `name === "silicon-dsh-adapter"`. |
| R2 | Consumer plugins reach the harness only through the adapter, except the documented two exceptions (the two-level resolver and the harness logger as the primary warning path). | The package READMEs + AGENTS.md §6 state the rule; the verif/bootstrap tests pass; the only direct `ctx.` hits are the resolvers and the logger line. |
| R3 | The row-id gate understands mpd v0.15.1's multi-layer layout. | `node scripts/verify-rows-disjoint.mjs` exits 0, prints silicon 4 ids / 1 layer and mpd 35 ids / 2 layers, intersection empty. `--self-test` exits 0 with parser + discovery controls. |
| R4 | The bundle boots alone and alongside mpd 0.15.1 without a fatal loader signature. | Two real boots; exit 124 (alive until timeout); no `failed to load`, `Cannot find module`, `already registered`, `has been registered`, `already in use`, `plugin tree failed`. Evidence logs exist. |
| R5 | The HDL language-service row is enabled and its MCP server speaks the current protocol. | A real boot composes `silicon-mcp-lsp` with `serverName: silicon_lsp`; a JSON-RPC probe gets `protocolVersion 2025-06-18` and 8 tools; a real harness tool call to `mcp__silicon_lsp__status` returns the configured-server list on a clean HOME. |
| R6 | rtl-ip is retired, not silently broken: no preset data/carrier, no dead hook claims; the replacement is documented. | `test ! -d presets`; root package.json has no `./presets/*` export; `README*.md`, `docs/**` and `LICENSE-NOTICES.md` say retired and name roster + teamModels + workmates as the replacement; no doc says the carrier is pending. |
| R7 | Documentation matches the measured baseline and stays bilingual. | Bundle 0.2.0, harness 0.2.1-rc.2, mpd 0.15.1 stated; every human doc has a `.zh-CN.md` twin with the switch link under the title (only the recorded exemptions); no stale `disabled: true` / `pending (t16)` / `t15 carrier` claim remains outside historical evidence. |
| R8 | Every gate is green and the evidence is on disk. | `node scripts/typecheck.mjs --require` exit 0; `bun test packages/` 282 pass / 1 skip / 0 fail; corpus 10 pass / 3 skip; rows + self-test 0; `build-lsp --check` 0; `pack-silicon --self-test` and `--check` 0; `evidence/verification/harness-0.2.1-rc.2/20261021T075500Z/{result.json,output.log}` present and consistent with the observed runs. |

## Explicit non-goals / bounds (a verifier must not inflate these into findings)

- Installing iverilog/verilator/VCS. This machine has none; the measured path is the structured
  refusal, and the test prints `ENV-GATED: …`.
- Porting the three upstream repo-scanning adapter gates (they hard-code `packages/mpd-*` and a
  frozen mpd inventory) and the 70-case schemastery-dependent upstream suite.
- A full `dsh-tui` composition. The coexistence boot uses dsh-base + mpd + silicon; mpd's own
  `preset-mpd` is pending there because no `agentPresets` provider is mounted — a composition
  artifact.
- `dsh plugin add` inside the QA sandbox: pnpm/corepack failed with
  `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` (sandbox EROFS). The profile was assembled manually
  (bundles + node_modules symlinks) and the composed row set was compared with the manifest.
- The LSP daemon's stale-owner behaviour on a REUSED sandbox HOME
  (`owner_changed_during_cleanup`); clearing `~/.mpd/lsp-daemon` is documented in the evidence.

## Verification procedure (run these yourself)

1. `node scripts/typecheck.mjs --require`
2. `bun test packages/` (bun is at `.mpd/tools/bun/bin/bun` on this host)
3. `node scripts/verify-corpus.mjs`
4. `node scripts/verify-rows-disjoint.mjs` and `--self-test`
5. `node scripts/build-lsp.mjs --check`
6. `node scripts/pack-silicon.mjs --self-test` and `--check`
7. Adapter parity: the diff/cmp set in R1 plus a `dist` export smoke.
8. MCP handshake probe against `packages/mpd-mcp-lsp/dist/cli.js` (initialize + tools/list).
9. Boot check: reuse the isolated sandbox profiles under `.mpd/` or assemble a fresh
   `DSH_HOME`; assert exit 124/alive and scan stderr for the fatal signatures.
10. Documentation audit: the R6/R7 greps and the twin/switch-link check.

## Verdict

Return ONE verdict token — **PASS** | **FAIL** | **INCONCLUSIVE** — plus findings, each with
`id`, `severity` (blocker/high/medium/low), `symptom`, `expected`, and the `doc_source` that
promises it. A PASS requires R1-R8 demonstrated; a FAIL requires at least one finding backed by a
run or a document quote. Do not fix anything.
