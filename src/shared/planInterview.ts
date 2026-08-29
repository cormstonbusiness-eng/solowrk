import { PLAN_SECTIONS } from './plan'

/**
 * The plan, asked for rather than demanded.
 *
 * A blank template with twelve empty headings is not a business plan builder.
 * It is a form, and the reason freelancers do not have business plans is that
 * somebody already handed them a form. What actually stops people is not
 * knowing what belongs under "Positioning" — so this asks plain questions
 * instead, and turns the answers into the document.
 *
 * **The questions are phrased so the answers are already prose.** That is the
 * whole trick, and it is why there is no model in this file. "Who buys this?"
 * gets an answer that can go into the plan as written; "Target market:" gets a
 * heading with a shrug under it. Composition is a join, not a rewrite, which
 * means the plan says exactly what the user said and works with no network,
 * no API key and no tier.
 *
 * Every question can be skipped. A plan with eight good sections beats one
 * with twelve, four of which are "N/A".
 */

export type QuestionKind =
  /** One line. Merges with its neighbours into a running paragraph. */
  | 'short'
  /** A paragraph of its own. */
  | 'long'
  /** One per line, composed as bullets. */
  | 'list'

/**
 * Something the app already knows and should not ask twice.
 *
 * Answered from the workspace before the interview opens, and always shown as
 * a filled-in answer the user can change — never silently baked in. Being
 * asked your own hourly rate by software you have been invoicing from for a
 * year is the moment somebody decides the feature is not worth finishing.
 *
 * **Only three, and deliberately.** The app knows the rate, the address and
 * the channel list because the user typed them into it. It does not know what
 * somebody sells, or what kind of client they want more of — a client list is
 * names, not a market — and a confident wrong prefill is worse than an empty
 * box, because a filled field gets accepted without being read.
 */
export type PrefillKey = 'location' | 'rate' | 'channels'

export interface Question {
  /** Stable. Answers are keyed by it, so renaming one loses an answer. */
  id: string
  /** The `PLAN_SECTIONS` key this belongs under. */
  section: string
  prompt: string
  /** Why it is being asked, or what a good answer looks like. */
  hint?: string
  kind: QuestionKind
  placeholder?: string
  prefill?: PrefillKey
  /**
   * A phrase that turns a short answer into a sentence.
   *
   * Only for `short`. The answer is appended to it and a full stop added if
   * the user did not write one, so "March 2021" becomes "It has been trading
   * since March 2021."
   *
   * **A lead never ends in an article.** It cannot know whether the answer
   * starts with a vowel — "a sole trader" and "an LLP" are both real answers
   * to the same question — so the article belongs to the answer, and the
   * placeholder is what shows the user that. A test holds this.
   */
  lead?: string
}

export const QUESTIONS: Question[] = [
  /* The business ---------------------------------------------------- */
  {
    id: 'what',
    section: 'business',
    prompt: 'In one sentence, what does your business do?',
    hint: 'Say it the way you would to somebody at a party, not the way you would to a bank.',
    kind: 'long',
    placeholder:
      'I draw and submit planning applications for small architecture practices in the North West.'
  },
  {
    id: 'setup',
    section: 'business',
    prompt: 'How is it set up?',
    kind: 'short',
    placeholder: 'a sole trader, registered for VAT',
    lead: 'It is set up as '
  },
  {
    id: 'since',
    section: 'business',
    prompt: 'When did you start trading?',
    kind: 'short',
    placeholder: 'March 2021',
    lead: 'It has been trading since '
  },
  {
    id: 'where',
    section: 'business',
    prompt: 'Where do you work from?',
    kind: 'short',
    placeholder: 'A home office in Chester, working on site two days a week',
    lead: 'I work from ',
    prefill: 'location'
  },

  /* Vision ----------------------------------------------------------- */
  {
    id: 'threeYears',
    section: 'vision',
    prompt: 'Where do you want this to be in three years?',
    hint: 'Be specific enough that you would know whether you got there.',
    kind: 'long',
    placeholder:
      'Two long-term retainers covering my fixed costs, so the project work is upside rather than survival.'
  },
  {
    id: 'why',
    section: 'vision',
    prompt: 'What is it for, beyond the money?',
    hint: 'This is the one that keeps you going in a bad quarter. It is allowed to be small.',
    kind: 'long',
    placeholder: 'Doing good work without a commute, and being there for the school run.'
  },

  /* Products and services -------------------------------------------- */
  {
    id: 'sell',
    section: 'services',
    prompt: 'What do you sell?',
    hint: 'One per line.',
    kind: 'list',
    placeholder: 'Planning drawings\nBuilding regulations packages\nSite surveys'
  },
  {
    id: 'charge',
    section: 'services',
    prompt: 'What do you charge?',
    kind: 'short',
    placeholder: '£65 an hour, or a fixed fee for a full planning package',
    lead: 'I charge ',
    prefill: 'rate'
  },

  /* Target market ---------------------------------------------------- */
  {
    id: 'who',
    section: 'market',
    prompt: 'Who buys this?',
    hint: 'The more specific the better. "Small businesses" is not an answer anybody can act on.',
    kind: 'long',
    placeholder:
      'Architecture practices of two to six people who take on more work than they can draw, and need overflow they can trust.'
  },
  {
    id: 'trigger',
    section: 'market',
    prompt: 'What makes somebody go looking for you?',
    hint: 'The moment the need appears. It is usually the best thing to write marketing about.',
    kind: 'long',
    placeholder: 'They have won a job with a deadline and no capacity to draw it.'
  },
  {
    id: 'howMany',
    section: 'market',
    prompt: 'Roughly how many of them are there, and where?',
    kind: 'short',
    placeholder: 'Maybe two hundred practices within an hour of Chester',
    lead: 'There are '
  },

  /* Competition ------------------------------------------------------ */
  {
    id: 'rivals',
    section: 'competition',
    prompt: 'Who else does this for the same people?',
    kind: 'long',
    placeholder:
      'Two larger drawing offices in Manchester, and the practices simply working later themselves.'
  },
  {
    id: 'why-you',
    section: 'competition',
    prompt: 'Why does somebody pick you instead?',
    hint: 'The honest reason, not the flattering one. This becomes your positioning.',
    kind: 'long',
    placeholder:
      'I turn a set round in a week and I have done enough of them to spot what a planner will object to.'
  },

  /* Marketing and sales ---------------------------------------------- */
  {
    id: 'found',
    section: 'marketing',
    prompt: 'How do people find you today?',
    hint: 'One per line. Be honest — "word of mouth" on its own is a real and common answer.',
    kind: 'list',
    placeholder: 'Word of mouth\nLinkedIn\nA directory listing',
    prefill: 'channels'
  },
  {
    id: 'enquiry',
    section: 'marketing',
    prompt: 'How does an enquiry become a paying job?',
    kind: 'long',
    placeholder: 'A call, then a fixed-fee quote within two days, then a deposit before I start.'
  },

  /* How it runs ------------------------------------------------------ */
  {
    id: 'process',
    section: 'operations',
    prompt: 'Walk through a typical job, start to finish.',
    kind: 'long',
    placeholder:
      'Brief and measured survey, first draft in a week, one round of changes, then submission and dealing with the planner.'
  },
  {
    id: 'tools',
    section: 'operations',
    prompt: 'What do you rely on to do the work?',
    hint: 'Software, kit, suppliers — the things that would stop you if they went.',
    kind: 'short',
    placeholder: 'AutoCAD, a decent laser measure, and the local printer for large format',
    lead: 'I rely on '
  },

  /* People ----------------------------------------------------------- */
  {
    id: 'people',
    section: 'team',
    prompt: 'Who else is involved?',
    hint: 'Just you is a complete answer.',
    kind: 'long',
    placeholder: 'Just me, with an accountant for the year end.'
  },
  {
    id: 'buyIn',
    section: 'team',
    prompt: 'What do you buy in rather than do yourself?',
    kind: 'short',
    placeholder: 'Structural calculations, and anything involving a heritage statement',
    lead: 'I buy in '
  },

  /* Financials ------------------------------------------------------- */
  {
    id: 'target',
    section: 'financials',
    prompt: 'What does this need to earn in a year?',
    hint: 'What has to land in your account, before tax. SoloWrk works the rest out from it.',
    kind: 'short',
    placeholder: '£48,000',
    lead: 'The business needs to turn over '
  },
  {
    id: 'costs',
    section: 'financials',
    prompt: 'What are your fixed costs a year?',
    hint: 'Software, insurance, accountant, phone — the things you pay whether work comes in or not.',
    kind: 'short',
    placeholder: '£4,000',
    lead: 'Fixed costs run to about '
  },

  /* Risks ------------------------------------------------------------ */
  {
    id: 'risk',
    section: 'risks',
    prompt: 'What is the one thing that would hurt most if it happened?',
    hint: 'Most freelance plans say "losing a client". If that is the true answer, say so.',
    kind: 'long',
    placeholder: 'Losing the Harding retainer, which is most of a normal month.'
  },
  {
    id: 'mitigation',
    section: 'risks',
    prompt: 'What would you do about it?',
    kind: 'long',
    placeholder:
      'Keep two smaller practices warm so there is somewhere to go, and hold three months of costs back.'
  },

  /* Milestones -------------------------------------------------------- */
  {
    id: 'next',
    section: 'milestones',
    prompt: 'What are the next few things that have to happen?',
    hint: 'One per line, with a rough date. Three is plenty.',
    kind: 'list',
    placeholder:
      'Replace the Harding retainer — by March\nGet professional indemnity sorted — this month\nPut prices up 10% — April'
  }
]

/** The questions for one section, in the order they are asked. */
export function questionsFor(section: string): Question[] {
  return QUESTIONS.filter((question) => question.section === section)
}

/**
 * The sections the interview covers, in plan order.
 *
 * `summary` is deliberately absent. An executive summary is written last and
 * from the rest, so asking for one first is asking somebody to summarise a
 * document that does not exist yet.
 */
export const INTERVIEW_SECTIONS = PLAN_SECTIONS.filter(
  (spec) => questionsFor(spec.key).length > 0
)

export type Answers = Record<string, string>

/* ------------------------------------------------------------------ *
 * Composition
 * ------------------------------------------------------------------ */

/** Whether an answer says anything. Whitespace is not an answer. */
function given(answers: Answers, id: string): boolean {
  return (answers[id] ?? '').trim() !== ''
}

/**
 * Finish a sentence that a lead started.
 *
 * The user is answering a question, not writing prose, so "sole trader" comes
 * back without a full stop and "I'm a sole trader." comes back with one. Both
 * have to end up as one clean sentence.
 */
function sentence(lead: string, answer: string): string {
  const trimmed = answer.trim()
  const joined = `${lead}${trimmed}`
  return /[.!?]$/.test(joined) ? joined : `${joined}.`
}

/** One section's markdown body, or empty when nothing was answered. */
export function composeSection(section: string, answers: Answers): string {
  const blocks: string[] = []
  /** Consecutive short answers gather here and land as one paragraph. */
  let running: string[] = []

  const flush = (): void => {
    if (running.length > 0) {
      blocks.push(running.join(' '))
      running = []
    }
  }

  for (const question of questionsFor(section)) {
    if (!given(answers, question.id)) continue
    const answer = answers[question.id]!.trim()

    if (question.kind === 'short') {
      running.push(question.lead ? sentence(question.lead, answer) : sentence('', answer))
      continue
    }

    flush()

    if (question.kind === 'list') {
      const items = answer
        .split('\n')
        .map((line) => line.replace(/^[-*•]\s*/, '').trim())
        .filter((line) => line !== '')
      if (items.length > 0) blocks.push(items.map((item) => `- ${item}`).join('\n'))
      continue
    }

    blocks.push(answer)
  }

  flush()
  return blocks.join('\n\n')
}

/**
 * The executive summary, assembled from the answers that carry the most.
 *
 * Not a précis of the finished document — that would need a model, and this
 * has to work without one. It is the four facts a reader of a freelance plan
 * wants in the first ten seconds: what it is, who for, why them, where it is
 * going.
 */
export function composeSummary(answers: Answers): string {
  return [answers.what, answers.who, answers['why-you'], answers.threeYears]
    .map((part) => (part ?? '').trim())
    .filter((part) => part !== '')
    .join(' ')
}

/** How much of the interview has been answered. */
export function progress(answers: Answers): { answered: number; total: number } {
  return {
    answered: QUESTIONS.filter((question) => given(answers, question.id)).length,
    total: QUESTIONS.length
  }
}

/** Which sections would end up with something in them. */
export function sectionsAnswered(answers: Answers): string[] {
  return INTERVIEW_SECTIONS.map((spec) => spec.key).filter(
    (key) => composeSection(key, answers) !== ''
  )
}

/**
 * The whole document.
 *
 * A section nobody answered is left out entirely rather than written as an
 * empty heading. An outline of blank headings is exactly the artefact this
 * feature exists to avoid producing, and it is worse coming from the app than
 * from a template, because the app implied it had helped.
 */
export function composePlan(title: string, answers: Answers): string {
  const parts: string[] = [`# ${title}`]

  const summary = composeSummary(answers)
  if (summary !== '') parts.push('## Executive summary', summary)

  for (const spec of INTERVIEW_SECTIONS) {
    const body = composeSection(spec.key, answers)
    if (body !== '') parts.push(`## ${spec.title}`, body)
  }

  return `${parts.join('\n\n')}\n`
}
