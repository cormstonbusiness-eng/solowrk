import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Plus, X } from 'lucide-react'
import type { EntityRef, Tag } from '@shared/types'
import { fuzzyRank } from '@/lib/fuzzy'
import { listItemVariants, transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * The tags on one record.
 *
 * Typing a tag and picking one are the same gesture: the box filters what
 * already exists and Enter takes the top match, or makes a new tag when
 * nothing matches. Two separate controls — "pick from a list" and "add a new
 * one" — would ask people to know which one they are doing before they start,
 * and a vocabulary of six tags does not warrant that.
 */
export function Tags({ subject }: { subject: EntityRef }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const box = useRef<HTMLDivElement>(null)

  const { data: mine = [] } = useQuery({
    queryKey: ['tags', subject.type, subject.id],
    queryFn: () => window.solo.invoke('tags:for', subject)
  })

  const { data: all = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: () => window.solo.invoke('tags:list', undefined),
    enabled: adding
  })

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['tags'] })
  }

  const add = useMutation({
    mutationFn: (name: string) => window.solo.invoke('tags:add', { ...subject, name }),
    onSuccess: () => {
      refresh()
      setDraft('')
    }
  })

  const remove = useMutation({
    mutationFn: (tagId: number) => window.solo.invoke('tags:remove', { ...subject, tagId }),
    onSuccess: refresh
  })

  useEffect(() => {
    if (!adding) return
    const onDown = (event: MouseEvent): void => {
      if (!box.current?.contains(event.target as Node)) {
        setAdding(false)
        setDraft('')
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [adding])

  const taken = new Set(mine.map((one) => one.id))
  const suggestions = fuzzyRank(
    all.filter((one) => !taken.has(one.id)),
    draft,
    (one) => one.name,
    6
  ).map((scored) => scored.item)

  const exact = all.find((one) => one.name.toLowerCase() === draft.trim().toLowerCase())

  const commit = (name: string): void => {
    const trimmed = name.trim()
    if (trimmed) add.mutate(trimmed)
  }

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium tracking-[0.04em] text-faint uppercase">Tags</h3>

      <div ref={box} className="relative flex flex-wrap items-center gap-1.5">
        <AnimatePresence initial={false}>
          {mine.map((one) => (
            <motion.span
              key={one.id}
              variants={listItemVariants}
              initial="initial"
              animate="animate"
              exit={{ opacity: 0, scale: 0.9 }}
              transition={transition.press}
              style={{
                color: one.colour,
                backgroundColor: `${one.colour}1a`,
                borderColor: `${one.colour}44`
              }}
              className="group flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2 text-[11.5px]"
            >
              {one.name}
              <button
                type="button"
                aria-label={`Remove ${one.name}`}
                onClick={() => remove.mutate(one.id)}
                className="rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/10"
              >
                <X size={10} strokeWidth={2.25} />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>

        {adding ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                // The top suggestion when there is one, otherwise what was
                // typed — which makes a new tag.
                commit(suggestions[0]?.name ?? draft)
              }
              if (event.key === 'Escape') {
                setAdding(false)
                setDraft('')
              }
            }}
            placeholder="Tag…"
            className="h-6 w-[110px] rounded-full border border-line bg-raised px-2.5 text-[11.5px] text-ink outline-none placeholder:text-faint focus:border-line-strong"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded-full border border-dashed border-line px-2 py-0.5 text-[11.5px] text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            <Plus size={11} strokeWidth={2} />
            Tag
          </button>
        )}

        {adding && (suggestions.length > 0 || draft.trim()) && (
          <div className="absolute top-full left-0 z-20 mt-1 w-[200px] overflow-hidden rounded-panel border border-line-strong bg-surface p-1 shadow-modal">
            {suggestions.map((one) => (
              <Suggestion key={one.id} tag={one} onPick={() => commit(one.name)} />
            ))}

            {/* Only offered when it really would be new. Otherwise it reads as
                a second, different action from picking the match above it. */}
            {draft.trim() && !exact && (
              <button
                type="button"
                onClick={() => commit(draft)}
                className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-[12px] text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                <Plus size={11} strokeWidth={2} />
                New tag “{draft.trim()}”
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function Suggestion({ tag, onPick }: { tag: Tag; onPick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-[12px]',
        'text-ink transition-colors hover:bg-raised'
      )}
    >
      <span
        aria-hidden
        style={{ backgroundColor: tag.colour }}
        className="h-2 w-2 shrink-0 rounded-full"
      />
      {tag.name}
    </button>
  )
}
