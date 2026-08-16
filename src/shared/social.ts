/**
 * What each platform will and will not accept.
 *
 * Every rule a post has to satisfy lives here rather than in the composer, for
 * the same reason money arithmetic lives in `money.ts`: the check that greys out
 * the schedule button and the check that runs before publishing must be the
 * same check. A caption that passed validation and then failed at the API is a
 * bug in exactly one place.
 *
 * Limits are the platforms' documented ones. Where a platform *truncates* rather
 * than rejects, that is a warning, not an error — it is still a valid post, it
 * just will not read the way you intended in the feed.
 */

export type Platform = 'linkedin' | 'facebook' | 'instagram' | 'tiktok' | 'pinterest'

export type MediaKind = 'image' | 'video' | 'other'

export interface PlatformSpec {
  id: Platform
  label: string
  /** Brand colour, used only for the small platform dot — never as an accent. */
  colour: string
  /** Maximum body/caption length. */
  bodyLimit: number
  /** Pinterest is the only one with a separate title field. */
  titleLimit?: number
  /** Instagram counts hashtags and rejects past this. */
  hashtagLimit?: number
  /** How much of the body shows before the feed collapses it. */
  previewLimit?: number
  media: {
    min: number
    max: number
    kinds: MediaKind[]
  }
  /** True when the platform will hold the post and publish it itself. */
  nativeSchedule: boolean
  /** Shown in the composer so the constraints are visible, not just enforced. */
  note?: string
}

export const PLATFORMS: Record<Platform, PlatformSpec> = {
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    colour: '#0A66C2',
    bodyLimit: 3000,
    previewLimit: 210,
    media: { min: 0, max: 20, kinds: ['image', 'video'] },
    nativeSchedule: false,
    note: 'Personal profile. Company pages need LinkedIn partner approval.'
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook',
    colour: '#1877F2',
    bodyLimit: 63_206,
    previewLimit: 400,
    media: { min: 0, max: 10, kinds: ['image', 'video'] },
    nativeSchedule: true,
    note: 'Pages publish on schedule server-side, so SoloWrk need not be open.'
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    colour: '#E1306C',
    bodyLimit: 2200,
    hashtagLimit: 30,
    previewLimit: 125,
    media: { min: 1, max: 10, kinds: ['image', 'video'] },
    nativeSchedule: false,
    note: 'Needs at least one image or video. Capped at 25 posts per 24 hours.'
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    colour: '#25F4EE',
    bodyLimit: 2200,
    previewLimit: 100,
    media: { min: 1, max: 1, kinds: ['video'] },
    nativeSchedule: false,
    note: 'One video. Until your app passes TikTok’s audit, posts are visible only to you.'
  },
  pinterest: {
    id: 'pinterest',
    label: 'Pinterest',
    colour: '#E60023',
    bodyLimit: 800,
    titleLimit: 100,
    media: { min: 1, max: 1, kinds: ['image'] },
    nativeSchedule: true,
    note: 'One image, pinned to a board. Pinterest publishes on schedule itself.'
  }
}

export const PLATFORM_LIST: PlatformSpec[] = Object.values(PLATFORMS)

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'tiff'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'avi', 'webm', 'mkv'])

export function mediaKind(fileName: string): MediaKind {
  const extension = (fileName.split('.').pop() ?? '').toLowerCase()
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  return 'other'
}

/**
 * Hashtags as the platforms count them: `#` followed by letters, digits or
 * underscores, and not part of a longer word. `C#` in prose is not a hashtag,
 * and neither is the `#` in a URL fragment.
 */
export function countHashtags(text: string): number {
  return (text.match(/(^|[\s(])#[\p{L}\p{N}_]+/gu) ?? []).length
}

/** The part of a caption that shows before the feed collapses it. */
export function previewText(text: string, platform: Platform): string {
  const limit = PLATFORMS[platform].previewLimit
  if (limit === undefined || text.length <= limit) return text
  return `${text.slice(0, limit)}…`
}

export type ProblemLevel = 'error' | 'warning'

export interface Problem {
  level: ProblemLevel
  message: string
}

/** What the composer hands over for checking. */
export interface TargetDraft {
  /** The body actually going to this platform, after any per-platform override. */
  body: string
  /** Pinterest only. */
  title?: string
  /** File names are enough — the kind is inferred from the extension. */
  media: string[]
  /** Pinterest pins must name a board; it comes from the connected account. */
  boardId?: string | null
  /** Whether an account for this platform is connected at all. */
  connected?: boolean
}

/**
 * Everything wrong with a draft for one platform, worst first.
 *
 * Errors mean the platform will reject it. Warnings mean it will be accepted
 * but will not read as intended — a caption truncated mid-sentence in the feed,
 * or a link nobody can click.
 */
export function validateTarget(platform: Platform, draft: TargetDraft): Problem[] {
  const spec = PLATFORMS[platform]
  const problems: Problem[] = []

  const body = draft.body.trim()

  if (body === '' && draft.media.length === 0) {
    problems.push({ level: 'error', message: 'Nothing to post — add a caption or an image.' })
  }

  if (draft.body.length > spec.bodyLimit) {
    problems.push({
      level: 'error',
      message: `${draft.body.length - spec.bodyLimit} characters over ${spec.label}’s ${spec.bodyLimit} limit.`
    })
  }

  if (spec.titleLimit !== undefined && (draft.title ?? '').length > spec.titleLimit) {
    problems.push({
      level: 'error',
      message: `Title is over ${spec.label}’s ${spec.titleLimit} character limit.`
    })
  }

  /* Media */

  const kinds = draft.media.map(mediaKind)
  const usable = kinds.filter((kind) => spec.media.kinds.includes(kind))

  if (usable.length < spec.media.min) {
    const wanted = spec.media.kinds.join(' or ')
    problems.push({
      level: 'error',
      message:
        spec.media.min === 1 && spec.media.max === 1
          ? `${spec.label} needs exactly one ${wanted}.`
          : `${spec.label} needs at least ${spec.media.min} ${wanted}.`
    })
  }

  if (usable.length > spec.media.max) {
    problems.push({
      level: 'error',
      message: `${spec.label} takes at most ${spec.media.max} ${
        spec.media.max === 1 ? 'file' : 'files'
      }.`
    })
  }

  const unusable = kinds.filter((kind) => !spec.media.kinds.includes(kind))
  if (unusable.length > 0) {
    problems.push({
      level: 'warning',
      message: `${unusable.length} attached ${
        unusable.length === 1 ? 'file is' : 'files are'
      } not something ${spec.label} accepts, and will be skipped.`
    })
  }

  /* Platform quirks */

  if (spec.hashtagLimit !== undefined) {
    const hashtags = countHashtags(draft.body)
    if (hashtags > spec.hashtagLimit) {
      problems.push({
        level: 'error',
        message: `${hashtags} hashtags — ${spec.label} allows ${spec.hashtagLimit}.`
      })
    }
  }

  if (platform === 'instagram' && /https?:\/\//i.test(draft.body)) {
    problems.push({
      level: 'warning',
      message: 'Links in an Instagram caption are not clickable. Put it in your bio instead.'
    })
  }

  if (platform === 'pinterest' && !draft.boardId) {
    problems.push({ level: 'error', message: 'Choose a Pinterest board to pin to.' })
  }

  if (platform === 'tiktok' && draft.connected === true) {
    problems.push({
      level: 'warning',
      message: 'Until your TikTok app passes review, posts are visible only to you.'
    })
  }

  if (spec.previewLimit !== undefined && body.length > spec.previewLimit) {
    problems.push({
      level: 'warning',
      message: `${spec.label} shows the first ${spec.previewLimit} characters — make them count.`
    })
  }

  // Errors first: the thing that blocks you should not be below the advice.
  return problems.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
}

/** True when nothing would stop this going out. Warnings do not block. */
export function canPublish(platform: Platform, draft: TargetDraft): boolean {
  return !validateTarget(platform, draft).some((problem) => problem.level === 'error')
}