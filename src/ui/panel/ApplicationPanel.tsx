import { outstandingFields } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'
import type { CarryNotice } from '@/domain/application/carry'
import type { RequirementKey } from '@/domain/requirements/key'
import { requiredFields } from '@/domain/requirements/engine'
import { groupIntoSections } from '@/domain/requirements/sections'
import { COLOR } from '@/ui/theme/tokens'
import { FieldRow } from './FieldRow'
import { ProgressSummary } from './ProgressSummary'

type Props = {
  state: ApplicationState
  onConfirm?: (id: RequirementKey) => void
  onEdit?: (id: RequirementKey) => void
  /** Supplying this makes every row editable. Spec §15 / §11.1. */
  onChange?: (id: RequirementKey, value: unknown) => void
  onSubmit?: () => void
  /**
   * What the applicant's last edit carried elsewhere, so the row they typed
   * into can say so. Absent when the last edit saved them nothing.
   */
  carry?: CarryNotice
}

/**
 * The panel alone can complete an application. That is a resilience
 * requirement, not a rival to the agent — if the model is down, registration
 * must not be. Spec §11.1.
 *
 * Rows are chunked under headings taken from the catalog's own `section`,
 * in the order the requirements engine emits them. The flat 25-row column
 * this replaces is what made carry invisible — the business address it filled
 * in sat about 600px below the fold — and it was also less structure than the
 * IAA screens being replaced, which at least separated Identification,
 * Address and License Information.
 */
export function ApplicationPanel({
  state, onConfirm, onEdit, onChange, onSubmit, carry,
}: Props) {
  const required = requiredFields(state.profile)
  const outstanding = new Set(outstandingFields(state))
  const done = required.length - outstanding.size
  const sections = groupIntoSections(required)

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
        {sections.map((section) => {
          const headingId = `section-${section.id.replace('#', '--')}`
          const doneHere = section.fields.filter((id) => !outstanding.has(id)).length

          return (
            // A landmark per section, named by its own heading, so the
            // headings are navigable rather than decorative — the point of
            // sectioning is being able to find a thing you were told about.
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
                {/* The count lives BESIDE the heading rather than inside it,
                    so the section's accessible name stays "Address" and does
                    not change every time a field is answered. */}
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
                  {...(onConfirm && { onConfirm })}
                  {...(onEdit && { onEdit })}
                  {...(onChange && { onChange })}
                  {...(carry?.from === id && { carriedInto: carry.filled })}
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
