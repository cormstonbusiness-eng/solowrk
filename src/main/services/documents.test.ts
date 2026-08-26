import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from '../db'
import {
  addDocument,
  expiringDocuments,
  listDocuments,
  updateDocument
} from './documents'
import { trashEntity } from './trash'
import { scaffoldWorkspace } from './workspace'

function isoInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

describe('documents', () => {
  let root: string
  let source: string
  let db: Database

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-docs-'))
    source = await mkdtemp(join(tmpdir(), 'solo-docsrc-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  })

  async function sampleFile(name = 'policy.pdf'): Promise<string> {
    const path = join(source, name)
    await writeFile(path, 'contents')
    return path
  }

  it('copies the file into Documents under its category', async () => {
    const doc = await addDocument(db, root, {
      sourcePath: await sampleFile(),
      title: 'Public liability',
      category: 'Insurance'
    })

    expect(doc.file).toBe(join('Documents', 'Insurance', 'policy.pdf'))
    expect(await readFile(join(root, doc.file), 'utf8')).toBe('contents')
  })

  it('falls back to the filename when no title is given', async () => {
    const doc = await addDocument(db, root, { sourcePath: await sampleFile('NDA.pdf') })
    expect(doc.title).toBe('NDA.pdf')
    expect(doc.category).toBe('Business')
  })

  it('normalises tags to lower case and drops blanks', async () => {
    const doc = await addDocument(db, root, {
      sourcePath: await sampleFile(),
      title: 'Policy',
      tags: ['Insurance', '  Renewal ', '']
    })

    expect(doc.tags).toEqual(['insurance', 'renewal'])
  })

  it('searches titles, tags and notes', async () => {
    await addDocument(db, root, {
      sourcePath: await sampleFile('a.pdf'),
      title: 'Employers liability',
      tags: ['insurance'],
      notes: 'Renews with Hiscox'
    })
    await addDocument(db, root, { sourcePath: await sampleFile('b.pdf'), title: 'Tax return' })

    expect(listDocuments(db, { search: 'liability' })).toHaveLength(1)
    expect(listDocuments(db, { search: 'insurance' })).toHaveLength(1)
    expect(listDocuments(db, { search: 'hiscox' })).toHaveLength(1)
    expect(listDocuments(db, { search: 'nothing' })).toHaveLength(0)
  })

  it('filters by category', async () => {
    await addDocument(db, root, {
      sourcePath: await sampleFile('a.pdf'),
      title: 'A',
      category: 'Insurance'
    })
    await addDocument(db, root, {
      sourcePath: await sampleFile('b.pdf'),
      title: 'B',
      category: 'Tax'
    })

    expect(listDocuments(db, { category: 'Tax' })).toHaveLength(1)
  })

  it('reports documents expiring soon and already expired', async () => {
    await addDocument(db, root, {
      sourcePath: await sampleFile('soon.pdf'),
      title: 'Expiring soon',
      expiryAt: isoInDays(10)
    })
    await addDocument(db, root, {
      sourcePath: await sampleFile('gone.pdf'),
      title: 'Already expired',
      expiryAt: isoInDays(-5)
    })
    await addDocument(db, root, {
      sourcePath: await sampleFile('later.pdf'),
      title: 'Miles away',
      expiryAt: isoInDays(200)
    })
    await addDocument(db, root, { sourcePath: await sampleFile('none.pdf'), title: 'No expiry' })

    const expiring = expiringDocuments(db, 45)
    expect(expiring.map((doc) => doc.title)).toEqual(['Already expired', 'Expiring soon'])
  })

  it('updates fields and re-packs tags', async () => {
    const doc = await addDocument(db, root, { sourcePath: await sampleFile(), title: 'Policy' })
    const updated = updateDocument(db, doc.id, {
      title: 'Renewed policy',
      tags: ['Insurance'],
      expiryAt: isoInDays(30)
    })

    expect(updated.title).toBe('Renewed policy')
    expect(updated.tags).toEqual(['insurance'])
  })

  it('leaves the file on disk when the record is removed', async () => {
    // Deleting goes through the trash now — there is deliberately no other
    // way — and a document's file is the user's own, so it stays whatever the
    // app does with its record of it.
    const doc = await addDocument(db, root, { sourcePath: await sampleFile(), title: 'Policy' })
    trashEntity(db, { type: 'document', id: doc.id })

    expect(listDocuments(db)).toHaveLength(0)
    expect(await readFile(join(root, doc.file), 'utf8')).toBe('contents')
  })

  it('de-duplicates when two documents share a filename', async () => {
    const first = await addDocument(db, root, { sourcePath: await sampleFile(), title: 'One' })
    const second = await addDocument(db, root, { sourcePath: await sampleFile(), title: 'Two' })

    expect(second.file).not.toBe(first.file)
    expect(second.file).toContain('policy 2.pdf')
  })
})
