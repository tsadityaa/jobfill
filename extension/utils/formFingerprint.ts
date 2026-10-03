// ============================================================
// Form Fingerprinter
// ============================================================
// Creates a stable SHA-256 fingerprint from the STRUCTURE of a form
// (hostname + field names + labels + types).
// This is stronger than URL-based caching because:
//   /jobs/company/role/123
//   /jobs/company/role/456
// may use the exact same application form → same fingerprint → one AI call.
//
// NEVER includes user values, profile data, or personal info.
// ============================================================

/**
 * Build a deterministic string representing the form's structure,
 * then hash it with SHA-256.
 */
export async function computeFormFingerprint(): Promise<string> {
  const hostname = window.location.hostname;

  const fields = document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea',
  );

  const descriptors: string[] = [];

  for (const el of fields) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;

    const tag  = el.tagName.toLowerCase();
    const type = el instanceof HTMLInputElement ? (el.type || 'text') : tag;
    const name = (el.getAttribute('name') || '').toLowerCase().trim();
    const id   = (el.id || '').toLowerCase().trim();

    // Label text — check <label for>, aria-label, placeholder
    const labelFor   = id ? document.querySelector(`label[for="${el.id}"]`)?.textContent?.toLowerCase().trim() ?? '' : '';
    const ariaLabel  = (el.getAttribute('aria-label') || '').toLowerCase().trim();
    const placeholder = (el.getAttribute('placeholder') || '').toLowerCase().trim();

    // Compose a field token from stable structural attributes only
    const token = [tag, type, name, id, labelFor, ariaLabel, placeholder]
      .filter(Boolean)
      .join('|');

    if (token) descriptors.push(token);
  }

  // Sort so minor DOM ordering changes don't break the fingerprint
  descriptors.sort();

  const raw = `${hostname}::${descriptors.join(';;')}`;

  // SHA-256 via WebCrypto — available in both content scripts and service workers
  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return hex;
}
