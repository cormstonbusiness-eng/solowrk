import type { Database, Row } from '../db'
import type { BusinessPlanStatus } from '@shared/types'
import { composePlan, type Answers, type PrefillKey } from '@shared/planInterview'
import { figuresFrom, type PlanFigures } from '@shared/planFigures'
import { classify, parsePlan } from '@shared/plan'
import { getSettings, updateSettings } from '../services/settings'
import { getPlan, listChannels, updatePlan } from '../services/channels'
import { startPlan, writePlan } from './businessPlan'

/**
 * The guided plan: what the app can answer for you, and what it does with the
 * answers afterwards.
 *
 * The interview itself is in `@shared/planInterview` — pure, testable, and
 * with no model behind it. This is the half that needs the workspace: three
 * answers it can fill in from what the user already typed into SoloWrk, and
 * the hand-off to Marketing once the plan exists.
 */

/* ------------------------------------------------------------------ *
 * What the app already knows
 * ------------------------------------------------------------------ */

/**
 * Answers taken from the workspace, so the interview does not ask twice.
 *
 * A key is only present when there is a real answer. An empty string would
 * show as a filled-in field with nothing in it, which reads as the app having
 * tried and failed rather than having not known.
 */
export function prefillAnswers(db: Database): Partial<Record<PrefillKey, string>> {
  const settings = getSettings(db)
  const prefill: Partial<Record<PrefillKey, string>> = {}

  const place = [settings.city, settings.postcode].map((part) => part.trim()).filter(Boolean)
  if (place.length > 0) prefill.location = place.join(', ')

  if (settings.defaultHourlyRate > 0) {
    /*
      Offered even when it is still the shipped default, because that default
      is what invoices actually bill at — it is the rate in force whether or
      not anybody has looked at it. The interview labels every prefilled
      answer with where it came from, which is what makes that honest rather
      than the app putting a number in somebody's business plan.

      Whole pounds: "£65 an hour" is what somebody says out loud, and this
      answer goes into a sentence rather than a column.
    */
    const pounds = settings.defaultHourlyRate / 100
    const shown = Number.isInteger(pounds) ? String(pounds) : pounds.toFixed(2)
    prefill.rate = `£${shown} an hour`
  }

  const channels = listChannels(db).map((channel) => channel.name)
  if (channels.length > 0) prefill.channels = channels.join('\n')

  return prefill
}

/* ------------------------------------------------------------------ *
 * Writing it
 * ------------------------------------------------------------------ */

/**
 * Turn the answers into the plan document.
 *
 * Goes through `startPlan` and `writePlan` rather than writing a file itself,
 * so the interview produces exactly the same kind of artefact as attaching a
 * document does: markdown in `Documents\Business`, recorded in settings,
 * readable by the assistant, editable by hand afterwards. There is no
 * "interview plan" that behaves differently from a real one.
 */
export async function buildPlanFromAnswers(
  db: Database,
  workspacePath: string,
  answers: Answers
): Promise<{ status: BusinessPlanStatus; applied: PlanFigures }> {
  const { businessName } = getSettings(db)
  const title =
    businessName.trim() === '' ? 'Business plan' : `${businessName.trim()} — business plan`

  // Creates the file and points settings at it, seeding from the template.
  await startPlan(db, workspacePath)
  const status = await writePlan(db, workspacePath, composePlan(title, answers))

  return { status, applied: applyFigures(db, answers) }
}

/**
 * Put the plan's own numbers behind the capacity calculator.
 *
 * The card at the top of the Business plan page asks what this business can
 * earn, and it was answering from a rate nobody had chosen while the plan
 * three inches below it said something different. Finishing the interview is
 * a deliberate act on answers the user just typed, so this applies on
 * completion rather than asking again — and the page says what it set.
 *
 * A figure the plan does not state is left alone. `null` means "the plan is
 * silent", which must never be written as zero: costs of nothing is a claim,
 * and it is one that makes the calculator flatter somebody.
 */
export function applyFigures(db: Database, answers: Answers): PlanFigures {
  const figures = figuresFrom(answers)
  const patch: Record<string, number> = {}

  if (figures.rate !== null) patch.defaultHourlyRate = figures.rate
  if (figures.annualCosts !== null) patch.plannedAnnualCosts = figures.annualCosts
  if (figures.takeHome !== null) patch.takeHomeTarget = figures.takeHome

  if (Object.keys(patch).length > 0) updateSettings(db, patch)

  return figures
}

/* ------------------------------------------------------------------ *
 * The hand-off to Marketing
 * ------------------------------------------------------------------ */

export interface MarketingSuggestion {
  /** What the marketing plan's audience would become. */
  audience: string
  /** Channels named in the plan that are not set up yet. */
  newChannels: string[]
  /** True when nothing in the plan says anything Marketing can use. */
  empty: boolean
}

/** Section bodies, keyed by the outline key rather than the heading written. */
function sectionsByKey(text: string): Map<string, string> {
  const found = new Map<string, string>()

  for (const section of parsePlan(text)) {
    const key = section.key ?? classify(section.heading)
    const body = section.body.trim()
    if (key && body !== '' && !found.has(key)) found.set(key, body)
  }

  return found
}

/**
 * A channel name out of a line of a plan.
 *
 * Plans say "LinkedIn, two posts a week" and "- Word of mouth (most of it)".
 * The name is the part before the first comma or bracket, which is wrong often
 * enough that the user confirms every one before any of them is created.
 */
function channelNameFrom(line: string): string {
  return line
    .replace(/^[-*•]\s*/, '')
    .split(/[,(–—:]/)[0]!
    .trim()
    .slice(0, 60)
}

/** Lines that read as a list item rather than as prose. */
function listLines(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*•]/.test(line))
    .map(channelNameFrom)
    .filter((name) => name !== '')
}

/**
 * What the business plan says that the marketing plan should know.
 *
 * Reads the finished document rather than the interview answers, so it works
 * identically for a plan somebody wrote in the app and one they attached from
 * Word — which is the whole point. A plan is a plan.
 *
 * **This proposes and never applies.** Marketing already holds an audience the
 * user may have written by hand, and quietly replacing it because they edited
 * a business plan section would be the kind of thing that makes people stop
 * trusting a document. `applyToMarketing` is a separate call the UI makes only
 * after somebody has seen what would change.
 */
export function marketingFromPlan(db: Database, text: string): MarketingSuggestion {
  const sections = sectionsByKey(text)

  const audience = (sections.get('market') ?? '').trim()

  const existing = new Set(
    listChannels(db, true).map((channel) => channel.name.trim().toLowerCase())
  )

  const named = listLines(sections.get('marketing') ?? '')
  const newChannels = [...new Set(named.map((name) => name))].filter(
    (name) => !existing.has(name.toLowerCase())
  )

  return {
    audience,
    newChannels,
    empty: audience === '' && newChannels.length === 0
  }
}

export interface ApplyRequest {
  /** Set the marketing plan's audience from the business plan. */
  audience?: string
  /** Channel names to create. Already-existing ones are ignored. */
  channels?: string[]
}

/**
 * Apply what the user accepted, and nothing else.
 *
 * Takes the values back rather than re-deriving them, so what gets written is
 * exactly what was on screen when they pressed the button — a plan edited in
 * another window between the proposal and the click cannot change the outcome
 * underneath them.
 */
export function applyToMarketing(
  db: Database,
  request: ApplyRequest
): { audience: boolean; channelsCreated: number } {
  let audienceSet = false

  if (request.audience !== undefined && request.audience.trim() !== '') {
    updatePlan(db, { audience: request.audience.trim() })
    audienceSet = true
  }

  let created = 0
  if (request.channels && request.channels.length > 0) {
    const existing = new Set(
      listChannels(db, true).map((channel) => channel.name.trim().toLowerCase())
    )

    for (const name of request.channels) {
      const clean = name.trim()
      if (clean === '' || existing.has(clean.toLowerCase())) continue

      // No cadence. The commitment is the one decision worth making
      // deliberately, and a business plan mentioning LinkedIn is not somebody
      // promising to post on it twice a week.
      createChannelRow(db, clean)
      existing.add(clean.toLowerCase())
      created += 1
    }
  }

  return { audience: audienceSet, channelsCreated: created }
}

/**
 * Insert a channel without going through the service's input type.
 *
 * Kept here rather than importing `createChannel` because that takes a full
 * input object and this only ever has a name — and because a channel created
 * from a plan must never carry a cadence, which a shared default could
 * quietly introduce later.
 */
function createChannelRow(db: Database, name: string): void {
  const last =
    db.get<Row & { last: number | null }>('SELECT MAX(sort_order) AS last FROM marketing_channels')
      ?.last ?? 0

  db.run(
    `INSERT INTO marketing_channels
       (name, type, handle_or_url, colour, is_active, cadence_count, cadence_period,
        character_limit, sort_order, created_at, updated_at)
     VALUES (?, 'social', '', '#6E56CF', 1, 0, 'week', NULL, ?, datetime('now'), datetime('now'))`,
    [name, last + 1]
  )
}

/** The marketing plan as it stands, for the UI to show what would change. */
export function currentMarketingAudience(db: Database): string {
  return getPlan(db).audience
}
