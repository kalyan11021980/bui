/**
 * Every fixed string the agent can cause to appear. Model output never lands
 * here — the transcript stores these ids, and the string is resolved at render
 * time so a copy revision cannot silently rewrite history.
 *
 * Bump COPY_VERSION on any edit: it is an input to the shown-copy hash, which
 * is what lets an attestation be reconstructed after a change.
 */
export const COPY_VERSION = '11'

export const ALL_COPY_IDS = [
  'opening_beat',
  'start_headline',
  'start_subline',
  'guard_fallback',
  'rationale_intro',
  'degraded_notice',
  'panel_only_notice',
  'address_still_current',
  'header_reassurance',
  'opening_upload_alternative',
  'composer_placeholder',
  'upload_hint',
  'upload_too_small',
  'upload_unopenable',
  'doc_label_drivers_license',
  'doc_label_state_id',
  'doc_label_passport',
  'doc_label_dealer_license',
  'doc_label_proof_of_residency',
  'field_confirmed',
  'completion_ready',
  'done_chip',
  'section_incomplete',
  'w9_certification',
] as const

export type VettedCopyId = (typeof ALL_COPY_IDS)[number]

export const COPY: Readonly<Record<VettedCopyId, string>> = Object.freeze({
  opening_beat: [
    "Hi — I'm your registration agent. I'll get you set up to bid at IAA.",
    "Here's how this works. I'll ask you a few things, and wherever I can I'll fill them in myself from your documents so you don't have to type. I'll always tell you why I need something.",
    'It takes about four minutes. After that, a person on our Buyer Services team checks your documents — usually within 24 hours — because state law requires a human to verify dealer licenses.',
    'Ready? The fastest start is your driver\'s license. One photo fills in about eight things.',
  ].join('\n\n'),

  start_headline: "Hi, let's get you set up to bid at IAA.",

  start_subline:
    "I'm your registration agent. I'll ask a few things and fill in what I can "
    + "from your documents. The fastest start is your driver's license.",

  guard_fallback: "Let's keep going with what's left.",

  rationale_intro: "Here's why we ask:",

  degraded_notice:
    "I can't reach my assistant right now. Nothing is lost — you can carry on filling this in directly, and every question still explains why it's asked.",

  panel_only_notice:
    "I'll step back and let you fill this in directly. Everything you've entered is saved, and each question still explains why it's asked.",

  address_still_current:
    'Is this still the address you want on file?',

  header_reassurance:
    'Checked by a person on Buyer Services — usually within 24 hours.',

  opening_upload_alternative:
    "Or just answer in chat — I'll ask for the photo when it's needed.",

  composer_placeholder: 'Message your registration agent…',

  upload_hint:
    'Lay it flat and fill the frame. We read what we can and ask you about the rest.',
  upload_too_small:
    'That photo is too small to read. Take another with the document filling the frame.',
  upload_unopenable:
    'We could not open that photo. Try another, or answer the questions below yourself.',
  doc_label_drivers_license: "Photo of your driver's license",
  doc_label_state_id: 'Photo of your state ID',
  doc_label_passport: 'Photo of your passport',
  doc_label_dealer_license: 'Photo of your dealer license',
  doc_label_proof_of_residency: 'Photo of your proof of address',

  field_confirmed: 'Answered — you can still edit it above.',

  completion_ready:
    "That's everything. Sending it for review locks your answers while a person on Buyer Services checks your documents.",

  done_chip: "Done with this section — what's next?",

  section_incomplete:
    "A few answers in this section are still blank — they're marked below.",

  w9_certification: [
    'Under penalties of perjury, I certify that:',
    '1. The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and',
    '2. I am not subject to backup withholding because: (a) I am exempt from backup withholding, or (b) I have not been notified by the Internal Revenue Service (IRS) that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding; and',
    '3. I am a U.S. citizen or other U.S. person (defined below); and',
    '4. The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.',
  ].join('\n'),
})

export function vettedCopy(id: VettedCopyId): string {
  const text = COPY[id]
  if (text === undefined) throw new Error(`Unknown vetted copy id: ${String(id)}`)
  return text
}
