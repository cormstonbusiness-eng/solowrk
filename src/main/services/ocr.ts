import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { extname } from 'node:path'
import { readReceipt, type ReceiptReading } from '@shared/receipts'

const run = promisify(execFile)

/**
 * Reading text off a receipt, using Windows' own OCR engine.
 *
 * `Windows.Media.Ocr` ships with the operating system. It is offline, it is
 * free, and nothing leaves the machine — which is the only kind of OCR this
 * app can honestly offer, having told people their work stays on their
 * computer. A cloud service would read better and would make that a lie.
 *
 * It is reached through PowerShell rather than a native binding on purpose:
 * SoloWrk has no compiled dependencies, so `npm install` works on any machine
 * and the installer carries no ABI-specific binaries. WinRT is available to
 * PowerShell for the asking, and the cost is one short-lived process per
 * receipt — which is nothing against how often somebody photographs one.
 */

/** A receipt that takes longer than this is one nobody is waiting for. */
const TIMEOUT_MS = 20_000

/** What the OCR engine will open. Anything else is not worth starting for. */
const READABLE = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.gif'])

export interface OcrResult {
  /** Everything the engine read, for the "show me what it saw" case. */
  text: string
  reading: ReceiptReading
  /** Set when nothing could be read. Never thrown at the UI. */
  error: string | null
}

/**
 * The script, kept as one string so nothing is interpolated into it.
 *
 * The path arrives as an argument rather than being pasted into the source —
 * a filename with a quote in it would otherwise end the string and run
 * whatever came after, and users name files whatever they like.
 */
const SCRIPT = `
param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
  })[0]

  function Await($op, $type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
  }

  [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
  [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType=WindowsRuntime] | Out-Null

  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) { Write-Error 'No OCR language is installed'; exit 1 }

  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  foreach ($line in $result.Lines) { $line.Text }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`

/**
 * Read a receipt image.
 *
 * Never throws. A receipt that cannot be read is a form somebody fills in by
 * hand, which is exactly what they were doing before — so a failure here costs
 * a convenience, not the expense.
 */
export async function readReceiptImage(path: string): Promise<OcrResult> {
  const empty = readReceipt('')

  if (!READABLE.has(extname(path).toLowerCase())) {
    return { text: '', reading: empty, error: 'That file is not an image OCR can read.' }
  }

  if (process.platform !== 'win32') {
    return { text: '', reading: empty, error: 'Receipt reading needs Windows.' }
  }

  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT, '-Path', path],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
    )

    const text = stdout.trim()
    if (text === '') {
      return { text: '', reading: empty, error: 'Nothing legible on that image.' }
    }
    return { text, reading: readReceipt(text), error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      text: '',
      reading: empty,
      // Said in a sentence rather than as a PowerShell stack, because the only
      // useful response to any of these is to type the figures in.
      error: /timed out|ETIMEDOUT/i.test(message)
        ? 'That image took too long to read.'
        : 'That image could not be read. Type the details in instead.'
    }
  }
}
