import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Archive, ArrowLeft, RotateCcw } from 'lucide-react'
import { Page } from '@/components/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Dot, Empty } from '@/components/ui/Empty'
import { Swap } from '@/components/ui/Swap'
import { keys, useInvalidate } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { listItemVariants, listVariants } from '@/lib/motion'

/**
 * Archived projects.
 *
 * A separate screen rather than a filter, because that is what archiving is
 * for: getting finished work out of the way without deleting it. Nothing is
 * lost — the folder, files, tasks, time and invoices all stay exactly as they
 * were, and restoring puts the project back on the board where it left off.
 */
export function ArchivedProjects(): React.JSX.Element {
  const invalidate = useInvalidate()
  const navigate = useNavigate()

  const { data: all = [] } = useQuery({
    queryKey: keys.projects(undefined),
    queryFn: () => window.solo.invoke('projects:list', { includeArchived: true })
  })

  const archived = all.filter((project) => project.archived)

  const restore = useMutation({
    mutationFn: (id: number) =>
      window.solo.invoke('projects:update', { id, patch: { archived: false } }),
    onSuccess: () => invalidate(['projects'])
  })

  return (
    <Page
      title="Archived projects"
      description="Out of the way, not gone. Restore one and it returns to the board."
      actions={
        <Button variant="ghost" onClick={() => navigate('/projects')}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          Back to projects
        </Button>
      }
    >
      <Swap
        empty={archived.length === 0}
        fallback={
          <Empty
            icon={Archive}
            title="Nothing archived"
            body="When a job is finished and you want it off the board, archive it from its card. Everything it holds stays exactly where it is."
          />
        }
      >
        <motion.div
          variants={listVariants}
          initial="initial"
          animate="animate"
          className="flex flex-col gap-2"
        >
          {archived.map((project) => (
            <motion.div key={project.id} variants={listItemVariants}>
              <Card className="flex items-center justify-between gap-4 py-3">
                <Link
                  to={`/projects/${project.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <Dot colour={project.colour} size={9} />
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium text-ink">{project.name}</p>
                    <p className="truncate text-[11.5px] text-faint">
                      {project.clientName ?? 'Internal'} · archived{' '}
                      {formatDate(project.updatedAt)}
                    </p>
                  </div>
                </Link>

                <Button variant="outline" size="sm" onClick={() => restore.mutate(project.id)}>
                  <RotateCcw size={13} strokeWidth={1.75} />
                  Restore
                </Button>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </Swap>
    </Page>
  )
}
