# t9 — review: bundle assembly and end-to-end usability

- Task: t9 (review r1), attempt 1 / attempt_id `2a31f9bd-1c42-4f28-a75c-4da08064b8de`
- Reviewer: Senior Engineer (did not author t3's assembly or t7's verification)
- Subject: `@mpd-dsh/silicon` 0.1.0 at `/root/dshProj/my-power-dsh-silicon`, reviewed against
  `@mpd-dsh/mpd` 0.3.2 at `/root/dshProj/my-power-dsh` **after the t5 strip** (`12291a7`)
- Environment: `dsh 0.1.5-rc.1`, node v24.16.0; iverilog 14.0 + verilator 5.051 present, **vcs absent**
- Isolation: all boots ran under a throwaway sandbox — `HOME=$QA/home`, `DSH_HOME=$QA/home`,
  workspace `cwd=$QA/ws` (three layers). The real `~/.dsh` was never used.
- Write discipline: the only file written by this review is this report. No repository file was
  modified; no source-repo file was touched.

## Verdict

**needs_revision** — the bundle itself passes every hard claim I re-measured (isolated install,
row set, real tool call, **coexistence now GREEN**, uninstall behaviour), but the repository's
**user-facing README contradicts the measured state in three places**, and one of them tells a
user that the supported two-bundle configuration fails when it demonstrably works. Those are
documentation defects with named fixes; nothing in this review requires an implementation change.

## 1. Hard claims re-measured independently

Each claim was re-run in a fresh sandbox rather than read from t7's log.

### 1.1 Isolated install — PASS (reproduced)

```
$ HOME=$QA/home DSH_HOME=$QA/home dsh plugin --profile coexist add /root/dshProj/my-power-dsh          → exit 0
$ HOME=$QA/home DSH_HOME=$QA/home dsh plugin --profile coexist add /root/dshProj/my-power-dsh-silicon  → exit 0 (link:)
```

`dsh plugin add` creates the profile itself; the README's "isolated profile" recipe works as
written. A silicon-only profile was also created and dumped successfully (`silicon-test`).

### 1.2 Row set — PASS (reproduced)

`dsh --profile coexist --dump-config` → exit 0, 606 lines: **4 `silicon-*` rows** and **21 mpd
rows** coexist in one composed config. The four silicon rows match t3's delivered patch.

### 1.3 Real tool call — PASS (independent method)

I could not re-run t7's smoke harness verbatim: it used the **source repo's**
`packages/mpd-verif-plugin/evidence/smoke/smoke.mjs`, which the t5 strip deleted
(`t7 §3`'s borrowed-asset caveat, F4, is now a hard limitation — silicon still ships no smoke
script). Instead I loaded the **delivered silicon dist** and invoked its tools directly:

```
registered tools: 8 -> mpd_verif_venv, mpd_verif_backends, mpd_verif_compile, mpd_verif_lint,
                      mpd_verif_coverage, mpd_verif_sim, mpd_verif_uvm, mpd_verif_regress
mpd_verif_backends -> {"ok":true,"backends":[{"backend":"iverilog","binary":"/opt/osscad/oss-cad-suite/bin/iverilog",
                      "source":"path","present":true,"version":"Icarus Verilog version 14.0 (devel) …
mpd_verif_venv.status -> {"ok":false,"verdict":"missing","venv":"…/my-power-dsh-silicon/.venv-rtl", …
```

Real structured results, real host probing (`source: "path"`, true iverilog version), and the venv
tool correctly reports the silicon workspace's `.venv-rtl` as missing. **All 8 tool names present.**

### 1.4 Coexistence — **GREEN (t7's FATAL finding is obsolete)**

This is the claim that changed since t7. t7 measured `failed to apply loader entry` from a
`service "mpdDsh" has been registered` collision (F1) plus a `tool "mpd_verif_venv" is already
registered` duplicate (F2). I re-ran the same configuration in a clean sandbox:

```
$ HOME=$QA/home DSH_HOME=$QA/home dsh --profile coexist --no-open --port 0
  [mpd-dsh-adapter] mpdDsh provided (harness seams resolved lazily, inject-free)
  [mpd-dsh-adapter] siliconDsh provided (harness seams resolved lazily, inject-free)
  [mpd-bootstrap] skill corpus served from …/my-power-dsh/skills (provider mpd-bundle, bundle 0.3.2)
  [mpd-silicon-bootstrap] skill corpus served from …/my-power-dsh-silicon/skills (provider silicon-bundle, bundle 0.1.0)
  CodeGraph MCP skipped: project excluded by OMO CodeGraph policy.
```

| Signal | Count |
| --- | --- |
| `failed to apply loader entry` | **0** |
| `already registered` / duplicate loader entry id | **0** |
| `plugin tree failed to load` | **0** |
| service providers registered | **2** (`mpdDsh` + `siliconDsh`) |
| skill providers registered | **2** (`mpd-bundle` + `silicon-bundle`) |

The boot then ran as a server until my 100 s timeout killed it (exit 124) — expected for a
long-running app, and irrelevant here: the plugin tree settles and prints within the first
seconds, and every assertion above was already satisfied. **F1 and F2 are both closed: S1 is on
disk** (`adapter src:446 SERVICE_NAME = "siliconDsh"`; consumers chain
`ctx.get("siliconDsh") ?? ctx.get("mpdDsh")` at `bootstrap:348` and `verif:35`; all three dists
carry exactly one `siliconDsh`), and mpd's `mpd-verif` row is gone after t5. I confirmed the
`--dump-config` vs real-boot distinction myself: the dump looked equally clean before the fix
(t7 §4.5) and after it — the dump alone would never have shown this.

### 1.5 Uninstall — functional PASS, the inert symlink persists

`dsh plugin --profile silicon-test remove @mpd-dsh/silicon` → rows **4 → 0**;
`dsh.profile.bundles` back to `["@deepseek-ai/dsh-base"]`. Residual
`node_modules/@mpd-dsh/silicon` symlink is **still there** — t7's F3 reproduces exactly, and the
README's "the rows and the skill corpus go away with it (nothing was copied into `$DSH_HOME`)"
is accurate about *content* but does not mention the leftover link (see finding F3).

### 1.6 rtl-ip profile data — PASS for the delivered scope

The carrier is not silicon's (by design): silicon's patch has **zero id-targets** and only
`insert` blocks, so the `agent-teams` row and its `config.profiles` remain mpd-owned. I verified
the delivered artifact instead: `presets/rtl-ip.profile.json` parses to **7 members**,
`taskPlanning: captain`, and the composed dump carries exactly one `rtl-ip:` block with all seven
member names present (Requirement Analyst, Spec Designer, RTL Code Engineer — Verilog/SV, RTL
Code Engineer — SpinalHDL, Verification Engineer, Reviewer, Plan Reviewer). A silicon-only profile
contains **no** `rtl-ip:` at all — matching the README's "installing silicon alone does not make
rtl-ip visible — by design, until t15". **Not a defect; t15 owns activation.**

## 2. t7 report spot-check (three-plus commands, consistency)

| t7 claim | Re-measured | Consistent? |
| --- | --- | --- |
| §1 `plugin add` exit 0 and auto-creates the profile | exit 0, `link:` recorded, profile created | yes |
| §2 `--dump-config` exit 0, 4 silicon rows | exit 0; 4 silicon rows (in a 606-line two-bundle dump) | yes |
| §3 8 `mpd_verif_*` tools, real backends probe | 8 tools; real `iverilog … 14.0` result | yes (different method, see 1.3) |
| §7 `verify-rows-disjoint` exit 0 + `--self-test` exit 0 | both exit 0 | yes |
| §4.2/§4.3 coexistence FATAL, B1/B2 attribution | **stale**: now GREEN, both blockers closed | **superseded** — correctly evidenced at the time |

**Skips judged:** the VCS-absent skip is legitimate — `vcs` is genuinely not installed, and t7
labels it an *evidenced skip*, explicitly not a pass; the UVM/coverage lanes are thereby
unverified, which I record as a residual boundary (§3.3), not as a defect. The
`silicon-mcp-lsp disabled: true` state is a pinned design decision (its comment records why: a
retry-storming stdio row aborts the boot), and t16 flips it — also legitimate.

## 3. Blind-spot conclusions (beyond t7)

1. **Blind spot — the corpus cross-check is now permanently blind in a second way.**
   `bun test packages` reports one skip, visibly: `cross-check: byte-identical to the source
   checkout at …/skills (0/3 trees present)` (`test.skipIf` at `skills.test.ts:141`). The hard
   gate that replaced it — sha256 against the committed baseline — still bites (I verified all 35
   manifest entries independently), so this is a *named* loss, not a silent pass. Recorded here so
   no future report treats the green suite as covering the live cross-check.
2. **Blind spot — the S1 service rename is a compatibility break for third-party consumers.**
   The silicon adapter now provides `siliconDsh`, and its own plugins chain
   `siliconDsh ?? mpdDsh`. That is correct for a standalone install and for coexistence, but any
   future plugin that hard-codes `ctx.get("mpdDsh")` and expects silicon's adapter will silently
   fall back to `createDshAdapter(ctx)`. Both current consumers carry the chain (verified), so the
   risk is forward-looking only — worth a line in the authoring guidance.
3. **Blind spot — `silicon-mcp-lsp` is declared but never exercised.** Its row is composed and
   disabled, with assets pending t16; nothing today proves that when t16 flips `disabled: false`
   the `serverName: silicon_lsp` row actually resolves its stdio command. I flag it explicitly as
   unproven so the t16 commit is judged on a real boot, not on the row being present.
4. **Blind spot — row-id reversal risk.** `verify-rows-disjoint` compares two patch files. If a
   future mpd release re-introduces an RTL row (or reclaims an id such as `silicon-verif`), the
   gate catches the id collision only when both files are on disk; the service/tool/serverName
   classes it cannot see (t7 §4.5) remain the ones that actually abort boots.

## 4. README walkthrough (read the README, did what it says)

| README instruction | Result |
| --- | --- |
| `export DSH_HOME=$(mktemp -d)`; `dsh plugin --profile silicon-test add <path>`; `--dump-config` | works — 4 silicon rows |
| "into an existing profile" | works (coexist profile) |
| `dsh plugin … remove @mpd-dsh/silicon` — rows and corpus go away | works (rows 4 → 0); leftover symlink undocumented |
| `node scripts/build.mjs` | present and executable (755) — not rebuilt here (would touch dist) |
| `bun test packages` — "106 tests (verif plugin suite)" | **runs, but the number is wrong** (see F2) |
| `node scripts/verify-rows-disjoint.mjs` (+ `--self-test`) | both exit 0 |
| `scripts/*.mjs` are directly runnable (755) | confirmed for all four |

## 5. Findings

| ID | Severity | Problem | Required fix |
| --- | --- | --- | --- |
| **R1** | **high** | The README tells users that mounting both bundles **fails**: "Measured today: mounting both fails with `service "mpdDsh" has been registered` … `tool "mpd_verif_venv" is already registered`" (README:42-47), and the Status section still lists "the `mpdDsh` service singleton blocks both-bundles mounting until it is renamed in the silicon copy (captain decision)" (README:160-161). **Both statements are false as of this review**: S1 is on disk and coexistence boots clean (2 services, 2 providers, 0 apply failures, co-measured in §1.4). A user reading this would avoid the very configuration that is now supported. | Rewrite README:42-47 and README:158-163 to state the measured truth — coexistence works after the S1 rename (service `siliconDsh`) plus the t5 strip; keep the historical collision description as a one-line "what used to break and why" note. Mirror in `README.zh-CN.md` (language policy: same commit). |
| **R2** | **medium** | README:70 advertises `bun test packages` as "**106 tests** (verif plugin suite)". Measured now: **131 tests, 130 pass, 0 fail, 1 skip** across 12 files (the skip is the source-checkout cross-check, §3.1). The number is stale and its parenthetical is wrong (the suite now spans three packages). | Update README:70 (and `README.zh-CN.md`) to the measured counts and drop the "verif plugin suite" wording. |
| **R3** | **low** | README:63-64 says uninstall makes rows and corpus "go away with it", omitting the `node_modules/@mpd-dsh/silicon` symlink that `plugin remove` leaves behind (reproduced: §1.5). t7's F3 is still open and user-visible in no other doc. | Add one clause: uninstall removes rows and corpus; a stale `node_modules/@mpd-dsh/silicon` link remains (inert) and can be deleted manually. Record as a known harness-level residue. |
| **R4** | **low** | t7's F4 is now a hard limitation rather than a nice-to-have: the verif smoke harness lived in the source repo and was deleted by t5, so silicon has **no in-repo end-to-end smoke script**; my §1.3 had to drive the dist through a harness I wrote for this review. | Ship a small smoke script under this repo (e.g. `packages/mpd-verif-plugin/evidence/smoke/smoke.mjs`) so the tool call is self-provable without the source checkout. |

**Superseded findings from t7 (no action needed, recorded for closure):** F1 (service collision)
and F2 (`mpd_verif_*` duplicate) are both closed by the S1 rename + the t5 strip, as measured in
§1.4; F3 is carried forward as R3.

## 6. Scope statement

This review ran read-only commands plus boots inside a throwaway sandbox (`/tmp/t9-qa`); it wrote
exactly one file — this report. It did not modify `packages/`, `skills/`, `docs/`,
`cordis.patch.yml`, the source repo, or any real harness home. The verdict above judges the
*delivered* state, not the author's intent, and every number in it is a measurement from this
session.
