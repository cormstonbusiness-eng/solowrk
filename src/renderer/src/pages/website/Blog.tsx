import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import {
  CircleAlert,
  ExternalLink,
  Eye,
  Globe,
  PenLine,
  Plus,
  Send,
  Settings as SettingsIcon,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import type { BlogPost } from '@shared/blog'
import { SUGGESTED_CATEGORIES, readingMinutes, validatePost } from '@shared/blog'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Field'
import { ConfirmModal } from '@/components/ui/Modal'
import { Empty } from '@/components/ui/Empty'
import { formatDate } from '@/lib/format'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/** How long after you stop typing before the file is written. */
const SAVE_DELAY_MS = 800

/**
 * Writing and publishing blog posts.
 *
 * Posts are markdown files in the website's own repository, so this edits the
 * site directly — saving writes the file, publishing commits it. Everything
 * saves as a draft, which is in the repository but filtered out of the built
 * site, so nothing reaches the public without an explicit publish.
 */
export function Blog(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<BlogPost | null>(null)
  const [saved, setSaved] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState<BlogPost | null>(null)
  const [deleting, setDeleting] = useState<BlogPost | null>(null)
  const timer = useRef<NodeJS.Timeout | null>(null)

  const { data: status } = useQuery({
    queryKey: ['site', 'status'],
    queryFn: () => window.solo.invoke('site:status')
  })

  const connected = status?.folderExists === true && status.repoValid && status.tokenSet

  const { data: posts = [], isPending } = useQuery({
    queryKey: ['blog', 'list'],
    queryFn: () => window.solo.invoke('blog:list'),
    enabled: connected
  })

  // Open the first post rather than an empty editor.
  useEffect(() => {
    if (selected === null && posts.length > 0) setSelected(posts[0]!.slug)
  }, [posts, selected])

  const current = posts.find((post) => post.slug === selected) ?? null

  useEffect(() => {
    if (current && current.slug !== draft?.slug) {
      setDraft(current)
      setSaved(true)
    }
  }, [current, draft?.slug])

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['blog'] })
  }

  const save = useMutation({
    mutationFn: (post: BlogPost) =>
      window.solo.invoke('blog:save', { slug: post.slug, patch: post }),
    onSuccess: (post) => {
      setSaved(true)
      setError(null)
      // The slug can change while unpublished, and the file moves with it.
      setSelected(post.slug)
      setDraft((currentDraft) =>
        currentDraft ? { ...currentDraft, slug: post.slug, modifiedAt: post.modifiedAt } : post
      )
      refresh()
    },
    onError: (cause: unknown) => {
      setSaved(true)
      setError(cause instanceof Error ? cause.message : 'Could not save that.')
    }
  })

  function edit(patch: Partial<BlogPost>): void {
    setDraft((currentDraft) => {
      if (!currentDraft) return currentDraft
      const next = { ...currentDraft, ...patch }

      setSaved(false)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => save.mutate(next), SAVE_DELAY_MS)

      return next
    })
  }

  // A post left mid-edit when the page unmounts must still reach disk.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const create = useMutation({
    mutationFn: (title: string) => window.solo.invoke('blog:create', { title }),
    onSuccess: (post) => {
      refresh()
      setSelected(post.slug)
      setDraft(post)
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not create that post.')
  })

  const publish = useMutation({
    mutationFn: ({ slug, unpublish }: { slug: string; unpublish?: boolean }) =>
      window.solo.invoke('blog:publish', { slug, unpublish }),
    onSuccess: () => {
      setError(null)
      setPublishing(null)
      refresh()
      void queryClient.invalidateQueries({ queryKey: ['site'] })
    },
    onError: (cause: unknown) => {
      setPublishing(null)
      setError(cause instanceof Error ? cause.message : 'Could not publish.')
    }
  })

  const remove = useMutation({
    mutationFn: (slug: string) => window.solo.invoke('blog:delete', { slug }),
    onSuccess: () => {
      setDeleting(null)
      setSelected(null)
      setDraft(null)
      refresh()
    },
    onError: (cause: unknown) => {
      setDeleting(null)
      setError(cause instanceof Error ? cause.message : 'Could not delete that post.')
    }
  })

  const problems = useMemo(() => (draft ? validatePost(draft) : []), [draft])
  const blocking = problems.filter((problem) => problem.level === 'error')

  const newPost = (): void => create.mutate('Untitled post')

  return (
    <Page
      title="Blog"
      description="Posts are markdown files in your website's repository. Publishing commits one and the site rebuilds."
      className="flex min-h-0 flex-col overflow-y-hidden"
      actions={
        connected ? (
          <Button variant="primary" onClick={newPost} disabled={create.isPending}>
            <Plus size={14} strokeWidth={1.75} />
            New post
          </Button>
        ) : undefined
      }
    >
      {error && (
        <div className="mb-3 flex shrink-0 items-start gap-2.5 rounded-control border border-danger/40 bg-danger/8 px-3 py-2.5">
          <TriangleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0 text-danger" />
          <p className="flex-1 text-[12px] leading-relaxed text-ink">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-[11px] text-faint hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      {status === undefined ? null : !connected ? (
        <Empty
          icon={Globe}
          title="Connect your website first"
          body="SoloWrk writes posts straight into your site's repository, so it needs to know where that is and have a token that can commit to it."
          action={
            <Link to="/settings?tab=website">
              <Button variant="primary">
                <SettingsIcon size={14} strokeWidth={1.75} />
                Connect your site
              </Button>
            </Link>
          }
        />
      ) : posts.length === 0 && !isPending ? (
        <Empty
          icon={PenLine}
          title="No posts yet"
          body="A post starts as a draft — it is saved into your repository straight away, but filtered out of the built site until you publish it."
          action={
            <Button variant="primary" onClick={newPost}>
              <Plus size={14} strokeWidth={1.75} />
              Write your first post
            </Button>
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 gap-3">
          <aside className="flex w-[240px] shrink-0 flex-col gap-0.5 overflow-y-auto">
            {posts.map((post) => (
              <button
                key={post.slug}
                type="button"
                onClick={() => setSelected(post.slug)}
                className={cn(
                  'w-full rounded-control px-2.5 py-2 text-left transition-colors',
                  post.slug === selected ? 'bg-raised' : 'hover:bg-raised/60'
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      post.draft ? 'bg-warning' : 'bg-success'
                    )}
                    aria-hidden
                  />
                  <p
                    className={cn(
                      'truncate text-[12.5px]',
                      post.slug === selected ? 'text-ink' : 'text-muted'
                    )}
                  >
                    {post.title || 'Untitled'}
                  </p>
                </div>
                <p className="mt-0.5 truncate pl-3 text-[10.5px] text-faint">
                  {post.draft ? 'Draft' : 'Live'} · {post.date ? formatDate(post.date) : 'No date'}
                </p>
              </button>
            ))}
          </aside>

          {draft ? (
            <div className="flex min-h-0 flex-1 flex-col rounded-card border border-line">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px]',
                    draft.draft ? 'border-warning/50 text-warning' : 'border-success/50 text-success'
                  )}
                >
                  {draft.draft ? 'Draft' : 'Live'}
                </span>

                <span className="text-[10.5px] text-faint">
                  {readingMinutes(draft.body)} min read
                </span>

                <motion.span
                  animate={{ opacity: saved ? 0.5 : 1 }}
                  transition={transition.press}
                  className="text-[10.5px] text-faint"
                >
                  {saved ? 'Saved' : 'Saving…'}
                </motion.span>

                <div className="ml-auto flex items-center gap-1">
                  {!draft.draft && status.url && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void window.solo.invoke('site:open', { what: 'live' })
                      }
                    >
                      <ExternalLink size={12} strokeWidth={1.75} />
                      View
                    </Button>
                  )}

                  {draft.published && !draft.draft ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => publish.mutate({ slug: draft.slug, unpublish: true })}
                      disabled={publish.isPending}
                    >
                      <Eye size={12} strokeWidth={1.75} />
                      Unpublish
                    </Button>
                  ) : null}

                  {!draft.published && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleting(draft)}
                      className="text-faint hover:text-danger"
                    >
                      <Trash2 size={12} strokeWidth={1.75} />
                    </Button>
                  )}

                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setPublishing(draft)}
                    disabled={blocking.length > 0 || publish.isPending || !saved}
                    title={
                      blocking.length > 0 ? blocking[0]!.message : 'Commit this post to your site'
                    }
                  >
                    <Send size={12} strokeWidth={2} />
                    {draft.draft ? 'Publish' : 'Publish update'}
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <input
                  value={draft.title}
                  onChange={(event) => edit({ title: event.target.value })}
                  placeholder="Post title"
                  className="w-full bg-transparent text-[19px] font-semibold tracking-[-0.01em] text-ink placeholder:text-faint focus:outline-none"
                />

                <p className="mt-1.5 font-mono text-[11px] text-faint">
                  {status.url.replace(/\/$/, '')}/blog/
                  {draft.published ? (
                    // The slug is the live URL. Changing it after publication
                    // breaks every link to it and anything already indexed.
                    <span className="text-muted" title="Frozen — this post is already live">
                      {draft.slug}
                    </span>
                  ) : (
                    <input
                      value={draft.slug}
                      onChange={(event) => edit({ slug: event.target.value })}
                      className="w-[280px] bg-transparent text-muted focus:text-ink focus:outline-none"
                    />
                  )}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Field label="Category">
                    <TextInput
                      list="blog-categories"
                      value={draft.category}
                      onChange={(event) => edit({ category: event.target.value })}
                      placeholder="Websites"
                    />
                    <datalist id="blog-categories">
                      {SUGGESTED_CATEGORIES.map((category) => (
                        <option key={category} value={category} />
                      ))}
                    </datalist>
                  </Field>
                  <Field label="Date">
                    <TextInput
                      type="date"
                      value={draft.date}
                      onChange={(event) => edit({ date: event.target.value })}
                    />
                  </Field>
                </div>

                <Field
                  label="Excerpt"
                  hint="The description search engines and the blog index show."
                  className="mt-3"
                >
                  <textarea
                    value={draft.excerpt}
                    onChange={(event) => edit({ excerpt: event.target.value })}
                    rows={2}
                    className="w-full resize-y rounded-control border border-line bg-ground/40 px-3 py-2 text-[12.5px] leading-relaxed text-ink focus:border-accent/60 focus:outline-none"
                  />
                </Field>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Hero image" hint="A path under the site's public folder.">
                    <TextInput
                      value={draft.image}
                      onChange={(event) => edit({ image: event.target.value })}
                      placeholder="/blog/my-post.webp"
                    />
                  </Field>
                  <Field label="Image description">
                    <TextInput
                      value={draft.imageAlt}
                      onChange={(event) => edit({ imageAlt: event.target.value })}
                      placeholder="What is in the picture"
                      disabled={draft.image === ''}
                    />
                  </Field>
                </div>

                {problems.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1">
                    {problems.map((problem) => (
                      <li
                        key={`${problem.field}-${problem.message}`}
                        className={cn(
                          'flex items-start gap-1.5 text-[11.5px]',
                          problem.level === 'error' ? 'text-danger' : 'text-warning'
                        )}
                      >
                        <CircleAlert size={11} strokeWidth={2} className="mt-0.5 shrink-0" />
                        {problem.message}
                      </li>
                    ))}
                  </ul>
                )}

                <textarea
                  value={draft.body}
                  onChange={(event) => edit({ body: event.target.value })}
                  spellCheck
                  placeholder="Write the post in markdown…"
                  className="mt-4 min-h-[420px] w-full resize-y rounded-control border border-line bg-ground/40 px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-ink focus:border-accent/60 focus:outline-none"
                />
              </div>
            </div>
          ) : (
            <div className="grid flex-1 place-items-center rounded-card border border-line">
              <p className="text-[12px] text-faint">Pick a post, or start a new one.</p>
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={publishing !== null}
        onClose={() => setPublishing(null)}
        onConfirm={() => publishing && publish.mutate({ slug: publishing.slug })}
        title={publishing?.draft ? 'Publish this post?' : 'Publish the update?'}
        body={
          `This commits “${publishing?.title ?? ''}” to ${status?.repo ?? 'your repository'} and ` +
          `your site rebuilds from it. It will be live at ${status?.url ?? ''}/blog/${
            publishing?.slug ?? ''
          } in a minute or so.`
        }
        confirmLabel="Publish"
      />

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.slug)}
        title={`Delete “${deleting?.title ?? ''}”?`}
        body="This deletes the markdown file from your website's folder. It has never been published, so nothing on the live site changes."
        confirmLabel="Delete post"
      />
    </Page>
  )
}
