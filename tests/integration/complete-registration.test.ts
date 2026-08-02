import { describe, it, expect, beforeEach } from 'vitest'
import {
  applicationReducer, createApplication, isComplete, outstandingFields,
} from '@/domain/application/reducer'
import { applyCarry } from '@/domain/application/carry'
import { AuditLog } from '@/domain/audit/log'
import { createDigester } from '@/domain/audit/digest'
import { getApplication, putApplication, __resetStoreForTests } from '@/server/store'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { Action } from '@/domain/application/state'

const AT = '2026-08-01T12:00:00.000Z'
const business: ApplicantProfile = {
  applicantType: 'business', country: 'US', state: 'GA',
  wantsGsa: false, licenses: ['dealer'],
}
const digest = createDigester('integration-test-secret-32-chars-min!')

beforeEach(() => __resetStoreForTests())

describe('a whole registration, panel only', () => {
  it('completes with no LLM and no OCR', () => {
    let s = createApplication('app-1', business)
    const log = new AuditLog(digest)

    for (const id of outstandingFields(s)) {
      const action: Action = {
        type: 'SET_VALUE', fieldId: id, value: 'x', source: 'user', at: AT,
      }
      s = applicationReducer(s, action)
      log.append(s.id, action)
    }

    expect(isComplete(s)).toBe(true)
    expect(log.size()).toBeGreaterThan(0)
  })

  it('never writes a raw taxpayer ID into the audit log', () => {
    const log = new AuditLog(digest)
    log.append('app-1', {
      type: 'SET_VALUE', fieldId: 'tax_id', value: '12-3456789',
      source: 'user', at: AT,
    })
    expect(JSON.stringify(log.entries())).not.toContain('12-3456789')
  })

  it('saves the applicant from typing their address twice', () => {
    let s = createApplication('app-1', business)
    for (const [id, v] of [
      ['addr_line1', '2345 Anywhere St'],
      ['addr_city', 'Atlanta'],
      ['addr_state', 'GA'],
      ['addr_zip', '30301'],
    ] as const) {
      s = applicationReducer(s, {
        type: 'SET_VALUE', fieldId: id, value: v, source: 'user', at: AT,
      })
    }
    expect(s.fields.biz_addr_line1).toBeUndefined()

    s = applyCarry(s, AT).state

    // The business address is now populated without the user typing it again,
    // but still needs confirmation — carrying saves typing, not attention.
    expect(s.fields.biz_addr_line1?.value).toBe('2345 Anywhere St')
    expect(s.fields.biz_addr_city?.value).toBe('Atlanta')
    expect(s.fields.biz_addr_zip?.value).toBe('30301')
    expect(s.fields.biz_addr_line1?.status).toBe('derived')
    expect(outstandingFields(s)).toContain('biz_addr_line1')
  })

  it('round-trips through the store', () => {
    const s = createApplication('app-1', business)
    putApplication(s)
    expect(getApplication('app-1')?.id).toBe('app-1')
    expect(getApplication('nope')).toBeUndefined()
  })
})
