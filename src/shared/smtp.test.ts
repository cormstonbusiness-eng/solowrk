import { describe, expect, it } from 'vitest'
import { presetFor, smtpProblems } from './smtp'

describe('guessing a server from an address', () => {
  it('knows the providers most people are on', () => {
    expect(presetFor('me@gmail.com')?.host).toBe('smtp.gmail.com')
    expect(presetFor('me@outlook.com')?.host).toBe('smtp-mail.outlook.com')
    expect(presetFor('me@icloud.com')?.host).toBe('smtp.mail.me.com')
  })

  it('ignores case and stray spaces', () => {
    expect(presetFor('  Me@GMail.com ')?.host).toBe('smtp.gmail.com')
  })

  it('refuses to guess at a business domain', () => {
    // The important one. Most people using this app send from their own
    // domain, and "smtp." in front of it is right often enough to be dangerous
    // and wrong often enough to waste an afternoon. Better to ask.
    expect(presetFor('craig@blockoutdigital.co.uk')).toBeNull()
  })

  it('does not fall over on something that is not an address', () => {
    expect(presetFor('')).toBeNull()
    expect(presetFor('not an address')).toBeNull()
    expect(presetFor('@')).toBeNull()
  })

  it('offers a port that survives a hotel network', () => {
    // 465 is blocked outright on plenty of networks. 587 with required
    // STARTTLS is encrypted before the password moves, and gets through.
    for (const address of ['me@gmail.com', 'me@outlook.com', 'me@fastmail.com']) {
      expect(presetFor(address)!.port, address).toBe(587)
    }
  })
})

describe('what is still missing', () => {
  const complete = { host: 'smtp.gmail.com', port: 587, user: 'me@gmail.com' }

  it('is happy with a complete set', () => {
    expect(smtpProblems(complete)).toEqual([])
  })

  it('asks for the address first', () => {
    // The order matters: it is the field somebody fills in first and the one
    // the others are guessed from.
    expect(smtpProblems({ ...complete, user: '' })[0]).toContain('email address')
  })

  it('notices an address that is not one', () => {
    expect(smtpProblems({ ...complete, user: 'me' })).toHaveLength(1)
  })

  it('notices a missing server and an impossible port', () => {
    expect(smtpProblems({ host: '', port: 0, user: 'me@gmail.com' })).toHaveLength(2)
  })

  it('says nothing about whether it will actually work', () => {
    // A complete set of settings is not a working one — Gmail wants an app
    // password and this cannot tell. Only sending proves it.
    expect(smtpProblems({ ...complete, host: 'smtp.wrong.example' })).toEqual([])
  })
})
