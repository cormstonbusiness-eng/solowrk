import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Generates the placeholder app icon.
 *
 * A script rather than a committed binary because the app has no artwork yet
 * and this needs replacing: drop a real 1024×1024 `resources/icon.png` in and
 * electron-builder derives every Windows size from it. Until then this draws
 * the mark that is already beside the wordmark in the titlebar, so the taskbar
 * shows something deliberate rather than the default Electron atom.
 *
 * Written with zlib and nothing else. A one-off placeholder is not worth a
 * native image dependency in a project that has none.
 */

const SIZE = 1024

/** Straight from the midnight theme, so the icon matches the app it opens. */
const GROUND = [0x14, 0x14, 0x18]
const ACCENT = [0x6e, 0x56, 0xcf]

/** Proportions taken from the titlebar mark: a squircle inside a squircle. */
const OUTER_RADIUS = SIZE * 0.22
const INNER = SIZE * 0.46
const INNER_RADIUS = INNER * 0.26

/**
 * Signed distance to a rounded rectangle, negative inside.
 *
 * Used rather than drawing rectangles so the edges can be antialiased from the
 * distance — a hard-edged 1024px icon looks visibly jagged once Windows scales
 * it down to 16px for the taskbar.
 */
function roundedRect(x, y, halfWidth, halfHeight, radius) {
  const dx = Math.abs(x) - (halfWidth - radius)
  const dy = Math.abs(y) - (halfHeight - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - radius
}

/** Coverage of a shape at a pixel, 0–1, smoothed across one pixel of edge. */
function coverage(distance) {
  return Math.min(1, Math.max(0, 0.5 - distance))
}

function pixels() {
  const data = Buffer.alloc(SIZE * SIZE * 4)
  const half = SIZE / 2

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Pixel centres, so the shape is symmetrical about the middle.
      const px = x + 0.5 - half
      const py = y + 0.5 - half

      const outer = coverage(roundedRect(px, py, half, half, OUTER_RADIUS))
      const inner = coverage(roundedRect(px, py, INNER / 2, INNER / 2, INNER_RADIUS))

      // The accent square is composited over the ground, and the whole thing
      // is masked by the outer squircle so the corners stay transparent.
      const offset = (y * SIZE + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        data[offset + channel] = Math.round(
          GROUND[channel] * (1 - inner) + ACCENT[channel] * inner
        )
      }
      data[offset + 3] = Math.round(outer * 255)
    }
  }

  return data
}

/* ------------------------------------------------------------------ PNG */

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, body) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)

  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))

  return Buffer.concat([length, typed, crc])
}

function png(rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(SIZE, 0)
  header.writeUInt32BE(SIZE, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  // Compression, filter and interlace methods are all 0, which Buffer.alloc
  // has already zeroed.

  // One filter byte per scanline. Filter 0 (none) throughout: the image is
  // mostly flat colour, so deflate handles it well without prediction.
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
  for (let y = 0; y < SIZE; y++) {
    const target = y * (SIZE * 4 + 1)
    raw[target] = 0
    rgba.copy(raw, target + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'resources', 'icon.png')

mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, png(pixels()))

console.log(`Wrote ${target} (${SIZE}×${SIZE})`)