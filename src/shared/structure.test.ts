import { describe, expect, it } from 'vitest'
import { checkStructure, previewRename, safeName } from './structure'

/**
 * Folder structure, and bulk rename.
 *
 * Both of these change files on disk, so the tests are mostly about what the
 * app must *not* do: never call the user's own folder a fault it can fix,
 * never rename two files onto each other, never drop an extension.
 */

const TEMPLATE = ['00-Admin', '01-Brief', '02-Assets', '03-Working', '04-Deliverables']

describe('checking a structure', () => {
  it('is happy when everything is there', () => {
    const report = checkStructure(TEMPLATE, TEMPLATE)

    expect(report.healthy).toBe(true)
    expect(report.missing).toEqual([])
    expect(report.score).toBe(100)
  })

  it('names what is missing', () => {
    const report = checkStructure(TEMPLATE, ['00-Admin', '01-Brief'])

    expect(report.missing).toEqual(['02-Assets', '03-Working', '04-Deliverables'])
    expect(report.healthy).toBe(false)
    expect(report.score).toBe(40)
  })

  it('reports an extra folder without calling the project broken', () => {
    // A `05-Client-Supplied` somebody added on purpose is not a fault.
    const report = checkStructure(TEMPLATE, [...TEMPLATE, '05-Client-Supplied'])

    expect(report.unexpected).toEqual(['05-Client-Supplied'])
    expect(report.healthy).toBe(true)
  })

  it('does not report the same folder as missing and extra at once', () => {
    // Windows paths are case-insensitive, so these are one folder.
    const report = checkStructure(['02-Assets'], ['02-assets'])

    expect(report.missing).toEqual([])
    expect(report.unexpected).toEqual([])
  })

  it('ignores the app s own folders', () => {
    // `_notes` is made by the notes module whether a template mentions it or
    // not, and flagging our own bookkeeping trains people to ignore the report.
    const report = checkStructure(TEMPLATE, [...TEMPLATE, '_notes', '.solowrk'])
    expect(report.unexpected).toEqual([])
  })

  it('ignores hidden folders', () => {
    const report = checkStructure(TEMPLATE, [...TEMPLATE, '.git', '.DS_Store'])
    expect(report.unexpected).toEqual([])
  })

  it('does not list the work inside a folder the template asked for', () => {
    // A template names `02-Assets`; everything under it is whatever the job
    // needed, and listing all of it would bury the one genuine finding.
    const report = checkStructure(TEMPLATE, [
      ...TEMPLATE,
      '02-Assets/Textures',
      '02-Assets/Textures/4k',
      '99-Rogue'
    ])

    expect(report.unexpected).toEqual(['99-Rogue'])
  })

  it('checks a nested folder the template did ask for', () => {
    const report = checkStructure(['02-Assets', '02-Assets/Textures'], ['02-Assets'])
    expect(report.missing).toEqual(['02-Assets/Textures'])
  })

  it('takes backslashes as separators, since that is what Windows gives', () => {
    const report = checkStructure(['02-Assets/Textures'], ['02-Assets\\Textures'])
    expect(report.missing).toEqual([])
  })

  it('is healthy against a template that asks for nothing', () => {
    const report = checkStructure([], ['anything'])
    expect(report.score).toBe(100)
    expect(report.healthy).toBe(true)
  })
})

describe('safe names', () => {
  it('strips what Windows will not accept', () => {
    expect(safeName('Ash: field/House?')).toBe('Ash fieldHouse')
  })

  it('leaves spaces and hyphens alone, because they are legal', () => {
    // Stripping them would be the app being opinionated about somebody s
    // naming rather than keeping their files openable.
    expect(safeName('Northgate Studio - Phase 2')).toBe('Northgate Studio - Phase 2')
  })

  it('strips a trailing dot, which is legal to write and impossible to delete', () => {
    expect(safeName('Report.')).toBe('Report')
    expect(safeName('Report ')).toBe('Report')
  })
})

describe('previewing a bulk rename', () => {
  const files = [{ name: 'render_final.exr' }, { name: 'render_final2.exr' }]

  it('fills the tokens and numbers the set', () => {
    const preview = previewRename(files, '{client}_{project}_{ref}', {
      client: 'Northgate',
      project: 'Ashfield'
    })

    expect(preview[0]!.to).toBe('Northgate_Ashfield_001.exr')
    expect(preview[1]!.to).toBe('Northgate_Ashfield_002.exr')
  })

  it('keeps the extension even when the pattern never mentions it', () => {
    // A rename that silently drops `.exr` produces a file Windows cannot open.
    const preview = previewRename(files, '{name}', {})
    expect(preview[0]!.to).toBe('render_final.exr')
  })

  it('does not double the extension when the pattern asks for it', () => {
    const preview = previewRename(files, '{name}.{ext}', {})
    expect(preview[0]!.to).toBe('render_final.exr')
  })

  it('refuses a token that does not exist', () => {
    const preview = previewRename(files, '{clint}_{ref}', {})
    expect(preview[0]!.problem).toContain('no {clint} token')
    // Left standing rather than blanked, so the mistake is visible.
    expect(preview[0]!.to).toContain('{clint}')
  })

  it('refuses a token with nothing behind it', () => {
    // A filename with a gap where the client should be is one nobody notices.
    const preview = previewRename(files, '{client}_{ref}', {})
    expect(preview[0]!.problem).toContain('{client} has no value')
  })

  it('catches two files that would land on the same name', () => {
    // Found here, where it is a warning. On disk it is a lost file.
    const preview = previewRename(files, 'render', {})

    expect(preview[0]!.problem).toBeNull()
    expect(preview[1]!.problem).toContain('Two files would end up with this name')
  })

  it('catches a pattern that leaves nothing behind', () => {
    const preview = previewRename([{ name: 'x' }], '///', {})
    expect(preview[0]!.problem).toContain('empty name')
  })

  it('strips illegal characters out of the values it substitutes', () => {
    const preview = previewRename(files, '{client}_{ref}', { client: 'North/gate: Ltd' })
    expect(preview[0]!.to).toBe('Northgate Ltd_001.exr')
  })

  it('handles a file with no extension at all', () => {
    const preview = previewRename([{ name: 'README' }], '{name}_{ref}', {})
    expect(preview[0]!.to).toBe('README_001')
  })

  it('leaves a dotfile s name alone rather than treating it as an extension', () => {
    const preview = previewRename([{ name: '.gitignore' }], '{name}', {})
    expect(preview[0]!.to).toBe('.gitignore')
  })
})
