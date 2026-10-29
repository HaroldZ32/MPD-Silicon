// Minimal XML helpers shared by the xlsx (SpreadsheetML) and docx (WordprocessingML)
// writers. Nothing here is a general XML library: it escapes text, emits attributes in
// insertion order (deterministic output) and assembles one element.
//
// Control characters that XML 1.0 forbids are dropped rather than escaped: a manual may
// contain them by accident and must never produce an unopenable document.

/** Characters XML 1.0 does not allow, except tab/newline/carriage return. */
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

/** Escape text content for XML (`& < > " '` plus forbidden control characters removed). */
export function escapeXml(text: string): string {
  return String(text)
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/** Escape an attribute value. Identical to {@link escapeXml}; named for intent. */
export function escapeAttr(text: string): string {
  return escapeXml(text)
}

/** Render attributes in insertion order, skipping null/undefined values. */
export function attrs(entries: Record<string, string | number | null | undefined>): string {
  let out = ""
  for (const [key, value] of Object.entries(entries)) {
    if (value === null || value === undefined) continue
    out += " " + key + '="' + escapeAttr(String(value)) + '"'
  }
  return out
}

/** The XML declaration both OOXML packages start their parts with. */
export function xmlDeclaration(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
}

/**
 * Assemble one element. `content` is RAW XML (already escaped by the caller) so nested
 * markup works; an omitted `content` yields a self-closing element.
 *
 * @param name - element name.
 * @param attributes - attributes in emission order.
 * @param content - raw inner XML, when the element is not empty.
 */
export function element(name: string, attributes: Record<string, string | number | null | undefined> = {}, content?: string): string {
  const open = "<" + name + attrs(attributes)
  if (content === undefined) return open + "/>"
  return open + ">" + content + "</" + name + ">"
}
