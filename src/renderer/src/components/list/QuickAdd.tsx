import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarDays, FolderKanban, Signal, Tag } from 'lucide-react'
import { dayFromDate } from '@shared/calendar'
import { parseQuickAdd, type QuickAdd as Parsed } from '@shared/quickAdd'
import { keys } from '@/lib/api'
import { fuzzyRank } from '@/lib/fuzzy'
import { formatDate } from '@/lib/format'
import { transition } from '@/lib/motion'

/**
 * What a typed sentence would become, shown before it becomes it.
 *
 * The parser deliberately does not resolve names — it has no database — so
 * this is where `#Acme` turns into a real project, using the same fuzzy
 * matcher the palette uses. Which means `#Acme` finds "Acme rebrand 2026"
 * without anybody typing quotes.
 *
 * The strip under the input is the whole point. A quick-add that silently
 * guesses is worse than no quick-add: somebody who can see "Rebrand" and
 * "27 Aug, 2pm" before pressing Enter never has to submit it to find out what
 * it understood, and never discovers a week later that a task went to the
 * wrong project.
 */

export interface Resolved {
  parsed: Parsed
  /** The project the `#` matched, if any of them did. */
  projectId: number | null
  projectName: string | null
  categoryId: number | null
  categoryName: string | null
  /** `yyyy-mm-ddThh:mm`, or a bare day, or null — whatever the task wants. */
  dueAt: string | null
}

export function useQuickAdd(input: string, enabled = true): Resolved {
  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {}),
    enabled,
    staleTime: 10_000
  })

  const { data: categories = [] } = useQuery({
    queryKey: keys.categories,
    queryFn: () => window.solo.invoke('categories:list', undefined),
    enabled,
    staleTime: 10_000
  })

  return useMemo(() => {
    const parsed = parseQuickAdd(input, dayFromDate(new Date()))

    const project = parsed.project
      ? (fuzzyRank(projects, parsed.project, (one) => one.name, 1)[0]?.item ?? null)
      : null

    const category = parsed.category
      ? (fuzzyRank(categories, parsed.category, (one) => one.name, 1)[0]?.item ?? null)
      : null

    // A time only ever arrives with a day, so this cannot produce a stamp with
    // no date on it.
    const dueAt =
      parsed.dueAt && parsed.dueMinutes !== null
        ? `${parsed.dueAt}T${pad(Math.floor(parsed.dueMinutes / 60))}:${pad(parsed.dueMinutes % 60)}`
        : parsed.dueAt

    return {
      parsed,
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? null,
      dueAt
    }
  }, [input, projects, categories])
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

const PRIORITY_NAMES = ['Low', 'Normal', 'High', 'Urgent']

/** The strip under the input saying what was understood. */
export function QuickAddHint({ resolved }: { resolved: Resolved }): React.JSX.Element {
  const { parsed } = resolved

  const chips: { key: string; icon: typeof Tag; text: string; unmatched?: boolean }[] = []

  if (parsed.dueAt) {
    chips.push({
      key: 'date',
      icon: CalendarDays,
      text:
        parsed.dueMinutes === null
          ? formatDate(parsed.dueAt)
          : `${formatDate(parsed.dueAt)}, ${pad(Math.floor(parsed.dueMinutes / 60))}:${pad(parsed.dueMinutes % 60)}`
    })
  }

  if (parsed.project) {
    chips.push({
      key: 'project',
      icon: FolderKanban,
      // Said plainly when nothing matched, rather than dropped silently. A tag
      // that quietly did nothing is the thing people notice a week later.
      text: resolved.projectName ?? `no project called “${parsed.project}”`,
      unmatched: resolved.projectName === null
    })
  }

  if (parsed.category) {
    chips.push({
      key: 'category',
      icon: Tag,
      text: resolved.categoryName ?? `no category called “${parsed.category}”`,
      unmatched: resolved.categoryName === null
    })
  }

  if (parsed.priority !== null) {
    chips.push({
      key: 'priority',
      icon: Signal,
      text: PRIORITY_NAMES[parsed.priority] ?? 'Normal'
    })
  }

  return (
    <AnimatePresence initial={false}>
      {chips.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={transition.expand}
          className="overflow-hidden"
        >
          <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
            {chips.map((chip) => {
              const Icon = chip.icon
              return (
                <span
                  key={chip.key}
                  className={
                    chip.unmatched
                      ? 'flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] text-warning'
                      : 'flex items-center gap-1 rounded-full border border-accent/30 bg-accent-subtle px-2 py-0.5 text-[11px] text-accent'
                  }
                >
                  <Icon size={11} strokeWidth={1.75} />
                  {chip.text}
                </span>
              )
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
