import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Copy,
  Globe,
  Image as ImageIcon,
  Send,
  Settings as SettingsIcon,
  Trash2,
  TriangleAlert,
  Upload
} from 'lucide-react'
import type { SiteImage } from '@shared/types'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/Modal'
import { Empty } from '@/components/ui/Empty'
import { cn } from '@/lib/utils'

/**
 * Images that go on the website.
 *
 * The conversion is the interesting part: a phone photo is resized and encoded
 * to WebP **in the renderer, on a canvas**. This process is Chromium, which
 * already has a first-class WebP encoder, so the app needs no `sharp` and no
 * native module — a hard rule here, not a preference. A 4 MB JPEG becomes a
 * ~150 KB WebP before it ever touches the repository.
 */

/** Wide enough for a full-bleed hero on a high-density display, and no wider. */
const MAX_WIDTH = 2000

/** Visually lossless for photographs, and roughly a third of the bytes. */
const QUALITY = 0.82

/** Where new images land, so posts and page assets do not get mixed together. */
const FOLDER = 'blog'

async function convert(dataUrl: string): Promise<{ base64: string; bytes: number }> {
  const image = new Image()
  image.src = dataUrl
  await image.decode()

  // Only ever scaled down. Enlarging a small image makes a bigger file that
  // looks worse, which is the opposite of the point.
  const scale = Math.min(1, MAX_WIDTH / image.naturalWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.naturalWidth * scale)
  canvas.height = Math.round(image.naturalHeight * scale)

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not read that image.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', QUALITY)
  )
  if (!blob) throw new Error('Could not convert that image.')

  const buffer = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  // Chunked: spreading a multi-megabyte array into String.fromCharCode blows
  // the argument limit and throws.
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  }

  return { base64: btoa(binary), bytes: blob.size }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1000) return `${Math.round(bytes / 1000)} KB`
  return `${bytes} B`
}

export function Media(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<SiteImage | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const { data: status } = useQuery({
    queryKey: ['site', 'status'],
    queryFn: () => window.solo.invoke('site:status')
  })

  const connected = status?.folderExists === true && status.repoValid && status.tokenSet

  const { data: images = [] } = useQuery({
    queryKey: ['media', 'list'],
    queryFn: () => window.solo.invoke('media:list'),
    enabled: connected
  })

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['media'] })
  }

  const fail = (cause: unknown): void =>
    setError(cause instanceof Error ? cause.message : 'That did not work.')

  const add = useMutation({
    mutationFn: async () => {
      const paths = await window.solo.invoke('files:pick', { multiple: true })
      const added: string[] = []

      for (const path of paths) {
        const source = await window.solo.invoke('media:readSource', { path })

        // SVGs are already vectors — rasterising one would be strictly worse.
        if (source.name.toLowerCase().endsWith('.svg')) {
          const base64 = source.dataUrl.slice(source.dataUrl.indexOf(',') + 1)
          const image = await window.solo.invoke('media:add', {
            folder: FOLDER,
            name: source.name,
            base64
          })
          added.push(image.repoPath)
          continue
        }

        const { base64 } = await convert(source.dataUrl)
        const name = `${source.name.replace(/\.[^.]+$/, '')}.webp`
        const image = await window.solo.invoke('media:add', { folder: FOLDER, name, base64 })
        added.push(image.repoPath)
      }

      return added
    },
    onSuccess: (added) => {
      setError(null)
      refresh()
      // Newly added images are pre-selected: the next thing you want is almost
      // always to publish them.
      setSelected(new Set(added))
    },
    onError: fail
  })

  const publish = useMutation({
    mutationFn: (repoPaths: string[]) => window.solo.invoke('media:publish', { repoPaths }),
    onSuccess: () => {
      setError(null)
      setSelected(new Set())
      void queryClient.invalidateQueries({ queryKey: ['site'] })
    },
    onError: fail
  })

  const remove = useMutation({
    mutationFn: (repoPath: string) => window.solo.invoke('media:delete', { repoPath }),
    onSuccess: () => {
      setDeleting(null)
      refresh()
    },
    onError: (cause) => {
      setDeleting(null)
      fail(cause)
    }
  })

  const toggle = (repoPath: string): void =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(repoPath)) next.delete(repoPath)
      else next.add(repoPath)
      return next
    })

  const copyPath = (webPath: string): void => {
    void navigator.clipboard.writeText(webPath)
    setCopied(webPath)
    window.setTimeout(() => setCopied(null), 1400)
  }

  const unused = images.filter((image) => !image.used).length

  return (
    <Page
      title="Media"
      description="Images on your website. Anything added is resized and converted to WebP on the way in."
      actions={
        connected ? (
          <>
            {selected.size > 0 && (
              <Button
                variant="primary"
                onClick={() => publish.mutate([...selected])}
                disabled={publish.isPending}
              >
                <Send size={14} strokeWidth={1.75} />
                {publish.isPending ? 'Publishing…' : `Publish ${selected.size}`}
              </Button>
            )}
            <Button variant="secondary" onClick={() => add.mutate()} disabled={add.isPending}>
              <Upload size={14} strokeWidth={1.75} />
              {add.isPending ? 'Converting…' : 'Add images'}
            </Button>
          </>
        ) : undefined
      }
    >
      {error && (
        <div className="mb-3 flex items-start gap-2.5 rounded-control border border-danger/40 bg-danger/8 px-3 py-2.5">
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
          body="Images live in your site's own folder and are committed to it, so SoloWrk needs to know where that is."
          action={
            <Link to="/settings?tab=website">
              <Button variant="primary">
                <SettingsIcon size={14} strokeWidth={1.75} />
                Connect your site
              </Button>
            </Link>
          }
        />
      ) : images.length === 0 ? (
        <Empty
          icon={ImageIcon}
          title="No images yet"
          body="Add one and it is resized and converted to WebP before it reaches your repository, so a photo straight off a phone does not end up on your homepage at four megabytes."
          action={
            <Button variant="primary" onClick={() => add.mutate()}>
              <Upload size={14} strokeWidth={1.75} />
              Add images
            </Button>
          }
        />
      ) : (
        <>
          {unused > 0 && (
            <p className="mb-3 text-[11.5px] text-faint">
              {unused} {unused === 1 ? 'image is' : 'images are'} not referenced anywhere in your
              site's source. That is a hint, not a verdict — a path built from a variable will
              not be spotted.
            </p>
          )}

          <div className="grid grid-cols-4 gap-3">
            {images.map((image) => (
              <Thumb
                key={image.repoPath}
                image={image}
                selected={selected.has(image.repoPath)}
                copied={copied === image.webPath}
                onToggle={() => toggle(image.repoPath)}
                onCopy={() => copyPath(image.webPath)}
                onDelete={() => setDeleting(image)}
              />
            ))}
          </div>
        </>
      )}

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.repoPath)}
        title={`Delete ${deleting?.name ?? ''}?`}
        body={
          deleting?.used
            ? 'This image IS referenced somewhere in your site. Deleting it will leave a broken image on the live site once you publish.'
            : 'This deletes the file from your website folder. If it was already published, it stays on the live site until you publish again.'
        }
        confirmLabel="Delete image"
      />
    </Page>
  )
}

function Thumb({
  image,
  selected,
  copied,
  onToggle,
  onCopy,
  onDelete
}: {
  image: SiteImage
  selected: boolean
  copied: boolean
  onToggle: () => void
  onCopy: () => void
  onDelete: () => void
}): React.JSX.Element {
  const { data: src } = useQuery({
    queryKey: ['media', 'dataUrl', image.repoPath],
    queryFn: () => window.solo.invoke('media:dataUrl', { repoPath: image.repoPath }),
    // The bytes cannot change without the path changing, so this never goes stale.
    staleTime: Infinity
  })

  return (
    <div
      className={cn(
        'group overflow-hidden rounded-card border bg-surface transition-colors',
        selected ? 'border-accent' : 'border-line hover:border-line-strong'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="relative block aspect-[4/3] w-full bg-raised"
        aria-pressed={selected}
      >
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full place-items-center text-faint">
            <ImageIcon size={18} strokeWidth={1.5} />
          </span>
        )}

        {selected && (
          <span className="absolute top-2 right-2 grid h-5 w-5 place-items-center rounded-full bg-accent text-accent-ink">
            <Check size={12} strokeWidth={2.5} />
          </span>
        )}

        {!image.used && (
          <span className="absolute bottom-2 left-2 rounded-control bg-ground/85 px-1.5 py-0.5 text-[9.5px] text-faint">
            Unreferenced
          </span>
        )}
      </button>

      <div className="px-2.5 py-2">
        <p className="truncate text-[11.5px] text-ink" title={image.webPath}>
          {image.name}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="text-[10.5px] text-faint">{formatBytes(image.bytes)}</span>
          <button
            type="button"
            onClick={onCopy}
            title="Copy the path to paste into a post"
            className="ml-auto text-faint transition-colors hover:text-ink"
          >
            {copied ? <Check size={11} strokeWidth={2} /> : <Copy size={11} strokeWidth={1.75} />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${image.name}`}
            className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
          >
            <Trash2 size={11} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  )
}
