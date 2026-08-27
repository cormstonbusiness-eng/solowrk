import { describe, expect, it } from 'vitest'
import { inflateRawSync } from 'node:zlib'
import { crc32, zipEntries } from './zip'

/**
 * The ZIP writer.
 *
 * There is no library here to trust, so the tests read the bytes back out:
 * the archive is unpacked by hand and every entry compared with what went in.
 * A ZIP that opens in one tool and not another is discovered by an accountant
 * in January, which is the worst possible time and the worst possible person.
 */

const text = (value: string): Buffer => Buffer.from(value, 'utf8')

/** A minimal reader — enough to prove the writer, and nothing more. */
function unzip(archive: Buffer): { name: string; data: Buffer }[] {
  const entries: { name: string; data: Buffer }[] = []
  let offset = 0

  while (offset < archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8)
    const crc = archive.readUInt32LE(offset + 14)
    const compressed = archive.readUInt32LE(offset + 18)
    const uncompressed = archive.readUInt32LE(offset + 22)
    const nameLength = archive.readUInt16LE(offset + 26)
    const extraLength = archive.readUInt16LE(offset + 28)

    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const start = offset + 30 + nameLength + extraLength
    const body = archive.subarray(start, start + compressed)

    const data = method === 0 ? Buffer.from(body) : inflateRawSync(body)

    expect(data.length, `${name} length`).toBe(uncompressed)
    expect(crc32(data), `${name} checksum`).toBe(crc)

    entries.push({ name, data })
    offset = start + compressed
  }

  return entries
}

describe('checksums', () => {
  it('agrees with the value everybody else computes', () => {
    // The canonical test vector. If this is wrong, every archive is corrupt
    // and every unzipper says so.
    expect(crc32(text('123456789'))).toBe(0xcbf43926)
    expect(crc32(Buffer.alloc(0))).toBe(0)
  })
})

describe('writing an archive', () => {
  it('round-trips a file', () => {
    const archive = zipEntries([{ name: 'Summary.csv', data: text('Date,Amount\n2026-04-01,1500') }])
    const [entry] = unzip(archive)

    expect(entry!.name).toBe('Summary.csv')
    expect(entry!.data.toString('utf8')).toBe('Date,Amount\n2026-04-01,1500')
  })

  it('round-trips several, in the order they were given', () => {
    const archive = zipEntries([
      { name: 'A.csv', data: text('one') },
      { name: 'B.csv', data: text('two') },
      { name: 'C.csv', data: text('three') }
    ])

    expect(unzip(archive).map((entry) => entry.name)).toEqual(['A.csv', 'B.csv', 'C.csv'])
  })

  it('keeps folders as folders', () => {
    const archive = zipEntries([{ name: 'Receipts/2026/04/till.jpg', data: text('x') }])
    expect(unzip(archive)[0]!.name).toBe('Receipts/2026/04/till.jpg')
  })

  it('turns a Windows path into a ZIP path', () => {
    // A backslash is a literal character in a ZIP name, and an archive full of
    // them unpacks as one flat folder of oddly-named files.
    const archive = zipEntries([{ name: 'Receipts\\2026\\till.jpg', data: text('x') }])
    expect(unzip(archive)[0]!.name).toBe('Receipts/2026/till.jpg')
  })

  it('compresses text and stores what is already compressed', () => {
    const repetitive = text('the same line over and over\n'.repeat(200))

    const compressed = zipEntries([{ name: 'notes.txt', data: repetitive }])
    const stored = zipEntries([{ name: 'photo.jpg', data: repetitive }])

    // Deflating a photograph spends real time to make it slightly larger.
    expect(compressed.length).toBeLessThan(stored.length)
    expect(unzip(compressed)[0]!.data.equals(repetitive)).toBe(true)
    expect(unzip(stored)[0]!.data.equals(repetitive)).toBe(true)
  })

  it('survives bytes that are not text', () => {
    const bytes = Buffer.from(Array.from({ length: 512 }, (_, index) => index % 256))
    const archive = zipEntries([{ name: 'photo.jpg', data: bytes }])
    expect(unzip(archive)[0]!.data.equals(bytes)).toBe(true)
  })

  it('handles an empty file', () => {
    const archive = zipEntries([{ name: 'empty.csv', data: Buffer.alloc(0) }])
    expect(unzip(archive)[0]!.data.length).toBe(0)
  })

  it('writes a readable archive with nothing in it', () => {
    const archive = zipEntries([])
    expect(archive.length).toBe(22)
    expect(archive.readUInt32LE(0)).toBe(0x06054b50)
  })

  it('counts its entries in the table at the end', () => {
    // Where every unzipper looks first. A wrong count here shows the archive
    // as empty even though every byte of it is present.
    const archive = zipEntries([
      { name: 'A.csv', data: text('one') },
      { name: 'B.csv', data: text('two') }
    ])

    const end = archive.length - 22
    expect(archive.readUInt32LE(end)).toBe(0x06054b50)
    expect(archive.readUInt16LE(end + 8)).toBe(2)
    expect(archive.readUInt16LE(end + 10)).toBe(2)
  })

  it('points the table at where each file actually starts', () => {
    const archive = zipEntries([
      { name: 'A.csv', data: text('one') },
      { name: 'B.csv', data: text('two') }
    ])

    const end = archive.length - 22
    const directorySize = archive.readUInt32LE(end + 12)
    const directoryAt = archive.readUInt32LE(end + 16)

    expect(directoryAt + directorySize).toBe(end)

    // Each central entry's offset must land on a local header.
    let cursor = directoryAt
    for (let index = 0; index < 2; index += 1) {
      expect(archive.readUInt32LE(cursor)).toBe(0x02014b50)
      const at = archive.readUInt32LE(cursor + 42)
      expect(archive.readUInt32LE(at)).toBe(0x04034b50)
      cursor += 46 + archive.readUInt16LE(cursor + 28)
    }
  })

  it('does not write a date a ZIP cannot hold', () => {
    // MS-DOS stamps count from 1980. Anything earlier is clamped rather than
    // wrapping round to a year in the far future.
    const archive = zipEntries([
      { name: 'old.csv', data: text('x'), modified: new Date(1970, 0, 1) }
    ])

    const dosDate = archive.readUInt16LE(12)
    expect(dosDate >> 9).toBe(0)
    expect(unzip(archive)[0]!.data.toString('utf8')).toBe('x')
  })
})
