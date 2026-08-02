'use client'

import { COLOR } from '@/ui/theme/tokens'
import type { ApplicantProfile, LicenseType } from '@/domain/requirements/rules'

/**
 * Demo scaffolding. A real applicant never sets these — the profile is an
 * input to the requirements engine, not a set of catalog fields — but without
 * it the engine's per-state and per-type rules are only reachable from tests.
 */

/** GA and OH are in STATE_RULES; TX deliberately is not. */
const STATES = [
  { code: '', label: 'Not said yet' },
  { code: 'GA', label: 'Georgia — no extra forms' },
  { code: 'OH', label: 'Ohio — adds the out-of-state buyer form' },
  { code: 'TX', label: 'Texas — not in the rules table' },
]

const LICENCE_COUNTS = [0, 1, 2, 3]

const DEFAULT_LICENCE: LicenseType = 'dealer'

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
}

export type ProfileControlsProps = {
  profile: ApplicantProfile
  onChange: (patch: Partial<ApplicantProfile>) => void
  disabled: boolean
}

export function ProfileControls({ profile, onChange, disabled }: ProfileControlsProps) {
  const isBusiness = profile.applicantType === 'business'

  return (
    <fieldset
      style={{
        maxWidth: 560, margin: '0 0 16px', padding: 12,
        border: `1px solid ${COLOR.border}`, background: COLOR.surface,
        display: 'flex', flexWrap: 'wrap', gap: 16,
      }}
    >
      <legend style={{ fontSize: 12, color: COLOR.textMuted, padding: '0 4px' }}>
        Demo only — changes what the engine requires
      </legend>

      <label style={row}>
        Applicant
        <select
          value={profile.applicantType}
          disabled={disabled}
          onChange={(e) =>
            onChange({ applicantType: e.target.value as ApplicantProfile['applicantType'] })
          }
        >
          <option value="individual">Individual</option>
          <option value="business">Business</option>
        </select>
      </label>

      <label style={row}>
        State
        <select
          value={profile.state ?? ''}
          disabled={disabled}
          onChange={(e) => onChange({ state: e.target.value === '' ? null : e.target.value })}
        >
          {STATES.map((s) => (
            <option key={s.code} value={s.code}>{s.label}</option>
          ))}
        </select>
      </label>

      {isBusiness && (
        <label style={row}>
          Licences
          <select
            value={profile.licenses.length}
            disabled={disabled}
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
        </label>
      )}

      <label style={row}>
        <input
          type="checkbox"
          checked={profile.wantsGsa}
          disabled={disabled}
          onChange={(e) => onChange({ wantsGsa: e.target.checked })}
        />
        Wants GSA lots
      </label>

      <label style={row}>
        <input
          type="checkbox"
          checked={profile.addressDiffersFromId}
          disabled={disabled}
          onChange={(e) => onChange({ addressDiffersFromId: e.target.checked })}
        />
        Address differs from ID
      </label>
    </fieldset>
  )
}
