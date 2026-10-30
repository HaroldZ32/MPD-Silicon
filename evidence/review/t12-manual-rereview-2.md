# t12 re-review round 2 — N1–N6 closure and new-issue scan

**Task:** t12 final text re-review (out-of-band, assigned by the captain) · **Reviewer:** Reviewer · **only file written: this report**
**Reviewed object:** `/root/dshProj/my-power-dsh-silicon/AGENTS.md` — 278 lines, sha256 `d0c2a5ad…2fe635`, commit `571dbb4` (pushed)
**Prior reports:** `evidence/review/t12-manual-review.md` (`bb84030`, original 10 findings) · `evidence/review/t12-manual-rereview.md` (`f729c73`, N1–N6)
**Baseline:** `/root/dshProj/my-power-dsh/AGENTS.md` (534 lines / 13 chapters, sha256 `0c7e543e…a1a37f`, unchanged)
**Verdict: `needs_revision`** — **N1–N6 are all closed and equivalence with the baseline holds**, but this edit round introduced **two low-severity self-consistency/precision defects** (R2-F1, R2-F2; one line each). The certification sentence is therefore withheld until those two lines are fixed.

Basis: disk evidence and re-run output only.

---

## 1. N1–N6 closure

| # | Finding (round 1) | Verdict | Evidence |
|---|---|---|---|
| **N1** | §4 said "four carry negative controls" while five exist; Types row lacked `--self-test` | **CLOSED** | `AGENTS.md:110-111` now: "five carry negative controls today (typecheck, packer, corpus, rows, LSP)"; Types row `:98` now reads (`--require` to forbid the env skip, `--self-test` for its own control). Re-run of all five at HEAD, each exit 0: typecheck `self-test: control (wrong type) caught (TS2322) — PASS; healthy clean — PASS`; pack `PASSED (600→644, package-set guards)`; corpus `PASS (8 negative controls caught, 2 healthy controls clean)`; rows `PASS`; LSP `ok (registry controls + live --check)` |
| **N2** | `evidence/**` English-only clause conflicted with five Chinese-dominant committed records (incl. the t12 report §10 cites) | **CLOSED** | `:7-11` now separates the two surfaces: agent-facing content (manual, code comments, gate scripts/logs) stays English-only, while "`evidence/**` records the language they were produced in (the source manual's rule): new records are English by default … Records already committed in another language keep it — they are evidence of what was measured, not a style surface." That is the baseline's stance (`mpd/AGENTS.md:145`: "records, language as produced"), so the previously cited Chinese reports (t8 127/237, t12 122/226, t7 88/213 …) are no longer violations; a sweep for other language claims (`grep -n English AGENTS.md`) shows only lines 7/9/13/15/16 — no leftover evidence-English rule |
| **N3** | §9 said the HDL pages live in the mpd repo (inverted) | **CLOSED (one naming precision left → R2-F2)** | `:263-267` now: "**HDL pages are owned here**: the Verilog/SystemVerilog reference pages live at `packages/mpd-mcp-lsp/references/{verilog,systemverilog}/README.md`. The `@mpd-dsh/mpd` repo retains only the routing rows that point at them and its language table intentionally gains no HDL rows…". Re-verified: both reference READMEs exist here; mpd `skills/lsp-setup/references/` has 20 entries and no `verilog`/`systemverilog`; mpd `SKILL.md:46-47` routes `.v/.vh` and `.sv/.svh` at `../my-power-dsh-silicon/…` (`$MPD_SILICON_ROOT` override); `scripts/lsp-server-table.ts` carries no HDL entries |
| **N4** | §5 branch table used the source repo's `dev` and claimed master takes merges only | **CLOSED** | `:157-165` now: `master` = "this repository's only line (its default, pushed directly)" + optional short-lived `feature/*`/`fix/*`, plus an explicit paragraph that mpd's `dev` "is not this repository's" and that "this repository's history carries no merge commits so far". Re-verified: `git branch -a` → only `master` + `remotes/origin/master`; `git log --oneline` 18 commits; `git log --merges` **0** |
| **N5** | Example `chore(lsp-setup)` does not exist in this repo | **CLOSED (replacement example is non-conforming → R2-F1)** | `:167-169` replaced it with `docs+gate: …`, which does exist here (`07b92ce docs+gate: close t12's ten findings …`). All five cited examples (`feat(silicon)`, `docs(i18n)`, `evidence(review)`, `test(smoke)`, `docs+gate`) are real commits of this repository |
| **N6** | §9's typecheck "fails either way" contradicted the early skip | **CLOSED** | `:250-256` now: "**`scripts/typecheck.mjs` is inert without `node_modules`** … decides that from the filesystem *before* invoking any checker and then skips loudly (exit 0 with the `bun install` command printed); `--require` turns that into a failure … only real after a dependency install … by design, because a cold `bunx` call would resolve the roots itself and hide the condition." Matches the implementation (`typecheck.mjs:107-118` early return; `:75-80` mixed-diagnostics rule) and my measured repro |

Leftover check for the previous wording (all 0 hits): `four carry negative controls`, `HDL pages live in the @mpd-dsh/mpd repo`, `commits arrive by merge only`, `chore(lsp-setup)`, `fails either way`, `including \`evidence/**\``.

---

## 2. New-issue scan of the changed surfaces

Changed surfaces this round: language policy (§0), Types row (§4), branch table + commit format + merge sentence (§5), typecheck bullet and HDL bullet (§9).

| Surface | Verdict | Note |
|---|---|---|
| Language policy | **clean** | Internally consistent; matches the baseline; no other rule still binds evidence to English |
| §4 Types row / self-test sentence | **clean** | Command, flags and the five-guard list all verified against the scripts |
| §5 branch table + merge sentence | **clean** | Matches `git branch -a` and a merge-free history; the conditional merge sentence no longer implies merges happen |
| §5 commit-format examples | **defect (R2-F1, low)** | The fifth example does not match the format rule it illustrates |
| §9 typecheck bullet | **clean** | Wording now matches behaviour, including the design rationale |
| §9 HDL bullet | **defect (R2-F2, low)** | Ownership is now correct; the "language table" referent is ambiguous |

---

## 3. Findings

### R2-F1 — low — the `docs+gate: …` example contradicts the commit-format rule it illustrates

- **Problem:** `AGENTS.md:167-169`: "**Commit format** — `<type>(<scope>): <summary>`, with types `feat | fix | docs | test | evidence | chore | refactor`; this repository's own history follows it (e.g. `feat(silicon): …`, `docs(i18n): …`, `evidence(review): …`, `test(smoke): …`, `docs+gate: …`)."
  The last example is the real commit `07b92ce docs+gate: close t12's ten findings and t13's two, add the type gate` — it has **no scope** and its type (`docs+gate`) is **not in the enumerated list**, so it is a counter-example inside a list introduced by "history follows it". A reader can reasonably conclude `docs+gate:` is an accepted type.
- **requiredFix:** replace the fifth example with a conforming real subject (e.g. `docs(evidence): …` = `1368911`, `feat(lsp): …` = `da3693c`, `evidence(review): …` is already there), or label it explicitly as a legacy deviation ("one earlier subject used `docs+gate:` without a scope; that is not the pattern").

### R2-F2 — low — "its language table" is ambiguous and can be read as mpd's `PHASE 0 — LANGUAGE GATE` table

- **Problem:** `AGENTS.md:265-267`: "The `@mpd-dsh/mpd` repo retains only the routing rows that point at them and its language table intentionally gains no HDL rows…".
  mpd's `skills/lsp-setup/SKILL.md` contains a table introduced as "PHASE 0 — LANGUAGE GATE" (lines 24-47) which **does** carry HDL rows (`.v .vh`, `.sv .svh` → this bundle). The artifact that intentionally has no HDL rows is `skills/lsp-setup/scripts/lsp-server-table.ts` (the per-language builtin-server snapshot; t17 records this verbatim). As written, the phrase "its language table" can be mapped onto either object; a reader who maps it onto the SKILL.md table finds the manual false and might "fix" the wrong side (adding HDL rows to `lsp-server-table.ts`, or removing the routing rows).
- **requiredFix:** name the artifact: "…and mpd's `scripts/lsp-server-table.ts` intentionally gains no HDL rows (only the SKILL.md routing rows exist there)". One-line edit; no other change needed.

---

## 4. Re-run evidence (HEAD `571dbb4`, read-only)

| Command | Result |
|---|---|
| `bun test packages/` | `131 tests / 0 fail / 845 expect / 12 files`, 1 declared skip (source-checkout corpus cross-check) |
| `node scripts/typecheck.mjs` | exit 0 · `PASS — no diagnostics (local tsgo)` |
| `node scripts/verify-corpus.mjs` | exit 0 · `PASS — 10 check(s) passed, 3 skipped` |
| `node scripts/pack-silicon.mjs --check` | exit 0 · every committed file readable by a non-root consumer |
| `node scripts/build-lsp.mjs --check` | exit 0 · BUILD.lock sha256/bytes, both HDL registry entries, overlay anchor |
| five `--self-test`s (typecheck, packer, corpus, rows, LSP) | all exit 0 (see §1 N1) |

`--fix` and Pack were not run (they write; the mode gate `--check` already proves the tree compliant).

## 5. Reproduction commands

```bash
SIL=/root/dshProj/my-power-dsh-silicon; MPD=/root/dshProj/my-power-dsh
sha256sum $SIL/AGENTS.md                     # d0c2a5ad…
cd $SIL
for c in "typecheck.mjs --self-test" "pack-silicon.mjs --self-test" "verify-corpus.mjs --self-test" \
         "verify-rows-disjoint.mjs --self-test" "build-lsp.mjs --self-test"; do node scripts/$c; echo "$c exit=$?"; done
bun test packages/; node scripts/typecheck.mjs; node scripts/verify-corpus.mjs; node scripts/pack-silicon.mjs --check

# R2-F1
sed -n '167,169p' $SIL/AGENTS.md
git -C $SIL log --oneline --all | grep -F 'docs+gate'          # exists, but no scope + unlisted type

# R2-F2
sed -n '263,267p' $SIL/AGENTS.md
sed -n '24,47p' $MPD/skills/lsp-setup/SKILL.md                 # PHASE 0 — LANGUAGE GATE table, HDL rows present
grep -c -i 'verilog\|systemverilog' $MPD/skills/lsp-setup/scripts/lsp-server-table.ts   # 0
ls $SIL/packages/mpd-mcp-lsp/references/                       # verilog systemverilog
```

## 6. Conclusion

- **Original 10 findings: closed (round 1).** **N1–N6: closed** (N3/N5 closed with a naming/example precision residual, re-filed as R2-F1/R2-F2).
- **Equivalence with the mpd manual: holds, stronger in several clauses** (10-row gate table, real type gate with its own negative control, explicit language-policy split, restored §6 + adapter README contract, accurate git model, honest known limitations).
- **Verdict `needs_revision`** solely because of the two low-severity items in §3 — both one-line text edits that introduce no code or gate change. Once they land, the certification sentence ("equivalence achieved and the original ten + N1–N6 all closed") can be issued; that confirmation needs only a read of the two lines, no gate re-run.

---

## Summary (中文摘要)

- **N1–N6 全部闭环**（N1 五个负控+Types 行已注 `--self-test`；N2 语言政策采纳基线"evidence 按产出语言记录"并 grandfather 既有中文记录；N3 HDL 归属改为"页在本仓"；N4 分支表与本仓单分支/0 merge 实况一致；N5 示例换成本仓真实提交；N6 typecheck 改为"无依赖即 inert"并写明设计理由）。原 10 条 + N1–N6 均已闭环，等价性保持（多项更强）。
- **本轮改动新引入 2 处 low 级精度问题**：**R2-F1** §5 的第五个示例 `docs+gate: …` 虽真实存在，但无 scope、类型也不在列举的 7 个类型内，与"history follows it"的说明自相矛盾；**R2-F2** §9 "its language table" 指向不明——mpd 的 `SKILL.md` 有 `PHASE 0 — LANGUAGE GATE` 表且**含** HDL 路由行，真正不含 HDL 行的是 `scripts/lsp-server-table.ts`，建议点名。
- **Verdict = `needs_revision`**（仅因上述两条，各一行文字；不改代码/门禁）。改完我只需读这两行即可确认，无需再跑门禁；届时可出具"等价性达成且原 10 条 + N1–N6 全部闭环"的结论。HEAD `571dbb4` 的全部只读门禁实测全绿（bun test 131/0 fail/1 declared skip、typecheck 0 诊断、corpus 10/3、pack `--check`、LSP `--check`、五个 `--self-test` 全 exit 0）。
