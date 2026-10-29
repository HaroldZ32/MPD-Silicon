# RTL documentation port record

[中文](./rtl-docs-port-record.zh-CN.md)

Six RTL documents were copied from the source project into `docs/`. This file records
provenance, the corrections applied, and every reference that is still pending — so nobody
mistakes a forward reference for a broken one.

Source checkout = sibling directory `../my-power-dsh`, overridable with `MPD_SOURCE_ROOT`
(the convention defined in `docs/sync-policy.md`; no absolute path is hardcoded anywhere).

> **Status 2026-10-21.** This file is the historical record of the port. Every forward reference
> below that names **t16** has since shipped: the HDL language-service assets are in
> `packages/mpd-mcp-lsp/`, its `silicon-mcp-lsp` row is enabled, and the four golden Verilog
> fixtures are in `tests/golden/fixtures/verilog/` (commit `da3693c`). See
> [`packages/mpd-mcp-lsp/README.md`](../packages/mpd-mcp-lsp/README.md). The byte counts and the
> correction ledger are left as measured at port time.

## Byte-for-byte copy (verified before any correction)

| File | Bytes (source = copy) |
| --- | --- |
| `rtl-verif-guide.md` | 14311 |
| `rtl-verif-guide.zh-CN.md` | 14401 |
| `rtl-ip-flow-guide.md` | 5166 |
| `rtl-ip-flow-guide.zh-CN.md` | 4806 |
| `rtl-gap-assessment.md` | 22347 |
| `rtl-gap-assessment.zh-CN.md` | 21974 |

`cmp` reported IDENTICAL for all six immediately after the copy, so every byte difference
listed below is a correction this repository made on purpose.

## Corrections applied (source-ownership rule)

The source docs described the assets as living in the mpd bundle. After the port they live
here, so path-bearing references to mpd-owned locations were re-pointed at this bundle.
Nothing else was touched; in particular the prose project name is unchanged.

| File | Was | Now |
| --- | --- | --- |
| `rtl-verif-guide.md`, `rtl-verif-guide.zh-CN.md` | `` `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` `` | same path, annotated as silicon-owned with the assets landing in **t16** |
| `rtl-verif-guide.md` | `` COMMENTED examples in `packages/mpd-bundle/cordis.patch.yml` `` | "this bundle's `packages/mpd-bundle/cordis.patch.yml`" |
| `rtl-gap-assessment.md`, `.zh-CN.md` | `` `packages/mpd-bundle/cordis.patch.yml` `` | "this bundle's …" / 本 bundle 的 … |
| `rtl-gap-assessment.md`, `.zh-CN.md` | `` `packages/mpd-mcp-lsp/dist/cli.js` `` | same path, annotated as silicon-owned, lands with **t16** |
| `rtl-verif-guide.md`, `rtl-verif-guide.zh-CN.md` | `` `packages/mpd-verif-plugin/evidence/smoke/` `` | same path + "(this repository)" / （本仓库） |

No absolute path existed in any of the six source documents, so no path had to be rewritten
for that reason — the rule was applied to the two READMEs instead (see below).

## Forward references — port-time record (they have since landed)

At port time two referenced locations did not exist in this repository. They were kept as
forward references so the instruction was not lost; **both have since shipped**:

- `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` and `packages/mpd-mcp-lsp/dist/cli.js`
  now ship here (`cli.js` is 235271 bytes, pinned by `BUILD.lock`); t16 landed the assets and
  the `silicon-mcp-lsp` row is **enabled**.
- `skills/lsp-setup/references/{verilog,systemverilog}/README.md` were the mpd-resident copies
  at port time. The HDL pages now ship here under
  `packages/mpd-mcp-lsp/references/{verilog,systemverilog}/README.md`; the source repo keeps
  only the routing rows.

The original call sites stay annotated with the task ids as the port-time record. Nothing in
this section is pending today.

## Absolute-path cleanup in this repository's own docs

`docs/sync-policy.md` forbids hard-coded machine-specific locations. Three of this
repository's own files violated that; all now use the sibling-directory convention. (The
previous absolute spelling is deliberately NOT reproduced here — quoting it would leave a
machine-specific path in the very document that records its removal.)

| File | Line | Change | Now |
| --- | --- | --- | --- |
| `README.md` | 142 | the source project was named by one hard-coded absolute checkout path | sibling `../my-power-dsh`, `MPD_SOURCE_ROOT` override, links `docs/sync-policy.md` |
| `README.zh-CN.md` | 102 | same absolute spelling | 兄弟目录 `../my-power-dsh` + `MPD_SOURCE_ROOT` |
| `presets/README.md` | 33 | absolute path to the source patch file | "the source project's `packages/mpd-bundle/cordis.patch.yml`" + the convention |
| `presets/README.zh-CN.md` | 29 | same | 源工程 `packages/…` + 兄弟目录口径 |

Verification (this file excluded, since it names the defect rather than exhibiting it):
search the documentation tree for the source-checkout path prefix and confirm the only hits
are inside this record file:

```
$ grep -rln "$SRC_PATH_PREFIX" README.md README.zh-CN.md presets/ docs/ | grep -v rtl-docs-port-record.md
(no matches)
```

## Owned-increment compliance with the repository manual (AGENTS.md)

`AGENTS.md` (landed by the repo-manual task) makes the bilingual policy binding: every
human-facing document ships an English file **and** a `简体中文` twin, each carrying a language
switch link directly under its title. Audited against every document this task owns — all
compliant, after adding the two switch links that were missing:

| Pair | en → zh | zh → en |
| --- | --- | --- |
| `README.md` / `README.zh-CN.md` | ✔ (link added) | ✔ (link added) |
| `presets/README.md` / `presets/README.zh-CN.md` | ✔ (link added) | ✔ (link added) |
| `docs/rtl-docs-port-record.md` / `.zh-CN.md` | ✔ (twin created) | ✔ |
| the six ported RTL docs | ✔ (carried from source) | ✔ |
| `docs/dependency-map*` (t4's) | ✔ | ✔ |
| `docs/sync-policy.md` (t4's) | ✔ | ✔ — bilingual **within one file** (`# 中文版` section), which satisfies the policy without a separate twin |

`AGENTS.md` §4 gate suite, run after these edits: tests `130 pass / 0 fail / 1 known skip` ·
`verify-corpus` 0 · `verify-rows-disjoint` 0 · `pack-silicon --fix` 0 · `--check` 0 ·
`--self-test` 0 · `pack` 0 · `find . -type f -perm 600` = 0.

## Ownership boundary with t4's policy documents

`docs/dependency-map.md`, `docs/dependency-map.zh-CN.md` and `docs/sync-policy.md` are
**t4's** deliverables and this port did not touch them. Where they overlap, t4's
`sync-policy.md` is authoritative for ownership/change rules and `dependency-map.md` for the
per-asset mapping; this file only adds the RTL-document provenance record. No competing
policy statement is introduced here.

One naming note: `sync-policy.md` names the source repository `../my-power-dsh` (dash),
while the directory on this machine is `my-power-dsh-silicon`'s sibling `my-power-dsh`. The
sibling-relative convention is what matters; if the canonical spelling is meant to differ,
that is a t4 documentation fix, not a path defect here.
