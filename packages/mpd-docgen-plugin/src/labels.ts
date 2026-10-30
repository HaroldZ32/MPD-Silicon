// The zh-CN / en output labels fixed by plan §4. These are the strings the docx lane
// writes; the parser's SOURCE markers (偏移地址：/Offset:) live in markdown.ts because they
// are input grammar, not output text.
//
// The overview table headers are English in BOTH languages, as in the eCap docx.
import type { Lang } from "./types.js"

/** Every localized output string the docx lane needs for the register chapter. */
export interface LabelSet {
  /** Register chapter H2 title. */
  readonly chapterTitle: string
  /** Prefix of the offset line, including its trailing space/colon as written. */
  readonly offsetLine: string
  /** Prefix of the reset-value line, including its trailing colon and space. */
  readonly resetLine: string
  /** Detail-table headers: bit field, name, description. */
  readonly detailHeaders: readonly [string, string, string]
  /** Overview-table headers; English in both languages (plan §4). */
  readonly overviewHeaders: readonly [string, string, string]
  /** Canonical description of a RESERVED span (plan §2). */
  readonly reservedDesc: string
}

/** The two label sets, keyed by language. */
export const LABELS: Readonly<Record<Lang, LabelSet>> = {
  "zh-CN": {
    chapterTitle: "寄存器",
    offsetLine: "地址偏移：",
    resetLine: "复位值：",
    detailHeaders: ["位域", "名称", "描述"],
    overviewHeaders: ["Offset", "Register", "31..0"],
    reservedDesc: "保留，必须保持复位值",
  },
  en: {
    chapterTitle: "Registers",
    offsetLine: "Offset: ",
    resetLine: "Reset value: ",
    detailHeaders: ["Bit field", "Name", "Description"],
    overviewHeaders: ["Offset", "Register", "31..0"],
    reservedDesc: "Reserved; keep the reset value",
  },
}

/** The label set for one language (a total lookup: `Lang` has exactly two members). */
export function labelsFor(lang: Lang): LabelSet {
  return LABELS[lang]
}
