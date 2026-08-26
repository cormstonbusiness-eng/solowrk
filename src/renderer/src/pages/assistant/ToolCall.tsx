import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight, Wrench } from 'lucide-react'
import type { ChatMessage } from '@shared/types'
import { Expand } from '@/components/ui/Expand'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/** Reads as a sentence rather than a function call, but stays exact. */
const LABELS: Record<string, string> = {
  list_workspace: 'Listed a folder',
  read_file: 'Read a file',
  write_file: 'Wrote a file',
  recent_files: 'Checked recent files',
  list_projects: 'Looked at your projects',
  list_clients: 'Looked at your clients',
  list_tasks: 'Looked at your tasks',
  create_task: 'Created a task',
  update_task: 'Updated a task',
  list_categories: 'Checked your categories',
  list_time: 'Read your tracked time',
  log_time: 'Logged time',
  list_invoices: 'Read your invoices',
  create_invoice_draft: 'Created a draft invoice',
  list_expenses: 'Read your expenses',
  get_finance_summary: 'Read your finance summary',
  list_blocks: 'Checked your calendar',
  create_block: 'Added it to your calendar',
  list_notes: 'Listed project notes',
  write_note: 'Wrote a note',
  list_documents: 'Searched your documents',
  current_time: 'Checked the date'
}

/**
 * One line per tool call, expandable.
 *
 * Collapsed by default because a transcript of six lookups buries the answer,
 * but never hidden: the point of the assistant having real access is that you
 * can see exactly what it touched.
 */
export function ToolCall({ message }: { message: ChatMessage }): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const name = message.toolName ?? 'tool'
  const failed = message.toolResult?.startsWith('Error: ') ?? false

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition.page}
      className="rounded-control border border-line bg-surface/60"
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
      >
        <Wrench
          size={12}
          strokeWidth={1.75}
          className={cn('shrink-0', failed ? 'text-danger' : 'text-faint')}
        />
        <span className="flex-1 truncate text-[12px] text-muted">
          {LABELS[name] ?? name}
          {failed && ' — failed'}
        </span>
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={transition.press}>
          <ChevronRight size={12} strokeWidth={1.75} className="text-faint" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <Expand>
            <div className="border-t border-line px-3 py-2">
              {message.toolInput && (
                <>
                  <p className="mb-1 text-[10.5px] tracking-[0.06em] text-faint uppercase">
                    Input
                  </p>
                  <pre className="numeric mb-2 max-h-[160px] overflow-auto text-[11px] leading-relaxed whitespace-pre-wrap text-muted">
                    {pretty(message.toolInput)}
                  </pre>
                </>
              )}

              <p className="mb-1 text-[10.5px] tracking-[0.06em] text-faint uppercase">Result</p>
              <pre className="numeric max-h-[240px] overflow-auto text-[11px] leading-relaxed whitespace-pre-wrap text-muted">
                {message.toolResult || '—'}
              </pre>
            </div>
          </Expand>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    // Stored unparsed for some reason — showing it raw beats showing nothing.
    return json
  }
}