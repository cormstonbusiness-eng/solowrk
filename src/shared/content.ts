/**
 * What a piece of content actually is, once you go to post it.
 *
 * The hook is stored in a field of its own because §6.2 wants it thought about
 * separately — the first line decides whether anything else gets read, and a
 * box of its own is what makes somebody write it deliberately rather than type
 * past it. But nobody *posts* a hook and a body as two things.
 *
 * So this is the one definition of the finished post, and both the character
 * count and the copy button work from it. If they each did their own joining,
 * the count would eventually be a character or two off the thing being pasted,
 * which is the sort of wrong that only shows up at the limit.
 */
export function composePost(item: { hook: string; body: string }): string {
  return [item.hook.trim(), item.body.trim()].filter((part) => part !== '').join('\n\n')
}

/**
 * Whether the finished post fits the channel it is going to.
 *
 * `null` means the channel set no limit, which is most of them — limits are
 * per-channel rather than a maintained table of platform maximums, because
 * that table would be wrong within a month of a platform changing one.
 */
export function overLimit(post: string, limit: number | null): boolean {
  return limit !== null && post.length > limit
}
