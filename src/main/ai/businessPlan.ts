import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Database, Row } from '../db'
import type { BusinessPlanStatus } from '@shared/types'
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

/** Enough for a real plan, short enough not to crowd out the conversation. */
const MAX_CHARACTERS = 20_000

/** Kept for anyone who wrote a plan in the app before attaching was possible. */
export const LEGACY_PLAN_PATH = join('Documents', 'Business Plan.md')

export function planStatus(db: Database, extra: { error?: string } = {}): BusinessPlanStatus {
  const row = db.get<Row & { business_plan_text: string; business_plan_read_at: string | null }>(
    'SELECT business_plan_text, business_plan_read_at FROM settings WHERE id = 1'
  )
  const { businessPlanFile } = getSettings(db)
  const text = row?.business_plan_text ?? ''

  return {
    file: businessPlanFile,
    name: businessPlanFile === '' ? '' : basename(businessPlanFile),
    length: text.length,
    readAt: row?.business_plan_read_at ?? null,
    preview: text.slice(0, 600),
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

      if (status.readAt === null || info.mtime.toISOString() > status.readAt) {
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
  const cleaned = contents
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n')
    .slice(0, MAX_CHARACTERS)

  if (cleaned.trim() === '') return ''

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
