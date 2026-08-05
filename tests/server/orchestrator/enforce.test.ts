import { describe, it, expect } from 'vitest'
import { enforceTree } from '@/domain/orchestrator/enforce'

/**
 * OpenUI validates component NAMES at parse and stops there — a free-text
 * string handed to a prop the schema types as a copy id parses with zero
 * errors and reaches the render tree intact. Everything here is about the
 * layer that closes that gap, so each case states what the model emitted
 * rather than what the parser thought of it.
 */
describe('enforceTree — the agent names things, it does not author words', () => {
  const outstanding = ['first_name', 'id_state']

  it('keeps a notice that names a real piece of vetted copy', () => {
    const out = enforceTree('root = Turn([Notice("guard_fallback")])', outstanding)
    expect(out.blocks).toEqual([{ kind: 'notice', copyId: 'guard_fallback' }])
    expect(out.rejections).toEqual([])
  })

  it('drops a notice naming a copy id that does not exist', () => {
    const out = enforceTree('root = Turn([Notice("you_must_pay_a_penalty")])', outstanding)
    expect(out.blocks).toEqual([])
    expect(out.rejections).toEqual(['prop:Notice.copyId'])
  })

  // The one that matters. Left to OpenUI alone this renders verbatim, and the
  // agent has authored a legal claim in words no one reviewed.
  it('drops free text written into the slot where a copy id belongs', () => {
    const out = enforceTree(
      'root = Turn([Notice("You are required by law to file within 30 days.")])',
      outstanding,
    )
    expect(out.blocks).toEqual([])
    expect(out.rejections).toEqual(['prop:Notice.copyId'])
  })

  it('refuses an ask for a field that is not outstanding', () => {
    const out = enforceTree('root = Turn([Ask("tax_id")])', outstanding)
    expect(out.blocks).toEqual([])
    expect(out.rejections).toEqual(['not_outstanding:tax_id'])
  })

  it('keeps an ask for a field that is outstanding', () => {
    const out = enforceTree('root = Turn([Ask("id_state")])', outstanding)
    expect(out.blocks).toEqual([{ kind: 'field_ask', fieldId: 'id_state' }])
  })

  it('drops a component that is not in the library at all', () => {
    const out = enforceTree('root = Turn([Paragraph("whatever I like")])', outstanding)
    expect(out.blocks).toEqual([])
    expect(out.rejections).toEqual(['unknown:Paragraph'])
  })

  it('keeps the good siblings of a rejected block rather than failing the turn', () => {
    const out = enforceTree(
      'root = Turn([Notice("guard_fallback"), Notice("invented_id"), Ask("first_name")])',
      outstanding,
    )
    expect(out.blocks).toEqual([
      { kind: 'notice', copyId: 'guard_fallback' },
      { kind: 'field_ask', fieldId: 'first_name' },
    ])
    expect(out.rejections).toEqual(['prop:Notice.copyId'])
  })

  it('reports nothing rendered when the model writes prose instead of calling anything', () => {
    const out = enforceTree('Sure, I can help you with that!', outstanding)
    expect(out.blocks).toEqual([])
  })
})
