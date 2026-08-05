/**
 * Every fixed string the agent can cause to appear. Model output never lands
 * here — the transcript stores these ids, and the string is resolved at render
 * time so a copy revision cannot silently rewrite history.
 *
 * Bump COPY_VERSION on any edit: it is an input to the shown-copy hash, which
 * is what lets an attestation be reconstructed after a change.
 */
export const COPY_VERSION = '2'

export const ALL_COPY_IDS = [
  'opening_beat',
  'guard_fallback',
  'degraded_notice',
  'panel_only_notice',
  'address_still_current',
  'header_reassurance',
  'opening_upload_alternative',
  'composer_placeholder',
] as const

export type VettedCopyId = (typeof ALL_COPY_IDS)[number]

export const COPY: Readonly<Record<VettedCopyId, string>> = Object.freeze({
  opening_beat: [
    "Hi — I'm your registration agent. I'll get you set up to bid at IAA.",
    "Here's how this works. I'll ask you a few things, and wherever I can I'll fill them in myself from your documents so you don't have to type. I'll always tell you why I need something.",
    'It takes about four minutes. After that, a person on our Buyer Services team checks your documents — usually within 24 hours — because state law requires a human to verify dealer licenses.',
    'Ready? The fastest start is your driver\'s license. One photo fills in about eight things.',
  ].join('\n\n'),

  guard_fallback: "Let's keep going with what's left.",

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
})

export function vettedCopy(id: VettedCopyId): string {
  const text = COPY[id]
  if (text === undefined) throw new Error(`Unknown vetted copy id: ${String(id)}`)
  return text
}
