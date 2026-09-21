// ============================================================
// gmail.js — Milestone 7 (Final): Reliability + No Trailing Comma
//
// ROOT CAUSE FIXED:
//   insertSingleEmail always appended a comma after every email
//   (including the last one) to trigger Gmail's chip creation.
//   For intermediate emails Gmail consumed the comma as a chip
//   delimiter and cleared the input. For the last email the
//   comma remained as visible trailing text in the CC field.
//
// FIX:
//   1. insertSingleEmail receives an `isLast` flag.
//   2. For the last email only: after the comma creates the chip,
//      execCommand('delete') removes the trailing comma.
//   3. insertEmailsIntoCC pre-filters the emails to insert so it
//      knows which one is truly last BEFORE the loop starts.
//   4. The unreliable post-loop cleanup section is removed.
//
// Comma count rule enforced:
//   1 email  → 0 commas
//   2 emails → 1 comma  (between them, not after)
//   N emails → N-1 commas
// ============================================================


console.log('✅ [Gmail Auto CC] Content script running.');

const PROCESSED_ATTR  = 'data-cc-processed';
const STORAGE_KEY     = 'ccEmails';
const RELOAD_ONCE_KEY = 'gmail-cc-auto-reloaded';

// isExtensionContextValid / tryRecoverInvalidatedContext are
// function declarations (Section 6) and are hoisted, so this
// top-level call is safe even though they appear later.
if (!isExtensionContextValid()) {
  tryRecoverInvalidatedContext();
}


// ══════════════════════════════════════════════════════════════
// SECTION 1 — UTILITIES
// ══════════════════════════════════════════════════════════════

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isElementVisible(el) {
  if (!el) return false;
  try {
    if (el.offsetParent === null) return false;
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
// or null. When requireVisible is true, hidden elements are skipped.
function waitForElement(root, selectors, timeout = 4000, interval = 100, requireVisible = false) {
  return new Promise((resolve) => {
    const start = Date.now();

    function attempt() {
      if (!document.contains(root)) { resolve(null); return; }

      for (const selector of selectors) {
        try {
          const el = root.querySelector(selector);
          if (el && (!requireVisible || isElementVisible(el))) {
            resolve({ el, selector });
            return;
          }
        } catch (e) { /* invalid selector — skip */ }
      }

      if (Date.now() - start >= timeout) { resolve(null); return; }
      setTimeout(attempt, interval);
    }

    attempt();
  });
}

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

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}


// ══════════════════════════════════════════════════════════════
// SECTION 3 — COMPOSE SAFETY
// ══════════════════════════════════════════════════════════════

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
    'input[aria-label="cc recipients" i]',
    'textarea[aria-label="cc recipients" i]',
    '[aria-label="cc recipients" i]',
    '[data-name="cc"] input',
    '[data-name="cc"] [contenteditable="true"]',
    '[data-name="cc"]',
  ];

  // Prefer a VISIBLE input — Gmail keeps collapsed Cc rows in the
  // DOM (hidden); matching one would make us skip the Cc toggle.
  let fallback = null;
  for (const selector of SELECTORS) {
    try {
      const el = composeNode.querySelector(selector);
      if (!el) continue;
      if (!fallback) fallback = el;
      if (isElementVisible(el)) return el;
    } catch (e) { /* skip */ }
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

  const toggle = findCCToggle(composeNode);
  if (!toggle) {
    console.warn('⚠️  [Gmail Auto CC] CC toggle not found.');
    return null;
  }

  console.log('🖱️  [Gmail Auto CC] Clicking CC toggle...');
  toggle.click();

  const result = await waitForElement(composeNode, [
    'input[name="cc"]',
    'textarea[name="cc"]',
    '[name="cc"]',
    'input[aria-label="cc recipients" i]',
    'textarea[aria-label="cc recipients" i]',
    '[aria-label="cc recipients" i]',
    '[data-name="cc"] input',
    '[data-name="cc"] [contenteditable="true"]',
  ], 3000, 100, true); // requireVisible: true

  if (result) {
    console.log(`✅ [Gmail Auto CC] CC input appeared via "${result.selector}"`);
    return result.el;
  }

  console.warn('⚠️  [Gmail Auto CC] CC input did not appear after toggle click.');
  return null;
}

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

  return existing;
}


// ══════════════════════════════════════════════════════════════
// SECTION 5 — EMAIL INSERTION
// ══════════════════════════════════════════════════════════════

// ── insertSingleEmail ─────────────────────────────────────────
// isLast flag controls trailing-comma behaviour:
//
//   isLast = false (intermediate email):
//     type email → type comma → Gmail creates chip, clears input
//     comma is consumed as delimiter — no cleanup needed
//
//   isLast = true (final email):
//     type email → type comma → Gmail creates chip
//     comma MAY remain in input as trailing text
//     execCommand('delete') removes it (trusted event, not synthetic)
//
// This enforces: N emails → exactly N-1 commas (none trailing).

async function insertSingleEmail(ccInput, email, isLast = false) {

  // ── Step 1: Activate CC in Gmail's internal field router ──
  // click() triggers Gmail's own handler, telling its internal
  // router "CC is now active". Without this, events route to "To".
  ccInput.click();
  await wait(200);

  ccInput.focus();
  await wait(100);

  // ── Step 2: Clear any leftover value ─────────────────────
  ccInput.value = '';
  ccInput.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(50);

  // ── Step 3: Type the email address (trusted) ─────────────
  // execCommand goes through the browser editing pipeline and
  // produces isTrusted:true events — Gmail's handlers require
  // this; synthetic InputEvent/KeyboardEvent have isTrusted:false
  // and are silently ignored by Gmail.
  document.execCommand('insertText', false, email);
  await wait(400);

  // ── Step 4: Confirm chip with comma ──────────────────────
  // Gmail treats comma as a chip delimiter. Using execCommand
  // keeps the event trusted so Gmail processes the delimiter.
  // For intermediate emails Gmail consumes the comma and clears
  // the input — no trailing comma left. For the last email the
  // comma may remain (handled in Step 5).
  document.execCommand('insertText', false, ',');
  await wait(600);

  // ── Step 5: Remove trailing comma for the last email ─────
  // FIX: only runs when isLast = true.
  //
  // After the comma above, two outcomes are possible:
  //   A) Gmail consumed the comma to create the chip → input empty
  //   B) Gmail created the chip but left the comma → input has ","
  //
  // In case B the comma is visible trailing text. We check and
  // remove it with execCommand('delete') — which acts like Backspace
  // (removes the character before the cursor). Since we just
  // inserted the comma, the cursor is directly after it, so
  // delete removes exactly the comma character.
  //
  // execCommand('delete') is trusted; directly setting
  // ccInput.value was NOT reliable because Gmail's internal
  // state does not update from direct property assignment.
  if (isLast) {
    const rawValue = ccInput.value || ccInput.textContent || ccInput.innerText || '';
    const remaining = rawValue.trim();
    if (remaining === ',' || remaining.endsWith(',')) {
      document.execCommand('delete');
      await wait(200);
      console.log('🧹 [Gmail Auto CC] Removed trailing comma after last email.');
    } else {
      // Comma was already consumed by Gmail to create the chip
      console.log('ℹ️  [Gmail Auto CC] Comma was consumed by Gmail — no cleanup needed.');
    }
  }

  // ── Step 6: Verify chip formation (non-blocking) ─────────
  const remaining = (ccInput.value || '').trim();
  if (remaining === '' || (remaining !== email.trim() && remaining !== email.trim() + ',')) {
    console.log(`   ✅ Chip confirmed for: ${email}`);
  } else {
    console.warn(`   ⚠️  Chip may not have formed for: ${email}`);
    console.warn(`      Input value after insertion: "${remaining}"`);
  }
}


// ══════════════════════════════════════════════════════════════
// SECTION 6 — CONTEXT VALIDITY + CHROME STORAGE
// ══════════════════════════════════════════════════════════════

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
  } catch (e) { /* sessionStorage unavailable — continue */ }

  return false;
}

function loadEmailsFromStorage() {
  return new Promise((resolve) => {
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

  const validEmails = savedEmails.filter((email) => {
    if (isValidEmail(email)) return true;
    console.warn(`⚠️  [Gmail Auto CC] Invalid email in storage — skipping: "${email}"`);
    return false;
  });

  if (validEmails.length === 0) return;

  // Snapshot what is already in the CC field
  const existingEmails = getExistingCCEmails(composeNode);
  if (existingEmails.size > 0) {
    console.log('🔍 [Gmail Auto CC] Already in CC field:', [...existingEmails]);
  }

  // ── KEY CHANGE: pre-filter BEFORE the loop ────────────────
  // Building emailsToInsert up-front lets us know which email is
  // truly last BEFORE insertion starts. Without this we couldn't
  // determine isLast until after processing all previous emails —
  // too late to avoid inserting the comma for the last one.
  //
  // Comma rule enforced by this approach:
  //   emailsToInsert = [A, B, C]
  //   A → isLast false → comma added, consumed by Gmail
  //   B → isLast false → comma added, consumed by Gmail
  //   C → isLast true  → comma added then immediately deleted
  //   Result: A,B,C   (no trailing comma)
  const emailsToInsert = validEmails.filter(
    (email) => !existingEmails.has(email.toLowerCase().trim())
  );

  const skippedCount = validEmails.length - emailsToInsert.length;

  if (skippedCount > 0) {
    console.log(`⏭️  [Gmail Auto CC] Skipping ${skippedCount} duplicate(s) already in CC.`);
  }

  if (emailsToInsert.length === 0) {
    console.log('ℹ️  [Gmail Auto CC] All emails already in CC — nothing to insert.');
    console.group('✅ [Gmail Auto CC] Insertion complete');
    console.log('Inserted :', 0);
    console.log('Skipped  :', skippedCount);
    console.groupEnd();
    return;
  }

  console.log(`📋 [Gmail Auto CC] Inserting ${emailsToInsert.length} email(s)` +
    (skippedCount > 0 ? ` (${skippedCount} skipped as duplicate)` : '') + '...');

  let insertedCount = 0;

  // for loop with index — needed to compute isLast correctly
  for (let i = 0; i < emailsToInsert.length; i++) {

    if (!isComposeStillOpen(composeNode)) {
      console.log('ℹ️  [Gmail Auto CC] Compose was closed — stopping early.');
      break;
    }

    const email  = emailsToInsert[i];
    const isLast = i === emailsToInsert.length - 1;

    console.log(`➕ [Gmail Auto CC] Inserting${isLast ? ' (last)' : ''}: ${email}`);
    await insertSingleEmail(ccInput, email, isLast);

    existingEmails.add(email.toLowerCase().trim());
    insertedCount++;
  }

  console.group('✅ [Gmail Auto CC] Insertion complete');
  console.log('Inserted :', insertedCount);
  console.log('Skipped  :', skippedCount);
  console.groupEnd();
}


async function handleComposeDetected(composeNode) {

  composeNode.setAttribute(PROCESSED_ATTR, 'true');

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

  await wait(800);
  console.log('✉️  [Gmail Auto CC] Compose window ready.');

  try {

    const ccInput = await openCCField(composeNode);

    if (!ccInput) {
      console.error('❌ [Gmail Auto CC] CC input not found — aborting.');
      return;
    }

    await wait(300);
    await insertEmailsIntoCC(composeNode, ccInput);

  } catch (err) {
    console.error('❌ [Gmail Auto CC] Unexpected error during insertion:');
    console.error('   ', err.message);
    console.error('   ', err.stack);
  }
}


// ══════════════════════════════════════════════════════════════
// SECTION 7b — COMPOSE BUTTON CLICK TRIGGER
// ══════════════════════════════════════════════════════════════

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
}, true);


// ══════════════════════════════════════════════════════════════
// SECTION 8 — MUTATIONOBSERVER
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