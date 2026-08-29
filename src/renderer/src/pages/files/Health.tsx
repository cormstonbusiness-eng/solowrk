import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Check, FolderCheck, HardDrive, TriangleAlert, Wrench } from 'lucide-react'
import type { ProjectStructure } from '@shared/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { Modal } from '@/components/ui/Modal'
import { useInvalidate } from '@/lib/api'
import { formatDate, formatSize } from '@/lib/format'
import { listItemVariants, listVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Whether every project's folders are the shape they should be.
 *
 * In 3D and design work a folder structure is not tidiness — it is file paths.
 * A missing `02-Assets` breaks every texture reference in a scene, and the
 * breakage shows up as pink checkerboards a week later on somebody else's
 * machine. This is the page that catches it while it is still cheap.
 *
 * **Repair only ever creates.** It is said on the button's own tooltip, not
 * buried in a note, because somebody is about to press it on a folder holding
 * a year of work.
 */

export function Health(): React.JSX.Element {
  const invalidate = useInvalidate()
  const [showing, setShowing] = useState<ProjectStructure | null>(null)

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['structure', 'all'],
    queryFn: () => window.solo.invoke('structure:checkAll'),
    // Walking every project's folders is disk work, not a keystroke response.
    staleTime: 60_000
  })

  const { data: usage = [] } = useQuery({
    queryKey: ['structure', 'usage'],
    queryFn: () => window.solo.invoke('structure:usage'),
    staleTime: 5 * 60_000
  })

  const repair = useMutation({
    mutationFn: (projectId: number) => window.solo.invoke('structure:repair', { projectId }),
    onSuccess: (result) => {
      invalidate(['structure', 'files'])
      setShowing(result.report)
    }
  })

  const broken = reports.filter((one) => !one.healthy)
  const totalBytes = usage.reduce((sum, one) => sum + one.bytes, 0)

  if (isLoading) return <></>

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Folder health"
          action={
            <span className="text-[11.5px] text-muted">
              {broken.length === 0
                ? `${reports.length} project${reports.length === 1 ? '' : 's'} in good shape`
                : `${broken.length} of ${reports.length} need attention`}
            </span>
          }
        />

        {reports.length === 0 ? (
          <Empty
            icon={FolderCheck}
            title="No projects to check"
            body="Structure health compares each project's folders against the template it was built to."
          />
        ) : (
          <motion.div
            variants={listVariants}
            initial="initial"
            animate="animate"
            className="flex flex-col gap-1"
          >
            {reports.map((report) => (
              <motion.div key={report.projectId} variants={listItemVariants}>
                <div className="group flex items-center gap-3 rounded-control px-2 py-2 hover:bg-hover">
                  {report.healthy ? (
                    <Check size={14} strokeWidth={2} className="shrink-0 text-success" />
                  ) : (
                    <TriangleAlert size={14} strokeWidth={1.75} className="shrink-0 text-warning" />
                  )}

                  <button
                    type="button"
                    onClick={() => setShowing(report)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[13px] text-ink">{report.projectName}</p>
                    <p className="truncate text-[11px] text-faint">
                      {!report.exists
                        ? 'The project folder is not on disk'
                        : report.healthy
                          ? report.unexpected.length > 0
                            ? `Complete · ${report.unexpected.length} extra folder${report.unexpected.length === 1 ? '' : 's'}`
                            : 'Complete'
                          : `${report.missing.length} folder${report.missing.length === 1 ? '' : 's'} missing`}
                    </p>
                  </button>

                  <div className="h-1 w-[70px] shrink-0 overflow-hidden rounded-full bg-raised">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        report.healthy ? 'bg-success' : 'bg-warning'
                      )}
                      style={{ width: `${report.score}%` }}
                    />
                  </div>

                  {!report.healthy && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Creates the missing folders. Never deletes, moves or renames anything."
                      onClick={() => repair.mutate(report.projectId)}
                      disabled={repair.isPending}
                    >
                      <Wrench size={13} strokeWidth={1.75} />
                      Repair
                    </Button>
                  )}
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Disk usage"
          action={
            <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
              <HardDrive size={12} strokeWidth={1.75} />
              {formatSize(totalBytes)} across {usage.length} project
              {usage.length === 1 ? '' : 's'}
            </span>
          }
        />

        <div className="flex flex-col gap-1">
          {usage.slice(0, 12).map((one) => (
            <div key={one.projectId} className="flex items-center gap-3 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] text-ink">{one.projectName}</p>
                <p className="truncate text-[11px] text-faint">
                  {one.files} file{one.files === 1 ? '' : 's'}
                  {one.lastTouched ? ` · last touched ${formatDate(one.lastTouched)}` : ''}
                </p>
              </div>

              <div className="h-1 w-[90px] shrink-0 overflow-hidden rounded-full bg-raised">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{
                    width: `${totalBytes > 0 ? Math.max(2, (one.bytes / totalBytes) * 100) : 0}%`
                  }}
                />
              </div>

              <span className="numeric w-[72px] shrink-0 text-right text-[12px] text-muted">
                {formatSize(one.bytes)}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <StructureDetail report={showing} onClose={() => setShowing(null)} />
    </div>
  )
}

function StructureDetail({
  report,
  onClose
}: {
  report: ProjectStructure | null
  onClose: () => void
}): React.JSX.Element {
  return (
    <Modal
      open={report !== null}
      onClose={onClose}
      title={report?.projectName ?? ''}
      description={report ? `Measured against ${report.templateName}` : ''}
      width={520}
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {report && (
        <div className="flex flex-col gap-1">
          {report.checks.map((check) => (
            <div key={check.path} className="flex items-center gap-2.5 px-1 py-1">
              {check.state === 'present' && (
                <Check size={13} strokeWidth={2} className="shrink-0 text-success" />
              )}
              {check.state === 'missing' && (
                <TriangleAlert size={13} strokeWidth={1.75} className="shrink-0 text-warning" />
              )}
              {check.state === 'unexpected' && (
                <span className="w-[13px] shrink-0 text-center text-[13px] text-faint">+</span>
              )}

              <span
                className={cn(
                  'font-mono text-[12px]',
                  check.state === 'missing' ? 'text-warning' : 'text-muted'
                )}
              >
                {check.path}
              </span>

              {check.state === 'unexpected' && (
                <span className="text-[11px] text-faint">not in the template — left alone</span>
              )}
            </div>
          ))}

          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            Repair creates the missing folders. It never deletes, moves or renames anything, so
            folders you added yourself stay exactly where they are.
          </p>
        </div>
      )}
    </Modal>
  )
}
