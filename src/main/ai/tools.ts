import { readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { session } from '../services/session'
import { resolveInWorkspace } from '../services/workspace'
import { listDirectory, recentFiles } from '../services/files'
import { listProjects } from '../services/projects'
import { listClients } from '../services/clients'
import { createTask, listTasks, updateTask } from '../services/tasks'
import { listCategories } from '../services/categories'
import { createEntry, listEntries } from '../services/time'
import { createInvoice, listInvoices } from '../services/invoices'
import { listExpenses } from '../services/expenses'
import { summary } from '../services/finance'
import { createEvent, listEvents } from '../services/events'
import { createNote, listNotes, writeNote } from '../services/notes'
import { listDocuments } from '../services/documents'
import {
  createCampaign,
  createPost,
  listCampaigns,
  listPillars,
  listPosts,
  marketingSummary,
  updatePost
} from '../services/marketing'
import { listAccounts } from '../social/accounts'
import { rangeFor, today as todayString, type Period } from '@shared/taxYear'
import { nowStamp } from '@shared/calendar'

/**
 * The tools the assistant can use inside SoloWrk.
 *
 * Two rules hold this together:
 *
 * 1. **Every path goes through `resolveInWorkspace`.** These tools are driven
 *    by a model reading text it did not write, so the containment boundary is
 *    not a nicety — it is the reason a prompt-injected instruction to read
 *    `C:\Users\...\.ssh\id_rsa` fails here rather than succeeding quietly.
 *
 * 2. **Mutating tools are named so the permission gate can find them.** The
 *    gate in `session.ts` decides what needs confirming from `MUTATING`, not
 *    from anything the model says about its own intent.
 */

/** Tools that change something. Everything here is confirmed before it runs. */
export const MUTATING = new Set([
  'write_file',
  'create_task',
  'update_task',
  'log_time',
  'create_invoice_draft',
  'create_event',
  'write_note',
  'create_campaign',
  'create_post',
  'update_post',
  'create_content_plan'
])

const ok = (text: string): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text }]
})

const asJson = (value: unknown): { content: { type: 'text'; text: string }[] } =>
  ok(JSON.stringify(value, null, 2))

/**
 * A short, plain sentence describing what a call will do, shown on the
 * confirmation card. Written here rather than in the UI because this module is
 * the one that knows what each tool actually does.
 */
export function describeCall(toolName: string, input: Record<string, unknown>): string {
  const name = (key: string): string => String(input[key] ?? '')

  switch (toolName) {
    case 'write_file':
      return `Write to ${name('path')}`
    case 'create_task':
      return `Create the task “${name('title')}”`
    case 'update_task':
      return `Update task #${name('id')}`
    case 'log_time':
      return `Log ${name('minutes')} minutes of time`
    case 'create_invoice_draft':
      return `Create a draft invoice`
    case 'create_event':
      return `Add “${name('title')}” to your calendar`
    case 'write_note':
      return `Write to the note “${name('title')}”`
    case 'create_campaign':
      return `Create the campaign “${name('name')}”`
    case 'create_post':
      return `Create the post “${name('title')}”${
        input.scheduledAt ? ` for ${String(input.scheduledAt).replace('T', ' at ')}` : ''
      }`
    case 'update_post':
      return `Update post #${name('id')}`
    case 'create_content_plan': {
      // The one bulk tool: the count and the range are the whole decision, so
      // they go in the sentence rather than being buried in the JSON below it.
      const posts = Array.isArray(input.posts) ? input.posts.length : 0
      return `Create ${posts} draft post${posts === 1 ? '' : 's'}`
    }
    default:
      return `Run ${toolName}`
  }
}

const db = (): ReturnType<typeof session.requireDb> => session.requireDb()
const root = (): string => session.requirePath()

export const soloTools = createSdkMcpServer({
  name: 'solowrk',
  version: '1.0.0',
  instructions:
    'Tools for the user’s own SoloWrk workspace: their projects, clients, tasks, time, ' +
    'invoices, expenses, calendar, notes and files. Prefer these over shell commands — ' +
    'they are the only way to reach the workspace database, and file paths are relative ' +
    'to the workspace root.',
  tools: [
    /* ---------------- Files ---------------- */

    tool(
      'list_workspace',
      'List the contents of a folder in the workspace. Use an empty path for the root.',
      { path: z.string().default('').describe('Folder path relative to the workspace root') },
      async (args) => asJson(await listDirectory(root(), args.path))
    ),

    tool(
      'read_file',
      'Read a text file from the workspace.',
      { path: z.string().describe('File path relative to the workspace root') },
      async (args) => {
        const absolute = resolveInWorkspace(root(), args.path)
        const contents = await readFile(absolute, 'utf8')
        // A model asked to summarise a huge file will otherwise blow the
        // context window on one call and lose the conversation.
        const limit = 200_000
        return ok(
          contents.length > limit
            ? `${contents.slice(0, limit)}\n\n[truncated at ${limit} characters]`
            : contents
        )
      }
    ),

    tool(
      'write_file',
      'Create or overwrite a text file in the workspace. Requires the user to confirm.',
      {
        path: z.string().describe('File path relative to the workspace root'),
        content: z.string()
      },
      async (args) => {
        const absolute = resolveInWorkspace(root(), args.path)
        await mkdir(dirname(absolute), { recursive: true })
        await writeFile(absolute, args.content, 'utf8')
        return ok(`Wrote ${args.path}`)
      }
    ),

    tool(
      'recent_files',
      'The most recently modified files across the workspace.',
      { limit: z.number().int().min(1).max(50).default(10) },
      async (args) => asJson(await recentFiles(root(), args.limit))
    ),

    /* ---------------- Records ---------------- */

    tool(
      'list_projects',
      'List projects, with their client, status, rate, budget and dates.',
      { includeArchived: z.boolean().default(false) },
      async (args) => asJson(listProjects(db(), { includeArchived: args.includeArchived }))
    ),

    tool('list_clients', 'List clients with their contact details and rates.', {}, async () =>
      asJson(listClients(db()))
    ),

    tool(
      'list_tasks',
      'List tasks. Filter by project, status, or a due-date window.',
      {
        projectId: z.number().int().optional(),
        status: z.enum(['todo', 'doing', 'done']).optional(),
        dueBefore: z.string().optional().describe('yyyy-mm-dd'),
        search: z.string().optional()
      },
      async (args) => asJson(listTasks(db(), args))
    ),

    tool(
      'create_task',
      'Create a task. Requires the user to confirm.',
      {
        title: z.string(),
        projectId: z.number().int().nullable().default(null),
        categoryId: z.number().int().nullable().default(null),
        notes: z.string().default(''),
        priority: z.number().int().min(0).max(3).default(1),
        dueAt: z.string().nullable().default(null).describe('yyyy-mm-dd')
      },
      async (args) => asJson(createTask(db(), args))
    ),

    tool(
      'update_task',
      'Update a task — status, due date, priority, project or title. Requires the user to confirm.',
      {
        id: z.number().int(),
        title: z.string().optional(),
        status: z.enum(['todo', 'doing', 'done']).optional(),
        priority: z.number().int().min(0).max(3).optional(),
        dueAt: z.string().nullable().optional(),
        projectId: z.number().int().nullable().optional()
      },
      async ({ id, ...patch }) => asJson(updateTask(db(), id, patch))
    ),

    tool('list_categories', 'List task categories and their colours.', {}, async () =>
      asJson(listCategories(db()))
    ),

    /* ---------------- Time and money ---------------- */

    tool(
      'list_time',
      'List tracked time entries in a date range.',
      {
        from: z.string().optional().describe('yyyy-mm-dd'),
        to: z.string().optional().describe('yyyy-mm-dd'),
        projectId: z.number().int().optional(),
        unbilledOnly: z.boolean().default(false)
      },
      async (args) => asJson(listEntries(db(), args))
    ),

    tool(
      'log_time',
      'Log a block of time against a project. Requires the user to confirm.',
      {
        projectId: z.number().int().nullable().default(null),
        date: z.string().describe('yyyy-mm-dd'),
        minutes: z.number().int().min(1),
        notes: z.string().default('')
      },
      async (args) =>
        asJson(
          createEntry(db(), {
            projectId: args.projectId,
            // Midday is a neutral placeholder: for a logged block the day is
            // what matters, not the hour it supposedly began.
            startedAt: new Date(`${args.date}T12:00:00`).toISOString(),
            duration: args.minutes * 60,
            notes: args.notes
          })
        )
    ),

    tool(
      'list_invoices',
      'List invoices with their status, dates and totals in pence.',
      {
        status: z.enum(['draft', 'sent', 'paid', 'cancelled']).optional(),
        clientId: z.number().int().optional()
      },
      async (args) => asJson(listInvoices(db(), args))
    ),

    tool(
      'create_invoice_draft',
      'Create a DRAFT invoice. It is never sent — the user reviews and sends it. ' +
        'Amounts are integer pence. Requires the user to confirm.',
      {
        clientId: z.number().int().nullable(),
        projectId: z.number().int().nullable().default(null),
        notes: z.string().default(''),
        lines: z
          .array(
            z.object({
              description: z.string(),
              quantity: z.number().default(1),
              unitPrice: z.number().int().describe('Integer pence, so £250.00 is 25000')
            })
          )
          .min(1)
      },
      async (args) =>
        asJson(
          createInvoice(db(), {
            clientId: args.clientId,
            projectId: args.projectId,
            notes: args.notes,
            status: 'draft',
            lines: args.lines
          })
        )
    ),

    tool(
      'list_expenses',
      'List expenses in a date range.',
      { from: z.string().optional(), to: z.string().optional() },
      async (args) => asJson(listExpenses(db(), args))
    ),

    tool(
      'get_finance_summary',
      'Income, outstanding, overdue, expenses, profit and tax set-aside for a period. ' +
        'All amounts are integer pence.',
      {
        period: z.enum(['day', 'week', 'month', 'quarter', 'year']).default('month'),
        reference: z.string().optional().describe('yyyy-mm-dd inside the period')
      },
      async (args) => asJson(summary(db(), rangeFor(args.period as Period, args.reference)))
    ),

    /* ---------------- Calendar and notes ---------------- */

    tool(
      'list_events',
      'List calendar events overlapping a date range.',
      { from: z.string().describe('yyyy-mm-dd'), to: z.string().describe('yyyy-mm-dd') },
      async (args) => asJson(listEvents(db(), args))
    ),

    tool(
      'create_event',
      'Add an event to the calendar. Times are local wall-clock, yyyy-mm-ddThh:mm, ' +
        'with no timezone. Requires the user to confirm.',
      {
        title: z.string(),
        startsAt: z.string().describe('yyyy-mm-ddThh:mm'),
        endsAt: z.string().describe('yyyy-mm-ddThh:mm'),
        projectId: z.number().int().nullable().default(null),
        location: z.string().default(''),
        description: z.string().default(''),
        reminderMinutes: z.number().int().nullable().default(15)
      },
      async (args) => asJson(createEvent(db(), args))
    ),

    tool(
      'list_notes',
      'List the markdown notes attached to a project.',
      { projectId: z.number().int() },
      async (args) => asJson(listNotes(db(), args.projectId))
    ),

    tool(
      'write_note',
      'Create or replace a project note. Requires the user to confirm.',
      { projectId: z.number().int(), title: z.string(), content: z.string() },
      async (args) => {
        const existing = listNotes(db(), args.projectId).find((note) => note.title === args.title)
        const note = existing ?? (await createNote(db(), root(), args.projectId, args.title))
        await writeNote(db(), root(), note.id, args.content)
        return ok(`Wrote note “${args.title}” (${note.file})`)
      }
    ),

    tool(
      'list_documents',
      'List filed business documents — contracts, insurance, certificates.',
      { search: z.string().optional(), category: z.string().optional() },
      async (args) => asJson(listDocuments(db(), args))
    ),

    /* ---------------- Marketing ---------------- */

    tool(
      'list_campaigns',
      'Marketing campaigns, with how many posts each holds.',
      { includeArchived: z.boolean().default(false) },
      async (args) => asJson(listCampaigns(db(), args.includeArchived))
    ),

    tool(
      'create_campaign',
      'Create a marketing campaign to group posts under. Requires the user to confirm.',
      {
        name: z.string(),
        goal: z.string().default(''),
        description: z.string().default(''),
        startsOn: z.string().nullable().default(null).describe('yyyy-mm-dd'),
        endsOn: z.string().nullable().default(null).describe('yyyy-mm-dd')
      },
      async (args) => asJson(createCampaign(db(), args))
    ),

    tool(
      'list_content_pillars',
      'The themes the user wants their content split across, with the share of ' +
        'output each is meant to take, in basis points (4000 = 40%).',
      {},
      async () => asJson(listPillars(db()))
    ),

    tool(
      'list_posts',
      'Social posts. Use `backlog` for undated ideas, or a date range for what is planned.',
      {
        from: z.string().optional().describe('yyyy-mm-dd'),
        to: z.string().optional().describe('yyyy-mm-dd'),
        backlog: z.boolean().default(false),
        status: z
          .enum(['idea', 'draft', 'scheduled', 'published', 'failed', 'needs_attention'])
          .optional(),
        campaignId: z.number().int().optional(),
        search: z.string().optional()
      },
      async (args) => asJson(listPosts(db(), args))
    ),

    tool(
      'get_marketing_summary',
      'How the plan looks over a range: what is scheduled and published, what needs ' +
        'attention, which days have nothing on them, and how the pillar mix compares ' +
        'with the targets. Read this before proposing a plan.',
      { from: z.string().describe('yyyy-mm-dd'), to: z.string().describe('yyyy-mm-dd') },
      async (args) => asJson(marketingSummary(db(), args))
    ),

    tool(
      'create_post',
      'Create one social post. Times are local wall-clock, yyyy-mm-ddThh:mm. Leave ' +
        'scheduledAt null to put it in the idea backlog. Requires the user to confirm.',
      {
        title: z.string().describe('Internal name — never posted'),
        body: z.string(),
        platforms: z
          .array(z.enum(['linkedin', 'facebook', 'instagram', 'tiktok', 'pinterest']))
          .default([]),
        scheduledAt: z.string().nullable().default(null).describe('yyyy-mm-ddThh:mm'),
        campaignId: z.number().int().nullable().default(null),
        pillarId: z.number().int().nullable().default(null),
        linkUrl: z.string().default(''),
        notes: z.string().default('')
      },
      async (args) =>
        asJson(
          await createPost(
            db(),
            root(),
            {
              title: args.title,
              body: args.body,
              linkUrl: args.linkUrl,
              notes: args.notes,
              campaignId: args.campaignId,
              pillarId: args.pillarId,
              scheduledAt: args.scheduledAt,
              targets: args.platforms.map((platform) => ({ platform }))
            },
            todayString()
          )
        )
    ),

    tool(
      'update_post',
      'Change a post — its text, date, campaign or pillar. Requires the user to confirm.',
      {
        id: z.number().int(),
        title: z.string().optional(),
        body: z.string().optional(),
        scheduledAt: z.string().nullable().optional(),
        campaignId: z.number().int().nullable().optional(),
        pillarId: z.number().int().nullable().optional(),
        notes: z.string().optional()
      },
      async ({ id, ...patch }) => asJson(await updatePost(db(), root(), id, patch, todayString()))
    ),

    tool(
      'create_content_plan',
      'Create several posts at once — a week, a month or a quarter of content. ' +
        'Everything arrives as a draft for the user to edit; nothing is sent. This ' +
        'ADDS to the calendar and never replaces what is already scheduled, so read ' +
        'get_marketing_summary first and fill the gaps rather than double-booking days. ' +
        'Requires the user to confirm, once, for the whole batch.',
      {
        posts: z
          .array(
            z.object({
              title: z.string(),
              body: z.string(),
              scheduledAt: z.string().describe('yyyy-mm-ddThh:mm'),
              pillarId: z.number().int().nullable().default(null),
              platforms: z
                .array(z.enum(['linkedin', 'facebook', 'instagram', 'tiktok', 'pinterest']))
                .default([])
            })
          )
          .min(1)
          .max(60),
        campaignId: z.number().int().nullable().default(null)
      },
      async (args) => {
        const created = []
        for (const item of args.posts) {
          created.push(
            await createPost(
              db(),
              root(),
              {
                title: item.title,
                body: item.body,
                scheduledAt: item.scheduledAt,
                pillarId: item.pillarId,
                campaignId: args.campaignId,
                // Drafts, not scheduled: a month of content the user has not
                // read yet must not be queued to send itself.
                status: 'draft',
                targets: item.platforms.map((platform) => ({ platform }))
              },
              todayString()
            )
          )
        }
        return ok(
          `Created ${created.length} draft posts, from ${args.posts[0]!.scheduledAt.slice(0, 10)} ` +
            `to ${args.posts.at(-1)!.scheduledAt.slice(0, 10)}. They are drafts — review them in ` +
            `Marketing and schedule the ones you want.`
        )
      }
    ),

    tool(
      'list_social_accounts',
      'Which social accounts are connected. A platform with no connected account ' +
        'can still be planned for — the user posts it by hand.',
      {},
      async () => asJson(listAccounts(db()))
    ),

    tool(
      'current_time',
      'The current local date and time, as the app understands it. Use this rather ' +
        'than guessing today’s date.',
      {},
      async () => ok(nowStamp())
    )
  ]
})