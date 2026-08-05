'use client'

import type { ApplicationState } from '@/domain/application/state'
import { fieldDef } from '@/domain/catalog'
import type { DocType } from '@/domain/field-id'
import { vettedCopy } from '@/domain/orchestrator/copy'
import type { Block } from '@/domain/orchestrator/transcript'
import { parseReqKey, type RequirementKey } from '@/domain/requirements/key'
import { DocumentUpload } from '@/ui/panel/DocumentUpload'
import { fieldInputId } from '@/ui/panel/FieldControl'
import { FieldInput } from '@/ui/panel/FieldInput'
import { displayLabel } from '@/ui/panel/label'
import type { PreparedImage } from '@/ui/panel/prepare-image'
import { Rationale } from '@/ui/panel/Rationale'
import { COLOR } from '@/ui/theme/tokens'

/**
 * What every block needs to reach the panel's own write path. `onChange` and
 * `onClear` are the same functions the panel itself uses — a keystroke here
 * ends up exactly where a keystroke in the panel does, never in a turn
 * request. `FieldInput` is reused rather than rebuilt for that reason: it
 * already is the validated, draft-gated path from a keystroke to `onChange`,
 * and a second copy of that logic is a second place it can drift from the
 * panel's (see guard.ts's own note on `setProfile` for a case where that
 * already happened once).
 */
export type BlockHandlers = {
  onChange: (id: RequirementKey, value: unknown) => void
  onClear: (id: RequirementKey) => void
  /** Flips status to `confirmed` without touching provenance — see the
   *  still-current question in the `field_ask` case, which must be able to
   *  record "the applicant confirmed this" without erasing "this was OCR". */
  onConfirm: (id: RequirementKey) => void
  onReadDocument: (docType: DocType, image: PreparedImage) => void
}

type Props = BlockHandlers & {
  block: Block
  state: ApplicationState
  /** The turn this block belongs to — see `chatScope`. */
  seq: number
}

/**
 * The guard only permits a `field_ask`/`document_request` for a field or
 * document the panel is still showing too, so every id this file mints must
 * be namespaced apart from the panel's own — otherwise two elements share
 * one id, `<label for>` resolves to whichever is first in document order,
 * and the chat's label ends up labelling the panel's box.
 *
 * `seq` is folded in too: `useConversation` never prunes history, and the
 * same outstanding field can be re-asked turn after turn (see
 * orchestrator/service.ts's fallback), so scope-by-field-alone still
 * collides with itself once a second turn asks the same thing.
 */
function chatScope(seq: number): string {
  return `chat-${seq}`
}

const noticeStyle: React.CSSProperties = {
  margin: '6px 0', fontSize: 14, color: COLOR.textPrimary,
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, letterSpacing: '.04em', fontWeight: 700,
  textTransform: 'uppercase', color: COLOR.textPrimary, marginBottom: 2,
}

// Deliberately identical for both buttons: an automation-bias guard that
// gave one option more visual weight than the other would just be nudging
// the applicant toward whichever one that was.
const stillCurrentOptionStyle: React.CSSProperties = {
  background: COLOR.surface, color: COLOR.primary,
  border: `1px solid ${COLOR.primary}`, padding: '6px 12px', cursor: 'pointer',
}

/**
 * The only place a Block turns into pixels. A discriminated, exhaustive
 * switch over `Block['kind']` — every case delegates to an existing panel
 * component rather than a new input, because a second input path is a
 * second place a value could go.
 */
export function BlockView({ block, state, seq, onChange, onClear, onConfirm, onReadDocument }: Props) {
  const scope = chatScope(seq)
  switch (block.kind) {
    case 'field_ask': {
      const { fieldId } = block
      const def = fieldDef(parseReqKey(fieldId).fieldId)
      const rationaleId = `${scope}-rationale-${fieldId}`
      const label = displayLabel(fieldId)
      const fieldState = state.fields[fieldId]
      // §10.4: an OCR-derived address is asked about, never presented as
      // settled fact — regardless of how confident the read was.
      const askIfStillCurrent = def.section === 'address' && fieldState?.provenance?.source === 'ocr'
      // Any other derived value still needs eyes, and the panel's "Looks
      // right" lives behind ?debug now — without this the chat has no way to
      // settle an OCR read, and the field stays outstanding forever.
      const askToConfirm = !askIfStillCurrent && fieldState?.status === 'derived'
      // The other half of "Looks right": once pressed (or once verified) the
      // button vanishing is not feedback — the card says so instead.
      const answered = fieldState?.status === 'confirmed' || fieldState?.status === 'verified'
      return (
        // Mirrors FieldRow's own group/aria-describedby pairing, so the
        // rationale's id is not merely passed to Rationale but actually
        // referenced by something.
        <div
          role="group"
          aria-label={label}
          aria-describedby={rationaleId}
          className="rounded-xl border border-divider bg-surface p-4 shadow-card"
          style={{ margin: '10px 0' }}
        >
          <label htmlFor={fieldInputId(fieldId, scope)} style={labelStyle}>
            {label}
          </label>
          {askIfStillCurrent && (
            <div style={{ margin: '4px 0 8px' }}>
              <p style={noticeStyle}>{vettedCopy('address_still_current')}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={stillCurrentOptionStyle}
                  onClick={() => onConfirm(fieldId)}
                >
                  Yes, still current
                </button>
                <button
                  type="button"
                  style={stillCurrentOptionStyle}
                  onClick={() => onClear(fieldId)}
                >
                  No, let me update it
                </button>
              </div>
            </div>
          )}
          <FieldInput
            fieldId={fieldId}
            def={def}
            state={state.fields[fieldId]}
            onChange={onChange}
            onClear={onClear}
            scope={scope}
          />
          {askToConfirm && (
            <div style={{ margin: '6px 0' }}>
              <button
                type="button"
                onClick={() => onConfirm(fieldId)}
                style={{
                  background: COLOR.primary, color: COLOR.surface,
                  border: 'none', padding: '6px 12px', cursor: 'pointer',
                }}
              >
                Looks right
              </button>
            </div>
          )}
          {answered && (
            <p role="status" className="m-0 mt-1.5 text-[13px]" style={{ color: COLOR.success }}>
              {vettedCopy('field_confirmed')}
            </p>
          )}
          <Rationale field={def} id={rationaleId} />
        </div>
      )
    }

    case 'rationale': {
      const def = fieldDef(parseReqKey(block.fieldId).fieldId)
      return <Rationale field={def} />
    }

    case 'document_request': {
      const { docType } = block
      return (
        <div className="rounded-xl border border-divider bg-surface p-4 shadow-card">
          <DocumentUpload
            docType={docType}
            onRead={(image) => onReadDocument(docType, image)}
            scope={scope}
          />
        </div>
      )
    }

    case 'orientation': {
      const { done, total } = block
      return <p className="m-0 text-[13px] text-text-secondary">{done} of {total} done</p>
    }

    case 'notice': {
      return <p className="m-0 text-[13px] text-text-secondary">{vettedCopy(block.copyId)}</p>
    }

    default: {
      // Exhaustiveness check: a Block kind added without a case here fails
      // the build, rather than silently rendering nothing.
      const exhaustive: never = block
      throw new Error(`Unhandled block kind: ${JSON.stringify(exhaustive)}`)
    }
  }
}
