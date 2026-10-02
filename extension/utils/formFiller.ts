// ============================================================
// Form Filler
// ============================================================
// Fills form fields with mapped values, dispatching appropriate
// events so React/Angular/Vue forms detect the changes.
// ============================================================

import type { FieldMapping, AutofillResult, AutofillFieldResult } from '../types/autofill';

/**
 * Find the React fiber key on a DOM node (differs across React versions).
 */
function getReactFiberKey(el: Element): string | undefined {
  return Object.keys(el).find(
    (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'),
  );
}

/**
 * Walk the React fiber tree upward and call the first onChange prop found.
 * This directly updates React 16/17/18 internal state so it matches the DOM,
 * preventing React from reconciling the value back to "" on next render.
 */
function triggerReactOnChange(
  el: HTMLInputElement | HTMLTextAreaElement,
): void {
  const fiberKey = getReactFiberKey(el);
  if (!fiberKey) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node = (el as any)[fiberKey];
  while (node) {
    const onChange =
      node.memoizedProps?.onChange ?? node.pendingProps?.onChange;
    if (typeof onChange === 'function') {
      // Build a minimal synthetic-event-like object React onChange expects
      onChange({
        target: el,
        currentTarget: el,
        type: 'change',
        nativeEvent: new Event('change', { bubbles: true }),
        bubbles: true,
        preventDefault: () => {},
        stopPropagation: () => {},
        persist: () => {},
      });
      return;
    }
    node = node.return;
  }
}

/**
 * Set the native DOM value using the prototype setter.
 * Required for React controlled components (bypasses React's value tracking).
 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const setter =
    el instanceof HTMLTextAreaElement
      ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
}

/**
 * Dispatch native DOM events that frameworks listen to.
 * Also directly triggers React fiber onChange to commit value into React state.
 */
function dispatchInputEvents(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, skipBlur = false): void {
  el.dispatchEvent(new FocusEvent('focus',   { bubbles: true }));
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

  // Trigger React fiber onChange directly — commits value into React state
  // so it survives re-renders (input/textarea only; select uses DOM events)
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    triggerReactOnChange(el);
  }

  // Also fire DOM events for Angular/Vue/non-React forms
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  if (!skipBlur) {
    el.dispatchEvent(new FocusEvent('blur',     { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }
}

/**
 * Fill a <select> element by matching option text or value.
 */
function fillSelect(el: HTMLSelectElement, value: string): boolean {
  const normalizedValue = value.toLowerCase().trim();

  for (const option of el.options) {
    const optText = option.textContent?.toLowerCase().trim() ?? '';
    const optValue = option.value.toLowerCase().trim();

    if (optText === normalizedValue || optValue === normalizedValue) {
      el.value = option.value;
      dispatchInputEvents(el);
      return true;
    }
  }

  // Fuzzy match: check if option text contains the value or vice versa
  for (const option of el.options) {
    const optText = option.textContent?.toLowerCase().trim() ?? '';
    if (optText.includes(normalizedValue) || normalizedValue.includes(optText)) {
      el.value = option.value;
      dispatchInputEvents(el);
      return true;
    }
  }

  return false;
}

// ============================================================
// Visual FX — injected directly into the page DOM
// ============================================================

/** Inject shared keyframes once per page load */
function ensureStyles() {
  if (document.getElementById('jf-fill-styles')) return;
  const s = document.createElement('style');
  s.id = 'jf-fill-styles';
  s.textContent = `
    @keyframes jf-check-pop {
      0%   { transform: translate(-50%,-50%) scale(0)    rotate(-20deg); opacity: 0; }
      60%  { transform: translate(-50%,-50%) scale(1.3)  rotate(6deg);   opacity: 1; }
      100% { transform: translate(-50%,-50%) scale(1)    rotate(0deg);   opacity: 1; }
    }
    @keyframes jf-check-fade {
      0%   { opacity: 1; transform: translate(-50%,-50%) translateY(0)    scale(1);   }
      100% { opacity: 0; transform: translate(-50%,-50%) translateY(-18px) scale(.85); }
    }
    @keyframes jf-particle {
      0%   { opacity: 1; transform: translate(0, 0) scale(1); }
      100% { opacity: 0; transform: translate(var(--jf-tx), var(--jf-ty)) scale(0); }
    }
    @keyframes jf-glow-in {
      0%   { outline-color: #00d4ff; box-shadow: 0 0 0   0   #00d4ff44, 0 0  0   0   #00ff8744; }
      35%  { outline-color: #00d4ff; box-shadow: 0 0 0   5px #00d4ff60, 0 0 18px 2px #00ff8730; }
      100% { outline-color: #00d4ff88; box-shadow: 0 0 0 0   #00d4ff00, 0 0  0   0   #00ff8700; }
    }
    @keyframes jf-page-flash {
      0%   { opacity: 0; }
      12%  { opacity: 1; }
      88%  { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes jf-border-pulse {
      0%,100% { opacity: 0; }
      40%     { opacity: 1; }
    }
  `;
  document.head.appendChild(s);
}

/** Particle burst — tiny dots scatter from field centre */
function burstParticles(el: HTMLElement) {
  const rect   = el.getBoundingClientRect();
  const cx     = rect.left + rect.width  / 2 + window.scrollX;
  const cy     = rect.top  + rect.height / 2 + window.scrollY;
  const colors = ['#00d4ff', '#00ff87', '#ffb300', '#ffffff', '#00d4ff', '#00ff87'];
  const COUNT  = 12;

  for (let i = 0; i < COUNT; i++) {
    const angle = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const dist  = 24 + Math.random() * 40;
    const color = colors[i % colors.length];
    const size  = 2.5 + Math.random() * 3.5;
    const dur   = 300 + Math.random() * 250;

    const dot = document.createElement('div');
    dot.style.cssText = `
      position: absolute;
      left: ${cx}px;
      top: ${cy}px;
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: ${color};
      box-shadow: 0 0 6px ${color};
      pointer-events: none;
      z-index: 2147483646;
      --jf-tx: ${Math.cos(angle) * dist}px;
      --jf-ty: ${Math.sin(angle) * dist}px;
      animation: jf-particle ${dur}ms cubic-bezier(.2,.8,.3,1) forwards;
    `;
    document.body.appendChild(dot);
    setTimeout(() => dot.remove(), dur + 50);
  }
}



/** Floating ✓ badge that pops then drifts up and fades */
function checkBadge(el: HTMLElement) {
  const rect  = el.getBoundingClientRect();
  const badge = document.createElement('div');
  badge.textContent = '✓';
  badge.style.cssText = `
    position: fixed;
    left: ${rect.right - 14}px;
    top:  ${rect.top + rect.height / 2}px;
    transform: translate(-50%,-50%);
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: linear-gradient(135deg, #00d4ff, #00ff87);
    color: #04080f;
    font-size: 12px;
    font-weight: 900;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 2147483647;
    box-shadow: 0 0 12px #00d4ffaa, 0 2px 8px rgba(0,0,0,.35);
    animation: jf-check-pop 380ms cubic-bezier(.34,1.56,.64,1) forwards;
  `;
  document.body.appendChild(badge);
  setTimeout(() => {
    badge.style.animation = 'jf-check-fade 550ms ease-out forwards';
    setTimeout(() => badge.remove(), 600);
  }, 400);
}

/** Neon glow outline on the field — uses an overlay to avoid touching the input's styles */
function glowField(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  const rect = el.getBoundingClientRect();
  const glow = document.createElement('div');
  glow.style.cssText = `
    position: fixed;
    left: ${rect.left}px;
    top:  ${rect.top}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    border-radius: ${getComputedStyle(el).borderRadius || '4px'};
    pointer-events: none;
    z-index: 2147483645;
    outline: 2px solid #00d4ff;
    outline-offset: -2px;
    animation: jf-glow-in 1.3s cubic-bezier(.4,0,.2,1) forwards;
  `;
  document.body.appendChild(glow);
  setTimeout(() => glow.remove(), 2800);
}

/**
 * Full-page holographic sweep + neon border flash.
 * Fires once after all fields have been filled.
 */
function pageCompleteFlash() {
  // Diagonal light-beam overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483645;
    background: linear-gradient(
      108deg,
      transparent 0%,
      transparent 28%,
      rgba(0,212,255,0.06) 40%,
      rgba(0,255,135,0.10) 50%,
      rgba(0,212,255,0.06) 60%,
      transparent 72%,
      transparent 100%
    );
    animation: jf-page-flash 850ms cubic-bezier(.4,0,.2,1) forwards;
  `;
  document.body.appendChild(overlay);

  // Neon border on the whole viewport
  const border = document.createElement('div');
  border.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483645;
    border: 2px solid rgba(0,212,255,0.45);
    box-shadow: inset 0 0 40px rgba(0,212,255,0.08);
    border-radius: 0;
    animation: jf-border-pulse 850ms ease-out forwards;
  `;
  document.body.appendChild(border);

  setTimeout(() => { overlay.remove(); border.remove(); }, 900);
}

// ============================================================
// Main fill function
// ============================================================

/**
 * Fill all mapped fields on the page with cascading visual FX.
 */
export function fillFields(mappings: FieldMapping[]): AutofillResult {
  ensureStyles();

  const results: AutofillFieldResult[] = [];
  let errorCount = 0;

  // ---- Pre-scan: resolve selectors to elements ----
  // No skipped_existing guard — if a mapping says fill it, we fill it.
  // Skipping already-filled fields caused re-scans to miss fields that Adobe
  // had cleared from React state between scans.
  type FillItem = {
    el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    mapping: FieldMapping;
  };
  const toFill: FillItem[] = [];

  for (const mapping of mappings) {
    try {
      const el = document.querySelector(mapping.selector);
      if (!el) {
        results.push({ selector: mapping.selector, profileField: mapping.profileField, status: 'error', message: 'Element not found' });
        errorCount++;
        continue;
      }

      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        toFill.push({ el, mapping });
      }
    } catch (err) {
      results.push({ selector: mapping.selector, profileField: mapping.profileField, status: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
      errorCount++;
    }
  }

  // ---- Phase 1 (sync, ~0ms): Write ALL values instantly ----
  // No timeouts — React/Angular/Vue validators cannot clear values mid-cascade
  // because blur is intentionally skipped here.
  const filled: FillItem[] = [];

  for (const item of toFill) {
    const { el, mapping } = item;
    try {
      let ok = false;

      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        setNativeValue(el, mapping.value);
        dispatchInputEvents(el, true /* skipBlur */);
        ok = true;
      } else if (el instanceof HTMLSelectElement) {
        ok = fillSelect(el, mapping.value);
        if (!ok) {
          results.push({ selector: mapping.selector, profileField: mapping.profileField, status: 'error', message: `No matching option for "${mapping.value}"` });
          errorCount++;
        }
      }

      if (ok) {
        filled.push(item);
        results.push({ selector: mapping.selector, profileField: mapping.profileField, status: 'filled' });
      }
    } catch (err) {
      results.push({ selector: mapping.selector, profileField: mapping.profileField, status: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
      errorCount++;
    }
  }

  const filledCount = filled.length;

  // ---- Phase 2 (async, visual only): Stagger animations at 60ms ----
  // Data is already in the DOM — this is pure eye candy.
  // IMPORTANT: React may batch-reconcile and clear values between Phase 1 and
  // these timeouts. Before animating each field, verify its value is intact and
  // re-apply if React wiped it (common on dynamically-rendered fields like
  // Adobe's "Local Given Name" / "Local Family Name").
  const ANIM_STAGGER = 60;

  filled.forEach(({ el, mapping }, idx) => {
    setTimeout(() => {
      // Re-verify value — React may have reconciled and cleared it
      if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.value !== mapping.value) {
        setNativeValue(el, mapping.value);
        dispatchInputEvents(el, true /* skipBlur */);
      }
      glowField(el);
      checkBadge(el as HTMLElement);
      burstParticles(el as HTMLElement);
    }, idx * ANIM_STAGGER);
  });

  // ---- Phase 3: Page sweep after last animation ----
  // NOTE: We intentionally do NOT dispatch blur on text inputs.
  // Adobe/Workday React forms re-sync DOM from React state on blur — if their
  // onBlur validator runs before React has fully committed the value, it
  // overwrites the field with an empty string. The `input`+`change` events
  // fired in Phase 1 are sufficient to update React state. Blur is skipped.
  const lastAnimEnd = filledCount > 0 ? (filledCount - 1) * ANIM_STAGGER + 80 : 0;

  setTimeout(() => {
    if (filledCount > 0) pageCompleteFlash();
  }, lastAnimEnd);

  // ---- Phase 4: Final reinforcement sweep ----
  // One last pass after all animations + page flash have fired.
  // Catches any React re-render triggered by animation-phase events.
  // Uses increasing delays (500ms, 1200ms, 2500ms) to survive multi-pass
  // React reconciliation cycles.
  const REINFORCE_DELAYS = [500, 1200, 2500];
  for (const delay of REINFORCE_DELAYS) {
    setTimeout(() => {
      for (const { el, mapping } of filled) {
        if (
          (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
          el.value !== mapping.value
        ) {
          setNativeValue(el, mapping.value);
          triggerReactOnChange(el);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }, lastAnimEnd + delay);
  }

  // Return optimistic counts immediately (async fills happen after)
  return {
    totalFields: mappings.length,
    filledFields: toFill.length,
    skippedSensitive: 0,
    skippedUnknown: 0,
    skippedExisting: 0,
    errors: errorCount,
    fields: results,
  };
}
