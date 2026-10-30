// The SpreadsheetML writer: a deterministic port of eCap's reg2excel.py.
//
// Ported line references:
//   - header texts, column widths, header row height: reg2excel.py:40-66
//   - thin borders on every cell:                     reg2excel.py:92, 248-256
//   - per-cell font choice (CJK 宋体 charset 134 / Calibri, size 11): reg2excel.py:101-116
//   - Reg row (yellow FFFFFF00, bold, D="Mixed") and field rows:      reg2excel.py:351-416
//   - field reset literal `{width}'h{HEX}` and `[hi:lo]`/`[N]` offsets: reg2excel.py:153-166, 395-409
//
// The register model arrives already gap-filled, descending and RESERVED-merged (registers.ts),
// so this module only formats: one Reg row per register, then its field rows. Inline strings keep
// the package free of a sharedStrings part, and every input to the archive is fixed (no clock, no
// random ids), so two builds over the same registers are byte-identical.
import { bitRangeText, fieldResetValue, parseResetHex } from "./registers.js"
import type { Register } from "./types.js"
import { escapeXml, xmlDeclaration } from "./xml.js"
import { buildZip, type ZipEntry } from "./zip.js"

/** Sheet name fixed by the eCap workbook (reg2excel.py:354). */
const SHEET_NAME = "Sheet1"
/** The nine A..I column letters, in order. */
const COLUMN_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"] as const
/** Header row texts (reg2excel.py:40-50). Column I carries the three-line structure legend. */
const HEADERS: readonly string[] = [
  "register name",
  "field offset",
  "field name",
  "access type",
  "reset value",
  "description（中文描述，请填此列）",
  "skip field test",
  "remarks",
  'register structure = "1"\n0 : whole register\n1 : aggregated register',
]
/** Column widths from the eCap workbook (reg2excel.py:54-64). */
const COLUMN_WIDTHS: readonly number[] = [21.22, 19.78, 21, 18.44, 18.44, 37.11, 18.89, 22.78, 53.33]
/** Header row height (reg2excel.py:66). */
const HEADER_ROW_HEIGHT = 43.2
/** Description column index (0-based F). */
const DESCRIPTION_COLUMN = 5
/** Structure legend column index (0-based I); its header is centred. */
const STRUCTURE_COLUMN = 8

/** eCap's CJK range (reg2excel.py:101-105): selects 宋体 over Calibri. */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef\u3040-\u30ff\uac00-\ud7af]/

/** True when the cell text needs the CJK font. */
function hasCjk(text: string): boolean {
  return CJK_RE.test(text)
}

/** Cell fill role (reg2excel.py:94-99). */
type FillKind = "none" | "gray" | "yellow"

/** One distinct cell style: font weight, fill, wrap/alignment and font family. */
interface CellStyle {
  readonly bold: boolean
  readonly fill: FillKind
  readonly wrap: boolean
  readonly horizontal?: "left" | "center"
  readonly vertical?: "center"
  readonly cjk: boolean
}

/** Every style the writer can emit, in a fixed order so the styles part is deterministic. */
function buildStyleTable(): readonly CellStyle[] {
  const styles: CellStyle[] = []
  // Header cells: bold, gray fill, vertically centred.
  for (const horizontal of ["left", "center"] as const) {
    for (const wrap of [false, true]) {
      for (const cjk of [false, true]) {
        styles.push({ bold: true, fill: "gray", wrap, horizontal, vertical: "center", cjk })
      }
    }
  }
  // Reg rows: bold, yellow fill, no explicit alignment (reg2excel.py:383-386).
  for (const wrap of [false, true]) {
    for (const cjk of [false, true]) styles.push({ bold: true, fill: "yellow", wrap, cjk })
  }
  // Field rows: no fill, not bold (reg2excel.py:411-414).
  for (const wrap of [false, true]) {
    for (const cjk of [false, true]) styles.push({ bold: false, fill: "none", wrap, cjk })
  }
  return styles
}

/** The fixed style table (index 0 in cellXfs is the default style; table index i -> i + 1). */
const STYLE_TABLE = buildStyleTable()

/** A stable key for one style, used to look up its cellXfs index. */
function styleKey(style: CellStyle): string {
  return [style.bold, style.fill, style.wrap, style.horizontal ?? "", style.vertical ?? "", style.cjk].join("|")
}

/** style key -> cellXfs index (offset by one for the default xf). */
const STYLE_INDEX = new Map(STYLE_TABLE.map((style, index) => [styleKey(style), index + 1]))

/** Look up the cellXfs index for a style; every emitted combination is in the fixed table. */
function styleIndex(style: CellStyle): number {
  const index = STYLE_INDEX.get(styleKey(style))
  if (index === undefined) throw new Error("xlsx style not registered: " + styleKey(style))
  return index
}

/** Header cell style: left-aligned except the centred structure legend, desc column wraps. */
function headerStyle(column: number, value: string): CellStyle {
  return {
    bold: true,
    fill: "gray",
    wrap: column === DESCRIPTION_COLUMN,
    horizontal: column === STRUCTURE_COLUMN ? "center" : "left",
    vertical: "center",
    cjk: hasCjk(value),
  }
}

/** Reg-row style: bold on the yellow fill; only the description wraps. */
function registerStyle(column: number, value: string | null): CellStyle {
  return { bold: true, fill: "yellow", wrap: column === DESCRIPTION_COLUMN, cjk: hasCjk(value ?? "") }
}

/** Field-row style: no fill, not bold; only the description wraps. */
function fieldStyle(column: number, value: string | null): CellStyle {
  return { bold: false, fill: "none", wrap: column === DESCRIPTION_COLUMN, cjk: hasCjk(value ?? "") }
}

/** Render one `<c>` cell: inline string when non-empty, a styled empty cell otherwise. */
function cellXml(reference: string, value: string | null, style: number): string {
  const open = '<c r="' + reference + '" s="' + style + '"'
  if (value === null || value === "") return open + "/>"
  return open + ' t="inlineStr"><is><t xml:space="preserve">' + escapeXml(value) + "</t></is></c>"
}

/** Render one `<row>` with all nine A..I cells, optionally with the header height. */
function rowXml(rowNumber: number, values: readonly (string | null)[], styles: readonly CellStyle[], height?: number): string {
  const cells: string[] = []
  for (let column = 0; column < COLUMN_LETTERS.length; column++) {
    cells.push(cellXml(COLUMN_LETTERS[column] + rowNumber, values[column] ?? null, styleIndex(styles[column])))
  }
  const heightAttribute = height === undefined ? "" : ' ht="' + String(height) + '" customHeight="1"'
  return '<row r="' + rowNumber + '"' + heightAttribute + ">" + cells.join("") + "</row>"
}

/** The `<cols>` block: one explicit width per A..I column (reg2excel.py:54-64). */
function colsXml(): string {
  const cols = COLUMN_WIDTHS.map((width, index) => {
    const column = index + 1
    return '<col min="' + column + '" max="' + column + '" width="' + String(width) + '" customWidth="1"/>'
  })
  return "<cols>" + cols.join("") + "</cols>"
}

/** The worksheet part: header row, then one Reg row and its field rows per register. */
function worksheetXml(registers: readonly Register[]): string {
  const rows: string[] = [
    rowXml(1, HEADERS, HEADERS.map((value, column) => headerStyle(column, value)), HEADER_ROW_HEIGHT),
  ]
  let rowNumber = 2
  for (const register of registers) {
    const regValues: (string | null)[] = [register.name, register.offset, null, "Mixed", register.reset, register.title, null, null, null]
    rows.push(rowXml(rowNumber++, regValues, regValues.map((value, column) => registerStyle(column, value))))

    const reset = parseResetHex(register.reset).value
    for (const field of register.fields) {
      const fieldValues: (string | null)[] = [
        null,
        "[" + bitRangeText(field) + "]",
        field.name,
        field.reserved ? null : field.access.toUpperCase(),
        fieldResetValue(reset, field.hi, field.lo),
        field.desc,
        null,
        null,
        null,
      ]
      rows.push(rowXml(rowNumber++, fieldValues, fieldValues.map((value, column) => fieldStyle(column, value))))
    }
  }
  const lastRow = rowNumber - 1

  return (
    xmlDeclaration() +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<dimension ref="A1:I' + lastRow + '"/>' +
    '<sheetViews><sheetView workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    colsXml() +
    "<sheetData>" +
    rows.join("") +
    "</sheetData>" +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    "</worksheet>"
  )
}

/** The four fonts: Calibri/宋体, plain/bold, all size 11 (reg2excel.py:112-116). */
function fontsXml(): string {
  return (
    '<fonts count="4">' +
    '<font><name val="Calibri"/><sz val="11"/></font>' +
    '<font><name val="Calibri"/><b/><sz val="11"/></font>' +
    '<font><name val="宋体"/><charset val="134"/><sz val="11"/></font>' +
    '<font><name val="宋体"/><charset val="134"/><b/><sz val="11"/></font>' +
    "</fonts>"
  )
}

/** The fills: none, gray125, header gray FFD9D9D9, Reg yellow FFFFFF00 (reg2excel.py:94-99). */
function fillsXml(): string {
  return (
    '<fills count="4">' +
    "<fill><patternFill/></fill>" +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor rgb="FFD9D9D9"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor rgb="FFFFFF00"/></patternFill></fill>' +
    "</fills>"
  )
}

/** Two borders: none (default) and a thin edge on all four sides (reg2excel.py:91-92). */
function bordersXml(): string {
  return (
    '<borders count="2">' +
    "<border><left/><right/><top/><bottom/><diagonal/></border>" +
    '<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>' +
    "</borders>"
  )
}

/** The alignment child of one xf; absent when the style has no alignment. */
function alignmentXml(style: CellStyle): string {
  const attributes: string[] = []
  if (style.horizontal !== undefined) attributes.push('horizontal="' + style.horizontal + '"')
  if (style.vertical !== undefined) attributes.push('vertical="' + style.vertical + '"')
  if (style.wrap) attributes.push('wrapText="1"')
  return attributes.length === 0 ? "" : "<alignment " + attributes.join(" ") + "/>"
}

/** One xf entry pointing at its font/fill/border; every cell gets the thin border. */
function xfXml(style: CellStyle): string {
  const fontId = style.cjk ? (style.bold ? 3 : 2) : style.bold ? 1 : 0
  const fillId = style.fill === "gray" ? 2 : style.fill === "yellow" ? 3 : 0
  const alignment = alignmentXml(style)
  const base = 'numFmtId="0" fontId="' + fontId + '" fillId="' + fillId + '" borderId="1"'
  if (alignment === "") return "<xf " + base + ' xfId="0"/>'
  return "<xf " + base + ' applyAlignment="1" xfId="0">' + alignment + "</xf>"
}

/** The styles part: 4 fonts, 4 fills, 2 borders and the fixed xf table. */
function stylesXml(): string {
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', ...STYLE_TABLE.map(xfXml)]
  return (
    xmlDeclaration() +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="0"/>' +
    fontsXml() +
    fillsXml() +
    bordersXml() +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="' + xfs.length + '">' + xfs.join("") + "</cellXfs>" +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '<tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleLight16"/>' +
    "</styleSheet>"
  )
}

/** `[Content_Types].xml`: rels/xml defaults plus the five overrides this package uses. */
function contentTypesXml(): string {
  return (
    xmlDeclaration() +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    "</Types>"
  )
}

/** Package relationships: the workbook plus both document properties. */
function rootRelsXml(): string {
  return (
    xmlDeclaration() +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    "</Relationships>"
  )
}

/** Workbook relationships: the single worksheet and the styles part. */
function workbookRelsXml(): string {
  return (
    xmlDeclaration() +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>"
  )
}

/** The workbook part: exactly one sheet, named `Sheet1` (reg2excel.py:354). */
function workbookXml(): string {
  return (
    xmlDeclaration() +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<bookViews><workbookView activeTab="0"/></bookViews>' +
    '<sheets><sheet name="' + SHEET_NAME + '" sheetId="1" r:id="rId1"/></sheets>' +
    "</workbook>"
  )
}

/** Deterministic document properties: a fixed epoch, no clock read. */
function coreXml(ip: string): string {
  const title = escapeXml(ip + " register workbook")
  const stamp = "1980-01-01T00:00:00Z"
  return (
    xmlDeclaration() +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    "<dc:title>" + title + "</dc:title>" +
    "<dc:creator>mpd-docgen</dc:creator>" +
    "<cp:lastModifiedBy>mpd-docgen</cp:lastModifiedBy>" +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + stamp + "</dcterms:created>" +
    '<dcterms:modified xsi:type="dcterms:W3CDTF">' + stamp + "</dcterms:modified>" +
    "</cp:coreProperties>"
  )
}

/** Minimal extended properties; fixed values only. */
function appXml(): string {
  return (
    xmlDeclaration() +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    "<Application>mpd-docgen</Application>" +
    "<DocSecurity>0</DocSecurity>" +
    "<ScaleCrop>false</ScaleCrop>" +
    "<Company></Company>" +
    "<LinksUpToDate>false</LinksUpToDate>" +
    "<SharedDoc>false</SharedDoc>" +
    "<HyperlinksChanged>false</HyperlinksChanged>" +
    "<AppVersion>1.0</AppVersion>" +
    "</Properties>"
  )
}

/** UTF-8 bytes for one XML part. */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/**
 * Build the deterministic `<ip>_regExcel_full.xlsx` workbook bytes.
 *
 * @param registers - canonical registers (gap-filled, descending) to write.
 * @param opts - `ip` names the workbook in its document properties.
 * @returns the xlsx (OOXML ZIP) bytes.
 */
export function buildXlsx(registers: readonly Register[], opts: { ip: string }): Uint8Array {
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: utf8(contentTypesXml()) },
    { name: "_rels/.rels", data: utf8(rootRelsXml()) },
    { name: "docProps/app.xml", data: utf8(appXml()) },
    { name: "docProps/core.xml", data: utf8(coreXml(opts.ip)) },
    { name: "xl/_rels/workbook.xml.rels", data: utf8(workbookRelsXml()) },
    { name: "xl/styles.xml", data: utf8(stylesXml()) },
    { name: "xl/workbook.xml", data: utf8(workbookXml()) },
    { name: "xl/worksheets/sheet1.xml", data: utf8(worksheetXml(registers)) },
  ]
  return buildZip(entries)
}
