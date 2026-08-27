import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { query, type PermissionResult, type Query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { BrowserWindow } from 'electron'
import type {
  AssistantEvent,
  AssistantMode,
  AssistantStatus,
  PermissionAnswer,
  PermissionRequest
} from '@shared/types'
import { readPlan } from './businessPlan'
import { session } from '../services/session'
import { getSettings } from '../services/settings'
import {
  addMessage,
  getConversation,
  setSessionId,
  titleFromFirstMessage
} from '../services/conversations'
import { MUTATING, describeCall, soloTools } from './tools'
import { systemPrompt } from './prompt'

type WindowGetter = () => BrowserWindow | null

/**
 * Only our own tools, plus the read-only search primitives, are on the table.
 *
 * `Glob` and `Grep` are deliberately *not* here. A bare name in `allowedTools`
 * auto-approves the tool before `canUseTool` is consulted at all, and both of
 * them take an absolute path — `Grep` with `output_mode: 'content'` returns
 * file contents. Allow-listing them would have left a way to read anything the
 * user can read, which is precisely the boundary `resolveInWorkspace` exists
 * to hold on our own tools, and precisely what a prompt-injected instruction
 * would reach for. They still run without a prompt; they run through
 * `requestPermission`, which checks where they are pointed first.
 */
const ALLOWED_BUILTINS = ['TodoWrite']

/** Read-only tools that are fine anywhere inside the workspace and nowhere else. */
const PATH_BOUNDED = new Set(['Glob', 'Grep', 'Read', 'NotebookRead'])

/** The arguments those tools use to say where to look. */
const PATH_KEYS = ['path', 'file_path', 'notebook_path']

/**
 * Hosts the Claude Agent SDK for one workspace.
 *
 * The SDK runs the user's own Claude Code installation as a subprocess, so the
 * subscription they already pay for covers the usage and no API key is stored
 * anywhere. That is also the failure mode: if Claude Code is not installed or
 * not logged in, this cannot work, and the app says so plainly rather than
 * showing a chat box that silently does nothing.
 */
class Assistant {
  private active: Query | null = null
  private abort: AbortController | null = null

  /** Pending confirmations, keyed by request id, awaiting the user's answer. */
  private pending = new Map<string, (answer: PermissionAnswer) => void>()

  /** Tools the user said "always" to, for this run of the app. */
  private trusted = new Set<string>()

  get busy(): boolean {
    return this.active !== null
  }

  /**
   * Whether a turn could run right now. Deliberately cheap — spawning the CLI
   * to find out would make opening the page slow, so this reports what we know
   * and a real failure surfaces on the first message with the SDK's own words.
   */
  status(): AssistantStatus {
    if (!session.isOpen) {
      return { ready: false, reason: 'No workspace is open' }
    }
    return { ready: true }
  }

  private emit(getWindow: WindowGetter, event: AssistantEvent): void {
    getWindow()?.webContents.send('ai:event', event)
  }

  /**
   * The confirmation gate.
   *
   * Read-only tools run unattended — asking permission to look at a list the
   * user is already looking at is theatre. Anything in `MUTATING` stops here
   * and waits for a real answer from the UI, and a turn that is interrupted
   * while waiting resolves as a denial rather than hanging.
   */
  private async requestPermission(
    getWindow: WindowGetter,
    conversationId: number,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<PermissionResult> {
    // Tool names arrive namespaced by the MCP server, e.g. mcp__solowrk__write_file.
    const bare = toolName.split('__').at(-1) ?? toolName

    // Where a borrowed tool is pointed, before anything else. Our own tools
    // resolve their paths inside the workspace; the SDK's built-ins do not
    // know the workspace exists, so the check has to happen here or not at
    // all. Silent when it passes — searching your own files should not cost a
    // dialog every time.
    if (PATH_BOUNDED.has(bare)) {
      const outside = escapingPath(input)
      if (outside !== null) {
        return {
          behavior: 'deny',
          message:
            `${outside} is outside this workspace. Everything you can read lives under ` +
            'the workspace folder; ask the user if you need something from elsewhere.'
        }
      }
    }

    if (!MUTATING.has(bare)) return { behavior: 'allow', updatedInput: input }
    if (this.trusted.has(bare)) return { behavior: 'allow', updatedInput: input }

    const request: PermissionRequest = {
      id: randomUUID(),
      toolName: bare,
      title: describeCall(bare, input),
      input
    }

    const answer = await new Promise<PermissionAnswer>((resolve) => {
      this.pending.set(request.id, resolve)
      this.emit(getWindow, { kind: 'permission', conversationId, request })
    })

    this.pending.delete(request.id)

    if (!answer.allow) {
      return {
        behavior: 'deny',
        message: 'The user declined this change. Do not try another way to make it.'
      }
    }

    if (answer.always) this.trusted.add(bare)
    return { behavior: 'allow', updatedInput: input }
  }

  /** Called from IPC when the user answers a confirmation card. */
  answerPermission(answer: PermissionAnswer): void {
    this.pending.get(answer.id)?.(answer)
  }

  async send(
    getWindow: WindowGetter,
    conversationId: number,
    text: string,
    mode: AssistantMode = 'general'
  ): Promise<void> {
    if (this.active) throw new Error('The assistant is still working on the previous message')

    const db = session.requireDb()
    const conversation = getConversation(db, conversationId)

    titleFromFirstMessage(db, conversationId, text)
    const userMessage = addMessage(db, { conversationId, role: 'user', content: text })
    this.emit(getWindow, { kind: 'message', conversationId, message: userMessage })

    this.abort = new AbortController()

    // Read fresh each turn rather than caching: the user may well have just
    // edited the plan and expects the next answer to reflect it.
    const businessPlan = (await readPlan(db, session.requirePath())) ?? undefined

    try {
      const stream = query({
        prompt: text,
        options: {
          abortController: this.abort,
          cwd: session.requirePath(),
          systemPrompt: systemPrompt(getSettings(db), session.requirePath(), {
            mode,
            businessPlan
          }),
          mcpServers: { solowrk: soloTools },
          allowedTools: ALLOWED_BUILTINS,
          // The workspace is the boundary. Without this the model could read
          // anywhere the user can, which is exactly what `resolveInWorkspace`
          // exists to prevent on our own tools.
          disallowedTools: ['Bash', 'Write', 'Edit', 'WebFetch', 'WebSearch'],
          // No CLAUDE.md or user settings from the machine: this session is the
          // app's, and should not inherit whatever the user configured for
          // their own coding work.
          settingSources: [],
          includePartialMessages: true,
          permissionMode: 'default',
          canUseTool: (toolName, input) =>
            this.requestPermission(getWindow, conversationId, toolName, input),
          ...(conversation.sessionId ? { resume: conversation.sessionId } : {})
        }
      })

      this.active = stream
      await this.consume(getWindow, conversationId, stream)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stored = addMessage(db, {
        conversationId,
        role: 'error',
        content: friendlyError(message)
      })
      this.emit(getWindow, { kind: 'message', conversationId, message: stored })
      this.emit(getWindow, { kind: 'error', conversationId, message: friendlyError(message) })
    } finally {
      this.finish(getWindow, conversationId)
    }
  }

  /**
   * Turn the SDK's message stream into the three things the UI needs: text as
   * it arrives, tool calls as they run, and a stored transcript.
   */
  private async consume(
    getWindow: WindowGetter,
    conversationId: number,
    stream: Query
  ): Promise<void> {
    const db = session.requireDb()
    // Tool inputs arrive with the assistant message; results arrive later on a
    // user message, so calls are held here until their result catches up.
    const calls = new Map<string, { name: string; input: unknown }>()

    for await (const message of stream as AsyncIterable<SDKMessage>) {
      if (message.type === 'system' && message.subtype === 'init') {
        setSessionId(db, conversationId, message.session_id)
        continue
      }

      if (message.type === 'stream_event') {
        const event = message.event
        if (
          event.type === 'content_block_delta' &&
          'delta' in event &&
          event.delta.type === 'text_delta'
        ) {
          this.emit(getWindow, { kind: 'delta', conversationId, text: event.delta.text })
        }
        continue
      }

      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text.trim() !== '') {
            const stored = addMessage(db, {
              conversationId,
              role: 'assistant',
              content: block.text
            })
            this.emit(getWindow, { kind: 'message', conversationId, message: stored })
          } else if (block.type === 'tool_use') {
            calls.set(block.id, { name: block.name, input: block.input })
          }
        }
        continue
      }

      if (message.type === 'user' && typeof message.message.content !== 'string') {
        for (const block of message.message.content) {
          if (block.type !== 'tool_result') continue
          const call = calls.get(block.tool_use_id)
          if (!call) continue
          calls.delete(block.tool_use_id)

          const stored = addMessage(db, {
            conversationId,
            role: 'tool',
            toolName: call.name.split('__').at(-1) ?? call.name,
            toolInput: call.input,
            toolResult: summariseResult(block)
          })
          this.emit(getWindow, { kind: 'message', conversationId, message: stored })
        }
        continue
      }

      if (message.type === 'result') {
        if (message.subtype !== 'success') {
          const stored = addMessage(db, {
            conversationId,
            role: 'error',
            content: friendlyError(message.subtype)
          })
          this.emit(getWindow, { kind: 'message', conversationId, message: stored })
        }
        break
      }
    }
  }

  /** Stop the current turn. Whatever has already been said is kept. */
  async interrupt(): Promise<void> {
    // Resolve anything waiting on a confirmation card as a denial, or the
    // query cannot unwind and the page stays stuck on "working".
    for (const [id, resolve] of this.pending) resolve({ id, allow: false })
    this.pending.clear()

    try {
      await this.active?.interrupt()
    } catch {
      // Older CLIs and already-finished queries both throw here; the abort
      // below is what actually guarantees the stream ends.
    }
    this.abort?.abort()
  }

  private finish(getWindow: WindowGetter, conversationId: number): void {
    this.active = null
    this.abort = null
    this.pending.clear()
    this.emit(getWindow, { kind: 'done', conversationId })
  }

  /** Called when the workspace closes: a session belongs to its workspace. */
  reset(): void {
    void this.interrupt()
    this.trusted.clear()
  }
}

function summariseResult(block: { content?: unknown; is_error?: boolean }): string {
  const text =
    typeof block.content === 'string'
      ? block.content
      : Array.isArray(block.content)
        ? block.content
            .map((part: unknown) =>
              typeof part === 'object' && part !== null && 'text' in part
                ? String((part as { text: unknown }).text)
                : ''
            )
            .join('')
        : ''

  const prefix = block.is_error ? 'Error: ' : ''
  // The full result is already in the model's context; the transcript only
  // needs enough to show what happened.
  return `${prefix}${text.length > 4000 ? `${text.slice(0, 4000)}\n[truncated]` : text}`
}

/**
 * The SDK's failures are mostly one of two things, and both have a fix the user
 * can act on — so say which it is instead of forwarding a stack trace.
 */
function friendlyError(message: string): string {
  const lower = message.toLowerCase()

  if (lower.includes('enoent') || lower.includes('not found') || lower.includes('spawn')) {
    return (
      'Could not start Claude. SoloWrk runs your own Claude Code installation, so it needs ' +
      'to be installed and on your PATH. Install it, run `claude` once to log in, then ' +
      'restart SoloWrk.'
    )
  }

  if (lower.includes('auth') || lower.includes('login') || lower.includes('credential')) {
    return 'Claude is installed but not logged in. Run `claude` in a terminal, sign in, then try again.'
  }

  if (lower.includes('abort')) return 'Stopped.'

  return message
}

export const assistant = new Assistant()
/**
 * The first path in a tool's input that leaves the workspace, or null.
 *
 * A relative path is resolved against the workspace and checked; an absolute
 * one is checked directly, because a built-in tool is perfectly entitled to
 * send one and `resolveInWorkspace` refuses those outright. Missing paths mean
 * "the working directory", which is already the workspace.
 */
function escapingPath(input: Record<string, unknown>): string | null {
  for (const key of PATH_KEYS) {
    const value = input[key]
    if (typeof value !== 'string' || value === '') continue

    const root = resolve(session.requirePath())
    const target = isAbsolute(value) ? resolve(value) : resolve(root, value)
    const rel = relative(root, target)

    // The prefix check catches a sibling that merely shares a name, e.g.
    // C:\SoloWrk-backup against C:\SoloWrk.
    const inside =
      target === root || (!rel.startsWith('..') && !isAbsolute(rel) && target.startsWith(root + sep))
    if (!inside) return value
  }
  return null
}
