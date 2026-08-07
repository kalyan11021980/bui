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
    doc.startViewTransition = vi.fn((cb: () => void) => {
      calls.push('vt')
      cb()
      return { ready: Promise.resolve(), finished: Promise.resolve() } as ViewTransition
    })
    withViewTransition(() => calls.push('update'))
    expect(calls).toEqual(['vt', 'update'])
  })

  it('swallows a rejected ready/finished from a skipped or aborted transition', async () => {
    const update = vi.fn()
    doc.startViewTransition = vi.fn((cb: () => void) => {
      cb()
      return {
        ready: Promise.reject(new DOMException('aborted', 'InvalidStateError')),
        finished: Promise.reject(new DOMException('aborted', 'InvalidStateError')),
      } as unknown as ViewTransition
    })
    withViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
    // Let the rejected promises settle. An unhandled rejection here fails the
    // whole test file — that IS the assertion, not just this line.
    await new Promise((resolve) => setTimeout(resolve, 0))
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
