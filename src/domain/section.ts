/**
 * Where a field lives on screen.
 *
 * Required on every `FieldDef`, for the same reason `purpose` and `authority`
 * are: a field with no home is a field someone forgot to place. Twenty-five
 * rows in one undifferentiated column is what made carry invisible — the
 * business address it filled in sat ~600px below the fold — and it is also
 * less than the IAA screens being replaced, which were at least chunked into
 * Identification, Address and License Information.
 *
 * The panel derives its headings from these rather than from a list of its
 * own, so adding a field to the catalog places it without a second edit and
 * without the two lists drifting apart.
 *
 * `state_forms` is not in the original seven. It exists because
 * `oh_foreign_buyer_form` genuinely belongs to none of them — it is not
 * identification, not a licence and not a tax document — and filing it under
 * a section that misdescribes it, on a surface a compliance reviewer reads,
 * is worse than admitting the eighth section.
 */
export type Section =
  | 'identification'
  | 'address'
  | 'contact'
  | 'business'
  | 'license'
  | 'tax'
  | 'gsa'
  | 'state_forms'

/**
 * The heading the applicant reads. Sentence case, because these are headings
 * in a page and not shouted labels; the row labels above each input already
 * carry the uppercase treatment.
 */
export const SECTION_LABEL: Record<Section, string> = {
  identification: 'Identification',
  address: 'Address',
  contact: 'Contact',
  business: 'Business',
  license: 'License',
  tax: 'Tax',
  gsa: 'GSA',
  state_forms: 'State requirements',
}
