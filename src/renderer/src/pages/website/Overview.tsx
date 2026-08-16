import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  FolderOpen,
  Github,
  Globe,
  Loader,
  PenLine,
  Settings as SettingsIcon
} from 'lucide-react'

import { Page } from '@/components/Page'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * The website at a glance.
 *
 * Its main job is answering "is this actually connected, and did my last
 * publish work" — the two questions that matter before you write anything.
 */
export function WebsiteOverview(): React.JSX.Element {
  const { data: status } = useQuery({
    queryKey: ['site', 'status'],
    queryFn: () => window.solo.invoke('site:status')
  })

  const connected = status?.folderExists === true && status.repoValid && status.tokenSet

  const { data: posts = [] } = useQuery({
    queryKey: ['blog', 'list'],
    queryFn: () => window.solo.invoke('blog:list'),
    enabled: connected
  })

  const { data: last } = useQuery({
    queryKey: ['site', 'lastDeploy'],
    queryFn: () => window.solo.invoke('site:lastDeploy'),
    enabled: connected,
    // The host takes about a minute to build, so this is worth re-reading
    // while a publish is in flight.
    refetchInterval: 20_000
  })

  const drafts = posts.filter((post) => post.draft).length
  const live = posts.length - drafts

  return (
    <Page
      title="Website"
      description={
        status?.url
          ? status.url.replace(/^https?:\/\//, '')
          : 'Write and publish to your own site, without leaving the app.'
      }
      actions={
        status?.url ? (
          <Button variant="ghost" onClick={() => void window.solo.invoke('site:open', { what: 'live' })}>
            <ExternalLink size={14} strokeWidth={1.75} />
            Open site
          </Button>
        ) : undefined
      }
    >
      {status === undefined ? null : !connected ? (
        <Empty
          icon={Globe}
          title="Your website is not connected yet"
          body="Point SoloWrk at the folder your site lives in and give it a GitHub token, and you can write posts here and publish them without touching the repository by hand."
          action={
            <Link to="/settings?tab=website">
              <Button variant="primary">
                <SettingsIcon size={14} strokeWidth={1.75} />
                Connect your site
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardHeader title="Published" />
              <p className="numeric text-[26px] leading-none font-medium text-ink">{live}</p>
              <p className="mt-2 text-[11.5px] text-faint">
                {live === 1 ? 'post is live' : 'posts are live'}
              </p>
            </Card>

            <Card>
              <CardHeader title="Drafts" />
              <p className="numeric text-[26px] leading-none font-medium text-ink">{drafts}</p>
              <p className="mt-2 text-[11.5px] text-faint">
                In the repository, not on the site
              </p>
            </Card>

            <Card>
              <CardHeader title="Last publish" />
              {last?.deploy ? (
                <>
                  <DeployState state={last.state} />
                  <p className="mt-2 truncate text-[11.5px] text-faint">
                    {last.deploy.title} · {formatDate(last.deploy.createdAt)}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[13px] text-muted">Nothing published yet</p>
                  <p className="mt-2 text-[11.5px] text-faint">
                    Your first post will show its build here
                  </p>
                </>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Connection"
              action={
                <Link to="/settings?tab=website">
                  <Button variant="ghost" size="sm">
                    Change
                  </Button>
                </Link>
              }
            />
            <div className="flex flex-col gap-2">
              <Row label="Repository" value={status.repo} ok={status.repoValid} />
              <Row label="Branch" value={status.branch} ok />
              <Row label="Folder" value={status.path} ok={status.folderExists} />
              <Row
                label="Blog folder"
                value={status.hasContentDir ? 'content/blog' : 'Not found in the repository'}
                ok={status.hasContentDir}
              />
              <Row label="GitHub token" value={status.tokenSet ? 'Saved' : 'Not set'} ok={status.tokenSet} />
            </div>

            <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void window.solo.invoke('site:open', { what: 'repo' })}
              >
                <Github size={13} strokeWidth={1.75} />
                Repository
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void window.solo.invoke('site:open', { what: 'folder' })}
              >
                <FolderOpen size={13} strokeWidth={1.75} />
                Local folder
              </Button>
              <Link to="/website/blog" className="ml-auto">
                <Button variant="primary" size="sm">
                  <PenLine size={13} strokeWidth={1.75} />
                  Write a post
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      )}
    </Page>
  )
}

function Row({
  label,
  value,
  ok
}: {
  label: string
  value: string
  ok: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 text-[12.5px]">
      <span className="w-[104px] shrink-0 text-faint">{label}</span>
      <span className={cn('min-w-0 flex-1 truncate', ok ? 'text-ink' : 'text-danger')}>
        {value || '—'}
      </span>
      {ok ? (
        <CircleCheck size={13} strokeWidth={1.75} className="shrink-0 text-success" />
      ) : (
        <CircleAlert size={13} strokeWidth={1.75} className="shrink-0 text-danger" />
      )}
    </div>
  )
}

/**
 * The host's build state, read back from the commit.
 *
 * "None" is deliberately not an error: a repository with no build integration
 * publishes perfectly well, it just has nothing to report back.
 */
function DeployState({ state }: { state: string }): React.JSX.Element {
  if (state === 'pending') {
    return (
      <p className="flex items-center gap-2 text-[13px] text-warning">
        <Loader size={14} strokeWidth={2} className="animate-spin" />
        Building…
      </p>
    )
  }
  if (state === 'success') {
    return (
      <p className="flex items-center gap-2 text-[13px] text-success">
        <CircleCheck size={14} strokeWidth={2} />
        Live
      </p>
    )
  }
  if (state === 'failure') {
    return (
      <p className="flex items-center gap-2 text-[13px] text-danger">
        <CircleAlert size={14} strokeWidth={2} />
        Build failed
      </p>
    )
  }
  return <p className="text-[13px] text-muted">Committed</p>
}
