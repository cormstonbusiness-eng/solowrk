import { useState } from 'react'
import { Copy, Mail } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useInvalidate } from '@/lib/api'

/**
 * The chase note, ready to read and send.
 *
 * Shared by the Invoices page and the debtors report rather than copied
 * into each. The part worth having in one place is `record`: it fires when
 * the note is taken away to be sent, not when it was drawn up, and getting
 * that wrong in one of two copies would let a milestone quietly replace a
 * note nobody ever sent.
 */
export interface ChaserDraft {
  subject: string
  body: string
  to: string
  /**
   * Present only when the draft came from the queue. Acting on it then advances
   * the schedule; a chaser written by hand from the button on an overdue
   * invoice does not, because that button is Basic and `chasing:record` is not.
   */
  chase?: { id: number; attempt: number }
}

export function ChaserModal({
  chaser,
  onClose
}: {
  chaser: ChaserDraft | null
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [copied, setCopied] = useState(false)

  /**
   * Recorded when the note is taken away to be sent, not when it was drafted —
   * a draft nobody read has not chased anybody, and marking it done at that
   * point would let the next milestone silently replace one never sent.
   */
  const record = (draft: ChaserDraft): void => {
    if (!draft.chase) return
    void window.solo
      .invoke('chasing:record', draft.chase)
      .then(() => invalidate(['invoices']))
      // Refusing here means a licence lapsed between opening the draft and
      // sending it. The note is still perfectly good; say nothing and let the
      // read-only bar do the explaining.
      .catch(() => undefined)
  }

  return (
    <Modal
      open={chaser !== null}
      onClose={onClose}
      title="Chase this invoice"
      description="Read it over, change anything you like, then send it yourself."
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (!chaser) return
              void navigator.clipboard.writeText(chaser.body)
              record(chaser)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            <Copy size={13} strokeWidth={1.75} />
            {copied ? 'Copied' : 'Copy text'}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!chaser) return
              void window.solo.invoke('shell:mailto', {
                to: chaser.to,
                subject: chaser.subject,
                body: chaser.body
              })
              record(chaser)
            }}
            disabled={!chaser?.to}
          >
            <Mail size={13} strokeWidth={1.75} />
            Open in email
          </Button>
        </>
      }
    >
      {chaser && (
        <div className="flex flex-col gap-2.5">
          <div className="rounded-control bg-raised px-3 py-2">
            <p className="text-[11px] text-faint">To</p>
            <p className="text-[12.5px] text-ink">{chaser.to || 'No email on file for this client'}</p>
          </div>
          <div className="rounded-control bg-raised px-3 py-2">
            <p className="text-[11px] text-faint">Subject</p>
            <p className="text-[12.5px] text-ink">{chaser.subject}</p>
          </div>
          <pre className="rounded-control bg-raised px-3 py-2.5 font-sans text-[12.5px] leading-relaxed whitespace-pre-wrap text-muted">
            {chaser.body}
          </pre>
        </div>
      )}
    </Modal>
  )
}
