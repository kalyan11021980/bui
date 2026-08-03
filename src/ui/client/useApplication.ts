'use client'

import { useEffect, useRef, useState } from 'react'
import { applyCarry, carryNotice, type CarryNotice } from '@/domain/application/carry'
import { applicationReducer } from '@/domain/application/reducer'
import { isComplete } from '@/domain/application/queries'
import type { Action, ApplicationState } from '@/domain/application/state'
import type { DocType } from '@/domain/field-id'
import type { ImageSize } from '@/domain/ocr/geometry'
import type { RequirementKey } from '@/domain/requirements/key'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { PreparedImage } from '@/ui/panel/prepare-image'
import {
  sendAction, sendDocument, startApplication, type UploadOutcome,
} from './application-api'

/**
 * One application, held in the browser and mirrored to the server.
 *
 * Answers are reduced locally first so typing never waits on a round trip —
 * the panel is meant to complete a registration on its own — and the same
 * action is then sent, in order, to the application the server holds. That
 * ordering is what makes the upload response safe to adopt whole: by the time
 * it is built, the server has seen every answer already on screen.
 */

const READING = 'Reading your document…'
const NOTHING_READ =
  'We could not read anything from that photo. The questions below are still yours to answer.'
const NO_READER =
  'We could not read your document just now. Nothing is lost — answer the questions '
  + 'below and send your application as usual.'
const NO_CROPS = ' The photo is too small to show you where each answer came from.'
const NO_START =
  'We could not start your application. Reload the page to try again.'

export type UseApplication = {
  state: ApplicationState | null
  /** The photo this browser uploaded, for the crops. Gone after a reload. */
  document: { url: string; size: ImageSize } | null
  /** What to tell the applicant about their document, or about starting up. */
  notice: string | null
  /** The server is behind what is on screen, and the applicant should know. */
  outOfStep: boolean
  carry: CarryNotice | null
  confirm: (id: RequirementKey) => void
  change: (id: RequirementKey, value: unknown) => void
  clear: (id: RequirementKey) => void
  updateProfile: (patch: Partial<ApplicantProfile>) => void
  submit: () => void
  readDocument: (docType: DocType, image: PreparedImage) => void
}

export function useApplication(): UseApplication {
  const [state, setState] = useState<ApplicationState | null>(null)
  const [docImage, setDocImage] = useState<UseApplication['document']>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [outOfStep, setOutOfStep] = useState(false)
  const [carry, setCarry] = useState<CarryNotice | null>(null)

  // Requests run one after another, so the server applies them in the order
  // they were made and the upload lands behind every answer that preceded it.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const enqueue = (run: () => Promise<void>) => {
    queue.current = queue.current.then(run, run).catch(() => undefined)
  }

  const started = useRef(false)
  useEffect(() => {
    // Strict mode runs this twice; a second application would be a second,
    // abandoned record on the server.
    if (started.current) return
    started.current = true

    enqueue(async () => {
      const result = await startApplication()
      if (result.ok) setState(result.value)
      else setNotice(NO_START)
    })
  }, [])

  /** Reduces locally, mirrors upward, and reports what carry did. */
  const dispatch = (action: Action, from?: RequirementKey) => {
    if (!state) return
    const result = applyCarry(applicationReducer(state, action), action.at)
    setState(result.state)
    setCarry(from ? carryNotice(from, result.applied) : null)

    // Only the action itself goes up: the server runs the same carry rules on
    // the same state, and sending its results too would double them.
    enqueue(async () => {
      const sent = await sendAction(state.id, action)
      if (!sent.ok) setOutOfStep(true)
    })
  }

  const now = () => new Date().toISOString()

  const confirm = (id: RequirementKey) =>
    dispatch({ type: 'CONFIRM', fieldId: id, at: now(), shownCopyHash: 'catalog-v1' })

  const change = (id: RequirementKey, value: unknown) =>
    dispatch({ type: 'SET_VALUE', fieldId: id, value, source: 'user', at: now() }, id)

  const clear = (id: RequirementKey) =>
    dispatch({ type: 'CLEAR_VALUE', fieldId: id, at: now() }, id)

  const updateProfile = (patch: Partial<ApplicantProfile>) =>
    dispatch({ type: 'UPDATE_PROFILE', patch, at: now() })

  // The reducer refuses an incomplete submission by throwing; the panel says
  // what is outstanding instead of throwing at the applicant.
  const submit = () => {
    if (!state || state.submittedAt !== null || !isComplete(state)) return
    dispatch({ type: 'SUBMIT', at: now() })
  }

  const readDocument = (docType: DocType, image: PreparedImage) => {
    if (!state) return
    // Held before the call returns: the crops need it, and it never leaves
    // this browser.
    setDocImage({ url: image.imageUrl, size: image.imageSize })
    setNotice(READING)

    enqueue(async () => {
      const result = await sendDocument(state.id, docType, image.imageBase64)
      if (!result.ok) {
        // A transport failure is a 500 by design, so an unset endpoint cannot
        // pass for an empty read. It is still not an error page: the applicant
        // fills the form in themselves, exactly as they would have.
        setNotice(result.status === null || result.status >= 500
          ? NO_READER
          : result.message ?? NO_READER)
        return
      }
      setState(result.value.state)
      setCarry(null)
      setNotice(readNotice(result.value))
    })
  }

  return {
    state, document: docImage, notice, outOfStep, carry,
    confirm, change, clear, updateProfile, submit, readDocument,
  }
}

function readNotice(outcome: UploadOutcome): string {
  const count = outcome.filled.length
  if (count === 0) return NOTHING_READ

  const answers = count === 1 ? '1 answer' : `${count} answers`
  return (
    `We filled in ${answers} from your document. Check each one and mark it "Looks right".`
    + (outcome.band === 'full' ? '' : NO_CROPS)
  )
}
