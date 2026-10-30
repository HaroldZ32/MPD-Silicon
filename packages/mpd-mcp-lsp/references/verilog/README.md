# Verilog — LSP setup

- **Builtin server:** `verible` — `verible-verilog-ls`
- **Extensions:** `.v .vh`
- **Install hint:** download prebuilt binaries from `https://github.com/chipsalliance/verible/releases`

## Install

- **macOS:** download the `verible-v*.*-macOS-<arch>.tar.gz` asset from
  `https://github.com/chipsalliance/verible/releases`, unpack, and add the
  `bin` directory to `PATH`.
- **Linux:** download the `verible-v*.*-Linux-<arch>.tar.gz` asset, unpack, and
  add the `bin` directory to `PATH`.
- **Windows:** download the `verible-v*.*-win64.zip` asset, unpack, and add the
  `bin` directory to `PATH`.

See `https://github.com/chipsalliance/verible/releases` for the latest release.
There is no system package manager install for the LSP binary; use the prebuilt
archives (or build from source).

Confirm it resolves:

```bash
command -v verible-verilog-ls
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in `.codex/lsp-client.json` (Codex) AND `.opencode/lsp.json` (OpenCode/omo):

```json
{ "lsp": { "verible": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled`/`env`. A fully custom (non-builtin) server with its own `command` must go in the USER config (`~/.codex/lsp-client.json`).

### Initialization options (only if commonly needed)

Hover is still experimental and is **NOT enabled in the builtin command**. If you
want hover support, launch a custom server with the flag in the USER config:

```json
{ "lsp": { "verible": { "command": ["verible-verilog-ls", "--lsp_enable_hover"] } } }
```

## Project-wide navigation (filelist)

Project-wide go-to-definition / find-references need a filelist. Place a
`verible.filelist` at the project root listing the sources, e.g.:

```
// verible.filelist
//-include_dir: rtl
rtl/adder4.v
rtl/cnt8.v
```

The lint rules live in `.rules.verible_lint` (see Verible docs on
`--rules_config_search`).

## Alternatives

- `slang-server` (builtin) for SystemVerilog `.sv/.svh` files — richer
  shallow-compilation diagnostics; register it separately.
- `svlangserver` (third-party) as a custom server in the USER config — weaker
  diagnostics (external lint shell-outs).

## Troubleshooting
- **PATH:** `verible-verilog-ls` must be on PATH; reopen shell after adding the
  unpacked `bin` dir.
- **Hover missing:** hover is experimental — not enabled by default; pass
  `--lsp_enable_hover` in a custom command.
- **No cross-file navigation:** add a `verible.filelist` at the project root.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/file.v
```
