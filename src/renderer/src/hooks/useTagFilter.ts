import { useQuery } from '@tanstack/react-query'
import type { EntityType } from '@shared/types'
import type { Facet } from '@/components/list/Toolbar'
import type { ListState } from './useListState'

/**
 * The tag filter, for any list.
 *
 * "Filterable everywhere" only means something if adding it to a page is one
 * line, so this returns both halves: a facet to hand the toolbar, and a
 * predicate to run over the rows. A page that forgets the predicate would show
 * chips that do nothing, which is worse than no chips.
 *
 * The matching is done in the main process because "carries *every* one of
 * these tags" is a GROUP BY … HAVING, and reproducing it in the renderer would
 * be the second implementation of a rule that has to agree with itself.
 */
export interface TagFilter {
  /** Hand this to the toolbar's `facets`. */
  facet: Facet
  /** True when the row survives the filter. */
  keep: (id: number) => boolean
  /** Whether any tag is selected, for an empty-state message. */
  active: boolean
}

export function useTagFilter(type: EntityType, state: ListState): TagFilter {
  const chosen = state.values('tag')

  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: () => window.solo.invoke('tags:list', undefined),
    staleTime: 10_000
  })

  const tagIds = chosen.map(Number).filter((id) => Number.isInteger(id))

  const { data: matching } = useQuery({
    queryKey: ['tags', 'matching', type, tagIds.join(',')],
    queryFn: () => window.solo.invoke('tags:matching', { type, tagIds }),
    enabled: tagIds.length > 0
  })

  const allowed = matching ? new Set(matching) : null

  return {
    facet: {
      key: 'tag',
      label: 'Tag',
      // Only tags actually in use — a vocabulary someone has been building for
      // a year should not put forty dead chips above a list of six rows.
      options: tags
        .filter((one) => one.uses > 0)
        .map((one) => ({
          value: String(one.id),
          label: one.name,
          colour: one.colour
        }))
    },
    // While the query is in flight, nothing is filtered out. The alternative —
    // an empty list for a moment — reads as "no results" rather than "loading",
    // and flashes on every chip.
    keep: (id) => allowed === null || allowed.has(id),
    active: tagIds.length > 0
  }
}
