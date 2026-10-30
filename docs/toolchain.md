# Toolchain configuration

[中文](./toolchain.zh-CN.md)

## Why this exists

Toolchain paths are **machine-specific**: one host has oss-cad-suite under `/opt`, another
under `~/.local`, a third has only a Verible tarball and a LibreLane AppImage. Hard-coding any
of those into a skill, a patch or a Makefile would make the bundle wrong everywhere except the
machine it was written on. This bundle therefore reads its external tools from a small
**JSONC configuration** and exposes it as two tools: `mpd_verif_toolchain` (inspect and edit
the config) and `mpd_verif_librelane` (resolve and run LibreLane).

Nothing is vendored. The config records **where** a tool is, never a copy of it, and the verif
tools, the LSP launcher and the LibreLane runner all read the same two files.

## The two files

| Layer | Path | Purpose |
| --- | --- | --- |
| user | `$MPD_SILICON_CONFIG` when set, else `${DSH_HOME:-~/.dsh}/silicon.jsonc` | the machine-wide layer; the reliable one |
| project | `<workspace>/.mpd/silicon.jsonc` | per-repository overrides; deep-merged **over** the user layer |

- `DSH_HOME` falls back to `~/.dsh` when unset; `MPD_SILICON_CONFIG` replaces the user file
  path entirely (it is resolved, and a leading `~` is expanded).
- The project layer is resolved **per call** from the session workspace, so one dsh process
  can serve several sessions with different projects.
- A **missing** file is normal — the layer contributes nothing. A **malformed** file is
  *reported*, never a crash: `show` surfaces the parse error, `set`/`unset` refuse, and the
  LSP launcher prints one warning and keeps the inherited `PATH`.

Example (the paths measured on the `/opt/openictool` host; comments and trailing commas are
allowed):

```jsonc
{
  // oss-cad-suite provides iverilog, verilator and verilator_coverage.
  "ossCadSuite": { "home": "/opt/openictool/oss-cad-suite" },
  // verible provides verible-verilog-ls (the HDL language server).
  "verible": { "bin": "/opt/openictool/verible" },
  // slang-server provides the SystemVerilog language server (.sv/.svh).
  "slangServer": { "bin": "/opt/openictool/slang-server" },
  // librelane is the RTL-to-GDS flow driver.
  "librelane": {
    "mode": "auto",
    "appimage": "/opt/openictool/librelane/librelane-devshell-x86_64.AppImage"
  }
}
```

On that host the four keys were written at **project** scope (`<workspace>/.mpd/silicon.jsonc`)
with `set`, the original comments survived, and the removed leaves left blank
lines (cosmetic). Project scope has a caveat for the LSP launcher only: it resolves the project
layer from the dsh process cwd, so a process started elsewhere does not read it — use
`scope: "user"` for `verible.bin` and `slangServer.bin` (see the cwd note under the LSP launcher).

### Precedence

1. **Project over user**, deep-merged key by key; a scalar or array in the project layer
   replaces the user value. `show` reports the winning layer for every key it knows.
2. **Environment still wins at run time** for the verification backends:
   `MPD_DSH_VERIF_IVERILOG`, `MPD_DSH_VERIF_VERILATOR`, `MPD_DSH_VERIF_VERILATOR_COVERAGE`
   are checked before the config, and `PATH` is the last tier.
3. LibreLane has its own environment fallbacks behind the config:
   `MPD_SILICON_LIBRELANE` (binary) and `MPD_SILICON_LIBRELANE_APPIMAGE` (AppImage).

So a shell export can always override the file for one process; the file is what persists.

## Schema

| Key | Type | Meaning |
| --- | --- | --- |
| `ossCadSuite.home` | string (path) | oss-cad-suite install root; `bin/` is inferred |
| `ossCadSuite.bin` | string (path) | the bin directory, **or** a single executable |
| `verible.home` | string (path) | Verible install root |
| `verible.bin` | string (path) | the bin directory, **or** a single executable |
| `slangServer.bin` | string (path) | the slang-server bin directory, **or** a single executable; feeds the HDL LSP launcher's `PATH` (it is not a verification backend) |
| `librelane.appimage` | string (path) | the LibreLane AppImage |
| `librelane.mode` | `"auto"` \| `"appimage"` \| `"devshell"` \| `"binary"` | execution tier; default `auto` |
| `librelane.appimageExtract` | boolean | extract the AppImage instead of mounting it; unset = auto (see below) |
| `librelane.bin` | string (path) | the `librelane` executable, **or** a bin directory |
| `librelane.home` | string (path) | LibreLane install root |

The spelling follows `@mpd-dsh/mpd`: `.bin` is an **executable or a bin directory**, `.home`
is an **install root**. Paths are `~`-expanded; a user-scope value must be absolute, while a
workspace-scope relative value is resolved against the workspace root.

Unknown keys are preserved (a hand-written section is never destroyed), and a known key with
the wrong type is reported as an invalid key rather than silently used.

## The conversational flow

The point of the tool is that a user states where their tools live, in their own words, and
the agent persists it. These are the calls the agent makes:

| The user says | The agent calls | What happens |
| --- | --- | --- |
| "Where is oss-cad-suite?" | `mpd_verif_toolchain {"action":"detect"}` | probes env, `PATH` and common roots; returns suggestions only, writes nothing |
| "I installed oss-cad-suite at `/opt/oss-cad-suite`" | `mpd_verif_toolchain {"action":"set","key":"ossCadSuite.home","value":"/opt/oss-cad-suite"}` | validates the key, writes one leaf, returns old/new and the file |
| "Use this Verible build" | `mpd_verif_toolchain {"action":"set","key":"verible.bin","value":"/opt/verible/bin"}` | same, for the HDL language server |
| "Create the config file for me" | `mpd_verif_toolchain {"action":"init","scope":"workspace"}` | writes the commented template; refuses an existing file unless `force: true` |
| "Why can't it find verilator?" | `mpd_verif_toolchain {"action":"show"}` then `mpd_verif_backends` | `show` lists resolved binaries with their source; the backend probe confirms the run-time answer |
| "Use the devshell AppImage at `~/librelane-devshell.AppImage`" | `set librelane.appimage` then `mpd_verif_librelane {"action":"status"}` | status reports `mode: "devshell"` (the basename contains `devshell`) and the exact command |
| "Run LibreLane on `config.yaml`" | `mpd_verif_librelane {"action":"run","args":["config.yaml"]}` | executes inside the workspace, logs under `.mpd/librelane/` |

The agent does **not** hand-edit the file for a normal request: `set` is the surgical path.
Hand-editing is for comments, bulk edits, or repairing a file the editor refused.

## The six actions

`mpd_verif_toolchain` takes `action` (default `show`), `key`, `value`, `scope`
(`"user"` \| `"workspace"`) and `force`.

### `show` — the effective view

```json
{ "action": "show", "key": "ossCadSuite.bin" }
```

Reports both file paths with `exists`/`parseError`, the merged config, the **source layer per
key**, the resolved binaries (`iverilog`, `verilator`, `verilator_coverage`) with
existence/executable/version, the configured paths with their kind, and any parse errors,
unknown keys or invalid keys. With `key`, it focuses on one leaf and its winning layer.
`show` never writes.

### `set` — one leaf, one surgical edit

```json
{ "action": "set", "key": "librelane.mode", "value": "devshell" }
{ "action": "set", "key": "ossCadSuite.bin", "value": "../oss-cad-suite/bin", "scope": "workspace" }
```

Writes exactly one value, preserving every other byte — comments, key order, whitespace,
quotes, trailing commas and line endings — by locating the value's character span and splicing
it. The target layer is the explicit `scope`, else **the layer that already defines the key**,
else the user layer. A write is atomic: `mkdir -p`, a sibling temp file, `rename`, mode `0644`.
An ambiguous or malformed document is refused **byte-untouched**.

The edit engine is ported from `@mpd-dsh/mpd`'s `mpd-config-plugin` (SUL-1.0 upstream; the
ported code in this repository is MIT) — see `LICENSE-NOTICES.md`.

### `unset` — remove one leaf

```json
{ "action": "unset", "key": "verible.bin" }
```

Removes the key from the layer that defines it (or the explicit scope) and touches nothing
else. Returns the old value and whether the file changed.

### `init` — the commented template

```json
{ "action": "init", "scope": "user", "force": false }
```

Writes a commented template with the two paths, the four tool groups (oss-cad-suite, Verible,
slang-server, LibreLane) and one example per group. It **refuses an existing file** unless
`force: true`; there is no silent overwrite.

### `path` — the resolved locations

```json
{ "action": "path" }
```

Returns `dshHome`, `workspaceRoot`, and both files with their existence. This is the action to
call when the user asks *which* file is in play.

### `detect` — suggestions, never writes

```json
{ "action": "detect" }
```

Scans the relevant environment variables (`MPD_SILICON_CONFIG`, `OSS_CAD_SUITE*`,
`VERIBLE_*`, `LIBRELANE_*`, `MPD_DSH_VERIF_*`), `PATH` hits, the common install roots
(`/opt/oss-cad-suite`, `~/oss-cad-suite`, `/opt/verible`, `~/verible`, `~/librelane`,
`~/.local/bin`), AppImages in the home directory and `~/.local/lib/python*/site-packages/librelane`.
Every hit comes back as a `{key, value, evidence}` suggestion; accepting one is a separate
`set`.

## Backend resolution

The verification tools resolve `iverilog`, `verilator` and `verilator_coverage` in this order:

1. `MPD_DSH_VERIF_<BACKEND>` (**still wins** — an explicit per-shell override),
2. the config: `ossCadSuite.bin`, or `ossCadSuite.home` + `/bin`,
3. `PATH`.

`mpd_verif_backends` reports the tier it used as `source: "env" | "config" | "path"`.
VCS and `urg` are untouched by this config: they keep resolving through
`VCS_HOME`/`VERDI_HOME`/`NOVAS_HOME` and `PATH`, because their layout is licensed and
site-managed. `slangServer.bin` is **not** part of this resolution: it only contributes its
directory to the HDL LSP launcher's `PATH` (see below).

## LibreLane

`mpd_verif_librelane` is the RTL-to-GDS flow driver lane.

```json
{ "action": "status" }
{ "action": "run", "args": ["config.yaml"], "cwd": "designs/foo", "timeoutMs": 600000 }
```

### Resolution and modes

`librelane.mode` (default `auto`) selects the tier, then the environment, then `PATH`:

| Mode | Resolves | Runs |
| --- | --- | --- |
| `binary` | `librelane.bin` (a file, or a dir → `<dir>/librelane`), else `librelane.home` → `<home>/librelane`, `<home>/bin/librelane`, `<home>/.venv/bin/librelane`; env `MPD_SILICON_LIBRELANE`; `PATH` | the argv directly, no shell |
| `appimage` | `librelane.appimage`; env `MPD_SILICON_LIBRELANE_APPIMAGE` | `[appimage, ...args]` — **no shell** |
| `devshell` | the AppImage | `[appimage, "librelane", ...args]` — argv passed straight to the wrapper, whose real interface is `devshell [--pure] <cmd> [...]`; no shell, no quoting |
| `auto` | `librelane.appimage` when set, and devshell when its basename contains `devshell`; otherwise the binary tier | as the chosen tier |

`status` reports the resolved `mode`, `configuredMode`, `path`, `source` (`config`/`env`/`path`),
`reason`, `exists`, `executable`, the AppImage extract decision, the command and its preview,
the parsed version, and hints. An unresolvable LibreLane is a structured refusal
(`VERIF_E_NO_BACKEND`), not an empty status.

The released 0.4.0 devshell shape `[appimage, "--run", "librelane <posix-quoted args>"]` was
wrong: the wrapper has no `--run` flag, so it exited **127** with `exec: --run: not found` when
measured against the real 3.0.16 AppImage. The runner now passes `[appimage, "librelane",
...args]`, and `status` probes `[appimage, "librelane", "--version"]`.

### AppImage extraction and `/dev/fuse`

When `librelane.appimageExtract` is **unset**, extraction is `auto`: it turns **on** when
`/dev/fuse` is not readable+writable — a container, or a host without FUSE — and the child
gets `APPIMAGE_EXTRACT_AND_RUN=1`, the standard AppImage runtime switch. An explicit `true`
forces extraction, an explicit `false` forces mounting. `status` reports both the decision and
its reason (`extractReason`), which is the fastest way to explain an AppImage that will not
mount.

### `run` semantics

- `args` is passed **verbatim** as argv in every mode. Devshell mode prepends the command:
  `[appimage, "librelane", ...args]` — the wrapper's real interface is `devshell [--pure]
  <cmd> [...]`, and it execs its argv, so there is no shell and no quoting.
- `cwd` defaults to the workspace root and is **workspace-confined**; anything outside is
  refused. Relative paths resolve against the workspace.
- `timeoutMs` defaults to **3600000** (1 h).
- A log is **always** written to `<workspace>/.mpd/librelane/<UTC>-<slug>.log`, recording the
  command, the cwd and the env **overrides** only — never the full environment.
- The result carries `exitCode`, `duration`, `logPath`, `stdoutTail` and `stderrTail`.

Limits: the timeout kills the **direct child only** (a grandchild spawned by the flow is not
reaped), the cwd guard is **lexical** (it does not resolve symlinks out of the workspace), and
a full RTL-to-GDS flow has not been run here — see *Measured bounds*.

## HDL language service (LSP) launcher

The `silicon-mcp-lsp` row launches a hand-written launcher, not a build artifact:

```
args: [<bundle>/packages/mpd-mcp-lsp/launch.mjs, <bundle>/packages/mpd-mcp-lsp/dist/cli.js, mcp]
```

- `launch.mjs` reads the **same two layers** (project over user), prepends the existing
  oss-cad-suite, Verible and slang-server bin directories to `PATH` (ossCadSuite first, then
  verible, then slangServer, then the inherited `PATH`; directories that do not exist are
  skipped), and spawns the pinned `dist/cli.js` with `stdio: "inherit"`.
- `slangServer.bin` is the config key for the SystemVerilog server (`.sv/.svh`). Without it the
  launcher adds nothing for slang-server and relies on whatever the inherited `PATH` provides.
- The pinned `dist/cli.js` and `BUILD.lock` are **untouched**: the launcher lives beside
  `dist/`, so the verified artifact stays byte-identical and `build-lsp.mjs --check` still
  gates it.
- A missing config file is normal. A malformed or unreadable one prints **one** warning on
  stderr and leaves `PATH` unchanged. The launcher never writes stdout — that stream belongs
  to MCP JSON-RPC.

**cwd caveat.** The launcher resolves the project layer from the **dsh process cwd**, so
`<workspace>/.mpd/silicon.jsonc` only reaches it when the dsh process was started *in* the
workspace. The common GUI case starts dsh elsewhere and will not see that layer. The
**user-level file is the reliable layer** for the LSP path; use `scope: "user"` for
`verible.bin` (the toolchain tool itself resolves the workspace per call, so `show`/`path`
can legitimately report a project layer that this launcher does not read).

## Security and permissions

- **The one recorded exception to "zero writes to the harness home."** Plugin state stays
  under `<workspace>/.mpd/`. The only write outside the workspace is an explicit
  `mpd_verif_toolchain` **user-scope** `set`/`unset`/`init`: that file is the *user's*
  configuration, not plugin state, and it is written only on an explicit action — never at
  boot, never implicitly.
- **Atomic and surgical.** Every write is `mkdir -p` + sibling temp + `rename` + `chmod 0644`,
  and edits one value's span. Ambiguity or malformed input is a refusal, byte-untouched.
- **No secrets.** The file holds paths and enums only. Never put a token, license key or
  credential in it; VCS licensing stays in the launching shell
  (`VCS_HOME`/`VERDI_HOME`/`NOVAS_HOME`).
- **No execution of config content.** Values are paths, an enum and a boolean; nothing in the
  file is evaluated as a command.
- **Command execution.** `mpd_verif_librelane run` executes the *resolved tool* with the
  caller's argv, in a workspace-confined cwd, and never through a shell: binary mode runs the
  binary directly, plain-AppImage mode runs `[appimage, ...args]`, and devshell mode runs
  `[appimage, "librelane", ...args]` (the wrapper execs its argv). The log records command, cwd
  and env overrides only.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `show` reports a parse error / `set` refuses | the file is not valid JSONC (or the root is not an object) | fix it by hand; `set`/`unset` refuse to clobber a broken document. `init` with `force: true` rewrites the template |
| `status` reports an unexpected `mode` | `librelane.mode`, or `auto` picking the AppImage / a `devshell` basename | `set librelane.mode` to the intended tier, or `unset librelane.mode` to return to `auto`; `status` echoes the `reason` |
| a resolved binary is missing / not executable | the config value is wrong, or the tool moved | `show` prints `exists`/`executable` and `status` prints hints; `detect` proposes values; `set` the right one |
| the project layer is not read | for the LSP launcher only: the dsh process cwd is not the workspace | write the key at `scope: "user"`, or start dsh in the workspace |
| an AppImage will not mount | no FUSE, or `/dev/fuse` is not accessible | leave `appimageExtract` unset (auto → extraction, `APPIMAGE_EXTRACT_AND_RUN=1`) or set it to `true` |

## Measured bounds

Measured on 2026-10-22 against the real `/opt/openictool` installation (evidence:
`evidence/verification/openictool/20261022T145500Z/`):

- **The full open-source lane.** Config `set`/`show` (including `slangServer.bin`) →
  `show`/`backends` resolved iverilog 14.0, verilator 5.053 and `verilator_coverage` from the
  project config with `source: "config"`; `compile` and `lint` passed on both backends and both
  compiled binaries ran with exit 0.
- **`sim` and `regress` are measured.** cocotb 2.1.0 in the project venv; `mpd_verif_sim` PASS
  (1 case) on iverilog and on verilator; `mpd_verif_regress` 1/1 PASS on both. cocotb's `SIM`
  variable is `icarus` (not `iverilog`), and the make `PATH` is `venv/bin` → the resolved tool
  directory → the inherited `PATH`. The oss-cad-suite `vvp` wrapper re-adds `PYTHONHOME`, so the
  iverilog lane points `ICARUS_BIN_DIR` at a shim that runs the bundled loader with
  `env -u PYTHONHOME`.
- **Coverage merge and report.** 4 `.dat` files merged into `merged.dat` (4,260 B); the report runs
  `[verilator_coverage, "--annotate", <dir>, "--annotate-all", <merged.dat>]`. `--all` is invalid
  in verilator_coverage 5.053; the flag is `--annotate-all`. `collectDatFiles` excludes
  `<top>__verFiles.dat`, which is build metadata rather than coverage.
- **LibreLane devshell AppImage 3.0.16.** `status` → `mode: "devshell"`, version `3.0.16`,
  `extract: true` (auto: `/dev/fuse` is not accessible → `APPIMAGE_EXTRACT_AND_RUN=1`), command
  `[appimage, "librelane", "--version"]`. `run` exited 0 in **5429 ms** with empty stderr and a
  log under `.mpd/librelane/`.
- **The devshell interface is `devshell [--pure] <cmd> [...]`.** The released 0.4.0 `--run` shape
  exited 127 (`exec: --run: not found`); the fixed argv is `[appimage, "librelane", ...args]`.
- **Both HDL servers.** `status` → 44 configured servers, **2 installed**: Verible `v0.0-4296`
  (`.v/.vh`) and slang-server `0.3.1+` (`.sv/.svh`). A clean `.v` file and a clean `.sv` file both
  returned `No diagnostics found`; a broken `.v` file returned `error[verible]` at 3:2 / 4:0
  (`verible-verilog-lint` exits 1); a broken `.sv` file returned `error` at 2:22 / 3:12 plus
  `warning (unused-port)`. The launcher `PATH` order is ossCadSuite → verible → slangServer →
  inherited.
- The test suite: **220 tests / 21 files — 219 pass / 1 skip / 0 fail** (the `mpd-verif-plugin`
  suite contributes 169, the bootstrap 30, the guard 11, the LSP launcher 10). The one skip is the
  corpus cross-check against the absent source checkout.
- Rows: 4 silicon row ids ∩ 35 mpd row ids = ∅.

Not measured here — stated as limits rather than hidden:

- **No FUSE**: the AppImage extracts (`APPIMAGE_EXTRACT_AND_RUN=1`) instead of mounting.
- **No VCS license.** `mpd_verif_uvm` returned the expected `VERIF_E_NO_BACKEND`, and the VCS
  coverage lane was not run. yosys 0.70, gtkwave and the slang 12.0.0 compiler are present but
  unused by the bundle.
- **The timeout kills the direct child only**, and the **cwd guard is lexical** (symlinks are
  not resolved).
- **No PDK and no full LibreLane RTL-to-GDS flow**; the measured LibreLane calls are the version
  probe and the `--version` run above.
