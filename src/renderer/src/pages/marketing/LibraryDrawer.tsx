import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Archive, ExternalLink } from 'lucide-react'
import type { LibraryAssetInput, LibraryAssetWithContext, LibraryType } from '@shared/types'
import { LIBRARY_TYPES } from '@shared/types'
import { Drawer, DrawerClose } from '@/components/ui/Drawer'
import { Button } from '@/components/ui/Button'
import { Field, TextInput, Toggle } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { useInvalidate } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * One library item, open.
 *
 * The same drawer for all four kinds, with two fields that appear only where
 * they mean something: permission on a testimonial, and a link on a swipe.
 * A single form with everything showing would ask whether a case study has
 * been cleared for use, which is not a question about a case study.
 */

const TYPE_LABELS: Record<LibraryType, string> = {
  case_study: 'Case study',
  testimonial: 'Testimonial',
  image: 'Image',
  template: 'Template',
  swipe: 'Swipe'
}

export function LibraryDrawer({
  item,
  onClose
}: {
  item: LibraryAssetWithContext | null
  onClose: () => void
}): React.JSX.Element {
  return (
    <Drawer open={item !== null} onClose={onClose} width={520}>
      {item && <Body item={item} onClose={onClose} />}
    </Drawer>
  )
}

function Body({
  item,
  onClose
}: {
  item: LibraryAssetWithContext
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()

  const [title, setTitle] = useState(item.title)
  const [body, setBody] = useState(item.body)
  const [url, setUrl] = useState(item.url)
  const [tags, setTags] = useState(item.tags)

  useEffect(() => {
    setTitle(item.title)
    setBody(item.body)
    setUrl(item.url)
    setTags(item.tags)
  }, [item.id, item.title, item.body, item.url, item.tags])

  const save = useMutation({
    mutationFn: (patch: LibraryAssetInput) =>
      window.solo.invoke('library:update', { id: item.id, patch }),
    onSuccess: () => invalidate(['marketing'])
  })

  const archive = useMutation({
    mutationFn: () => window.solo.invoke('library:archive', { id: item.id, archived: true }),
    onSuccess: () => {
      invalidate(['marketing'])
      onClose()
    }
  })

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {title.trim() === '' ? 'Untitled' : title}
        </h2>
        <button
          type="button"
          aria-label="Archive"
          title="Archive — keeps everything, takes it off the grid"
          onClick={() => archive.mutate()}
          className="text-faint transition-colors hover:text-danger"
        >
          <Archive size={14} strokeWidth={1.75} />
        </button>
        <DrawerClose onClose={onClose} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <Select
              value={item.type}
              onChange={(type) => type && save.mutate({ type })}
              options={LIBRARY_TYPES.map((value) => ({ value, label: TYPE_LABELS[value] }))}
            />
          </Field>

          <Field label="Tags" hint="Comma separated. Used by search.">
            <TextInput
              value={tags}
              placeholder="planning, testimonial, before-after"
              onChange={(event) => setTags(event.target.value)}
              onBlur={() => tags !== item.tags && save.mutate({ tags })}
            />
          </Field>
        </div>

        <Field label="Title">
          <TextInput
            value={title}
            placeholder="What this is"
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => title !== item.title && save.mutate({ title })}
          />
        </Field>

        {/* A swipe is a link plus a line about why it is good. Without the
            line it is a bookmark, and bookmarks do not get reread. */}
        {(item.type === 'swipe' || item.type === 'case_study') && (
          <Field
            label={item.type === 'swipe' ? 'Where you saw it' : 'Where it is published'}
            hint={item.type === 'swipe' ? undefined : 'Leave empty until it goes live.'}
          >
            <div className="flex items-center gap-2">
              <TextInput
                value={url}
                placeholder="https://…"
                onChange={(event) => setUrl(event.target.value)}
                onBlur={() => url !== item.url && save.mutate({ url })}
              />
              {url.trim() !== '' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void window.solo.invoke('shell:openUrl', { url })}
                >
                  <ExternalLink size={13} strokeWidth={1.75} />
                </Button>
              )}
            </div>
          </Field>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-muted">
            {item.type === 'testimonial'
              ? 'What they said'
              : item.type === 'swipe'
                ? 'Why it is good'
                : 'The write-up'}
          </span>
          <textarea
            rows={item.type === 'case_study' ? 16 : 6}
            value={body}
            placeholder={
              item.type === 'swipe'
                ? 'One line on what makes it work, so it is worth reopening.'
                : undefined
            }
            onChange={(event) => setBody(event.target.value)}
            onBlur={() => body !== item.body && save.mutate({ body })}
            onKeyDown={(event) => event.stopPropagation()}
            className={cn(
              'w-full resize-y rounded-control border border-line bg-raised px-3 py-2',
              'text-[13px] leading-relaxed text-ink placeholder:text-faint',
              'transition-colors duration-150 hover:border-line-strong focus:border-accent focus:outline-none'
            )}
          />
        </div>

        {/*
          Permission, on testimonials only. Using a client's words without
          asking is a thing somebody does once, so it is a switch that starts
          off rather than a checkbox somebody skims past.
        */}
        {item.type === 'testimonial' && (
          <div className="rounded-control border border-line bg-raised px-3 py-2.5">
            <Toggle
              checked={item.mayUse}
              onChange={(mayUse) => save.mutate({ mayUse })}
              label="They are happy for you to use this"
              hint="Asked and answered — not assumed. Shown on the card so you can see it at a glance."
            />
          </div>
        )}

        {(item.clientName !== '' || item.projectName !== '') && (
          <p className="text-[11px] text-faint">
            From {[item.projectName, item.clientName].filter(Boolean).join(' — ')}
          </p>
        )}
      </div>
    </>
  )
}
