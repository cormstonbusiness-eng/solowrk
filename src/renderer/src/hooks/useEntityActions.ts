import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { EntityRef, EntityType } from '@shared/types'
import { invalidate, type Domain } from '@/lib/api'
import { useUndo } from './useUndo'

/**
 * Deleting and archiving, from anywhere, with the undo attached.
 *
 * One hook rather than a delete mutation on each of nine pages, because undo
 * is the kind of thing a call site forgets — and a delete without one is
 * exactly the delete somebody regrets. Going through here means the offer is
 * not something a page has to remember to make.
 */

/** Which cached queries each kind of thing appears in. */
const DOMAINS: Record<EntityType, Domain[]> = {
  client: ['clients', 'projects', 'invoices'],
  project: ['projects', 'tasks', 'notes', 'time'],
  task: ['tasks'],
  invoice: ['invoices', 'time', 'finance'],
  quote: ['quotes'],
  note: ['notes'],
  document: ['documents'],
  expense: ['expenses', 'finance']
}

const NOUNS: Record<EntityType, string> = {
  client: 'Client',
  project: 'Project',
  task: 'Task',
  invoice: 'Invoice',
  quote: 'Quote',
  note: 'Note',
  document: 'Document',
  expense: 'Expense'
}

export interface EntityActions {
  /**
   * Delete something, and offer to put it back.
   *
   * `label` is what to call it in the offer. It is passed in rather than looked
   * up because by the time the offer appears there is nothing left to look it
   * up from.
   */
  remove: (ref: EntityRef, label: string) => Promise<void>
  /** File something away, or bring it back, with the same offer. */
  archive: (ref: EntityRef, label: string, archived: boolean) => Promise<void>
}

export function useEntityActions(): EntityActions {
  const queryClient = useQueryClient()
  const { offer } = useUndo()

  const refresh = useCallback(
    (type: EntityType): void => {
      invalidate(queryClient, DOMAINS[type])
      // The trash list and the drawer's panels both change on any of this.
      void queryClient.invalidateQueries({ queryKey: ['trash'] })
      void queryClient.invalidateQueries({ queryKey: ['links'] })
    },
    [queryClient]
  )

  const remove = useCallback(
    async (ref: EntityRef, label: string): Promise<void> => {
      const entry = await window.solo.invoke('entity:delete', ref)
      refresh(ref.type)

      // What went with it, said plainly. Deleting a project takes its tasks and
      // notes, and finding that out afterwards is how people lose work.
      const also = entry.summary ? ` and ${entry.summary}` : ''
      offer(`Deleted ${label}${also}`, async () => {
        const result = await window.solo.invoke('trash:restore', { id: entry.id })
        refresh(ref.type)
        if (result.orphaned.length > 0) {
          // Restored, but not to where it was. Worth saying rather than
          // leaving somebody to wonder where it went.
          offer(`${result.restored} is back, but its ${result.orphaned.join(' and ')} has gone`)
        }
      })
    },
    [offer, refresh]
  )

  const archive = useCallback(
    async (ref: EntityRef, label: string, archived: boolean): Promise<void> => {
      await window.solo.invoke('entity:archive', { ...ref, archived })
      refresh(ref.type)

      offer(`${NOUNS[ref.type]} ${archived ? 'archived' : 'restored'}: ${label}`, async () => {
        await window.solo.invoke('entity:archive', { ...ref, archived: !archived })
        refresh(ref.type)
      })
    },
    [offer, refresh]
  )

  return { remove, archive }
}
