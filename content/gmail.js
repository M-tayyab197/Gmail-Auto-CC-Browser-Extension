// ============================================================
// gmail.js — Milestone 10
//
// Adds to M9:
//   1. Trusted input events via document.execCommand. Chrome MV3
//      content scripts live in an isolated world — synthetic
//      KeyboardEvent/InputEvent objects carry isTrusted:false,
//      which Gmail's handlers silently ignore. execCommand goes
//      through the browser editing pipeline and produces events
//      with isTrusted:true that Gmail processes normally.
//   2. Comma as chip delimiter. Gmail treats comma (, and
//      Enter/Tab/semicolon) as a chip delimiter. Using execCommand
//      for the comma keeps all events trusted — no synthetic
//      KeyboardEvent needed, which was the root cause of the
//      "Chip may not have formed" warning in M9.
// ============================================================


console.log('✅ [Gmail Auto CC] Content script running.');

const PROCESSED_ATTR = 'data-cc-processed';
const STORAGE_KEY    = 'ccEmails';
const RELOAD_ONCE_KEY = 'gmail-cc-auto-reloaded';

// If the extension was reloaded at chrome://extensions while Gmail
// was already open, this already-injected script's chrome.* bridge
// is dead (chrome.storage becomes undefined). Reload Gmail once so
// a fresh content script injects with working storage access.
// tryRecoverInvalidatedContext() / isExtensionContextValid() are
// hoisted from SECTION 6.
if (!isExtensionContextValid()) {
  tryRecoverInvalidatedContext();
}


// ══════════════════════════════════════════════════════════════
// SECTION 1 — UTILITIES
// ══════════════════════════════════════════════════════════════

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Returns true only for elements actually visible on screen.
// Gmail keeps collapsed Cc/Bcc rows in the DOM (hidden), so a
// querySelector match is not enough — we must confirm visibility.
function isElementVisible(el) {
  if (!el) return false;
  try {
    if (el.offsetParent === null) return false;            // in a display:none chain
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  } catch (e) {
    return false;
  }
}

// Polls every `interval` ms until a selector matches inside
// `root`, or `timeout` ms have passed. Returns { el, selector }
// or null. Far more reliable than fixed setTimeout delays.
// When `requireVisible` is true, only visible elements match.
function waitForElement(root, selectors, timeout = 4000, interval = 100, requireVisible = false) {
  return new Promise((resolve) => {
    const start = Date.now();

    function attempt() {
      // If the compose window was closed, stop polling immediately
      if (!document.contains(root)) { resolve(null); return; }

      for (const selector of selectors) {
        try {
          const el = root.querySelector(selector);
          if (el && (!requireVisible || isElementVisible(el))) {
            resolve({ el, selector });
            return;
          }
        } catch (e) { /* invalid selector string — skip */ }
      }

      if (Date.now() - start >= timeout) { resolve(null); return; }
      setTimeout(attempt, interval);
    }

    attempt();
  });
}

// One-shot: returns the first match across a list of selectors.
function trySelectors(root, selectorList) {
  for (const selector of selectorList) {
    try {
      const el = root.querySelector(selector);
      if (el) return { el, selector };
    } catch (e) { /* skip */ }
  }
  return null;
}


// ══════════════════════════════════════════════════════════════
// SECTION 2 — VALIDATION
// ══════════════════════════════════════════════════════════════

// Re-validate before inserting — defence in depth against
// anything corrupt that might have ended up in storage.
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}


// ══════════════════════════════════════════════════════════════
// SECTION 3 — COMPOSE SAFETY
// ══════════════════════════════════════════════════════════════

// Returns false the moment Gmail removes the compose node
// from the DOM (user clicked X to close it mid-insertion).
function isComposeStillOpen(composeNode) {
  return document.body.contains(composeNode);
}


// ══════════════════════════════════════════════════════════════
// SECTION 4 — GMAIL DOM HELPERS
// ══════════════════════════════════════════════════════════════

function findCCInput(composeNode) {
  const SELECTORS = [
    'input[name="cc"]',
    'textarea[name="cc"]',
    '[name="cc"]',
    // Gmail's current DOM: <input class="agP aFw" aria-label="CC recipients">
    // "i" flag = case-insensitive, catches both "Cc" and "CC" variants.
    'input[aria-label="cc recipients" i]',
    'textarea[aria-label="cc recipients" i]',
    '[aria-label="cc recipients" i]',
    '[data-name="cc"] input',
    '[data-name="cc"] [contenteditable="true"]',
    '[data-name="cc"]',
  ];

  // Prefer a VISIBLE input. Gmail keeps collapsed Cc rows in the
  // DOM (hidden); matching one would make us skip the Cc toggle.
  let fallback = null;
  for (const selector of SELECTORS) {
    try {
      const el = composeNode.querySelector(selector);
      if (!el) continue;
      if (!fallback) fallback = el;
      if (isElementVisible(el)) return el;
    } catch (e) { /* invalid selector string — skip */ }
  }
  return fallback;
}

function findCCToggle(composeNode) {
  const result = trySelectors(composeNode, [
    '[data-tooltip="Add Cc recipients"]',
    '[data-tooltip="Cc"]',
    '[data-tooltip*="Cc recipient"]',
    '[data-tooltip*="add cc" i]',
    '[aria-label="Add Cc recipients"]',
    '[aria-label*="Cc"]',
    '[aria-label*="add cc" i]',
  ]);
  if (result) return result.el;

  // Text-content fallback — any leaf element reading exactly "Cc"
  const candidates = composeNode.querySelectorAll('span, div, td, a');
  for (const el of candidates) {
    if (el.children.length === 0 && el.textContent.trim() === 'Cc') return el;
  }
  return null;
}

async function openCCField(composeNode) {
  const existingInput = findCCInput(composeNode);
  if (existingInput && isElementVisible(existingInput)) {
    console.log('ℹ️  [Gmail Auto CC] CC field already open.');
    return existingInput;
  }

  // The input may exist in the DOM but be hidden (collapsed Cc row
  // or a leftover). The toggle must be clicked to reveal it.
  const toggle = findCCToggle(composeNode);
  if (!toggle) {
    console.warn('⚠️  [Gmail Auto CC] CC toggle not found.');
    return null;
  }

  console.log('🖱️  [Gmail Auto CC] Clicking CC toggle...');
  toggle.click();

  // Wait up to 3s for a VISIBLE input to appear
  const result = await waitForElement(composeNode, [
    'input[name="cc"]',
    'textarea[name="cc"]',
    '[name="cc"]',
    'input[aria-label="cc recipients" i]',
    'textarea[aria-label="cc recipients" i]',
    '[aria-label="cc recipients" i]',
    '[data-name="cc"] input',
    '[data-name="cc"] [contenteditable="true"]',
  ], 3000, 100, true); // requireVisible

  if (result) {
    console.log(`✅ [Gmail Auto CC] CC input appeared via "${result.selector}"`);
    return result.el;
  }

  console.warn('⚠️  [Gmail Auto CC] CC input did not appear after toggle click.');
  return null;
}

// Reads email addresses already present in the CC field
// (both raw typed text and confirmed chips) to prevent duplicates.
function getExistingCCEmails(composeNode) {
  const existing = new Set();

  const ccInput = findCCInput(composeNode);
  if (ccInput) {
    const typed = (ccInput.value || ccInput.textContent || '').trim().toLowerCase();
    if (typed.includes('@')) existing.add(typed);
  }

  ['[data-hovercard-id]', '[email]'].forEach((sel) => {
    try {
      composeNode.querySelectorAll(sel).forEach((chip) => {
        const val = (
          chip.getAttribute('data-hovercard-id') ||
          chip.getAttribute('email') || ''
        ).trim().toLowerCase();
        if (val.includes('@')) existing.add(val);
      });
    } catch (e) { /* skip */ }
  });

  if (ccInput) {
    const container =
      ccInput.closest('[data-name="cc"]')  ||
      ccInput.parentElement?.parentElement ||
      ccInput.parentElement;

    if (container) {
      container.querySelectorAll('span, div').forEach((el) => {
        if (el.children.length === 0) {
          const text = el.textContent.trim().toLowerCase();
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) existing.add(text);
        }
      });
    }
  }

  return existing; // Set<string> — all lowercase
}


// ══════════════════════════════════════════════════════════════
// SECTION 5 — EMAIL INSERTION
// ══════════════════════════════════════════════════════════════

async function insertSingleEmail(ccInput, email) {

  // ── Step 1: Activate CC field in Gmail's internal router ──
  // click() triggers Gmail's own click handler, telling its
  // internal field router "CC is now the active field". Without
  // this, Gmail's router still points to "To" regardless of
  // where the browser focus sits.
  ccInput.click();
  await wait(200);

  ccInput.focus();
  await wait(100);

  // ── Step 2: Clear any leftover value ─────────────────────
  ccInput.value = '';
  ccInput.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(50);

  // ── Step 3: Type the email via execCommand ───────────────
  // Chrome's MV3 isolated world means synthetic KeyboardEvent
  // and InputEvent objects have isTrusted:false — Gmail's
  // handlers silently ignore them.  document.execCommand goes
  // through the browser's editing pipeline and produces events
  // with isTrusted:true, which Gmail processes normally.
  document.execCommand('insertText', false, email);
  await wait(400);

  // ── Step 4: Confirm chip via comma ───────────────────────
  // Gmail treats comma (and Enter/Tab/semicolon) as chip
  // delimiters.  Using execCommand for the comma keeps all
  // events trusted — no synthetic KeyboardEvent needed.
  document.execCommand('insertText', false, ',');
  await wait(600);

  // ── Step 5: Verify chip formation ────────────────────────
  const remaining = (ccInput.value || '').trim();
  if (remaining === '' || remaining !== email.trim() + ',') {
    console.log(`   ✅ Chip created for: ${email}`);
  } else {
    console.warn(`   ⚠️  Chip may not have formed for: ${email}`);
  }
}


// ══════════════════════════════════════════════════════════════
// SECTION 6 — CONTEXT VALIDITY + CHROME STORAGE
// ══════════════════════════════════════════════════════════════

// ── Orphaned-context detection & one-time recovery ──────────
// Reloading the extension at chrome://extensions while Gmail is
// already open orphans the already-injected content script: its
// chrome.* bridge dies and chrome.storage becomes undefined —
// which surfaces as "Cannot read properties of undefined
// (reading 'sync')" and makes the flow report "No saved emails".
// A new content script cannot inject into an existing tab, so we
// reload Gmail once (sessionStorage-guarded) to re-inject fresh.

function isExtensionContextValid() {
  try {
    if (typeof chrome === 'undefined') return false;
    return !!(chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function tryRecoverInvalidatedContext() {
  if (isExtensionContextValid()) return true;

  console.warn('⚠️  [Gmail Auto CC] Extension context invalidated (extension reloaded?)');

  try {
    if (sessionStorage.getItem(RELOAD_ONCE_KEY)) {
      sessionStorage.removeItem(RELOAD_ONCE_KEY);
      console.error(
        '❌  [Gmail Auto CC] Context still invalid after reload. ' +
        'Re-add the extension at chrome://extensions and refresh Gmail manually.'
      );
      return false;
    }
    sessionStorage.setItem(RELOAD_ONCE_KEY, '1');
    console.warn('🔄  [Gmail Auto CC] Reloading Gmail once to reconnect the extension...');
    location.reload();
  } catch (e) {
    // sessionStorage unavailable — just report and move on
  }

  return false;
}

// Wraps chrome.storage.sync.get in a Promise so we can await it.
function loadEmailsFromStorage() {
  return new Promise((resolve) => {

    // First line of defence against an orphaned content script
    if (!tryRecoverInvalidatedContext()) { resolve([]); return; }

    try {
      chrome.storage.sync.get([STORAGE_KEY], (result) => {

        if (chrome.runtime.lastError) {
          console.warn(
            '⚠️  [Gmail Auto CC] chrome.storage failed:',
            chrome.runtime.lastError.message
          );
          resolve([]);
          return;
        }

        resolve(result[STORAGE_KEY] || []);
      });
    } catch (err) {
      console.warn('⚠️  [Gmail Auto CC] Chrome Storage unavailable:', err.message);
      resolve([]);
    }
  });
}


// ══════════════════════════════════════════════════════════════
// SECTION 7 — ORCHESTRATION
// ══════════════════════════════════════════════════════════════

async function insertEmailsIntoCC(composeNode, ccInput) {

  if (!isElementVisible(ccInput)) {
    console.warn('⚠️  [Gmail Auto CC] CC input is not visible — aborting insertion.');
    return;
  }

  const savedEmails = await loadEmailsFromStorage();

  if (savedEmails.length === 0) {
    console.log('ℹ️  [Gmail Auto CC] No saved emails — nothing to insert.');
    return;
  }

  // Re-validate every email before inserting (defence in depth)
  const validEmails = savedEmails.filter((email) => {
    if (isValidEmail(email)) return true;
    console.warn(`⚠️  [Gmail Auto CC] Invalid email in storage — skipping: "${email}"`);
    return false;
  });

  if (validEmails.length === 0) return;

  console.log(`📋 [Gmail Auto CC] Processing ${validEmails.length} email(s)...`);

  // Snapshot what is already in CC before we start
  const existingEmails = getExistingCCEmails(composeNode);
  if (existingEmails.size > 0) {
    console.log('🔍 [Gmail Auto CC] Already in CC field:', [...existingEmails]);
  }

  let insertedCount = 0;
  let skippedCount  = 0;

  for (const email of validEmails) {

    // Stop if user closed the compose window mid-insertion
    if (!isComposeStillOpen(composeNode)) {
      console.log('ℹ️  [Gmail Auto CC] Compose was closed — stopping early.');
      break;
    }

    const normalised = email.toLowerCase().trim();

    if (existingEmails.has(normalised)) {
      console.log(`⏭️  [Gmail Auto CC] Skipping duplicate: ${email}`);
      skippedCount++;
      continue;
    }

    console.log(`➕ [Gmail Auto CC] Inserting: ${email}`);
    await insertSingleEmail(ccInput, email);
    existingEmails.add(normalised); // track locally for within-loop dedup
    insertedCount++;
  }

  console.group('✅ [Gmail Auto CC] Insertion complete');
  console.log('Inserted :', insertedCount);
  console.log('Skipped  :', skippedCount);
  console.groupEnd();
}


async function handleComposeDetected(composeNode) {

  // Stamp immediately — prevents MutationObserver from processing
  // the same compose node again as Gmail adds elements inside it
  composeNode.setAttribute(PROCESSED_ATTR, 'true');

  // Wait for the "To" field — its presence confirms Gmail has
  // finished injecting the full compose UI into the DOM.
  // requireVisible: a hidden To row means the dialog is still loading.
  const toFieldResult = await waitForElement(composeNode, [
    'input[name="to"]',
    'textarea[name="to"]',
    '[name="to"]',
    '[data-name="to"] input',
  ], 4000, 100, true);

  if (!toFieldResult) {
    console.warn('⚠️  [Gmail Auto CC] Compose internals did not load in time — aborting.');
    return;
  }

  // DOM elements appear first; Gmail attaches its JavaScript
  // event listeners ~500–700ms later. Firing events before
  // the listeners are attached means Gmail silently ignores them.
  // 800ms is a safe margin that covers slow network conditions.
  await wait(800);

  console.log('✉️  [Gmail Auto CC] Compose window ready.');

  try {

    const ccInput = await openCCField(composeNode);

    if (!ccInput) {
      console.error('❌ [Gmail Auto CC] CC input not found — aborting.');
      return;
    }

    // Brief buffer after CC field is confirmed open
    await wait(300);

    await insertEmailsIntoCC(composeNode, ccInput);

  } catch (err) {
    // Catch-all: one broken compose window must not break future ones.
    // Without this, an async error kills the function silently and
    // future compose windows are never processed.
    console.error('❌ [Gmail Auto CC] Unexpected error during insertion:');
    console.error('   ', err.message);
    console.error('   ', err.stack);
  }
}


// ══════════════════════════════════════════════════════════════
// SECTION 7b — COMPOSE BUTTON CLICK TRIGGER
// ══════════════════════════════════════════════════════════════
// The MutationObserver below already catches every new compose
// window (role="dialog"). This trigger is a backstop for the
// exact user flow: "click the Compose button → CC flow runs".
// The Compose button is located by CONTENT ("Compose"), not by
// classes, because its markup changes across Gmail builds
// (e.g. <div class="T-I T-I-KE L3" role="button">Compose</div>).

function findClickedComposeButton(event) {
  let el = event.target;
  while (el && el.nodeType === 1 && el !== document.documentElement) {
    if (el.getAttribute('role') === 'button') {
      const text = (el.textContent || '').trim();
      if (text === 'Compose') return el;
    }
    el = el.parentElement;
  }
  return null;
}

function handleComposeButtonClicked() {
  // Gmail builds the new compose window async after the click.
  // Defer one tick, then claim any compose window the observer
  // has not already claimed (PROCESSED_ATTR prevents double work).
  setTimeout(() => {
    document.querySelectorAll('[role="dialog"]').forEach((dialog) => {
      if (!dialog.hasAttribute(PROCESSED_ATTR)) {
        handleComposeDetected(dialog);
      }
    });
  }, 300);
}

document.addEventListener('click', (event) => {
  if (findClickedComposeButton(event)) {
    console.log('▶️  [Gmail Auto CC] Compose button clicked — running CC flow.');
    handleComposeButtonClicked();
  }
}, true); // capture phase: fires before Gmail's own handlers


// ══════════════════════════════════════════════════════════════
// SECTION 8 — MUTATIONOBSERVER (unchanged)
// ══════════════════════════════════════════════════════════════

function isComposeWindow(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  if (!node.matches('[role="dialog"]'))    return false;
  if (node.hasAttribute(PROCESSED_ATTR))  return false;
  return true;
}

function checkNodeForCompose(node) {
  if (isComposeWindow(node)) {
    handleComposeDetected(node);
    return;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    node.querySelectorAll('[role="dialog"]').forEach((dialog) => {
      if (isComposeWindow(dialog)) handleComposeDetected(dialog);
    });
  }
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type !== 'childList') continue;
    for (const addedNode of mutation.addedNodes) {
      checkNodeForCompose(addedNode);
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });

console.log('👁️  [Gmail Auto CC] MutationObserver active — watching for compose windows.');
console.log('🎯  [Gmail Auto CC] Compose click trigger active — ready on mail.google.com.');