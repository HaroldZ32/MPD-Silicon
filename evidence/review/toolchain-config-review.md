# Independent review — toolchain configuration + LibreLane (0.3.0)

**Contract**: [`toolchain-config-contract.md`](./toolchain-config-contract.md) (frozen before the review;
one addendum records the F3 test-count change).
**Reviewer**: Reviewer role, a different agent from the author; read-only.
**Reviewed state**: working tree at base `bd4d619` + the uncommitted toolchain feature (26 modified /
15 untracked at the first review; 26 modified / 16 untracked after the repairs — this record is the
extra untracked path). The review is anchored to the recorded hashes and to black-box commands, not
to uncommitted-ness.
**Evidence under review**: `evidence/verification/toolchain-config/20261021T112000Z/`.

## First verdict: FAIL

R1-R7 were verified by black box (config layers, schema, comment-preserving atomic writes,
conversational actions, backend tier, launcher PATH priming + MCP handshake, the real LibreLane
3.0.16 status/run and devshell quoting). R8/R9 were not demonstrated at the frozen state:

| id | severity | finding | doc source |
|---|---|---|---|
| F1 | high | `pack-silicon --check` exited 1 on the 0600 `result.json` and the 0600 contract. The recorded green predated the evidence write; the Reviewer raced the writer's `--fix`. | contract R9; AGENTS §4/§7 |
| F2 | high | Five docs (README ×2 sites, AGENTS §4, docs/toolchain.md + zh) still stated the pre-schema-suite counts 363 tests / 30 files / 362 pass / plugin 149, while the tree measured 372/31, 371 pass, plugin 158. | contract R8/R9 |
| F3 | low | Inserting a sibling key reattached a trailing line comment from the preceding member onto the new member (`} // note` moved to the new key). | contract R3; docs/toolchain.md "set — one surgical edit" |
| N1 | nit | The contract's literal `0.2.0` grep hit the gitignored generated `dist/silicon-package` stage (0.2.0). | contract R8 |

## Repairs

| id | repair | verification |
|---|---|---|
| F1 | Re-ran `pack-silicon --fix` after the final evidence writes; both files are 0644 and `--check` passes. The post-write green and the modes are appended to `output.log`. | `[pack-silicon] check PASS`; `ls -l` shows 644 for `result.json` and the contract. |
| F2 | Updated all seven sites to the final measured counts: **376 tests / 31 files, 375 pass / 1 skip, `mpd-verif-plugin` 162, LSP launcher 9**. | `grep 363|362|30 files|149` over the docs is empty; the new counts appear in README ×2, AGENTS §4, docs/toolchain ×2. |
| F3 | Added `trailingCommentEnd()` to the ported editor: object-member insertion now places the new member after the preceding member's same-line `//` or `/* */` comment, with the comma before the comment. 4 regression tests (line comment, block comment, existing comma, CRLF) went red→green. Dist rebuilt. Re-proved through the real harness: the F3-case config kept `}, // trailing note stays with ossCadSuite` and inserted `librelane` after it; `status` returned 3.0.16 (`after-f3.jsonc`, `toolchain-tool-proof-3.jsonl`). The analogous array-element edge is unreachable through the tool's schema and is recorded in AGENTS §9. | `bun test packages/mpd-verif-plugin` 162 pass; full suite 376 tests / 31 files; the real harness 3/3 calls completed. |
| N1 | Removed the stale generated `dist/silicon-package` (gitignored 0.2.0 stage). | `test ! -d dist/silicon-package`; the docs `0.2.0` grep is empty. |

Final gates (all exit 0): typecheck `--self-test` and `--require`; tests 375 pass / 1 skip / 0 fail
(376 / 31); corpus 10/3; rows 4∩35=∅ + self-test; `build-lsp --check`; packer `--self-test`,
`--fix`, `--check`.

## Re-review: PASS

The Reviewer re-ran the contract + addendum on the current tree: **PASS**, risk Low. It verified
F1 (packer check green, 0644 evidence modes), F2 (375 pass / 1 skip / 0 fail, 376 tests / 31 files;
all seven doc sites updated; stale-count grep empty), F3 (editor 14 pass with the four F3 cases; a
black-box through the rebuilt dist confirms root/nested line and block comments stay attached,
trailing commas and CRLF preserved, and the original `before → after-2` case remains byte-identical),
and N1 (stale 0.2.0 stage gone; no doc hits). It re-spot-checked the launcher, the MCP handshake
(2025-06-18, 8 tools), the real LibreLane 3.0.16 status/run, the corpus/rows/LSP/typecheck/packer
gates, the evidence hashes, and no secrets.

Two record-hygiene nits were fixed after the PASS: E1 (`result.json` now carries `updated_at` and the
final `--fix` count of 222 files) and C1 (the contract's Procedure step 2 and R9 row now state
376/31, consistent with the addendum). Neither affects a measured result.

## Bounds of this review

- The real harness session was not re-executed by the Reviewer (no model call); R4 rests on the
  recorded `toolchain-tool-proof-2.jsonl` (4/4 completed) and the Reviewer's black-box reproduction.
- No real AppImage/FUSE/Verible: the devshell/appimage modes were exercised with fakes; the MCP
  handshake proves traffic, not a language-server start.
- The coexistence boot was inspected, not re-run; the direct-child-only timeout and the lexical cwd
  guard were not re-measured.
- `pack-silicon --fix` was not run by the Reviewer (read-only); the repair direction for F1 is
  demonstrated in the record, not by the Reviewer.
- The Reviewer briefly created and immediately removed an empty `.docaudit-tmp.mjs` in the repo root
  during the doc-link audit; `git status` shows no trace and no repository content changed.
