/**
 * ============================================================
 * Scroll Lock Utility
 * ============================================================
 * Strictly prevents any programmatic scrolling (by the extension,
 * ATS frameworks like Workday, Google Forms, Greenhouse, or browser
 * default activation behavior) while autofill / data filling is running.
 *
 * Manual user scrolling (mousewheel, trackpad, touch, scrollbar dragging)
 * remains completely untouched and allowed.
 * ============================================================
 */

let activeLockCount = 0;
let installed = false;

// Store original methods
let origScrollIntoView: typeof Element.prototype.scrollIntoView | undefined;
let origWindowScrollTo: typeof window.scrollTo | undefined;
let origWindowScrollBy: typeof window.scrollBy | undefined;
let origWindowScroll: typeof window.scroll | undefined;
let origElementScrollTo: typeof Element.prototype.scrollTo | undefined;
let origElementScrollBy: typeof Element.prototype.scrollBy | undefined;
let origElementScroll: typeof Element.prototype.scroll | undefined;
let origFocus: typeof HTMLElement.prototype.focus | undefined;

export function isScrollLocked(): boolean {
  return activeLockCount > 0;
}

export function initScrollLock(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  origScrollIntoView = Element.prototype.scrollIntoView;
  origWindowScrollTo = window.scrollTo;
  origWindowScrollBy = window.scrollBy;
  origWindowScroll = window.scroll;
  origElementScrollTo = Element.prototype.scrollTo;
  origElementScrollBy = Element.prototype.scrollBy;
  origElementScroll = Element.prototype.scroll;
  origFocus = HTMLElement.prototype.focus;

  // 1. Element.prototype.scrollIntoView: completely disabled while locked
  Element.prototype.scrollIntoView = function (...args: any[]) {
    if (activeLockCount > 0) {
      return;
    }
    return origScrollIntoView?.apply(this, args as any);
  };

  // 2. window.scrollTo: completely disabled while locked
  window.scrollTo = function (...args: any[]) {
    if (activeLockCount > 0) {
      return;
    }
    return (origWindowScrollTo as any)?.apply(this, args);
  };

  // 3. window.scrollBy: completely disabled while locked
  window.scrollBy = function (...args: any[]) {
    if (activeLockCount > 0) {
      return;
    }
    return (origWindowScrollBy as any)?.apply(this, args);
  };

  // 4. window.scroll: completely disabled while locked
  window.scroll = function (...args: any[]) {
    if (activeLockCount > 0) {
      return;
    }
    return (origWindowScroll as any)?.apply(this, args);
  };

  // 5. Element.prototype.scrollTo on document/root
  Element.prototype.scrollTo = function (...args: any[]) {
    if (activeLockCount > 0 && (this === document.documentElement || this === document.body)) {
      return;
    }
    return (origElementScrollTo as any)?.apply(this, args);
  };

  // 6. Element.prototype.scrollBy on document/root
  Element.prototype.scrollBy = function (...args: any[]) {
    if (activeLockCount > 0 && (this === document.documentElement || this === document.body)) {
      return;
    }
    return (origElementScrollBy as any)?.apply(this, args);
  };

  // 7. Element.prototype.scroll on document/root
  Element.prototype.scroll = function (...args: any[]) {
    if (activeLockCount > 0 && (this === document.documentElement || this === document.body)) {
      return;
    }
    return (origElementScroll as any)?.apply(this, args);
  };

  // 8. HTMLElement.prototype.focus: enforce preventScroll: true while locked
  HTMLElement.prototype.focus = function (options?: FocusOptions) {
    if (activeLockCount > 0) {
      return origFocus?.call(this, { ...options, preventScroll: true });
    }
    return origFocus?.call(this, options);
  };
}

export function enableScrollLock(): void {
  initScrollLock();
  activeLockCount++;
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.jobfillScrollLocked = 'true';
  }
}

export function disableScrollLock(): void {
  activeLockCount = Math.max(0, activeLockCount - 1);
  if (activeLockCount === 0 && typeof document !== 'undefined' && document.documentElement) {
    delete document.documentElement.dataset.jobfillScrollLocked;
  }
}

/**
 * Execute a synchronous action with strict scroll suppression active.
 */
export function withScrollLockSync<T>(action: () => T): T {
  enableScrollLock();
  try {
    return action();
  } finally {
    disableScrollLock();
  }
}

/**
 * Execute an async or sync action with strict scroll suppression active.
 * Guarantees zero programmatic scrolling while preserving user manual scrolls.
 */
export async function withScrollLock<T>(action: () => Promise<T> | T): Promise<T> {
  enableScrollLock();
  try {
    return await action();
  } finally {
    disableScrollLock();
  }
}

/**
 * Safely clicks an element without allowing native browser activation to scroll the page.
 */
export function safeClick(element: HTMLElement): void {
  // Ensure the element is focused with preventScroll before click activation
  try {
    element.focus({ preventScroll: true });
  } catch {}

  const prevX = window.scrollX;
  const prevY = window.scrollY;

  try {
    element.click();
  } catch (err) {
    console.warn('[JobFill ScrollLock] click failed:', err);
  }

  // If native click caused the browser to synchronously scroll the viewport, instantly restore
  if (window.scrollX !== prevX || window.scrollY !== prevY) {
    (origWindowScrollTo as any)?.call(window, { left: prevX, top: prevY, behavior: 'instant' });
  }
}
