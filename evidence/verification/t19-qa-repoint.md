# t19 — RTL QA cases repointed at the silicon bundle + documentation follow-through

- Executor: Lead (captain-dispatched out-of-band; t19 is unschedulable because its dependency t5 is terminal-failed)
- Date (UTC): 2026-09-12T17:3xZ
- Scope: the two mpd-side RTL QA cases, the six ported RTL documents, the A6/A7 mapping rows, path portability, and the reference-resolution gate.

## 1. Why the repoint was needed

t5 removed the RTL surface from `@mpd-dsh/mpd` (commit `12291a7`). Both QA cases still read the
mpd-side layout, so after the strip they failed by design and `test:qa` skipped them as
known-stale — the end-to-end coverage of the RTL rows was effectively zero.

Repointed both at the silicon bundle. Root resolution: `$MPD_SILICON_ROOT`, else the sibling
checkout `../my-power-dsh-silicon`.

## 2. `skills/dsh-qa/scripts/rtl-verif.mjs`

| Aspect | Before | After |
| --- | --- | --- |
| Plugin dist | `mpd/packages/mpd-verif-plugin/dist/index.js` | `<silicon>/packages/mpd-verif-plugin/dist/index.js` |
| Patch assertions | mpd patch: exactly one ACTIVE `mpd-verif` row + commented wave rows + devPatch rewrite of packed names | silicon patch: 4 additive rows (`silicon-dsh-adapter/bootstrap/verif/mcp-lsp`), **zero id-targets**, no checkout-absolute path |
| Corpus assertions | — | silicon `skills/`: exactly the three trees, file counts 9/6/20 |
| Profile assertion | — | silicon `presets/rtl-ip.profile.json`: 7 members + `STAGE 0`/`IP01`/`STAGE 4` |
| HDL LSP registry | hard-asserted on mpd `packages/mpd-mcp-lsp/dist/cli.js` | asserted when the silicon asset exists; otherwise an **evidenced skip** (owner t16, row ships `disabled: true`) |
| PHASE 1 | headless boot of a dev-patched mpd patch | isolated `dsh plugin --profile rtl-verif-qa add <silicon>` + `--dump-config`: all four rows composed, no duplicate loader id, and the stale `mpd-verif` row must be absent |
| PHASE 2 | real verilator + cocotb on a golden adder | unchanged in spirit, now against the silicon dist; backend is the first present of verilator/iverilog, and the cocotb segment skips with a printed reason when no project venv carries cocotb |

Offline self-test (exit 0):

```
[rtl-verif] SKIP: HDL LSP registry not asserted: <silicon>/packages/mpd-mcp-lsp/dist/cli.js not present yet (task t16; the row ships disabled:true by design)
[rtl-verif self-test] ok: golden fixture + silicon patch (4 additive rows, no id-target, no absolute path) + eight-tool dist surface + iron-rule strings + three corpus trees + preset profile (1 group(s) skipped — see SKIP lines)
```

Real pass (exit 0) — evidence `mpd/evidence/dsh-qa/rtl-verif/2026-09-12T17-32-57.308Z/`:

```
"ok": true, "rowsComposed": true, "duplicateLoaderId": false, "staleMpdVerifRow": false,
"realHomeUntouched": true, "venvCocotb": "2.1.0", "lintOk": true, "simOk": true,
"regressPassed": 1, "resultsXml": true, "vcd": true, "noFst": true, "makefileFlow": true,
"systemPythonCocotbFree": true, "flow": "verilator lint=true sim=true regress=true venv=ok", "skips": []
```

## 3. `skills/dsh-qa/scripts/rtl-ip-profile.mjs`

| Aspect | Before | After |
| --- | --- | --- |
| Profile source | mpd patch text (`rtl-ip:` inline) | silicon `presets/rtl-ip.profile.json` (data-only design asserted: the patch must NOT define the profile) |
| Patch assertions | — | 4 additive rows, zero id-target |
| Skill/docs | mpd `skills/rtl-ip-flow`, mpd `docs/` | silicon `skills/rtl-ip-flow` (SKILL.md + 8 templates), silicon `docs/` bilingual guide |
| Real pass | mpd `install-profile.mjs` + `mpd-headless` | isolated `dsh plugin add <silicon>` + `--dump-config`; rtl-ip visibility is asserted **when present** and otherwise a printed SKIP naming the t15 carrier |

Offline self-test (exit 0): `ok: silicon preset (7 members + taskPlanning + STAGE 0/IP01/STAGE 4) + 4 additive rows / id-target-free patch + skill + 8 templates + bilingual guide`.

Real pass (exit 0) — evidence `mpd/evidence/dsh-qa/rtl-ip-profile/2026-09-12T17-31-16.275Z/`:

```
[rtl-ip-profile] SKIP: rtl-ip is not in the composed config: the mpd-side carrier (task t15) has not landed, and this bundle ships the profile as DATA only — the offline self-test covers the definition
[rtl-ip-profile] skipped-rtl-ip-carrier -> …
[rtl-ip-profile] PASS
```

## 4. `test:qa` re-enabled

`package.json` `test:qa` no longer skips the two cases; `bun run test:qa` runs them live and the
gate exits 0 (`all self-tests passed`), with the LSP group skipped until t16.

## 5. Six ported documents — fidelity record

Byte-fidelity against the source before reference fixes, measured today:

| File | sha256 (16) source | sha256 (16) silicon | Status |
| --- | --- | --- | --- |
| `rtl-ip-flow-guide.md` | `e78650968b205352` | `e78650968b205352` | byte-identical |
| `rtl-ip-flow-guide.zh-CN.md` | `f786e0180966df3e` | `f786e0180966df3e` | byte-identical |
| `rtl-verif-guide.md` | `b763ba9a74b4aa88` | `c6b33b2bb25622d1` | reference-only diffs (3 hunks) |
| `rtl-verif-guide.zh-CN.md` | `eb7951d127d156c0` | `47865b948e790878` | reference-only diffs (2 hunks) |
| `rtl-gap-assessment.md` | `eeec2c26828084a0` | `817142e733cdf754` | reference-only diffs (2 hunks) |
| `rtl-gap-assessment.zh-CN.md` | `a3d7b4a758c5ce4b` | `b59d15daf2b5f635` | reference-only diffs (2 hunks) |

Every differing hunk was inspected and is ownership/wording only — e.g. "silicon-owned; the
MCP-LSP assets land with task t16", "this bundle's `packages/mpd-bundle/cordis.patch.yml`",
"(this repository)". No technical content was rewritten.

## 6. Reference-resolution gate (new)

`mpd/scripts/verify-rtl-references.mjs` (`bun run verify:rtl-refs`) resolves every path reference
in the six docs and the two repointed cases, three-bucket:

```
[rtl-refs] silicon: /root/dshProj/my-power-dsh-silicon | references: 48
  resolved: 46
  pending (historical): skills/rtl-dev — proposed in the preserved gap assessment and never created …
[rtl-refs] PASS — 46 resolved, 2 pending-by-design, 0 unresolved
```

Self-test runs positive/negative/owner controls (a bogus path must be caught, a t16 path must be
classified pending, an existing path must resolve) plus the live audit. Lives under `scripts/`
(NOT `skills/**`) so the VENDOR_LOCK fingerprint is not perturbed by the gate itself.

Pending buckets are named with owners: `packages/mpd-mcp-lsp/**` and `docs/{adder4,cnt8}.md` → t16;
`skills/lsp-setup/references/**` → t17; `skills/rtl-dev` → historical proposal in a document kept
verbatim.

## 7. Portability sweep

- `docs/rtl-docs-port-record.zh-CN.md` was the last repository file carrying a literal
  `/root/dshProj/my-power-dsh` path (in an explanatory naming note); rewritten to the English
  twin's portable wording ("the sibling directory `my-power-dsh`").
- Residual matches for `/root/dshProj/...` remain only in `.mpd/team/**` (team state, not repo
  content) and in `evidence/**` (measured run records) — both outside the shipped documentation.

## 8. Mapping updates (t4's documents — status/location columns only)

- **A6**: unchanged (already "landed"); its location column already points at `docs/` + the port record.
- **A7**: status `pending (unassigned)` → **landed (t19: repointed at the silicon bundle)**, with the
  notes column rewritten to describe the silicon targeting and the evidence column carrying both
  self-tests plus the real-pass outcomes. Mirrored in `.zh-CN.md`.
- Gate rows 9/10: `0 then, 1 now` → `0 then, 1 after the strip, 0 again after the t19 repoint`,
  with the historic failure text kept so the record stays honest.

## 9. Known intermediate state (not a defect)

`node scripts/verify-vendor.mjs` in the mpd repo reports **`FAIL - asset skills treeSha mismatch`**
after these edits: two files under `skills/dsh-qa/scripts/` changed content. `fileCount` is
unchanged (no file added or removed under `skills/`), so the deferred re-pin arithmetic is
unaffected (**329** after t17 removes the two orphan HDL READMEs). Owner: **t17** — and the re-pin
must be taken *after* this commit, since the tree hash it records has to match the final tree.

## 10. Reproduce

```bash
M=/root/dshProj/my-power-dsh; S=/root/dshProj/my-power-dsh-silicon
cd $M
node skills/dsh-qa/scripts/rtl-ip-profile.mjs --self-test    # exit 0, offline
node skills/dsh-qa/scripts/rtl-verif.mjs --self-test         # exit 0, LSP group skipped (t16)
bun run verify:rtl-refs                                      # PASS: 0 unresolved
bun run test:qa                                              # both RTL cases live
node skills/dsh-qa/scripts/rtl-ip-profile.mjs                # real pass: skipped-rtl-ip-carrier
node skills/dsh-qa/scripts/rtl-verif.mjs                     # real pass: ok=true (lint+sim+regress)
cd $S && node scripts/pack-silicon.mjs --check               # PASS
```
