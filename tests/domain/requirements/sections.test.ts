import { describe, it, expect } from 'vitest'
import { ALL_FIELDS, fieldDef } from '@/domain/catalog'
import { SECTION_LABEL } from '@/domain/section'
import { groupIntoSections } from '@/domain/requirements/sections'
import { requiredFields } from '@/domain/requirements/engine'
import { parseReqKey } from '@/domain/requirements/key'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const individual: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license',
}

const twoLicences: ApplicantProfile = {
  applicantType: 'business', country: 'US', state: 'OH',
  wantsGsa: true, licenses: ['dealer', 'salvage'], addressDiffersFromId: false,
  idForm: 'drivers_license',
}

describe('field sections', () => {
  it('gives every catalog field a home', () => {
    // A field with no section is a field someone forgot to place: it would
    // either vanish from the panel or land in a nameless bucket. The type
    // makes this unforgettable; this asserts the label map keeps up with it.
    for (const f of ALL_FIELDS) {
      expect(f.section, f.id).toBeTruthy()
      expect(SECTION_LABEL[f.section], f.id).toBeTruthy()
    }
  })

  it('groups required keys in the order the requirements engine emits them', () => {
    const keys = requiredFields(individual)
    const groups = groupIntoSections(keys)

    expect(groups.map((g) => g.label)).toEqual([
      'About you', 'Identification', 'Address', 'Contact',
    ])
    // Flattening the groups must reproduce the engine's list exactly — same
    // keys, same order. Anything else means the panel is showing a different
    // application from the one being validated.
    expect(groups.flatMap((g) => g.fields)).toEqual(keys)
  })

  it('loses nothing and duplicates nothing, however complicated the profile', () => {
    const keys = requiredFields(twoLicences)
    const groups = groupIntoSections(keys)
    const flat = groups.flatMap((g) => g.fields)
    expect(flat).toEqual(keys)
    expect(new Set(flat).size).toBe(keys.length)
  })

  it('reads two licences as two numbered sections, not ten loose rows', () => {
    const groups = groupIntoSections(requiredFields(twoLicences))
    const licence = groups.filter((g) => g.label.startsWith('License'))

    expect(licence.map((g) => g.label)).toEqual(['License 1', 'License 2'])
    expect(licence[0]?.id).not.toBe(licence[1]?.id)
    for (const [index, group] of licence.entries()) {
      expect(group.fields).toHaveLength(6)
      for (const key of group.fields) {
        expect(parseReqKey(key).instance).toBe(index)
      }
    }
  })

  it('does not number a section that has only one instance to speak of', () => {
    // Only repeated (licence) groups are numbered. "Address 1" would be a lie
    // about there being an Address 2.
    const labels = groupIntoSections(requiredFields(individual)).map((g) => g.label)
    for (const label of labels) expect(label).not.toMatch(/\d/)
  })

  it('puts each field under the section its own catalog entry names', () => {
    const groups = groupIntoSections(requiredFields(twoLicences))
    for (const group of groups) {
      for (const key of group.fields) {
        const def = fieldDef(parseReqKey(key).fieldId)
        expect(group.label, key).toBe(
          group.id.includes('#')
            ? `${SECTION_LABEL[def.section]} ${parseReqKey(key).instance! + 1}`
            : SECTION_LABEL[def.section],
        )
      }
    }
  })

  it('keeps the state-specific form out of the sections it does not belong to', () => {
    // Ohio's out-of-state buyer form is not identification, not a licence and
    // not a tax document. Filing it under one of those to avoid adding a
    // section would misdescribe it on a compliance surface.
    const groups = groupIntoSections(requiredFields(twoLicences))
    const home = groups.find((g) => g.fields.includes('oh_foreign_buyer_form'))
    expect(home?.label).toBe('State requirements')
  })
})

/**
 * Every profile the engine can be given. `proof_of_residency` sat in the
 * identification section but was pushed on after address and contact, so the
 * panel rendered it among the identity rows while the validated list had it
 * last. Nothing caught it because both round-trip tests above happen to use
 * profiles where the condition is off — an invariant asserted only where it
 * cannot fail.
 */
function everyProfile(): ApplicantProfile[] {
  const out: ApplicantProfile[] = []
  for (const applicantType of ['individual', 'business'] as const) {
    for (const wantsGsa of [false, true]) {
      for (const state of [null, 'GA', 'OH', 'ZZ']) {
        for (const licenses of [[], ['dealer'], ['dealer', 'salvage']] as const) {
          for (const idForm of ['drivers_license', 'state_id', 'passport'] as const) {
            for (const addressDiffersFromId of [false, true]) {
              out.push({
                applicantType, country: 'US', state, wantsGsa, licenses,
                idForm, addressDiffersFromId,
              })
            }
          }
        }
      }
    }
  }
  return out
}

/** Names the profile in a failure message, so a sweep failure is actionable. */
const describeProfile = (p: ApplicantProfile) =>
  `${p.applicantType}/${p.idForm}/state=${p.state}/gsa=${p.wantsGsa}`
  + `/licences=${p.licenses.length}/addressDiffers=${p.addressDiffersFromId}`

describe('the panel and the engine agree, for every profile', () => {
  it('sweeps a corpus of profiles rather than a convenient few', () => {
    // Guards every loop below: a sweep that built nothing would pass them all.
    const profiles = everyProfile()
    expect(profiles).toHaveLength(288)
    expect(new Set(profiles.map(describeProfile)).size).toBe(profiles.length)
  })

  it('emits every section as one unbroken run', () => {
    for (const profile of everyProfile()) {
      const sections = requiredFields(profile).map((key) => {
        const { fieldId, instance } = parseReqKey(key)
        const section = fieldDef(fieldId).section
        return instance === null ? section : `${section}#${instance}`
      })
      const runs = sections.filter((s, i) => s !== sections[i - 1])
      expect(new Set(runs).size, describeProfile(profile)).toBe(runs.length)
    }
  })

  it('flattens back to the engine list exactly, in the same order', () => {
    // The claim the panel rests on: what is shown is what is validated.
    for (const profile of everyProfile()) {
      const keys = requiredFields(profile)
      const flat = groupIntoSections(keys).flatMap((g) => g.fields)
      expect(flat, describeProfile(profile)).toEqual(keys)
    }
  })

  it('reaches the conditional fields, so the sweep is worth running', () => {
    // Guards the two above: a corpus that never turned a condition on would
    // pass them while testing nothing that was ever broken.
    const seen = new Set(everyProfile().flatMap((p) => requiredFields(p)))
    for (const key of [
      'proof_of_residency', 'tax_id', 'gsa_bidder_number',
      'oh_foreign_buyer_form', 'license_number#1',
      'dl_number', 'id_number', 'passport_number',
    ]) {
      expect(seen.has(key), `no profile in the sweep asks for ${key}`).toBe(true)
    }
  })
})
