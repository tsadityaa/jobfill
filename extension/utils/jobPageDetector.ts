// ============================================================
// Job Page Detector — Local Scorer, Zero AI, Zero Tokens
// ============================================================
// Classifies the current page as NOT_JOB | POSSIBLE_JOB | JOB_APPLICATION
// using URL signals, platform signals, DOM field signals, and page text signals.
// Called from the content script on page load — never sends any data anywhere.
// ============================================================

export type JobPageClassification = 'NOT_JOB' | 'POSSIBLE_JOB' | 'JOB_APPLICATION';

/** Score thresholds */
const THRESHOLD_JOB = 10;
const THRESHOLD_POSSIBLE = 5;

// ---- URL signals ----
const URL_STRONG_PATTERNS = [
  /\/apply(\/|$|\?)/i,
  /\/application(\/|$|\?)/i,
  /\/create_application(\/|$|\?)/i,
  /\/jobs\/.*apply/i,
  /\/candidate(\/|$|\?)/i,
  /workday\.com/i,
  /greenhouse\.io/i,
  /lever\.co/i,
  /icims\.com/i,
  /smartrecruiters\.com/i,
  /ashbyhq\.com/i,
  /taleo\.net/i,
  /successfactors\.(com|eu)/i,
  /oraclecloud\.com\/hcm/i,
  /myworkdayjobs\.com/i,
  /jobvite\.com/i,
  /bamboohr\.com/i,
  /recruitee\.com/i,
  /breezy\.hr/i,
  /dover\.com\/apply/i,
  /metacareers\.com/i,
];

const URL_WEAK_PATTERNS = [
  /\/jobs(\/|$|\?)/i,
  /\/careers(\/|$|\?)/i,
  /\/job\//i,
  /\/hiring/i,
  /\/openings/i,
  /\/vacancies/i,
  /\/recruitment/i,
];

// ---- Field label signals ----
const FIELD_STRONG = [
  /\bresume\b/i, /\bcv\b/i, /\bcover.?letter\b/i,
  /\bwork.?authorization\b/i, /\bvisa.?sponsor/i,
  /\bupload.*(resume|cv)/i,
];

const FIELD_MODERATE = [
  /\bfirst.?name\b/i, /\blast.?name\b/i,
  /\bwork.?experience\b/i, /\bemployment.?history\b/i,
  /\beducation\b/i, /\blinkedin\b/i,
  /\bgithub\b/i, /\bportfolio\b/i,
  /\bphone\b/i, /\bemail\b/i,
];

const FIELD_WEAK = [
  /\baddress\b/i, /\bcity\b/i, /\bcountry\b/i,
  /\bjob.?title\b/i, /\bcurrent.?company\b/i,
];

// ---- Page text signals ----
const TEXT_STRONG = [
  /submit.?application/i, /apply.?now/i,
  /job.?application/i, /application.?form/i,
  /upload.?resume/i, /attach.?resume/i,
];

const TEXT_WEAK = [
  /\bcandidate\b/i, /\bapplicant\b/i,
  /\bemployment\b/i, /\bapply\b/i,
];

/**
 * Classify the current page without any AI or network calls.
 * Returns classification + numeric score for debugging.
 */
export function detectJobPage(): { classification: JobPageClassification; score: number } {
  let score = 0;
  const url = window.location.href;
  const scoreBreakdown: Array<{ source: string; pattern: string; points: number }> = [];

  // URL signals
  for (const p of URL_STRONG_PATTERNS) {
    if (p.test(url)) {
      score += 5;
      scoreBreakdown.push({ source: 'url-strong', pattern: p.source, points: 5 });
      break;
    }
  }
  for (const p of URL_WEAK_PATTERNS) {
    if (p.test(url)) {
      score += 2;
      scoreBreakdown.push({ source: 'url-weak', pattern: p.source, points: 2 });
      break;
    }
  }

  // Field label signals — scan visible form fields
  const fields = document.querySelectorAll<HTMLElement>(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea',
  );

  const allFieldText: string[] = [];
  for (const el of fields) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;

    const texts = [
      el.getAttribute('placeholder'),
      el.getAttribute('aria-label'),
      el.getAttribute('name'),
      el.id,
      document.querySelector(`label[for="${el.id}"]`)?.textContent,
    ].filter(Boolean).join(' ');

    allFieldText.push(texts);
  }

  const fieldText = allFieldText.join(' ');

  for (const p of FIELD_STRONG)   { if (p.test(fieldText)) { score += 4; scoreBreakdown.push({ source: 'field-strong', pattern: p.source, points: 4 }); } }
  for (const p of FIELD_MODERATE) { if (p.test(fieldText)) { score += 3; scoreBreakdown.push({ source: 'field-moderate', pattern: p.source, points: 3 }); } }
  for (const p of FIELD_WEAK)     { if (p.test(fieldText)) { score += 1; scoreBreakdown.push({ source: 'field-weak', pattern: p.source, points: 1 }); } }

  // Page text signals — limit to first 3000 chars to stay fast
  const bodyText = (document.body?.innerText ?? '').slice(0, 3000);
  for (const p of TEXT_STRONG) { if (p.test(bodyText)) { score += 3; scoreBreakdown.push({ source: 'text-strong', pattern: p.source, points: 3 }); } }
  for (const p of TEXT_WEAK)   { if (p.test(bodyText)) { score += 1; scoreBreakdown.push({ source: 'text-weak', pattern: p.source, points: 1 }); } }

  const classification: JobPageClassification =
    score >= THRESHOLD_JOB      ? 'JOB_APPLICATION' :
    score >= THRESHOLD_POSSIBLE  ? 'POSSIBLE_JOB'   :
                                   'NOT_JOB';

  console.info(`[JobFill] Page classification: ${classification} (score: ${score}, thresholds: JOB≥${THRESHOLD_JOB} POSSIBLE≥${THRESHOLD_POSSIBLE})`, {
    url,
    visibleFieldCount: allFieldText.length,
    scoreBreakdown,
  });

  return { classification, score };
}
