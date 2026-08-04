import { describe, it, expect } from 'vitest'
import { ALL_TOOL_NAMES, TOOL_SCHEMAS, TOOL_DESCRIPTIONS } from '@/domain/orchestrator/tools'

describe('tool schemas', () => {
  it('declares exactly the five tools the design allows', () => {
    expect([...ALL_TOOL_NAMES].sort()).toEqual(
      ['askFor', 'explain', 'orient', 'requestDocument', 'setProfile'],
    )
  })

  it('gives every tool a schema and a description', () => {
    for (const name of ALL_TOOL_NAMES) {
      expect(TOOL_SCHEMAS[name], name).toBeDefined()
      expect(TOOL_DESCRIPTIONS[name].trim(), name).not.toBe('')
    }
  })

  it('caps askFor at four fields and requires at least one', () => {
    expect(TOOL_SCHEMAS.askFor.safeParse({ fieldIds: [] }).success).toBe(false)
    expect(TOOL_SCHEMAS.askFor.safeParse({ fieldIds: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false)
    expect(TOOL_SCHEMAS.askFor.safeParse({ fieldIds: ['a'] }).success).toBe(true)
  })

  it("routes setProfile through the panel's own profilePatch schema", () => {
    expect(TOOL_SCHEMAS.setProfile.safeParse({ patch: { state: 'GA' } }).success).toBe(true)
    expect(TOOL_SCHEMAS.setProfile.safeParse({ patch: { nonsense: 1 } }).success).toBe(false)
  })

  it('restricts requestDocument to declared document types', () => {
    expect(TOOL_SCHEMAS.requestDocument.safeParse({ docType: 'passport' }).success).toBe(true)
    expect(TOOL_SCHEMAS.requestDocument.safeParse({ docType: 'birth_certificate' }).success).toBe(false)
  })

  it('has no tool for setting a value, confirming, or submitting', () => {
    const forbidden = ['setValue', 'confirm', 'submit', 'verify', 'reject']
    for (const name of forbidden) expect(ALL_TOOL_NAMES).not.toContain(name)
  })
})
