import type { Database, Row } from '../db'
import type {
  CampaignMetric,
  CampaignMetricInput,
  ContentMetric,
  ContentMetricInput
} from '@shared/types'

/**
 * Numbers the user types in, because nothing here can fetch them.
 *
 * There is no platform integration (§1.1), so every figure on this page was
 * copied off a screen somewhere by hand. That shapes the whole design:
 *
 * **Every field is optional and stays optional.** Partial data is the normal
 * case — somebody notes impressions from LinkedIn and has no idea how many
 * clicks it got — and a form that refused to save without all five would be a
 * form nobody filled in twice. `null` means "not recorded", which is
 * different from zero and must stay different: zero clicks is a result, and
 * not looking is not.
 *
 * **One row per reading, not one per item.** A post measured a day after
 * publishing and again a month later has two readings, and overwriting the
 * first would throw away the fact that it kept working.
 */

/**
 * A figure as it should be stored.
 *
 * The renderer sends `''` for an empty number input, and `Number('')` is 0 —
 * which would silently record "nobody clicked" every time somebody left a box
 * alone. Anything that is not a real number becomes null.
 */
function figure(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return Number.isFinite(value) ? value : null
}

export function listContentMetrics(db: Database, contentId: number): ContentMetric[] {
  return db
    .all<
      Row & {
        id: number
        content_id: number
        recorded_at: string
        impressions: number | null
        engagements: number | null
        clicks: number | null
        enquiries: number | null
        notes: string
      }
    >(
      'SELECT * FROM content_metrics WHERE content_id = ? ORDER BY recorded_at DESC, id DESC',
      [contentId]
    )
    .map((row) => ({
      id: row.id,
      contentId: row.content_id,
      recordedAt: row.recorded_at,
      impressions: row.impressions,
      engagements: row.engagements,
      clicks: row.clicks,
      enquiries: row.enquiries,
      notes: row.notes
    }))
}

export function recordContentMetric(
  db: Database,
  contentId: number,
  input: ContentMetricInput
): ContentMetric[] {
  db.run(
    `INSERT INTO content_metrics
       (content_id, recorded_at, impressions, engagements, clicks, enquiries, notes)
     VALUES (?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?)`,
    [
      contentId,
      input.recordedAt ?? null,
      figure(input.impressions),
      figure(input.engagements),
      figure(input.clicks),
      figure(input.enquiries),
      input.notes ?? ''
    ]
  )

  return listContentMetrics(db, contentId)
}

export function deleteContentMetric(db: Database, id: number): void {
  db.run('DELETE FROM content_metrics WHERE id = ?', [id])
}

export function listCampaignMetrics(db: Database, campaignId: number): CampaignMetric[] {
  return db
    .all<
      Row & {
        id: number
        campaign_id: number
        recorded_on: string
        spend: number | null
        impressions: number | null
        clicks: number | null
        enquiries: number | null
        notes: string
      }
    >(
      'SELECT * FROM campaign_metrics WHERE campaign_id = ? ORDER BY recorded_on DESC, id DESC',
      [campaignId]
    )
    .map((row) => ({
      id: row.id,
      campaignId: row.campaign_id,
      recordedOn: row.recorded_on,
      spend: row.spend,
      impressions: row.impressions,
      clicks: row.clicks,
      enquiries: row.enquiries,
      notes: row.notes
    }))
}

export function recordCampaignMetric(
  db: Database,
  campaignId: number,
  input: CampaignMetricInput
): CampaignMetric[] {
  db.run(
    `INSERT INTO campaign_metrics
       (campaign_id, recorded_on, spend, impressions, clicks, enquiries, notes)
     VALUES (?, COALESCE(?, date('now')), ?, ?, ?, ?, ?)`,
    [
      campaignId,
      input.recordedOn ?? null,
      figure(input.spend),
      figure(input.impressions),
      figure(input.clicks),
      figure(input.enquiries),
      input.notes ?? ''
    ]
  )

  return listCampaignMetrics(db, campaignId)
}

export function deleteCampaignMetric(db: Database, id: number): void {
  db.run('DELETE FROM campaign_metrics WHERE id = ?', [id])
}
