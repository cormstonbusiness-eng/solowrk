import { describe, expect, it } from 'vitest'
import { toFolderName, uniqueFolderName } from './naming'

describe('toFolderName', () => {
  it('leaves an ordinary name alone', () => {
    expect(toFolderName('Acme Ltd')).toBe('Acme Ltd')
  })

  it('replaces characters Windows forbids', () => {
    expect(toFolderName('Smith/Jones Ltd')).toBe('Smith Jones Ltd')
    expect(toFolderName('Q1: Rebrand')).toBe('Q1 Rebrand')
    expect(toFolderName('What? *Now*')).toBe('What Now')
  })

  it('keeps characters that are legal but look suspicious', () => {
    // The classic bug: an unescaped hyphen in the character class turns
    // `* -` into a range and eats commas and plus signs.
    expect(toFolderName('Acme, Bell & Co')).toBe('Acme, Bell & Co')
    expect(toFolderName('C++ Consulting')).toBe('C++ Consulting')
  })

  it('strips trailing dots and spaces that Windows would drop anyway', () => {
    expect(toFolderName('Acme.')).toBe('Acme')
    expect(toFolderName('Acme   ')).toBe('Acme')
  })

  it('escapes reserved device names', () => {
    expect(toFolderName('CON')).toBe('CON_')
    expect(toFolderName('nul')).toBe('nul_')
    expect(toFolderName('COM1')).toBe('COM1_')
    // Only reserved as the whole name.
    expect(toFolderName('CON Design')).toBe('CON Design')
  })

  it('falls back rather than returning an empty name', () => {
    expect(toFolderName('')).toBe('Untitled')
    expect(toFolderName('///')).toBe('Untitled')
    expect(toFolderName('   ')).toBe('Untitled')
  })

  it('caps the length', () => {
    expect(toFolderName('A'.repeat(300)).length).toBeLessThanOrEqual(80)
  })

  it('collapses runs of whitespace left by substitution', () => {
    expect(toFolderName('Acme  //  Ltd')).toBe('Acme Ltd')
  })
})

describe('uniqueFolderName', () => {
  it('returns the plain name when nothing clashes', () => {
    expect(uniqueFolderName('Acme', [])).toBe('Acme')
  })

  it('suffixes on a clash', () => {
    expect(uniqueFolderName('Acme', ['Acme'])).toBe('Acme 2')
    expect(uniqueFolderName('Acme', ['Acme', 'Acme 2'])).toBe('Acme 3')
  })

  it('compares case-insensitively, as Windows does', () => {
    expect(uniqueFolderName('acme', ['ACME'])).toBe('acme 2')
  })

  it('sanitises before checking for a clash', () => {
    expect(uniqueFolderName('Acme/Ltd', ['Acme Ltd'])).toBe('Acme Ltd 2')
  })
})
