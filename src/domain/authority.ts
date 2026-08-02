export type Authority =
  | 'IRS'
  | 'FEDERAL_KYC'
  | 'STATE_DMV'
  | 'STATE_DEALER_BOARD'
  | 'GSA'
  | 'IAA_POLICY'

export const AUTHORITY_LABEL: Record<Authority, string> = {
  IRS: 'the IRS',
  FEDERAL_KYC: 'federal identity rules',
  STATE_DMV: 'your state DMV',
  STATE_DEALER_BOARD: 'your state dealer board',
  GSA: 'GSA Fleet',
  IAA_POLICY: 'IAA',
}
