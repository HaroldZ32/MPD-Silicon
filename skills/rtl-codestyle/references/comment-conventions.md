# Comment Conventions (verilog-generator / Erie)

Comment placement and wording rules for the rtl-codestyle skill. The upstream
reference ships a fixed bilingual file header (English + Chinese sections); when
a project adopts it, keep it as the file's first comment block and treat its
content as project metadata. All code commentary below is English by default
(AGENTS.md agent-facing policy); inline prose may be localized to the project's
preferred language when the owner requests it.

## Placement

- **`//`-only comments.** Block comments (`/* ... */`) are not used in RTL.
- **Trailing alignment.** Inline comments are aligned in columns after the code
  (e.g. `input i_apb_pclk,    // APB config clock`). Align the `//` markers
  within a contiguous declaration group.
- **Pure leading comments.** A single pure comment line sits directly above each
  `ST_*: begin` and `default: begin` branch, left-aligned, with no blank line
  between the comment and the branch:

  ```verilog
  // ACTIVE state transition branch
  ST_ACTIVE: begin
      ...
  end
  ```

- **Distinct semantic comments per entity.** Parameters, port declarations,
  localparams, reg/wire declarations, assign statements, always blocks, and
  module instantiations each get their own meaning-bearing comment. Region
  banners (`// configuration parameter region`, `// state-machine region`, ...)
  are navigation aids and are not a substitute for per-entity comments.

## Wording

- State the signal's meaning and role, not its name. `// data valid` is better
  than `// i_valid`.
- For a group of assigns, a single pure group comment may cover the bridge
  (e.g. `// output assign region` banner) with the per-signal semantic comments
  kept inline.
- Avoid generic placeholder comments (`parameter`, `port signal`, `signal`,
  `assign`, `output bridge`, `internal output signal`) when the real meaning is
  known.
- Avoid exact or near-duplicate entity comments. Changing only a number, an
  endpoint letter, or a signal name is still a duplicate.

## Header block

When a project norm requires the fixed bilingual header, the English section
comes first, the Chinese section second, and both carry the same major metadata
families (company/ownership, engineer, create date, design name, module name,
description, references, dependencies, version, revision date, revision history).
This skill ships English headers by default; adding the Chinese section is a
project-local decision.
