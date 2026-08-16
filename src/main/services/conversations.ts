import type { Database, Row } from '../db'
import type { ChatMessage, ChatRole, Conversation } from '@shared/types'

interface ConversationRow extends Row {
  id: number
  title: string
  session_id: string | null
  project_id: number | null
  created_at: string
  updated_at: string
}

interface MessageRow extends Row {
  id: number
  conversation_id: number
  role: string
  content: string
  tool_name: string | null
  tool_input: string | null
  tool_result: string | null
  created_at: string
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    sessionId: row.session_id,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as ChatRole,
    content: row.content,
    toolName: row.tool_name,
    toolInput: row.tool_input,
    toolResult: row.tool_result,
    createdAt: row.created_at
  }
}

export function listConversations(db: Database): Conversation[] {
  return db
    .all<ConversationRow>('SELECT * FROM ai_conversations ORDER BY updated_at DESC, id DESC')
    .map(toConversation)
}

export function getConversation(db: Database, id: number): Conversation {
  const row = db.get<ConversationRow>('SELECT * FROM ai_conversations WHERE id = ?', [id])
  if (!row) throw new Error(`No conversation with id ${id}`)
  return toConversation(row)
}

/**
 * Millisecond precision, unlike `datetime('now')` used elsewhere.
 *
 * The chat list is ordered by this, and chats are created and used seconds
 * apart — at whole-second resolution, replying to an older chat fails to move
 * it to the top because it ties with a newer one and loses on id.
 */
const NOW = "strftime('%Y-%m-%d %H:%M:%f', 'now')"

export function createConversation(db: Database, projectId: number | null = null): Conversation {
  db.run(
    `INSERT INTO ai_conversations (title, project_id, created_at, updated_at)
     VALUES ('New chat', ?, ${NOW}, ${NOW})`,
    [projectId]
  )
  const row = db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')
  if (!row) throw new Error('Conversation was not created')
  return getConversation(db, row.id)
}

/**
 * The first thing you said becomes the title, trimmed to a line.
 *
 * Asking the model to name the chat would cost a round trip before the answer
 * you actually asked for, and the opening question is nearly always the better
 * label anyway.
 */
export function titleFromFirstMessage(db: Database, id: number, text: string): void {
  const conversation = getConversation(db, id)
  if (conversation.title !== 'New chat') return

  const title = text.replace(/\s+/g, ' ').trim().slice(0, 60)
  if (title.length === 0) return

  db.run('UPDATE ai_conversations SET title = ? WHERE id = ?', [title, id])
}

export function setSessionId(db: Database, id: number, sessionId: string): void {
  db.run('UPDATE ai_conversations SET session_id = ? WHERE id = ?', [sessionId, id])
}

export function touchConversation(db: Database, id: number): void {
  db.run(`UPDATE ai_conversations SET updated_at = ${NOW} WHERE id = ?`, [id])
}

export function deleteConversation(db: Database, id: number): void {
  db.run('DELETE FROM ai_conversations WHERE id = ?', [id])
}

export function listMessages(db: Database, conversationId: number): ChatMessage[] {
  return db
    .all<MessageRow>('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY id', [
      conversationId
    ])
    .map(toMessage)
}

export function addMessage(
  db: Database,
  message: {
    conversationId: number
    role: ChatRole
    content?: string
    toolName?: string | null
    toolInput?: unknown
    toolResult?: string | null
  }
): ChatMessage {
  db.run(
    `INSERT INTO ai_messages (conversation_id, role, content, tool_name, tool_input,
                              tool_result, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      message.conversationId,
      message.role,
      message.content ?? '',
      message.toolName ?? null,
      message.toolInput === undefined ? null : JSON.stringify(message.toolInput),
      message.toolResult ?? null
    ]
  )

  const row = db.get<MessageRow>('SELECT * FROM ai_messages WHERE id = last_insert_rowid()')
  if (!row) throw new Error('Message was not stored')

  touchConversation(db, message.conversationId)
  return toMessage(row)
}
