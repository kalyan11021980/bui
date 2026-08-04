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
  onReadDocument: (docType: DocType, image: PreparedImage) => void
}

type Props = BlockHandlers & {
  block: Block
  state: ApplicationState
}

const noticeStyle: React.CSSProperties = {
  margin: '6px 0', fontSize: 14, color: COLOR.textPrimary,
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, letterSpacing: '.04em', fontWeight: 700,
  textTransform: 'uppercase', color: COLOR.textPrimary, marginBottom: 2,
}

/**
 * The only place a Block turns into pixels. A discriminated, exhaustive
 * switch over `Block['kind']` — every case delegates to an existing panel
 * component rather than a new input, because a second input path is a
 * second place a value could go.
 */
export function BlockView({ block, state, onChange, onClear, onReadDocument }: Props) {
  switch (block.kind) {
    case 'field_ask': {
      const { fieldId } = block
      const def = fieldDef(parseReqKey(fieldId).fieldId)
      const rationaleId = `chat-rationale-${fieldId}`
      return (
        <div style={{ margin: '10px 0' }}>
          <label htmlFor={fieldInputId(fieldId)} style={labelStyle}>
            {displayLabel(fieldId)}
          </label>
          <FieldInput
            fieldId={fieldId}
            def={def}
            state={state.fields[fieldId]}
            onChange={onChange}
            onClear={onClear}
          />
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
        <DocumentUpload
          docType={docType}
          onRead={(image) => onReadDocument(docType, image)}
        />
      )
    }

    case 'orientation': {
      const { done, total } = block
      return <p style={noticeStyle}>{done} of {total} done</p>
    }

    case 'notice': {
      return <p style={noticeStyle}>{vettedCopy(block.copyId)}</p>
    }

    default: {
      // Exhaustiveness check: a Block kind added without a case here fails
      // the build, rather than silently rendering nothing.
      const exhaustive: never = block
      throw new Error(`Unhandled block kind: ${JSON.stringify(exhaustive)}`)
    }
  }
}
