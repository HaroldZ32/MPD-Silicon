# t12 final re-review — certification

**Task:** t12 final confirmation (out-of-band, assigned by the captain) · **Reviewer:** Reviewer · **only file written: this report**
**Reviewed object:** `/root/dshProj/my-power-dsh-silicon/AGENTS.md` — 281 lines, sha256 `8772c161…dc815a`, commit `7503cdb` (pushed)
**Prior reports:** `evidence/review/t12-manual-review.md` (`bb84030`, original 10 findings) · `t12-manual-rereview.md` (`f729c73`, N1–N6) · `t12-manual-rereview-2.md` (`9638046`, R2-F1/F2)
**Baseline:** `/root/dshProj/my-power-dsh/AGENTS.md` (534 lines / 13 chapters, sha256 `0c7e543e…a1a37f`)

## Verdict: `pass`

**等价性达成，原 10 条 findings + N1–N6 + R2-F1/F2 全部闭环。**
(Equivalence with the source manual is achieved, and all of the original ten findings, N1–N6, and R2-F1/F2 are closed.)

---

## 1. R2-F1 / R2-F2 closure

| # | Required fix (round 2) | Verdict | Evidence |
|---|---|---|---|
| **R2-F1** | The `docs+gate: …` example contradicted the format rule; replace it with a conforming real subject or label it as a legacy deviation | **CLOSED** | `AGENTS.md:167-170` now cites `feat(lsp): …` (= `da3693c`, real, conforming). All five examples verified real and conforming to `<type>(<scope>): <summary>` with a listed type: `feat(silicon)` = `0296f6d`, `docs(i18n)` = `c4b4eb9`, `evidence(review)` = `bb84030`/`7c6442c`/`f729c73`, `test(smoke)` = `6078ccd`, `feat(lsp)` = `da3693c`. The non-conforming `docs+gate:` subject no longer appears anywhere in the manual |
| **R2-F2** | "its language table" was ambiguous (mpd's SKILL.md gate table *does* carry HDL routing rows; `lsp-server-table.ts` does not) — name the artifact | **CLOSED** | `AGENTS.md:264-270` now states both sides explicitly: the mpd repo keeps only the routing rows (`skills/lsp-setup/SKILL.md`, "whose language-gate table does list `.v/.vh` and `.sv/.svh`"), and "what deliberately gains **no** HDL rows is that repo's `skills/lsp-setup/scripts/lsp-server-table.ts`", with the behavioural consequence ("so `detect-lsp.ts` will not report `.v/.sv`; that is intended"). All four claims re-measured: mpd `SKILL.md` lines 46-47 carry the `.v .vh` / `.sv .svh` routing rows; `grep -c -i 'verilog\|systemverilog' lsp-server-table.ts` = **0**; `detect-lsp.ts:10` imports `LANGUAGES` from that table and derives its extension set from it, so `.v/.sv` cannot be reported; the pages themselves exist here at `packages/mpd-mcp-lsp/references/{verilog,systemverilog}/README.md` |

## 2. New-issue scan of this edit

| Surface | Verdict |
|---|---|
| §5 commit-format examples | **clean** (all five real and conforming) |
| §5 legacy-deviation sentence (`:169-170`) | **clean for its claim; one low-severity completeness note → RN-1** |
| §9 HDL bullet (ownership + both sides + consequence) | **clean** (four claims each re-measured, see R2-F2) |
| Markdown structure / indentation of both edits | **clean** (bullets and continuation indents intact; no broken links, no path changes) |

## 3. Residual note (non-blocking, not a finding)

- **RN-1 (low, cosmetic).** `:169` says "**Two** early commits were written without a scope (`docs: …`, `evidence: …`)". The repository actually has **three** scope-less subjects: `37b93cf docs: …`, `b35a141 evidence: …`, and `07b92ce docs+gate: …` (the third also uses an off-list combined type). The sentence's claim about the two named commits is true, and it affects no rule, gate, path or example; I am therefore certifying the manual with this note recorded rather than failing the round for it. If this file is touched again, "Two" → "Three" plus `docs+gate: …` in the parenthesis (or "A few early commits …") makes it exactly exhaustive.

## 4. Verification ledger

**This round (HEAD `7503cdb`, read-only):**

| Check | Result |
|---|---|
| `git status --porcelain` | 0 lines (clean tree at the reviewed revision) |
| `git diff 571dbb4..7503cdb -- AGENTS.md` | only the two intended edits (+8/−5 lines, per `--numstat`) |
| `node scripts/pack-silicon.mjs --check` | exit 0 · every committed file readable by a non-root consumer |
| `node scripts/verify-corpus.mjs` | exit 0 · `PASS — 10 check(s) passed, 3 skipped` |
| Format-example existence | 5/5 cited subjects present in this repository's history |
| Scope-less census | 3 subjects (see RN-1) |
| R2-F2 measurement set | mpd `SKILL.md:46-47` rows present; `lsp-server-table.ts` HDL hits 0; `detect-lsp.ts` derives from `LANGUAGES`; the two HDL READMEs exist here |

**Carried from the immediately preceding revisions (no code or gate file changed since):** `bun test packages/` → 131 tests / 0 fail / 845 expect / 1 declared skip; `typecheck` → PASS, 0 diagnostics; `verify-rows-disjoint` → exit 0; `build-lsp --check` → exit 0; five guard `--self-test`s → all exit 0. Documentation-only edits cannot invalidate these, and the read-only gates that touch the tree were re-run above.

## 5. Cumulative closure ledger

| Batch | Items | Status |
|---|---|---|
| Original review (round 1, `t12-manual-review.md`) | F1–F10 | **closed** (LSP gate row, Types gate, every-guard self-tests, QA real-cases row, git model, language-policy scope + exemptions, plugin authoring + adapter README, self-contained relationship, terminology/cross-reference, layout listing) |
| Re-review round 1 (`t12-manual-rereview.md`) | N1–N6 | **closed** (five-guard count + Types `--self-test`; evidence language rule aligned with the baseline; HDL ownership; branch model vs single-branch history; real commit-format examples; typecheck "inert" wording) |
| Re-review round 2 (`t12-manual-rereview-2.md`) | R2-F1, R2-F2 | **closed** (conforming example; HDL artifact named with its consequence) |

Equivalence with `mpd/AGENTS.md` holds throughout, and is **stronger** in: the 10-row gate table (baseline 6), a real type gate with its own negative control, explicit language-policy split (documents bilingual + evidence as-produced + named exemptions), restored §6 plugin-authoring contract pointing at the adapter README, an evidence-backed `--dump-config`/`--help` section, and a row-id taxonomy framed against the bundles' actual (closed) collision state.

## 6. Reproduction commands

```bash
SIL=/root/dshProj/my-power-dsh-silicon; MPD=/root/dshProj/my-power-dsh
sha256sum $SIL/AGENTS.md                       # 8772c161…
cd $SIL && git status --porcelain && git log --oneline -1
git diff 571dbb4..7503cdb -- AGENTS.md

# examples all real and conforming
sed -n '166,170p' $SIL/AGENTS.md
for e in 'feat(silicon)' 'docs(i18n)' 'evidence(review)' 'test(smoke)' 'feat(lsp)'; do git log --oneline --all | grep -F "$e"; done

# RN-1: scope-less census
git log --format='%s' | grep -nE '^[a-z+]+: '

# R2-F2 measurement set
sed -n '264,270p' $SIL/AGENTS.md
sed -n '24,25p;46,47p' $MPD/skills/lsp-setup/SKILL.md
grep -c -i 'verilog\|systemverilog' $MPD/skills/lsp-setup/scripts/lsp-server-table.ts   # 0
grep -n 'LANGUAGES' $MPD/skills/lsp-setup/scripts/detect-lsp.ts
ls $SIL/packages/mpd-mcp-lsp/references/

# gates
cd $SIL && node scripts/pack-silicon.mjs --check && node scripts/verify-corpus.mjs
```

## 7. Conclusion

The manual at `7503cdb` is an independent, non-copied adaptation of the source repository's `AGENTS.md`: every normative clause of the baseline is present or superseded by a stronger one, the mpd-specific inventory is absent, both repository-local traps are documented with measurements, and every path/package/row-id/example it cites resolves on disk. **Verdict `pass`**; the only residual item is the cosmetic count in RN-1, which affects no requirement.

---

## Summary (中文摘要)

- **判定：`pass`。等价性达成，原 10 条 findings + N1–N6 + R2-F1/F2 全部闭环。**
- R2-F1 已闭环：第五个示例换成真实合规的 `feat(lsp): …`（`da3693c`），五个示例经逐一核验均为本仓真实且符合 `<type>(<scope>): …` 格式；`docs+gate:` 已从手册中消失。R2-F2 已闭环：§9 现在把两侧一次说清 —— mpd 只保留路由行（`SKILL.md` 的 language-gate 表**确实**列了 `.v/.vh`、`.sv/.svh`），真正不含 HDL 行的是 `scripts/lsp-server-table.ts`，并写明后果（`detect-lsp.ts` 不会报 `.v/.sv`，属有意）。四点均已实测复核。
- **唯一残留为 RN-1（low，纯文案、非 finding、不阻塞）**：`:169` 写"Two early commits were written without a scope"，实际本仓有 **3** 个无 scope 提交（多出 `07b92ce docs+gate: …`）。因它不影响任何规则/门禁/路径/示例，故本轮按 pass 认证并在此记录；若日后再次触碰该文件，把 Two 改 Three 并补上 `docs+gate: …` 即完全穷尽。
- 本轮只读复核：`git status` 干净、diff 仅两处编辑、`pack --check` exit 0、`verify-corpus` PASS（10/3）、示例 5/5 存在、R2-F2 四项事实全部实测成立。文档改动不影响前几轮的门禁结论（无代码/门禁文件变化）。
