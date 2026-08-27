import { describe, expect, it } from 'vitest'
import { readDate, readReceipt, readVendor } from './receipts'

/** What Windows OCR actually hands back: ragged, shouty, occasionally wrong. */
const TESCO = `TESCO EXPRESS
14 HIGH STREET
BRISTOL BS1 4AA
VAT No 220430231

Milk 2L            1.85
Bread              1.20
Coffee             4.50

SUBTOTAL           7.55
VAT @ 20%          1.51
TOTAL              9.06

CARD               9.06
CHANGE             0.00

17/08/2026  14:32
THANK YOU FOR SHOPPING`

describe('reading a whole receipt', () => {
  it('finds what it cost, when, and who from', () => {
    expect(readReceipt(TESCO)).toMatchObject({
      total: 906,
      vat: 151,
      date: '2026-08-17',
      vendor: 'Tesco Express',
      confidence: 'good'
    })
  })

  it('never mistakes the subtotal for the total', () => {
    // The error that survives a whole year unnoticed: it understates the
    // expense by exactly the VAT, and looks entirely plausible.
    expect(readReceipt(TESCO).total).not.toBe(755)
  })

  it('never mistakes the VAT line for the total', () => {
    expect(readReceipt(TESCO).total).not.toBe(151)
  })

  it('does not take the change as the amount', () => {
    const zeroChange = readReceipt(TESCO)
    expect(zeroChange.total).toBe(906)
  })
})

describe('amounts', () => {
  it('reads a total with a pound sign', () => {
    expect(readReceipt('TOTAL £24.50').total).toBe(2450)
  })

  it('reads thousands', () => {
    expect(readReceipt('Amount due £1,299.00').total).toBe(129900)
  })

  it('copes with the decimal comma some tills print', () => {
    expect(readReceipt('TOTAL 24,50').total).toBe(2450)
  })

  it('takes the money at the end of a busy line', () => {
    expect(readReceipt('TOTAL 3 items 24.50').total).toBe(2450)
  })

  it('falls back to the largest amount when nothing says total', () => {
    // On a receipt the biggest number is very nearly always what was paid.
    const scrappy = 'Coffee 2.40\nCake 3.10\n5.50'
    expect(readReceipt(scrappy).total).toBe(550)
  })

  it('gives up rather than inventing a figure', () => {
    expect(readReceipt('completely unreadable smudge').total).toBeNull()
  })
})

describe('dates', () => {
  it('reads a British date the British way', () => {
    // The third of April, not the fourth of March. Unresolvable from the
    // digits, so it is settled by convention rather than left as a surprise
    // for whoever files the wrong quarter.
    expect(readDate('03/04/2026')).toBe('2026-04-03')
  })

  it('settles itself when the first number cannot be a month', () => {
    expect(readDate('17/08/2026')).toBe('2026-08-17')
  })

  it('takes an American-looking date when day-first is impossible', () => {
    // 08/17 cannot be a British date, so it is month-first and says so.
    expect(readDate('08/17/2026')).toBe('2026-08-17')
  })

  it('reads a two-digit year as this century', () => {
    expect(readDate('17/08/26')).toBe('2026-08-17')
  })

  it('reads dots and dashes as readily as slashes', () => {
    expect(readDate('17.08.2026')).toBe('2026-08-17')
    expect(readDate('17-08-2026')).toBe('2026-08-17')
  })

  it('reads a written month', () => {
    expect(readDate('17 Aug 2026')).toBe('2026-08-17')
    expect(readDate('3rd September 2026')).toBe('2026-09-03')
  })

  it('reads an ISO date when a till prints one', () => {
    expect(readDate('2026-08-17')).toBe('2026-08-17')
  })

  it('refuses a date that is not on the calendar', () => {
    // 31 February would otherwise be stored and quietly reappear as 3 March.
    expect(readDate('31/02/2026')).toBeNull()
  })

  it('gives up on nonsense', () => {
    expect(readDate('no date anywhere here')).toBeNull()
  })
})

describe('the vendor', () => {
  it('takes the first line that reads like a name', () => {
    expect(readVendor(['PRET A MANGER', '12 Queen St'])).toBe('Pret A Manger')
  })

  it('skips a leading blank where the logo was', () => {
    expect(readVendor(['', '   ', 'RYMAN LTD', '4 The Parade'])).toBe('Ryman Ltd')
  })

  it('skips an address or a phone number at the top', () => {
    expect(readVendor(['0117 923 4567', 'www.example.com', 'BLUE BOTTLE'])).toBe('Blue Bottle')
  })

  it('skips the word Receipt, which is not a shop', () => {
    expect(readVendor(['VAT RECEIPT', 'HOMEBASE'])).toBe('Homebase')
  })

  it('leaves a name that is already mixed case alone', () => {
    expect(readVendor(['Gail’s Bakery'])).toBe('Gail’s Bakery')
  })

  it('gives up when nothing looks like a name', () => {
    expect(readVendor(['1234', '////', ''])).toBeNull()
  })
})

describe('how much to believe it', () => {
  it('is confident with all three', () => {
    expect(readReceipt(TESCO).confidence).toBe('good')
  })

  it('is partial with two', () => {
    expect(readReceipt('CAFFE NERO\nTOTAL 4.20').confidence).toBe('partial')
  })

  it('is poor with almost nothing', () => {
    expect(readReceipt('9.99').confidence).toBe('poor')
  })
})
