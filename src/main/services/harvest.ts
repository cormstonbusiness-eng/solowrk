import type { Database, Row } from '../db'
import type { ContentItemWithContext, LibraryAssetWithContext } from '@shared/types'
import { caseStudyFromProject, createLibraryAsset } from './library'
import { createContent } from './content'

/**
 * Turning a finished job into marketing, at the only moment the details are
 * fresh (§9.2).
 *
 * §9.2 calls this the strongest tie between Marketing and the rest of the
 * app, and the reason to have marketing inside SoloWrk at all rather than in
 * a separate tool. Nothing else in the module knows that a job just finished,
 * how long it really took, or what was delivered — and nobody writes a case
 * study three months later, because by then they would have to go and look
 * all of it up.
 *
 * **It is offered, never done.** Marking a project complete is a bookkeeping
 * act; quietly creating four rows in Marketing off the back of it would be a
 * side effect nobody asked for. The completion summary asks one line, and
 * this only runs if somebody says yes.
 */

export interface HarvestResult {
  caseStudy: LibraryAssetWithContext
  ideas: ContentItemWithContext[]
}

/**
 * Content angles worth suggesting from any finished job.
 *
 * Deliberately generic and deliberately few. Three shells somebody can rename
 * beats ten guesses about a job the app has not seen the inside of, and an
 * idea column with ten auto-generated rows in it is a column people stop
 * reading.
 *
 * They are questions rather than titles, because a question is something you
 * can answer at a keyboard and a title is something you have to live up to.
 */
const ANGLES = [
  'What the client actually asked for, and what they needed',
  'The bit of this job that took longest, and why',
  'A before and after, with the drawings'
]

export function harvestProject(db: Database, projectId: number): HarvestResult {
  const draft = caseStudyFromProject(db, projectId)

  const caseStudy = createLibraryAsset(db, {
    type: 'case_study',
    title: draft.title,
    body: draft.body,
    clientId: draft.clientId,
    sourceProjectId: draft.sourceProjectId
  })

  const project = db.get<Row & { name: string }>('SELECT name FROM projects WHERE id = ?', [
    projectId
  ])

  const ideas = ANGLES.map((angle) =>
    createContent(db, {
      title: project ? `${project.name}: ${angle}` : angle,
      // No channel and no date. Ideas that arrived pre-scheduled would put
      // three things on the calendar nobody agreed to write.
      status: 'idea',
      sourceProjectId: projectId
    })
  )

  return { caseStudy, ideas }
}

/**
 * Whether there is anything worth harvesting from this project.
 *
 * Used to decide whether the completion summary asks at all. Offering to turn
 * a job into marketing when one has already been written is how a helpful
 * prompt becomes an irritating one.
 */
export function alreadyHarvested(db: Database, projectId: number): boolean {
  const found = db.get<Row & { n: number }>(
    'SELECT COUNT(*) AS n FROM library_assets WHERE source_project_id = ? AND archived = 0',
    [projectId]
  )

  return (found?.n ?? 0) > 0
}
