# Document generation at the spec stage

[中文](./docgen-guide.zh-CN.md)

At **规格设计 IP01** the `rtl-ip-flow` flow produces two documents a person reads — the internal user
manual and its English twin — and until now the register workbook and the Word manuals were built by
hand. `mpd-docgen` closes that gap: the **internal user manual is the single machine-readable source**,
and one tool call turns it into the eCap-format register workbook plus the bilingual Word user manual,
written into the target project's `docs/`.

The generator is a **zero-dependency** document writer: it emits SpreadsheetML and WordprocessingML
directly (no third-party OOXML library, no template asset, no LibreOffice), which is also why its
output is deterministic — the same manual produces byte-identical files on every rerun.

## The three artifacts

| Artifact | Default path | Source |
| --- | --- | --- |
| Register workbook | `docs/<ip>_regExcel_full.xlsx` | the zh manual's register chapter |
| Chinese user manual | `docs/<ip>_reg_user_manual.zh-CN.docx` | `docs/user-manual.md` |
| English user manual | `docs/<ip>_reg_user_manual.en.docx` | `docs/user-manual.en.md` |

One workbook, not two: identifiers (register and field names) stay English while descriptions stay
Chinese, exactly as the eCap workbook does. The two docx files are separate documents generated from
the two markdown sources.

`<ip>` is the **IP slug**: an explicit `ip` argument wins (used whole, case preserved, unsafe
characters replaced by `_`). Without it the H1 title contributes its first ASCII word, case preserved
(`# eCap 用户手册` → `eCap`, `# TIMER top` → `TIMER`); a title with no ASCII word falls back to the
literal `ip`. `mpd_docgen_run` derives the slug **once** from the Chinese manual and passes that one
value to every output name, so the three names cannot drift apart even when the two H1 titles differ.

## Quick start

Write the two manuals, then make one call:

```json
{
  "manual": "docs/user-manual.md",
  "manualEn": "docs/user-manual.en.md",
  "outputDir": "docs",
  "ip": "eCap"
}
```

That is `mpd_docgen_run`. It returns the three written files with their byte length and sha256, plus
the register/field counts and any warnings. Then run the gate oracle over the produced files:

```json
{
  "xlsx": "docs/eCap_regExcel_full.xlsx",
  "docxZh": "docs/eCap_reg_user_manual.zh-CN.docx",
  "docxEn": "docs/eCap_reg_user_manual.en.docx"
}
```

That is `mpd_docgen_verify`; `ok: true` means every requested structural check passed (11 checks when
all three artifacts are supplied).

## The four tools

| Tool | Parameters | Returns |
| --- | --- | --- |
| `mpd_docgen_register_xlsx` | `input` (required), `output?`, `ip?` | `output`, `registers`, `fields`, `bytes`, `sha256` |
| `mpd_docgen_user_manual_docx` | `input` (required), `lang` (required: `zh-CN` or `en`), `output?`, `ip?` | `output`, `lang`, `registers`, `tables`, `headings`, `bytes`, `sha256` |
| `mpd_docgen_run` | `manual` (required), `manualEn?`, `outputDir?` (default `docs`), `ip?` | `ok: true`, `files[]` (`path`, `lang?`, `bytes`, `sha256`), `registers`, `fields`, `warnings` |
| `mpd_docgen_verify` | `xlsx?`, `docxZh?`, `docxEn?` | `ok`, `checks[]` (`id`, `ok`, `detail`), `failed[]` |

Paths are resolved against the session workspace root; absolute paths are kept. Every write is atomic
(sibling temp file, then rename, mode `0644`) and nothing is written to `DSH_HOME`.

- **`mpd_docgen_register_xlsx`** always parses with the zh-CN label set, so feed it the Chinese manual
  — the workbook's description column is the Chinese description. `output` names an exact file;
  otherwise the target is `<workspace>/docs/<ip>_regExcel_full.xlsx`.
- **`mpd_docgen_user_manual_docx`** reads one manual in one language. `tables` counts the overview
  table + the bit/detail table pair per register + every generic markdown table in the body;
  `headings` counts the H1 + body headings + the register H2 + one H3 per register.
- **`mpd_docgen_run`** is the workflow entry point. It parses the Chinese manual and, when given, the
  English twin; it compares their register skeletons **before building or writing anything**, so a
  mismatch leaves the output directory untouched. Without `manualEn` it still succeeds, writes the
  workbook and the Chinese docx, and reports a warning that the flow requires the English twin.
- **`mpd_docgen_verify`** reads only the produced artifacts (never the source manual), so a different
  agent can run it. A missing or corrupt file never throws out of the tool: the checks bound to it are
  recorded as failed with the reason.

### Refusal codes

A refusal is a structured result (`{ ok: false, error: { code, message, hint } }`), never an unhandled
throw. `hint` states the remediation.

| Code | Meaning |
| --- | --- |
| `DOCGEN_E_INPUT` | a required argument is missing/blank, `lang` is not `zh-CN`/`en`, or `mpd_docgen_verify` was called with no artifact |
| `DOCGEN_E_IO` | reading an input or writing an output failed |
| `DOCGEN_E_PARSE` | the manual cannot be parsed: no register chapter or no registers, a register without offset/reset, no field table, a field row with fewer than four columns, an unparseable bit range/offset/reset, an empty or duplicate register name, or a reset value longer than 8 hex digits / not fitting 16 bits |
| `DOCGEN_E_FIELDS` | a field span is reversed, outside `[31:0]` or overlapping another field; a field has an empty name |
| `DOCGEN_E_ACCESS` | a non-RESERVED field has no access code, or one outside the 25-code block |
| `DOCGEN_E_LANG_MISMATCH` | `mpd_docgen_run` only: the zh and en register skeletons differ |
| `DOCGEN_E_ZIP` | an artifact read by `mpd_docgen_verify` is not a valid ZIP container (truncated or bad CRC) |
| `DOCGEN_E_INTERNAL` | fallback for an unexpected internal error |

## Input grammar

Only the register chapter is machine-readable; everything else is ordinary markdown rendered into the
docx body.

1. **H1 title**: `# <IP name>` — feeds the default `<ip>` slug (see above).
2. **Register chapter**: `## 寄存器` or `## Registers` (either title is accepted in either manual).
   The writer always renders it as the **last** chapter.
3. **Per-register heading**, either form:
   - canonical: `### 时间戳计数器(TSCTR)` — ASCII parentheses;
   - legacy (eCap's own manual): `### 寄存器1（TSCTR）——时间戳计数器` — full-width parentheses and an
     em dash.

   `### 寄存器总览` / `### Registers overview` are not register headings.
4. **Offset line**: `偏移地址：0x00` or `Offset: 0x00`. The `0x` prefix is required.
5. **Reset line**: `复位值：0x0000 1020` or `Reset value: 0x0000 1020`. Hex digits may be space-grouped;
   **8 hex digits mean a 32-bit register, anything shorter a 16-bit one**.
6. **Field table**: a header row starting `| 位域 |` or `| Bits |`, with the columns
   `位域 | 名称 | 读写属性 | 描述` (zh) or `Bits | Name | Access | Description` (en). Rows are
   `| N or N:M | NAME | access | desc |`. `<br>` becomes a line break; a literal `|` after the fourth
   cell is rejoined into the description, so a description may contain pipes.

Rules that make the model:

- **Access codes are strict** for non-RESERVED fields: `rw`, `ro`, `wo`, `w1`, `w1c`, `rc`, `rs`,
  `wrc`, `wrs`, `wc`, `ws`, `wsrc`, `wcrs`, `w1s`, `w1t`, `w0c`, `w0s`, `w0t`, `w1src`, `w1crs`,
  `w0src`, `w0crs`, `woc`, `wos`, `wo1`. RESERVED rows may leave the access cell empty.
- **Gap filling**: every bit not covered by a declared field becomes a `RESERVED` row — in Chinese
  `保留，必须保持复位值`, in English `Reserved; keep the reset value` — bit-adjacent RESERVED spans merge
  into one row, rows are sorted high-bit first, and the union is exactly `[31:0]`. A 16-bit register
  is still gap-filled to `[31:0]`; when its declared fields stop at bit 15, `[31:16]` becomes one
  RESERVED row, as in the eCap workbook.
- **Span validation is against `[31:0]`, not the derived width.** The eCap manual itself declares
  fields up to bit 31 on registers whose 4-digit reset makes them 16-bit wide; a width-relative check
  would refuse a real manual.
- **The overview table is a cross-check, not the source of truth.** Offsets in
  `### 寄存器总览` are compared numerically (both `0NNNh` and `0xNN` forms are normalised); a
  disagreement is reported in `warnings[]` and the parse still succeeds. The template's own placeholder
  rows (empty name, `IP_REG0`, an all-zero offset with no per-register counterpart) are skipped
  silently.

## Output fidelity

### Workbook (`<ip>_regExcel_full.xlsx`)

Ported from eCap's `reg2excel.py` and structurally validated, not byte-copied:

- one worksheet named `Sheet1`, exactly nine columns A..I; header row height 43.2; thin borders on
  all nine columns including the empty G/H/I cells;
- header A..I: `register name`, `field offset`, `field name`, `access type`, `reset value`,
  `description（中文描述，请填此列）`, `skip field test`, `remarks`, and the structure legend in I;
- one **Reg row** per register (bold, fill `FFFFFF00`, A = name, B = offset, D = the literal `Mixed`,
  E = reset as 8- or 4-digit uppercase hex, F = the register title), then its **field rows** (no
  fill, not bold, B = `[hi:lo]` or `[N]`, C = name, D = uppercase access or empty for RESERVED,
  E = `{width}'h{HEX}`, F = description);
- fonts size 11 — 宋体 (charset 134) for CJK text, Calibri for ASCII — the description column wraps,
  and the column widths are the eCap values;
- strings are inline (no shared-strings part) and the document properties carry the fixed
  `1980-01-01T00:00:00Z` stamp (no clock read), so a rerun is byte-identical.

### Word manual (`<ip>_reg_user_manual.<lang>.docx`)

Style-aligned to the eCap `reg_user_manual.docx` register chapter:

- body: the manual H1, then every non-register section as ordinary Word content (headings,
  paragraphs, lists, fenced code, generic tables), then the **register chapter last**;
- **overview table** (`Offset | Register | 31..0`, English headers in both languages), exactly
  **two rows per register**: the name row (row height 902; offset cell, register name, one cell per
  field with `gridSpan` = its width and the label `NAME` for a 1- or 32-bit field, otherwise
  `NAME[hi:lsb]`; RESERVED is a gray `D9D9D9` band labelled `RESERVED`; single-bit fields are
  vertical `btLr` text) and the reset row (row height 278; label `Reset value`, one cell per bit
  holding `1`/`0`, RESERVED spans cleared);
- **per-register chapter**: H3 `{title}（{name}）` in Chinese, `{title} ({name})` in English; the
  offset line (`地址偏移：` / `Offset: `) and the reset line (`复位值：` / `Reset value: `); a
  **6 × 16 bit table** (rows: `31..16` numbers, field names, access codes, `15..0` numbers, field
  names, access codes; the field-name row is exactly 420 twips high; fixed layout, 100 % width,
  `gridSpan` per field, RESERVED cells empty); an empty paragraph; a **detail table**
  (`位域 | 名称 | 描述` / `Bit field | Name | Description`, grid 830/1659/5807 twips, one row per
  field, the description split on newlines into one paragraph per line); an empty paragraph;
- **access text** in the bit table is mapped through eCap's eight pairs (`rw`→`rw`, `ro`→`r`,
  `wo`→`w`, `w1c`→`rc_w1`, `w0c`→`rc_w0`, `rc`→`rc_r`, `w1s`→`rs`, `w1t`→`t`); a code outside the
  table is emitted verbatim; RESERVED cells are cleared;
- runs carry `rFonts` with `hint="eastAsia"` (Calibri / 宋体 for body, Courier New / 宋体 for code);
- exactly one `sectPr` closes the body (A4 portrait). **There is no TOC, cover page, header or
  footer** — the eCap document has none, and this writer does not invent them;
- the ZIP container uses the fixed DOS timestamp 1980-01-01 and sorted entries, so a rerun is
  byte-identical. That guarantee is **per runtime**: the uncompressed OOXML members are identical
  everywhere, but the zlib deflate stream can differ between Node and bun, so a file hash is
  reproducible on the runtime that produced it, not across runtimes.

## The gate oracle

`mpd_docgen_verify` is the 规格评审 oracle: it reads the produced files and asserts the plan's
structural contracts. It checks only what was supplied — pass `xlsx` for V1–V5, `docxZh`/`docxEn`
for V6–V9, both docx files for V11; V12 always covers every supplied artifact.

| Check | Asserts |
| --- | --- |
| V1 | one sheet named `Sheet1` with the exact nine headers |
| V2 | row model: 1 header + R Reg rows + F field rows, each with all nine columns |
| V3 | every Reg row is bold on the yellow fill and carries `Mixed` |
| V4 | field offsets are bracketed and descending, spans cover `[31:0]`, RESERVED has an empty access and the canonical text, reset literals are uppercase and correctly sized |
| V5 | thin borders on A..I, the eCap column widths, the 43.2 header height, the size-11 font pair |
| V6 | the nine OOXML parts, content types, `document.xml`, and exactly one trailing `sectPr` |
| V7 | the register H2 chapter, one H3 per register, and each chapter's offset/reset lines |
| V8 | the overview table: header, two rows per register, 902/278 heights, gray RESERVED spans |
| V9 | the 6 × 16 bit table and the 830/1659/5807 detail table for every register |
| V11 | the zh and en documents describe the same register skeleton, derived from the documents themselves |
| V12 | no template placeholder (`<寄存器名>`, `<REG_NAME>`, `<IP名称>`) survived into an artifact |

**V10** — a byte-identical rerun — needs a rebuild, so it stays in `bun:test` rather than in the tool.
The package's suite covers it (`bun test packages/mpd-docgen-plugin`).

## Workflow binding

In the `rtl-ip-flow` skill this is **Stage 2 — 规格设计 IP01**:

1. the Spec Designer writes the internal user manual to `docs/user-manual.md` **and** its English twin
   to `docs/user-manual.en.md` (same section order, per `templates/user-manual.en.md`);
2. the Spec Designer runs `mpd_docgen_run` with `manual` and `manualEn`, producing the three
   artifacts in `docs/`;
3. the 🔴 **规格评审** gate does not pass until the three artifacts exist in `docs/` **and**
   `mpd_docgen_verify` returns `ok`. They are gate items, not optional extras.

The flow's document matrix carries the generated pair as its own row, and the consistency checklist
requires that the xlsx/docx registers match the user manual and that the zh/en register skeletons are
identical.

## Limits

- **Zero third-party runtime dependencies.** The package imports only `node:` builtins and
  `@mpd-dsh/mpd`'s adapter — no OOXML library, no template asset, no office suite.
- **No PDF.** The deliverables are xlsx and docx; converting them is out of scope.
- **No TOC, cover page, header or footer** in the docx, by design.
- **The register chapter must be last.** The writer appends it after every other section; putting it
  mid-document in the markdown does not move it in the docx.
- **Unsupported access codes are emitted verbatim in the docx.** The parser refuses a code outside the
  25-code block, but if the mapping table has no pair for a *valid* code, the Word bit table prints it
  unchanged rather than inventing a translation.
- **A zh/en register-skeleton mismatch is a hard refusal** (`DOCGEN_E_LANG_MISMATCH`) before anything
  is written. Titles, descriptions and access text may differ; register count and order, names,
  numeric offsets, widths, and the ordered field spans (with reserved-ness) must not.
- **The overview table is only a cross-check.** A disagreement produces a warning; it never corrects
  the workbook or refuses the manual.
- **One workbook.** It is generated from the Chinese manual; there is no English workbook.
- **The docx is structurally aligned, not a byte copy.** The eCap document's 64 tables include a
  version-history table contributed by a Word template this writer deliberately does not clone.

## Verifying a change

The package's own suite is the inner loop:

```bash
PATH="$PWD/.toolchain/bin:$PATH" bun test packages/mpd-docgen-plugin
```

It covers the parser, the canonicalisation, the xlsx and docx writers (including the byte-identical
rerun), the run tool's refusals and the gate oracle. The repository gates are listed in
[`AGENTS.md`](../AGENTS.md) §4: `node scripts/typecheck.mjs --require`,
`node scripts/pack-silicon.mjs --check`, and the corpus and row-id gates.
