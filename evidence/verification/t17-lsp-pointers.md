# t17 — HDL LSP pointers repointed and the single VENDOR_LOCK re-pin

- Executor: Lead (captain-dispatched out-of-band; t17's dependency graph contains the terminal-failed t5)
- Date (UTC): 2026-09-12T18:2xZ
- Subject: retire mpd's two orphan HDL reference pages now that the silicon bundle owns them, repoint
  the skill's routing at the new home, and take the wave's **only** VENDOR_LOCK re-pin.

## 1. Precondition (hard gate, re-checked first)

```
$ cd <silicon> && node scripts/build-lsp.mjs --check
[build-lsp] check PASS: dist/cli.js sha256 04b49f8c192d03b5… (235271 bytes) matches BUILD.lock,
both HDL registry entries present, overlay anchor present, 2 reference docs and 4 fixtures in place
```

`packages/mpd-mcp-lsp/references/{verilog,systemverilog}/README.md` exist and are non-empty, and they
are byte-identical to the pages being retired here (sha256 `7c826705510bb850` / `5d8d60f3a6eb8417`,
recorded in `evidence/verification/t16-lsp-assets.md`). The deletion therefore removes a duplicate,
not the knowledge.

## 2. Deletions — exactly two files

| Path | Disposition |
| --- | --- |
| `skills/lsp-setup/references/verilog/README.md` | **deleted** (79 lines) — content lives in the silicon bundle |
| `skills/lsp-setup/references/systemverilog/README.md` | **deleted** (83 lines) — same |
| `skills/lsp-setup/SKILL.md` | **kept** — it is the skill's own inventory |
| `skills/lsp-setup/scripts/lsp-server-table.ts` | **kept** — `detect-lsp.ts` imports it; deleting it would break the whole 21-language skill |
| the other 20 `references/<language>/README.md` pages | **untouched** |

The now-empty `references/verilog/` and `references/systemverilog/` directories were removed too;
`references/` still holds the 20 non-HDL language pages.

## 3. Pointer rewrites — three sites, no content rewrite

| Site | Before | After |
| --- | --- | --- |
| `SKILL.md:46` | `` `references/verilog/README.md` `` | `../my-power-dsh-silicon/packages/mpd-mcp-lsp/references/verilog/README.md` (+ the `$MPD_SILICON_ROOT` override note) |
| `SKILL.md:47` | `` `references/systemverilog/README.md` `` | `../my-power-dsh-silicon/packages/mpd-mcp-lsp/references/systemverilog/README.md` |
| `SKILL.md:3` (description) | `… haskell, julia, verilog, systemverilog.` | the enumeration is **kept**, plus: "with the HDL half (verilog / systemverilog) provided by the @mpd-dsh/silicon bundle at packages/mpd-mcp-lsp/references/; when that bundle is not installed this skill still routes those two languages but carries no HDL body of its own." |

## 4. Known limitation (recorded, per the standing ruling)

`scripts/lsp-server-table.ts` gains **no** HDL rows. HDL language-service support is owned by the
silicon bundle, and duplicating the server entries here would create a second source of truth for the
same capability. Consequence: `detect-lsp.ts` does not report `.v/.sv` files as LSP-supported even
when Verible/slang-server are installed on the machine — the HDL path is driven by the silicon
bundle's MCP server (`mcp__silicon_lsp__*`) instead. This is deliberate, not an oversight.

## 5. THE wave's single VENDOR_LOCK re-pin

Measured with `scripts/verify-vendor.mjs`'s own algorithm (normalized LF bytes → per-file sha256 →
sorted `relpath\nsha\n` aggregation over `skills/`), and **validated by the gate itself**:

| Field | Before | After |
| --- | --- | --- |
| `assets.skills.fileCount` | 331 | **329** |
| `assets.skills.treeSha` | `23e18d7ceae353db7acb24f927a5f51babe4ce7dc4f275e64d25ecfeed1e1597` | `8a0f05f0c241df966219ed2ead8b72f97e03b94ebd6a1b321eac3f7f98fa74c6` |

Arithmetic: 366 files at `3d99718` − 35 deleted by t5 (`12291a7`) = 331 − 2 from this task = **329**.
`d50934e` had already changed two QA scripts' *content* (treeSha moved, fileCount unchanged), so this
is the **first and last** re-pin of the wave — there is no second one, and the value was taken on the
final tree after the deletions.

Validation (the gate recomputes both fields and compares):

```
$ node scripts/verify-vendor.mjs
[verify-vendor] asset OK: skills 329 files
[verify-vendor] PASS
```

## 6. Other gates after the change

| Gate | Result |
| --- | --- |
| `node scripts/verify-vendor.mjs` | **PASS** (above; `skills 329 files`) |
| `node scripts/verify-rows-parity.mjs` | ok — 21 row ids match the bundle patch insert list |
| `node scripts/verify-rtl-references.mjs` (+ `--self-test`) | PASS — 42 resolved / 6 pending-by-design / **0 unresolved**; its pending labels were retitled `t16 (landed)` / `migrated (t17)` so the audit no longer implies outstanding work |
| `bun run test:qa` | `all self-tests passed` (both RTL cases live) |

## 7. Reproduce

```bash
M=/root/dshProj/my-power-dsh; S=/root/dshProj/my-power-dsh-silicon
cd $S && node scripts/build-lsp.mjs --check        # precondition: HDL pages exist in the bundle
cd $M && ls skills/lsp-setup/references | wc -l    # 20 language pages, no verilog/systemverilog
cd $M && sed -n '3p;46p;47p' skills/lsp-setup/SKILL.md
cd $M && node scripts/verify-vendor.mjs            # PASS, skills 329 files
cd $M && node scripts/verify-rtl-references.mjs    # 0 unresolved
cd $M && bun run test:qa
```
