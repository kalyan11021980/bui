import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The plan's DoD says: no file in `src/domain/` imports `ai` or `next`, or
 * performs I/O. Until now that was a claim in a document with nothing
 * checking it — and Phase 3's whole premise is that the deterministic core
 * stays deterministic when a model is bolted on beside it.
 *
 * A grep is a blunt instrument, and that is the point: it catches the import
 * on the day it is added, in the diff that adds it, rather than at the first
 * mysterious test flake six weeks later.
 */
// From the repo root: the suite runs under jsdom, where import.meta.url is an
// http URL rather than a file one.
const DOMAIN = join(process.cwd(), 'src', 'domain')

function domainFiles(dir = DOMAIN): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return domainFiles(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

const FILES = domainFiles()

/** Strips comments, so prose ABOUT a banned thing does not trip the check. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('src/domain purity (plan DoD)', () => {
  it('finds domain files to check at all', () => {
    // Guards the guard: a broken path would make every assertion below pass
    // vacuously.
    expect(FILES.length).toBeGreaterThan(10)
  })

  it('never imports an LLM package — no model calls in phase 1', () => {
    for (const file of FILES) {
      expect(code(read(file)), file)
        .not.toMatch(/from\s+['"](ai|@ai-sdk\/[^'"]+|openai|@anthropic-ai\/[^'"]+|langchain)['"]/)
    }
  })

  it('never imports next — the domain must not depend on the framework', () => {
    for (const file of FILES) {
      expect(code(read(file)), file).not.toMatch(/from\s+['"]next(\/[^'"]*)?['"]/)
    }
  })

  it('never imports the UI or server layers', () => {
    // Dependencies point inward. A domain file reaching into @/server is how
    // the in-memory store ends up inside a pure function.
    for (const file of FILES) {
      expect(code(read(file)), file).not.toMatch(/from\s+['"]@\/(ui|server|app)\//)
    }
  })

  it('performs no network or filesystem I/O', () => {
    const banned = [
      /\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/,
      /from\s+['"](node:)?(fs|fs\/promises|http|https|net|dgram|dns|child_process)['"]/,
      /\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/,
    ]
    for (const file of FILES) {
      const source = code(read(file))
      for (const pattern of banned) {
        expect(source, `${file} matches ${String(pattern)}`).not.toMatch(pattern)
      }
    }
  })

  it('reads no environment variables — secrets are injected, not looked up', () => {
    for (const file of FILES) {
      expect(code(read(file)), file).not.toMatch(/process\.env/)
    }
  })

  it('reads no clock — timestamps are passed in', () => {
    // Same profile in, same answer out. A reducer that calls Date.now() is a
    // reducer whose output cannot be reproduced from its inputs, which is the
    // whole basis of the audit trail.
    for (const file of FILES) {
      const source = code(read(file))
      expect(source, `${file} calls Date.now()`).not.toMatch(/Date\.now\s*\(/)
      expect(source, `${file} constructs a clock-reading Date`)
        .not.toMatch(/new\s+Date\s*\(\s*\)/)
      expect(source, `${file} calls performance.now()`).not.toMatch(/performance\.now\s*\(/)
    }
  })

  it('generates no randomness — the same actions must replay to the same state', () => {
    for (const file of FILES) {
      const source = code(read(file))
      expect(source, `${file} calls Math.random()`).not.toMatch(/Math\.random\s*\(/)
      expect(source, `${file} calls randomUUID()`).not.toMatch(/randomUUID\s*\(/)
    }
  })

  it('allows node:crypto, which is computation rather than I/O', () => {
    // Stated as a test so the boundary is deliberate: the digest needs a hash
    // function, and hashing touches nothing outside the process.
    const digest = read(join(DOMAIN, 'audit/digest.ts'))
    expect(digest).toMatch(/from 'node:crypto'/)
  })
})
