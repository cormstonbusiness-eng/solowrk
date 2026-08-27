import { deflateRawSync } from 'node:zlib'

/**
 * Writing a ZIP file.
 *
 * Written out rather than taken as a dependency, for the same reason the
 * database is `node:sqlite` and the OCR is PowerShell: SoloWrk has no compiled
 * dependencies, so `npm install` works on any machine and the installer
 * carries no ABI-specific binaries. A ZIP is a length-prefixed format with a
 * table at the end — it is about a hundred lines, and the alternative is a
 * transitive dependency tree around somebody's year-end accounts.
 *
 * Deliberately not ZIP64. That caps an archive at four gigabytes, which is
 * some thousands of receipt photographs; `zipEntries` refuses rather than
 * writing a file that unpacks to nonsense, because a corrupt archive is
 * discovered by an accountant in January.
 */

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_CENTRAL = 0x06054b50

/** Four gigabytes, past which the sizes in the headers stop fitting. */
const ZIP32_LIMIT = 0xffffffff

export interface ZipEntry {
  /** Path inside the archive. Forward slashes, no leading slash. */
  name: string
  data: Uint8Array | Buffer
  /** Defaults to now. */
  modified?: Date
}

/* ------------------------------------------------------------------ *
 * CRC-32, which every entry carries twice
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let value = 0xffffffff
  for (let index = 0; index < data.length; index += 1) {
    value = CRC_TABLE[(value ^ data[index]!) & 0xff]! ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

/* ------------------------------------------------------------------ *
 * MS-DOS time, which is what a ZIP stores
 * ------------------------------------------------------------------ */

/**
 * Dates in a ZIP are MS-DOS stamps: seconds in units of two, and a year
 * counted from 1980. Anything before 1980 has nowhere to go, so it is clamped
 * rather than wrapping round to something absurd.
 */
function dosTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time:
      (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 31),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  }
}

/* ------------------------------------------------------------------ *
 * Compression
 * ------------------------------------------------------------------ */

/**
 * Files that are already compressed, and are stored rather than deflated.
 *
 * Deflating a JPEG spends real time to make the file very slightly larger. A
 * pack of six hundred receipt photographs is almost entirely these.
 */
const ALREADY_COMPRESSED = /\.(jpe?g|png|gif|webp|zip|pdf|mp4|mov|heic)$/i

const STORED = 0
const DEFLATED = 8

/* ------------------------------------------------------------------ *
 * The archive
 * ------------------------------------------------------------------ */

export function zipEntries(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    // Forward slashes, always: a backslash in a ZIP name is a literal
    // character, and Windows-built archives full of them are the classic way
    // to hand somebody a flat folder of files called `Receipts\2026\04\x.jpg`.
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8')
    const raw = Buffer.from(entry.data)

    const method = ALREADY_COMPRESSED.test(entry.name) ? STORED : DEFLATED
    const body = method === STORED ? raw : deflateRawSync(raw)

    const { time, date } = dosTime(entry.modified ?? new Date())
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_HEADER, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // extra field length

    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL_HEADER, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk number
    central.writeUInt16LE(0, 36) // internal attributes
    central.writeUInt32LE(0, 38) // external attributes
    central.writeUInt32LE(offset, 42)

    locals.push(local, name, body)
    centrals.push(central, name)

    offset += local.length + name.length + body.length

    if (offset > ZIP32_LIMIT) {
      throw new Error('That is too much to put in one archive. Export a shorter period.')
    }
  }

  const centralDirectory = Buffer.concat(centrals)

  const end = Buffer.alloc(22)
  end.writeUInt32LE(END_OF_CENTRAL, 0)
  end.writeUInt16LE(0, 4) // this disk
  end.writeUInt16LE(0, 6) // disk with the central directory
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...locals, centralDirectory, end])
}
