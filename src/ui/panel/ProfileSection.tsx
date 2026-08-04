'use client'

import type { ApplicantProfile, IdForm, LicenseType } from '@/domain/requirements/rules'
import { COLOR } from '@/ui/theme/tokens'

/** GA and OH are in STATE_RULES; TX deliberately is not. */
const STATES = [
  { code: '', label: 'Not said yet' },
  { code: 'GA', label: 'Georgia — no extra forms' },
  { code: 'OH', label: 'Ohio — adds the out-of-state buyer form' },
  { code: 'TX', label: 'Texas — not in the rules table' },
]

const LICENCE_COUNTS = [0, 1, 2, 3]

/** Each asks for a different number field, and a passport has no issuing state. */
const ID_FORMS: { value: IdForm; label: string }[] = [
  { value: 'drivers_license', label: "Driver's license" },
  { value: 'state_id', label: 'State ID card' },
  { value: 'passport', label: 'Passport' },
]

const DEFAULT_LICENCE: LicenseType = 'dealer'

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 10,
}

const heading: React.CSSProperties = {
  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
  padding: '0 0 6px', marginBottom: 8, borderBottom: `1px solid ${COLOR.divider}`,
}

const headingText: React.CSSProperties = {
  fontSize: 13, margin: 0, letterSpacing: '.06em',
  textTransform: 'uppercase', color: COLOR.textSecondary,
}

export type ProfileSectionProps = {
  profile: ApplicantProfile
  /** Absent once the application is closed — rows fall back to plain text,
   *  the same way FieldRow does. */
  onChange?: (patch: Partial<ApplicantProfile>) => void
}

/**
 * What drives the requirements engine, editable in place: a wrong applicant
 * type or state is corrected here the same way any other answer is, not by
 * starting the application over. The agent's `setProfile` tool writes the
 * same field this section reads.
 */
export function ProfileSection({ profile, onChange }: ProfileSectionProps) {
  const isBusiness = profile.applicantType === 'business'

  return (
    <section aria-labelledby="section-profile" style={{ marginBottom: 20 }}>
      <div style={heading}>
        <h3 id="section-profile" style={headingText}>Profile</h3>
      </div>

      <label style={row}>
        Applicant
        {onChange ? (
          <select
            value={profile.applicantType}
            onChange={(e) =>
              onChange({ applicantType: e.target.value === 'business' ? 'business' : 'individual' })
            }
          >
            <option value="individual">Individual</option>
            <option value="business">Business</option>
          </select>
        ) : (
          <span>{profile.applicantType === 'business' ? 'Business' : 'Individual'}</span>
        )}
      </label>

      <label style={row}>
        ID form
        {onChange ? (
          <select
            value={profile.idForm}
            onChange={(e) => {
              const chosen = ID_FORMS.find((f) => f.value === e.target.value)
              if (chosen) onChange({ idForm: chosen.value })
            }}
          >
            {ID_FORMS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        ) : (
          <span>{ID_FORMS.find((f) => f.value === profile.idForm)?.label ?? profile.idForm}</span>
        )}
      </label>

      <label style={row}>
        State
        {onChange ? (
          <select
            value={profile.state ?? ''}
            onChange={(e) => onChange({ state: e.target.value === '' ? null : e.target.value })}
          >
            {STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.label}</option>
            ))}
          </select>
        ) : (
          <span>{profile.state ?? 'Not said yet'}</span>
        )}
      </label>

      {isBusiness && (
        <label style={row}>
          Licences
          {onChange ? (
            <select
              value={profile.licenses.length}
              onChange={(e) =>
                onChange({
                  licenses: Array.from(
                    { length: Number(e.target.value) }, () => DEFAULT_LICENCE,
                  ),
                })
              }
            >
              {LICENCE_COUNTS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          ) : (
            <span>{profile.licenses.length}</span>
          )}
        </label>
      )}

      <label style={row}>
        {onChange ? (
          <input
            type="checkbox"
            checked={profile.wantsGsa}
            onChange={(e) => onChange({ wantsGsa: e.target.checked })}
          />
        ) : (
          <span>{profile.wantsGsa ? 'Yes' : 'No'}</span>
        )}
        Wants GSA lots
      </label>

      <label style={row}>
        {onChange ? (
          <input
            type="checkbox"
            checked={profile.addressDiffersFromId}
            onChange={(e) => onChange({ addressDiffersFromId: e.target.checked })}
          />
        ) : (
          <span>{profile.addressDiffersFromId ? 'Yes' : 'No'}</span>
        )}
        Address differs from ID
      </label>
    </section>
  )
}
