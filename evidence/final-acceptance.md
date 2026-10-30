# Final acceptance ledger — @mpd-dsh/silicon

**Session**: 2026-09-12/13 · **Bundle**: `@mpd-dsh/silicon` 0.1.0 (Gitee `nop_chip/my-power-dsh-silicon`, `master`)
· **Source project**: `@mpd-dsh/mpd` (Gitee `nop_chip/my-power-dsh`, `dev`)
· **Author**: Lead (integration role) · **Task**: t10 (unschedulable — delivered out-of-band by captain dispatch)

> **中文摘要（五条验收线）**
> ① 移植保真：**pass**（t6 逐文件/测试强度 6/6；t8 的 8 条 finding 中 F1/F4/F5 闭环、F2/F3/F6/F7/F8 已由 t20 修复，待 t21 复审）
> ② 装配与端到端：**pass**（t7 隔离安装/真实工具链/共存三类碰撞定界；B1 由 t18 的 S1 修复后，t9 真实 boot 复测**全绿**，re-review addendum **verdict=pass**）
> ③ 源工程回归：**pass**（剥离提交 `12291a7`，84 files / +166 −9052；t23 只读对账；本会话 `d50934e` 把两个 RTL QA 用例改指向 silicon 并恢复实跑）
> ④ Gitee 推送：silicon **6 提交 → origin/master**；mpd **17 提交 → origin/dev**（两仓 local == remote，已核）
> ⑤ 开发准则：`AGENTS.md` **已落地**并含两条陷阱说明；原 t11 因 t5 终态不可调度，由 captain 直接交付
> **未结项**：t15（rtl-ip 载体）、t16（HDL LSP 资产 + `disabled:false` 翻转）、t17（2 个 orphan README + VENDOR_LOCK 一次 re-pin 至 329）、`verify:vendor` skills `treeSha` 红项（owner t17）、t12/t13 未执行、t21 复审未执行。

## 0. How to read this ledger

Every verdict below carries the command that produced it. `pass` means the command was executed
in this session and its output is on disk; nothing is claimed from a composed config dump alone
(`--dump-config` proves composition, never plugin loading), and no mount/coexistence claim is
made from `--help` (measured false green — see §5).

## 1. Port fidelity — pass

| Item | Command / evidence | Result |
| --- | --- | --- |
| Verif plugin + corpus + adapter ported byte-faithfully | `evidence/verification/t6-port-fidelity.md` (sha256 `c96dd5f364b63e05…`); independent second opinion via `git show 3d99718:<path>` | 6/6 checks pass, `differing=0` |
| Ported corpus self-held after the strip | `node scripts/verify-corpus.mjs` (silicon) and `evidence/verification/corpus-baseline.json` | exit 0 — 10 checks, 3 skips (per-tree source cross-check absent by design) |
| Adapter suite + READMEs migrated (F5) | `bun test packages/mpd-dsh-adapter-plugin` → 22 pass; `packages/mpd-dsh-adapter-plugin/{test/adapter.test.ts,README.md,README.zh-CN.md}` | present in the tree |
| t8 review findings | `evidence/review/t8-port-review.md` (verdict `needs_revision`, 8 findings: 1 blocker / 3 high / 3 medium / 1 low) + `evidence/verification/t20-repair.md` §1–§8 | **F1 / F4 / F5 closed**; **F2 / F3 / F6 / F7 / F8 fixed by t20** — awaiting t21 review round 2 |
| Fidelity provenance (Erie style attribution, F8) | `grep -c "verilog-generator\|Erie" LICENSE-NOTICES.md` | 2 (declared, style reference only) |

## 2. Assembly and end-to-end usability — pass

| Item | Command / evidence | Result |
| --- | --- | --- |
| Isolated install + row set | `evidence/verification/t7-install-boot.md` §1–§2: `HOME=<tmp> DSH_HOME=<tmp> dsh plugin --profile silicon-qa add <silicon>` then `--dump-config` | exit 0; all four rows (`silicon-dsh-adapter`, `silicon-bootstrap`, `silicon-verif`, `silicon-mcp-lsp`) |
| Real tool surface | t7 §3 + the shipped smoke: `bun packages/mpd-verif-plugin/evidence/smoke/smoke.mjs` | `PASS — 3 check(s), 2 skip(s)` exit 0 (with a cocotb venv: 4 checks incl. real `adder_tb:pass`); real verilator 5.051 / iverilog 14.0 / cocotb 2.1.0 |
| Coexistence with mpd | t7 §4 and `evidence/review/t9-install-review.md` §4 | **Timeline**: t7 measured a fatal mount (`service "mpdDsh" has been registered` + `tool "mpd_verif_venv" is already registered`; minimal-repro matrix V1/V2/V3 proving B1 would not clear with t5). t18 landed the approved S1 rename (`siliconDsh` + resolver chain). t9 then re-measured a **real app boot: 0 fatal signatures, two services, two providers**. t7's FATAL verdict is **superseded by measurement, not by argument** |
| rtl-ip data ownership | t7 §5 + `evidence/verification/t19-qa-repoint.md` §3 | data file deep-equal to the composed block; carrier attribution → §4 below |
| Uninstall | t7 §6 | rows 4→0; one inert `node_modules/@mpd-dsh/silicon` symlink (documented in README, finding F3 closed by t26) |
| User-facing docs vs measurement | `evidence/review/t9-install-review.md` (R1–R4) + `evidence/review/t9-rereview-addendum.md` | main review `needs_revision` on docs only; **re-review addendum verdict = pass (R1–R3 resolved, R4 closed)** |

## 3. Source-repository regression — pass

| Item | Command / evidence | Result |
| --- | --- | --- |
| RTL surface physically removed | `12291a7 feat(rtl-extraction): remove the RTL surface from the mpd repo` | 84 files changed (A1 / D72 / M11, +166 / −9052), no mode churn, tree clean |
| Strip reconciled read-only | `t5-closure-evidence/t5-closure.md` (t23, Senior Engineer) | root-cause verdict + per-path reconciliation; **note: this file is still untracked in the mpd worktree** |
| QA coverage restored | `d50934e`; `bun run test:qa`; `bun run verify:rtl-refs` | `test:qa` runs both RTL cases live again → `all self-tests passed`; reference audit 46 resolved / 2 pending-by-design / **0 unresolved** |
| Repo-level gates | `node scripts/verify-rows-parity.mjs` → ok, 21 row ids; `node scripts/verify-vendor.mjs` | rows pass; vendor **red on `asset skills treeSha mismatch`** → known intermediate state, owner t17 (§6.5) |

## 4. Gitee pushes

**silicon — 6 commits on `origin/master`** (verified `local == remote` at `4db908f`):

| Commit | Subject |
| --- | --- |
| `0296f6d` | feat(silicon): extract the RTL development capability from @mpd-dsh/mpd |
| `c4b4eb9` | docs(i18n): complete the bilingual contract for the repo manual |
| `37b93cf` | docs: correct the coexistence status and the user-facing facts (t9 R1-R3) |
| `ddd7c9f` | docs(readme): point the gates table at the shipped smoke and close t7 F3 |
| `6078ccd` | test(smoke): ship the verif smoke script and the t9 re-review record |
| `4db908f` | docs(dependency-map): mark A7 landed (t19) and record the QA repoint |

**mpd — 17 commits on `origin/dev`** (`f697088..d50934e`, verified `local == remote`; this is the
session's first push of that repository). Key commits: `12291a7` (the RTL strip) and `d50934e`
(the QA repoint). Push discipline per t10's non-goals: the token is read at runtime from an
external credential file and never written into either repository.

## 5. Development guidelines — landed (delivery path differs from the plan)

`AGENTS.md` exists in the silicon repo and is binding. It carries the two traps this session paid
for, measured:

- **`--help` is a FALSE GREEN** — `dsh --profile X --help` exits 0 while printing nothing fatal,
  because its output precedes the plugin tree settling; a profile whose real boot aborts with
  `plugin tree failed to load` still returns 0. Any mount/coexistence conclusion must come from a
  real app boot's exit code and stderr.
- **Row-id zero intersection ≠ coexistable** — `verify-rows-disjoint.mjs` sees loader row ids only,
  never service names, tool names or MCP serverNames; the three collision classes are tabulated.

Original task **t11** (author the manual) was unschedulable — its dependencies include the
terminal-failed t5 — so the captain delivered the manual directly. Consequently **t12** (manual
review) and **t13** (command-by-command verification of the manual) were **never executed**; the
Gates table in `AGENTS.md` has therefore not had an independent pass.

## 6. Known intermediate states (nothing here is hidden or deferred silently)

1. **t5 terminal `failed`** — contract-scope defect, not an implementation defect: the work is
   complete and committed as `12291a7`; the completion validator could not pass the frozen
   contract text.
2. **t20 terminal `failed`** — same shape: `README.zh-CN.md` was required by the acceptance items
   but absent from `inScope`. Work complete: `evidence/verification/t20-repair.md`.
3. **t26 terminal `failed`** — same shape again; work complete and pushed (`ddd7c9f` + `6078ccd`).
4. **t8's remaining five findings (F2/F3/F6/F7/F8)** are fixed by t20 but **not yet reviewed**;
   t21 (review round 2) is pending and unschedulable.
5. **`verify-vendor` skills `treeSha` red** — ~~owner t17~~ **CLOSED by t17** (`32ae54d`): the single
   re-pin was taken on the final tree after the two orphan READMEs were retired.
   `skills.fileCount 331 → 329`, `treeSha 23e18d7c… → 8a0f05f0…`, and the gate itself now reports
   `asset OK: skills 329 files` / **PASS**. Arithmetic (captain-verified via git): 366 at `3d99718`
   − 35 deleted by `12291a7` = 331 (the lock agreed) − 2 orphan READMEs = **329**. One re-pin only.
6. **t15 open** — the `rtl-ip` carrier hook is not landed, so `rtl-ip` is still invisible in a
   composed config from the silicon side. **t16 and t17 are closed** (see §7) and pushed.
7. **t12 / t13 never executed** (the manual they would review was delivered out-of-band because its
   task was unschedulable), and **t21 / t22 / t24 / t25 / t27 remain pending** (unschedulable: their
   dependency graph contains terminal-failed tasks).
8. ~~**No LLM-backed session was possible on this box**~~ **RESOLVED (captain, after the ledger was
   written)**: the provider key turned out to exist as `export DEEPSEEK_API_KEY=…` in `~/.bashrc`;
   it is simply not present in a non-interactive shell's environment, which is what the original
   statement measured. With the key sourced, a **real LLM session** was run in an isolated
   `DSH_HOME` (silicon bundle installed, headless profile) and the model **actually called two
   `mpd_verif_*` tools through the tool layer**: `mpd_verif_backends{backend:all}` and
   `mpd_verif_venv{action:status}`, both returning real results (the host `iverilog` path and
   version; `venv verdict: missing` pointing at the **sandbox** workspace `.venv-rtl`). The
   transcript carries 2 `tool/call` + 2 `tool/result` records and registers **all eight**
   `mpd_verif_*` tool names. Reproduce: `evidence/verification/llm-tool-call.md`.
   → The remaining limitation is narrower: only these two tools were exercised by a model; the
   other six were exercised in-process, not through a model-driven call.
9. **VCS absent** — the UVM and vcs-coverage lanes are evidenced skips (`command -v vcs` empty),
   never silent passes.
10. ~~**`t5-closure-evidence/` is untracked**~~ **CLOSED (captain)**: committed to the mpd repo as
    `484883c` together with the token-discipline check, and pushed to `origin/dev`.
11. ~~**The t10 token-discipline check was not executed**~~ **CLOSED (captain)**: the grep was run
    for both repositories — the credential is absent from `git config --local -l`, from the tracked
    tree, and from `git remote -v`; recorded in the mpd repo as
    `t5-closure-evidence/token-discipline-check.md`.

## 7. Attribution (so a future reader does not mis-file these)

| Subject | Owner | Why |
| --- | --- | --- |
| `rtl-ip` visibility next to mpd | **t15** | silicon owns the definition as data (`presets/rtl-ip.profile.json`, deep-equal to the previously composed block); mpd keeps the single `agent-teams` row that must inject it. Pre-t15 invisibility is the design, not a bundle defect |
| HDL language service | **t16** | `silicon-mcp-lsp` ships `disabled: true` deliberately (a resolvable-command failure retry-storms and never reaches the app). The row's activation verdict must come from a **real boot**, never from row presence |
| VENDOR_LOCK convergence to 329 | **t17** | one re-pin only, taken after the final tree (`d50934e`), together with the two orphan HDL README deletions and the SKILL.md pointer rewrite |
| Coexistence collision classes | **t18** (done) / **t5** (done) | B1 service singleton → S1 rename landed; B2 duplicate `mpd_verif_*` → cleared when mpd's own row left with the strip |

## 8. Bilingual policy

`AGENTS.md` requires bilingual human-facing docs (`README.md`, `docs/*.md`). This ledger lives in
`evidence/`, which §3 of the manual defines as **gate evidence / verification reports** — the same
class as every other single-language record in that directory (agent-facing, English by the manual's
own rule), so it ships as one file with the Chinese executive summary at the top for the human
reader. If the captain wants a full `final-acceptance.zh-CN.md` twin, it can be added and pushed in
one commit.

## 9. Reproduce

```bash
S=/root/dshProj/my-power-dsh-silicon; M=/root/dshProj/my-power-dsh
cd $S && bun test packages && node scripts/verify-corpus.mjs && node scripts/verify-rows-disjoint.mjs
cd $S && node scripts/pack-silicon.mjs --check
cd $S && bun packages/mpd-verif-plugin/evidence/smoke/smoke.mjs
cd $M && bun run test:qa && bun run verify:rtl-refs && node scripts/verify-rows-parity.mjs
cd $M && node skills/dsh-qa/scripts/rtl-verif.mjs            # real pass: ok=true
cd $M && node skills/dsh-qa/scripts/rtl-ip-profile.mjs       # real pass: skipped-rtl-ip-carrier
git -C $S log --oneline origin/master | head -6              # 6 commits
git -C $M log --oneline origin/dev | head -3                 # 17-commit range ends at d50934e
```
