import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const { updateSettings } = await import('./settings')
const {
  createDocTemplate,
  deleteDocTemplate,
  documentVersions,
  generateDocument,
  listDocTemplates,
  restoreDocTemplate,
  restoreDocumentVersion,
  saveDocumentBody,
  seedStarterTemplates,
  setDocumentStatus,
  updateDocTemplate
} = await import('./docTemplates')
const { STARTER_TEMPLATES } = await import('@shared/starterTemplates')
const { unknownFields } = await import('@shared/merge')

/**
 * Templates and the documents they make.
 *
 * The rule that matters most is that seeding never overwrites: somebody amends
 * the shipped contract, sends it to clients for a year, and an update that
 * quietly reverted it would be unforgivable.
 */

describe('the starter library', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('puts the shipped templates in', () => {
    expect(seedStarterTemplates(db)).toBe(STARTER_TEMPLATES.length)
    expect(listDocTemplates(db)).toHaveLength(STARTER_TEMPLATES.length)
  })

  it('does nothing on the second run', () => {
    seedStarterTemplates(db)
    expect(seedStarterTemplates(db)).toBe(0)
  })

  it('never overwrites one somebody has edited', () => {
    seedStarterTemplates(db)
    const contract = listDocTemplates(db).find((one) => one.name === 'Freelance contract')!

    updateDocTemplate(db, contract.id, { body: 'My own terms, hard won.' })
    seedStarterTemplates(db)

    const after = listDocTemplates(db).find((one) => one.name === 'Freelance contract')!
    expect(after.body).toBe('My own terms, hard won.')
  })

  it('does not put back one deleted on purpose', () => {
    seedStarterTemplates(db)
    const contract = listDocTemplates(db).find((one) => one.name === 'Freelance contract')!

    deleteDocTemplate(db, contract.id)
    seedStarterTemplates(db)

    expect(listDocTemplates(db).some((one) => one.name === 'Freelance contract')).toBe(false)
  })

  it('can put an edited one back the way it came', () => {
    seedStarterTemplates(db)
    const contract = listDocTemplates(db).find((one) => one.name === 'Freelance contract')!
    const original = contract.body

    updateDocTemplate(db, contract.id, { body: 'oops' })
    expect(restoreDocTemplate(db, contract.id).body).toBe(original)
  })

  it('ships templates whose merge fields all exist', () => {
    // A typo in a shipped template is only discovered by a user generating a
    // contract for a client who is waiting.
    for (const template of STARTER_TEMPLATES) {
      expect(unknownFields(template.body), template.name).toEqual([])
    }
  })

  it('ships templates that say what they are for', () => {
    for (const template of STARTER_TEMPLATES) {
      expect(template.summary, template.name).not.toBe('')
      expect(template.body.length, template.name).toBeGreaterThan(400)
    }
  })
})

describe('generating a document', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
    seedStarterTemplates(db)
    updateSettings(db, { businessName: 'Blockout Digital', contactName: 'Craig' })
  })

  afterEach(() => {
    db.close()
  })

  // Inserted directly rather than through the services, which also make
  // folders on disk. Templates never touch one.
  const project = (
    name: string,
    over: { clientId?: number; budget?: number; dueOn?: string } = {}
  ): number => {
    db.run(
      "INSERT INTO projects (client_id, name, budget, due_on, folder, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [over.clientId ?? null, name, over.budget ?? null, over.dueOn ?? null, `Projects/${name}`]
    )
    return db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
  }

  const client = (name: string): number => {
    db.run(
      "INSERT INTO clients (name, contact_name, folder, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
      [name, 'Jane Powell', `Clients/${name}`]
    )
    return db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
  }

  const template = (body: string): number =>
    createDocTemplate(db, { name: 'Test', body }).id

  it('fills the fields from the real records', () => {
    const clientId = client('Northgate Studio Ltd')
    const projectId = project('Ashfield House', { clientId, budget: 480_000 })

    const made = generateDocument(db, {
      templateId: template('{{client.company}} · {{project.name}} · {{project.value}} · {{user.business_name}}'),
      projectId
    })

    expect(made.document.body).toBe(
      'Northgate Studio Ltd · Ashfield House · £4,800.00 · Blockout Digital'
    )
  })

  it('finds the client through the project', () => {
    // Nobody should have to name the client of a project they just chose.
    const clientId = client('Northgate Studio Ltd')
    const projectId = project('Ashfield House', { clientId })

    const made = generateDocument(db, {
      templateId: template('{{client.company}}'),
      projectId
    })

    expect(made.document.body).toBe('Northgate Studio Ltd')
    expect(made.document.clientId).toBe(clientId)
  })

  it('says what it could not fill, and leaves it visible', () => {
    const made = generateDocument(db, { templateId: template('For {{client.company}}.') })

    expect(made.unresolved).toEqual(['client.company'])
    expect(made.document.body).toContain('{{client.company}}')
  })

  it('names the document after the project it is for', () => {
    const projectId = project('Ashfield House')
    const contract = listDocTemplates(db).find((one) => one.name === 'Freelance contract')!

    const made = generateDocument(db, { templateId: contract.id, projectId })
    expect(made.document.title).toBe('Freelance contract — Ashfield House')
  })

  it('starts as a draft with its first version kept', () => {
    const made = generateDocument(db, { templateId: template('Hello') })

    expect(made.document.status).toBe('draft')
    expect(documentVersions(db, made.document.id)).toHaveLength(1)
  })

  it('writes a date a contract can be read aloud from', () => {
    const projectId = project('X', { dueOn: '2026-04-01' })
    const made = generateDocument(db, {
      templateId: template('{{project.due}}'),
      projectId
    })
    expect(made.document.body).toBe('1 April 2026')
  })
})

describe('editing and history', () => {
  let db: InstanceType<typeof Database>
  let documentId: number

  beforeEach(() => {
    db = new Database(':memory:')
    const made = generateDocument(db, {
      templateId: createDocTemplate(db, { name: 'T', body: 'first' }).id
    })
    documentId = made.document.id
  })

  afterEach(() => {
    db.close()
  })

  it('keeps a version per save', () => {
    saveDocumentBody(db, documentId, 'second')
    saveDocumentBody(db, documentId, 'third')

    expect(documentVersions(db, documentId).map((one) => one.body)).toEqual([
      'third',
      'second',
      'first'
    ])
  })

  it('does not keep a version when nothing changed', () => {
    // A hundred identical snapshots is a history nobody can read.
    saveDocumentBody(db, documentId, 'first')
    expect(documentVersions(db, documentId)).toHaveLength(1)
  })

  it('restores an old version forwards, not by deleting what came after', () => {
    saveDocumentBody(db, documentId, 'second')
    const [, original] = documentVersions(db, documentId)

    const restored = restoreDocumentVersion(db, documentId, original!.id)

    expect(restored.body).toBe('first')
    // Undoing the restore has to be possible, so 'second' is still there.
    expect(documentVersions(db, documentId)).toHaveLength(3)
    expect(documentVersions(db, documentId).some((one) => one.body === 'second')).toBe(true)
  })

  it('tracks a signature by hand', () => {
    const signed = setDocumentStatus(db, documentId, 'signed', 'Countersigned by post')

    expect(signed.status).toBe('signed')
    expect(signed.statusAt).not.toBeNull()
    expect(signed.statusNote).toBe('Countersigned by post')
  })

  it('clears the date when it goes back to a draft', () => {
    // A document that is a draft was not signed on any particular day.
    setDocumentStatus(db, documentId, 'signed')
    expect(setDocumentStatus(db, documentId, 'draft').statusAt).toBeNull()
  })
})
