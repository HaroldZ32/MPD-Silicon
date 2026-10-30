# SystemVerilog — LSP setup

- **Builtin server:** `slang-server` — `slang-server`
- **Extensions:** `.sv .svh`
- **Install hint:** per-platform static release binaries from `https://github.com/hudson-trading/slang-server/releases`

## Install

- **macOS:** download the `slang-server-v*.*-macos-<arch>.zip` asset from
  `https://github.com/hudson-trading/slang-server/releases`, unpack, and add
  the extracted directory to `PATH`.
- **Linux:** download the `slang-server-v*.*-linux-<arch>.zip` asset, unpack,
  and add the extracted directory to `PATH`.
- **Windows:** download the `slang-server-v*.*-windows-<arch>.zip` asset,
  unpack, and add the extracted directory to `PATH`.

`slang-server` is a C++ LSP built on a Slang fork; it performs real
shallow-compilation diagnostics on keystroke (no external lint shell-outs). Use
the static per-platform release binaries from the releases page.

Confirm it resolves:

```bash
command -v slang-server
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in `.codex/lsp-client.json` (Codex) AND `.opencode/lsp.json` (OpenCode/omo):

```json
{ "lsp": { "slang-server": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled`/`env`. A fully custom (non-builtin) server with its own `command` must go in the USER config (`~/.codex/lsp-client.json`).

### Project config: `.slang/server.json`

`slang-server` reads a hierarchical config from `.slang/server.json`
(workspace → user → local). Flags and compile options:

```json
{
  "flags": ["-I", "rtl", "-I", "tb"],
  "index": { "enabled": true },
  "build": { "directory": "build" }
}
```

- `flags` — additional slang compile flags / include dirs.
- `index` — enable project-wide index (go-to-definition across files).
- `build` — point at a compile database directory when available.

### Waveform / viewer hook (optional)

`wcpCommand` in `.slang/server.json` can point at a waveform viewer command
(e.g. a verdi/GTKWave launcher) used by the server's viewer integration. Wire
the actual wave-reading MCP per the rtl-verif guide (Tencent wave-mcp /
TraceWeave) at integration time.

## Known limitations

- Untaken `ifdef` branches are not analyzed.
- `--single-unit` compilation is unsupported.
- Some UVM class-in-package patterns are not fully resolved.

## Alternatives

- `verible` (builtin) for plain Verilog `.v/.vh` — lint + formatting, hover
  experimental; register it separately.
- `svlangserver` (third-party) as a custom server in the USER config — weaker
  diagnostics (external lint shell-outs).

## Troubleshooting
- **PATH:** `slang-server` must be on PATH; reopen shell after unpacking.
- **Missing includes:** add `-I` flags under `flags` in `.slang/server.json`.
- **No cross-file navigation:** enable `index.enabled` in `.slang/server.json`.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/file.sv
```
