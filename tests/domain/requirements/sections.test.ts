import { describe, it, expect } from 'vitest'
import { ALL_FIELDS, fieldDef } from '@/domain/catalog'
import { SECTION_LABEL } from '@/domain/section'
import { groupIntoSections } from '@/domain/requirements/sections'
import { requiredFields } from '@/domain/requirements/engine'
import { parseReqKey } from '@/domain/requirements/key'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const individual: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA',
  wantsGsa: false, licenses: [],
}

const twoLicences: ApplicantProfile = {
  applicantType: 'business', country: 'US', state: 'OH',
  wantsGsa: true, licenses: ['dealer', 'salvage'],
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
      'Identification', 'Address', 'Contact',
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
      expect(group.fields).toHaveLength(5)
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
