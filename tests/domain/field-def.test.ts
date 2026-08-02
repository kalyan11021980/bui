import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineField } from '@/domain/field-def'
import { AUTHORITY_LABEL } from '@/domain/authority'

describe('defineField', () => {
  it('returns the definition it was given', () => {
    const f = defineField({
      id: 'first_name',
      label: 'First name',
      type: 'text',
      purpose: 'So your account matches your government ID',
      authority: 'FEDERAL_KYC',
      validation: z.string().min(1),
    })
    expect(f.id).toBe('first_name')
    expect(f.purpose).not.toBe('')
    expect(f.authority).toBe('FEDERAL_KYC')
  })

  it('rejects an empty purpose at runtime', () => {
    expect(() =>
      defineField({
        id: 'first_name',
        label: 'First name',
        type: 'text',
        purpose: '   ',
        authority: 'FEDERAL_KYC',
        validation: z.string(),
      }),
    ).toThrow(/purpose/i)
  })

  it('rejects a sensitive field that is also orchestrator-visible', () => {
    expect(() =>
      defineField({
        id: 'tax_id',
        label: 'Taxpayer ID',
        type: 'taxid',
        purpose: 'So we can pay you when your vehicle sells',
        authority: 'IRS',
        validation: z.string(),
        sensitive: true,
        // @ts-expect-error compile-time exclusivity is the primary guard
        orchestratorVisible: true,
      }),
    ).toThrow(/orchestratorVisible/)
  })

  it('has a display label for every authority', () => {
    for (const [key, label] of Object.entries(AUTHORITY_LABEL)) {
      expect(label, key).not.toBe('')
    }
  })
})
