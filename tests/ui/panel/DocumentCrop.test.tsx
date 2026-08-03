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

  it('renders nothing for a zero-area box', () => {
    const { container } = render(
      <DocumentCrop
        imageUrl="blob:doc" box={[100, 200, 100, 200]}
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
    // 1600*scale wide and offset left by -100*scale.
    expect(Math.round(parseFloat(style.width))).toBe(Math.round(1600 * (260 / 300)))
    expect(Math.round(parseFloat(style.left))).toBe(-Math.round(100 * (260 / 300)))
  })
})
