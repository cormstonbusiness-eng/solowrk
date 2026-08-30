import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { BookMarked, Link2, Plus, Quote, Sparkles, Image as ImageIcon } from 'lucide-react'
import type { LibraryAssetWithContext, LibraryType } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { TextInput } from '@/components/ui/Field'
import { keys, useInvalidate } from '@/lib/api'
import { useFeature } from '@/lib/features'
import { listItemVariants, listVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { LibraryDrawer } from './LibraryDrawer'

/**
 * Everything reusable, in one grid (§7).
 *
 * Four kinds of thing that behave identically — filed, tagged, searched,
 * archived — so they share a table, a grid and a drawer. The chips are the
 * only place the difference shows, and "Assets" covers two stored types
 * because images and templates are one idea to the person using them.
 *
 * Filtering happens here rather than in SQL. A freelancer's library is dozens
 * of items, not thousands, and doing it locally means the chips are instant
 * and the "Assets" chip can span two types without a second query shape.
 */

type Chip = 'all' | 'case_study' | 'testimonial' | 'asset' | 'swipe'

const CHIPS: { value: Chip; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'case_study', label: 'Case studies' },
  { value: 'testimonial', label: 'Testimonials' },
  { value: 'asset', label: 'Assets' },
  { value: 'swipe', label: 'Swipe file' }
]

const ICONS: Record<LibraryType, typeof Quote> = {
  case_study: BookMarked,
  testimonial: Quote,
  image: ImageIcon,
  template: ImageIcon,
  swipe: Link2
}

function matches(chip: Chip, type: LibraryType): boolean {
  if (chip === 'all') return true
  if (chip === 'asset') return type === 'image' || type === 'template'
  return chip === type
}

export function LibraryTab(): React.JSX.Element {
  const invalidate = useInvalidate()
  const canDraft = useFeature('casestudies')

  const [chip, setChip] = useState<Chip>('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<LibraryAssetWithContext | null>(null)
  const [picking, setPicking] = useState(false)

  const { data: items = [] } = useQuery({
    queryKey: keys.library(search),
    queryFn: () => window.solo.invoke('library:list', { search })
  })

  const create = useMutation({
    mutationFn: (type: LibraryType) => window.solo.invoke('library:create', { type, title: '' }),
    onSuccess: (asset) => {
      invalidate(['marketing'])
      setOpen(asset)
    }
  })

  const visible = items.filter((item) => matches(chip, item.type))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-1">
          {CHIPS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              onClick={() => setChip(entry.value)}
              className={cn(
                'h-7 rounded-control px-2.5 text-[12px] transition-colors',
                chip === entry.value ? 'bg-raised text-ink' : 'text-faint hover:text-ink'
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="w-[200px]">
            <TextInput
              value={search}
              placeholder="Search everything…"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>

          {/* Writing one from a finished job is the Pro half. Keeping one is
              not, so the ordinary New button is always there. */}
          {canDraft && (
            <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
              <Sparkles size={13} strokeWidth={1.75} />
              From a project
            </Button>
          )}

          <Button
            variant="primary"
            size="sm"
            onClick={() => create.mutate(chip === 'all' || chip === 'asset' ? 'swipe' : chip)}
          >
            <Plus size={14} strokeWidth={1.75} />
            New
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty
          icon={BookMarked}
          title={search === '' ? 'Nothing here yet' : 'Nothing matches that'}
          body={
            search === ''
              ? 'Case studies, testimonials, reusable files, and other people’s marketing worth stealing from. All of it searchable when you sit down to write.'
              : 'Try a shorter search, or a different chip.'
          }
        />
      ) : (
        <motion.div
          variants={listVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2 overflow-y-auto pb-2"
        >
          {visible.map((item) => (
            <Card key={item.id} item={item} onOpen={() => setOpen(item)} />
          ))}
        </motion.div>
      )}

      <LibraryDrawer item={open} onClose={() => setOpen(null)} />

      {picking && (
        <ProjectPicker
          onClose={() => setPicking(false)}
          onPicked={(asset) => {
            setPicking(false)
            setOpen(asset)
          }}
        />
      )}
    </div>
  )
}

function Card({
  item,
  onOpen
}: {
  item: LibraryAssetWithContext
  onOpen: () => void
}): React.JSX.Element {
  const Icon = ICONS[item.type]

  return (
    <motion.button
      variants={listItemVariants}
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-hover"
    >
      <span className="flex items-center gap-1.5">
        <Icon size={12} strokeWidth={1.75} className="shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
          {item.title || 'Untitled'}
        </span>
      </span>

      {item.body.trim() !== '' && (
        <span className="line-clamp-3 text-[11px] leading-relaxed text-faint">{item.body}</span>
      )}

      <span className="mt-auto flex items-center gap-2 pt-1 text-[10.5px] text-disabled">
        {item.clientName !== '' && <span className="truncate">{item.clientName}</span>}
        {/* Said out loud on the card, because the moment somebody wants a
            testimonial is the moment they need to know they may use it. */}
        {item.type === 'testimonial' && (
          <span className={cn('ml-auto shrink-0', item.mayUse ? 'text-success' : 'text-warning')}>
            {item.mayUse ? 'cleared' : 'not cleared'}
          </span>
        )}
      </span>
    </motion.button>
  )
}

/**
 * Which finished job to write up.
 *
 * A plain list rather than a search: somebody who has just finished a project
 * is looking for it by name, and a freelancer has tens of projects rather
 * than hundreds.
 */
function ProjectPicker({
  onClose,
  onPicked
}: {
  onClose: () => void
  onPicked: (asset: LibraryAssetWithContext) => void
}): React.JSX.Element {
  const invalidate = useInvalidate()

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list')
  })

  const draft = useMutation({
    mutationFn: async (projectId: number) => {
      const drafted = await window.solo.invoke('library:draftCaseStudy', { projectId })
      return window.solo.invoke('library:create', { ...drafted, type: 'case_study' })
    },
    onSuccess: (asset) => {
      invalidate(['marketing'])
      onPicked(asset)
    }
  })

  return (
    <div className="fixed inset-0 z-40 grid place-items-center px-6">
      <div className="absolute inset-0 bg-[rgba(6,6,8,0.45)]" onClick={onClose} />

      <div className="relative flex max-h-[70vh] w-[420px] flex-col rounded-card border border-line-strong bg-surface shadow-modal">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-medium text-ink">Write up which job?</h2>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">
            SoloWrk fills in the dates, the hours and what was delivered. The problem, the approach
            and the outcome are left for you — they are the parts only you can write.
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {projects.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-faint">No projects to write up yet.</p>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                type="button"
                disabled={draft.isPending}
                onClick={() => draft.mutate(project.id)}
                className="flex items-center gap-2 rounded-control px-2.5 py-2 text-left transition-colors hover:bg-raised disabled:opacity-50"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: project.colour }}
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                  {project.name}
                </span>
                {project.clientName && (
                  <span className="shrink-0 text-[11px] text-faint">{project.clientName}</span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex justify-end border-t border-line px-4 py-2.5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
