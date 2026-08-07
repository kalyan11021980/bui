import { describe, it, expect, vi, afterEach } from 'vitest'
import { withViewTransition } from '@/ui/chat/dock-transition'

type VTDocument = Document & { startViewTransition?: (cb: () => void) => ViewTransition }
const doc = document as VTDocument

afterEach(() => {
  delete (doc as any).startViewTransition
  vi.restoreAllMocks()
})

describe('withViewTransition', () => {
  it('runs the update directly when the platform has no view transitions', () => {
    // jsdom has no startViewTransition — this IS the fallback path.
    const update = vi.fn()
    withViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('routes the update through startViewTransition when it exists', () => {
    const calls: string[] = []
    doc.startViewTransition = vi.fn((cb: () => void) => { calls.push('vt'); cb(); return {} as ViewTransition })
    withViewTransition(() => calls.push('update'))
    expect(calls).toEqual(['vt', 'update'])
  })

  it('skips the animation under reduced motion, but still updates', () => {
    doc.startViewTransition = vi.fn()
    vi.spyOn(window, 'matchMedia').mockReturnValue(
      { matches: true } as MediaQueryList,
    )
    const update = vi.fn()
    withViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
    expect(doc.startViewTransition).not.toHaveBeenCalled()
  })
})
