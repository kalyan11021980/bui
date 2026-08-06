import { describe, it, expect, beforeEach } from 'vitest'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { isComplete, outstandingFields } from '@/domain/application/queries'
import { applyCarry } from '@/domain/application/carry'
import { AuditLog } from '@/domain/audit/log'
import { createDigester } from '@/domain/audit/digest'
import { getApplication, putApplication, __resetStoreForTests } from '@/server/store'
import { __resetAuditLogForTests } from '@/server/audit'
import { POST as CREATE } from '@/app/api/application/route'
import { POST as ACTIONS } from '@/app/api/application/[id]/actions/route'
import { POST as TURN } from '@/app/api/application/[id]/turn/route'
import { __setModelForTurnTests } from '@/server/orchestrator/model-for-turn'
import { SECTION_ORDER } from '@/domain/orchestrator/plan'
import { OWNER_TOKEN_HEADER } from '@/server/ownership'
import { stubModel } from '../server/orchestrator/stub-model'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { Action, ApplicationState } from '@/domain/application/state'
import type { Block } from '@/domain/orchestrator/transcript'

/** The domain does not check it; the server does. */
const OWNER = 'owner-token-1'

const AT = '2026-08-01T12:00:00.000Z'
const business: ApplicantProfile = {
  applicantType: 'business', country: 'US', state: 'GA',
  wantsGsa: false, licenses: ['dealer'], addressDiffersFromId: false,
  idForm: 'drivers_license',
}
const digest = createDigester('integration-test-secret-32-chars-min!')

beforeEach(() => {
  __resetStoreForTests()
  __resetAuditLogForTests()
})

describe('a whole registration, panel only', () => {
  it('completes with no LLM and no OCR', () => {
    let s = createApplication('app-1', business, OWNER)
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

  it('empties the store when it is reset, so cases cannot leak into each other', () => {
    // Ids are UUIDs and never collide, so a reset that did nothing would leave
    // every test in the suite green. The store reads its map through the
    // global on every call precisely so this cannot quietly stop working.
    const s = createApplication('app-reset', business, OWNER)
    putApplication(s)
    expect(getApplication('app-reset')).toBeDefined()

    __resetStoreForTests()

    expect(getApplication('app-reset')).toBeUndefined()
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
    let s = createApplication('app-1', business, OWNER)
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
    const s = createApplication('app-1', business, OWNER)
    putApplication(s)
    expect(getApplication('app-1')?.id).toBe('app-1')
    expect(getApplication('nope')).toBeUndefined()
  })
})

describe('a whole registration, section by section, through the routes', () => {
  type TurnResponse = { state: ApplicationState; turn: { blocks: readonly Block[] } }

  function ctx(id: string) {
    return { params: Promise.resolve({ id }) }
  }

  function asOwner(id: string): Record<string, string> {
    const token = tokens.get(id)
    return token === undefined ? {} : { [OWNER_TOKEN_HEADER]: token }
  }

  const tokens = new Map<string, string>()

  async function newApp(): Promise<string> {
    const res = await CREATE()
    const body = (await res.json()) as ApplicationState
    if (body.ownerToken === null) throw new Error('creation handed out no owner token')
    tokens.set(body.id, body.ownerToken)
    return body.id
  }

  async function postAction(id: string, action: unknown) {
    return ACTIONS(
      new Request(`http://localhost/api/application/${id}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action }),
        headers: { 'content-type': 'application/json', ...asOwner(id) },
      }),
      ctx(id),
    )
  }

  async function postTurn(id: string, body: unknown) {
    return TURN(
      new Request(`http://localhost/api/application/${id}/turn`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...asOwner(id) },
      }),
      ctx(id),
    )
  }

  async function set(id: string, answers: ReadonlyArray<readonly [string, unknown]>) {
    for (const [fieldId, value] of answers) {
      const res = await postAction(id, {
        type: 'SET_VALUE', fieldId, value, source: 'user', at: AT,
      })
      expect(res.status, `${fieldId} should have been accepted`).toBe(200)
    }
  }

  beforeEach(() => {
    tokens.clear()
    __setModelForTurnTests(() => ({
      model: stubModel('Right, let’s get started.', []),
      effort: 'low', isAnthropic: false,
    }))
  })

  /**
   * The one section_header in a turn's blocks. A header can sit behind a
   * guard_fallback notice (identification's group includes a sensitive
   * field, which drops the model's voice), so callers must not assume index 0.
   */
  function headerOf(blocks: readonly Block[]) {
    const header = blocks.find((b) => b.kind === 'section_header')
    if (header === undefined || header.kind !== 'section_header') {
      throw new Error(`no section_header in ${JSON.stringify(blocks)}`)
    }
    return header
  }

  it('walks the registration section by section behind the Done gate', async () => {
    const id = await newApp()
    // The sections this profile actually owes, in SECTION_ORDER's own order —
    // not a hand-written list that could silently drift from it.
    const owed: ReadonlySet<string> = new Set(['profile', 'identification', 'address', 'contact'])
    const expectedOrder = SECTION_ORDER.filter((s) => owed.has(s))
    const seenOrder: string[] = []

    // 1. First turn presents the first outstanding section, and only that one.
    const first = (await (await postTurn(id, { text: 'hi' })).json()) as TurnResponse
    const headers = first.turn.blocks.filter((b) => b.kind === 'section_header')
    expect(headers).toHaveLength(1)
    expect(headerOf(first.turn.blocks).section).toBe(SECTION_ORDER[0])
    seenOrder.push(headerOf(first.turn.blocks).section)

    // Answer only one of profile's two fields, so the gap below is real.
    await set(id, [['primary_activity', 'dealer']])

    // 2. Done with a gap re-presents the same section, missing fields only.
    const gapped = (await (await postTurn(id, { doneWith: 'profile' })).json()) as TurnResponse
    expect(gapped.turn.blocks[0]).toEqual({ kind: 'notice', copyId: 'section_incomplete' })
    expect(headerOf(gapped.turn.blocks).section).toBe('profile')
    const gappedAsks = gapped.turn.blocks
      .filter((b) => b.kind === 'field_ask').map((b) => b.fieldId)
    expect(gappedAsks).toEqual(['preferred_language'])

    await set(id, [['preferred_language', 'English']])

    // 3. Done with the gap closed moves on to the next section in order.
    const toIdentification = (await (await postTurn(id, { doneWith: 'profile' })).json()) as TurnResponse
    seenOrder.push(headerOf(toIdentification.turn.blocks).section)

    await set(id, [
      ['first_name', 'Ada'], ['last_name', 'Lovelace'],
      ['dl_number', 'D1234567'], ['dl_expiry', '2030-04-30'], ['dob', '1982-08-31'],
      ['id_images', ['front.png']], ['id_country', 'USA'], ['id_state', 'GA'],
    ])
    const toAddress = (await (await postTurn(id, { doneWith: 'identification' })).json()) as TurnResponse
    seenOrder.push(headerOf(toAddress.turn.blocks).section)

    await set(id, [
      ['addr_line1', '2345 Anywhere St'], ['addr_city', 'Atlanta'],
      ['addr_state', 'GA'], ['addr_zip', '30301'],
    ])
    const toContact = (await (await postTurn(id, { doneWith: 'address' })).json()) as TurnResponse
    seenOrder.push(headerOf(toContact.turn.blocks).section)

    // The section walked so far, in the order it was presented, matches
    // SECTION_ORDER's own order end to end.
    expect(seenOrder).toEqual(expectedOrder)

    await set(id, [['phone_mobile', '4045551234']])

    // 4. The final Done has nothing left to present — no blocks, no gap.
    const final = (await (await postTurn(id, { doneWith: 'contact' })).json()) as TurnResponse
    expect(final.turn.blocks).toEqual([])
    expect(outstandingFields(final.state)).toEqual([])

    // 5. Submit, then a further Done on a closed application answers 409.
    const submitRes = await postAction(id, { type: 'SUBMIT', at: AT })
    expect(submitRes.status).toBe(200)
    const afterSubmit = await postTurn(id, { doneWith: 'contact' })
    expect(afterSubmit.status).toBe(409)
  })
})
