import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { resolveInWorkspace } from '../services/workspace'

/**
 * A markdown file the user writes about their business, folded into every
 * assistant conversation.
 *
 * A real file at a known path rather than a settings field: it is the kind of
 * thing you draft, reread and rewrite, which is what a text editor is for. It
 * also means the assistant's own `read_file` and `write_file` tools can reach
 * it, so "help me improve my business plan" works without a special case.
 */
export const BUSINESS_PLAN_PATH = 'Documents\\Business Plan.md'

/** Enough for a real plan, short enough not to crowd out the conversation. */
const MAX_CHARACTERS = 20_000

export const BUSINESS_PLAN_TEMPLATE = `# Business Plan

## What I do
<!-- The service, and who it is for. Be specific: "brand identity for
     independent food and drink businesses" beats "design". -->

## Who my clients are
<!-- The kind of client you want more of, and the kind you would rather not
     take on again. -->

## How I position myself
<!-- Why someone picks you over the cheaper option. -->

## Rates and how I price
<!-- Day rate, project minimums, what you will not discount. -->

## This year's goals
<!-- Revenue, the kind of work you want more of, anything you are trying to
     change about how the business runs. -->

## Where work comes from
<!-- Referrals, LinkedIn, past clients, a directory. What actually works. -->

## What I am not
<!-- The work you turn down. Useful for keeping advice on the rails. -->
`

export async function readBusinessPlan(workspacePath: string): Promise<string | null> {
  try {
    const contents = await readFile(
      resolveInWorkspace(workspacePath, BUSINESS_PLAN_PATH),
      'utf8'
    )
    return contents.trim() === '' ? null : contents
  } catch {
    // Not written yet. Absence is normal, not an error.
    return null
  }
}

export async function writeBusinessPlan(workspacePath: string, contents: string): Promise<void> {
  const absolute = resolveInWorkspace(workspacePath, BUSINESS_PLAN_PATH)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, contents, 'utf8')
}

/**
 * The plan as a block for the system prompt.
 *
 * Comment lines from the template are stripped: an unfilled section is worse
 * than no section, because the model will earnestly work around the prompts
 * rather than ignoring them.
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
    'The user has written a business plan. Treat it as the standing brief for who',
    'they are and what they are trying to do — tailor advice to it rather than',
    'giving generic answers, and say so when something they ask for cuts against it.',
    '',
    '<business_plan>',
    cleaned,
    '</business_plan>'
  ].join('\n')
}
