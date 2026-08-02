import { outstandingFields } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'
import type { RequirementKey } from '@/domain/requirements/key'
import { requiredFields } from '@/domain/requirements/engine'
import { COLOR } from '@/ui/theme/tokens'
import { FieldRow } from './FieldRow'
import { ProgressSummary } from './ProgressSummary'

type Props = {
  state: ApplicationState
  onConfirm?: (id: RequirementKey) => void
  onEdit?: (id: RequirementKey) => void
  onSubmit?: () => void
}

/**
 * The panel alone can complete an application. That is a resilience
 * requirement, not a rival to the agent — if the model is down, registration
 * must not be. Spec §11.1.
 */
export function ApplicationPanel({ state, onConfirm, onEdit, onSubmit }: Props) {
  const required = requiredFields(state.profile)
  const outstanding = outstandingFields(state)
  const done = required.length - outstanding.length

  return (
    <section
      aria-label="Your application"
      style={{ background: COLOR.page, maxWidth: 560 }}
    >
      <h2
        style={{
          fontSize: 16, margin: 0, padding: '14px',
          color: COLOR.textPrimary, borderBottom: `1px solid ${COLOR.divider}`,
        }}
      >
        Your application
      </h2>

      <div style={{ padding: 14 }}>
        {required.map((id) => (
          <FieldRow
            key={id}
            fieldId={id}
            state={state.fields[id]}
            {...(onConfirm && { onConfirm })}
            {...(onEdit && { onEdit })}
          />
        ))}
      </div>

      <ProgressSummary
        done={done}
        total={required.length}
        {...(onSubmit && { onSubmit })}
      />
    </section>
  )
}
