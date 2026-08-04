import { outstandingFields } from '@/domain/application/queries'
import type { ApplicationState } from '@/domain/application/state'
import type { CarryNotice } from '@/domain/application/carry'
import type { RequirementKey } from '@/domain/requirements/key'
import { requiredFields } from '@/domain/requirements/engine'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import { groupIntoSections } from '@/domain/requirements/sections'
import { COLOR } from '@/ui/theme/tokens'
import type { DocumentImages } from './document-images'
import { FieldRow } from './FieldRow'
import { ProfileSection } from './ProfileSection'
import { ProgressSummary } from './ProgressSummary'

/** A pair, for the reason FieldRow spells out. */
type EditHandlers =
  | {
      onChange: (id: RequirementKey, value: unknown) => void
      onClear: (id: RequirementKey) => void
    }
  | { onChange?: undefined; onClear?: undefined }

type Props = EditHandlers & {
  state: ApplicationState
  onConfirm?: (id: RequirementKey) => void
  onEdit?: (id: RequirementKey) => void
  onSubmit?: () => void
  /** Absent when the last edit changed nothing elsewhere. */
  carry?: CarryNotice
  /** The uploaded documents, if the browser still holds them — empty after a reload. */
  documents?: DocumentImages
  /** Absent once the application is closed — the profile section falls back to plain text. */
  onProfileChange?: (patch: Partial<ApplicantProfile>) => void
}

/**
 * The panel alone can complete an application: if the model is down,
 * registration must not be. Rows are chunked under headings from the
 * catalog's own `section`, in the order the requirements engine emits them.
 */
export function ApplicationPanel(props: Props) {
  const {
    state, onConfirm, onEdit, onSubmit, carry, documents, onProfileChange,
  } = props
  const required = requiredFields(state.profile)
  const outstanding = new Set(outstandingFields(state))
  const done = required.length - outstanding.size
  const sections = groupIntoSections(required)
  // One object, so the pairing survives the hand-off.
  const editing: EditHandlers = props.onChange !== undefined
    ? { onChange: props.onChange, onClear: props.onClear }
    : {}

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
        <ProfileSection
          profile={state.profile}
          {...(onProfileChange && { onChange: onProfileChange })}
        />

        {sections.map((section) => {
          const headingId = `section-${section.id.replace('#', '--')}`
          const doneHere = section.fields.filter((id) => !outstanding.has(id)).length

          return (
            <section
              key={section.id}
              aria-labelledby={headingId}
              style={{ marginBottom: 20 }}
            >
              <div
                style={{
                  display: 'flex', alignItems: 'baseline',
                  justifyContent: 'space-between', gap: 12,
                  padding: '0 0 6px', marginBottom: 8,
                  borderBottom: `1px solid ${COLOR.divider}`,
                }}
              >
                {/* Beside the heading, not inside it, so the section's
                    accessible name stays "Address". */}
                <h3
                  id={headingId}
                  style={{
                    fontSize: 13, margin: 0, letterSpacing: '.06em',
                    textTransform: 'uppercase', color: COLOR.textSecondary,
                  }}
                >
                  {section.label}
                </h3>
                <span style={{ fontSize: 13, color: COLOR.textSecondary }}>
                  {doneHere} of {section.fields.length}
                </span>
              </div>

              {section.fields.map((id) => (
                <FieldRow
                  key={id}
                  fieldId={id}
                  state={state.fields[id]}
                  {...editing}
                  {...(onConfirm && { onConfirm })}
                  {...(onEdit && { onEdit })}
                  {...(carry?.from === id && {
                    carriedInto: carry.filled, carriedOut: carry.cleared,
                  })}
                  {...(documents && { documents })}
                />
              ))}
            </section>
          )
        })}
      </div>

      <ProgressSummary
        done={done}
        total={required.length}
        {...(onSubmit && { onSubmit })}
      />
    </section>
  )
}
