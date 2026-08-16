import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowUp,
  MessageSquarePlus,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import type { AssistantMode, ChatMessage, PermissionRequest } from '@shared/types'
import { ASSISTANT_MODES } from '@shared/types'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { ToolCall } from './assistant/ToolCall'
import { PermissionCard } from './assistant/PermissionCard'
import { SetupPanel } from './assistant/SetupPanel'

const SUGGESTIONS = [
  'What am I owed right now, and who is late?',
  'Summarise what I worked on this week.',
  'What is due in the next seven days?',
  'Draft an invoice for the unbilled time on my busiest project.'
]

export function Assistant(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState('')
  const [working, setWorking] = useState(false)
  const [permission, setPermission] = useState<PermissionRequest | null>(null)
  const [mode, setMode] = useState<AssistantMode>('general')
  const bottom = useRef<HTMLDivElement>(null)

  /**
   * `?ask=…&mode=…` seeds the box from elsewhere in the app — the blog's
   * Repurpose button, for one. Deliberately prefilled rather than sent: you
   * should see and be able to edit what is about to be asked on your behalf.
   */
  const [search, setSearch] = useSearchParams()
  useEffect(() => {
    const ask = search.get('ask')
    if (ask === null) return

    setInput(ask)
    const requested = search.get('mode')
    if (ASSISTANT_MODES.some((entry) => entry.value === requested)) {
      setMode(requested as AssistantMode)
    }

    // Cleared so navigating back here later does not refill the box.
    setSearch({}, { replace: true })
  }, [search, setSearch])

  const { data: status } = useQuery({
    queryKey: ['ai', 'status'],
    queryFn: () => window.solo.invoke('ai:status')
  })

  const { data: conversations = [] } = useQuery({
    queryKey: ['ai', 'conversations'],
    queryFn: () => window.solo.invoke('ai:conversations')
  })

  const { data: messages = [] } = useQuery({
    queryKey: ['ai', 'messages', conversationId],
    queryFn: () => window.solo.invoke('ai:messages', { conversationId: conversationId! }),
    enabled: conversationId !== null
  })

  // Open the most recent chat rather than an empty screen.
  useEffect(() => {
    if (conversationId === null && conversations.length > 0) {
      setConversationId(conversations[0]!.id)
    }
  }, [conversations, conversationId])

  /**
   * One subscription for the whole page. Text arrives as deltas and is held in
   * local state until the finished message is stored — at which point the
   * stored copy takes over and the buffer is cleared, so the text never
   * appears twice.
   */
  useEffect(() => {
    return window.solo.on('ai:event', (event) => {
      if (event.kind === 'delta') {
        setStreaming((current) => current + event.text)
        return
      }

      if (event.kind === 'message') {
        if (event.message.role === 'assistant') setStreaming('')
        queryClient.setQueryData<ChatMessage[]>(
          ['ai', 'messages', event.conversationId],
          (current = []) => [...current, event.message]
        )
        void queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
        return
      }

      if (event.kind === 'permission') {
        setPermission(event.request)
        return
      }

      if (event.kind === 'done') {
        setWorking(false)
        setStreaming('')
        setPermission(null)
        // Tools may have changed anything, so the whole app is refetched
        // rather than guessing which page is now stale.
        void queryClient.invalidateQueries()
      }
    })
  }, [queryClient])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, streaming, permission])

  const newChat = useMutation({
    mutationFn: () => window.solo.invoke('ai:newConversation'),
    onSuccess: (conversation) => {
      void queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
      setConversationId(conversation.id)
      setStreaming('')
    }
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('ai:deleteConversation', { id }),
    onSuccess: (_result, id) => {
      void queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
      if (conversationId === id) setConversationId(null)
    }
  })

  async function send(text: string): Promise<void> {
    const trimmed = text.trim()
    if (trimmed === '' || working) return

    let id = conversationId
    if (id === null) {
      const conversation = await window.solo.invoke('ai:newConversation')
      id = conversation.id
      setConversationId(id)
      void queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
    }

    setInput('')
    setWorking(true)
    setStreaming('')

    try {
      await window.solo.invoke('ai:send', { conversationId: id, text: trimmed, mode })
    } catch {
      // The turn's own error message is stored and streamed back by main; a
      // rejection here just means the call did not complete.
      setWorking(false)
    }
  }

  function answer(allow: boolean, always = false): void {
    if (!permission) return
    void window.solo.invoke('ai:permission', { id: permission.id, allow, always })
    setPermission(null)
  }

  if (status && !status.ready) {
    return (
      <Page title="Assistant" description="Claude, with real access to your workspace.">
        <SetupPanel status={status} />
      </Page>
    )
  }

  return (
    <Page
      title="Assistant"
      description="Claude, with real access to your workspace."
      className="flex min-h-0 flex-col overflow-y-hidden"
      actions={
        <>
          {/* A lens, not a limit: modes change what it leads with, so "what
              should I do today" answers differently in Finance than Marketing. */}
          <Select
            value={mode}
            onChange={(value) => setMode((value ?? 'general') as AssistantMode)}
            className="w-[180px]"
            options={ASSISTANT_MODES.map((entry) => ({
              value: entry.value,
              label: entry.label
            }))}
          />
          <Button variant="outline" onClick={() => newChat.mutate()}>
            <MessageSquarePlus size={14} strokeWidth={1.75} />
            New chat
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="flex w-[200px] shrink-0 flex-col gap-0.5 overflow-y-auto">
          {conversations.map((conversation) => (
            <div key={conversation.id} className="group relative">
              <button
                type="button"
                onClick={() => {
                  setConversationId(conversation.id)
                  setStreaming('')
                }}
                className={cn(
                  'w-full truncate rounded-control px-2.5 py-1.5 pr-7 text-left text-[12.5px] transition-colors',
                  conversation.id === conversationId
                    ? 'bg-raised text-ink'
                    : 'text-muted hover:bg-raised/60 hover:text-ink'
                )}
              >
                {conversation.title}
              </button>
              <button
                type="button"
                aria-label="Delete chat"
                onClick={() => remove.mutate(conversation.id)}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
              >
                <Trash2 size={12} strokeWidth={1.75} />
              </button>
            </div>
          ))}

          {conversations.length === 0 && (
            <p className="px-2.5 py-1.5 text-[12px] text-faint">No chats yet.</p>
          )}
        </aside>

        <div className="flex min-h-0 flex-1 flex-col rounded-card border border-line">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 && streaming === '' ? (
              <div className="grid h-full place-items-center">
                <div className="max-w-[440px] text-center">
                  <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-panel border border-line bg-surface">
                    <Sparkles size={17} strokeWidth={1.5} className="text-accent" />
                  </div>
                  <p className="text-[13px] text-ink">Ask about your own business</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted">
                    It can read your projects, time, invoices and files, and make changes once
                    you approve them.{' '}
                    {ASSISTANT_MODES.find((entry) => entry.value === mode)?.hint}.
                  </p>

                  <div className="mt-4 flex flex-col gap-1.5">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => void send(suggestion)}
                        className="rounded-control border border-line px-3 py-2 text-left text-[12px] text-muted transition-colors hover:border-line-strong hover:text-ink"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-[720px] flex-col gap-3">
                {messages.map((message) => (
                  <Message key={message.id} message={message} />
                ))}

                {streaming !== '' && <Bubble role="assistant" text={streaming} />}

                <AnimatePresence>
                  {permission && (
                    <PermissionCard
                      request={permission}
                      onAllow={(always) => answer(true, always)}
                      onDeny={() => answer(false)}
                    />
                  )}
                </AnimatePresence>

                {working && streaming === '' && !permission && <Thinking />}

                <div ref={bottom} />
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-line p-2.5">
            <div className="mx-auto flex max-w-[720px] items-end gap-2">
              <textarea
                rows={1}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  // Enter sends; Shift+Enter is a newline. A chat box that
                  // needs a mouse click to send is a chat box nobody uses.
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send(input)
                  }
                }}
                placeholder="Ask about your projects, time, invoices or files…"
                className="max-h-[140px] min-h-[38px] flex-1 resize-none rounded-control border border-line bg-raised px-3 py-2 text-[13px] text-ink placeholder:text-faint hover:border-line-strong focus:border-accent focus:outline-none"
              />

              {working ? (
                <Button
                  variant="danger"
                  onClick={() => void window.solo.invoke('ai:interrupt')}
                  aria-label="Stop"
                >
                  <Square size={12} strokeWidth={2.5} />
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => void send(input)}
                  disabled={input.trim() === ''}
                  aria-label="Send"
                >
                  <ArrowUp size={15} strokeWidth={2} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Page>
  )
}

function Message({ message }: { message: ChatMessage }): React.JSX.Element {
  if (message.role === 'tool') return <ToolCall message={message} />

  if (message.role === 'error') {
    return (
      <div className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger/8 px-3 py-2">
        <TriangleAlert size={13} strokeWidth={1.75} className="mt-0.5 shrink-0 text-danger" />
        <p className="text-[12.5px] leading-relaxed text-ink">{message.content}</p>
      </div>
    )
  }

  return <Bubble role={message.role} text={message.content} />
}

function Bubble({ role, text }: { role: string; text: string }): React.JSX.Element {
  const isUser = role === 'user'

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition.page}
      className={cn('flex', isUser && 'justify-end')}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-card px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap',
          isUser ? 'bg-accent text-accent-ink' : 'bg-surface text-ink'
        )}
      >
        {text}
      </div>
    </motion.div>
  )
}

function Thinking(): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 px-1">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: index * 0.15 }}
          className="h-1.5 w-1.5 rounded-full bg-muted"
        />
      ))}
    </div>
  )
}