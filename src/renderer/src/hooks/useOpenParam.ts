import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Lets one screen ask another to open something — "new invoice" from the
 * command palette navigates to `/invoices?new=1`, and the invoices page opens
 * its create modal.
 *
 * The parameter is cleared as soon as it fires, so going back to the page, or
 * a reload, does not reopen the modal on a URL that has already been acted on.
 */
export function useOpenParam(name: string, open: () => void): void {
  const [searchParams, setSearchParams] = useSearchParams()
  const flag = searchParams.get(name)

  useEffect(() => {
    if (flag !== '1') return

    open()

    const next = new URLSearchParams(searchParams)
    next.delete(name)
    setSearchParams(next, { replace: true })
    // `open` is a fresh closure on every render; depending on it would re-fire
    // the effect forever. The flag is what decides whether this should run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flag, name])
}