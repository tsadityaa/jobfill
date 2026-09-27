(function() {
  "use strict";
  function defineContentScript(definition2) {
    return definition2;
  }
  const SENSITIVE_PATTERNS = [
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
    /notice\s*period/i
  ];
  function isSensitiveField(texts) {
    const combined = texts.filter(Boolean).join(" ");
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(combined));
  }
  const FIELD_DICTIONARY = [
    // ---- Personal ----
    {
      profileField: "personal.firstName",
      patterns: [
        /first[_-]?name/i,
        /fname/i,
        /given[_-]?name/i,
        /first/i,
        /forename/i
      ],
      autocompleteValues: ["given-name"]
    },
    {
      profileField: "personal.middleName",
      patterns: [
        /middle[_-]?name/i,
        /mname/i,
        /middle/i
      ],
      autocompleteValues: ["additional-name"]
    },
    {
      profileField: "personal.lastName",
      patterns: [
        /last[_-]?name/i,
        /lname/i,
        /family[_-]?name/i,
        /surname/i,
        /last/i
      ],
      autocompleteValues: ["family-name"]
    },
    {
      profileField: "personal.fullName",
      patterns: [
        /^full[_-]?name$/i,
        /^name$/i,
        /^your[_-]?name$/i,
        /^applicant[_-]?name$/i,
        /^legal[_-]?name$/i,
        /^complete[_-]?name$/i
      ],
      autocompleteValues: ["name"]
    },
    {
      profileField: "personal.dateOfBirth",
      patterns: [
        /^(date[_-]?of[_-]?)?birth$/i,
        /^dob$/i,
        /^birthday$/i,
        /^birth[_-]?date$/i
      ],
      autocompleteValues: ["bday"],
      inputTypes: ["date"]
    },
    // ---- Contact ----
    {
      profileField: "emails.primary",
      patterns: [
        /e[_-]?mail/i,
        /^email[_-]?addr/i,
        /^contact[_-]?email/i
      ],
      autocompleteValues: ["email"],
      inputTypes: ["email"]
    },
    {
      profileField: "phones.primary",
      patterns: [
        /phone/i,
        /mobile/i,
        /^tel$/i,
        /telephone/i,
        /contact[_-]?number/i,
        /mobile[_-]?number/i,
        /phone[_-]?number/i,
        /cell/i
      ],
      autocompleteValues: ["tel", "tel-national"],
      inputTypes: ["tel"]
    },
    // ---- Address ----
    {
      profileField: "addresses.primary.line1",
      patterns: [
        /^address[_-]?(line)?[_-]?1?$/i,
        /^street[_-]?addr/i,
        /^street$/i,
        /^addr1$/i
      ],
      autocompleteValues: ["address-line1", "street-address"]
    },
    {
      profileField: "addresses.primary.line2",
      patterns: [
        /^address[_-]?(line)?[_-]?2$/i,
        /^apt/i,
        /^suite$/i,
        /^addr2$/i,
        /^apartment/i
      ],
      autocompleteValues: ["address-line2"]
    },
    {
      profileField: "addresses.primary.city",
      patterns: [
        /^city$/i,
        /^town$/i,
        /^locality$/i,
        /^municipality$/i
      ],
      autocompleteValues: ["address-level2"]
    },
    {
      profileField: "addresses.primary.state",
      patterns: [
        /^state$/i,
        /^province$/i,
        /^region$/i,
        /^county$/i
      ],
      autocompleteValues: ["address-level1"]
    },
    {
      profileField: "addresses.primary.postalCode",
      patterns: [
        /^(post|zip)[_-]?(code|al)?$/i,
        /^postal$/i,
        /^pin[_-]?code$/i
      ],
      autocompleteValues: ["postal-code"]
    },
    {
      profileField: "addresses.primary.country",
      patterns: [
        /^country$/i,
        /^nation$/i
      ],
      autocompleteValues: ["country", "country-name"]
    },
    // ---- Education ----
    {
      profileField: "education.latest.institution",
      patterns: [
        /^(school|university|college|institution)[_-]?(name)?$/i,
        /^alma[_-]?mater$/i
      ],
      autocompleteValues: []
    },
    {
      profileField: "education.latest.degree",
      patterns: [
        /^degree$/i,
        /^qualification$/i,
        /^degree[_-]?type$/i
      ],
      autocompleteValues: []
    },
    {
      profileField: "education.latest.field",
      patterns: [
        /^(field|area)[_-]?(of)?[_-]?(study|specialization)$/i,
        /^major$/i,
        /^concentration$/i,
        /^discipline$/i,
        /^branch$/i
      ],
      autocompleteValues: []
    },
    {
      profileField: "education.latest.gpa",
      patterns: [
        /^gpa$/i,
        /^cgpa$/i,
        /^grade$/i,
        /^percentage$/i
      ],
      autocompleteValues: []
    },
    // ---- Experience ----
    {
      profileField: "experience.latest.company",
      patterns: [
        /^company$/i,
        /^employer$/i,
        /^organization$/i,
        /^organisation$/i,
        /^company[_-]?name$/i,
        /^current[_-]?employer$/i
      ],
      autocompleteValues: ["organization"]
    },
    {
      profileField: "experience.latest.title",
      patterns: [
        /^(job[_-]?)?(title|position|role|designation)$/i,
        /^current[_-]?title$/i,
        /^current[_-]?position$/i
      ],
      autocompleteValues: ["organization-title"]
    },
    // ---- Professional ----
    {
      profileField: "professional.linkedin",
      patterns: [
        /linkedin/i
      ],
      autocompleteValues: []
    },
    {
      profileField: "professional.github",
      patterns: [
        /github/i
      ],
      autocompleteValues: []
    },
    {
      profileField: "professional.portfolio",
      patterns: [
        /portfolio/i,
        /website/i,
        /personal[_-]?(site|page|url)/i
      ],
      autocompleteValues: ["url"]
    },
    {
      profileField: "professional.skills",
      patterns: [
        /^skills$/i,
        /^key[_-]?skills$/i,
        /^technical[_-]?skills$/i,
        /^competencies$/i
      ],
      autocompleteValues: []
    }
  ];
  function getUniqueSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const path = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = `#${CSS.escape(current.id)}`;
        path.unshift(selector);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      path.unshift(selector);
      current = parent;
    }
    return path.join(" > ");
  }
  function getLabelText(el) {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent?.trim();
    }
    const parentLabel = el.closest("label");
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      const inputs = clone.querySelectorAll("input, select, textarea");
      inputs.forEach((input) => input.remove());
      const text = clone.textContent?.trim();
      if (text) return text;
    }
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.textContent?.trim();
    }
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();
    const prev = el.previousElementSibling;
    if (prev && ["LABEL", "SPAN", "P", "DIV"].includes(prev.tagName)) {
      const text = prev.textContent?.trim();
      if (text && text.length < 100) return text;
    }
    let ancestor = el.parentElement;
    let depth = 0;
    while (ancestor && depth < 6) {
      const textEls = ancestor.querySelectorAll(
        'span, h1, h2, h3, h4, h5, h6, p, legend, [role="heading"], [data-initial-value]'
      );
      for (const textEl of textEls) {
        if (textEl === el || textEl.contains(el) || el.contains(textEl)) continue;
        const text = textEl.textContent?.trim();
        if (text && text.length > 1 && text.length < 200) {
          if (textEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
            return text;
          }
        }
      }
      ancestor = ancestor.parentElement;
      depth++;
    }
    return void 0;
  }
  function matchField(attributes, inputType) {
    let bestMatch = null;
    for (const entry of FIELD_DICTIONARY) {
      let confidence = 0;
      if (attributes.autocomplete && entry.autocompleteValues.includes(attributes.autocomplete)) {
        confidence = Math.max(confidence, 0.95);
      }
      if (entry.inputTypes?.includes(inputType)) {
        confidence = Math.max(confidence, 0.8);
      }
      const namesToCheck = [attributes.name, attributes.id].filter(Boolean);
      for (const name of namesToCheck) {
        if (entry.patterns.some((pattern) => pattern.test(name))) {
          confidence = Math.max(confidence, 0.85);
        }
      }
      const textsToCheck = [
        attributes.placeholder,
        attributes.ariaLabel,
        attributes.labelText
      ].filter(Boolean);
      for (const text of textsToCheck) {
        const normalized = text.replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_");
        if (entry.patterns.some((pattern) => pattern.test(normalized))) {
          confidence = Math.max(confidence, 0.7);
        }
      }
      if (confidence > 0 && (!bestMatch || confidence > bestMatch.confidence)) {
        bestMatch = { profileField: entry.profileField, confidence };
      }
    }
    return bestMatch;
  }
  function scanPageFields() {
    const elements = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]), select, textarea'
    );
    const detected = [];
    for (const el of elements) {
      if (el.offsetParent === null && el.getAttribute("type") !== "hidden") continue;
      const attributes = {
        name: el.getAttribute("name") || void 0,
        id: el.id || void 0,
        autocomplete: el.getAttribute("autocomplete") || void 0,
        placeholder: el.getAttribute("placeholder") || void 0,
        ariaLabel: el.getAttribute("aria-label") || void 0,
        labelText: getLabelText(el)
      };
      const inputType = el instanceof HTMLInputElement ? el.type || "text" : el.tagName.toLowerCase();
      const allTexts = [
        attributes.placeholder,
        attributes.ariaLabel,
        attributes.labelText,
        attributes.name
      ].filter(Boolean);
      const sensitive = isSensitiveField(allTexts);
      if (sensitive) {
        detected.push({
          selector: getUniqueSelector(el),
          tagName: el.tagName.toLowerCase(),
          inputType,
          attributes,
          profileField: null,
          confidence: 0,
          category: "USER_DECISION_REQUIRED",
          currentValue: el.value || ""
        });
        continue;
      }
      const match = matchField(attributes, inputType);
      detected.push({
        selector: getUniqueSelector(el),
        tagName: el.tagName.toLowerCase(),
        inputType,
        attributes,
        profileField: match?.profileField ?? null,
        confidence: match?.confidence ?? 0,
        category: match ? "SAFE_AUTO" : "UNKNOWN",
        currentValue: el.value || ""
      });
    }
    return detected;
  }
  function extractSanitizedFields() {
    const elements = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]), select, textarea'
    );
    const sanitizedFields = [];
    const selectorLookup = {};
    let index = 0;
    for (const el of elements) {
      if (el.offsetParent === null && el.getAttribute("type") !== "hidden") continue;
      const fieldId = `f${index}`;
      const selector = getUniqueSelector(el);
      selectorLookup[fieldId] = selector;
      const sanitized = {
        fieldId,
        tag: el.tagName.toLowerCase(),
        type: el instanceof HTMLInputElement ? el.type || "text" : el.tagName.toLowerCase()
      };
      const labelText = getLabelText(el);
      if (labelText) sanitized.label = labelText;
      const placeholder = el.getAttribute("placeholder");
      if (placeholder) sanitized.placeholder = placeholder;
      const name = el.getAttribute("name");
      if (name) sanitized.name = name;
      const autocomplete = el.getAttribute("autocomplete");
      if (autocomplete) sanitized.autocomplete = autocomplete;
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel) sanitized.ariaLabel = ariaLabel;
      if (el instanceof HTMLSelectElement) {
        sanitized.options = Array.from(el.options).map((opt) => opt.textContent?.trim() ?? "").filter((text) => text.length > 0 && text.length < 100).slice(0, 20);
      }
      sanitizedFields.push(sanitized);
      index++;
    }
    return { sanitizedFields, selectorLookup };
  }
  function dispatchInputEvents(el) {
    el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  }
  function setNativeValue(el, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    if (el instanceof HTMLTextAreaElement && nativeTextareaValueSetter) {
      nativeTextareaValueSetter.call(el, value);
    } else if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }
  }
  function fillSelect(el, value) {
    const normalizedValue = value.toLowerCase().trim();
    for (const option of el.options) {
      const optText = option.textContent?.toLowerCase().trim() ?? "";
      const optValue = option.value.toLowerCase().trim();
      if (optText === normalizedValue || optValue === normalizedValue) {
        el.value = option.value;
        dispatchInputEvents(el);
        return true;
      }
    }
    for (const option of el.options) {
      const optText = option.textContent?.toLowerCase().trim() ?? "";
      if (optText.includes(normalizedValue) || normalizedValue.includes(optText)) {
        el.value = option.value;
        dispatchInputEvents(el);
        return true;
      }
    }
    return false;
  }
  function fillFields(mappings) {
    const results = [];
    let filledCount = 0;
    let errorCount = 0;
    let skippedExisting = 0;
    for (const mapping of mappings) {
      try {
        const el = document.querySelector(mapping.selector);
        if (!el) {
          results.push({
            selector: mapping.selector,
            profileField: mapping.profileField,
            status: "error",
            message: "Element not found"
          });
          errorCount++;
          continue;
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          if (el.value.trim() !== "") {
            results.push({
              selector: mapping.selector,
              profileField: mapping.profileField,
              status: "skipped_existing",
              message: "Field already has a value"
            });
            skippedExisting++;
            continue;
          }
          setNativeValue(el, mapping.value);
          dispatchInputEvents(el);
          el.style.outline = "2px solid #22c55e";
          el.style.outlineOffset = "-2px";
          setTimeout(() => {
            el.style.outline = "";
            el.style.outlineOffset = "";
          }, 2e3);
          results.push({
            selector: mapping.selector,
            profileField: mapping.profileField,
            status: "filled"
          });
          filledCount++;
        } else if (el instanceof HTMLSelectElement) {
          if (fillSelect(el, mapping.value)) {
            results.push({
              selector: mapping.selector,
              profileField: mapping.profileField,
              status: "filled"
            });
            filledCount++;
          } else {
            results.push({
              selector: mapping.selector,
              profileField: mapping.profileField,
              status: "error",
              message: `No matching option for "${mapping.value}"`
            });
            errorCount++;
          }
        }
      } catch (err) {
        results.push({
          selector: mapping.selector,
          profileField: mapping.profileField,
          status: "error",
          message: err instanceof Error ? err.message : "Unknown error"
        });
        errorCount++;
      }
    }
    return {
      totalFields: mappings.length,
      filledFields: filledCount,
      skippedSensitive: 0,
      // Already filtered out before reaching this function
      skippedUnknown: 0,
      skippedExisting,
      errors: errorCount,
      fields: results
    };
  }
  const definition = defineContentScript({
    matches: ["<all_urls>"],
    allFrames: true,
    runAt: "document_idle",
    main() {
      chrome.runtime.onMessage.addListener(
        (message, _sender, sendResponse) => {
          switch (message.type) {
            case "SCAN_FIELDS": {
              const fields = scanPageFields();
              console.log(`[Personal Copilot] Scanned ${window.location.href}: found ${fields.length} fields`);
              const result2 = {
                url: window.location.href,
                totalFields: fields.length,
                mappedFields: fields.filter((f) => f.category === "SAFE_AUTO").length,
                sensitiveFields: fields.filter((f) => f.category === "USER_DECISION_REQUIRED").length,
                unknownFields: fields.filter((f) => f.category === "UNKNOWN").length,
                fields
              };
              sendResponse({ type: "SCAN_FIELDS_RESULT", result: result2 });
              break;
            }
            case "AI_SCAN_FIELDS": {
              const { sanitizedFields, selectorLookup } = extractSanitizedFields();
              sendResponse({
                type: "AI_SCAN_FIELDS_RESULT",
                sanitizedFields,
                selectorLookup
              });
              break;
            }
            case "FILL_FIELDS": {
              const fillResult = fillFields(message.mappings);
              sendResponse({ type: "FILL_FIELDS_RESULT", result: fillResult });
              break;
            }
          }
          return true;
        }
      );
      console.log("[Personal Copilot] Content script loaded.");
    }
  });
  function print$1(method, ...args) {
    if (typeof args[0] === "string") method(`[wxt] ${args.shift()}`, ...args);
    else method("[wxt]", ...args);
  }
  const logger$1 = {
    debug: (...args) => print$1(console.debug, ...args),
    log: (...args) => print$1(console.log, ...args),
    warn: (...args) => print$1(console.warn, ...args),
    error: (...args) => print$1(console.error, ...args)
  };
  const browser$1 = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
  const browser = browser$1;
  var WxtLocationChangeEvent = class WxtLocationChangeEvent2 extends Event {
    static EVENT_NAME = getUniqueEventName("wxt:locationchange");
    constructor(newUrl, oldUrl) {
      super(WxtLocationChangeEvent2.EVENT_NAME, {});
      this.newUrl = newUrl;
      this.oldUrl = oldUrl;
    }
  };
  function getUniqueEventName(eventName) {
    return `${browser?.runtime?.id}:${"content"}:${eventName}`;
  }
  const supportsNavigationApi = typeof globalThis.navigation?.addEventListener === "function";
  function createLocationWatcher(ctx) {
    let lastUrl;
    let watching = false;
    return { run() {
      if (watching) return;
      watching = true;
      lastUrl = new URL(location.href);
      if (supportsNavigationApi) globalThis.navigation.addEventListener("navigate", (event) => {
        const newUrl = new URL(event.destination.url);
        if (newUrl.href === lastUrl.href) return;
        window.dispatchEvent(new WxtLocationChangeEvent(newUrl, lastUrl));
        lastUrl = newUrl;
      }, { signal: ctx.signal });
      else ctx.setInterval(() => {
        const newUrl = new URL(location.href);
        if (newUrl.href !== lastUrl.href) {
          window.dispatchEvent(new WxtLocationChangeEvent(newUrl, lastUrl));
          lastUrl = newUrl;
        }
      }, 1e3);
    } };
  }
  var ContentScriptContext = class ContentScriptContext2 {
    static SCRIPT_STARTED_MESSAGE_TYPE = getUniqueEventName("wxt:content-script-started");
    id;
    abortController;
    locationWatcher = createLocationWatcher(this);
    constructor(contentScriptName, options) {
      this.contentScriptName = contentScriptName;
      this.options = options;
      this.id = Math.random().toString(36).slice(2);
      this.abortController = new AbortController();
      this.stopOldScripts();
      this.listenForNewerScripts();
    }
    get signal() {
      return this.abortController.signal;
    }
    abort(reason) {
      return this.abortController.abort(reason);
    }
    get isInvalid() {
      if (browser.runtime?.id == null) this.notifyInvalidated();
      return this.signal.aborted;
    }
    get isValid() {
      return !this.isInvalid;
    }
    /**
    * Add a listener that is called when the content script's context is
    * invalidated.
    *
    * @example
    *   browser.runtime.onMessage.addListener(cb);
    *   const removeInvalidatedListener = ctx.onInvalidated(() => {
    *     browser.runtime.onMessage.removeListener(cb);
    *   });
    *   // ...
    *   removeInvalidatedListener();
    *
    * @returns A function to remove the listener.
    */
    onInvalidated(cb) {
      this.signal.addEventListener("abort", cb);
      return () => this.signal.removeEventListener("abort", cb);
    }
    /**
    * Return a promise that never resolves. Useful if you have an async function
    * that shouldn't run after the context is expired.
    *
    * @example
    *   const getValueFromStorage = async () => {
    *     if (ctx.isInvalid) return ctx.block();
    *
    *     // ...
    *   };
    */
    block() {
      return new Promise(() => {
      });
    }
    /**
    * Wrapper around `window.setInterval` that automatically clears the interval
    * when invalidated.
    *
    * Intervals can be cleared by calling the normal `clearInterval` function.
    */
    setInterval(handler, timeout) {
      const id = setInterval(() => {
        if (this.isValid) handler();
      }, timeout);
      this.onInvalidated(() => clearInterval(id));
      return id;
    }
    /**
    * Wrapper around `window.setTimeout` that automatically clears the interval
    * when invalidated.
    *
    * Timeouts can be cleared by calling the normal `setTimeout` function.
    */
    setTimeout(handler, timeout) {
      const id = setTimeout(() => {
        if (this.isValid) handler();
      }, timeout);
      this.onInvalidated(() => clearTimeout(id));
      return id;
    }
    /**
    * Wrapper around `window.requestAnimationFrame` that automatically cancels
    * the request when invalidated.
    *
    * Callbacks can be canceled by calling the normal `cancelAnimationFrame`
    * function.
    */
    requestAnimationFrame(callback) {
      const id = requestAnimationFrame((...args) => {
        if (this.isValid) callback(...args);
      });
      this.onInvalidated(() => cancelAnimationFrame(id));
      return id;
    }
    /**
    * Wrapper around `window.requestIdleCallback` that automatically cancels the
    * request when invalidated.
    *
    * Callbacks can be canceled by calling the normal `cancelIdleCallback`
    * function.
    */
    requestIdleCallback(callback, options) {
      const id = requestIdleCallback((...args) => {
        if (!this.signal.aborted) callback(...args);
      }, options);
      this.onInvalidated(() => cancelIdleCallback(id));
      return id;
    }
    addEventListener(target, type, handler, options) {
      if (type === "wxt:locationchange") {
        if (this.isValid) this.locationWatcher.run();
      }
      target.addEventListener?.(type.startsWith("wxt:") ? getUniqueEventName(type) : type, handler, {
        ...options,
        signal: this.signal
      });
    }
    /**
    * @internal
    * Abort the abort controller and execute all `onInvalidated` listeners.
    */
    notifyInvalidated() {
      this.abort("Content script context invalidated");
      logger$1.debug(`Content script "${this.contentScriptName}" context invalidated`);
    }
    stopOldScripts() {
      document.dispatchEvent(new CustomEvent(ContentScriptContext2.SCRIPT_STARTED_MESSAGE_TYPE, { detail: {
        contentScriptName: this.contentScriptName,
        messageId: this.id
      } }));
      if (!this.options?.noScriptStartedPostMessage) window.postMessage({
        type: ContentScriptContext2.SCRIPT_STARTED_MESSAGE_TYPE,
        contentScriptName: this.contentScriptName,
        messageId: this.id
      }, "*");
    }
    verifyScriptStartedEvent(event) {
      const isSameContentScript = event.detail?.contentScriptName === this.contentScriptName;
      const isFromSelf = event.detail?.messageId === this.id;
      return isSameContentScript && !isFromSelf;
    }
    listenForNewerScripts() {
      const cb = (event) => {
        if (!(event instanceof CustomEvent) || !this.verifyScriptStartedEvent(event)) return;
        this.notifyInvalidated();
      };
      document.addEventListener(ContentScriptContext2.SCRIPT_STARTED_MESSAGE_TYPE, cb);
      this.onInvalidated(() => document.removeEventListener(ContentScriptContext2.SCRIPT_STARTED_MESSAGE_TYPE, cb));
    }
  };
  function initPlugins() {
  }
  function print(method, ...args) {
    if (typeof args[0] === "string") method(`[wxt] ${args.shift()}`, ...args);
    else method("[wxt]", ...args);
  }
  const logger = {
    debug: (...args) => print(console.debug, ...args),
    log: (...args) => print(console.log, ...args),
    warn: (...args) => print(console.warn, ...args),
    error: (...args) => print(console.error, ...args)
  };
  const result = (async () => {
    try {
      initPlugins();
      const { main, ...options } = definition;
      return await main(new ContentScriptContext("content", options));
    } catch (err) {
      logger.error(`The content script "${"content"}" crashed on startup!`, err);
      throw err;
    }
  })();
  return result;
})();
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGVudC5qcyIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vbm9kZV9tb2R1bGVzL3d4dC9kaXN0L3V0aWxzL2RlZmluZS1jb250ZW50LXNjcmlwdC5tanMiLCIuLi8uLi8uLi91dGlscy9zZW5zaXRpdmVGaWVsZHMudHMiLCIuLi8uLi8uLi91dGlscy9maWVsZERldGVjdG9yLnRzIiwiLi4vLi4vLi4vdXRpbHMvZm9ybUZpbGxlci50cyIsIi4uLy4uLy4uL2VudHJ5cG9pbnRzL2NvbnRlbnQudHMiLCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvd3h0L2Rpc3QvdXRpbHMvaW50ZXJuYWwvbG9nZ2VyLm1qcyIsIi4uLy4uLy4uLy4uL25vZGVfbW9kdWxlcy9Ad3h0LWRldi9icm93c2VyL3NyYy9pbmRleC5tanMiLCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvd3h0L2Rpc3QvYnJvd3Nlci5tanMiLCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvd3h0L2Rpc3QvdXRpbHMvaW50ZXJuYWwvY3VzdG9tLWV2ZW50cy5tanMiLCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvd3h0L2Rpc3QvdXRpbHMvaW50ZXJuYWwvbG9jYXRpb24td2F0Y2hlci5tanMiLCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvd3h0L2Rpc3QvdXRpbHMvY29udGVudC1zY3JpcHQtY29udGV4dC5tanMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8jcmVnaW9uIHNyYy91dGlscy9kZWZpbmUtY29udGVudC1zY3JpcHQudHNcbmZ1bmN0aW9uIGRlZmluZUNvbnRlbnRTY3JpcHQoZGVmaW5pdGlvbikge1xuXHRyZXR1cm4gZGVmaW5pdGlvbjtcbn1cbi8vI2VuZHJlZ2lvblxuZXhwb3J0IHsgZGVmaW5lQ29udGVudFNjcmlwdCB9O1xuIiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTZW5zaXRpdmUgRmllbGQgRGV0ZWN0aW9uXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEZpZWxkcyBtYXRjaGluZyB0aGVzZSBwYXR0ZXJucyBzaG91bGQgTkVWRVIgYmUgYXV0by1maWxsZWQuXG4vLyBUaGV5IHJlcXVpcmUgZXhwbGljaXQgdXNlciBpbnB1dCAobGVnYWwsIGNvbnNlbnQsIGlkZW50aXR5KS5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIFBhdHRlcm5zIHRoYXQgaW5kaWNhdGUgYSBmaWVsZCByZXF1aXJlcyBhIHVzZXIgZGVjaXNpb24uXG4gKiBDaGVja2VkIGFnYWluc3Q6IGxhYmVsIHRleHQsIHBsYWNlaG9sZGVyLCBhcmlhLWxhYmVsLCBuZWFyYnkgdGV4dC5cbiAqL1xuZXhwb3J0IGNvbnN0IFNFTlNJVElWRV9QQVRURVJOUzogUmVnRXhwW10gPSBbXG4gIC8vIFdvcmsgYXV0aG9yaXphdGlvbiAmIHZpc2FcbiAgL2F1dGhvcml6ZWQ/XFxzKih0byk/XFxzKndvcmsvaSxcbiAgL3dvcmtcXHMqYXV0aG9yaXovaSxcbiAgL3Zpc2FcXHMqc3BvbnNvci9pLFxuICAvcmVxdWlyZVxccypzcG9uc29yL2ksXG4gIC9pbW1pZ3JhdGlvblxccypzdGF0dXMvaSxcbiAgL3dvcmtcXHMqcGVybWl0L2ksXG4gIC9lbXBsb3ltZW50XFxzKmVsaWdpYi9pLFxuXG4gIC8vIExlZ2FsIGRlY2xhcmF0aW9uc1xuICAvY3JpbWluYWxcXHMqKHJlY29yZHxoaXN0b3J5fGNvbnZpY3Rpb258YmFja2dyb3VuZCkvaSxcbiAgL2ZlbG9ueS9pLFxuICAvbWlzZGVtZWFub3IvaSxcbiAgL2xlZ2FsXFxzKihhY3Rpb258cHJvY2VlZGluZykvaSxcbiAgL2xhd3N1aXQvaSxcbiAgL2xpdGlnYXRpb24vaSxcblxuICAvLyBEaXNhYmlsaXR5ICYgaGVhbHRoXG4gIC9kaXNhYmlsaXQoeXxpZXMpL2ksXG4gIC9oYW5kaWNhcC9pLFxuICAvYWNjb21tb2RhdGlvbi9pLFxuICAvbWVkaWNhbFxccypjb25kaXRpb24vaSxcblxuICAvLyBWZXRlcmFuIHN0YXR1c1xuICAvdmV0ZXJhbi9pLFxuICAvbWlsaXRhcnlcXHMqc2VydmljZS9pLFxuICAvYXJtZWRcXHMqZm9yY2VzL2ksXG5cbiAgLy8gQ29uc2VudCAmIGFncmVlbWVudFxuICAvXFxiY29uc2VudFxcYi9pLFxuICAvXFxiYWdyZWUobWVudCk/XFxiL2ksXG4gIC90ZXJtc1xccyooYW5kfCYpXFxzKmNvbmRpdGlvbi9pLFxuICAvcHJpdmFjeVxccypwb2xpY3kvaSxcbiAgL2Fja25vd2xlZGdlL2ksXG4gIC9jZXJ0aWYoeXxpY2F0aW9uKS9pLFxuICAvYXR0ZXN0L2ksXG4gIC9cXGJkZWNsYXJlP1xcYi9pLFxuXG4gIC8vIFNhbGFyeSAmIGNvbXBlbnNhdGlvblxuICAvc2FsYXJ5XFxzKihleHBlY3RhdGlvbnxyZXF1aXJlbWVudHxkZXNpcmVkfGV4cGVjdGVkfHJhbmdlKS9pLFxuICAvZXhwZWN0ZWRcXHMqY29tcGVuc2F0aW9uL2ksXG4gIC9kZXNpcmVkXFxzKnBheS9pLFxuICAvY3VycmVudFxccypzYWxhcnkvaSxcbiAgL3BheVxccypleHBlY3RhdGlvbi9pLFxuICAvY29tcGVuc2F0aW9uXFxzKmV4cGVjdGF0aW9uL2ksXG4gIC9jdGMvaSxcblxuICAvLyBEZW1vZ3JhcGhpYyAoRUVPKVxuICAvXFxiZ2VuZGVyXFxiL2ksXG4gIC9cXGJzZXhcXGIvaSxcbiAgL1xcYnJhY2VcXGIvaSxcbiAgL1xcYmV0aG5pY2l0eVxcYi9pLFxuICAvc2V4dWFsXFxzKm9yaWVudGF0aW9uL2ksXG4gIC9tYXJpdGFsXFxzKnN0YXR1cy9pLFxuICAvcmVsaWdpb24vaSxcbiAgL25hdGlvbmFsXFxzKm9yaWdpbi9pLFxuICAvY2FzdGUvaSxcblxuICAvLyBSZWZlcnJhbCAmIG1pc2NcbiAgL2hvd1xccypkaWRcXHMqeW91XFxzKihoZWFyfGZpbmR8bGVhcm4pL2ksXG4gIC9yZWZlcnIoYWx8ZWQpL2ksXG4gIC93aWxsaW5nXFxzKnRvXFxzKnJlbG9jYXRlL2ksXG4gIC9hdmFpbGFibGVcXHMqdG9cXHMqc3RhcnQvaSxcbiAgL3N0YXJ0XFxzKmRhdGUvaSxcbiAgL25vdGljZVxccypwZXJpb2QvaSxcbl07XG5cbi8qKlxuICogQ2hlY2sgaWYgYSBmaWVsZCdzIHN1cnJvdW5kaW5nIHRleHQgaW5kaWNhdGVzIGEgc2Vuc2l0aXZlIHF1ZXN0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTZW5zaXRpdmVGaWVsZCh0ZXh0czogc3RyaW5nW10pOiBib29sZWFuIHtcbiAgY29uc3QgY29tYmluZWQgPSB0ZXh0cy5maWx0ZXIoQm9vbGVhbikuam9pbignICcpO1xuICByZXR1cm4gU0VOU0lUSVZFX1BBVFRFUk5TLnNvbWUoKHBhdHRlcm4pID0+IHBhdHRlcm4udGVzdChjb21iaW5lZCkpO1xufVxuIiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBGaWVsZCBEZXRlY3RvciDigJQgTGF5ZXIgMSAmIDJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTGF5ZXIgMTogSFRNTCBhdHRyaWJ1dGVzIChuYW1lLCBpZCwgYXV0b2NvbXBsZXRlLCB0eXBlLCBldGMuKVxuLy8gTGF5ZXIgMjogS25vd24gZGljdGlvbmFyeSBvZiBmaWVsZCBuYW1lIHBhdHRlcm5zXG4vLyBMYXllciAzOiBTZW1hbnRpYyBtYXRjaGluZyAoUGhhc2UgNSDigJQgQUkgYWdlbnQpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuaW1wb3J0IHR5cGUgeyBEZXRlY3RlZEZpZWxkLCBQcm9maWxlRmllbGRLZXksIEZpZWxkQ2F0ZWdvcnkgfSBmcm9tICcuLi90eXBlcy9hdXRvZmlsbCc7XG5pbXBvcnQgeyBpc1NlbnNpdGl2ZUZpZWxkIH0gZnJvbSAnLi9zZW5zaXRpdmVGaWVsZHMnO1xuXG4vLyAtLS0tIExheWVyIDI6IEtub3duIGRpY3Rpb25hcnkgLS0tLVxuXG5pbnRlcmZhY2UgRmllbGRQYXR0ZXJuIHtcbiAgcHJvZmlsZUZpZWxkOiBQcm9maWxlRmllbGRLZXk7XG4gIHBhdHRlcm5zOiBSZWdFeHBbXTtcbiAgYXV0b2NvbXBsZXRlVmFsdWVzOiBzdHJpbmdbXTtcbiAgaW5wdXRUeXBlcz86IHN0cmluZ1tdO1xufVxuXG5jb25zdCBGSUVMRF9ESUNUSU9OQVJZOiBGaWVsZFBhdHRlcm5bXSA9IFtcbiAgLy8gLS0tLSBQZXJzb25hbCAtLS0tXG4gIHtcbiAgICBwcm9maWxlRmllbGQ6ICdwZXJzb25hbC5maXJzdE5hbWUnLFxuICAgIHBhdHRlcm5zOiBbXG4gICAgICAvZmlyc3RbXy1dP25hbWUvaSxcbiAgICAgIC9mbmFtZS9pLFxuICAgICAgL2dpdmVuW18tXT9uYW1lL2ksXG4gICAgICAvZmlyc3QvaSxcbiAgICAgIC9mb3JlbmFtZS9pLFxuICAgIF0sXG4gICAgYXV0b2NvbXBsZXRlVmFsdWVzOiBbJ2dpdmVuLW5hbWUnXSxcbiAgfSxcbiAge1xuICAgIHByb2ZpbGVGaWVsZDogJ3BlcnNvbmFsLm1pZGRsZU5hbWUnLFxuICAgIHBhdHRlcm5zOiBbXG4gICAgICAvbWlkZGxlW18tXT9uYW1lL2ksXG4gICAgICAvbW5hbWUvaSxcbiAgICAgIC9taWRkbGUvaSxcbiAgICBdLFxuICAgIGF1dG9jb21wbGV0ZVZhbHVlczogWydhZGRpdGlvbmFsLW5hbWUnXSxcbiAgfSxcbiAge1xuICAgIHByb2ZpbGVGaWVsZDogJ3BlcnNvbmFsLmxhc3ROYW1lJyxcbiAgICBwYXR0ZXJuczogW1xuICAgICAgL2xhc3RbXy1dP25hbWUvaSxcbiAgICAgIC9sbmFtZS9pLFxuICAgICAgL2ZhbWlseVtfLV0/bmFtZS9pLFxuICAgICAgL3N1cm5hbWUvaSxcbiAgICAgIC9sYXN0L2ksXG4gICAgXSxcbiAgICBhdXRvY29tcGxldGVWYWx1ZXM6IFsnZmFtaWx5LW5hbWUnXSxcbiAgfSxcbiAge1xuICAgIHByb2ZpbGVGaWVsZDogJ3BlcnNvbmFsLmZ1bGxOYW1lJyxcbiAgICBwYXR0ZXJuczogW1xuICAgICAgL15mdWxsW18tXT9uYW1lJC9pLFxuICAgICAgL15uYW1lJC9pLFxuICAgICAgL155b3VyW18tXT9uYW1lJC9pLFxuICAgICAgL15hcHBsaWNhbnRbXy1dP25hbWUkL2ksXG4gICAgICAvXmxlZ2FsW18tXT9uYW1lJC9pLFxuICAgICAgL15jb21wbGV0ZVtfLV0/bmFtZSQvaSxcbiAgICBdLFxuICAgIGF1dG9jb21wbGV0ZVZhbHVlczogWyduYW1lJ10sXG4gIH0sXG4gIHtcbiAgICBwcm9maWxlRmllbGQ6ICdwZXJzb25hbC5kYXRlT2ZCaXJ0aCcsXG4gICAgcGF0dGVybnM6IFtcbiAgICAgIC9eKGRhdGVbXy1dP29mW18tXT8pP2JpcnRoJC9pLFxuICAgICAgL15kb2IkL2ksXG4gICAgICAvXmJpcnRoZGF5JC9pLFxuICAgICAgL15iaXJ0aFtfLV0/ZGF0ZSQvaSxcbiAgICBdLFxuICAgIGF1dG9jb21wbGV0ZVZhbHVlczogWydiZGF5J10sXG4gICAgaW5wdXRUeXBlczogWydkYXRlJ10sXG4gIH0sXG5cbiAgLy8gLS0tLSBDb250YWN0IC0tLS1cbiAge1xuICAgIHByb2ZpbGVGaWVsZDogJ2VtYWlscy5wcmltYXJ5JyxcbiAgICBwYXR0ZXJuczogW1xuICAgICAgL2VbXy1dP21haWwvaSxcbiAgICAgIC9eZW1haWxbXy1dP2FkZHIvaSxcbiAgICAgIC9eY29udGFjdFtfLV0/ZW1haWwvaSxcbiAgICBdLFxuICAgIGF1dG9jb21wbGV0ZVZhbHVlczogWydlbWFpbCddLFxuICAgIGlucHV0VHlwZXM6IFsnZW1haWwnXSxcbiAgfSxcbiAge1xuICAgIHByb2ZpbGVGaWVsZDogJ3Bob25lcy5wcmltYXJ5JyxcbiAgICBwYXR0ZXJuczogW1xuICAgICAgL3Bob25lL2ksXG4gICAgICAvbW9iaWxlL2ksXG4gICAgICAvXnRlbCQvaSxcbiAgICAgIC90ZWxlcGhvbmUvaSxcbiAgICAgIC9jb250YWN0W18tXT9udW1iZXIvaSxcbiAgICAgIC9tb2JpbGVbXy1dP251bWJlci9pLFxuICAgICAgL3Bob25lW18tXT9udW1iZXIvaSxcbiAgICAgIC9jZWxsL2ksXG4gICAgXSxcbiAgICBhdXRvY29tcGxldGVWYWx1ZXM6IFsndGVsJywgJ3RlbC1uYXRpb25hbCddLFxuICAgIGlucHV0VHlwZXM6IFsndGVsJ10sXG4gIH0sXG5cbiAgLy8gLS0tLSBBZGRyZXNzIC0tLS1cbiAge1xuICAgIHByb2ZpbGVGaWVsZDogJ2FkZHJlc3Nlcy5wcmltYXJ5LmxpbmUxJyxcbiAgICBwYXR0ZXJuczogW1xuICAgICAgL15hZGRyZXNzW18tXT8obGluZSk/W18tXT8xPyQvaSxcbiAgICAgIC9ec3RyZWV0W18tXT9hZGRyL2ksXG4gICAgICAvXnN0cmVldCQvaSxcbiAgICAgIC9eYWRkcjEkL2ksXG4gICAgXSxcbiAgICBhdXRvY29tcGxldGVWYWx1ZXM6IFsnYWRkcmVzcy1saW5lMScsICdzdHJlZXQtYWRkcmVzcyddLFxuICB9LFxuICB7XG4gICAgcHJvZmlsZUZpZWxkOiAnYWRkcmVzc2VzLnByaW1hcnkubGluZTInLFxuICAgIHBhdHRlcm5zOiBbXG4gICAgICAvXmFkZHJlc3NbXy1dPyhsaW5lKT9bXy1dPzIkL2ksXG4gICAgICAvXmFwdC9pLFxuICAgICAgL15zdWl0ZSQvaSxcbiAgICAgIC9eYWRkcjIkL2ksXG4gICAgICAvXmFwYXJ0bWVudC9pLFxuICAgIF0sXG4gICAgYXV0b2NvbXBsZXRlVmFsdWVzOiBbJ2FkZHJlc3MtbGluZTInXSxcbiAgfSxcbiAge1xuICAgIHByb2ZpbGVGaWVsZDogJ2FkZHJlc3Nlcy5wcmltYXJ5LmNpdHknLFxuICAgIHBhdHRlcm5zOiBbXG4gICAgICAvXmNpdHkkL2ksXG4gICAgICAvXnRvd24kL2ksXG4gICAgICAvXmxvY2FsaXR5JC9pLFxuICAgICAgL15tdW5pY2lwYWxpdHkkL2ksXG4gICAgXSxcbiAgICBhdXRvY29tcGxldGVWYWx1ZXM6IFsnYWRkcmVzcy1sZXZlbDInXSxcbiAgfSxcbiAge1xuICAgIHByb2ZpbGVGaWVsZDogJ2FkZHJlc3Nlcy5wcmltYXJ5LnN0YXRlJyxcbiAgICBwYXR0ZXJuczogW1xuICAgICAgL15zdGF0ZSQvaSxcbiAgICAgIC9ecHJvdmluY2UkL2ksXG4gICAgICAvXnJlZ2lvbiQvaSxcbiAgICAgIC9eY291bnR5JC9pLFxuICAgIF0sXG4gICAgYXV0b2NvbXBsZXRlVmFsdWVzOiBbJ2FkZHJlc3MtbGV2ZWwxJ10sXG4gIH0sXG4gIHtcbiAgICBwcm9maWxlRmllbGQ6ICdhZGRyZXNzZXMucHJpbWFyeS5wb3N0YWxDb2RlJyxcbiAgICBwYXR0ZXJuczogW1xuICAgICAgL14ocG9zdHx6aXApW18tXT8oY29kZXxhbCk/JC9pLFxuICAgICAgL15wb3N0YWwkL2ksXG4gICAgICAvXnBpbltfLV0/Y29kZSQvaSxcbiAgICBdLFxuICAgIGF1dG9jb21wbGV0ZVZhbHVlczogWydwb3N0YWwtY29kZSddLFxuICB9LFxuICB7XG4gICAgcHJvZmlsZUZpZWxkOiAnYWRkcmVzc2VzLnByaW1hcnkuY291bnRyeScsXG4gICAgcGF0dGVybnM6IFtcbiAgICAgIC9eY291bnRyeSQvaSxcbiAgICAgIC9ebmF0aW9uJC9pLFxuICAgIF0sXG4gICAgYXV0b2NvbXBsZXRlVmFsdWVzOiBbJ2NvdW50cnknLCAnY291bnRyeS1uYW1lJ10sXG4gIH0sXG5cbiAgLy8gLS0tLSBFZHVjYXRpb24gLS0tLVxuICB7XG4gICAgcHJvZmlsZUZpZWxkOiAnZWR1Y2F0aW9uLmxhdGVzdC5pbnN0aXR1dGlvbicsXG4gICAgcGF0dGVybnM6IFtcbiAgICAgIC9eKHNjaG9vbHx1bml2ZXJzaXR5fGNvbGxlZ2V8aW5zdGl0dXRpb24pW18tXT8obmFtZSk/JC9pLFxuICAgICAgL15hbG1hW18tXT9tYXRlciQvaSxcbiAgICBdLFxuICAgIGF1dG9jb21wbGV0ZVZhbHVlczogW10sXG4gIH0sXG4gIHtcbiAgICBwcm9maWxlRmllbGQ6ICdlZHVjYXRpb24ubGF0ZXN0LmRlZ3JlZScsXG4gICAgcGF0dGVybnM6IFtcbiAgICAgIC9eZGVncmVlJC9pLFxuICAgICAgL15xdWFsaWZpY2F0aW9uJC9pLFxuICAgICAgL15kZWdyZWVbXy1dP3R5cGUkL2ksXG4gICAgXSxcbiAgICBhdXRvY29tcGxldGVWYWx1ZXM6IFtdLFxuICB9LFxuICB7XG4gICAgcHJvZmlsZUZpZWxkOiAnZWR1Y2F0aW9uLmxhdGVzdC5maWVsZCcsXG4gICAgcGF0dGVybnM6IFtcbiAgICAgIC9eKGZpZWxkfGFyZWEpW18tXT8ob2YpP1tfLV0/KHN0dWR5fHNwZWNpYWxpemF0aW9uKSQvaSxcbiAgICAgIC9ebWFqb3IkL2ksXG4gICAgICAvXmNvbmNlbnRyYXRpb24kL2ksXG4gICAgICAvXmRpc2NpcGxpbmUkL2ksXG4gICAgICAvXmJyYW5jaCQvaSxcbiAgICBdLFxuICAgIGF1dG9jb21wbGV0ZVZhbHVlczogW10sXG4gIH0sXG4gIHtcbiAgICBwcm9maWxlRmllbGQ6ICdlZHVjYXRpb24ubGF0ZXN0LmdwYScsXG4gICAgcGF0dGVybnM6IFtcbiAgICAgIC9eZ3BhJC9pLFxuICAgICAgL15jZ3BhJC9pLFxuICAgICAgL15ncmFkZSQvaSxcbiAgICAgIC9ecGVyY2VudGFnZSQvaSxcbiAgICBdLFxuICAgIGF1dG9jb21wbGV0ZVZhbHVlczogW10sXG4gIH0sXG5cbiAgLy8gLS0tLSBFeHBlcmllbmNlIC0tLS1cbiAge1xuICAgIHByb2ZpbGVGaWVsZDogJ2V4cGVyaWVuY2UubGF0ZXN0LmNvbXBhbnknLFxuICAgIHBhdHRlcm5zOiBbXG4gICAgICAvXmNvbXBhbnkkL2ksXG4gICAgICAvXmVtcGxveWVyJC9pLFxuICAgICAgL15vcmdhbml6YXRpb24kL2ksXG4gICAgICAvXm9yZ2FuaXNhdGlvbiQvaSxcbiAgICAgIC9eY29tcGFueVtfLV0/bmFtZSQvaSxcbiAgICAgIC9eY3VycmVudFtfLV0/ZW1wbG95ZXIkL2ksXG4gICAgXSxcbiAgICBhdXRvY29tcGxldGVWYWx1ZXM6IFsnb3JnYW5pemF0aW9uJ10sXG4gIH0sXG4gIHtcbiAgICBwcm9maWxlRmllbGQ6ICdleHBlcmllbmNlLmxhdGVzdC50aXRsZScsXG4gICAgcGF0dGVybnM6IFtcbiAgICAgIC9eKGpvYltfLV0/KT8odGl0bGV8cG9zaXRpb258cm9sZXxkZXNpZ25hdGlvbikkL2ksXG4gICAgICAvXmN1cnJlbnRbXy1dP3RpdGxlJC9pLFxuICAgICAgL15jdXJyZW50W18tXT9wb3NpdGlvbiQvaSxcbiAgICBdLFxuICAgIGF1dG9jb21wbGV0ZVZhbHVlczogWydvcmdhbml6YXRpb24tdGl0bGUnXSxcbiAgfSxcblxuICAvLyAtLS0tIFByb2Zlc3Npb25hbCAtLS0tXG4gIHtcbiAgICBwcm9maWxlRmllbGQ6ICdwcm9mZXNzaW9uYWwubGlua2VkaW4nLFxuICAgIHBhdHRlcm5zOiBbXG4gICAgICAvbGlua2VkaW4vaSxcbiAgICBdLFxuICAgIGF1dG9jb21wbGV0ZVZhbHVlczogW10sXG4gIH0sXG4gIHtcbiAgICBwcm9maWxlRmllbGQ6ICdwcm9mZXNzaW9uYWwuZ2l0aHViJyxcbiAgICBwYXR0ZXJuczogW1xuICAgICAgL2dpdGh1Yi9pLFxuICAgIF0sXG4gICAgYXV0b2NvbXBsZXRlVmFsdWVzOiBbXSxcbiAgfSxcbiAge1xuICAgIHByb2ZpbGVGaWVsZDogJ3Byb2Zlc3Npb25hbC5wb3J0Zm9saW8nLFxuICAgIHBhdHRlcm5zOiBbXG4gICAgICAvcG9ydGZvbGlvL2ksXG4gICAgICAvd2Vic2l0ZS9pLFxuICAgICAgL3BlcnNvbmFsW18tXT8oc2l0ZXxwYWdlfHVybCkvaSxcbiAgICBdLFxuICAgIGF1dG9jb21wbGV0ZVZhbHVlczogWyd1cmwnXSxcbiAgfSxcbiAge1xuICAgIHByb2ZpbGVGaWVsZDogJ3Byb2Zlc3Npb25hbC5za2lsbHMnLFxuICAgIHBhdHRlcm5zOiBbXG4gICAgICAvXnNraWxscyQvaSxcbiAgICAgIC9ea2V5W18tXT9za2lsbHMkL2ksXG4gICAgICAvXnRlY2huaWNhbFtfLV0/c2tpbGxzJC9pLFxuICAgICAgL15jb21wZXRlbmNpZXMkL2ksXG4gICAgXSxcbiAgICBhdXRvY29tcGxldGVWYWx1ZXM6IFtdLFxuICB9LFxuXTtcblxuLy8gLS0tLSBDb3JlIERldGVjdGlvbiBGdW5jdGlvbnMgLS0tLVxuXG4vKipcbiAqIEdlbmVyYXRlIGEgdW5pcXVlIENTUyBzZWxlY3RvciBmb3IgYW4gZWxlbWVudC5cbiAqL1xuZnVuY3Rpb24gZ2V0VW5pcXVlU2VsZWN0b3IoZWw6IEVsZW1lbnQpOiBzdHJpbmcge1xuICBpZiAoZWwuaWQpIHJldHVybiBgIyR7Q1NTLmVzY2FwZShlbC5pZCl9YDtcblxuICBjb25zdCBwYXRoOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY3VycmVudDogRWxlbWVudCB8IG51bGwgPSBlbDtcbiAgd2hpbGUgKGN1cnJlbnQgJiYgY3VycmVudCAhPT0gZG9jdW1lbnQuYm9keSkge1xuICAgIGxldCBzZWxlY3RvciA9IGN1cnJlbnQudGFnTmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChjdXJyZW50LmlkKSB7XG4gICAgICBzZWxlY3RvciA9IGAjJHtDU1MuZXNjYXBlKGN1cnJlbnQuaWQpfWA7XG4gICAgICBwYXRoLnVuc2hpZnQoc2VsZWN0b3IpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGNvbnN0IHBhcmVudCA9IGN1cnJlbnQucGFyZW50RWxlbWVudDtcbiAgICBpZiAocGFyZW50KSB7XG4gICAgICBjb25zdCBzaWJsaW5ncyA9IEFycmF5LmZyb20ocGFyZW50LmNoaWxkcmVuKS5maWx0ZXIoXG4gICAgICAgIChjKSA9PiBjLnRhZ05hbWUgPT09IGN1cnJlbnQhLnRhZ05hbWUsXG4gICAgICApO1xuICAgICAgaWYgKHNpYmxpbmdzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgY29uc3QgaW5kZXggPSBzaWJsaW5ncy5pbmRleE9mKGN1cnJlbnQpICsgMTtcbiAgICAgICAgc2VsZWN0b3IgKz0gYDpudGgtb2YtdHlwZSgke2luZGV4fSlgO1xuICAgICAgfVxuICAgIH1cbiAgICBwYXRoLnVuc2hpZnQoc2VsZWN0b3IpO1xuICAgIGN1cnJlbnQgPSBwYXJlbnQ7XG4gIH1cbiAgcmV0dXJuIHBhdGguam9pbignID4gJyk7XG59XG5cbi8qKlxuICogR2V0IHRoZSBsYWJlbCB0ZXh0IGFzc29jaWF0ZWQgd2l0aCBhIGZvcm0gZWxlbWVudC5cbiAqIEhhbmRsZXMgc3RhbmRhcmQgbGFiZWxzLCBhcmlhIGF0dHJpYnV0ZXMsIEFORCBub24tc3RhbmRhcmQgcGF0dGVybnNcbiAqIGxpa2UgR29vZ2xlIEZvcm1zICh3aGVyZSBsYWJlbHMgYXJlIGRpdnMvc3BhbnMgaW4gYW5jZXN0b3IgY29udGFpbmVycykuXG4gKi9cbmZ1bmN0aW9uIGdldExhYmVsVGV4dChlbDogSFRNTEVsZW1lbnQpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAvLyAxLiBDaGVjayBmb3IgPGxhYmVsIGZvcj1cIi4uLlwiPlxuICBpZiAoZWwuaWQpIHtcbiAgICBjb25zdCBsYWJlbCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoYGxhYmVsW2Zvcj1cIiR7Q1NTLmVzY2FwZShlbC5pZCl9XCJdYCk7XG4gICAgaWYgKGxhYmVsKSByZXR1cm4gbGFiZWwudGV4dENvbnRlbnQ/LnRyaW0oKTtcbiAgfVxuXG4gIC8vIDIuIENoZWNrIGZvciB3cmFwcGluZyA8bGFiZWw+XG4gIGNvbnN0IHBhcmVudExhYmVsID0gZWwuY2xvc2VzdCgnbGFiZWwnKTtcbiAgaWYgKHBhcmVudExhYmVsKSB7XG4gICAgY29uc3QgY2xvbmUgPSBwYXJlbnRMYWJlbC5jbG9uZU5vZGUodHJ1ZSkgYXMgSFRNTEVsZW1lbnQ7XG4gICAgY29uc3QgaW5wdXRzID0gY2xvbmUucXVlcnlTZWxlY3RvckFsbCgnaW5wdXQsIHNlbGVjdCwgdGV4dGFyZWEnKTtcbiAgICBpbnB1dHMuZm9yRWFjaCgoaW5wdXQpID0+IGlucHV0LnJlbW92ZSgpKTtcbiAgICBjb25zdCB0ZXh0ID0gY2xvbmUudGV4dENvbnRlbnQ/LnRyaW0oKTtcbiAgICBpZiAodGV4dCkgcmV0dXJuIHRleHQ7XG4gIH1cblxuICAvLyAzLiBDaGVjayBhcmlhLWxhYmVsbGVkYnlcbiAgY29uc3QgbGFiZWxsZWRCeSA9IGVsLmdldEF0dHJpYnV0ZSgnYXJpYS1sYWJlbGxlZGJ5Jyk7XG4gIGlmIChsYWJlbGxlZEJ5KSB7XG4gICAgY29uc3QgbGFiZWxFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGxhYmVsbGVkQnkpO1xuICAgIGlmIChsYWJlbEVsKSByZXR1cm4gbGFiZWxFbC50ZXh0Q29udGVudD8udHJpbSgpO1xuICB9XG5cbiAgLy8gNC4gQ2hlY2sgYXJpYS1sYWJlbCBkaXJlY3RseVxuICBjb25zdCBhcmlhTGFiZWwgPSBlbC5nZXRBdHRyaWJ1dGUoJ2FyaWEtbGFiZWwnKTtcbiAgaWYgKGFyaWFMYWJlbCkgcmV0dXJuIGFyaWFMYWJlbC50cmltKCk7XG5cbiAgLy8gNS4gQ2hlY2sgcHJlY2VkaW5nIHNpYmxpbmcgdGV4dFxuICBjb25zdCBwcmV2ID0gZWwucHJldmlvdXNFbGVtZW50U2libGluZztcbiAgaWYgKHByZXYgJiYgWydMQUJFTCcsICdTUEFOJywgJ1AnLCAnRElWJ10uaW5jbHVkZXMocHJldi50YWdOYW1lKSkge1xuICAgIGNvbnN0IHRleHQgPSBwcmV2LnRleHRDb250ZW50Py50cmltKCk7XG4gICAgaWYgKHRleHQgJiYgdGV4dC5sZW5ndGggPCAxMDApIHJldHVybiB0ZXh0O1xuICB9XG5cbiAgLy8gNi4gV2FsayB1cCBhbmNlc3RvcnMgdG8gZmluZCB0aGUgY2xvc2VzdCBcInF1ZXN0aW9uIGNvbnRhaW5lclwiXG4gIC8vICAgIFRoaXMgaGFuZGxlcyBHb29nbGUgRm9ybXMsIFR5cGVmb3JtLCBjdXN0b20gUmVhY3QgZm9ybXMsIGV0Yy5cbiAgLy8gICAgd2hlcmUgdGhlIGxhYmVsIGlzIGluIGEgc2libGluZy9jb3VzaW4gZGl2LCBub3QgYSA8bGFiZWw+IHRhZy5cbiAgbGV0IGFuY2VzdG9yOiBIVE1MRWxlbWVudCB8IG51bGwgPSBlbC5wYXJlbnRFbGVtZW50O1xuICBsZXQgZGVwdGggPSAwO1xuICB3aGlsZSAoYW5jZXN0b3IgJiYgZGVwdGggPCA2KSB7XG4gICAgLy8gTG9vayBmb3IgdGV4dC1iZWFyaW5nIGVsZW1lbnRzIGJlZm9yZSB0aGUgaW5wdXQgd2l0aGluIHRoaXMgYW5jZXN0b3JcbiAgICBjb25zdCB0ZXh0RWxzID0gYW5jZXN0b3IucXVlcnlTZWxlY3RvckFsbChcbiAgICAgICdzcGFuLCBoMSwgaDIsIGgzLCBoNCwgaDUsIGg2LCBwLCBsZWdlbmQsIFtyb2xlPVwiaGVhZGluZ1wiXSwgW2RhdGEtaW5pdGlhbC12YWx1ZV0nLFxuICAgICk7XG4gICAgZm9yIChjb25zdCB0ZXh0RWwgb2YgdGV4dEVscykge1xuICAgICAgLy8gU2tpcCBpZiB0aGUgdGV4dCBlbGVtZW50IGlzIGluc2lkZSBvciBJUyB0aGUgaW5wdXRcbiAgICAgIGlmICh0ZXh0RWwgPT09IGVsIHx8IHRleHRFbC5jb250YWlucyhlbCkgfHwgZWwuY29udGFpbnModGV4dEVsKSkgY29udGludWU7XG4gICAgICAvLyBTa2lwIHRpbnkgb3IgaHVnZSB0ZXh0XG4gICAgICBjb25zdCB0ZXh0ID0gdGV4dEVsLnRleHRDb250ZW50Py50cmltKCk7XG4gICAgICBpZiAodGV4dCAmJiB0ZXh0Lmxlbmd0aCA+IDEgJiYgdGV4dC5sZW5ndGggPCAyMDApIHtcbiAgICAgICAgLy8gTWFrZSBzdXJlIHRoaXMgdGV4dCBlbGVtZW50IGNvbWVzIEJFRk9SRSB0aGUgaW5wdXQgaW4gRE9NIG9yZGVyXG4gICAgICAgIGlmICh0ZXh0RWwuY29tcGFyZURvY3VtZW50UG9zaXRpb24oZWwpICYgTm9kZS5ET0NVTUVOVF9QT1NJVElPTl9GT0xMT1dJTkcpIHtcbiAgICAgICAgICByZXR1cm4gdGV4dDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBhbmNlc3RvciA9IGFuY2VzdG9yLnBhcmVudEVsZW1lbnQ7XG4gICAgZGVwdGgrKztcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogTWF0Y2ggYW4gZWxlbWVudCBhZ2FpbnN0IHRoZSBmaWVsZCBkaWN0aW9uYXJ5LlxuICogUmV0dXJucyB0aGUgYmVzdCBtYXRjaCB3aXRoIGNvbmZpZGVuY2Ugc2NvcmUuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoRmllbGQoXG4gIGF0dHJpYnV0ZXM6IERldGVjdGVkRmllbGRbJ2F0dHJpYnV0ZXMnXSxcbiAgaW5wdXRUeXBlOiBzdHJpbmcsXG4pOiB7IHByb2ZpbGVGaWVsZDogUHJvZmlsZUZpZWxkS2V5OyBjb25maWRlbmNlOiBudW1iZXIgfSB8IG51bGwge1xuICBsZXQgYmVzdE1hdGNoOiB7IHByb2ZpbGVGaWVsZDogUHJvZmlsZUZpZWxkS2V5OyBjb25maWRlbmNlOiBudW1iZXIgfSB8IG51bGwgPSBudWxsO1xuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgRklFTERfRElDVElPTkFSWSkge1xuICAgIGxldCBjb25maWRlbmNlID0gMDtcblxuICAgIC8vIExheWVyIDE6IGF1dG9jb21wbGV0ZSBhdHRyaWJ1dGUgKGhpZ2hlc3QgY29uZmlkZW5jZSlcbiAgICBpZiAoXG4gICAgICBhdHRyaWJ1dGVzLmF1dG9jb21wbGV0ZSAmJlxuICAgICAgZW50cnkuYXV0b2NvbXBsZXRlVmFsdWVzLmluY2x1ZGVzKGF0dHJpYnV0ZXMuYXV0b2NvbXBsZXRlKVxuICAgICkge1xuICAgICAgY29uZmlkZW5jZSA9IE1hdGgubWF4KGNvbmZpZGVuY2UsIDAuOTUpO1xuICAgIH1cblxuICAgIC8vIExheWVyIDE6IGlucHV0IHR5cGUgbWF0Y2hcbiAgICBpZiAoZW50cnkuaW5wdXRUeXBlcz8uaW5jbHVkZXMoaW5wdXRUeXBlKSkge1xuICAgICAgY29uZmlkZW5jZSA9IE1hdGgubWF4KGNvbmZpZGVuY2UsIDAuOCk7XG4gICAgfVxuXG4gICAgLy8gTGF5ZXIgMjogbmFtZS9pZCBwYXR0ZXJuIG1hdGNoaW5nXG4gICAgY29uc3QgbmFtZXNUb0NoZWNrID0gW2F0dHJpYnV0ZXMubmFtZSwgYXR0cmlidXRlcy5pZF0uZmlsdGVyKEJvb2xlYW4pIGFzIHN0cmluZ1tdO1xuICAgIGZvciAoY29uc3QgbmFtZSBvZiBuYW1lc1RvQ2hlY2spIHtcbiAgICAgIGlmIChlbnRyeS5wYXR0ZXJucy5zb21lKChwYXR0ZXJuKSA9PiBwYXR0ZXJuLnRlc3QobmFtZSkpKSB7XG4gICAgICAgIGNvbmZpZGVuY2UgPSBNYXRoLm1heChjb25maWRlbmNlLCAwLjg1KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBMYXllciAyOiBwbGFjZWhvbGRlciAvIGFyaWEtbGFiZWwgLyBsYWJlbCB0ZXh0IG1hdGNoaW5nXG4gICAgY29uc3QgdGV4dHNUb0NoZWNrID0gW1xuICAgICAgYXR0cmlidXRlcy5wbGFjZWhvbGRlcixcbiAgICAgIGF0dHJpYnV0ZXMuYXJpYUxhYmVsLFxuICAgICAgYXR0cmlidXRlcy5sYWJlbFRleHQsXG4gICAgXS5maWx0ZXIoQm9vbGVhbikgYXMgc3RyaW5nW107XG4gICAgZm9yIChjb25zdCB0ZXh0IG9mIHRleHRzVG9DaGVjaykge1xuICAgICAgLy8gTm9ybWFsaXplOiByZW1vdmUgc3BlY2lhbCBjaGFycywgY29sbGFwc2Ugd2hpdGVzcGFjZVxuICAgICAgY29uc3Qgbm9ybWFsaXplZCA9IHRleHQucmVwbGFjZSgvW15hLXpBLVowLTlcXHNdL2csICcnKS5yZXBsYWNlKC9cXHMrL2csICdfJyk7XG4gICAgICBpZiAoZW50cnkucGF0dGVybnMuc29tZSgocGF0dGVybikgPT4gcGF0dGVybi50ZXN0KG5vcm1hbGl6ZWQpKSkge1xuICAgICAgICBjb25maWRlbmNlID0gTWF0aC5tYXgoY29uZmlkZW5jZSwgMC43KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY29uZmlkZW5jZSA+IDAgJiYgKCFiZXN0TWF0Y2ggfHwgY29uZmlkZW5jZSA+IGJlc3RNYXRjaC5jb25maWRlbmNlKSkge1xuICAgICAgYmVzdE1hdGNoID0geyBwcm9maWxlRmllbGQ6IGVudHJ5LnByb2ZpbGVGaWVsZCwgY29uZmlkZW5jZSB9O1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBiZXN0TWF0Y2g7XG59XG5cbi8qKlxuICogU2NhbiB0aGUgY3VycmVudCBwYWdlIGZvciBhbGwgZmlsbGFibGUgZm9ybSBmaWVsZHMuXG4gKiBSZXR1cm5zIGRldGVjdGVkIGZpZWxkcyB3aXRoIHRoZWlyIG1hdGNoZWQgcHJvZmlsZSBrZXlzIGFuZCBjYXRlZ29yaWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2NhblBhZ2VGaWVsZHMoKTogRGV0ZWN0ZWRGaWVsZFtdIHtcbiAgY29uc3QgZWxlbWVudHMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxJbnB1dEVsZW1lbnQgfCBIVE1MU2VsZWN0RWxlbWVudCB8IEhUTUxUZXh0QXJlYUVsZW1lbnQ+KFxuICAgICdpbnB1dDpub3QoW3R5cGU9XCJoaWRkZW5cIl0pOm5vdChbdHlwZT1cInN1Ym1pdFwiXSk6bm90KFt0eXBlPVwiYnV0dG9uXCJdKTpub3QoW3R5cGU9XCJyZXNldFwiXSk6bm90KFt0eXBlPVwiaW1hZ2VcIl0pOm5vdChbdHlwZT1cImZpbGVcIl0pLCBzZWxlY3QsIHRleHRhcmVhJyxcbiAgKTtcblxuICBjb25zdCBkZXRlY3RlZDogRGV0ZWN0ZWRGaWVsZFtdID0gW107XG5cbiAgZm9yIChjb25zdCBlbCBvZiBlbGVtZW50cykge1xuICAgIC8vIFNraXAgaW52aXNpYmxlIGVsZW1lbnRzXG4gICAgaWYgKGVsLm9mZnNldFBhcmVudCA9PT0gbnVsbCAmJiBlbC5nZXRBdHRyaWJ1dGUoJ3R5cGUnKSAhPT0gJ2hpZGRlbicpIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgYXR0cmlidXRlczogRGV0ZWN0ZWRGaWVsZFsnYXR0cmlidXRlcyddID0ge1xuICAgICAgbmFtZTogZWwuZ2V0QXR0cmlidXRlKCduYW1lJykgfHwgdW5kZWZpbmVkLFxuICAgICAgaWQ6IGVsLmlkIHx8IHVuZGVmaW5lZCxcbiAgICAgIGF1dG9jb21wbGV0ZTogZWwuZ2V0QXR0cmlidXRlKCdhdXRvY29tcGxldGUnKSB8fCB1bmRlZmluZWQsXG4gICAgICBwbGFjZWhvbGRlcjogZWwuZ2V0QXR0cmlidXRlKCdwbGFjZWhvbGRlcicpIHx8IHVuZGVmaW5lZCxcbiAgICAgIGFyaWFMYWJlbDogZWwuZ2V0QXR0cmlidXRlKCdhcmlhLWxhYmVsJykgfHwgdW5kZWZpbmVkLFxuICAgICAgbGFiZWxUZXh0OiBnZXRMYWJlbFRleHQoZWwpLFxuICAgIH07XG5cbiAgICBjb25zdCBpbnB1dFR5cGUgPSBlbCBpbnN0YW5jZW9mIEhUTUxJbnB1dEVsZW1lbnQgPyAoZWwudHlwZSB8fCAndGV4dCcpIDogZWwudGFnTmFtZS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgLy8gQ2hlY2sgZm9yIHNlbnNpdGl2ZSBmaWVsZHMgZmlyc3RcbiAgICBjb25zdCBhbGxUZXh0cyA9IFtcbiAgICAgIGF0dHJpYnV0ZXMucGxhY2Vob2xkZXIsXG4gICAgICBhdHRyaWJ1dGVzLmFyaWFMYWJlbCxcbiAgICAgIGF0dHJpYnV0ZXMubGFiZWxUZXh0LFxuICAgICAgYXR0cmlidXRlcy5uYW1lLFxuICAgIF0uZmlsdGVyKEJvb2xlYW4pIGFzIHN0cmluZ1tdO1xuXG4gICAgY29uc3Qgc2Vuc2l0aXZlID0gaXNTZW5zaXRpdmVGaWVsZChhbGxUZXh0cyk7XG5cbiAgICBpZiAoc2Vuc2l0aXZlKSB7XG4gICAgICBkZXRlY3RlZC5wdXNoKHtcbiAgICAgICAgc2VsZWN0b3I6IGdldFVuaXF1ZVNlbGVjdG9yKGVsKSxcbiAgICAgICAgdGFnTmFtZTogZWwudGFnTmFtZS50b0xvd2VyQ2FzZSgpLFxuICAgICAgICBpbnB1dFR5cGUsXG4gICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgIHByb2ZpbGVGaWVsZDogbnVsbCxcbiAgICAgICAgY29uZmlkZW5jZTogMCxcbiAgICAgICAgY2F0ZWdvcnk6ICdVU0VSX0RFQ0lTSU9OX1JFUVVJUkVEJyxcbiAgICAgICAgY3VycmVudFZhbHVlOiBlbC52YWx1ZSB8fCAnJyxcbiAgICAgIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gVHJ5IHRvIG1hdGNoIGZpZWxkXG4gICAgY29uc3QgbWF0Y2ggPSBtYXRjaEZpZWxkKGF0dHJpYnV0ZXMsIGlucHV0VHlwZSk7XG5cbiAgICBkZXRlY3RlZC5wdXNoKHtcbiAgICAgIHNlbGVjdG9yOiBnZXRVbmlxdWVTZWxlY3RvcihlbCksXG4gICAgICB0YWdOYW1lOiBlbC50YWdOYW1lLnRvTG93ZXJDYXNlKCksXG4gICAgICBpbnB1dFR5cGUsXG4gICAgICBhdHRyaWJ1dGVzLFxuICAgICAgcHJvZmlsZUZpZWxkOiBtYXRjaD8ucHJvZmlsZUZpZWxkID8/IG51bGwsXG4gICAgICBjb25maWRlbmNlOiBtYXRjaD8uY29uZmlkZW5jZSA/PyAwLFxuICAgICAgY2F0ZWdvcnk6IG1hdGNoID8gJ1NBRkVfQVVUTycgOiAnVU5LTk9XTicsXG4gICAgICBjdXJyZW50VmFsdWU6IGVsLnZhbHVlIHx8ICcnLFxuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIGRldGVjdGVkO1xufVxuXG4vLyAtLS0tIEFJIExheWVyOiBTYW5pdGl6ZWQgRmllbGQgRXh0cmFjdGlvbiAtLS0tXG5cbmltcG9ydCB0eXBlIHsgU2FuaXRpemVkRmllbGQsIEZpZWxkSWRMb29rdXAgfSBmcm9tICcuLi90eXBlcy9haU1hcHBlcic7XG5cbi8qKlxuICogRXh0cmFjdCBzYW5pdGl6ZWQgZmllbGQgZGVzY3JpcHRvcnMgZm9yIEFJIG1hcHBpbmcuXG4gKiBERUxJQkVSQVRFTFkgc3RyaXBzOiB2YWx1ZXMsIHRleHRDb250ZW50LCBzdXJyb3VuZGluZyBwYWdlIHRleHQuXG4gKiBSZXR1cm5zOlxuICogICAtIHNhbml0aXplZEZpZWxkczogc2FmZSB0byBzZW5kIHRvIEFJXG4gKiAgIC0gc2VsZWN0b3JMb29rdXA6IGxvY2FsLW9ubHkgbWFwIChmaWVsZElkIOKGkiBDU1Mgc2VsZWN0b3IpLCBORVZFUiBzZW50IGFueXdoZXJlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0U2FuaXRpemVkRmllbGRzKCk6IHtcbiAgc2FuaXRpemVkRmllbGRzOiBTYW5pdGl6ZWRGaWVsZFtdO1xuICBzZWxlY3Rvckxvb2t1cDogRmllbGRJZExvb2t1cDtcbn0ge1xuICBjb25zdCBlbGVtZW50cyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTElucHV0RWxlbWVudCB8IEhUTUxTZWxlY3RFbGVtZW50IHwgSFRNTFRleHRBcmVhRWxlbWVudD4oXG4gICAgJ2lucHV0Om5vdChbdHlwZT1cImhpZGRlblwiXSk6bm90KFt0eXBlPVwic3VibWl0XCJdKTpub3QoW3R5cGU9XCJidXR0b25cIl0pOm5vdChbdHlwZT1cInJlc2V0XCJdKTpub3QoW3R5cGU9XCJpbWFnZVwiXSk6bm90KFt0eXBlPVwiZmlsZVwiXSksIHNlbGVjdCwgdGV4dGFyZWEnLFxuICApO1xuXG4gIGNvbnN0IHNhbml0aXplZEZpZWxkczogU2FuaXRpemVkRmllbGRbXSA9IFtdO1xuICBjb25zdCBzZWxlY3Rvckxvb2t1cDogRmllbGRJZExvb2t1cCA9IHt9O1xuICBsZXQgaW5kZXggPSAwO1xuXG4gIGZvciAoY29uc3QgZWwgb2YgZWxlbWVudHMpIHtcbiAgICAvLyBTa2lwIGludmlzaWJsZSBlbGVtZW50c1xuICAgIGlmIChlbC5vZmZzZXRQYXJlbnQgPT09IG51bGwgJiYgZWwuZ2V0QXR0cmlidXRlKCd0eXBlJykgIT09ICdoaWRkZW4nKSBjb250aW51ZTtcblxuICAgIGNvbnN0IGZpZWxkSWQgPSBgZiR7aW5kZXh9YDtcbiAgICBjb25zdCBzZWxlY3RvciA9IGdldFVuaXF1ZVNlbGVjdG9yKGVsKTtcbiAgICBzZWxlY3Rvckxvb2t1cFtmaWVsZElkXSA9IHNlbGVjdG9yO1xuXG4gICAgY29uc3Qgc2FuaXRpemVkOiBTYW5pdGl6ZWRGaWVsZCA9IHtcbiAgICAgIGZpZWxkSWQsXG4gICAgICB0YWc6IGVsLnRhZ05hbWUudG9Mb3dlckNhc2UoKSxcbiAgICAgIHR5cGU6IGVsIGluc3RhbmNlb2YgSFRNTElucHV0RWxlbWVudCA/IChlbC50eXBlIHx8ICd0ZXh0JykgOiBlbC50YWdOYW1lLnRvTG93ZXJDYXNlKCksXG4gICAgfTtcblxuICAgIC8vIExhYmVsIHRleHQgKHNhZmUg4oCUIGl0J3MgdGhlIHZpc2libGUgZm9ybSBsYWJlbCwgbm90IHVzZXIgZGF0YSlcbiAgICBjb25zdCBsYWJlbFRleHQgPSBnZXRMYWJlbFRleHQoZWwpO1xuICAgIGlmIChsYWJlbFRleHQpIHNhbml0aXplZC5sYWJlbCA9IGxhYmVsVGV4dDtcblxuICAgIC8vIFBsYWNlaG9sZGVyIChzYWZlIOKAlCBpdCdzIGRldmVsb3Blci1zZXQgaGludCB0ZXh0KVxuICAgIGNvbnN0IHBsYWNlaG9sZGVyID0gZWwuZ2V0QXR0cmlidXRlKCdwbGFjZWhvbGRlcicpO1xuICAgIGlmIChwbGFjZWhvbGRlcikgc2FuaXRpemVkLnBsYWNlaG9sZGVyID0gcGxhY2Vob2xkZXI7XG5cbiAgICAvLyBOYW1lIGF0dHJpYnV0ZSAoc2FmZSDigJQgaXQncyB0aGUgSFRNTCBmaWVsZCBuYW1lKVxuICAgIGNvbnN0IG5hbWUgPSBlbC5nZXRBdHRyaWJ1dGUoJ25hbWUnKTtcbiAgICBpZiAobmFtZSkgc2FuaXRpemVkLm5hbWUgPSBuYW1lO1xuXG4gICAgLy8gQXV0b2NvbXBsZXRlIGF0dHJpYnV0ZVxuICAgIGNvbnN0IGF1dG9jb21wbGV0ZSA9IGVsLmdldEF0dHJpYnV0ZSgnYXV0b2NvbXBsZXRlJyk7XG4gICAgaWYgKGF1dG9jb21wbGV0ZSkgc2FuaXRpemVkLmF1dG9jb21wbGV0ZSA9IGF1dG9jb21wbGV0ZTtcblxuICAgIC8vIEFyaWEtbGFiZWxcbiAgICBjb25zdCBhcmlhTGFiZWwgPSBlbC5nZXRBdHRyaWJ1dGUoJ2FyaWEtbGFiZWwnKTtcbiAgICBpZiAoYXJpYUxhYmVsKSBzYW5pdGl6ZWQuYXJpYUxhYmVsID0gYXJpYUxhYmVsO1xuXG4gICAgLy8gRm9yIDxzZWxlY3Q+OiBpbmNsdWRlIG9wdGlvbiBsYWJlbCB0ZXh0cyAoTk9UIHZhbHVlcywgTk9UIHNlbGVjdGVkIHN0YXRlKVxuICAgIGlmIChlbCBpbnN0YW5jZW9mIEhUTUxTZWxlY3RFbGVtZW50KSB7XG4gICAgICBzYW5pdGl6ZWQub3B0aW9ucyA9IEFycmF5LmZyb20oZWwub3B0aW9ucylcbiAgICAgICAgLm1hcCgob3B0KSA9PiBvcHQudGV4dENvbnRlbnQ/LnRyaW0oKSA/PyAnJylcbiAgICAgICAgLmZpbHRlcigodGV4dCkgPT4gdGV4dC5sZW5ndGggPiAwICYmIHRleHQubGVuZ3RoIDwgMTAwKVxuICAgICAgICAuc2xpY2UoMCwgMjApOyAvLyBDYXAgYXQgMjAgb3B0aW9ucyB0byBzYXZlIHRva2Vuc1xuICAgIH1cblxuICAgIHNhbml0aXplZEZpZWxkcy5wdXNoKHNhbml0aXplZCk7XG4gICAgaW5kZXgrKztcbiAgfVxuXG4gIHJldHVybiB7IHNhbml0aXplZEZpZWxkcywgc2VsZWN0b3JMb29rdXAgfTtcbn1cbiIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRm9ybSBGaWxsZXJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRmlsbHMgZm9ybSBmaWVsZHMgd2l0aCBtYXBwZWQgdmFsdWVzLCBkaXNwYXRjaGluZyBhcHByb3ByaWF0ZVxuLy8gZXZlbnRzIHNvIFJlYWN0L0FuZ3VsYXIvVnVlIGZvcm1zIGRldGVjdCB0aGUgY2hhbmdlcy5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5pbXBvcnQgdHlwZSB7IEZpZWxkTWFwcGluZywgQXV0b2ZpbGxSZXN1bHQsIEF1dG9maWxsRmllbGRSZXN1bHQgfSBmcm9tICcuLi90eXBlcy9hdXRvZmlsbCc7XG5cbi8qKlxuICogRGlzcGF0Y2ggbmF0aXZlIERPTSBldmVudHMgdGhhdCBmcmFtZXdvcmtzIGxpc3RlbiB0by5cbiAqIFRoaXMgZW5zdXJlcyBSZWFjdCwgQW5ndWxhciwgVnVlLCBldGMuIGRldGVjdCB0aGUgdmFsdWUgY2hhbmdlLlxuICovXG5mdW5jdGlvbiBkaXNwYXRjaElucHV0RXZlbnRzKGVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAvLyBGb2N1c1xuICBlbC5kaXNwYXRjaEV2ZW50KG5ldyBGb2N1c0V2ZW50KCdmb2N1cycsIHsgYnViYmxlczogdHJ1ZSB9KSk7XG4gIGVsLmRpc3BhdGNoRXZlbnQobmV3IEZvY3VzRXZlbnQoJ2ZvY3VzaW4nLCB7IGJ1YmJsZXM6IHRydWUgfSkpO1xuXG4gIC8vIElucHV0ICsgQ2hhbmdlXG4gIGVsLmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCdpbnB1dCcsIHsgYnViYmxlczogdHJ1ZSB9KSk7XG4gIGVsLmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCdjaGFuZ2UnLCB7IGJ1YmJsZXM6IHRydWUgfSkpO1xuXG4gIC8vIEJsdXJcbiAgZWwuZGlzcGF0Y2hFdmVudChuZXcgRm9jdXNFdmVudCgnYmx1cicsIHsgYnViYmxlczogdHJ1ZSB9KSk7XG4gIGVsLmRpc3BhdGNoRXZlbnQobmV3IEZvY3VzRXZlbnQoJ2ZvY3Vzb3V0JywgeyBidWJibGVzOiB0cnVlIH0pKTtcbn1cblxuLyoqXG4gKiBTZXQgdGhlIHZhbHVlIG9mIGEgbmF0aXZlIGlucHV0IHVzaW5nIHRoZSBuYXRpdmUgc2V0dGVyLlxuICogVGhpcyBpcyByZXF1aXJlZCBmb3IgUmVhY3QgY29udHJvbGxlZCBjb21wb25lbnRzLlxuICovXG5mdW5jdGlvbiBzZXROYXRpdmVWYWx1ZShlbDogSFRNTElucHV0RWxlbWVudCB8IEhUTUxUZXh0QXJlYUVsZW1lbnQsIHZhbHVlOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgbmF0aXZlSW5wdXRWYWx1ZVNldHRlciA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoXG4gICAgd2luZG93LkhUTUxJbnB1dEVsZW1lbnQucHJvdG90eXBlLFxuICAgICd2YWx1ZScsXG4gICk/LnNldDtcbiAgY29uc3QgbmF0aXZlVGV4dGFyZWFWYWx1ZVNldHRlciA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoXG4gICAgd2luZG93LkhUTUxUZXh0QXJlYUVsZW1lbnQucHJvdG90eXBlLFxuICAgICd2YWx1ZScsXG4gICk/LnNldDtcblxuICBpZiAoZWwgaW5zdGFuY2VvZiBIVE1MVGV4dEFyZWFFbGVtZW50ICYmIG5hdGl2ZVRleHRhcmVhVmFsdWVTZXR0ZXIpIHtcbiAgICBuYXRpdmVUZXh0YXJlYVZhbHVlU2V0dGVyLmNhbGwoZWwsIHZhbHVlKTtcbiAgfSBlbHNlIGlmIChuYXRpdmVJbnB1dFZhbHVlU2V0dGVyKSB7XG4gICAgbmF0aXZlSW5wdXRWYWx1ZVNldHRlci5jYWxsKGVsLCB2YWx1ZSk7XG4gIH0gZWxzZSB7XG4gICAgZWwudmFsdWUgPSB2YWx1ZTtcbiAgfVxufVxuXG4vKipcbiAqIEZpbGwgYSA8c2VsZWN0PiBlbGVtZW50IGJ5IG1hdGNoaW5nIG9wdGlvbiB0ZXh0IG9yIHZhbHVlLlxuICovXG5mdW5jdGlvbiBmaWxsU2VsZWN0KGVsOiBIVE1MU2VsZWN0RWxlbWVudCwgdmFsdWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBjb25zdCBub3JtYWxpemVkVmFsdWUgPSB2YWx1ZS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcblxuICBmb3IgKGNvbnN0IG9wdGlvbiBvZiBlbC5vcHRpb25zKSB7XG4gICAgY29uc3Qgb3B0VGV4dCA9IG9wdGlvbi50ZXh0Q29udGVudD8udG9Mb3dlckNhc2UoKS50cmltKCkgPz8gJyc7XG4gICAgY29uc3Qgb3B0VmFsdWUgPSBvcHRpb24udmFsdWUudG9Mb3dlckNhc2UoKS50cmltKCk7XG5cbiAgICBpZiAob3B0VGV4dCA9PT0gbm9ybWFsaXplZFZhbHVlIHx8IG9wdFZhbHVlID09PSBub3JtYWxpemVkVmFsdWUpIHtcbiAgICAgIGVsLnZhbHVlID0gb3B0aW9uLnZhbHVlO1xuICAgICAgZGlzcGF0Y2hJbnB1dEV2ZW50cyhlbCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICAvLyBGdXp6eSBtYXRjaDogY2hlY2sgaWYgb3B0aW9uIHRleHQgY29udGFpbnMgdGhlIHZhbHVlIG9yIHZpY2UgdmVyc2FcbiAgZm9yIChjb25zdCBvcHRpb24gb2YgZWwub3B0aW9ucykge1xuICAgIGNvbnN0IG9wdFRleHQgPSBvcHRpb24udGV4dENvbnRlbnQ/LnRvTG93ZXJDYXNlKCkudHJpbSgpID8/ICcnO1xuICAgIGlmIChvcHRUZXh0LmluY2x1ZGVzKG5vcm1hbGl6ZWRWYWx1ZSkgfHwgbm9ybWFsaXplZFZhbHVlLmluY2x1ZGVzKG9wdFRleHQpKSB7XG4gICAgICBlbC52YWx1ZSA9IG9wdGlvbi52YWx1ZTtcbiAgICAgIGRpc3BhdGNoSW5wdXRFdmVudHMoZWwpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIEZpbGwgYWxsIG1hcHBlZCBmaWVsZHMgb24gdGhlIHBhZ2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaWxsRmllbGRzKG1hcHBpbmdzOiBGaWVsZE1hcHBpbmdbXSk6IEF1dG9maWxsUmVzdWx0IHtcbiAgY29uc3QgcmVzdWx0czogQXV0b2ZpbGxGaWVsZFJlc3VsdFtdID0gW107XG4gIGxldCBmaWxsZWRDb3VudCA9IDA7XG4gIGxldCBlcnJvckNvdW50ID0gMDtcbiAgbGV0IHNraXBwZWRFeGlzdGluZyA9IDA7XG5cbiAgZm9yIChjb25zdCBtYXBwaW5nIG9mIG1hcHBpbmdzKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGVsID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihtYXBwaW5nLnNlbGVjdG9yKTtcbiAgICAgIGlmICghZWwpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzZWxlY3RvcjogbWFwcGluZy5zZWxlY3RvcixcbiAgICAgICAgICBwcm9maWxlRmllbGQ6IG1hcHBpbmcucHJvZmlsZUZpZWxkLFxuICAgICAgICAgIHN0YXR1czogJ2Vycm9yJyxcbiAgICAgICAgICBtZXNzYWdlOiAnRWxlbWVudCBub3QgZm91bmQnLFxuICAgICAgICB9KTtcbiAgICAgICAgZXJyb3JDb3VudCsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgLy8gU2tpcCBmaWVsZHMgdGhhdCBhbHJlYWR5IGhhdmUgdmFsdWVzXG4gICAgICBpZiAoZWwgaW5zdGFuY2VvZiBIVE1MSW5wdXRFbGVtZW50IHx8IGVsIGluc3RhbmNlb2YgSFRNTFRleHRBcmVhRWxlbWVudCkge1xuICAgICAgICBpZiAoZWwudmFsdWUudHJpbSgpICE9PSAnJykge1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBzZWxlY3RvcjogbWFwcGluZy5zZWxlY3RvcixcbiAgICAgICAgICAgIHByb2ZpbGVGaWVsZDogbWFwcGluZy5wcm9maWxlRmllbGQsXG4gICAgICAgICAgICBzdGF0dXM6ICdza2lwcGVkX2V4aXN0aW5nJyxcbiAgICAgICAgICAgIG1lc3NhZ2U6ICdGaWVsZCBhbHJlYWR5IGhhcyBhIHZhbHVlJyxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBza2lwcGVkRXhpc3RpbmcrKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNldE5hdGl2ZVZhbHVlKGVsLCBtYXBwaW5nLnZhbHVlKTtcbiAgICAgICAgZGlzcGF0Y2hJbnB1dEV2ZW50cyhlbCk7XG5cbiAgICAgICAgLy8gVmlzdWFsIGZlZWRiYWNrXG4gICAgICAgIGVsLnN0eWxlLm91dGxpbmUgPSAnMnB4IHNvbGlkICMyMmM1NWUnO1xuICAgICAgICBlbC5zdHlsZS5vdXRsaW5lT2Zmc2V0ID0gJy0ycHgnO1xuICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICBlbC5zdHlsZS5vdXRsaW5lID0gJyc7XG4gICAgICAgICAgZWwuc3R5bGUub3V0bGluZU9mZnNldCA9ICcnO1xuICAgICAgICB9LCAyMDAwKTtcblxuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHNlbGVjdG9yOiBtYXBwaW5nLnNlbGVjdG9yLFxuICAgICAgICAgIHByb2ZpbGVGaWVsZDogbWFwcGluZy5wcm9maWxlRmllbGQsXG4gICAgICAgICAgc3RhdHVzOiAnZmlsbGVkJyxcbiAgICAgICAgfSk7XG4gICAgICAgIGZpbGxlZENvdW50Kys7XG4gICAgICB9IGVsc2UgaWYgKGVsIGluc3RhbmNlb2YgSFRNTFNlbGVjdEVsZW1lbnQpIHtcbiAgICAgICAgaWYgKGZpbGxTZWxlY3QoZWwsIG1hcHBpbmcudmFsdWUpKSB7XG4gICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgIHNlbGVjdG9yOiBtYXBwaW5nLnNlbGVjdG9yLFxuICAgICAgICAgICAgcHJvZmlsZUZpZWxkOiBtYXBwaW5nLnByb2ZpbGVGaWVsZCxcbiAgICAgICAgICAgIHN0YXR1czogJ2ZpbGxlZCcsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgZmlsbGVkQ291bnQrKztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgc2VsZWN0b3I6IG1hcHBpbmcuc2VsZWN0b3IsXG4gICAgICAgICAgICBwcm9maWxlRmllbGQ6IG1hcHBpbmcucHJvZmlsZUZpZWxkLFxuICAgICAgICAgICAgc3RhdHVzOiAnZXJyb3InLFxuICAgICAgICAgICAgbWVzc2FnZTogYE5vIG1hdGNoaW5nIG9wdGlvbiBmb3IgXCIke21hcHBpbmcudmFsdWV9XCJgLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGVycm9yQ291bnQrKztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc2VsZWN0b3I6IG1hcHBpbmcuc2VsZWN0b3IsXG4gICAgICAgIHByb2ZpbGVGaWVsZDogbWFwcGluZy5wcm9maWxlRmllbGQsXG4gICAgICAgIHN0YXR1czogJ2Vycm9yJyxcbiAgICAgICAgbWVzc2FnZTogZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcbiAgICAgIH0pO1xuICAgICAgZXJyb3JDb3VudCsrO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgdG90YWxGaWVsZHM6IG1hcHBpbmdzLmxlbmd0aCxcbiAgICBmaWxsZWRGaWVsZHM6IGZpbGxlZENvdW50LFxuICAgIHNraXBwZWRTZW5zaXRpdmU6IDAsIC8vIEFscmVhZHkgZmlsdGVyZWQgb3V0IGJlZm9yZSByZWFjaGluZyB0aGlzIGZ1bmN0aW9uXG4gICAgc2tpcHBlZFVua25vd246IDAsXG4gICAgc2tpcHBlZEV4aXN0aW5nLFxuICAgIGVycm9yczogZXJyb3JDb3VudCxcbiAgICBmaWVsZHM6IHJlc3VsdHMsXG4gIH07XG59XG4iLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIENvbnRlbnQgU2NyaXB0XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFJ1bnMgb24gYWxsIHdlYiBwYWdlcy4gTGlzdGVucyBmb3IgbWVzc2FnZXMgZnJvbSBwb3B1cC9iYWNrZ3JvdW5kXG4vLyB0byBzY2FuIGZvcm1zIGFuZCBmaWxsIGZpZWxkcy5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5pbXBvcnQgeyBzY2FuUGFnZUZpZWxkcywgZXh0cmFjdFNhbml0aXplZEZpZWxkcyB9IGZyb20gJy4uL3V0aWxzL2ZpZWxkRGV0ZWN0b3InO1xuaW1wb3J0IHsgZmlsbEZpZWxkcyB9IGZyb20gJy4uL3V0aWxzL2Zvcm1GaWxsZXInO1xuaW1wb3J0IHR5cGUgeyBDb250ZW50U2NyaXB0UmVxdWVzdCwgU2NhbkZpZWxkc1Jlc3BvbnNlLCBGaWxsRmllbGRzUmVzcG9uc2UsIEFJU2NhbkZpZWxkc1Jlc3BvbnNlIH0gZnJvbSAnLi4vdHlwZXMvbWVzc2FnZXMnO1xuaW1wb3J0IHR5cGUgeyBTY2FuUmVzdWx0IH0gZnJvbSAnLi4vdHlwZXMvYXV0b2ZpbGwnO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb250ZW50U2NyaXB0KHtcbiAgbWF0Y2hlczogWyc8YWxsX3VybHM+J10sXG4gIGFsbEZyYW1lczogdHJ1ZSxcbiAgcnVuQXQ6ICdkb2N1bWVudF9pZGxlJyxcblxuICBtYWluKCkge1xuICAgIC8vIExpc3RlbiBmb3IgbWVzc2FnZXMgZnJvbSBwb3B1cCBvciBiYWNrZ3JvdW5kXG4gICAgY2hyb21lLnJ1bnRpbWUub25NZXNzYWdlLmFkZExpc3RlbmVyKFxuICAgICAgKFxuICAgICAgICBtZXNzYWdlOiBDb250ZW50U2NyaXB0UmVxdWVzdCxcbiAgICAgICAgX3NlbmRlcixcbiAgICAgICAgc2VuZFJlc3BvbnNlOiAocmVzcG9uc2U6IFNjYW5GaWVsZHNSZXNwb25zZSB8IEZpbGxGaWVsZHNSZXNwb25zZSB8IEFJU2NhbkZpZWxkc1Jlc3BvbnNlKSA9PiB2b2lkLFxuICAgICAgKSA9PiB7XG4gICAgICAgIHN3aXRjaCAobWVzc2FnZS50eXBlKSB7XG4gICAgICAgICAgY2FzZSAnU0NBTl9GSUVMRFMnOiB7XG4gICAgICAgICAgICBjb25zdCBmaWVsZHMgPSBzY2FuUGFnZUZpZWxkcygpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFtQZXJzb25hbCBDb3BpbG90XSBTY2FubmVkICR7d2luZG93LmxvY2F0aW9uLmhyZWZ9OiBmb3VuZCAke2ZpZWxkcy5sZW5ndGh9IGZpZWxkc2ApO1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0OiBTY2FuUmVzdWx0ID0ge1xuICAgICAgICAgICAgICB1cmw6IHdpbmRvdy5sb2NhdGlvbi5ocmVmLFxuICAgICAgICAgICAgICB0b3RhbEZpZWxkczogZmllbGRzLmxlbmd0aCxcbiAgICAgICAgICAgICAgbWFwcGVkRmllbGRzOiBmaWVsZHMuZmlsdGVyKChmKSA9PiBmLmNhdGVnb3J5ID09PSAnU0FGRV9BVVRPJykubGVuZ3RoLFxuICAgICAgICAgICAgICBzZW5zaXRpdmVGaWVsZHM6IGZpZWxkcy5maWx0ZXIoKGYpID0+IGYuY2F0ZWdvcnkgPT09ICdVU0VSX0RFQ0lTSU9OX1JFUVVJUkVEJykubGVuZ3RoLFxuICAgICAgICAgICAgICB1bmtub3duRmllbGRzOiBmaWVsZHMuZmlsdGVyKChmKSA9PiBmLmNhdGVnb3J5ID09PSAnVU5LTk9XTicpLmxlbmd0aCxcbiAgICAgICAgICAgICAgZmllbGRzLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHR5cGU6ICdTQ0FOX0ZJRUxEU19SRVNVTFQnLCByZXN1bHQgfSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjYXNlICdBSV9TQ0FOX0ZJRUxEUyc6IHtcbiAgICAgICAgICAgIGNvbnN0IHsgc2FuaXRpemVkRmllbGRzLCBzZWxlY3Rvckxvb2t1cCB9ID0gZXh0cmFjdFNhbml0aXplZEZpZWxkcygpO1xuICAgICAgICAgICAgc2VuZFJlc3BvbnNlKHtcbiAgICAgICAgICAgICAgdHlwZTogJ0FJX1NDQU5fRklFTERTX1JFU1VMVCcsXG4gICAgICAgICAgICAgIHNhbml0aXplZEZpZWxkcyxcbiAgICAgICAgICAgICAgc2VsZWN0b3JMb29rdXAsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNhc2UgJ0ZJTExfRklFTERTJzoge1xuICAgICAgICAgICAgY29uc3QgZmlsbFJlc3VsdCA9IGZpbGxGaWVsZHMobWVzc2FnZS5tYXBwaW5ncyk7XG4gICAgICAgICAgICBzZW5kUmVzcG9uc2UoeyB0eXBlOiAnRklMTF9GSUVMRFNfUkVTVUxUJywgcmVzdWx0OiBmaWxsUmVzdWx0IH0pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmV0dXJuIHRydWUgdG8gaW5kaWNhdGUgYXN5bmMgcmVzcG9uc2VcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9LFxuICAgICk7XG5cbiAgICBjb25zb2xlLmxvZygnW1BlcnNvbmFsIENvcGlsb3RdIENvbnRlbnQgc2NyaXB0IGxvYWRlZC4nKTtcbiAgfSxcbn0pO1xuIiwiLy8jcmVnaW9uIHNyYy91dGlscy9pbnRlcm5hbC9sb2dnZXIudHNcbmZ1bmN0aW9uIHByaW50KG1ldGhvZCwgLi4uYXJncykge1xuXHRpZiAoaW1wb3J0Lm1ldGEuZW52Lk1PREUgPT09IFwicHJvZHVjdGlvblwiKSByZXR1cm47XG5cdGlmICh0eXBlb2YgYXJnc1swXSA9PT0gXCJzdHJpbmdcIikgbWV0aG9kKGBbd3h0XSAke2FyZ3Muc2hpZnQoKX1gLCAuLi5hcmdzKTtcblx0ZWxzZSBtZXRob2QoXCJbd3h0XVwiLCAuLi5hcmdzKTtcbn1cbi8qKiBXcmFwcGVyIGFyb3VuZCBgY29uc29sZWAgd2l0aCBhIFwiW3d4dF1cIiBwcmVmaXggKi9cbmNvbnN0IGxvZ2dlciA9IHtcblx0ZGVidWc6ICguLi5hcmdzKSA9PiBwcmludChjb25zb2xlLmRlYnVnLCAuLi5hcmdzKSxcblx0bG9nOiAoLi4uYXJncykgPT4gcHJpbnQoY29uc29sZS5sb2csIC4uLmFyZ3MpLFxuXHR3YXJuOiAoLi4uYXJncykgPT4gcHJpbnQoY29uc29sZS53YXJuLCAuLi5hcmdzKSxcblx0ZXJyb3I6ICguLi5hcmdzKSA9PiBwcmludChjb25zb2xlLmVycm9yLCAuLi5hcmdzKVxufTtcbi8vI2VuZHJlZ2lvblxuZXhwb3J0IHsgbG9nZ2VyIH07XG4iLCIvLyAjcmVnaW9uIHNuaXBwZXRcbmV4cG9ydCBjb25zdCBicm93c2VyID0gZ2xvYmFsVGhpcy5icm93c2VyPy5ydW50aW1lPy5pZFxuICA/IGdsb2JhbFRoaXMuYnJvd3NlclxuICA6IGdsb2JhbFRoaXMuY2hyb21lO1xuLy8gI2VuZHJlZ2lvbiBzbmlwcGV0XG4iLCJpbXBvcnQgeyBicm93c2VyIGFzIGJyb3dzZXIkMSB9IGZyb20gXCJAd3h0LWRldi9icm93c2VyXCI7XG4vLyNyZWdpb24gc3JjL2Jyb3dzZXIudHNcbi8qKlxuKiBDb250YWlucyB0aGUgYGJyb3dzZXJgIGV4cG9ydCB3aGljaCB5b3Ugc2hvdWxkIHVzZSB0byBhY2Nlc3MgdGhlIGV4dGVuc2lvblxuKiBBUElzIGluIHlvdXIgcHJvamVjdDpcbipcbiogYGBgdHNcbiogaW1wb3J0IHsgYnJvd3NlciB9IGZyb20gJ3d4dC9icm93c2VyJztcbipcbiogYnJvd3Nlci5ydW50aW1lLm9uSW5zdGFsbGVkLmFkZExpc3RlbmVyKCgpID0+IHtcbiogICAvLyAuLi5cbiogfSk7XG4qIGBgYFxuKlxuKiBAbW9kdWxlIHd4dC9icm93c2VyXG4qL1xuY29uc3QgYnJvd3NlciA9IGJyb3dzZXIkMTtcbi8vI2VuZHJlZ2lvblxuZXhwb3J0IHsgYnJvd3NlciB9O1xuIiwiaW1wb3J0IHsgYnJvd3NlciB9IGZyb20gXCJ3eHQvYnJvd3NlclwiO1xuLy8jcmVnaW9uIHNyYy91dGlscy9pbnRlcm5hbC9jdXN0b20tZXZlbnRzLnRzXG52YXIgV3h0TG9jYXRpb25DaGFuZ2VFdmVudCA9IGNsYXNzIFd4dExvY2F0aW9uQ2hhbmdlRXZlbnQgZXh0ZW5kcyBFdmVudCB7XG5cdHN0YXRpYyBFVkVOVF9OQU1FID0gZ2V0VW5pcXVlRXZlbnROYW1lKFwid3h0OmxvY2F0aW9uY2hhbmdlXCIpO1xuXHRjb25zdHJ1Y3RvcihuZXdVcmwsIG9sZFVybCkge1xuXHRcdHN1cGVyKFd4dExvY2F0aW9uQ2hhbmdlRXZlbnQuRVZFTlRfTkFNRSwge30pO1xuXHRcdHRoaXMubmV3VXJsID0gbmV3VXJsO1xuXHRcdHRoaXMub2xkVXJsID0gb2xkVXJsO1xuXHR9XG59O1xuLyoqXG4qIFJldHVybnMgYW4gZXZlbnQgbmFtZSB1bmlxdWUgdG8gdGhlIGV4dGVuc2lvbiBhbmQgY29udGVudCBzY3JpcHQgdGhhdCdzXG4qIHJ1bm5pbmcuXG4qL1xuZnVuY3Rpb24gZ2V0VW5pcXVlRXZlbnROYW1lKGV2ZW50TmFtZSkge1xuXHRyZXR1cm4gYCR7YnJvd3Nlcj8ucnVudGltZT8uaWR9OiR7aW1wb3J0Lm1ldGEuZW52LkVOVFJZUE9JTlR9OiR7ZXZlbnROYW1lfWA7XG59XG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IFd4dExvY2F0aW9uQ2hhbmdlRXZlbnQsIGdldFVuaXF1ZUV2ZW50TmFtZSB9O1xuIiwiaW1wb3J0IHsgV3h0TG9jYXRpb25DaGFuZ2VFdmVudCB9IGZyb20gXCIuL2N1c3RvbS1ldmVudHMubWpzXCI7XG4vLyNyZWdpb24gc3JjL3V0aWxzL2ludGVybmFsL2xvY2F0aW9uLXdhdGNoZXIudHNcbmNvbnN0IHN1cHBvcnRzTmF2aWdhdGlvbkFwaSA9IHR5cGVvZiBnbG9iYWxUaGlzLm5hdmlnYXRpb24/LmFkZEV2ZW50TGlzdGVuZXIgPT09IFwiZnVuY3Rpb25cIjtcbi8qKlxuKiBDcmVhdGUgYSB1dGlsIHRoYXQgd2F0Y2hlcyBmb3IgVVJMIGNoYW5nZXMsIGRpc3BhdGNoaW5nIHRoZSBjdXN0b20gZXZlbnQgd2hlblxuKiBkZXRlY3RlZC4gU3RvcHMgd2F0Y2hpbmcgd2hlbiBjb250ZW50IHNjcmlwdCBpcyBpbnZhbGlkYXRlZC4gVXNlcyBOYXZpZ2F0aW9uXG4qIEFQSSB3aGVuIGF2YWlsYWJsZSwgb3RoZXJ3aXNlIGZhbGxzIGJhY2sgdG8gcG9sbGluZy5cbiovXG5mdW5jdGlvbiBjcmVhdGVMb2NhdGlvbldhdGNoZXIoY3R4KSB7XG5cdGxldCBsYXN0VXJsO1xuXHRsZXQgd2F0Y2hpbmcgPSBmYWxzZTtcblx0cmV0dXJuIHsgcnVuKCkge1xuXHRcdGlmICh3YXRjaGluZykgcmV0dXJuO1xuXHRcdHdhdGNoaW5nID0gdHJ1ZTtcblx0XHRsYXN0VXJsID0gbmV3IFVSTChsb2NhdGlvbi5ocmVmKTtcblx0XHRpZiAoc3VwcG9ydHNOYXZpZ2F0aW9uQXBpKSBnbG9iYWxUaGlzLm5hdmlnYXRpb24uYWRkRXZlbnRMaXN0ZW5lcihcIm5hdmlnYXRlXCIsIChldmVudCkgPT4ge1xuXHRcdFx0Y29uc3QgbmV3VXJsID0gbmV3IFVSTChldmVudC5kZXN0aW5hdGlvbi51cmwpO1xuXHRcdFx0aWYgKG5ld1VybC5ocmVmID09PSBsYXN0VXJsLmhyZWYpIHJldHVybjtcblx0XHRcdHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBXeHRMb2NhdGlvbkNoYW5nZUV2ZW50KG5ld1VybCwgbGFzdFVybCkpO1xuXHRcdFx0bGFzdFVybCA9IG5ld1VybDtcblx0XHR9LCB7IHNpZ25hbDogY3R4LnNpZ25hbCB9KTtcblx0XHRlbHNlIGN0eC5zZXRJbnRlcnZhbCgoKSA9PiB7XG5cdFx0XHRjb25zdCBuZXdVcmwgPSBuZXcgVVJMKGxvY2F0aW9uLmhyZWYpO1xuXHRcdFx0aWYgKG5ld1VybC5ocmVmICE9PSBsYXN0VXJsLmhyZWYpIHtcblx0XHRcdFx0d2luZG93LmRpc3BhdGNoRXZlbnQobmV3IFd4dExvY2F0aW9uQ2hhbmdlRXZlbnQobmV3VXJsLCBsYXN0VXJsKSk7XG5cdFx0XHRcdGxhc3RVcmwgPSBuZXdVcmw7XG5cdFx0XHR9XG5cdFx0fSwgMWUzKTtcblx0fSB9O1xufVxuLy8jZW5kcmVnaW9uXG5leHBvcnQgeyBjcmVhdGVMb2NhdGlvbldhdGNoZXIgfTtcbiIsImltcG9ydCB7IGxvZ2dlciB9IGZyb20gXCIuL2ludGVybmFsL2xvZ2dlci5tanNcIjtcbmltcG9ydCB7IGdldFVuaXF1ZUV2ZW50TmFtZSB9IGZyb20gXCIuL2ludGVybmFsL2N1c3RvbS1ldmVudHMubWpzXCI7XG5pbXBvcnQgeyBjcmVhdGVMb2NhdGlvbldhdGNoZXIgfSBmcm9tIFwiLi9pbnRlcm5hbC9sb2NhdGlvbi13YXRjaGVyLm1qc1wiO1xuaW1wb3J0IHsgYnJvd3NlciB9IGZyb20gXCJ3eHQvYnJvd3NlclwiO1xuLy8jcmVnaW9uIHNyYy91dGlscy9jb250ZW50LXNjcmlwdC1jb250ZXh0LnRzXG4vKipcbiogSW1wbGVtZW50c1xuKiBbYEFib3J0Q29udHJvbGxlcmBdKGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0FQSS9BYm9ydENvbnRyb2xsZXIpLlxuKiBVc2VkIHRvIGRldGVjdCBhbmQgc3RvcCBjb250ZW50IHNjcmlwdCBjb2RlIHdoZW4gdGhlIHNjcmlwdCBpcyBpbnZhbGlkYXRlZC5cbipcbiogSXQgYWxzbyBwcm92aWRlcyBzZXZlcmFsIHV0aWxpdGllcyBsaWtlIGBjdHguc2V0VGltZW91dGAgYW5kXG4qIGBjdHguc2V0SW50ZXJ2YWxgIHRoYXQgc2hvdWxkIGJlIHVzZWQgaW4gY29udGVudCBzY3JpcHRzIGluc3RlYWQgb2ZcbiogYHdpbmRvdy5zZXRUaW1lb3V0YCBvciBgd2luZG93LnNldEludGVydmFsYC5cbipcbiogVG8gY3JlYXRlIGNvbnRleHQgZm9yIHRlc3RpbmcsIHlvdSBjYW4gdXNlIHRoZSBjbGFzcydzIGNvbnN0cnVjdG9yOlxuKlxuKiBgYGB0c1xuKiBpbXBvcnQgeyBDb250ZW50U2NyaXB0Q29udGV4dCB9IGZyb20gJ3d4dC91dGlscy9jb250ZW50LXNjcmlwdHMtY29udGV4dCc7XG4qXG4qIHRlc3QoJ3N0b3JhZ2UgbGlzdGVuZXIgc2hvdWxkIGJlIHJlbW92ZWQgd2hlbiBjb250ZXh0IGlzIGludmFsaWRhdGVkJywgKCkgPT4ge1xuKiAgIGNvbnN0IGN0eCA9IG5ldyBDb250ZW50U2NyaXB0Q29udGV4dCgndGVzdCcpO1xuKiAgIGNvbnN0IGl0ZW0gPSBzdG9yYWdlLmRlZmluZUl0ZW0oJ2xvY2FsOmNvdW50JywgeyBkZWZhdWx0VmFsdWU6IDAgfSk7XG4qICAgY29uc3Qgd2F0Y2hlciA9IHZpLmZuKCk7XG4qXG4qICAgY29uc3QgdW53YXRjaCA9IGl0ZW0ud2F0Y2god2F0Y2hlcik7XG4qICAgY3R4Lm9uSW52YWxpZGF0ZWQodW53YXRjaCk7IC8vIExpc3RlbiBmb3IgaW52YWxpZGF0ZSBoZXJlXG4qXG4qICAgYXdhaXQgaXRlbS5zZXRWYWx1ZSgxKTtcbiogICBleHBlY3Qod2F0Y2hlcikudG9CZUNhbGxlZFRpbWVzKDEpO1xuKiAgIGV4cGVjdCh3YXRjaGVyKS50b0JlQ2FsbGVkV2l0aCgxLCAwKTtcbipcbiogICBjdHgubm90aWZ5SW52YWxpZGF0ZWQoKTsgLy8gVXNlIHRoaXMgZnVuY3Rpb24gdG8gaW52YWxpZGF0ZSB0aGUgY29udGV4dFxuKiAgIGF3YWl0IGl0ZW0uc2V0VmFsdWUoMik7XG4qICAgZXhwZWN0KHdhdGNoZXIpLnRvQmVDYWxsZWRUaW1lcygxKTtcbiogfSk7XG4qIGBgYFxuKi9cbnZhciBDb250ZW50U2NyaXB0Q29udGV4dCA9IGNsYXNzIENvbnRlbnRTY3JpcHRDb250ZXh0IHtcblx0c3RhdGljIFNDUklQVF9TVEFSVEVEX01FU1NBR0VfVFlQRSA9IGdldFVuaXF1ZUV2ZW50TmFtZShcInd4dDpjb250ZW50LXNjcmlwdC1zdGFydGVkXCIpO1xuXHRpZDtcblx0YWJvcnRDb250cm9sbGVyO1xuXHRsb2NhdGlvbldhdGNoZXIgPSBjcmVhdGVMb2NhdGlvbldhdGNoZXIodGhpcyk7XG5cdGNvbnN0cnVjdG9yKGNvbnRlbnRTY3JpcHROYW1lLCBvcHRpb25zKSB7XG5cdFx0dGhpcy5jb250ZW50U2NyaXB0TmFtZSA9IGNvbnRlbnRTY3JpcHROYW1lO1xuXHRcdHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG5cdFx0dGhpcy5pZCA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIpO1xuXHRcdHRoaXMuYWJvcnRDb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuXHRcdHRoaXMuc3RvcE9sZFNjcmlwdHMoKTtcblx0XHR0aGlzLmxpc3RlbkZvck5ld2VyU2NyaXB0cygpO1xuXHR9XG5cdGdldCBzaWduYWwoKSB7XG5cdFx0cmV0dXJuIHRoaXMuYWJvcnRDb250cm9sbGVyLnNpZ25hbDtcblx0fVxuXHRhYm9ydChyZWFzb24pIHtcblx0XHRyZXR1cm4gdGhpcy5hYm9ydENvbnRyb2xsZXIuYWJvcnQocmVhc29uKTtcblx0fVxuXHRnZXQgaXNJbnZhbGlkKCkge1xuXHRcdGlmIChicm93c2VyLnJ1bnRpbWU/LmlkID09IG51bGwpIHRoaXMubm90aWZ5SW52YWxpZGF0ZWQoKTtcblx0XHRyZXR1cm4gdGhpcy5zaWduYWwuYWJvcnRlZDtcblx0fVxuXHRnZXQgaXNWYWxpZCgpIHtcblx0XHRyZXR1cm4gIXRoaXMuaXNJbnZhbGlkO1xuXHR9XG5cdC8qKlxuXHQqIEFkZCBhIGxpc3RlbmVyIHRoYXQgaXMgY2FsbGVkIHdoZW4gdGhlIGNvbnRlbnQgc2NyaXB0J3MgY29udGV4dCBpc1xuXHQqIGludmFsaWRhdGVkLlxuXHQqXG5cdCogQGV4YW1wbGVcblx0KiAgIGJyb3dzZXIucnVudGltZS5vbk1lc3NhZ2UuYWRkTGlzdGVuZXIoY2IpO1xuXHQqICAgY29uc3QgcmVtb3ZlSW52YWxpZGF0ZWRMaXN0ZW5lciA9IGN0eC5vbkludmFsaWRhdGVkKCgpID0+IHtcblx0KiAgICAgYnJvd3Nlci5ydW50aW1lLm9uTWVzc2FnZS5yZW1vdmVMaXN0ZW5lcihjYik7XG5cdCogICB9KTtcblx0KiAgIC8vIC4uLlxuXHQqICAgcmVtb3ZlSW52YWxpZGF0ZWRMaXN0ZW5lcigpO1xuXHQqXG5cdCogQHJldHVybnMgQSBmdW5jdGlvbiB0byByZW1vdmUgdGhlIGxpc3RlbmVyLlxuXHQqL1xuXHRvbkludmFsaWRhdGVkKGNiKSB7XG5cdFx0dGhpcy5zaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGNiKTtcblx0XHRyZXR1cm4gKCkgPT4gdGhpcy5zaWduYWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGNiKTtcblx0fVxuXHQvKipcblx0KiBSZXR1cm4gYSBwcm9taXNlIHRoYXQgbmV2ZXIgcmVzb2x2ZXMuIFVzZWZ1bCBpZiB5b3UgaGF2ZSBhbiBhc3luYyBmdW5jdGlvblxuXHQqIHRoYXQgc2hvdWxkbid0IHJ1biBhZnRlciB0aGUgY29udGV4dCBpcyBleHBpcmVkLlxuXHQqXG5cdCogQGV4YW1wbGVcblx0KiAgIGNvbnN0IGdldFZhbHVlRnJvbVN0b3JhZ2UgPSBhc3luYyAoKSA9PiB7XG5cdCogICAgIGlmIChjdHguaXNJbnZhbGlkKSByZXR1cm4gY3R4LmJsb2NrKCk7XG5cdCpcblx0KiAgICAgLy8gLi4uXG5cdCogICB9O1xuXHQqL1xuXHRibG9jaygpIHtcblx0XHRyZXR1cm4gbmV3IFByb21pc2UoKCkgPT4ge30pO1xuXHR9XG5cdC8qKlxuXHQqIFdyYXBwZXIgYXJvdW5kIGB3aW5kb3cuc2V0SW50ZXJ2YWxgIHRoYXQgYXV0b21hdGljYWxseSBjbGVhcnMgdGhlIGludGVydmFsXG5cdCogd2hlbiBpbnZhbGlkYXRlZC5cblx0KlxuXHQqIEludGVydmFscyBjYW4gYmUgY2xlYXJlZCBieSBjYWxsaW5nIHRoZSBub3JtYWwgYGNsZWFySW50ZXJ2YWxgIGZ1bmN0aW9uLlxuXHQqL1xuXHRzZXRJbnRlcnZhbChoYW5kbGVyLCB0aW1lb3V0KSB7XG5cdFx0Y29uc3QgaWQgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG5cdFx0XHRpZiAodGhpcy5pc1ZhbGlkKSBoYW5kbGVyKCk7XG5cdFx0fSwgdGltZW91dCk7XG5cdFx0dGhpcy5vbkludmFsaWRhdGVkKCgpID0+IGNsZWFySW50ZXJ2YWwoaWQpKTtcblx0XHRyZXR1cm4gaWQ7XG5cdH1cblx0LyoqXG5cdCogV3JhcHBlciBhcm91bmQgYHdpbmRvdy5zZXRUaW1lb3V0YCB0aGF0IGF1dG9tYXRpY2FsbHkgY2xlYXJzIHRoZSBpbnRlcnZhbFxuXHQqIHdoZW4gaW52YWxpZGF0ZWQuXG5cdCpcblx0KiBUaW1lb3V0cyBjYW4gYmUgY2xlYXJlZCBieSBjYWxsaW5nIHRoZSBub3JtYWwgYHNldFRpbWVvdXRgIGZ1bmN0aW9uLlxuXHQqL1xuXHRzZXRUaW1lb3V0KGhhbmRsZXIsIHRpbWVvdXQpIHtcblx0XHRjb25zdCBpZCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuXHRcdFx0aWYgKHRoaXMuaXNWYWxpZCkgaGFuZGxlcigpO1xuXHRcdH0sIHRpbWVvdXQpO1xuXHRcdHRoaXMub25JbnZhbGlkYXRlZCgoKSA9PiBjbGVhclRpbWVvdXQoaWQpKTtcblx0XHRyZXR1cm4gaWQ7XG5cdH1cblx0LyoqXG5cdCogV3JhcHBlciBhcm91bmQgYHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWVgIHRoYXQgYXV0b21hdGljYWxseSBjYW5jZWxzXG5cdCogdGhlIHJlcXVlc3Qgd2hlbiBpbnZhbGlkYXRlZC5cblx0KlxuXHQqIENhbGxiYWNrcyBjYW4gYmUgY2FuY2VsZWQgYnkgY2FsbGluZyB0aGUgbm9ybWFsIGBjYW5jZWxBbmltYXRpb25GcmFtZWBcblx0KiBmdW5jdGlvbi5cblx0Ki9cblx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKGNhbGxiYWNrKSB7XG5cdFx0Y29uc3QgaWQgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKC4uLmFyZ3MpID0+IHtcblx0XHRcdGlmICh0aGlzLmlzVmFsaWQpIGNhbGxiYWNrKC4uLmFyZ3MpO1xuXHRcdH0pO1xuXHRcdHRoaXMub25JbnZhbGlkYXRlZCgoKSA9PiBjYW5jZWxBbmltYXRpb25GcmFtZShpZCkpO1xuXHRcdHJldHVybiBpZDtcblx0fVxuXHQvKipcblx0KiBXcmFwcGVyIGFyb3VuZCBgd2luZG93LnJlcXVlc3RJZGxlQ2FsbGJhY2tgIHRoYXQgYXV0b21hdGljYWxseSBjYW5jZWxzIHRoZVxuXHQqIHJlcXVlc3Qgd2hlbiBpbnZhbGlkYXRlZC5cblx0KlxuXHQqIENhbGxiYWNrcyBjYW4gYmUgY2FuY2VsZWQgYnkgY2FsbGluZyB0aGUgbm9ybWFsIGBjYW5jZWxJZGxlQ2FsbGJhY2tgXG5cdCogZnVuY3Rpb24uXG5cdCovXG5cdHJlcXVlc3RJZGxlQ2FsbGJhY2soY2FsbGJhY2ssIG9wdGlvbnMpIHtcblx0XHRjb25zdCBpZCA9IHJlcXVlc3RJZGxlQ2FsbGJhY2soKC4uLmFyZ3MpID0+IHtcblx0XHRcdGlmICghdGhpcy5zaWduYWwuYWJvcnRlZCkgY2FsbGJhY2soLi4uYXJncyk7XG5cdFx0fSwgb3B0aW9ucyk7XG5cdFx0dGhpcy5vbkludmFsaWRhdGVkKCgpID0+IGNhbmNlbElkbGVDYWxsYmFjayhpZCkpO1xuXHRcdHJldHVybiBpZDtcblx0fVxuXHRhZGRFdmVudExpc3RlbmVyKHRhcmdldCwgdHlwZSwgaGFuZGxlciwgb3B0aW9ucykge1xuXHRcdGlmICh0eXBlID09PSBcInd4dDpsb2NhdGlvbmNoYW5nZVwiKSB7XG5cdFx0XHRpZiAodGhpcy5pc1ZhbGlkKSB0aGlzLmxvY2F0aW9uV2F0Y2hlci5ydW4oKTtcblx0XHR9XG5cdFx0dGFyZ2V0LmFkZEV2ZW50TGlzdGVuZXI/Lih0eXBlLnN0YXJ0c1dpdGgoXCJ3eHQ6XCIpID8gZ2V0VW5pcXVlRXZlbnROYW1lKHR5cGUpIDogdHlwZSwgaGFuZGxlciwge1xuXHRcdFx0Li4ub3B0aW9ucyxcblx0XHRcdHNpZ25hbDogdGhpcy5zaWduYWxcblx0XHR9KTtcblx0fVxuXHQvKipcblx0KiBAaW50ZXJuYWxcblx0KiBBYm9ydCB0aGUgYWJvcnQgY29udHJvbGxlciBhbmQgZXhlY3V0ZSBhbGwgYG9uSW52YWxpZGF0ZWRgIGxpc3RlbmVycy5cblx0Ki9cblx0bm90aWZ5SW52YWxpZGF0ZWQoKSB7XG5cdFx0dGhpcy5hYm9ydChcIkNvbnRlbnQgc2NyaXB0IGNvbnRleHQgaW52YWxpZGF0ZWRcIik7XG5cdFx0bG9nZ2VyLmRlYnVnKGBDb250ZW50IHNjcmlwdCBcIiR7dGhpcy5jb250ZW50U2NyaXB0TmFtZX1cIiBjb250ZXh0IGludmFsaWRhdGVkYCk7XG5cdH1cblx0c3RvcE9sZFNjcmlwdHMoKSB7XG5cdFx0ZG9jdW1lbnQuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoQ29udGVudFNjcmlwdENvbnRleHQuU0NSSVBUX1NUQVJURURfTUVTU0FHRV9UWVBFLCB7IGRldGFpbDoge1xuXHRcdFx0Y29udGVudFNjcmlwdE5hbWU6IHRoaXMuY29udGVudFNjcmlwdE5hbWUsXG5cdFx0XHRtZXNzYWdlSWQ6IHRoaXMuaWRcblx0XHR9IH0pKTtcblx0XHRpZiAoIXRoaXMub3B0aW9ucz8ubm9TY3JpcHRTdGFydGVkUG9zdE1lc3NhZ2UpIHdpbmRvdy5wb3N0TWVzc2FnZSh7XG5cdFx0XHR0eXBlOiBDb250ZW50U2NyaXB0Q29udGV4dC5TQ1JJUFRfU1RBUlRFRF9NRVNTQUdFX1RZUEUsXG5cdFx0XHRjb250ZW50U2NyaXB0TmFtZTogdGhpcy5jb250ZW50U2NyaXB0TmFtZSxcblx0XHRcdG1lc3NhZ2VJZDogdGhpcy5pZFxuXHRcdH0sIFwiKlwiKTtcblx0fVxuXHR2ZXJpZnlTY3JpcHRTdGFydGVkRXZlbnQoZXZlbnQpIHtcblx0XHRjb25zdCBpc1NhbWVDb250ZW50U2NyaXB0ID0gZXZlbnQuZGV0YWlsPy5jb250ZW50U2NyaXB0TmFtZSA9PT0gdGhpcy5jb250ZW50U2NyaXB0TmFtZTtcblx0XHRjb25zdCBpc0Zyb21TZWxmID0gZXZlbnQuZGV0YWlsPy5tZXNzYWdlSWQgPT09IHRoaXMuaWQ7XG5cdFx0cmV0dXJuIGlzU2FtZUNvbnRlbnRTY3JpcHQgJiYgIWlzRnJvbVNlbGY7XG5cdH1cblx0bGlzdGVuRm9yTmV3ZXJTY3JpcHRzKCkge1xuXHRcdGNvbnN0IGNiID0gKGV2ZW50KSA9PiB7XG5cdFx0XHRpZiAoIShldmVudCBpbnN0YW5jZW9mIEN1c3RvbUV2ZW50KSB8fCAhdGhpcy52ZXJpZnlTY3JpcHRTdGFydGVkRXZlbnQoZXZlbnQpKSByZXR1cm47XG5cdFx0XHR0aGlzLm5vdGlmeUludmFsaWRhdGVkKCk7XG5cdFx0fTtcblx0XHRkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKENvbnRlbnRTY3JpcHRDb250ZXh0LlNDUklQVF9TVEFSVEVEX01FU1NBR0VfVFlQRSwgY2IpO1xuXHRcdHRoaXMub25JbnZhbGlkYXRlZCgoKSA9PiBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKENvbnRlbnRTY3JpcHRDb250ZXh0LlNDUklQVF9TVEFSVEVEX01FU1NBR0VfVFlQRSwgY2IpKTtcblx0fVxufTtcbi8vI2VuZHJlZ2lvblxuZXhwb3J0IHsgQ29udGVudFNjcmlwdENvbnRleHQgfTtcbiJdLCJuYW1lcyI6WyJkZWZpbml0aW9uIiwicmVzdWx0IiwicHJpbnQiLCJsb2dnZXIiLCJicm93c2VyIiwiV3h0TG9jYXRpb25DaGFuZ2VFdmVudCIsIkNvbnRlbnRTY3JpcHRDb250ZXh0Il0sIm1hcHBpbmdzIjoiOztBQUNBLFdBQVMsb0JBQW9CQSxhQUFZO0FBQ3hDLFdBQU9BO0FBQUEsRUFDUjtBQ1FPLFFBQU0scUJBQStCO0FBQUE7QUFBQSxJQUUxQztBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBO0FBQUEsSUFHQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUE7QUFBQSxJQUdBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUE7QUFBQSxJQUdBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQTtBQUFBLElBR0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUE7QUFBQSxJQUdBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUE7QUFBQSxJQUdBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQTtBQUFBLElBR0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFLTyxXQUFTLGlCQUFpQixPQUEwQjtBQUN6RCxVQUFNLFdBQVcsTUFBTSxPQUFPLE9BQU8sRUFBRSxLQUFLLEdBQUc7QUFDL0MsV0FBTyxtQkFBbUIsS0FBSyxDQUFDLFlBQVksUUFB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LFFBQ1I7QUFBQSxRQUNBO0FBQUEsTUFBQTtBQUFBLE1BRUYsb0JBQW9CLENBQUMsV0FBVyxjQUFjO0FBQUEsSUFBQTtBQUFBO0FBQUEsSUFJaEQ7QUFBQSxNQUNFLGNBQWM7QUFBQSxNQUNkLFVBQVU7QUFBQSxRQUNSO0FBQUEsUUFDQTtBQUFBLE1BQUE7QUFBQSxNQUVGLG9CQUFvQixDQUFBO0FBQUEsSUFBQztBQUFBLElBRXZCO0FBQUEsTUFDRSxjQUFjO0FBQUEsTUFDZCxVQUFVO0FBQUEsUUFDUjtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsTUFBQTtBQUFBLE1BRUYsb0JBQW9CLENBQUE7QUFBQSxJQUFDO0FBQUEsSUFFdkI7QUFBQSxNQUNFLGNBQWM7QUFBQSxNQUNkLFVBQVU7QUFBQSxRQUNSO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLE1BQUE7QUFBQSxNQUVGLG9CQUFvQixDQUFBO0FBQUEsSUFBQztBQUFBLElBRXZCO0FBQUEsTUFDRSxjQUFjO0FBQUEsTUFDZCxVQUFVO0FBQUEsUUFDUjtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLE1BQUE7QUFBQSxNQUVGLG9CQUFvQixDQUFBO0FBQUEsSUFBQztBQUFBO0FBQUEsSUFJdkI7QUFBQSxNQUNFLGNBQWM7QUFBQSxNQUNkLFVBQVU7QUFBQSxRQUNSO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxNQUFBO0FBQUEsTUFFRixvQkFBb0IsQ0FBQyxjQUFjO0FBQUEsSUFBQTtBQUFBLElBRXJDO0FBQUEsTUFDRSxjQUFjO0FBQUEsTUFDZCxVQUFVO0FBQUEsUUFDUjtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsTUFBQTtBQUFBLE1BRUYsb0JBQW9CLENBQUMsb0JBQW9CO0FBQUEsSUFBQTtBQUFBO0FBQUEsSUFJM0M7QUFBQSxNQUNFLGNBQWM7QUFBQSxNQUNkLFVBQVU7QUFBQSxRQUNSO0FBQUEsTUFBQTtBQUFBLE1BRUYsb0JBQW9C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
