/**
 * The weekly business review.
 *
 * Monday morning, a short written page: what moved, what is at risk, what to
 * chase, where the money is, and three things to do this week. §15.3 calls it
 * the feature that makes people forget to cancel, and it is right about why —
 * a weekly artefact that is genuinely useful creates a habit no feature list
 * can.
 *
 * **Deliberately not written by the assistant.** The specification puts this
 * in the AI module, and the divergence is on purpose: this page is the one
 * people will trust without checking, so a hallucinated figure in it is worse
 * than no review at all. Every number here is computed from the database and
 * every sentence is assembled from those numbers, which also means it works
 * for somebody with no Claude account and can be tested. The assistant is
 * better used to talk *about* the review than to write it.
 *
 * Prose rather than a dashboard, because a dashboard is a thing you look at
 * and a paragraph is a thing you read. The point is to be read on a Monday.
 */

export interface ReviewFacts {
  /** The week being reviewed — Monday to Sunday, inclusive. */
  from: string
  to: string
  /** The Monday this is written on. */
  writtenOn: string

  hoursThisWeek: number
  hoursLastWeek: number
  /** Invoices actually paid in the week, in pence. */
  paidThisWeek: number
  /** Invoices raised in the week, in pence. */
  raisedThisWeek: number

  tasksCompleted: number
  /** Projects with any activity in the week. */
  projectsMoved: string[]

  overdue: { number: string; client: string; amount: number; daysLate: number }[]
  /** Deadlines inside the next fortnight with open work still on them. */
  slipping: { project: string; dueOn: string; daysLeft: number; openTasks: number }[]
  /** Projects whose tracked value has passed their budget. */
  overBudget: { project: string; budget: number; spent: number }[]

  /** This month, by what has actually been billed. */
  bestClient: { name: string; amount: number } | null
  worstClient: { name: string; amount: number; hours: number } | null

  unbilledValue: number
  unbilledHours: number
  /** Hours planned into the coming week's calendar. */
  plannedNextWeek: number
  capacityHours: number
}

export interface Review {
  title: string
  /** Markdown, ready to be a note. */
  body: string
  /** The three suggestions, kept separately so the dashboard can show them. */
  focus: string[]
  /** Whether anything at all happened. A quiet week is said, not padded. */
  quiet: boolean
}

/* ------------------------------------------------------------------ *
 * Saying numbers like a person
 * ------------------------------------------------------------------ */

export function pounds(pence: number): string {
  const value = Math.round(pence / 100)
  return `£${value.toLocaleString('en-GB')}`
}

function hours(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return `${rounded} hour${rounded === 1 ? '' : 's'}`
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** `and` rather than a trailing comma, because this is prose. */
function list(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]!
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

function change(now: number, before: number): string {
  if (before === 0) return now > 0 ? 'up from nothing' : ''
  const difference = now - before
  if (Math.abs(difference) < 0.5) return 'about the same as the week before'
  const percent = Math.round((Math.abs(difference) / before) * 100)
  return `${difference > 0 ? 'up' : 'down'} ${percent}% on the week before`
}

/* ------------------------------------------------------------------ *
 * The review
 * ------------------------------------------------------------------ */

export function buildReview(facts: ReviewFacts): Review {
  const sections: string[] = []

  /* --- what moved ------------------------------------------------- */

  const moved: string[] = []
  if (facts.hoursThisWeek > 0) {
    const trend = change(facts.hoursThisWeek, facts.hoursLastWeek)
    moved.push(`You tracked ${hours(facts.hoursThisWeek)}${trend ? `, ${trend}` : ''}.`)
  } else {
    moved.push('No time was tracked at all last week.')
  }

  if (facts.paidThisWeek > 0) {
    moved.push(`${pounds(facts.paidThisWeek)} landed in the bank.`)
  }
  if (facts.raisedThisWeek > 0) {
    moved.push(`You raised ${pounds(facts.raisedThisWeek)} in new invoices.`)
  }
  if (facts.tasksCompleted > 0) {
    moved.push(`${count(facts.tasksCompleted, 'task')} finished.`)
  }
  if (facts.projectsMoved.length > 0) {
    moved.push(`Work went into ${list(facts.projectsMoved)}.`)
  }

  sections.push(`## What moved\n\n${moved.join(' ')}`)

  /* --- what is at risk --------------------------------------------- */

  const risks: string[] = []

  for (const invoice of facts.overdue) {
    risks.push(
      `- **${invoice.number}** to ${invoice.client} — ${pounds(invoice.amount)}, ${invoice.daysLate} days late.`
    )
  }
  for (const deadline of facts.slipping) {
    risks.push(
      `- **${deadline.project}** is due ${deadline.dueOn} — ${deadline.daysLeft <= 0 ? 'already past' : `${count(deadline.daysLeft, 'day')} away`}, with ${count(deadline.openTasks, 'task')} still open.`
    )
  }
  for (const over of facts.overBudget) {
    risks.push(
      `- **${over.project}** has run past its budget: ${pounds(over.spent)} of work against ${pounds(over.budget)}.`
    )
  }

  sections.push(
    risks.length > 0
      ? `## What's at risk\n\n${risks.join('\n')}`
      : "## What's at risk\n\nNothing overdue, nothing overrunning, no deadline in trouble. That is worth noticing."
  )

  /* --- what to chase ------------------------------------------------ */

  if (facts.overdue.length > 0) {
    const total = facts.overdue.reduce((sum, one) => sum + one.amount, 0)
    const oldest = facts.overdue.reduce((worst, one) =>
      one.daysLate > worst.daysLate ? one : worst
    )

    sections.push(
      `## What to chase\n\n` +
        `${pounds(total)} across ${count(facts.overdue.length, 'invoice')}. ` +
        `Start with ${oldest.client} — ${oldest.number} has been outstanding ${oldest.daysLate} days, ` +
        `and the longer it sits the harder the conversation gets.`
    )
  }

  /* --- where the money is ------------------------------------------- */

  const money: string[] = []
  if (facts.bestClient) {
    money.push(`${facts.bestClient.name} is your best client this month at ${pounds(facts.bestClient.amount)}.`)
  }
  if (facts.worstClient && facts.worstClient.hours > 0) {
    const rate = facts.worstClient.amount / facts.worstClient.hours
    money.push(
      `${facts.worstClient.name} is the worst: ${hours(facts.worstClient.hours)} for ${pounds(facts.worstClient.amount)}, ` +
        `an effective ${pounds(rate)} an hour.`
    )
  }
  if (facts.unbilledValue > 0) {
    money.push(
      `There is ${pounds(facts.unbilledValue)} of tracked work you have not billed for — ${hours(facts.unbilledHours)}.`
    )
  }

  if (money.length > 0) sections.push(`## Where the money is\n\n${money.join(' ')}`)

  /* --- what to focus on --------------------------------------------- */

  const focus = suggestions(facts)
  sections.push(`## This week\n\n${focus.map((one) => `- ${one}`).join('\n')}`)

  const quiet =
    facts.hoursThisWeek === 0 &&
    facts.paidThisWeek === 0 &&
    facts.raisedThisWeek === 0 &&
    facts.tasksCompleted === 0

  return {
    title: `Week in review — ${facts.from}`,
    body: `# Week in review\n\n_${facts.from} to ${facts.to}_\n\n${sections.join('\n\n')}\n`,
    focus,
    quiet
  }
}

/**
 * Three things to do, in the order they cost money.
 *
 * Always exactly three, and always concrete enough to act on before the coffee
 * goes cold. Ranked by what an unattended week actually costs: money already
 * earned but not asked for, money asked for but not arriving, then the work
 * itself. Generic advice is filtered out unless there is nothing specific — a
 * review that says "keep up the good work" is one nobody opens twice.
 */
function suggestions(facts: ReviewFacts): string[] {
  const ideas: string[] = []

  if (facts.overdue.length > 0) {
    const oldest = facts.overdue.reduce((worst, one) =>
      one.daysLate > worst.daysLate ? one : worst
    )
    ideas.push(`Chase ${oldest.client} for ${oldest.number} — ${pounds(oldest.amount)}, ${oldest.daysLate} days late.`)
  }

  if (facts.unbilledValue > 0) {
    ideas.push(
      `Invoice the ${pounds(facts.unbilledValue)} of tracked work sitting unbilled. It is already earned.`
    )
  }

  for (const deadline of facts.slipping.slice(0, 2)) {
    ideas.push(
      `${deadline.project} is due ${deadline.dueOn} with ${count(deadline.openTasks, 'task')} open. Book the time or move the date.`
    )
  }

  for (const over of facts.overBudget.slice(0, 1)) {
    ideas.push(`Raise a variation on ${over.project} before doing any more on it.`)
  }

  if (facts.plannedNextWeek === 0) {
    ideas.push('Nothing is in the calendar for this week. Put the important work in before it fills itself.')
  } else if (facts.plannedNextWeek > facts.capacityHours) {
    ideas.push(
      `This week is planned at ${hours(facts.plannedNextWeek)} against a capacity of ${hours(facts.capacityHours)}. Something will slip — decide now which.`
    )
  }

  if (facts.hoursThisWeek === 0) {
    ideas.push('No time was tracked last week. Start the timer on the next thing you do, even once.')
  }

  // Only when nothing specific presented itself, so this never crowds out a
  // real number.
  const filler = [
    'Look at the client you enjoy working with least and decide whether to raise their rate or let them go.',
    'Set aside an hour for your own marketing. It is the first thing to go and the last thing to pay off.',
    'Check your tax set-aside is where it should be for this point in the year.'
  ]

  while (ideas.length < 3) ideas.push(filler[ideas.length % filler.length]!)

  return ideas.slice(0, 3)
}
