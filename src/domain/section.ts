/**
 * Where a field lives on screen. The panel derives its headings from these
 * rather than from a list of its own, so adding a field to the catalog places
 * it without a second edit.
 */
export type Section =
  | 'profile'
  | 'identification'
  | 'address'
  | 'contact'
  | 'business'
  | 'license'
  | 'tax'
  | 'gsa'
  | 'state_forms'

export const SECTION_LABEL: Record<Section, string> = {
  profile: 'About you',
  identification: 'Identification',
  address: 'Address',
  contact: 'Contact',
  business: 'Business',
  license: 'License',
  tax: 'Tax',
  gsa: 'GSA',
  state_forms: 'State requirements',
}
