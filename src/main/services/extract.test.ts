import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractText, isSupported, tidy, xmlToText } from './extract'

describe('isSupported', () => {
  it('accepts the formats a business plan actually arrives in', () => {
    for (const name of ['plan.md', 'plan.txt', 'Plan.DOCX', 'plan.pdf']) {
      expect(isSupported(name)).toBe(true)
    }
  })

  it('refuses what it cannot read', () => {
    for (const name of ['plan.doc', 'plan.pages', 'plan.xlsx', 'plan', 'plan.png']) {
      expect(isSupported(name)).toBe(false)
    }
  })

  it('uses the last extension', () => {
    expect(isSupported('plan.pdf.zip')).toBe(false)
  })
})

describe('tidy', () => {
  it('normalises Windows line endings', () => {
    expect(tidy('one\r\ntwo')).toBe('one\ntwo')
  })

  it('collapses runs of blank lines to one', () => {
    expect(tidy('one\n\n\n\n\ntwo')).toBe('one\n\ntwo')
  })

  it('keeps a single blank line, which is a paragraph break', () => {
    expect(tidy('one\n\ntwo')).toBe('one\n\ntwo')
  })

  it('strips trailing spaces without touching indentation', () => {
    // Indentation survives on any line but the first, which the final trim
    // owns — a document should not open with blank space.
    expect(tidy('first\n  indented   \nnext')).toBe('first\n  indented\nnext')
  })

  it('trims the whole thing', () => {
    expect(tidy('\n\n  hello  \n\n')).toBe('hello')
  })
})

describe('xmlToText', () => {
  it('turns paragraphs into line breaks', () => {
    expect(xmlToText('<w:p><w:t>One</w:t></w:p><w:p><w:t>Two</w:t></w:p>')).toBe('One\nTwo')
  })

  it('decodes entities', () => {
    expect(xmlToText('<w:t>Fish &amp; Chips</w:t>')).toBe('Fish & Chips')
  })

  it('does not double-decode an escaped ampersand', () => {
    // &amp;lt; is a literal "&lt;", not a less-than sign.
    expect(xmlToText('<w:t>&amp;lt;</w:t>')).toBe('&lt;')
  })

  it('drops tags it does not understand', () => {
    expect(xmlToText('<a><b>text</b></a>')).toBe('text')
  })
})

describe('extractText', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-extract-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads markdown as-is', async () => {
    const file = join(root, 'plan.md')
    await writeFile(file, '# Plan\r\n\r\n\r\n\r\nWe do design.\n')
    expect(await extractText(file)).toBe('# Plan\n\nWe do design.')
  })

  it('reads plain text', async () => {
    const file = join(root, 'plan.txt')
    await writeFile(file, 'Just words.')
    expect(await extractText(file)).toBe('Just words.')
  })

  it('names the format it cannot read, rather than failing vaguely', async () => {
    const file = join(root, 'plan.pages')
    await writeFile(file, 'x')
    await expect(extractText(file)).rejects.toThrow(/\.pages/)
  })

  it('suggests what to do about an unreadable format', async () => {
    const file = join(root, 'plan.doc')
    await writeFile(file, 'x')
    await expect(extractText(file)).rejects.toThrow(/Save it as PDF/)
  })
})
