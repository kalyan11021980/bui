import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Provenance } from '@/ui/panel/Provenance'

const DOC_1 = { 'doc-1': { url: 'blob:doc', size: { width: 800, height: 500 } } }

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

  it('shows the crop when a box and an image are both available', () => {
    render(
      <Provenance
        provenance={{ source: 'ocr', confidence: 0.5, documentId: 'doc-1', box: [10, 20, 100, 60] }}
        documents={DOC_1}
      />,
    )
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('degrades to text alone when the box is absent', () => {
    render(
      <Provenance
        provenance={{ source: 'ocr', confidence: 0.5, documentId: 'doc-1' }}
        documents={DOC_1}
      />,
    )
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(/from your document/i)).toBeInTheDocument()
  })

  it('degrades to text alone when the image is gone after a reload', () => {
    render(
      <Provenance
        provenance={{ source: 'ocr', confidence: 0.5, documentId: 'doc-1', box: [10, 20, 100, 60] }}
      />,
    )
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('never draws a crop from a document other than the one it was read from', () => {
    // A second upload replaces nothing on screen. Showing the new photo under
    // "the part of your document this was read from" would attribute a value
    // to a region of a document it never came from.
    render(
      <Provenance
        provenance={{ source: 'ocr', confidence: 0.5, documentId: 'doc-1', box: [10, 20, 100, 60] }}
        documents={{ 'doc-2': { url: 'blob:other', size: { width: 3024, height: 4032 } } }}
      />,
    )
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(/from your document/i)).toBeInTheDocument()
  })

  it('draws no crop for a value that names no document at all', () => {
    // A carried or typed value has a source but no photo behind it.
    render(
      <Provenance
        provenance={{ source: 'carried', box: [10, 20, 100, 60] }}
        documents={DOC_1}
      />,
    )
    expect(screen.queryByRole('img')).toBeNull()
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
