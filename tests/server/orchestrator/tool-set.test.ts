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
    for (const [name, tool] of Object.entries(buildToolSet())) {
      expect((tool as { execute?: unknown }).execute, name).toBeUndefined()
    }
  })
})

describe('activeToolsFor', () => {
  it('offers orient only on a resume', () => {
    expect(activeToolsFor(view(), false)).not.toContain('orient')
    expect(activeToolsFor(view(), true)).toContain('orient')
  })

  it('withholds requestDocument when nothing is owed', () => {
    expect(activeToolsFor(view({ documentsOutstanding: [] }), false))
      .not.toContain('requestDocument')
  })

  it('withholds askFor when nothing is outstanding', () => {
    expect(activeToolsFor(view({ outstanding: [] }), false)).not.toContain('askFor')
  })

  it('always offers explain before submission', () => {
    expect(activeToolsFor(view({ outstanding: [] }), false)).toContain('explain')
  })
})
