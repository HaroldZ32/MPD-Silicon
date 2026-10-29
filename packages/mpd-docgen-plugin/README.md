# mpd-docgen-plugin

[中文](./README.zh-CN.md)

Document generation for the `rtl-ip-flow` spec stage: one markdown user manual is the machine-readable
source, and this package writes the register Excel workbook and the bilingual Word user manual from it
at **规格设计 IP01**.

```
docs/user-manual.md ──┬─→ <ip>_regExcel_full.xlsx
                      └─→ <ip>_reg_user_manual.zh-CN.docx
docs/user-manual.en.md ──→ <ip>_reg_user_manual.en.docx
```

The writer is **zero-dependency**: it emits SpreadsheetML and WordprocessingML directly, with no
third-party OOXML library, no template asset and no office suite. Every archive input is fixed (sorted
entries, DOS timestamp 1980-01-01, no clock, no random ids), so a rerun over the same manual is
**byte-identical**.

## Hard dependency on @mpd-dsh/mpd

The package is not standalone. `src/index.ts` imports the adapter through the package specifier
`@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js` and declares the hard inject dependency:

```ts
export const inject = [...dshSeamInject(DSH_SEAM_TOOLS), "mpdDsh"]
```

The four tools register through `ctx.mpdDsh`; there is **no fallback** and no local copy. A composition
without the provider leaves the row PENDING, and the bundle's `silicon-require-mpd` guard turns that
into exit 1 within 15 s.

## Tools

All four use object-rooted `parameters`, an `output.schema` and an `output.render`; a failure is a
structured `{ ok: false, error: { code, message, hint } }` result, never an unhandled throw.

| Tool | Parameters | Returns |
| --- | --- | --- |
| `mpd_docgen_register_xlsx` | `input` (required), `output?`, `ip?` | `output`, `registers`, `fields`, `bytes`, `sha256` |
| `mpd_docgen_user_manual_docx` | `input` (required), `lang` (`zh-CN`\|`en`, required), `output?`, `ip?` | `output`, `lang`, `registers`, `tables`, `headings`, `bytes`, `sha256` |
| `mpd_docgen_run` | `manual` (required), `manualEn?`, `outputDir?` (default `docs`), `ip?` | `ok: true`, `files[]` (`path`, `lang?`, `bytes`, `sha256`), `registers`, `fields`, `warnings` |
| `mpd_docgen_verify` | `xlsx?`, `docxZh?`, `docxEn?` | `ok`, `checks[]` (`id`, `ok`, `detail`), `failed[]` |

- `mpd_docgen_run` parses the Chinese manual and the optional English twin, compares their register
  skeletons **before writing anything**, then writes the workbook and one docx per language with one
  shared `<ip>`. A missing `manualEn` is a successful run plus a warning.
- `mpd_docgen_verify` is the gate oracle: it reads only the produced files and asserts V1–V9, V11 and
  V12; V10 (byte-identical rerun) stays in `bun:test`. A missing or corrupt artifact fails its checks
  with the reason instead of throwing.

Outputs default to `<workspace>/docs/`:

| Artifact | Name |
| --- | --- |
| register workbook | `<ip>_regExcel_full.xlsx` |
| Chinese manual | `<ip>_reg_user_manual.zh-CN.docx` |
| English manual | `<ip>_reg_user_manual.en.docx` |

`<ip>` is the explicit `ip` argument, else the first ASCII word of the manual H1 (case preserved), else
the literal `ip`. Writes are atomic (sibling temp + rename, mode `0644`) and relative paths resolve
against the session workspace root, never `DSH_HOME`.

## Error codes

| Code | Raised for |
| --- | --- |
| `DOCGEN_E_INPUT` | missing/blank required argument, unsupported `lang`, `verify` with no artifact |
| `DOCGEN_E_IO` | unreadable input or a failed output write |
| `DOCGEN_E_PARSE` | no register chapter/registers, missing offset/reset, missing field table, malformed field row or bit range, empty/duplicate register name, invalid reset width |
| `DOCGEN_E_FIELDS` | reversed, out-of-range or overlapping field spans; an empty field name |
| `DOCGEN_E_ACCESS` | missing or unknown access code on a non-RESERVED field |
| `DOCGEN_E_LANG_MISMATCH` | zh/en register skeletons differ (run only) |
| `DOCGEN_E_ZIP` | a non-ZIP/truncated/CRC-broken artifact read by `verify` |
| `DOCGEN_E_INTERNAL` | fallback for an unexpected internal error |

## Layout

| File | Role |
| --- | --- |
| `src/index.ts` | plugin entry: `name`, `inject`, `apply` — registers the four tool definitions |
| `src/types.ts` | canonical model (`Field`, `Register`, `Manual`, `Block`), result shapes, `DocgenError` |
| `src/markdown.ts` | block tokenizer + register-chapter extractor (both heading forms, offset/reset lines, field tables, overview cross-check) |
| `src/registers.ts` | canonicalisation: width rule, span validation, access validation, gap fill, adjacent-RESERVED merge |
| `src/labels.ts` | the zh-CN / en output strings (chapter title, offset/reset prefixes, table headers, reserved description) |
| `src/xlsx.ts` | SpreadsheetML writer: `Sheet1`, nine columns, Reg/field row model, styles, widths |
| `src/docx.ts` | WordprocessingML writer: body blocks, overview table, per-register bit/detail tables, styles, `sectPr` |
| `src/zip.ts` | deterministic ZIP writer/reader (sorted entries, fixed DOS timestamp, CRC32) |
| `src/xml.ts` | XML declaration and escaping helpers |
| `src/paths.ts` | workspace-rooted path resolution, artifact names, IP slug, atomic write |
| `src/consistency.ts` | zh/en register-skeleton comparison |
| `src/tool-xlsx.ts`, `src/tool-docx.ts`, `src/tool-run.ts`, `src/tool-verify.ts` | the four tool definitions |

The public API the package pins:

```ts
parseManual(text: string, lang: Lang): Manual
canonicaliseRegisters(registers, lang?): Register[]
buildXlsx(registers, { ip }): Uint8Array
buildDocx(manual, registers, lang, { ip }): Uint8Array
compareSkeletons(a, b): string[]
buildZip(entries): Uint8Array            readZip(data): Map<string, Uint8Array>
workspaceRoot(exec) / resolveInputPath / resolveOutputPath / resolveOutputDir
regExcelFileName / docxFileName / ipSlug / atomicWriteFile
registerXlsxToolDefinition / userManualDocxToolDefinition
docgenRunToolDefinition / docgenVerifyToolDefinition
```

## Build and test

`package.json` declares `main: dist/index.js`. Every plugin in this bundle commits its built dist next
to `src`, produced by `bun run build` (`scripts/build.mjs`) with `@mpd-dsh/mpd/*` kept external; the
docgen package is added to that build list by the bundle integration. Tests need a dependency install
first (`bun install`) because the adapter is a package dependency, not inlined.

```bash
PATH="$PWD/.toolchain/bin:$PATH" bun test packages/mpd-docgen-plugin
```

Observed on this source tree: **106 tests across 4 files, 0 failures** (parser/canonicalisation,
xlsx, docx, run/verify). The suite includes V10, the byte-identical rerun, which the tool cannot assert
because it would need a rebuild.

## Fidelity and limits

- **xlsx**: one sheet `Sheet1`, columns A..I, header row height 43.2, thin borders on all nine columns,
  the eCap column widths, a bold yellow Reg row with `Mixed` in column D, field rows with `[hi:lo]` /
  `[N]` offsets and `{width}'h{HEX}` reset literals, size-11 宋体/Calibri fonts, description column
  wrapping.
- **docx**: eCap register-chapter layout — overview table with two rows per register (902/278 twips,
  gray RESERVED bands), a 6 × 16 bit table (field-name row 420 twips), a detail table with the
  830/1659/5807 grid, exactly one trailing `sectPr`. Access text maps through eCap's eight pairs
  (`rw`→`rw`, `ro`→`r`, `wo`→`w`, `w1c`→`rc_w1`, `w0c`→`rc_w0`, `rc`→`rc_r`, `w1s`→`rs`,
  `w1t`→`t`); unmapped codes are emitted verbatim.
- **No TOC, cover page, header or footer** in the docx, by design; **no PDF** output.
- **The register chapter is always rendered last.** A zh/en register-skeleton mismatch is a hard
  refusal before any write. Unsupported access codes never reach the writer (the parser refuses them),
  but a valid code with no Word pair is printed unchanged.
- **Structurally aligned, not a byte copy**: the eCap docx has 64 tables, including a version-history
  table contributed by a Word template this package deliberately does not clone.

See [`docs/docgen-guide.md`](../../docs/docgen-guide.md) for the input grammar, the workflow binding and
the full verification table.
