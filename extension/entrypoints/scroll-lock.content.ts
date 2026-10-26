export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    const isLocked = () => document.documentElement?.dataset.jobfillScrollLocked === 'true';

    const origScrollIntoView = Element.prototype.scrollIntoView;
    const origWindowScrollTo = window.scrollTo;
    const origWindowScrollBy = window.scrollBy;
    const origWindowScroll = window.scroll;
    const origElementScrollTo = Element.prototype.scrollTo;
    const origElementScrollBy = Element.prototype.scrollBy;
    const origElementScroll = Element.prototype.scroll;
    const origFocus = HTMLElement.prototype.focus;

    Element.prototype.scrollIntoView = function (...args: any[]) {
      if (isLocked()) {
        return;
      }
      return origScrollIntoView.apply(this, args as any);
    };

    window.scrollTo = function (...args: any[]) {
      if (isLocked()) {
        return;
      }
      return (origWindowScrollTo as any).apply(this, args);
    };

    window.scrollBy = function (...args: any[]) {
      if (isLocked()) {
        return;
      }
      return (origWindowScrollBy as any).apply(this, args);
    };

    window.scroll = function (...args: any[]) {
      if (isLocked()) {
        return;
      }
      return (origWindowScroll as any).apply(this, args);
    };

    Element.prototype.scrollTo = function (...args: any[]) {
      if (isLocked() && (this === document.documentElement || this === document.body)) {
        return;
      }
      return (origElementScrollTo as any).apply(this, args);
    };

    Element.prototype.scrollBy = function (...args: any[]) {
      if (isLocked() && (this === document.documentElement || this === document.body)) {
        return;
      }
      return (origElementScrollBy as any).apply(this, args);
    };

    Element.prototype.scroll = function (...args: any[]) {
      if (isLocked() && (this === document.documentElement || this === document.body)) {
        return;
      }
      return (origElementScroll as any).apply(this, args);
    };

    HTMLElement.prototype.focus = function (options?: FocusOptions) {
      if (isLocked()) {
        return origFocus.call(this, { ...options, preventScroll: true });
      }
      return origFocus.call(this, options);
    };
  },
});
