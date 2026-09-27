// ============================================================
// Sensitive Field Detection
// ============================================================
// Fields matching these patterns should NEVER be auto-filled.
// They require explicit user input (legal, consent, identity).
// ============================================================

/**
 * Patterns that indicate a field requires a user decision.
 * Checked against: label text, placeholder, aria-label, nearby text.
 */
export const SENSITIVE_PATTERNS: RegExp[] = [
  // Work authorization & visa
  /authorized?\s*(to)?\s*work/i,
  /work\s*authoriz/i,
  /visa\s*sponsor/i,
  /require\s*sponsor/i,
  /immigration\s*status/i,
  /work\s*permit/i,
  /employment\s*eligib/i,

  // Legal declarations
  /criminal\s*(record|history|conviction|background)/i,
  /felony/i,
  /misdemeanor/i,
  /legal\s*(action|proceeding)/i,
  /lawsuit/i,
  /litigation/i,

  // Disability & health
  /disabilit(y|ies)/i,
  /handicap/i,
  /accommodation/i,
  /medical\s*condition/i,

  // Veteran status
  /veteran/i,
  /military\s*service/i,
  /armed\s*forces/i,

  // Consent & agreement
  /\bconsent\b/i,
  /\bagree(ment)?\b/i,
  /terms\s*(and|&)\s*condition/i,
  /privacy\s*policy/i,
  /acknowledge/i,
  /certif(y|ication)/i,
  /attest/i,
  /\bdeclare?\b/i,

  // Salary & compensation
  /salary\s*(expectation|requirement|desired|expected|range)/i,
  /expected\s*compensation/i,
  /desired\s*pay/i,
  /current\s*salary/i,
  /pay\s*expectation/i,
  /compensation\s*expectation/i,
  /ctc/i,

  // Demographic (EEO)
  /\bgender\b/i,
  /\bsex\b/i,
  /\brace\b/i,
  /\bethnicity\b/i,
  /sexual\s*orientation/i,
  /marital\s*status/i,
  /religion/i,
  /national\s*origin/i,
  /caste/i,

  // Referral & misc
  /how\s*did\s*you\s*(hear|find|learn)/i,
  /referr(al|ed)/i,
  /willing\s*to\s*relocate/i,
  /available\s*to\s*start/i,
  /start\s*date/i,
  /notice\s*period/i,
];

/**
 * Check if a field's surrounding text indicates a sensitive question.
 */
export function isSensitiveField(texts: string[]): boolean {
  const combined = texts.filter(Boolean).join(' ');
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(combined));
}
