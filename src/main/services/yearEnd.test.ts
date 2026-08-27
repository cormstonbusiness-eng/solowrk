import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inflateRawSync } from 'node:zlib'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

vi.mock('./pdf', () => ({
  /**
   * The real renderer needs a browser, and the pack's job is gathering rather
   * than drawing. The stub still writes a file: a mock that returns a path
   * without producing anything would make the archive look short for a reason
   * that has nothing to do with the code under test.
   */
  writePdf: vi.fn(
    async (workspace: string, doc: { number: string }, _s: unknown, folder: string) => {
      const relative = join(folder, `${doc.number}.pdf`)
      await writeFile(join(workspace, relative), `pdf for ${doc.number}`, 'utf8')
      return relative
    }
  )
}))

const { Database } = await import('../db')
const { scaffoldWorkspace } = await import('./workspace')
const { createExpense } = await import('./expenses')
const { createInvoice, updateInvoice } = await import('./invoices')
const { buildAccountantExport, buildYearEndPack } = await import('./yearEnd')

/**
 * The accountant export.
 *
 * What is being checked is that nothing goes missing. The pack is sent once a
 * year to somebody who cannot see the workspace, so a receipt referenced by
 * path rather than carried, or a file quietly skipped, is discovered in
 * January by the one person least able to do anything about it.
 */

/** Reads names back out of an archive, without trusting our own writer twice. */
function namesIn(archive: Buffer): string[] {
  const names: string[] = []
  let offset = 0

  while (offset < archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const compressed = archive.readUInt32LE(offset + 18)
    const nameLength = archive.readUInt16LE(offset + 26)
    const extraLength = archive.readUInt16LE(offset + 28)
    names.push(archive.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'))
    offset += 30 + nameLength + extraLength + compressed
  }

  return names
}

function contentOf(archive: Buffer, wanted: string): Buffer | null {
  let offset = 0
  while (offset < archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8)
    const compressed = archive.readUInt32LE(offset + 18)
    const nameLength = archive.readUInt16LE(offset + 26)
    const extraLength = archive.readUInt16LE(offset + 28)
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const start = offset + 30 + nameLength + extraLength
    const body = archive.subarray(start, start + compressed)
    if (name === wanted) return method === 0 ? Buffer.from(body) : inflateRawSync(body)
    offset = start + compressed
  }
  return null
}

describe('the pack', () => {
  let db: InstanceType<typeof Database>
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-year-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  /** A receipt on disk, and the expense that points at it. */
  const spend = async (name: string, net: number, date = '2026-06-01'): Promise<void> => {
    const source = join(root, name)
    await writeFile(source, Buffer.from(`fake image ${name}`), 'utf8')
    await createExpense(db, root, {
      date,
      vendor: 'Adobe',
      category: 'Software',
      net,
      vat: 0,
      receiptSourcePath: source
    })
  }

  const bill = (gross: number, date = '2026-06-01'): void => {
    const invoice = createInvoice(db, {
      clientId: null,
      issueDate: date,
      dueDate: date,
      lines: [{ description: 'Work', quantity: 1, unitPrice: gross }]
    })
    updateInvoice(db, invoice.id, { status: 'sent' })
  }

  it('carries the receipt images, not paths to them', async () => {
    // A CSV column full of paths into another person's laptop is not a
    // receipt.
    await spend('till.png', 1997)
    await spend('lunch.png', 850)

    const pack = await buildYearEndPack(db, root, 2026)
    expect(pack.receipts).toBe(2)
    expect(pack.files.filter((file) => file.includes('Receipts'))).toHaveLength(2)
  })

  it('does not fail the whole export over one missing receipt', async () => {
    await spend('till.png', 1997)
    await spend('gone.png', 850)

    // Somebody tidied their workspace. The expense is still in the CSV, which
    // is what the figures are built from.
    const filed = db.get<{ receipt_file: string }>(
      "SELECT receipt_file FROM expenses WHERE vendor = 'Adobe' ORDER BY id DESC"
    )!
    await rm(join(root, filed.receipt_file), { force: true })

    const pack = await buildYearEndPack(db, root, 2026)
    expect(pack.receipts).toBe(1)
  })

  it('includes the mileage log', async () => {
    const pack = await buildYearEndPack(db, root, 2026)
    expect(pack.files.some((file) => /Mileage/i.test(file))).toBe(true)
  })

  it('builds one archive holding everything the folder holds', async () => {
    await spend('till.png', 1997)
    bill(150_000)

    const pack = await buildAccountantExport(db, root, 2026)
    expect(pack.archive).toMatch(/\.zip$/)

    const archive = await readFile(join(root, pack.archive!))
    const names = namesIn(archive)

    // Same count, so nothing was dropped on the way in.
    expect(names).toHaveLength(pack.files.length)
    expect(names.some((name) => /Receipts\//.test(name))).toBe(true)
    expect(names.some((name) => /Expenses.*\.csv$/.test(name))).toBe(true)
    // And it says so when something did not make it, rather than handing over
    // a short archive without a word.
    expect(pack.missing).toEqual([])
  })

  it('names what it could not put in rather than going quiet', async () => {
    await spend('till.png', 1997)

    const pack = await buildYearEndPack(db, root, 2026)
    // A file locked or removed between writing the pack and zipping it.
    await rm(join(root, pack.files[0]!), { force: true })

    const zipped = await buildAccountantExport(db, root, 2026)
    expect(zipped.missing.length + namesIn(await readFile(join(root, zipped.archive!))).length).toBe(
      zipped.files.length
    )
  })

  it('puts everything under one folder, with forward slashes', async () => {
    // Unpacking must give one tidy folder rather than scattering CSVs into
    // wherever it was opened, and a backslash in a ZIP name is a literal
    // character that produces files called `Receipts\till.png`.
    await spend('till.png', 1997)

    const pack = await buildAccountantExport(db, root, 2026)
    const names = namesIn(await readFile(join(root, pack.archive!)))

    for (const name of names) {
      expect(name).not.toContain('\\')
      expect(name.startsWith('Tax year ')).toBe(true)
    }
  })

  it('keeps a receipt s bytes exactly', async () => {
    await spend('till.png', 1997)

    const pack = await buildAccountantExport(db, root, 2026)
    const archive = await readFile(join(root, pack.archive!))

    const receipt = namesIn(archive).find((name) => name.includes('Receipts/'))!
    expect(contentOf(archive, receipt)!.toString('utf8')).toBe('fake image till.png')
  })
})
