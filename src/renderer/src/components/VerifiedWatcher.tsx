import { useEffect, useRef } from 'react'
import { toast } from '@/lib/celebrate'
import { useAuthState } from '@/lib/features'

/**
 * Says so, once, when the address gets confirmed.
 *
 * Most people will click the link in a browser, on a phone or on the other
 * monitor, with the app sitting open behind it. Nothing about that reaches the
 * app on its own — but the licence check already runs on a timer and whenever
 * the window regains focus, and it now carries `emailVerified`. So the moment
 * they alt-tab back, the app has the answer; this is what turns having the
 * answer into telling them.
 *
 * Renders nothing. It exists for the effect.
 */
export function VerifiedWatcher(): null {
  const auth = useAuthState()
  const verified = auth?.account?.emailVerified

  /**
   * What it was last time, which is not the same as "false".
   *
   * The flag has three states and only one transition is worth announcing:
   * false to true. Starting this at `false` would fire on the first render for
   * somebody who verified months ago, and starting it at `undefined` and
   * treating undefined as false would do the same for anybody whose account
   * server is too old to send the field. So the previous value is held as-is
   * and the announcement needs an actual `false` before it.
   */
  const previous = useRef<boolean | undefined>(undefined)
  const announced = useRef(false)

  useEffect(() => {
    if (previous.current === false && verified === true && !announced.current) {
      announced.current = true
      toast('Account now verified', {
        body: 'Your email address is confirmed. That is where we will write about your licence.'
      })
    }

    previous.current = verified
  }, [verified])

  return null
}
