import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Database, Row } from '../db'
import type { BusinessPlanStatus } from '@shared/types'
import { appendSection, findSection, planTemplate, replaceSection } from '@shared/plan'
import { getSettings, updateSettings } from '../services/settings'
import { resolveInWorkspace } from '../services/workspace'
import { extractText, isSupported } from '../services/extract'

/**
 * The user's own business plan, attached as the document they already have.
 *
 * Deliberately a file they hand over rather than a form they fill in: everyone
 * running a business has some version of this written down, and asking them to
 * retype it into a textarea is asking them not to bother. Word, PDF, markdown
 * and plain text all work; the text is pulled out once and cached, because
 * re-parsing a forty-page PDF before every reply would be absurd.
 */

/** Filed with the user's own paperwork rather than hidden in `_app`. */
const PLAN_FOLDER = join('Documents', 'Business')

/**
 * A ceiling, not a budget.
 *
 * The whole plan goes to the model — a business plan is exactly the kind of
 * document you want read in full, and 40,000 characters is only about 10,000
 * tokens against a context measured in hundreds of thousands. This exists so
 * that attaching a 5MB text file by mistake degrades one conversation instead
 * of every conversation, and when it bites the user is told rather than
 * quietly given a shorter plan than the one they attached.
 */
const MAX_CHARACTERS = 400_000

/** Kept for anyone who wrote a plan in the app before attaching was possible. */
export const LEGACY_PLAN_PATH = join('Documents', 'Business Plan.md')

/**
 * The formats SoloWrk can write back to, which is a much shorter list than the
 * ones it can read.
 *
 * A PDF or a Word file can be read but not edited: rewriting one would mean
 * regenerating a document the user formatted themselves, and losing their
 * layout to gain a text edit is a bad trade. Those get offered an editable
 * markdown copy instead, which is a decision the user makes rather than one
 * taken quietly on their behalf.
 */
const EDITABLE_EXTENSIONS = ['.md', '.markdown', '.txt']

export function isEditablePlan(file: string): boolean {
  return file !== '' && EDITABLE_EXTENSIONS.includes(extname(file).toLowerCase())
}

/**
 * Has the file changed since we last read it?
 *
 * Both sides are normalised to SQLite's `yyyy-mm-dd hh:mm:ss` first. That is
 * the whole point of this function existing: `toISOString` puts a `T` where
 * SQLite puts a space, and `T` sorts above a space, so comparing the raw
 * strings called *every* file newer than *every* same-day timestamp — which
 * meant re-parsing the document on every single assistant turn, exactly when
 * the cache was supposed to be earning its keep. Both are already UTC, so only
 * the shape was ever wrong.
 */
export function isNewerThan(mtime: Date, readAt: string): boolean {
  return mtime.toISOString().slice(0, 19).replace('T', ' ') > readAt.slice(0, 19)
}

export function planStatus(db: Database, extra: { error?: string } = {}): BusinessPlanStatus {
  const row = db.get<Row & { business_plan_text: string; business_plan_read_at: string | null }>(
    'SELECT business_plan_text, business_plan_read_at FROM settings WHERE id = 1'
  )
  const { businessPlanFile } = getSettings(db)
  const text = row?.business_plan_text ?? ''

  return {
    file: businessPlanFile,
    name: businessPlanFile === '' ? '' : basename(businessPlanFile),
    editable: isEditablePlan(businessPlanFile),
    length: text.length,
    readAt: row?.business_plan_read_at ?? null,
    // The whole text, not an excerpt. It is a few tens of kilobytes over the
    // bridge, and showing a fragment under the heading "what the assistant
    // sees" was actively misleading about how much of it is read.
    preview: text,
    truncated: text.length > MAX_CHARACTERS,
    sentLength: Math.min(text.length, MAX_CHARACTERS),
    ...extra
  }
}

/**
 * Attach a document, pulling its text out immediately.
 *
 * Extraction happens here rather than lazily so that an unreadable file is
 * reported while the user is looking at the screen that caused it — finding out
 * mid-conversation that the assistant has been working from nothing would be
 * far worse.
 */
export async function attachPlan(
  db: Database,
  workspacePath: string,
  sourcePath: string
): Promise<BusinessPlanStatus> {
  if (!isSupported(sourcePath)) {
    throw new Error(
      `SoloWrk cannot read ${extname(sourcePath) || 'that file'}. ` +
        'Save it as PDF, Word (.docx), markdown or plain text.'
    )
  }

  // Read before copying: a file that cannot be parsed should not leave a copy
  // behind in the workspace.
  const text = await extractText(sourcePath)

  if (text.trim() === '') {
    throw new Error(
      'That file has no readable text in it. A PDF made from a scan or photo is ' +
        'images rather than text — export a text-based copy and try again.'
    )
  }

  const relative = join(PLAN_FOLDER, basename(sourcePath))
  await mkdir(resolveInWorkspace(workspacePath, PLAN_FOLDER), { recursive: true })
  await copyFile(sourcePath, resolveInWorkspace(workspacePath, relative))

  updateSettings(db, { businessPlanFile: relative })
  storeText(db, text)

  return planStatus(db)
}

/**
 * Save edited plan text back to the attached file.
 *
 * The file is the record — not the cached text in the database — so it is
 * written first and the cache only updated once the write succeeded. A cache
 * that said something the file did not would be worse than a failed save,
 * because the assistant would answer from it.
 */
export async function writePlan(
  db: Database,
  workspacePath: string,
  text: string
): Promise<BusinessPlanStatus> {
  const { businessPlanFile } = getSettings(db)

  if (businessPlanFile === '') throw new Error('There is no business plan to write to.')
  if (!isEditablePlan(businessPlanFile)) {
    throw new Error(
      `${basename(businessPlanFile)} is not a format SoloWrk can write to. ` +
        'Make an editable copy first.'
    )
  }

  await writeFile(resolveInWorkspace(workspacePath, businessPlanFile), text, 'utf8')
  storeText(db, text)
  return planStatus(db)
}

/**
 * Start an editable markdown plan, and attach it.
 *
 * Two ways in, and the difference matters. With nothing attached this lays out
 * the blank template. With a PDF or Word file attached it carries the extracted
 * text across, so someone who already wrote a plan gets their own words in an
 * editable file rather than a blank form and a lost afternoon.
 *
 * The original is left exactly where it is either way — this attaches a new
 * file, it does not convert or replace anything.
 */
export async function startPlan(
  db: Database,
  workspacePath: string
): Promise<BusinessPlanStatus> {
  const settings = getSettings(db)
  const existing = planStatus(db).preview.trim()
  const contents = existing === '' ? planTemplate(settings.businessName) : existing

  await mkdir(resolveInWorkspace(workspacePath, PLAN_FOLDER), { recursive: true })
  const relative = await freeName(workspacePath, 'Business Plan')

  await writeFile(resolveInWorkspace(workspacePath, relative), contents, 'utf8')
  updateSettings(db, { businessPlanFile: relative })
  storeText(db, contents)

  return planStatus(db)
}

/** A path in the plan folder that is not already taken, so nothing is clobbered. */
async function freeName(workspacePath: string, base: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const name = attempt === 0 ? `${base}.md` : `${base} ${attempt + 1}.md`
    const relative = join(PLAN_FOLDER, name)
    try {
      await stat(resolveInWorkspace(workspacePath, relative))
    } catch {
      return relative
    }
  }
}

/**
 * Replace or extend one named section — the only edit the assistant can make.
 *
 * Deliberately not a whole-document write. The plan can be tens of thousands of
 * characters the user wrote by hand, and one confident model rewriting all of
 * it would be unrecoverable. A section is the largest unit worth risking, and
 * an unknown heading is added rather than matched to the nearest thing.
 */
export async function editPlanSection(
  db: Database,
  workspacePath: string,
  options: { section: string; content: string; mode: 'replace' | 'append' }
): Promise<{ text: string; added: boolean }> {
  const { businessPlanFile } = getSettings(db)

  if (businessPlanFile === '') {
    throw new Error(
      'There is no business plan attached yet. The user starts one from the Business plan page.'
    )
  }
  if (!isEditablePlan(businessPlanFile)) {
    throw new Error(
      `The business plan is ${basename(businessPlanFile)}, which SoloWrk can read but not ` +
        'write to. The user can make an editable copy from the Business plan page.'
    )
  }

  const current = (await readPlan(db, workspacePath)) ?? ''
  const existing = findSection(current, options.section)

  let next: string
  let added = false

  if (existing === null || existing.level === 0) {
    // A heading that is not there is added rather than matched to whatever is
    // closest, so "add a Risks section" cannot overwrite Financials.
    next = appendSection(current, options.section, options.content)
    added = true
  } else {
    const body =
      options.mode === 'append'
        ? `${existing.body.trim()}\n\n${options.content}`.trim()
        : options.content

    next = replaceSection(current, options.section, body)!
  }

  await writePlan(db, workspacePath, next)
  return { text: next, added }
}

export function detachPlan(db: Database): BusinessPlanStatus {
  // The copy stays in Documents\Business. Removing a record must not delete a
  // document the user may have no other copy of.
  updateSettings(db, { businessPlanFile: '' })
  storeText(db, '')
  return planStatus(db)
}

function storeText(db: Database, text: string): void {
  db.run(
    `UPDATE settings
        SET business_plan_text = ?,
            business_plan_read_at = CASE WHEN ? = '' THEN NULL ELSE datetime('now') END,
            updated_at = datetime('now')
      WHERE id = 1`,
    [text, text]
  )
}

/**
 * The cached text, re-extracted when the file on disk has changed since.
 *
 * The file lives in the workspace where the user can open and edit it, so the
 * cache cannot be trusted blindly — but a modified-time check is cheap, and
 * cheaper than parsing every turn.
 */
export async function readPlan(db: Database, workspacePath: string): Promise<string | null> {
  const { businessPlanFile } = getSettings(db)
  const status = planStatus(db)

  if (businessPlanFile !== '') {
    try {
      const absolute = resolveInWorkspace(workspacePath, businessPlanFile)
      const info = await stat(absolute)

      if (status.readAt === null || isNewerThan(info.mtime, status.readAt)) {
        const fresh = await extractText(absolute)
        storeText(db, fresh)
        return fresh || null
      }
    } catch {
      // Moved or deleted since it was attached. The cached text is still the
      // best answer available, so fall through to it rather than failing.
    }

    const row = db.get<Row & { business_plan_text: string }>(
      'SELECT business_plan_text FROM settings WHERE id = 1'
    )
    return row?.business_plan_text || null
  }

  // Nothing attached — fall back to a plan written in the app before
  // attaching existed.
  try {
    const legacy = await readFile(resolveInWorkspace(workspacePath, LEGACY_PLAN_PATH), 'utf8')
    return legacy.trim() === '' ? null : legacy
  } catch {
    return null
  }
}

/**
 * The plan as a block for the system prompt.
 *
 * Template comment lines are stripped: an unfilled section is worse than no
 * section, because the model will earnestly work around the prompts rather than
 * ignoring them.
 */
export function planSection(contents: string): string {
  // Only HTML comments go: they are template prompts the user never filled in,
  // and the model would earnestly work around them. Blank lines stay — a real
  // plan is markdown with headings, tables and lists, and stripping the blank
  // lines between blocks turns all of that into one undifferentiated wall.
  const stripped = contents.replace(/<!--[\s\S]*?-->/g, '').trim()

  if (stripped === '') return ''

  const cleaned =
    stripped.length > MAX_CHARACTERS
      ? `${stripped.slice(0, MAX_CHARACTERS)}\n\n[The plan continues beyond this point and was cut here.]`
      : stripped

  return [
    '',
    'The user has given you their business plan. Treat it as the standing brief for',
    'who they are and what they are trying to do — tailor advice to it rather than',
    'giving generic answers, and say so when something they ask for cuts against it.',
    '',
    '<business_plan>',
    cleaned,
    '</business_plan>'
  ].join('\n')
}
