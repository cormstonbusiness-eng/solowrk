import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db'
import { migrations } from '../db/migrations'
import {
  deleteTag,
  ensureTag,
  listTags,
  pruneTags,
  renameTag,
  tag,
  taggedIds,
  tagsFor,
  tagsForMany,
  untag
} from './tags'

/**
 * One vocabulary across everything.
 *
 * Two things here are the whole reason for a table rather than free text: the
 * same word on a task and on a document has to be the same tag, and it has to
 * stay one tag however inconsistently people capitalise it. The third is the
 * backfill — existing document tags had to survive, and a migration that
 * quietly dropped them would be discovered far too late.
 */

let db: Database

beforeEach(() => {
  db = new Database(':memory:')
})

afterEach(() => {
  db.close()
})

function id(): number {
  return db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
}

function task(title: string): number {
  db.run(
    `INSERT INTO tasks (project_id, title, status, created_at, updated_at)
     VALUES (NULL, ?, 'todo', datetime('now'), datetime('now'))`,
    [title]
  )
  return id()
}

function document(title: string, tags = ''): number {
  db.run(
    `INSERT INTO documents (title, file, tags, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    [title, `Documents/${title}.pdf`, tags]
  )
  return id()
}

describe('the vocabulary', () => {
  it('makes a tag once', () => {
    const first = ensureTag(db, 'urgent')
    const second = ensureTag(db, 'urgent')

    expect(second.id).toBe(first.id)
    expect(listTags(db)).toHaveLength(1)
  })

  it('does not let capitalisation make a second one', () => {
    // Two tags that look identical in a filter list is the failure this
    // prevents, and people capitalise inconsistently without noticing.
    const first = ensureTag(db, 'Urgent')
    const second = ensureTag(db, 'urgent')

    expect(second.id).toBe(first.id)
  })

  it('refuses a name that is only whitespace', () => {
    expect(() => ensureTag(db, '   ')).toThrow(/needs a name/)
  })

  it('counts what carries it, across types', () => {
    const urgent = ensureTag(db, 'urgent')
    tag(db, { type: 'task', id: task('One') }, urgent.id)
    tag(db, { type: 'document', id: document('Policy') }, urgent.id)

    expect(listTags(db)[0]!.uses).toBe(2)
  })

  it('renames once, everywhere', () => {
    const urgent = ensureTag(db, 'urgent')
    const one = task('One')
    tag(db, { type: 'task', id: one }, urgent.id)

    renameTag(db, urgent.id, 'critical')

    expect(tagsFor(db, { type: 'task', id: one })[0]!.name).toBe('critical')
  })

  it('refuses a rename onto a name already taken', () => {
    ensureTag(db, 'urgent')
    const design = ensureTag(db, 'design')

    expect(() => renameTag(db, design.id, 'URGENT')).toThrow(/already a tag/)
  })

  it('takes the tag off everything when it is deleted', () => {
    const urgent = ensureTag(db, 'urgent')
    const one = task('One')
    tag(db, { type: 'task', id: one }, urgent.id)

    deleteTag(db, urgent.id)

    expect(tagsFor(db, { type: 'task', id: one })).toEqual([])
  })
})

describe('putting tags on things', () => {
  it('is silent about one already there', () => {
    const urgent = ensureTag(db, 'urgent')
    const one = task('One')

    tag(db, { type: 'task', id: one }, urgent.id)
    tag(db, { type: 'task', id: one }, urgent.id)

    expect(tagsFor(db, { type: 'task', id: one })).toHaveLength(1)
  })

  it('takes one off without touching the rest', () => {
    const urgent = ensureTag(db, 'urgent')
    const design = ensureTag(db, 'design')
    const one = task('One')
    tag(db, { type: 'task', id: one }, urgent.id)
    tag(db, { type: 'task', id: one }, design.id)

    untag(db, { type: 'task', id: one }, urgent.id)

    expect(tagsFor(db, { type: 'task', id: one }).map((row) => row.name)).toEqual(['design'])
  })

  it('reads a whole list in one query', () => {
    const urgent = ensureTag(db, 'urgent')
    const one = task('One')
    const two = task('Two')
    tag(db, { type: 'task', id: one }, urgent.id)

    const byId = tagsForMany(db, 'task', [one, two])

    expect(byId[one]!.map((row) => row.name)).toEqual(['urgent'])
    expect(byId[two]).toBeUndefined()
  })
})

describe('filtering by tag', () => {
  it('narrows rather than widens with a second tag', () => {
    // Every, not any. Nobody adds a filter hoping for more results.
    const urgent = ensureTag(db, 'urgent')
    const design = ensureTag(db, 'design')
    const both = task('Both')
    const onlyUrgent = task('Only urgent')

    tag(db, { type: 'task', id: both }, urgent.id)
    tag(db, { type: 'task', id: both }, design.id)
    tag(db, { type: 'task', id: onlyUrgent }, urgent.id)

    expect(taggedIds(db, 'task', [urgent.id])).toHaveLength(2)
    expect(taggedIds(db, 'task', [urgent.id, design.id])).toEqual([both])
  })

  it('keeps one type out of another', () => {
    const urgent = ensureTag(db, 'urgent')
    tag(db, { type: 'document', id: document('Policy') }, urgent.id)

    expect(taggedIds(db, 'task', [urgent.id])).toEqual([])
  })

  it('matches nothing when nothing is asked for', () => {
    expect(taggedIds(db, 'task', [])).toEqual([])
  })
})

describe('the document tags that were already there', () => {
  /**
   * The real upgrade path: a workspace on the old schema, reopened on the new
   * one. In-memory will not do — the migration has to run against rows that
   * were already on disk, which is the only version of this that could lose
   * somebody's data.
   */
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'solo-tags-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function openAt(file: string, upTo: number): Database {
    const kept = migrations.filter((migration) => migration.id <= upTo)
    const removed = migrations.splice(0, migrations.length, ...kept)
    try {
      return new Database(file)
    } finally {
      migrations.splice(0, migrations.length, ...removed)
    }
  }

  it('become real tags when the workspace is upgraded', () => {
    const file = join(dir, 'solo.db')

    const old = openAt(file, 21)
    old.run(
      `INSERT INTO documents (title, file, tags, created_at, updated_at)
       VALUES ('Policy', 'Documents/Policy.pdf', 'insurance,renewal', datetime('now'), datetime('now'))`
    )
    const documentId = old.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
    old.close()

    const upgraded = new Database(file)
    try {
      expect(listTags(upgraded).map((row) => row.name).sort()).toEqual(['insurance', 'renewal'])
      expect(
        tagsFor(upgraded, { type: 'document', id: documentId }).map((row) => row.name).sort()
      ).toEqual(['insurance', 'renewal'])
    } finally {
      upgraded.close()
    }
  })

  it('become one tag when two documents share a word', () => {
    const file = join(dir, 'solo.db')

    const old = openAt(file, 21)
    for (const title of ['Policy', 'Certificate']) {
      old.run(
        `INSERT INTO documents (title, file, tags, created_at, updated_at)
         VALUES (?, ?, 'insurance', datetime('now'), datetime('now'))`,
        [title, `Documents/${title}.pdf`]
      )
    }
    old.close()

    const upgraded = new Database(file)
    try {
      const tags = listTags(upgraded)
      expect(tags).toHaveLength(1)
      expect(tags[0]!.uses).toBe(2)
    } finally {
      upgraded.close()
    }
  })

  it('leaves the original column alone, so a bad split can still be inspected', () => {
    const file = join(dir, 'solo.db')

    const old = openAt(file, 21)
    old.run(
      `INSERT INTO documents (title, file, tags, created_at, updated_at)
       VALUES ('Policy', 'Documents/Policy.pdf', 'insurance,renewal', datetime('now'), datetime('now'))`
    )
    old.close()

    const upgraded = new Database(file)
    try {
      expect(
        upgraded.get<{ tags: string }>('SELECT tags FROM documents LIMIT 1')!.tags
      ).toBe('insurance,renewal')
    } finally {
      upgraded.close()
    }
  })

  it('splits on the comma and trims', () => {
    // The CTE itself, which is the part that could silently mangle a tag.
    const rows = db.all<{ tag: string }>(
      `WITH RECURSIVE split(tag, rest) AS (
         SELECT '', 'insurance, renewal ,vat,'
         UNION ALL
         SELECT TRIM(SUBSTR(rest, 1, INSTR(rest, ',') - 1)), SUBSTR(rest, INSTR(rest, ',') + 1)
           FROM split WHERE rest != ''
       )
       SELECT tag FROM split WHERE tag != ''`
    )

    expect(rows.map((row) => row.tag)).toEqual(['insurance', 'renewal', 'vat'])
  })
})

describe('forgetting what no longer exists', () => {
  it('drops the tags of a deleted record', () => {
    const urgent = ensureTag(db, 'urgent')
    const one = task('One')
    tag(db, { type: 'task', id: one }, urgent.id)

    db.run('DELETE FROM tasks WHERE id = ?', [one])

    expect(pruneTags(db)).toBe(1)
  })

  it('leaves living ones alone', () => {
    const urgent = ensureTag(db, 'urgent')
    tag(db, { type: 'task', id: task('One') }, urgent.id)

    expect(pruneTags(db)).toBe(0)
  })
})
