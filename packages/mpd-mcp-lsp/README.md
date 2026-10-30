# mpd-mcp-lsp — HDL language service (silicon-owned)

**English** | [中文](./README.zh-CN.md)

The **HDL half** of the language-service support, owned by the `@mpd-dsh/silicon` bundle since
the RTL extraction (task t16). The general language service — the daemon and its ~42 builtin
server definitions — stays upstream / in `@mpd-dsh/mpd`; only what the RTL face needs travels
here. The artifact is now the **canonical HDL home**: `@mpd-dsh/mpd` v0.15.1 re-scoped its own
`mpd-mcp-lsp` package to a cclsp launcher and no longer carries the HDL registry entries.

## What ships

| Path | What it is |
| --- | --- |
| `overlay/lsp/server-definitions.ts` | Full patched copy of the upstream registry carrying the two HDL servers (`verible` → `verible-verilog-ls`, `.v/.vh`; `slang-server` → `.sv/.svh`). Build-time source; carries the drift-guard anchor `mpd-rtl-overlay-v1` |
| `overlay/lsp/language-mappings.ts` | The matching `EXT_TO_LANG` overlay (`.v` → `verilog`, `.sv` → `systemverilog`) |
| `templates/rtl-lsp-client.json` | Ready template for the **user** LSP config when the two executables are not on `PATH` (project configs ignore non-builtin ids) |
| `references/verilog/README.md`, `references/systemverilog/README.md` | The install/verify guides for Verible and slang-server — the HDL pages of the `lsp-setup` skill, moved here so the RTL knowledge lives with the RTL face |
| `dist/cli.js` + `dist/BUILD.lock` | The MCP server binary the row launches, with its provenance and sha256. **Not** rebuilt in this repo: `BUILD.lock` records the byte-identical artifact copied from `@mpd-dsh/mpd` — sha256 `04b49f8c…e0a973a9`, 235 271 bytes |
| `launch.mjs` | The row's entry point: reads the two-layer silicon toolchain config, prepends the configured oss-cad-suite / Verible / slang-server bin directories to `PATH`, then starts the pinned `dist/cli.js` with `stdio: "inherit"`. Hand-written and committed **beside** — never inside — `dist/`, so the artifact stays byte-identical to `BUILD.lock` |

The overlay is build-time source and does **not** ship in the packed artifact; `dist/`,
`references/` and `templates/` do.

## Bundle row

```yaml
- id: silicon-mcp-lsp
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: silicon_lsp          # unique process-wide — mpd's own row owns `lsp`
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-lsp/launch.mjs,
           <bundle>/packages/mpd-mcp-lsp/dist/cli.js, mcp]
    toolCallTimeoutMs: 60000
```

The row is **enabled** — t16 landed the assets and turned it on. It was declared `disabled: true`
while they were missing, because a `dsh-mcp-client` row whose stdio command cannot be resolved does
not degrade, it retry-storms `Cannot find module` and the boot never reaches the app. The
activation verdict comes from a **real app boot**, never from the row's presence in a config dump.
Measured on harness `0.2.1-rc.2` with the row mounted: the server negotiates MCP protocol
`2025-06-18`, advertises **8 tools**, and a real `mcp__silicon_lsp__status` call returns the
configured-server list (44 servers). On 2026-10-22 the `/opt/openictool` host had both HDL servers
installed: the same probe reports 44 configured servers, **2 installed** — Verible `v0.0-4296`
(`.v/.vh`) and slang-server `0.3.1+` (`.sv/.svh`). Verible: a clean adder returns
`No diagnostics found`, a broken file returns `error[verible]` at 3:2 / 4:0, and
`verible-verilog-lint` exits 1. slang-server: a clean file returns `No diagnostics found`, a
broken file returns `error` at 2:22 / 3:12 plus `warning (unused-port)`. A stale daemon lease can
defer startup (`DaemonStartupDeferredError: owner_pid_live_unreachable`) — clear
`~/.mpd/lsp-daemon` and `/tmp/mpd-lsp-*`. Evidence:
`evidence/verification/openictool/20261022T145500Z/` (repo-relative).

## Launcher and toolchain config

The row's args are `[launch.mjs, dist/cli.js, mcp]`. `launch.mjs` is a plain Node script with
no build step; on every spawn it:

1. reads the same two JSONC layers the verif tools use — user `$MPD_SILICON_CONFIG`, else
   `${DSH_HOME:-~/.dsh}/silicon.jsonc`, and project `<cwd>/.mpd/silicon.jsonc` — deep-merged
   with the project layer winning;
2. prepends the **existing** oss-cad-suite, Verible and slang-server bin directories to `PATH`
   (oss-cad-suite first, Verible second, slang-server third, the inherited `PATH` last;
   non-existent directories are skipped);
3. spawns `dist/cli.js` with that environment and `stdio: "inherit"`, forwarding
   `SIGINT`/`SIGTERM` and the child's exit code.

`slangServer.bin` is the config key for the SystemVerilog server (`.sv/.svh`). A host that only
sets `verible.bin` gets `.v/.vh` diagnostics and no `.sv/.svh` unless slang-server is already on
the inherited `PATH`.

A missing config file is normal. A malformed or unreadable one prints **one** warning on
stderr and leaves `PATH` unchanged. The launcher never writes stdout — MCP JSON-RPC owns that
stream.

**cwd caveat.** The project layer is resolved from the **dsh process cwd**, so
`<workspace>/.mpd/silicon.jsonc` only reaches the launcher when that cwd **is** the workspace.
A dsh process started elsewhere (the common GUI case) will not see it — the **user-level file
is the reliable layer**. Note that `mpd_verif_toolchain` resolves the workspace per call, so
`show`/`path` can report a project layer that this launcher does not read.

The pinned artifact is untouched: `launch.mjs` lives beside `dist/`, and
`build-lsp.mjs --check` still gates `dist/cli.js` against `BUILD.lock` (sha256 + size).
`launch.mjs` carries no build-time state of its own — edit it directly.

## Verify (offline, no upstream needed)

```bash
node scripts/build-lsp.mjs --check       # default: verifies the shipped artifact
node scripts/build-lsp.mjs --self-test   # registry controls + the live check
```

`--check` asserts: `dist/cli.js` matches `BUILD.lock` by sha256 **and** byte size; both HDL
registry entries are present in the binary (commands, extensions, `EXT_TO_LANG` mappings); the
overlay exists and carries the anchor; the two reference docs exist and are non-empty (the
precondition t17's deletion depends on); the four golden fixtures are in place.

## Build (needs an upstream checkout)

```bash
node scripts/build-lsp.mjs --build --upstream <checkout containing packages/lsp-daemon>
```

It copies the upstream daemon source into a temp workspace, applies this package's overlay over
`lsp-core`, **fails loudly** when the anchor is missing (a drifted upstream must never produce a
silently wrong dist), runs `bun build`, checks the fresh artifact for both HDL entries and
refreshes `BUILD.lock`.

**Status**: this path is implemented but *not exercised in this repository's environment* (no
upstream checkout here). The shipped `dist/cli.js` is the recorded copy, verified by `--check`.

## Note on the reference docs

The two HDL reference pages are **byte-faithful copies** of the `lsp-setup` skill's pages, so
they keep the skill-relative invocation line verbatim:

```bash
bun ../../scripts/verify-lsp.ts path/to/file.v
```

That path is relative to the **mpd** skills tree (`<mpd>/skills/lsp-setup/scripts/verify-lsp.ts`).
From this repository, use the resolved form:

```bash
bun "${MPD_SOURCE_ROOT:-../my-power-dsh}/skills/lsp-setup/scripts/verify-lsp.ts" path/to/file.v
```

## Scope

This package is **not** a skill tree: `skills/` stays exactly the three RTL corpora
(`verify-corpus.mjs` asserts it), and the HDL knowledge docs live here under `references/`.
