# Independent review — silicon adaptation to harness 0.2.1-rc.2 / mpd 0.15.1

**Contract**: [`harness-0.2.1-adaptation-contract.md`](./harness-0.2.1-adaptation-contract.md)
(frozen before the review).
**Reviewer**: Reviewer role, a different agent from the author; read-only.
**Reviewed state**: working tree at base `bf3dae2` + the adaptation (33 modified / 16 untracked /
3 deleted at first review; 35 / 17 / 3 at the re-review, plus the type-gate fix). The review is anchored to the recorded
sha256 and to black-box commands, not to uncommitted-ness.
**Evidence under review**: `evidence/verification/harness-0.2.1-rc.2/20261021T075500Z/`
(`result.json`, `output.log`, parity hunks, boot logs, MCP handshake, tool-call JSONL).

## First verdict: FAIL

R1-R6 and R8 were demonstrated. R7 (documentation matches the measured baseline) was not, and one
recorded security bound was inaccurate. Four findings:

| id | severity | finding | doc source |
|---|---|---|---|
| F1 | medium | `packages/mpd-silicon-bootstrap-plugin/README.md` and `.zh-CN.md` documented the pre-adaptation resolver `ctx.get("mpdDsh") ?? createDshAdapter(ctx)`, while the shipped `apply()` resolves `siliconDsh ?? mpdDsh ?? createDshAdapter(ctx)`. Copied literally, the snippet would build a private adapter instead of using the mounted `siliconDsh`. | AGENTS §6; contract R2; R7 |
| F2 | medium | `.mpd/qa-sandbox-coexist/dsh/.credentials.yaml` was a symlink into the operator's real `~/.dsh/.credentials.yaml`, breaking the three-layer isolation in shape and making the record's "environment only" bound inaccurate. No write occurred and no secret reached the repo or the evidence. | AGENTS §2.4, §7, §8; contract R8 |
| F3 | low | `docs/rtl-docs-port-record.md` + `.zh-CN.md` still said the LSP assets "do not exist in this repository yet" and were `disabled: true`, contradicting the new status banner above. | contract R7; `packages/mpd-mcp-lsp/README.md` |
| F4 | low | `docs/dependency-map.md` A6 + `.zh-CN.md` cited `packages/mpd-bundle/README.md`, which has never existed (pre-existing, not introduced by this change). | AGENTS §3; contract R7 |

The Reviewer reproduced the gates, the 16-hunk parity, both boots, the MCP handshake and the
recorded evidence numbers independently. It declined to inflate the contract's explicit bounds
(no EDA backend, minimal coexistence composition, no `dsh plugin add` in the sandbox, stale-daemon
state) into findings.

## Repairs

| id | repair | verification |
|---|---|---|
| F1 | Both bootstrap READMEs now document `siliconDsh ?? mpdDsh ?? createDshAdapter(ctx)` and name `ctx.logger.warn` as the one direct touch with the adapter's `rowLogLine` as fallback. | Docs-only; `bun test packages/mpd-silicon-bootstrap-plugin` still passes as part of the 282-case suite. |
| F2 | The sandbox credential symlink was removed (`find .mpd -type l -lname '*credentials*'` → empty). The real tool-call case was re-run with the key supplied only through the process environment: 2 `tool_call` / 2 `tool_result`; `mpd_verif_venv` completed with the structured refusal; `mcp__silicon_lsp__status` completed with 44 configured servers. `result.json`'s bound was rewritten to state the runtime read and the absence of any sandbox link to the credential store (the only links are three read-only installed package trees). | `tool-proof-clean-home.jsonl` (env-only run); `output.log` "repair after independent review". |
| F3 | The port record section is retensed: "Forward references — port-time record (they have since landed)"; the assets are stated as shipped, the row enabled, the HDL pages at `packages/mpd-mcp-lsp/references/…`, and "Nothing in this section is pending today." Both languages. | `grep` for `disabled: true` now hits only the LSP README explaining the past state and the retired A3 row. |
| F4 | A6 now names the commented `silicon-mcp-wave-mcp` / `silicon-mcp-traceweave` rows in `packages/mpd-bundle/cordis.patch.yml` as the enable-recipe owner; the nonexistent README is no longer cited. Both languages. | `grep -rn 'mpd-bundle/README.md' docs/` → empty. |

Post-repair gates (all exit 0): typecheck `--self-test` (after the gate fix) and `--require`; `bun test packages/` 282 pass / 1 skip /
0 fail; corpus 10 pass / 3 skip; rows 4 vs 35 across 2 layers, intersection empty; rows
`--self-test`; `build-lsp --check`; packer `--self-test`, `--fix`, `--check`.

## Re-review: PASS

The Reviewer re-ran the contract on the current tree and verified F1-F4 independently, including the
operator credential store's mtime/mode (untouched) and a secret-shape scan of the evidence. R1-R8
were re-demonstrated; **verdict PASS**, overall risk LOW. One low residual (N1) was a wording
contradiction in the evidence bound ("no sandbox path links to `~/.dsh`" while four read-only
installed-package links do); it was reworded to scope the claim to the credential store and to name
the three package trees (`@mpd-dsh/mpd`, `@deepseek-ai`, `@dsh-std`).

## Additional gate defect found after the review (outside the contract)

While exercising every guard's `--self-test`, the author found a pre-existing type-gate defect
(`scripts/typecheck.mjs`, introduced by `07b92ce`, not caused by the adaptation): the self-test
resolved the checker from its temporary fixture root (no `node_modules`, so it fell through to
`bunx`, which is absent), and `check()` hard-coded `ran: true`, making the production `!ran` guard
unreachable. The pre-fix self-test exited 1, but **for the wrong reason**: the negative control
"failed" because the checker never ran; the healthy control passed vacuously; and, more seriously,
the production `--require` path could report `PASS — no diagnostics` with an un-runnable checker
(the verifier measured this before/after). The fix resolves the checker from the repo root for the
self-test, derives `ran` from the spawn error/status, and requires `bad.exit !== 0` / `good.exit
=== 0`.

A different agent verified the fix in a focused pass: **PASS**. `--self-test` exits 0 with the
wrong-type control caught (TS2322) and the healthy control clean; `--require` exits 0; and four
probes prove falsifiability — inverting the bad fixture fails, breaking the healthy fixture fails,
a missing checker fails loudly, and production `--require` now fails when the checker cannot start
(where HEAD exited 0). One low narrative correction (T1) was applied to this section: the defect
was a vacuous healthy control plus an unreachable production guard, not a self-test that exited 0.

## Bounds of this review

- The adapter body was not read to decide behaviour; the parity diff and the documented seam
  contract were used.
- No model call was re-executed by the Reviewer; the recorded artifacts were inspected.
- No EDA backend exists on this machine; the strong branch of the verif lanes was not exercised.
- A full `dsh-tui` composition was not verified; the coexistence boot uses the minimal bundle set.
