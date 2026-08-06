'use client'

import { useEffect, useRef, useState } from 'react'
import { applyCarry, carryNotice, type CarryNotice } from '@/domain/application/carry'
import { applicationReducer } from '@/domain/application/reducer'
import { isComplete } from '@/domain/application/queries'
import type { Action, ApplicationState } from '@/domain/application/state'
import type { DocType } from '@/domain/field-id'
import type { RequirementKey } from '@/domain/requirements/key'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { DocumentImages } from '@/ui/panel/document-images'
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
  /** The photos this browser uploaded, for the crops. Gone after a reload. */
  documents: DocumentImages
  /** What to tell the applicant about their document, or about starting up. */
  notice: string | null
  /** The server is behind what is on screen, and the applicant should know. */
  outOfStep: boolean
  carry: CarryNotice | null
  /** Null until the application has started — see `ConversationShell`'s own prop. */
  ownerToken: string | null
  confirm: (id: RequirementKey) => void
  change: (id: RequirementKey, value: unknown) => void
  clear: (id: RequirementKey) => void
  updateProfile: (patch: Partial<ApplicantProfile>) => void
  submit: () => void
  readDocument: (docType: DocType, image: PreparedImage) => void
  /** Drops what was said about the last photo, once there is a new one. */
  forgetDocumentNotice: () => void
  /**
   * Adopts the state a completed turn returned. Unlike `dispatch`, nothing is
   * reduced locally first — a `setProfile` or `requestDocument` tool call is
   * already committed server-side by the time it arrives, so the whole state
   * is taken as given.
   */
  adoptTurnState: (state: ApplicationState) => void
  /**
   * The serialized queue every write above already runs through, exposed so
   * a caller outside this hook (the conversational shell's turn requests)
   * can order its own writes against the panel's rather than racing them.
   * `readDocument` is the reason this queue exists at all — see its own
   * comment — and a turn adopting a whole `ApplicationState` is exactly the
   * same shape of hazard.
   */
  runSerialized: (run: () => Promise<void>) => void
}

export function useApplication(): UseApplication {
  const [state, setState] = useState<ApplicationState | null>(null)
  const [docImages, setDocImages] = useState<DocumentImages>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [outOfStep, setOutOfStep] = useState(false)
  const [carry, setCarry] = useState<CarryNotice | null>(null)

  // Requests run one after another, so the server applies them in the order
  // they were made and the upload lands behind every answer that preceded it.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const enqueue = (run: () => Promise<void>) => {
    queue.current = queue.current.then(run, run).catch(() => undefined)
  }

  // The one thing that makes this browser the owner of that id. Held here
  // rather than in state, so there is a single copy of it.
  const ownerToken = useRef<string | null>(null)

  const started = useRef(false)
  useEffect(() => {
    // Strict mode runs this twice; a second application would be a second,
    // abandoned record on the server.
    if (started.current) return
    started.current = true

    enqueue(async () => {
      const result = await startApplication()
      if (!result.ok) {
        setNotice(NO_START)
        return
      }
      ownerToken.current = result.value.ownerToken
      setState({ ...result.value, ownerToken: null })
    })
  }, [])

  /**
   * Reduces locally, mirrors upward, and reports what carry did. The null
   * guard is the compiler's, not a case: the page renders no handlers until
   * there is an application.
   */
  const dispatch = (action: Action, from?: RequirementKey) => {
    if (!state) return
    const result = applyCarry(applicationReducer(state, action), action.at)
    setState(result.state)
    setCarry(from ? carryNotice(from, result.applied) : null)

    // Only the action itself goes up: the server runs the same carry rules on
    // the same state, and sending its results too would double them.
    enqueue(async () => {
      const sent = await sendAction(state.id, ownerToken.current, action)
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
    setNotice(READING)

    enqueue(async () => {
      const result = await sendDocument(
        state.id, ownerToken.current, docType, image.imageBase64,
      )
      if (!result.ok) {
        // A refusal below 500 already carries words written for a person. A
        // 5xx does not — a transport failure is one by design, so an unset
        // endpoint cannot pass for an empty read — and neither does a request
        // that never arrived. Neither is an error page: the applicant fills
        // the form in themselves, exactly as they would have.
        const refusal =
          result.status !== null && result.status < 500 ? result.message : null
        setNotice(refusal ?? NO_READER)
        return
      }
      // Filed under the server's id, not over the last photo: a value read
      // from an earlier document must keep showing that document, and the
      // pixels never leave this browser either way.
      setDocImages((held) => ({
        ...held,
        [result.value.documentId]: { url: image.imageUrl, size: image.imageSize },
      }))
      setState(result.value.state)
      setCarry(null)
      setNotice(readNotice(result.value))
    })
  }

  return {
    state, documents: docImages, notice, outOfStep, carry,
    ownerToken: ownerToken.current,
    confirm, change, clear, updateProfile, submit, readDocument,
    forgetDocumentNotice: () => setNotice(null),
    adoptTurnState: setState,
    runSerialized: enqueue,
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
