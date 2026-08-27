import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Flag, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { TextInput } from '@/components/ui/Field'
import { useInvalidate } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * The dates inside a project that are not its deadline.
 *
 * A project has one date it ends on, and that is already on the project. A
 * three-month build also has a design sign-off, a content deadline and a
 * launch — dates somebody is held to rather than work anybody performs, which
 * is why they are not tasks. Putting them on the board would make a column of
 * things nobody can tick.
 *
 * They reach the calendar as derived markers, so they are never copied into
 * it and changing one here changes it there.
 */
export function Milestones({ projectId }: { projectId: number }): React.JSX.Element {
  const invalidate = useInvalidate()
  const [title, setTitle] = useState('')
  const [dueOn, setDueOn] = useState('')

  const { data: milestones = [] } = useQuery({
    queryKey: ['milestones', projectId],
    queryFn: () => window.solo.invoke('milestones:list', { projectId })
  })

  const refresh = (): void => {
    void invalidate(['projects', 'calendar'])
  }

  const add = useMutation({
    mutationFn: () => window.solo.invoke('milestones:create', { projectId, title, dueOn }),
    onSuccess: () => {
      setTitle('')
      setDueOn('')
      refresh()
    }
  })

  const reach = useMutation({
    mutationFn: (input: { id: number; reached: boolean }) =>
      window.solo.invoke('milestones:reached', input),
    onSuccess: refresh
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('milestones:delete', { id }),
    onSuccess: refresh
  })

  return (
    <Card className="col-span-2">
      <CardHeader title="Milestones" />

      {milestones.length === 0 ? (
        <p className="rounded-control border border-dashed border-line px-3 py-4 text-center text-[12px] text-muted">
          No milestones. A sign-off, a content deadline, a launch — the dates
          between now and the end.
        </p>
      ) : (
        <div className="mb-3 flex flex-col gap-1">
          {milestones.map((one) => (
            <div
              key={one.id}
              className="group flex items-center gap-2.5 rounded-control border border-line bg-raised px-3 py-2"
            >
              {/* Reached, not done. A milestone is a date, and "done" would
                  invite somebody to look for the work it represented. */}
              <button
                type="button"
                aria-label={one.reachedAt ? `Unmark ${one.title}` : `Mark ${one.title} reached`}
                onClick={() => reach.mutate({ id: one.id, reached: one.reachedAt === null })}
                className={cn(
                  'grid size-[18px] shrink-0 place-items-center rounded-full border transition-colors',
                  one.reachedAt
                    ? 'border-accent bg-accent text-accent-ink'
                    : 'border-line-strong text-transparent hover:border-accent'
                )}
              >
                <Flag size={9} strokeWidth={2.5} />
              </button>

              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[13px]',
                  one.reachedAt ? 'text-faint line-through' : 'text-ink'
                )}
              >
                {one.title}
              </span>

              <span className="numeric shrink-0 text-[11.5px] text-muted">{one.dueOn}</span>

              <button
                type="button"
                aria-label={`Remove ${one.title}`}
                onClick={() => remove.mutate(one.id)}
                className="rounded-control p-1 text-faint opacity-0 transition-all group-hover:opacity-100 hover:text-danger"
              >
                <Trash2 size={12} strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <TextInput
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Design sign-off"
          className="flex-1"
        />
        <TextInput
          type="date"
          value={dueOn}
          onChange={(event) => setDueOn(event.target.value)}
          className="w-[150px]"
        />
        <Button
          variant="outline"
          disabled={!title.trim() || !dueOn}
          onClick={() => add.mutate()}
        >
          <Plus size={13} strokeWidth={1.75} />
          Add
        </Button>
      </div>
    </Card>
  )
}
