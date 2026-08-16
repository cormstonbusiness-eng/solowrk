import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

/**
 * Pulling readable text out of whatever a document happens to be.
 *
 * Used for the business plan the assistant reads, and deliberately general: a
 * freelancer's plan is as likely to be a Word file or a PDF as it is markdown,
 * and telling someone to retype theirs would be a poor answer.
 *
 * Both extractors are pure JavaScript. That matters — the whole app is
 * deliberately free of native modules (`node:sqlite` rather than
 * better-sqlite3), so `npm install` works anywhere with no build step.
 */

export const TEXT_EXTENSIONS = ['.md', '.txt', '.markdown', '.rtf', '.csv']
export const RICH_EXTENSIONS = ['.docx', '.pdf']

/** Everything we can read. Anything else is refused at the point of attaching. */
export const SUPPORTED_EXTENSIONS = [...TEXT_EXTENSIONS, ...RICH_EXTENSIONS]

export function isSupported(file: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(extname(file).toLowerCase())
}

/**
 * Collapse the whitespace an extractor leaves behind.
 *
 * PDFs in particular come back with a line break per visual line, which turns
 * a paragraph into a column of fragments and reads badly in a prompt. Runs of
 * blank lines become one, and trailing spaces go.
 */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Strip XML tags, turning paragraph and break elements into newlines first. */
export function xmlToText(xml: string): string {
  return tidy(
    xml
      // Only the closing tag becomes a break. Marking the opening one too
      // gives every paragraph a blank line above it, which reads as double
      // spacing rather than as paragraphs.
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:br\s*\/?>/g, '\n')
      .replace(/<w:tab\s*\/?>/g, '\t')
      .replace(/<[^>]+>/g, '')
      // Entities, in the order that avoids double-decoding an escaped ampersand.
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
  )
}

async function fromDocx(path: string): Promise<string> {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.extractRawText({ path })
  return tidy(value)
}

async function fromPdf(path: string): Promise<string> {
  // The legacy build is the one that runs outside a browser.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

  const data = new Uint8Array(await readFile(path))
  const document = await pdfjs.getDocument({ data, useSystemFonts: true }).promise

  const pages: string[] = []
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number)
    const content = await page.getTextContent()
    pages.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
    )
  }

  await document.cleanup()
  return tidy(pages.join('\n\n'))
}

/**
 * The document's text, or a thrown error naming the format we cannot read.
 *
 * Errors are deliberately loud and thrown at the moment of attaching rather
 * than swallowed: finding out mid-conversation that the assistant has been
 * working from an empty plan would be worse than being told at the door.
 */
export async function extractText(path: string): Promise<string> {
  const extension = extname(path).toLowerCase()

  if (TEXT_EXTENSIONS.includes(extension)) {
    return tidy(await readFile(path, 'utf8'))
  }

  if (extension === '.docx') return fromDocx(path)
  if (extension === '.pdf') return fromPdf(path)

  throw new Error(
    `SoloWrk cannot read ${extension || 'that file'}. Save it as PDF, Word (.docx), ` +
      'markdown or plain text.'
  )
}
