import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Provenance } from '@/ui/panel/Provenance'

describe('Provenance', () => {
  it('says a value was read and invites a check', () => {
    render(<Provenance provenance={{ source: 'ocr', confidence: 0.95 }} />)
    expect(screen.getByText(/from your document/i)).toBeInTheDocument()
  })

  it('says plainly when a reading was unsure', () => {
    render(<Provenance provenance={{ source: 'ocr', confidence: 0.4 }} />)
    // Never a threshold or a percentage: "the photo was hard to read", not
    // OCR_CONFIDENCE_BELOW_THRESHOLD.
    expect(screen.getByText(/hard to read/i)).toBeInTheDocument()
    expect(screen.queryByText(/0\.4|40%|threshold/i)).toBeNull()
  })

  it('still describes a carried value as a guess to check', () => {
    render(<Provenance provenance={{ source: 'carried', fromFieldId: 'addr_line1' }} />)
    expect(screen.getByText(/check it belongs here/i)).toBeInTheDocument()
  })

  it('stays quiet at high confidence, right at the threshold boundary', () => {
    // QUIET_THRESHOLD is 0.8; confidence === threshold must NOT read as
    // unsure (the comparison is strictly `<`, pinned here so a `<=` typo
    // that flips a genuinely confident read to "hard to read" is caught).
    render(<Provenance provenance={{ source: 'ocr', confidence: 0.8 }} />)
    expect(screen.queryByText(/hard to read/i)).toBeNull()
  })

  it('does not call a value hard to read when there is no confidence at all', () => {
    // A missing confidence (e.g. a non-OCR source, or an extractor that
    // never scored it) must not default to "unsure".
    render(<Provenance provenance={{ source: 'ocr' }} />)
    expect(screen.queryByText(/hard to read/i)).toBeNull()
  })
})