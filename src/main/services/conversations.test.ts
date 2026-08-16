import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const {
  addMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  listMessages,
  setSessionId,
  titleFromFirstMessage
} = await import('./conversations')

describe('conversations', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => db.close())

  it('starts a conversation with a placeholder title', () => {
    expect(createConversation(db).title).toBe('New chat')
  })

  it('takes its title from the first message', () => {
    const conversation = createConversation(db)
    titleFromFirstMessage(db, conversation.id, 'What am I owed right now?')
    expect(getConversation(db, conversation.id).title).toBe('What am I owed right now?')
  })

  it('does not retitle on later messages', () => {
    const conversation = createConversation(db)
    titleFromFirstMessage(db, conversation.id, 'First question')
    titleFromFirstMessage(db, conversation.id, 'Second question')
    expect(getConversation(db, conversation.id).title).toBe('First question')
  })

  it('collapses whitespace and trims a long opening message', () => {
    const conversation = createConversation(db)
    titleFromFirstMessage(db, conversation.id, `  Summarise\n\n  my   week  ${'x'.repeat(200)}`)

    const { title } = getConversation(db, conversation.id)
    expect(title).toHaveLength(60)
    expect(title.startsWith('Summarise my week')).toBe(true)
  })

  it('ignores an empty opening message rather than blanking the title', () => {
    const conversation = createConversation(db)
    titleFromFirstMessage(db, conversation.id, '   \n  ')
    expect(getConversation(db, conversation.id).title).toBe('New chat')
  })

  it('stores tool calls with their input and result', () => {
    const conversation = createConversation(db)
    const stored = addMessage(db, {
      conversationId: conversation.id,
      role: 'tool',
      toolName: 'create_task',
      toolInput: { title: 'Chase Acme' },
      toolResult: 'ok'
    })

    expect(stored.toolInput).toBe('{"title":"Chase Acme"}')
    expect(listMessages(db, conversation.id)).toHaveLength(1)
  })

  it('keeps messages in the order they were said', () => {
    const conversation = createConversation(db)
    addMessage(db, { conversationId: conversation.id, role: 'user', content: 'one' })
    addMessage(db, { conversationId: conversation.id, role: 'assistant', content: 'two' })
    addMessage(db, { conversationId: conversation.id, role: 'user', content: 'three' })

    expect(listMessages(db, conversation.id).map((m) => m.content)).toEqual([
      'one',
      'two',
      'three'
    ])
  })

  it('remembers the SDK session so a chat can be resumed with its context', () => {
    const conversation = createConversation(db)
    expect(conversation.sessionId).toBeNull()

    setSessionId(db, conversation.id, 'abc-123')
    expect(getConversation(db, conversation.id).sessionId).toBe('abc-123')
  })

  it('lists the most recently used conversation first', () => {
    const older = createConversation(db)
    const newer = createConversation(db)

    // Both rows are aged explicitly rather than racing the clock: two inserts
    // in a test land in the same millisecond, which would make this assert
    // nothing about ordering.
    db.run("UPDATE ai_conversations SET updated_at = '2026-01-01 09:00:00.000' WHERE id = ?", [
      older.id
    ])
    db.run("UPDATE ai_conversations SET updated_at = '2026-01-02 09:00:00.000' WHERE id = ?", [
      newer.id
    ])

    expect(listConversations(db).map((c) => c.id)).toEqual([newer.id, older.id])

    addMessage(db, { conversationId: older.id, role: 'user', content: 'back to this one' })
    expect(listConversations(db)[0]?.id).toBe(older.id)
  })

  it('advances updated_at when something is said', () => {
    const conversation = createConversation(db)
    db.run("UPDATE ai_conversations SET updated_at = '2026-01-01 09:00:00.000' WHERE id = ?", [
      conversation.id
    ])

    addMessage(db, { conversationId: conversation.id, role: 'user', content: 'hello' })
    expect(getConversation(db, conversation.id).updatedAt > '2026-01-01 09:00:00.000').toBe(true)
  })

  it('takes its messages with it when deleted', () => {
    const conversation = createConversation(db)
    addMessage(db, { conversationId: conversation.id, role: 'user', content: 'hello' })

    deleteConversation(db, conversation.id)

    expect(listConversations(db)).toHaveLength(0)
    expect(listMessages(db, conversation.id)).toHaveLength(0)
  })
})
