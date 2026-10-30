# t12 re-review — closure of the ten findings and new-error scan

**Task:** t12 re-review (out-of-band, assigned by the captain) · **Reviewer:** Reviewer · **only file written: this report**
**Reviewed object:** `/root/dshProj/my-power-dsh-silicon/AGENTS.md` — 268 lines, sha256 `a8f94c91…14f5ee29`, commit `0738a3d` (the file moved during this re-review: `07b92ce` → `0738a3d`; see §4 obs. 2)
**Prior review:** `evidence/review/t12-manual-review.md` (object `ba459f5b…`, commit `bb84030`)
**Baseline:** `/root/dshProj/my-power-dsh/AGENTS.md` (534 lines / 13 chapters, sha256 `0c7e543e…a1a37f`, unchanged)
**Verdict: `needs_revision`** — the ten original findings are **10/10 substantively closed** and equivalence is achieved (stronger in several clauses); the fix commits nevertheless left **3 medium + 2 low new factual/self-consistency issues** that need one bounded text pass.

Basis: disk evidence and re-run output only; "a rewrite that still weakens a baseline requirement is a finding".

> This file replaces a Chinese draft of the same report (committed by the captain inside `0738a3d`) because the manual's own language policy binds `evidence/**` to English (see N2). The Chinese summary block at the end is the form that policy allows.

---

## 1. Closure of the ten findings

| # | Original finding | Verdict | Evidence (independently re-checked) |
|---|---|---|---|
| **F1** | §4 missing the LSP asset-drift gate; §3 missing `build-lsp.mjs` | **CLOSED** | `AGENTS.md:101` adds the row `LSP assets \| node scripts/build-lsp.mjs --check (--self-test) \| every packages/mpd-mcp-lsp/** change`; `:73` lists `build-lsp.mjs`. Run: `--check` → exit 0 (sha256 `04b49f8c…` / 235271 B vs BUILD.lock, both HDL registry entries, overlay anchor, 2 reference docs + 4 fixtures) |
| **F2** | Tests row lacked typecheck | **CLOSED** | `:97` adds the Types row (`node scripts/typecheck.mjs`, `--require` to forbid the env skip, on every `src`/`test` change); `scripts/typecheck.mjs` exists (145 lines); `package.json:34-35` devDeps `@typescript/native-preview` + `bun-types`; `tsconfig.json` gains `types: ["bun-types","node"]`; `bun.lock` committed. Run: default → `PASS — no diagnostics (local tsgo)`; `--self-test` → wrong type caught (TS2322) + healthy control clean, exit 0. No `@ts-ignore`/`@ts-expect-error` masking (see §4 obs. 1) |
| **F3** | guard self-tests narrowed to the packer | **CLOSED (count stale → N1)** | `:108-109` now says "`--self-test` is expected on **every** guard"; Corpus/Row-ids/LSP rows carry `(--self-test)`. But "four carry negative controls (packer, corpus, rows, LSP)" vs the actual **five** → N1 |
| **F4** | no QA-real-cases row / cross-repo pointer | **CLOSED** | `:106` adds the row naming the two probes in the `@mpd-dsh/mpd` repo and `MPD_SILICON_ROOT=<this repo>`. Cross-checked the mpd sources: `rtl-verif.mjs:32` and `rtl-ip-profile.mjs:23` both read `process.env.MPD_SILICON_ROOT \|\| join(dirname(repoRoot), "my-power-dsh-silicon")` |
| **F5** | git model narrowed | **CLOSED (branch wording → N4)** | `:160-169` restores `<type>(<scope>): <summary>` + type list + examples, `--no-ff`, and a no-rebase/no-force-push rule. But `:157-158`'s `dev` row ("integration line of the source repository / feature/fix work lands here") and master's "commits arrive by merge only" contradict this repo's reality (single branch, 14 commits, **0 merges**) → N4 |
| **F6** | language policy dropped `packages/*/README.md`, no exemptions | **CLOSED (new evidence clause conflicts with the repo → N2)** | `:10-11` restores `packages/*/README.md`; `:15-18` adds an Exemptions paragraph (single-file bilingual = `docs/sync-policy.md`; internal QA artifacts = `docs/adder4.md`/`cnt8.md`, which must say so in their own header). Checked: `adder4.md:3-4` carries exactly that self-declaration; all four package README pairs exist with switch links |
| **F7** | §6 condensed; adapter README still an mpd copy | **CLOSED** | `:173-198` restores: the adapter is the only file allowed to touch `ctx.tools/subagents/skills/agentPresets` and its README is the contract (`:177`); inject-free lazy seam resolution + `capabilities()`; registration contract (object-rooted `parameters`, `output.render`, `(args, exec)`); guards/waterfalls/subagents/internal calls; **workspaceRoot resolved per call** (`:188`); provider vs service names; dependency-free runtime + build command. The adapter README (en + zh-CN) is genuinely fixed: `:46` is `ctx.get("siliconDsh") ?? ctx.get("mpdDsh")`, `:56` names the `silicon-dsh-adapter` row, `:30-31` moves agent-teams to the `@mpd-dsh/mpd` bundle — matching `SERVICE_NAME = "siliconDsh"` at adapter `src/index.ts:446` |
| **F8** | §1 "sub-plugin … installed alongside" | **CLOSED** | `:27-30` now: "**self-contained and usable on its own** — measured: isolated install and boot with no `@mpd-dsh/mpd` on disk (t7) … also designed to sit **alongside** … as its RTL companion" |
| **F9** | §9 broken cross-reference + provider/service confusion | **CLOSED** | `:249-251` rewritten ("the three singleton classes are in §4, and the service-name split in them is why the adapter copy deliberately diverges"); `:35-37` and `:194-196` separate provider = `silicon-bundle` from service = `siliconDsh` (adapter `src/index.ts:446`). The former §4 residual (pre-split service symptom) is now explicitly framed as future/older-mpd territory (`:129-134`) — verified in §2 below |
| **F10** | §3 missing `tests/` and `build-lsp.mjs` | **CLOSED** | `:73-75` list `build-lsp.mjs` and `tests/`; `:88-89` adds a third load-bearing constraint (dist committed; `.gitignore` anchors `/dist/`). Checked `git ls-files`: three plugin `dist/index.js` plus `mpd-mcp-lsp/dist/{cli.js,BUILD.lock}` are tracked |

**None of the ten still weakens a baseline requirement.**

---

## 2. Equivalence verdict against the mpd manual

| Clause | Verdict now | Basis |
|---|---|---|
| Language policy | **equivalent (docs) + stronger (agent-facing)**, except the evidence clause (N2) | bilingual set matches the baseline (incl. `packages/*/README.md`) + same-commit sync + switch links; exemptions are explicit, better than the baseline |
| §2 six principles | **equivalent** (principle 4 stronger: sandboxed HOME + workspace) | 6 = 6 |
| §4 gate table | **stronger** | baseline 6 rows → now **10**: Types / Tests / Corpus / Row ids / LSP assets / Modes / Packer guards / Pack / Boot check / QA real cases. The baseline Vendor row is carried by the LSP row plus the corpus baseline; the baseline typecheck is carried by the Types row (with `--require`) |
| `--dump-config` rule | **equivalent, now evidence-backed** | `:111-118` cites t13's measurement (same profile: compose exit 0 / load exit 1 + `plugin tree failed to load … Cannot find module`); matches t13 §2 verbatim |
| `--help` (was a measured trap) | **equivalent, reworded to the measured behaviour** | `:120-125` "exited 1 on a provably broken profile and hung past 40 s on a valid one — evidence in neither direction"; matches t13 §3 (exit 1 / >40 s hang, exit 124) |
| row-id zero intersection ≠ coexistable | **equivalent (now sharper)** | `:127-143` keeps the three-class taxonomy and adds that all three classes are **closed between the two bundles today**; verified: `SERVICE_NAME = "siliconDsh"` (adapter `src/index.ts:446`), the mpd patch carries no `mpd-verif` row (t5 strip), and the silicon LSP row declares `serverName: silicon_lsp` (mpd's `mcp-lsp` owns `lsp`) — with coexistence re-test logs on disk (`boot-S1-final-PASS.log`, `t18-coexist-retest.log`) |
| git model | **equivalent (all clauses present)**, but branch/merge wording conflicts with reality (N4) | commit format, atomic commits, `--no-ff`, no rebase/force-push all restored |
| QA three-layer isolation | **equivalent (more explicit)** | `:51-52` + `:204-206` |
| Security & privacy | **equivalent (stronger)** | `:226-230` plus §7's "read the key at use time, never persist it" rule (`:217-220`); a credential-shape scan over `git diff bb84030..HEAD` found nothing (`sk-*`/key/Bearer) |
| Plugin authoring | **equivalent (applicable clauses restored)** | §6 per F7; the mpd-only block (agent-teams adoption, A1–D8 inventory) is correctly not copied |
| "not a wholesale copy" | **still holds** | all new text is this repo's own facts (typecheck/LSP/dist/git examples); no mpd row inventory, 25-package layout or VENDOR_LOCK flow. The `dev` row is the single place an mpd concept leaked in → N4 |

**Conclusion: equivalence achieved (stronger in several clauses).** The remaining issues are factual accuracy/self-consistency of the new text, not weakened requirements.

---

## 3. Newly introduced issues

### N1 — medium — §4's self-test count is stale: five guards carry negative controls, not four

- **Problem:** `AGENTS.md:108-109`: "`--self-test` is expected on **every** guard, not only the packer: **four** carry negative controls today (packer, corpus, rows, LSP)". The type gate added in the same commit carries its own negative control (`scripts/typecheck.mjs:87-101`: writes `export const n: number = "not a number"` and requires TS2322, plus a healthy control). Re-run of all five `--self-test`s, all exit 0:
  ```
  pack-silicon --self-test        → PASSED (600→644 counted; package-set guards)
  verify-corpus --self-test       → PASS (8 negative controls caught, 2 healthy controls clean)
  verify-rows-disjoint --self-test→ PASS (six parser controls)
  build-lsp --self-test           → ok (registry controls: missing server caught) + live --check
  typecheck --self-test           → control (wrong type) caught (TS2322) — PASS; healthy clean — PASS
  ```
  The Types row (`:97`) also omits `(--self-test)` while Corpus/Row ids/LSP include it — inconsistent with `:145-147` ("Every guard ships a self-test with negative controls").
- **requiredFix:** change `:108-109` to "five carry negative controls today (packer, corpus, rows, LSP, typecheck)", or drop the enumeration; add `--self-test` to the Types row command.

### N2 — medium — the `evidence/**` English-only clause is violated by the repository's own files (including the report §10 cites)

- **Problem:** `AGENTS.md:7-9` requires agent-facing content "including `evidence/**`" to be English-only ("a report may carry a summary block in another language, but the record itself is English"). Committed evidence files are Chinese-dominant (`grep -c '[一-龥]'`):
  ```
  evidence/review/t8-port-review.md                127/237 lines contain CJK
  evidence/review/t12-manual-review.md             122/226
  evidence/verification/t7-install-boot.md          88/213
  evidence/verification/corpus-gate-independent.md  29/61
  evidence/final-acceptance.md                       7/158
  ```
  `t12-manual-review.md` is exactly the file `AGENTS.md:264` cites as the independent equivalence verification — the manual points at a record that breaks its own language policy. The baseline takes the opposite stance (`mpd/AGENTS.md:145`: evidence is "records, **language as produced**"), so this clause is stricter than the baseline *and* not satisfied here. The Chinese draft of this very report was committed inside `0738a3d`; this English version replaces it.
- **requiredFix:** either (a) add a grandfather sentence ("records committed before <date/commit> are exempt; new records are English") and stop citing the Chinese report as the verification anchor, or (b) align the clause with the baseline (evidence records as produced; the English-only duty covers the manual, code comments, gate scripts and logs).

### N3 — medium — §9's HDL ownership sentence is inverted and self-contradictory

- **Problem:** `AGENTS.md:255-257`: "The **`skills/lsp-setup` HDL pages live in the `@mpd-dsh/mpd` repo**, whose language table intentionally gains no HDL rows: HDL support is owned by this bundle's MCP server…".
  Measured / t17 evidence: the HDL reference pages were **removed from mpd** ("retire mpd's two orphan HDL reference pages now that the silicon bundle owns them", `evidence/verification/t17-lsp-pointers.md:5`); `mpd/skills/lsp-setup/references/` now holds exactly 20 non-HDL pages and has no `verilog`/`systemverilog` directories; the pages live **here** in `packages/mpd-mcp-lsp/references/{verilog,systemverilog}/README.md` (both present). mpd keeps only routing rows (`skills/lsp-setup/SKILL.md:46-47` → `../my-power-dsh-silicon/packages/mpd-mcp-lsp/references/…`, `$MPD_SILICON_ROOT` override).
  Both readings fail: if "HDL pages" = the reference pages, the first clause is false; if it = the routing rows, the second clause is false (mpd's SKILL.md language table *does* have HDL rows — only `lsp-server-table.ts` gains none).
- **requiredFix:** replace with one unambiguous sentence, e.g.: "The `skills/lsp-setup` skill lives in the `@mpd-dsh/mpd` repo and routes `.v/.vh` and `.sv/.svh` at this bundle's `packages/mpd-mcp-lsp/references/` (`$MPD_SILICON_ROOT` overrides); the HDL pages themselves ship here, and mpd's `lsp-server-table.ts` gains no HDL rows so there is a single source of truth."

### N4 — medium — §5's branch table imports the source repo's `dev` and misstates this repo's merge rule

- **Problem:** `AGENTS.md:155-158`: master = "this repository's released line (its default) | **commits arrive by merge only**"; `dev` = "**integration line of the source repository** | feature/fix work lands here"; `feature/*, fix/*` = "short-lived; merged".
  Measured: `git branch -a` → only `master` + `remotes/origin/master`; `git log --oneline | wc -l` = 14; `git log --merges | wc -l` = **0**. This repo has no `dev`, has never merged, and its 14 commits (first push included) went straight to `master`. As a binding manual this sends an agent looking for a branch that does not exist and treats the actual history as a violation.
- **requiredFix:** describe reality (single default branch; atomic commits with evidence in the same commit; when a topic branch is used, merge with `--no-ff` and never rebase/force-push), or label the `dev`/`release` rows explicitly as the source repository's lines (or as "when this repo gains one").

### N5 — low — the `chore(lsp-setup)` example is not in this repository's history

- **Problem:** `AGENTS.md:162-164` says "**this repository's own history** follows it (e.g. `feat(silicon): …`, `docs(i18n): …`, `evidence(review): …`, `test(smoke): …`, `chore(lsp-setup): …`)". `git -C <silicon> log --oneline --all | grep -i lsp-setup` → **0**; `chore(lsp-setup): …` is an **mpd** commit (`32ae54d chore(lsp-setup): retire the orphan HDL pages and take the single VENDOR_LOCK re-pin (t17)`). The other four examples exist here (1–2 hits each).
- **requiredFix:** drop `chore(lsp-setup)` or replace it with a real commit from this repo's history.

### N6 — low — §9's typecheck "either way" wording does not match the implementation

- **Problem:** `AGENTS.md:245-248`: "…Run `bun install`, or `--require`, to make the type gate real; **a mix of environment diagnostics and genuine ones fails either way**." The implementation short-circuits on the filesystem **before** any checker runs: `scripts/typecheck.mjs:107-118` exits 0 (SKIP) whenever the type roots are missing, so the "mixed diagnostics must FAIL" rule (`:75-80`, `:129-134`) is unreachable in the no-install case. Measured (copy under /tmp with no `node_modules`, source containing a genuine `const y: number = "boom"`):
  ```
  node scripts/typecheck.mjs            → SKIP — missing type roots…   exit=0
  node scripts/typecheck.mjs --require  → FAIL (--require): missing type roots   exit=1
  ```
  i.e. in the default mode a genuine type error does **not** fail — which is this repo's default state on a fresh clone. The first half of the sentence discloses the skip honestly; the "fails either way" clause reads as a stronger guarantee than the code provides.
- **requiredFix:** reword to "without type roots the checker is not run at all, so the gate is inert until `bun install` (use `--require` in CI to fail instead of skipping)"; or implement the design the code comment claims (run the checker first; skip only when every diagnostic is a type-root artifact).

---

## 4. Observations (not findings)

1. **One type escape introduced:** the fix for the 16 diagnostics added `.filter(Boolean) as any[]` in `packages/mpd-silicon-bootstrap-plugin/test/skills.test.ts` — the only `as any` shape in `git diff bb84030..HEAD`. The rest are test-local `!` assertions (`loaded!`, `r.outBinary!`, `vcs.filelistPath!`, `resultsXml!`) and one `as { rank?: unknown }` probe cast; no `@ts-ignore`/`@ts-expect-error`, and assertion semantics are unchanged (`expect(loaded.rank).toBeUndefined()` → `expect((loaded as {rank?: unknown}).rank).toBeUndefined()`). Worth narrowing later; not blocking.
2. **The object moved mid-review, and the delta closed my former §4 observation 2.** `AGENTS.md` went `07b92ce` (265 lines, `b122262c…`) → `0738a3d` (268 lines, `a8f94c91…`) while this re-review was being written. The only change is the row-id section: it now states that all three collision classes are **closed between the two bundles as they stand today** and that the taxonomy is for a third plugin or an older mpd. I verified the three claims (service split `siliconDsh`; no `mpd-verif` row left in mpd; `serverName: silicon_lsp`) plus the coexistence re-test logs — so the pre-split `mpdDsh` symptom is no longer presented as a live hazard. My earlier "mark it as historical" request is thereby satisfied.
3. **Other new claims verified true:** the Boot-check recipe (`dsh plugin --profile qa add <repo>` + `--no-open --port 0`) matches how t13 measured it; §9's "the `rtl-ip` carrier hook is not landed" is true (no file in mpd references `rtl-ip.profile.json`; mpd `presets/` holds only `mpd`; mpd's patch has no `rtl-ip`); §3's `mpd-verif-plugin/evidence/smoke` and adapter `test/adapter.test.ts` both exist; §10's cited files exist.

---

## 5. Re-run evidence (HEAD `0738a3d`, all read-only)

| Command | Result |
|---|---|
| `bun test packages/` | `131 pass / 0 fail / 845 expect / 12 files` (1 explicit skip: the source-checkout corpus cross-check) |
| `node scripts/verify-corpus.mjs` | exit 0 · `PASS — 10 check(s) passed, 3 skipped` (each skip prints its reason) |
| `node scripts/verify-rows-disjoint.mjs` | exit 0 · `silicon ∩ mpd = ∅` |
| `node scripts/pack-silicon.mjs --check` | exit 0 · whole tree readable by a non-root consumer |
| `node scripts/pack-silicon.mjs --self-test` | exit 0 · negative controls bite (600→644 counted, package-set guard) |
| `node scripts/build-lsp.mjs --check` | exit 0 · `04b49f8c… (235271 B)` vs BUILD.lock, both HDL registry entries, overlay anchor |
| `node scripts/typecheck.mjs` | exit 0 · `PASS — no diagnostics (local tsgo)` |
| `node scripts/typecheck.mjs --self-test` | exit 0 · TS2322 caught + healthy control clean |

Every **read-only** gate declared in §4 of the manual is green at this revision (`--fix`/Pack write files and were not run, per the "only this report" discipline; `--check` proves the tree compliant).

## 6. Reproduction commands

```bash
SIL=/root/dshProj/my-power-dsh-silicon; MPD=/root/dshProj/my-power-dsh
sha256sum $SIL/AGENTS.md                                   # a8f94c91…
for c in "pack-silicon.mjs --self-test" "verify-corpus.mjs --self-test" "verify-rows-disjoint.mjs --self-test" \
         "build-lsp.mjs --self-test" "typecheck.mjs --self-test"; do node $SIL/scripts/$c; echo "$c exit=$?"; done   # N1 → five

# N2: evidence language census
for f in $(git -C $SIL ls-files 'evidence/**' | grep '\.md$'); do echo "$f $(grep -c '[一-龥]' $SIL/$f)/$(wc -l < $SIL/$f)"; done
grep -n 'language as produced' $MPD/AGENTS.md              # baseline stance

# N3: HDL ownership
ls $SIL/packages/mpd-mcp-lsp/references/                   # verilog systemverilog
ls $MPD/skills/lsp-setup/references/ | wc -l               # 20 (no HDL dirs)
ls -d $MPD/skills/lsp-setup/references/{verilog,systemverilog} 2>&1   # No such file
grep -n 'mpd-mcp-lsp/references' $MPD/skills/lsp-setup/SKILL.md

# N4/N5: git reality
git -C $SIL branch -a; git -C $SIL log --oneline | wc -l; git -C $SIL log --merges | wc -l
git -C $SIL log --oneline --all | grep -i 'lsp-setup' || echo "(not in this repo)"

# N6: typecheck short-circuit
mkdir -p /tmp/tc/scripts /tmp/tc/packages/p/src && cp $SIL/scripts/typecheck.mjs /tmp/tc/scripts/ && cp $SIL/tsconfig.json /tmp/tc/
printf 'export const y: number = "boom"\n' > /tmp/tc/packages/p/src/index.ts
cd /tmp/tc && node scripts/typecheck.mjs; echo "default exit=$?"; node scripts/typecheck.mjs --require; echo "--require exit=$?"

# §2 row-id closure claims
grep -n 'export const SERVICE_NAME' $SIL/packages/mpd-dsh-adapter-plugin/src/index.ts      # siliconDsh
grep -n 'mpd-verif' $MPD/packages/mpd-bundle/cordis.patch.yml || echo "(mpd has no RTL row)"
grep -n 'serverName' $SIL/packages/mpd-bundle/cordis.patch.yml
```

## 7. Conclusion

- **Ten findings: 10/10 closed.**
- **Equivalence: achieved, stronger in several clauses** (gate table 6→10 rows, a real and falsifiable Types gate, explicit language-policy coverage/exemptions, restored §6, traceable §10 provenance, and the row-id taxonomy now framed against the actual bundle state).
- **Verdict `needs_revision`** is not about weakened requirements: three medium factual/self-consistency defects remain in the binding manual (N1 count, N2 evidence-language clause vs the repo's own files, N3 inverted HDL ownership, N4 non-existent `dev` branch/merge rule) plus two low wording/item defects (N5/N6). All are **local text edits** (about six edits; no code or gate change needed).
- A pure text pass can be re-reviewed quickly; if wanted, I can re-run only `typecheck`/`corpus` to confirm the N1/N6 wording matches behaviour.

---

## Summary (中文摘要)

- **原 10 条 findings 全部闭环（10/10）**，等价性达成且多处更强：门禁表 6→10 行、Types 门禁真实可跑且带负控、语言政策覆盖与豁免显式化、§6 补齐、§10 provenance 可追溯。复检期间手册又前进一版（`07b92ce`→`0738a3d`）：新增的 row-id 段把三类碰撞标注为"当前两 bundle 之间已闭合"，我逐条核实（`siliconDsh` / mpd 已无 `mpd-verif` 行 / `serverName: silicon_lsp` + 共存复测日志），我上一轮的观察 2 由此关闭。
- **Verdict = `needs_revision`**：仍余 3 medium + 2 low 属新文本的事实/自洽问题 —— N1 §4 写"四个负控"实际五个（漏 typecheck，且 Types 行未标 `--self-test`）；N2 `evidence/**` 英文条条款与仓库自身 5 份中文为主的 evidence 冲突（含 §10 引用的 t12 报告）；N3 §9 "HDL pages live in the @mpd-dsh/mpd repo" 与实际（页在本仓，mpd 只保留路由行）相反；N4 §5 分支表把源仓库的 `dev` 当本仓工作分支、master"只接受 merge"与本仓 14 提交 0 merge 不符；N5 示例 `chore(lsp-setup)` 不在本仓历史；N6 §9 typecheck "fails either way" 与实现的"无类型根直接短路 SKIP"不符。均为局部文本修正（约 6 处），改完可快速复检通过。
- 本报告按手册自身的语言政策以英文书写（仅保留本摘要块）；此前被并入 `0738a3d` 的中文草稿由本文件替代。
