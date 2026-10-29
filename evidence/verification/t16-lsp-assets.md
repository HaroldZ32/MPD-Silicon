# t16 — HDL LSP assets landed and the `silicon-mcp-lsp` row activated

- Executor: Lead (captain-dispatched out-of-band; t16's dependencies include the terminal-failed t5)
- Date (UTC): 2026-09-12T18:0xZ
- Subject: the HDL (Verilog / SystemVerilog) language-service assets move into the silicon bundle,
  and the row that launches them flips from `disabled: true` to enabled.

## 1. What landed (byte-identical, sha256 verified)

| Target in this repo | Source | sha256 (16) | Identity |
| --- | --- | --- | --- |
| `packages/mpd-mcp-lsp/overlay/lsp/server-definitions.ts` | mpd `packages/mpd-mcp-lsp/overlay/lsp/` | `95ade5ae07c07b1f` | IDENTICAL (anchor `mpd-rtl-overlay-v1` present) |
| `packages/mpd-mcp-lsp/overlay/lsp/language-mappings.ts` | same | `2173ab02aefb9d92` | IDENTICAL |
| `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` | same | `a9c98a865d12b374` | IDENTICAL |
| `packages/mpd-mcp-lsp/dist/cli.js` | same (`dist/cli.js`) | `04b49f8c192d03b5` | IDENTICAL (235 271 bytes) |
| `packages/mpd-mcp-lsp/references/verilog/README.md` | mpd `skills/lsp-setup/references/verilog/README.md` | `7c826705510bb850` | IDENTICAL — the `bun ../../scripts/verify-lsp.ts` line is kept verbatim |
| `packages/mpd-mcp-lsp/references/systemverilog/README.md` | mpd `skills/lsp-setup/references/systemverilog/README.md` | `5d8d60f3a6eb8417` | IDENTICAL |
| `tests/golden/fixtures/verilog/` (4 files) | mpd `tests/golden/fixtures/verilog/` | — | IDENTICAL |
| `docs/adder4.md`, `docs/cnt8.md` | mpd `docs/` | `169c9e264c429d69`, `150cfdc8bc4f51b2` | IDENTICAL |

New in this repo: `packages/mpd-mcp-lsp/package.json`, `README.md` + `README.zh-CN.md` (the correct
`verify-lsp.ts` invocation is documented there, so the byte-faithful reference pages stay untouched),
and `dist/BUILD.lock` (provenance + sha256 + byte size of the copied artifact).

**Scope discipline**: only the RTL-specific half travels — the general language service (the daemon,
its ~42 builtin server definitions) stays upstream/`@mpd-dsh/mpd`. The overlay is build-time source
and is deliberately **not** copied into the packed artifact. **No fourth skill tree**: `skills/` still
holds exactly the three RTL corpora and `scripts/verify-corpus.mjs` stays green (§5).

## 2. Build/verify entry — `scripts/build-lsp.mjs`

```
$ node scripts/build-lsp.mjs --check
[build-lsp] check PASS: dist/cli.js sha256 04b49f8c192d03b5… (235271 bytes) matches BUILD.lock,
both HDL registry entries present, overlay anchor present, 2 reference docs and 4 fixtures in place
$ node scripts/build-lsp.mjs --self-test
[build-lsp self-test] ok: registry controls (complete text passes, a missing server is caught) + live --check
```

Negative control (exercised): replacing `slang-server` in the shipped binary makes `--check` fail on
the sha256 mismatch; the file was restored and re-hashed to `04b49f8c…` afterwards.

`--build --upstream <checkout>` applies the overlay over the upstream `lsp-core` (anchor-checked),
runs `bun build`, re-verifies the fresh artifact for both HDL entries and refreshes `BUILD.lock`.
**Status: implemented but not exercised here** — this environment has no upstream lsp-daemon
checkout. The shipped `dist/cli.js` is the recorded copy.

## 3. Packer registration (the artifact must carry the launcher)

`pack-silicon.mjs` classifies `packages/mpd-mcp-lsp` as an **asset package** (it is not a cordis
plugin): it is allowed in the source tree, copied into the artifact by a dedicated step
(`COPIED_ASSET_PKGS` × `dist`, `references`, `templates`), and the copy step fails when
`dist/cli.js` is absent — an enabled row must never address a missing command. The staging
extra-package guard now allows exactly the copied asset packages, so it still catches the
false-green it was built for.

## 4. Activation verdict — REAL app boot (not row presence)

Isolated `HOME`/`DSH_HOME`/workspace, web-template profile, `dsh plugin add <silicon>`:

```
$ dsh --profile lsp-qa --dump-config | grep -A3 'id: silicon-mcp-lsp'
- id: silicon-mcp-lsp
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: silicon_lsp        # no `disabled` key any more
$ dsh --profile lsp-qa --no-open --port 0        # 40 s, then killed
BOOT-EXIT=124 (stayed up)
fatal-signature count: 0   ('failed to apply loader entry' / 'already registered' /
                            'Cannot find module' / 'plugin tree failed to load' / 'retry')
dsh web: http://127.0.0.1:38279/?token=<redacted>
```

This is the same class of measurement that produced the **false-green** lesson: `--help` returns 0
while printing nothing fatal even for a tree that aborts, and `--dump-config` never executes plugin
code. The enabled row was therefore judged by a real boot's exit code and stderr — and by a direct
MCP roundtrip against the exact binary the row launches:

```
$ printf '{initialize}\n{initialized}\n{tools/list}\n' | node packages/mpd-mcp-lsp/dist/cli.js mcp
{"jsonrpc":"2.0","id":1,"result":{"capabilities":{"tools":{"listChanged":false}},
 "serverInfo":{"name":"lsp","version":"0.1.0"},"protocolVersion":"2024-11-05"}}
{"jsonrpc":"2.0","id":2,"result":{"tools":[…9 tools…]}}      # status, diagnostics, goto_definition,
                                                             # find_references, symbols, rename,
                                                             # prepare_rename, install_decision, lsp
PROBE-EXIT=0, stderr empty
```

## 4b. Both bundles mounted with the new active row

The row is new *active* content in the coexistence picture (`serverName` is a process-global
namespace), so the both-bundles boot was re-measured with silicon **and** `@mpd-dsh/mpd` installed
in one throwaway profile:

```
BOOT-EXIT=124 (stayed up)      fatal-signatures: 0
   (no 'failed to apply loader entry', no 'already registered',
    no 'Cannot find module', no 'serverName … is already in use')
listening: http://127.0.0.1:40147
services: mpdDsh + siliconDsh      providers: mpd-bundle + silicon-bundle
```

## 5. Gates after the change

| Gate | Result |
| --- | --- |
| `node scripts/build-lsp.mjs --check` / `--self-test` | exit 0 (above) |
| `node scripts/pack-silicon.mjs --self-test` | exit 0 — the packer changed, so its own controls were re-run |
| `node scripts/pack-silicon.mjs` (stage) | exit 0 — package set + source-leak guards green with the new asset package |
| `node scripts/pack-silicon.mjs --fix` → `--check` | exit 0 |
| `node scripts/verify-corpus.mjs` | PASS — 10 checks, 3 skips (still exactly three skill trees) |
| `node scripts/verify-rows-disjoint.mjs` | PASS — silicon ∩ mpd = ∅ |
| `bun test packages` | 131 tests / 0 fail |

Real `~/.dsh` untouched (all work under `/tmp/t16-qa`).

## 6. Consequence for t17

t17's hard precondition is now satisfied: `packages/mpd-mcp-lsp/references/{verilog,systemverilog}/README.md`
exist and are non-empty (asserted by `build-lsp --check`). t17 may now delete mpd's two orphan HDL
READMEs and rewrite the SKILL.md pointers at them, then take the **single** VENDOR_LOCK re-pin on the
final tree (fileCount 331 → 329).
