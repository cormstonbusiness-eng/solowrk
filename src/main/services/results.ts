import type { Database, Row } from '../db'
import type { CadencePeriod } from '@shared/cadence'
import type {
  CampaignReturn,
  ChannelConsistency,
  ChannelReturn,
  MarketingResults,
  SpendAgainstBudget
} from '@shared/types'
import { consistency } from '@shared/cadence'

/**
 * What actually worked (§8).
 *
 * Every figure here is derived from records the user already keeps — clients,
 * invoices, campaigns, content — plus the two source columns migration 30 put
 * on `clients`. There is no tracking infrastructure and there will not be:
 * attribution works because somebody says where a client came from when they
 * add them, which is both more honest and more accurate than a pixel.
 *
 * **Nothing here estimates.** A channel with no clients attributed to it
 * reports nothing rather than a guess, because the entire value of this page
 * is that a freelancer can believe it without checking. §8.3 is explicit that
 * an empty state beats an empty chart.
 */

/**
 * Where clients came from, by channel.
 *
 * §8.1 calls this the single most useful marketing fact a freelancer can
 * have, and almost none of them know it.
 */
export function clientsByChannel(db: Database, from: string, to: string): ChannelReturn[] {
  return db
    .all<Row & { channel_id: number; name: string; colour: string; clients: number; revenue: number | null }>(
      `SELECT ch.id AS channel_id,
              ch.name,
              ch.colour,
              COUNT(DISTINCT c.id) AS clients,
              (SELECT COALESCE(SUM(i.gross), 0)
                 FROM invoices i
                WHERE i.status = 'paid'
                  AND i.client_id IN (
                    SELECT c2.id FROM clients c2
                     WHERE c2.source_channel_id = ch.id
                       AND date(c2.created_at) BETWEEN ? AND ?
                  )) AS revenue
         FROM marketing_channels ch
         LEFT JOIN clients c
           ON c.source_channel_id = ch.id
          AND date(c.created_at) BETWEEN ? AND ?
        GROUP BY ch.id
        HAVING clients > 0
        ORDER BY revenue DESC, clients DESC`,
      [from, to, from, to]
    )
    .map((row) => ({
      channelId: row.channel_id,
      name: row.name,
      colour: row.colour,
      clients: row.clients,
      revenue: row.revenue ?? 0
    }))
}

export function campaignReturns(db: Database, from: string, to: string): CampaignReturn[] {
  return db
    .all<
      Row & {
        id: number
        name: string
        budget: number
        spend: number | null
        enquiries: number | null
        won: number
        revenue: number | null
      }
    >(
      `SELECT mc.id,
              mc.name,
              mc.budget,
              (SELECT COALESCE(SUM(m.spend), 0) FROM campaign_metrics m
                WHERE m.campaign_id = mc.id AND m.recorded_on BETWEEN ? AND ?) AS spend,
              (SELECT COALESCE(SUM(m.enquiries), 0) FROM campaign_metrics m
                WHERE m.campaign_id = mc.id AND m.recorded_on BETWEEN ? AND ?) AS enquiries,
              (SELECT COUNT(*) FROM clients c
                WHERE c.source_campaign_id = mc.id AND c.archived = 0) AS won,
              (SELECT COALESCE(SUM(i.gross), 0) FROM invoices i
                WHERE i.status = 'paid'
                  AND i.client_id IN (
                    SELECT c2.id FROM clients c2 WHERE c2.source_campaign_id = mc.id
                  )) AS revenue
         FROM marketing_campaigns mc
        WHERE mc.is_template = 0 AND mc.archived = 0`,
      [from, to, from, to]
    )
    .map((row) => {
      const spend = row.spend ?? 0
      const enquiries = row.enquiries ?? 0
      const revenue = row.revenue ?? 0

      return {
        campaignId: row.id,
        name: row.name,
        budget: row.budget,
        spend,
        enquiries,
        won: row.won,
        revenue,
        ratio: spend > 0 ? revenue / spend : null,
        costPerEnquiry: enquiries > 0 && spend > 0 ? Math.round(spend / enquiries) : null
      }
    })
    // Sorted by return, with the unmeasurable ones last rather than first —
    // a campaign with no spend is not the best-performing campaign.
    .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1))
}

/** The annual marketing budget, and what has gone against it. */
export function spendAgainstBudget(db: Database, from: string, to: string): SpendAgainstBudget {
  const budget =
    db.get<Row & { annual_budget: number }>('SELECT annual_budget FROM marketing_plan WHERE id = 1')
      ?.annual_budget ?? 0

  const spent =
    db.get<Row & { total: number | null }>(
      `SELECT COALESCE(SUM(spend), 0) AS total FROM campaign_metrics
        WHERE recorded_on BETWEEN ? AND ?`,
      [from, to]
    )?.total ?? 0

  return { budget, spent, remaining: budget - spent }
}

/**
 * The consistency strip (§8.2).
 *
 * One row per committed channel, one cell per period, each empty, partial or
 * met. The point is the *pattern*: posted through March, stopped in April
 * when a big project landed, started again in July when work dried up. That
 * shape is the actual problem, and seeing it drawn is more persuasive than
 * any advice — which is why the cells are three states rather than a
 * gradient. A gradient would be prettier and much harder to read.
 *
 * Only channels with a commitment appear. A channel promising nothing cannot
 * be inconsistent, and a row of empty cells against it would read as failure
 * at something nobody undertook.
 */
export function channelConsistency(
  db: Database,
  from: string,
  to: string
): ChannelConsistency[] {
  const channels = db.all<
    Row & { id: number; name: string; colour: string; cadence_count: number; cadence_period: string }
  >(
    `SELECT id, name, colour, cadence_count, cadence_period
       FROM marketing_channels
      WHERE is_active = 1 AND cadence_count > 0
      ORDER BY sort_order, id`
  )

  return channels.map((channel) => {
    /*
      Published only. A scheduled item is a promise, and a tracker built on
      promises would show a perfect year to somebody who posted nothing.

      Dated by `scheduled_for` in preference to `published_at`, which is the
      opposite of what it looks like it should be. `published_at` is stamped
      the moment somebody ticks the box, not the moment the post went out —
      so a March post ticked off in August lands in August, and a Sunday
      afternoon spent catching up on admin would redraw a whole year as one
      enormous week. `scheduled_for` is the user's own statement of when it
      goes out; ticking published confirms that it did. Only an item published
      with no date at all falls back to the stamp.
    */
    const published = db
      .all<Row & { day: string }>(
        `SELECT substr(COALESCE(scheduled_for, published_at), 1, 10) AS day
           FROM content_items
          WHERE channel_id = ? AND archived = 0 AND status = 'published'
            AND substr(COALESCE(scheduled_for, published_at), 1, 10) BETWEEN ? AND ?`,
        [channel.id, from, to]
      )
      .map((row) => row.day)

    return {
      channelId: channel.id,
      name: channel.name,
      colour: channel.colour,
      commitment: channel.cadence_count,
      period: channel.cadence_period as CadencePeriod,
      periods: consistency(
        { count: channel.cadence_count, period: channel.cadence_period as CadencePeriod },
        from,
        to,
        published
      )
    }
  })
}

/**
 * Everything the Results tab draws, in one call.
 *
 * One call rather than four because the page is a single answer to a single
 * question, and four queries would draw it in four stages.
 */
export function marketingResults(db: Database, from: string, to: string): MarketingResults {
  const channels = clientsByChannel(db, from, to)
  const campaigns = campaignReturns(db, from, to)
  const budget = spendAgainstBudget(db, from, to)
  const strip = channelConsistency(db, from, to)

  return {
    channels,
    campaigns,
    budget,
    consistency: strip,
    // §8.3: when there is no data, show one line rather than four empty
    // charts. A campaign with no spend and no clients is not data.
    empty:
      channels.length === 0 &&
      strip.length === 0 &&
      budget.budget === 0 &&
      campaigns.every((one) => one.spend === 0 && one.won === 0 && one.enquiries === 0)
  }
}
