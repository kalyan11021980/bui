import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { COLOR } from '@/ui/theme/tokens'

/**
 * tokens.ts stays canonical for TS consumers (STATUS_COLOR); globals.css
 * re-declares the palette for Tailwind. This is the drift guard.
 */
describe('theme token parity', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../src/app/globals.css'), 'utf8',
  ).toLowerCase()

  it.each(Object.entries(COLOR))('%s (%s) appears in globals.css', (_name, value) => {
    expect(css).toContain(value.toLowerCase())
  })
})
