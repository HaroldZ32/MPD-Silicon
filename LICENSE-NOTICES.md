# License Notices

- **This repository is MIT licensed** — see [`LICENSE`](./LICENSE) (Copyright 2026 Harold Zhao).
  Third-party components keep their own licenses; nothing below turns third-party code MIT.
- This repository is derived from the my-power-dsh project (the port of the upstream
  project at commit `8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29`, v5.0.0-beta.20). It carries
  only that project's RTL face — the RTL skill corpus, the RTL verification plugin and the
  startup guard. The GitHub port (`HaroldZ32/MPD-Silicon`) relicensed this repository's own
  code to MIT; the provenance above is unchanged.
- DSH packages (`@deepseek-ai/*`) are MIT licensed and are referenced as dependencies only;
  nothing from them is redistributed here.
- Third-party components keep their original licenses/notices in their source trees.

## RTL skill corpus (`skills/`)

`skills/rtl-ip-flow`, `skills/rtl-codestyle` and `skills/rtl-verif` were ported from the
my-power-dsh project's own skill corpus, then removed from that project. Here they are covered by
this repository's MIT license. The corpus is data (SKILL.md + templates + references + fixtures)
and embeds no third-party code.

The coding-style contract in `skills/rtl-codestyle` follows the Erie / verilog-generator rule
set (`github.com/Eriemon/verilog-generator`), as that skill's own frontmatter states — **style
reference only, no code reused**: the rules are restated in our own wording and the templates,
checklists and comment conventions here are written for this repository. The corpora, the
verif plugin and the language-service rows were ported byte-for-byte from the source project, so
provenance for those is the dual-channel `diff` / `git show` ledger in `evidence/verification/`.

## `mpd_verif_*` plugin (`packages/mpd-verif-plugin/`)

Ported from my-power-dsh's `mpd-verif-plugin` (same content); it is MIT licensed here. Its
methodology is grounded in the gen-tb-skill structure and the raysalemi/uvmprimer pattern
catalogue — **no code from either is reused**; only the structural/methodological approach was
followed, and neither is redistributed.

## `silicon.jsonc` editor (`packages/mpd-verif-plugin/src/silicon/`)

The JSONC reader (comment/trailing-comma stripping) and the refuse-first, path-addressed
surgical editor — `jsonc.ts` and `jsonc-edit.ts` behind `mpd_verif_toolchain` — are **ported
from `@mpd-dsh/mpd`'s `packages/mpd-config-plugin`** (SUL-1.0 upstream; the ported code in this
repository is part of its MIT-licensed codebase, while the upstream `@mpd-dsh/mpd` package stays
SUL-1.0 and is not relicensed by this notice).
The port keeps the reference module's behaviour — a proven-span splice, the DELETE sentinel,
duplicate-last-wins, refuse-first on every ambiguity — and changes only the module names, the
sentinel key and the comment vocabulary.

## `mpd-silicon-bootstrap-plugin` and `mpd-silicon-guard-plugin`

This repository's own code, MIT. The bootstrap row serves the corpus by reference; the guard
row (`silicon-require-mpd`) is inject-free and refuses to boot when the `mpdDsh` service is absent.

## `@mpd-dsh/mpd` — external dependency, NOT redistributed

`@mpd-dsh/mpd` `0.15.1` is a hard runtime dependency (pinned exactly in `package.json`) and is
licensed under SUL-1.0. It is **not** copied into this repository and **not** redistributed in the
bundle artifact: plugin sources and built dists import its adapter through the package specifier
`@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js`, and `bun install` provides it. The
previous in-repo adapter port was removed in 0.4.0.

## External tools — NOT redistributed, installed by the user

Nothing below ships in this repository or in the bundle payload. The verif tools resolve them
at call time (`MPD_DSH_VERIF_*`, then `PATH`) and report a clear refusal when a backend is
absent.

- **Icarus Verilog (iverilog)** and **Verilator** — external open-source binaries under their
  own licenses.
- **VCS (Synopsys) and UVM 1.2** — commercial. No license, tool or UVM source is
  redistributed or activated here; the user must hold a VCS license and export
  `VCS_HOME`/`VERDI_HOME`/`NOVAS_HOME` in the launching shell.
- **cocotb** — installed on demand into a project-local virtualenv by `mpd_verif_venv` (never
  bundled, never a system-wide install). Under its own license.
- **wave-mcp / TraceWeave** — external Python MCP servers the user installs (`pipx`). The
  corresponding bundle rows are commented out by default; neither is bundled.
- **Verible / slang-server** — external HDL language servers; the `silicon-mcp-lsp` row
  declares an adapter path and bundles neither tool.
- **LibreLane** — external open-source RTL-to-GDS flow. Resolved at call time from the
  `librelane.*` toolchain config, `MPD_SILICON_LIBRELANE` / `MPD_SILICON_LIBRELANE_APPIMAGE`,
  or `PATH`; neither the flow nor an AppImage is redistributed here.

## Bundle layout note

Every row this bundle mounts resolves through the package's `exports` map (`./packages/*`,
`./skills/*`). No transitive dependency is vendored, and no path outside the
installed package is referenced.

