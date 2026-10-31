/**
 * Injected into the top frame of a page with chrome.scripting.executeScript.
 * It must stay self-contained: Chrome serialises the function, so it cannot use imports or outer variables.
 *
 * Shows (or hides) the extension popup page as a draggable floating panel that stays open
 * while the user works in the page. Only inline CSSOM styles and DOM calls are used, so strict
 * page CSP / Trusted Types do not stop it. If the page blocks the frame (no READY message
 * from the popup page in time) the panel is removed and 'blocked' is returned so the caller
 * can fall back to the normal toolbar popup.
 */
export type PanelInjectResult = 'opened' | 'closed' | 'blocked';

export function togglePanelInPage(panelUrl: string, mode: 'toggle' | 'open'): Promise<PanelInjectResult> {
  const hostId = 'jobfill-panel-host';
  const existing = document.getElementById(hostId);
  if (existing) {
    if (mode === 'open') return Promise.resolve('opened');
    existing.remove();
    return Promise.resolve('closed');
  }

  return new Promise<PanelInjectResult>((resolve) => {
    const host = document.createElement('div');
    host.id = hostId;
    host.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });

    const box = document.createElement('div');
    box.style.cssText = 'box-sizing:border-box;display:flex;flex-direction:column;width:402px;height:min(630px,calc(100vh - 24px));background:#050b14;border:1px solid #1f3a52;border-radius:10px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.45);';

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;height:28px;flex:none;padding:0 8px;background:#0a1624;color:#7dd3fc;font:600 12px/1 ui-monospace,Menlo,monospace;cursor:move;user-select:none;touch-action:none;';
    const title = document.createElement('span');
    title.textContent = 'MemoraFill';
    const closeButton = document.createElement('button');
    closeButton.textContent = '\u2715';
    closeButton.setAttribute('aria-label', 'Close MemoraFill');
    closeButton.style.cssText = 'border:0;background:transparent;color:#9fb3c8;font-size:14px;line-height:1;cursor:pointer;padding:4px 6px;';
    bar.append(title, closeButton);

    const frame = document.createElement('iframe');
    frame.src = panelUrl;
    frame.style.cssText = 'flex:1;border:0;width:100%;background:#050b14;';

    box.append(bar, frame);
    shadow.append(box);

    // Drag by the title bar. Pointer capture keeps events coming while the cursor is over the iframe.
    bar.addEventListener('pointerdown', (event) => {
      if (event.target === closeButton) return;
      const rect = host.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      bar.setPointerCapture(event.pointerId);
      const move = (moveEvent: PointerEvent) => {
        host.style.left = `${Math.min(Math.max(0, moveEvent.clientX - offsetX), window.innerWidth - 60)}px`;
        host.style.top = `${Math.min(Math.max(0, moveEvent.clientY - offsetY), window.innerHeight - 28)}px`;
        host.style.right = 'auto';
      };
      const stop = () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', stop);
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', stop);
    });

    closeButton.addEventListener('click', () => {
      host.remove();
      chrome.runtime.sendMessage({ type: 'PANEL_CLOSED' }).catch(() => undefined);
    });

    let settled = false;
    const finish = (result: PanelInjectResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      document.removeEventListener('securitypolicyviolation', onViolation);
      clearTimeout(timer);
      if (result === 'blocked') host.remove();
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (event.source === frame.contentWindow && data?.type === 'JOBFILL_PANEL_READY') finish('opened');
    };
    const onViolation = (event: SecurityPolicyViolationEvent) => {
      if (event.blockedURI.includes('chrome-extension')) finish('blocked');
    };
    const timer = setTimeout(() => finish('blocked'), 4000);
    window.addEventListener('message', onMessage);
    document.addEventListener('securitypolicyviolation', onViolation);

    document.documentElement.appendChild(host);
  });
}
