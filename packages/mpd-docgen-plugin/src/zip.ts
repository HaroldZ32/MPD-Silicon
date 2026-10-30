// Deterministic ZIP container (write + read) using only node:zlib.
//
// Both OOXML artifacts are ZIPs, and the plan requires a byte-identical rerun (§3/§4), so
// the writer fixes every field a normal zip writer varies: entries are emitted in sorted
// name order, the DOS timestamp is the format epoch 1980-01-01 00:00, no extra fields, no
// data descriptor, no comments, and the compression level is pinned. Two runs over the same
// entries therefore produce identical bytes, and two writers that receive the entries in a
// different order produce the same archive.
//
// The reader exists so tests (and the verify tool) can inspect what was written without a
// third-party dependency: it walks the central directory, inflates each payload and checks
// the CRC, i.e. it is a real oracle rather than a structural sniff.
import { deflateRawSync, inflateRawSync } from "node:zlib"
import { DocgenError } from "./types.js"

/** Local file header signature. */
const LOCAL_SIG = 0x04034b50
/** Central directory header signature. */
const CENTRAL_SIG = 0x02014b50
/** End-of-central-directory signature. */
const EOCD_SIG = 0x06054b50
/** ZIP 2.0 is the minimum that defines deflate. */
const VERSION = 20
/** General-purpose flag bit 11: names are UTF-8. */
const FLAG_UTF8 = 0x0800
/** Compression method 8 = deflate. */
const METHOD_DEFLATE = 8
/** Compression method 0 = stored. */
const METHOD_STORE = 0
/** Pin the deflate level so the compressed bytes do not depend on zlib defaults. */
const DEFLATE_LEVEL = 9
/** The fixed DOS timestamp: 1980-01-01 00:00 (date field = year 0, month 1, day 1). */
const DOS_TIME_1980 = 0x0000
const DOS_DATE_1980 = 0x0021

/** CRC-32 (IEEE 802.3) lookup table, built once from the standard polynomial. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** One archive member as the writer receives it. */
export interface ZipEntry {
  /** Entry name (POSIX-style path inside the archive). */
  name: string
  /** Raw (uncompressed) bytes. */
  data: Uint8Array
}

/** CRC-32 of `data`, as an unsigned 32-bit integer. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Compare two entry names by their UTF-8 bytes so the order is locale-independent. */
function compareNames(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))
}

/**
 * Build a deterministic ZIP archive.
 *
 * @param entries - archive members; duplicates and empty names are refused.
 * @returns the archive bytes (local entries, central directory, EOCD).
 */
export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => compareNames(a.name, b.name))
  const seen = new Set<string>()
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of sorted) {
    if (entry.name.length === 0) {
      throw new DocgenError("DOCGEN_E_ZIP", "zip entry has an empty name", "every archive member needs a non-empty name")
    }
    if (seen.has(entry.name)) {
      throw new DocgenError("DOCGEN_E_ZIP", "duplicate zip entry name: " + entry.name, "archive member names must be unique")
    }
    seen.add(entry.name)

    const nameBytes = Buffer.from(entry.name, "utf8")
    if (nameBytes.length > 0xffff) {
      throw new DocgenError("DOCGEN_E_ZIP", "zip entry name is too long: " + entry.name, "keep entry names under 64 KiB")
    }
    const raw = Buffer.from(entry.data)
    const compressed = deflateRawSync(raw, { level: DEFLATE_LEVEL })
    // Store when deflate does not shrink the payload: deterministic, and it keeps tiny XML
    // parts readable in a hex dump during review.
    const useDeflate = compressed.length < raw.length
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE
    const payload = useDeflate ? compressed : raw
    const crc = crc32(raw)

    if (offset > 0xffffffff || raw.length > 0xffffffff) {
      throw new DocgenError("DOCGEN_E_ZIP", "archive exceeds the 4 GiB ZIP32 limit", "split the archive")
    }

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_SIG, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME_1980, 10)
    local.writeUInt16LE(DOS_DATE_1980, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBytes, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL_SIG, 0)
    central.writeUInt16LE(VERSION, 4)
    central.writeUInt16LE(VERSION, 6)
    central.writeUInt16LE(FLAG_UTF8, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(DOS_TIME_1980, 12)
    central.writeUInt16LE(DOS_DATE_1980, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBytes)

    offset += local.length + nameBytes.length + payload.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  if (offset + centralSize > 0xffffffff) {
    throw new DocgenError("DOCGEN_E_ZIP", "archive exceeds the 4 GiB ZIP32 limit", "split the archive")
  }
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIG, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(sorted.length, 8)
  eocd.writeUInt16LE(sorted.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return new Uint8Array(Buffer.concat([...localParts, ...centralParts, eocd]))
}

/** Find the end-of-central-directory record, scanning backwards over the comment limit. */
function findEocd(buf: Buffer): number {
  const lowest = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i
  }
  throw new DocgenError("DOCGEN_E_ZIP", "not a ZIP archive: no end-of-central-directory record", "the file is truncated or not a zip")
}

/**
 * Read a ZIP archive into a name → bytes map, verifying sizes and CRCs.
 *
 * @param data - the archive bytes.
 * @returns entries in central-directory (i.e. sorted, for archives this module writes) order.
 */
export function readZip(data: Uint8Array): Map<string, Uint8Array> {
  const buf = Buffer.from(data)
  if (buf.length < 22) {
    throw new DocgenError("DOCGEN_E_ZIP", "not a ZIP archive: shorter than an end-of-central-directory record", "the file is truncated or not a zip")
  }
  const eocd = findEocd(buf)
  const count = buf.readUInt16LE(eocd + 10)
  const centralSize = buf.readUInt32LE(eocd + 12)
  const centralOffset = buf.readUInt32LE(eocd + 16)
  if (centralOffset + centralSize > buf.length) {
    throw new DocgenError("DOCGEN_E_ZIP", "ZIP central directory lies outside the file", "the file is truncated")
  }

  const out = new Map<string, Uint8Array>()
  let p = centralOffset
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_SIG) {
      throw new DocgenError("DOCGEN_E_ZIP", "ZIP central directory entry " + i + " is malformed", "the file is corrupted")
    }
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const compressedSize = buf.readUInt32LE(p + 20)
    const uncompressedSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen)

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new DocgenError("DOCGEN_E_ZIP", "ZIP local header for \"" + name + "\" is malformed", "the file is corrupted")
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26)
    const localExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    if (dataStart + compressedSize > buf.length) {
      throw new DocgenError("DOCGEN_E_ZIP", "ZIP payload for \"" + name + "\" lies outside the file", "the file is truncated")
    }
    const payload = buf.subarray(dataStart, dataStart + compressedSize)
    let raw: Buffer
    if (method === METHOD_STORE) raw = Buffer.from(payload)
    else if (method === METHOD_DEFLATE) {
      try {
        raw = inflateRawSync(payload)
      } catch (error) {
        throw new DocgenError("DOCGEN_E_ZIP", "cannot inflate zip entry \"" + name + "\": " + (error instanceof Error ? error.message : String(error)), "the file is corrupted")
      }
    } else throw new DocgenError("DOCGEN_E_ZIP", "unsupported ZIP compression method " + method + " for \"" + name + "\"", "use deflate or store")
    if (raw.length !== uncompressedSize) {
      throw new DocgenError("DOCGEN_E_ZIP", "ZIP size mismatch for \"" + name + "\": expected " + uncompressedSize + " bytes, got " + raw.length, "the file is corrupted")
    }
    if (crc32(raw) !== crc) {
      throw new DocgenError("DOCGEN_E_ZIP", "ZIP CRC mismatch for \"" + name + "\"", "the file is corrupted")
    }
    out.set(name, new Uint8Array(raw))
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}
