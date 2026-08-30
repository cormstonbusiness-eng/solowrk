import type { Database, Row } from '../db'
import type { ContentItemWithContext } from '@shared/types'
import { createContent, getContent, listContent } from './content'

/**
 * One piece of work, many pieces of content (§9.1).
 *
 * Freelancers know they should get five things out of one job and do not do
 * it, because at the moment the job finishes the last thing anybody wants is
 * to sit down and write five posts. So this makes the *shells* — one per
 * channel, dated nowhere, sitting in the idea column — and leaves the writing
 * for a day when writing is what you are doing.
 *
 * **A derivative points at its source rather than copying it.** §9.1 asks for
 * the source body "attached as reference", and a copy would be the obvious
 * reading — but a copy drifts the moment somebody edits the original, and
 * then the derivative quotes a version of the post that no longer exists. The
 * link means the drawer can always show what is actually there.
 */

export interface RepurposeRequest {
  sourceId: number
  /** One derivative per channel. An empty list is a no-op, not an error. */
  channelIds: number[]
}

/**
 * Make the shells.
 *
 * Everything lands as an `idea` with no date. A derivative that arrived
 * pre-scheduled would put five things on the calendar somebody never agreed
 * to write, which is the fastest way to make a calendar untrustworthy.
 */
export function repurpose(db: Database, request: RepurposeRequest): ContentItemWithContext[] {
  const source = getContent(db, request.sourceId)

  const existing = new Set(
    derivativesOf(db, request.sourceId)
      .map((item) => item.channelId)
      .filter((id): id is number => id !== null)
  )

  const made: ContentItemWithContext[] = []

  for (const channelId of request.channelIds) {
    // Repurposing twice onto the same channel is almost always a double
    // click rather than an intention.
    if (existing.has(channelId)) continue

    const channel = db.get<Row & { name: string }>(
      'SELECT name FROM marketing_channels WHERE id = ?',
      [channelId]
    )

    made.push(
      createContent(db, {
        title: channel ? `${source.title || 'Untitled'} — for ${channel.name}` : source.title,
        channelId,
        // Inherited, so a campaign's derivatives stay with the campaign.
        campaignId: source.campaignId,
        parentContentId: source.id,
        sourceProjectId: source.sourceProjectId,
        status: 'idea'
      })
    )

    existing.add(channelId)
  }

  return made
}

/** Everything made from this item. */
export function derivativesOf(db: Database, sourceId: number): ContentItemWithContext[] {
  return listContent(db, {}).filter((item) => item.parentContentId === sourceId)
}

export interface ContentChain {
  /** What this was made from, if anything. */
  parent: ContentItemWithContext | null
  /** What was made from this. */
  derivatives: ContentItemWithContext[]
}

/**
 * The thread around one item, in both directions.
 *
 * Shown on the item itself so the chain is visible rather than implied — §9.1
 * asks for that specifically, and it is what turns "five orphaned drafts"
 * into "the five things that came out of the Harding job".
 */
export function chainFor(db: Database, id: number): ContentChain {
  const item = getContent(db, id)

  return {
    parent: item.parentContentId === null ? null : getContent(db, item.parentContentId),
    derivatives: derivativesOf(db, id)
  }
}
