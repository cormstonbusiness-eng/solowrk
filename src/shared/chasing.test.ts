import { describe, expect, it } from 'vitest'
import { DEFAULT_CHASE_DAYS, describeSchedule, parseChaseDays } from './chasing'

/**
 * The sentence under the Settings input is the only place anyone sees what the
 * app understood before it acts on it, so it is pinned as carefully as the
 * parsing. Both come from here, which is the point of the module: a preview
 * that read the text its own way would eventually disagree with the sweep.
 */
describe('reading it back', () => {
  it('says what will happen, in order', () => {
    expect(describeSchedule([7, 14, 30])).toBe(
      'Chases 7 days after, 14 days after and 30 days after.'
    )
  })

  it('handles one milestone without a stray conjunction', () => {
    expect(describeSchedule([14])).toBe('Chases 14 days after.')
  })

  it('says "on the due date" rather than "0 days after"', () => {
    expect(describeSchedule([0, 7])).toBe('Chases on the due date and 7 days after.')
  })

  it('gets the singular right', () => {
    expect(describeSchedule([1])).toBe('Chases 1 day after.')
  })

  it('shows the correction rather than the input', () => {
    // The failure this exists to prevent: somebody types "30, 7, banana", sees
    // their own text echoed back, and finds out what it meant when a client
    // gets the wrong note.
    expect(describeSchedule(parseChaseDays('30, 7, banana'))).toBe(
      'Chases 7 days after and 30 days after.'
    )
  })

  it('describes the fallback when the text is unusable', () => {
    // Not an empty sentence. Chasing is still going to happen, and on which
    // days is exactly what the user needs telling.
    expect(describeSchedule(parseChaseDays(''))).toBe(
      `Chases ${DEFAULT_CHASE_DAYS[0]} days after, ${DEFAULT_CHASE_DAYS[1]} days after and ${DEFAULT_CHASE_DAYS[2]} days after.`
    )
  })
})