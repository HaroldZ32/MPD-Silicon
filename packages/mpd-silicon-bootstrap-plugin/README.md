# mpd-silicon-bootstrap-plugin

[中文](./README.zh-CN.md)

Bundle asset provisioning **by reference** for the `@mpd-dsh/silicon` bundle.

The silicon bundle ships exactly one installable asset class — the **RTL skill
corpus** at `<bundle>/skills` (`rtl-ip-flow`, `rtl-codestyle`, `rtl-verif`). This
row registers a `ctx.skills` provider over that directory, so the corpus is
visible exactly while the bundle is installed and disappears when the row
unloads. Nothing is copied into `$DSH_HOME`, and one `dsh plugin remove` leaves
no residue.

| Property | Value |
| --- | --- |
| `name` | `mpd-silicon-bootstrap` |
| `inject` | `["skills", "mpdDsh"]` |
| Provider name | `silicon-bundle` (unique process-wide; `mpd`'s own row uses `mpd-bundle`, so both bundles can be installed side by side) |
| Provider rank | `600` (`bundled`), below user roots |
| Corpus root | `<pkg-root>/skills` (or `config.skillsDir`) |
| Config | `skillsDir?`, `skipSkills?` |

## mpd is required

`@mpd-dsh/mpd` is a **hard runtime dependency** (`0.15.1`, pinned in the bundle root
`package.json`), not an optional companion. This row serves the corpus **through mpd's
adapter**, so a silicon-only profile is unsupported: it exits 1 through the
`silicon-require-mpd` guard instead of serving an empty skill list. `bun install` must run
before tests or a build.

Bundle roots are resolved from the loaded file's own location (three directories
up from `packages/mpd-silicon-bootstrap-plugin/dist/index.js`), never from a
package-name lookup, so the row works in a checkout and in an installed bundle
alike.

## Deliberately absent (they belong to the mpd bundle, not to the RTL face)

- **No agent preset root**: the silicon bundle ships no preset.
- **No legacy `$DSH_HOME` copy cleanup**: silicon never wrote home copies, so
  there is nothing to migrate. The row never writes to the harness home at all.

The plugin unit test asserts that absence on the effective code (not on prose),
so re-introducing either behaviour fails the suite.

## Frontmatter subset

Corpus frontmatter is parsed by a deliberately small dependency-free YAML
subset: top-level scalars, one nested `metadata` mapping, and `|` / `>` block
scalars. A file that violates the subset, lacks frontmatter, lacks
`name`/`description`, or uses a skill name outside
`^[a-z0-9]+(?:-[a-z0-9]+)*$` is **skipped with a warning** — one bad file never
takes the corpus listing down. `test/fixtures/` pins the subset (including CJK
content and two deliberately invalid entries), so this suite does not depend on
the real corpus being present.

## Harness seams

All harness access goes through `@mpd-dsh/mpd`'s adapter
(`@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js`): the row declares
`inject: [...dshSeamInject(DSH_SEAM_SKILLS), "mpdDsh"]`, reads the live adapter from
`ctx.mpdDsh`, and calls `dsh.registerSkillProvider(...)`. There is **no fallback adapter**: a
profile without `mpdDsh` leaves this row PENDING, and the bundle's `silicon-require-mpd` guard
refuses the boot. The only direct harness touch is `ctx.logger.warn`, kept as the primary
warning path with the adapter's `rowLogLine` as the fallback; every other seam goes through the
adapter.

## Tests

```sh
bun test packages/mpd-silicon-bootstrap-plugin   # 30 tests / 2 files
```

## Build

```sh
node scripts/build.mjs          # whole repo
bun build src/index.ts --target node --format esm --outfile dist/index.js
```
