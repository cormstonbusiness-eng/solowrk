import { useQuery } from '@tanstack/react-query'
import type { EntityType } from '@shared/types'

/**
 * The tags on a list row, read-only.
 *
 * Adding and removing happens in the drawer, where there is room for a picker.
 * Here they are only a marker — the thing that makes a filtered list legible
 * without opening anything.
 *
 * One query per row looks wasteful and is not: TanStack dedupes by key, and
 * the whole vocabulary is a handful of rows a workspace re-reads all day. The
 * alternative — threading a tag map down from every page — would put the same
 * plumbing in six places.
 */
export function RowTags({ type, id }: { type: EntityType; id: number }): React.JSX.Element | null {
  const { data: tags = [] } = useQuery({
    queryKey: ['tags', type, id],
    queryFn: () => window.solo.invoke('tags:for', { type, id }),
    staleTime: 10_000
  })

  if (tags.length === 0) return null

  return (
    <span className="flex shrink-0 items-center gap-1">
      {tags.map((tag) => (
        <span
          key={tag.id}
          style={{
            color: tag.colour,
            backgroundColor: `${tag.colour}1a`,
            borderColor: `${tag.colour}44`
          }}
          className="rounded-full border px-1.5 py-px text-[10.5px] whitespace-nowrap"
        >
          {tag.name}
        </span>
      ))}
    </span>
  )
}
