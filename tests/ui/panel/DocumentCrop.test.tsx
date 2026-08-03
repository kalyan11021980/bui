import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DocumentCrop } from '@/ui/panel/DocumentCrop'

describe('DocumentCrop', () => {
  it('renders the region of the document the value came from', () => {
    render(
      <DocumentCrop
        imageUrl="blob:doc"
        box={[100, 200, 400, 260]}
        imageSize={{ width: 1600, height: 1000 }}
        alt="The part of your license this was read from"
      />,
    )
    expect(screen.getByRole('img', {
      name: 'The part of your license this was read from',
    })).toBeInTheDocument()
  })

  it('renders nothing without an image to crop', () => {
    const { container } = render(
      <DocumentCrop
        imageUrl={undefined}
        box={[100, 200, 400, 260]}
        imageSize={{ width: 1600, height: 1000 }}
        alt="x"
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a zero-width box', () => {
    // x0 === x1 alone, height still positive — pins the `width <= 0` half of
    // the guard on its own, so a narrowed `height <= 0`-only check fails.
    const { container } = render(
      <DocumentCrop
        imageUrl="blob:doc" box={[100, 200, 100, 260]}
        imageSize={{ width: 1600, height: 1000 }} alt="x"
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a zero-height box', () => {
    // y0 === y1 alone, width still positive — pins the `height <= 0` half.
    const { container } = render(
      <DocumentCrop
        imageUrl="blob:doc" box={[100, 200, 400, 200]}
        imageSize={{ width: 1600, height: 1000 }} alt="x"
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing without an image size', () => {
    // Guards the other half of the `!imageUrl || !imageSize` check — an
    // imageUrl with no size would otherwise scale against undefined.
    const { container } = render(
      <DocumentCrop
        imageUrl="blob:doc" box={[100, 200, 400, 260]}
        imageSize={undefined} alt="x"
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('clips to the box, not the whole document', () => {
    // Pins the actual crop math, not just "something rendered": a box at
    // (100,200)-(400,260) inside a 1600x1000 image must offset and scale the
    // full image behind a viewport sized to the box, not show it untouched.
    render(
      <DocumentCrop
        imageUrl="blob:doc"
        box={[100, 200, 400, 260]}
        imageSize={{ width: 1600, height: 1000 }}
        alt="crop"
      />,
    )
    const img = screen.getByRole('img', { name: 'crop' }) as HTMLElement
    const inner = img.querySelector('img')
    expect(inner).not.toBeNull()
    const style = inner!.style
    // scale = min(260/300, 3) = 0.8666..., so the full image is drawn at
    // 1600*scale wide, 1000*scale tall, offset left by -100*scale and up by
    // -200*scale. x0/y0 and width/height differ from each other on purpose,
    // so a swapped axis (x0 used for top, or width for height) shows up as a
    // wrong number rather than coincidentally matching.
    const scale = 260 / 300
    expect(Math.round(parseFloat(style.width))).toBe(Math.round(1600 * scale))
    expect(Math.round(parseFloat(style.height))).toBe(Math.round(1000 * scale))
    expect(Math.round(parseFloat(style.left))).toBe(-Math.round(100 * scale))
    expect(Math.round(parseFloat(style.top))).toBe(-Math.round(200 * scale))
  })
})
