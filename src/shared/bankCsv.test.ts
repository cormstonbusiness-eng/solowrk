import { describe, expect, it } from 'vitest'
import {
  BankCsvError,
  parseBankAmount,
  parseBankCsv,
  parseBankDate,
  splitLine
} from './bankCsv'

/**
 * Reading a bank statement.
 *
 * Every UK bank exports a different shape, so the tests are shaped like real
 * exports rather than like one tidy format. The failures worth pinning are the
 * quiet ones: a balance column read as an amount, a payee with a comma in it
 * shunting every later column sideways, and an American date reading.
 */

describe('splitting a line', () => {
  it('keeps a quoted comma inside its field', () => {
    // "SMITH, J" is an extremely ordinary payee, and splitting naively pushes
    // the balance into the amount column.
    expect(splitLine('01/04/2026,"SMITH, J",-12.50,900.00', ',')).toEqual([
      '01/04/2026',
      'SMITH, J',
      '-12.50',
      '900.00'
    ])
  })

  it('reads a doubled quote as one quote', () => {
    expect(splitLine('a,"say ""hello""",b', ',')).toEqual(['a', 'say "hello"', 'b'])
  })

  it('keeps empty fields in place', () => {
    expect(splitLine('a,,c', ',')).toEqual(['a', '', 'c'])
  })
})

describe('dates', () => {
  it('reads the British way', () => {
    // The third of April, not the fourth of March.
    expect(parseBankDate('03/04/2026')).toBe('2026-04-03')
  })

  it('settles itself when the first number cannot be a month', () => {
    expect(parseBankDate('25/12/2026')).toBe('2026-12-25')
  })

  it('takes a two-digit year as this century', () => {
    expect(parseBankDate('01/04/26')).toBe('2026-04-01')
  })

  it('takes the named form banks print', () => {
    expect(parseBankDate('01 Apr 2026')).toBe('2026-04-01')
    expect(parseBankDate('1-Apr-26')).toBe('2026-04-01')
  })

  it('takes ISO, with or without a time after it', () => {
    expect(parseBankDate('2026-04-01')).toBe('2026-04-01')
    expect(parseBankDate('2026-04-01T09:30:00')).toBe('2026-04-01')
  })

  it('refuses a date that is not one', () => {
    expect(parseBankDate('31/02/2026')).toBeNull()
    expect(parseBankDate('Closing balance')).toBeNull()
    expect(parseBankDate('')).toBeNull()
  })
})

describe('amounts', () => {
  it('reads pounds as pence', () => {
    expect(parseBankAmount('12.50')).toBe(1250)
    expect(parseBankAmount('£1,234.56')).toBe(123456)
  })

  it('reads all four ways a statement says negative', () => {
    expect(parseBankAmount('-12.50')).toBe(-1250)
    expect(parseBankAmount('(12.50)')).toBe(-1250)
    expect(parseBankAmount('12.50 DR')).toBe(-1250)
    expect(parseBankAmount('12.50 CR')).toBe(1250)
  })

  it('knows a decimal comma from a thousands separator', () => {
    // Guessing wrong here is a hundred-fold error in somebody s accounts.
    expect(parseBankAmount('1500,00')).toBe(150_000)
    expect(parseBankAmount('1,500.00')).toBe(150_000)
    expect(parseBankAmount('1.500,00')).toBe(150_000)
  })

  it('refuses what is not money', () => {
    expect(parseBankAmount('')).toBeNull()
    expect(parseBankAmount('n/a')).toBeNull()
    expect(parseBankAmount('--')).toBeNull()
  })
})

describe('a whole statement', () => {
  it('reads the one-signed-column shape', () => {
    const reading = parseBankCsv(
      [
        'Date,Description,Amount,Balance',
        '01/04/2026,ACME LTD INV-0012,1500.00,2500.00',
        '02/04/2026,ADOBE SUBSCRIPTION,-19.97,2480.03'
      ].join('\n')
    )

    expect(reading.rows).toHaveLength(2)
    expect(reading.rows[0]).toMatchObject({
      date: '2026-04-01',
      description: 'ACME LTD INV-0012',
      amount: 150_000
    })
    expect(reading.rows[1]!.amount).toBe(-1997)
  })

  it('never reads the balance as the amount', () => {
    // The trap: numeric, next to the amount, and taking it turns every line
    // into a transaction the size of the account.
    const reading = parseBankCsv(
      ['Date,Description,Balance,Amount', '01/04/2026,COFFEE,9999.00,-3.20'].join('\n')
    )

    expect(reading.rows[0]!.amount).toBe(-320)
    expect(reading.columns.amount).toBe('Amount')
  })

  it('reads the two-column shape, where both figures are positive', () => {
    const reading = parseBankCsv(
      [
        'Date,Narrative,Paid Out,Paid In,Balance',
        '01/04/2026,ACME LTD,,1500.00,2500.00',
        '02/04/2026,ADOBE,19.97,,2480.03'
      ].join('\n')
    )

    // The sign comes from which column the figure was in.
    expect(reading.rows[0]!.amount).toBe(150_000)
    expect(reading.rows[1]!.amount).toBe(-1997)
  })

  it('finds a header buried under a bank s preamble', () => {
    const reading = parseBankCsv(
      [
        'Statement of account',
        'Account: 12345678',
        '01 April 2026 to 30 April 2026',
        '',
        'Date,Description,Amount',
        '01/04/2026,ACME LTD,1500.00'
      ].join('\n')
    )

    expect(reading.rows).toHaveLength(1)
  })

  it('reads a semicolon-separated export', () => {
    const reading = parseBankCsv(
      ['Date;Description;Amount', '01/04/2026;ACME LTD;1500,00'].join('\n')
    )
    expect(reading.rows).toHaveLength(1)
    expect(reading.rows[0]!.description).toBe('ACME LTD')
  })

  it('keeps the reference separate when the bank breaks it out', () => {
    const reading = parseBankCsv(
      ['Date,Payee,Reference,Amount', '01/04/2026,ACME LTD,INV-0012,1500.00'].join('\n')
    )

    expect(reading.rows[0]).toMatchObject({ description: 'ACME LTD', reference: 'INV-0012' })
  })

  it('reports the lines it could not read rather than dropping them', () => {
    const reading = parseBankCsv(
      [
        'Date,Description,Amount',
        '01/04/2026,ACME LTD,1500.00',
        'End of statement,,',
        '02/04/2026,NOTHING,'
      ].join('\n')
    )

    expect(reading.rows).toHaveLength(1)
    expect(reading.skipped).toHaveLength(2)
    expect(reading.skipped[0]!.line).toBe(3)
  })

  it('gives every line its own identity, even two identical payments', () => {
    // Two £4.50 coffees on one day are two transactions, and importing the
    // file twice must still only produce two.
    const reading = parseBankCsv(
      [
        'Date,Description,Amount',
        '01/04/2026,COFFEE,-4.50',
        '01/04/2026,COFFEE,-4.50'
      ].join('\n')
    )

    const [first, second] = reading.rows
    expect(first!.fingerprint).not.toBe(second!.fingerprint)
  })

  it('gives the same line the same identity on a second download', () => {
    const file = ['Date,Description,Amount', '01/04/2026,ACME LTD,1500.00'].join('\n')
    // The same statement re-exported with an extra week on the end: the first
    // line must keep its identity, or the import doubles it.
    const longer = `${file}\n08/04/2026,SOMEBODY ELSE,-20.00`

    expect(parseBankCsv(file).rows[0]!.fingerprint).toBe(
      parseBankCsv(longer).rows[0]!.fingerprint
    )
  })

  it('says so when the file is not a statement', () => {
    expect(() => parseBankCsv('name,email\nAda,ada@example.com')).toThrow(BankCsvError)
    expect(() => parseBankCsv('')).toThrow(BankCsvError)
  })

  it('says so when the header is right but there is nothing under it', () => {
    expect(() => parseBankCsv('Date,Description,Amount')).toThrow(BankCsvError)
  })
})
