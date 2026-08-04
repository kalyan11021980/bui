import { describe, it, expect } from 'vitest'
import { buildToolSet, activeToolsFor } from '@/server/orchestrator/tool-set'
import { ALL_TOOL_NAMES } from '@/domain/orchestrator/tools'
import type { OrchestratorView } from '@/domain/orchestrator/view'

const view = (over: Partial<OrchestratorView> = {}): OrchestratorView => ({
  applicationId: 'app-1',
  profile: {
    applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
    licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
  },
  outstanding: [{ id: 'first_name', label: 'First name', status: 'empty', sensitive: false }],
  settled: [],
  documentsOutstanding: ['drivers_license'],
  submitted: false,
  rulesVersion: 1,
  ...over,
})

describe('buildToolSet', () => {
  it('exposes every declared tool', () => {
    expect(Object.keys(buildToolSet()).sort()).toEqual([...ALL_TOOL_NAMES].sort())
  })

  it('gives no tool an execute function — the guard decides, not the SDK', () => {
    // `in` rather than a cast: the property must be absent, not merely
    // undefined, and this asserts that without an `as`.
    for (const [name, tool] of Object.entries(buildToolSet())) {
      expect('execute' in tool, name).toBe(false)
    }
  })
})

describe('activeToolsFor', () => {
  // Each condition is asserted in BOTH directions. A negative-only test
  // passes just as happily when the condition is deleted outright, which is
  // the failure mode this codebase keeps hitting.

  it('offers orient only on a resume', () => {
    expect(activeToolsFor(view(), false)).not.toContain('orient')
    expect(activeToolsFor(view(), true)).toContain('orient')
  })

  it('offers requestDocument when a document is owed, and not otherwise', () => {
    expect(activeToolsFor(view(), false)).toContain('requestDocument')
    expect(activeToolsFor(view({ documentsOutstanding: [] }), false))
      .not.toContain('requestDocument')
  })

  it('offers askFor when something is outstanding, and not otherwise', () => {
    expect(activeToolsFor(view(), false)).toContain('askFor')
    expect(activeToolsFor(view({ outstanding: [] }), false)).not.toContain('askFor')
  })

  it('always offers explain and setProfile before submission', () => {
    const bare = activeToolsFor(view({ outstanding: [], documentsOutstanding: [] }), false)
    expect(bare).toContain('explain')
    expect(bare).toContain('setProfile')
  })
})
