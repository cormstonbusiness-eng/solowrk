import { cn } from '@/lib/utils'

/**
 * Just enough markdown.
 *
 * A full library would be a dependency, a bundle, and an HTML-injection
 * question, for documents that are mostly prose. This handles what the
 * business plan and the document templates actually use: headings, bullets,
 * numbered lists, tables, rules, bold, italic and inline code.
 *
 * Nothing is injected as HTML — every construct is split and rendered as React
 * elements, so a contract containing `<script>` renders as the characters
 * somebody typed. And anything not handled falls through as its own text
 * rather than disappearing, which is the property that matters: nothing the
 * user wrote is ever invisible.
 */

/**
 * An unfilled merge field, marked so it cannot be missed.
 *
 * The one piece of highlighting here, and it earns its place: a document that
 * still says `{{client.company}}` where a name should be must look wrong at a
 * glance, or somebody sends it.
 */
const FIELD = /(\{\{[^}]+\}\})/g

const BULLET = /^\s*([-*+]|\d+[.)])\s+/
const HEADING = /^(#{1,4})\s+(.*)$/
const RULE = /^\s*(-{3,}|_{3,}|\*{3,})\s*$/
const TABLE_ROW = /^\s*\|(.+)\|\s*$/
const TABLE_DIVIDER = /^\s*\|[\s:|-]+\|\s*$/

const HEADING_CLASS: Record<number, string> = {
  1: 'mt-4 mb-2 text-[17px] font-medium text-ink first:mt-0',
  2: 'mt-4 mb-1.5 text-[14px] font-medium text-ink first:mt-0',
  3: 'mt-3 mb-1 text-[12.5px] font-medium text-ink first:mt-0',
  4: 'mt-3 mb-1 text-[12px] font-medium text-muted first:mt-0'
}

export function Markdown({
  text,
  className
}: {
  text: string
  className?: string
}): React.JSX.Element {
  const blocks: React.JSX.Element[] = []
  const lines = text.split('\n')

  let index = 0
  while (index < lines.length) {
    const line = lines[index]!

    if (line.trim() === '') {
      index += 1
      continue
    }

    if (RULE.test(line)) {
      blocks.push(<hr key={blocks.length} className="my-3 border-line" />)
      index += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      const level = heading[1]!.length
      const Tag = `h${Math.min(level, 6)}` as 'h1'
      blocks.push(
        <Tag key={blocks.length} className={HEADING_CLASS[level] ?? HEADING_CLASS[4]!}>
          <Inline text={heading[2]!} />
        </Tag>
      )
      index += 1
      continue
    }

    if (TABLE_ROW.test(line)) {
      const rows: string[][] = []
      let hasHeader = false

      while (index < lines.length && TABLE_ROW.test(lines[index]!)) {
        if (TABLE_DIVIDER.test(lines[index]!)) {
          // The `|---|---|` line is not a row; it says the one above was the
          // header. Consumed rather than rendered as a row of dashes.
          hasHeader = rows.length === 1
          index += 1
          continue
        }
        rows.push(cells(lines[index]!))
        index += 1
      }

      blocks.push(<Table key={blocks.length} rows={rows} hasHeader={hasHeader} />)
      continue
    }

    if (BULLET.test(line)) {
      const items: string[] = []
      const numbered = /^\s*\d/.test(line)

      while (index < lines.length && BULLET.test(lines[index]!)) {
        items.push(lines[index]!.replace(BULLET, ''))
        index += 1
      }

      const List = numbered ? 'ol' : 'ul'
      blocks.push(
        <List
          key={blocks.length}
          className={cn(
            'mb-2 flex list-outside flex-col gap-1 pl-4 text-[12.5px] leading-relaxed text-muted',
            numbered ? 'list-decimal' : 'list-disc'
          )}
        >
          {items.map((item, position) => (
            <li key={position}>
              <Inline text={item} />
            </li>
          ))}
        </List>
      )
      continue
    }

    const paragraph: string[] = []
    while (
      index < lines.length &&
      lines[index]!.trim() !== '' &&
      !BULLET.test(lines[index]!) &&
      !HEADING.test(lines[index]!) &&
      !TABLE_ROW.test(lines[index]!) &&
      !RULE.test(lines[index]!)
    ) {
      paragraph.push(lines[index]!)
      index += 1
    }

    blocks.push(
      <p key={blocks.length} className="mb-2 text-[12.5px] leading-relaxed text-muted">
        <Inline text={paragraph.join(' ')} />
      </p>
    )
  }

  return <div className={cn('[&>*:last-child]:mb-0', className)}>{blocks}</div>
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())
}

function Table({ rows, hasHeader }: { rows: string[][]; hasHeader: boolean }): React.JSX.Element {
  const [head, ...body] = hasHeader ? rows : [null, ...rows]

  return (
    // Its own scroller, so a wide table never makes the page scroll sideways.
    <div className="mb-2.5 overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        {head && (
          <thead>
            <tr>
              {head.map((cell, index) => (
                <th
                  key={index}
                  className="border-b border-line px-2 py-1.5 text-left font-medium text-ink"
                >
                  <Inline text={cell} />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row!.map((cell, index) => (
                <td key={index} className="border-b border-line px-2 py-1.5 align-top text-muted">
                  <Inline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** `**bold**`, `*italic*`, `` `code` `` and unfilled merge fields. */
function Inline({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|\{\{[^}]+\}\})/g)

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={index} className="font-medium text-ink">
              {part.slice(2, -2)}
            </strong>
          )
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
          return (
            <code key={index} className="rounded-[4px] bg-raised px-1 py-0.5 text-[11.5px]">
              {part.slice(1, -1)}
            </code>
          )
        }
        if (FIELD.test(part)) {
          // Reset: FIELD is global, and `test` leaves `lastIndex` behind it.
          FIELD.lastIndex = 0
          return (
            <span
              key={index}
              title="This field could not be filled in from your records"
              className="rounded-[4px] bg-warning/15 px-1 text-warning"
            >
              {part}
            </span>
          )
        }
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return (
            <em key={index} className="italic">
              {part.slice(1, -1)}
            </em>
          )
        }
        return <span key={index}>{part}</span>
      })}
    </>
  )
}
