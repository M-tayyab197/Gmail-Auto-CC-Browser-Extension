// ============================================================
// popup.js — Milestone 2: Email Management
// Responsibilities:
//   - Load saved emails from Chrome Storage when popup opens
//   - Validate and add new email addresses
//   - Prevent duplicate entries
//   - Display all saved emails as a rendered list
//   - Delete individual emails
//   - Clear all saved emails
// ============================================================


// ── 1. CONSTANTS ────────────────────────────────────────────
// A single key name used to read/write our email array in storage.
// Keeping it as a constant prevents typos scattered across the file.
const STORAGE_KEY = 'ccEmails';


// ── 2. DOM REFERENCES ────────────────────────────────────────
// Grab every element we'll interact with.
// We do this once at the top rather than inside each function —
// querying the DOM is slightly expensive, so cache the references.
const emailInput  = document.getElementById('emailInput');
const addBtn      = document.getElementById('addBtn');
const emailList   = document.getElementById('emailList');
const emptyState  = document.getElementById('emptyState');
const errorMsg    = document.getElementById('errorMsg');
const clearAllBtn = document.getElementById('clearAllBtn');


// ── 3. EMAIL VALIDATION ──────────────────────────────────────
// A simple regex that catches obvious mistakes:
//   - Something before the @
//   - Something after the @
//   - A dot and domain extension at the end
// It's intentionally not overly strict — true RFC-compliant
// email validation is surprisingly complex and unnecessary here.
function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}


// ── 4. ERROR HELPERS ─────────────────────────────────────────
function showError(message) {
  errorMsg.textContent = message;
  errorMsg.classList.remove('hidden');
}

function clearError() {
  errorMsg.textContent = '';
  errorMsg.classList.add('hidden');
}


// ── 5. CHROME STORAGE HELPERS ────────────────────────────────

// READ: chrome.storage.sync.get is asynchronous.
// It doesn't return a value — instead, it calls your callback
// function once the data is ready. This is why we pass a function
// (callback) as an argument and do our work inside it.
function loadEmails(callback) {
  chrome.storage.sync.get([STORAGE_KEY], (result) => {
    // result is an object like: { ccEmails: ['a@b.com', 'c@d.com'] }
    // If nothing is saved yet, result[STORAGE_KEY] is undefined,
    // so we fall back to an empty array with || []
    const emails = result[STORAGE_KEY] || [];
    callback(emails);
  });
}

// WRITE: Saves the entire updated array back to storage.
// We always overwrite the full array — not append to it —
// because Chrome Storage works with full key-value replacement.
function saveEmails(emails, callback) {
  chrome.storage.sync.set({ [STORAGE_KEY]: emails }, () => {
    if (callback) callback();
  });
}


// ── 6. RENDER THE EMAIL LIST ─────────────────────────────────
// This function is the "single source of truth" for the UI.
// Whenever the data changes, we call this to rebuild the list
// from scratch. This is simpler and safer than trying to
// surgically add/remove individual DOM elements.
function renderEmailList(emails) {

  // Wipe the current list completely before rebuilding
  emailList.innerHTML = '';

  // ── Empty state ──
  if (emails.length === 0) {
    emptyState.classList.remove('hidden');
    clearAllBtn.style.visibility = 'hidden'; // hide "Clear all" when nothing to clear
    return; // nothing more to do
  }

  // ── There are emails: hide the empty state, show Clear All ──
  emptyState.classList.add('hidden');
  clearAllBtn.style.visibility = 'visible';

  // ── Build one <li> for each saved email ──
  emails.forEach((email) => {

    const li = document.createElement('li');
    li.className = 'email-item';

    // Avatar: the first character of the email, uppercased
    const letter = email.charAt(0).toUpperCase();

    // data-email stores the email on the button so the delete
    // handler knows which address to remove
    li.innerHTML = `
      <div class="avatar">${letter}</div>
      <span class="email-text" title="${email}">${email}</span>
      <button class="delete-btn" data-email="${email}" aria-label="Remove ${email}">
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15"
             viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    `;

    emailList.appendChild(li);
  });

  // Attach delete click listeners after the new elements exist in the DOM
  document.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', handleDelete);
  });
}


// ── 7. ADD EMAIL HANDLER ─────────────────────────────────────
function handleAdd() {

  // .trim() removes accidental leading/trailing spaces
  const raw = emailInput.value.trim();

  // Guard 1 — empty field
  if (!raw) {
    showError('Please enter an email address.');
    return;
  }

  // Guard 2 — invalid format
  if (!isValidEmail(raw)) {
    showError('That doesn\'t look like a valid email address.');
    return;
  }

  // Normalise to lowercase so "Test@Gmail.com" and "test@gmail.com"
  // are treated as the same address
  const email = raw.toLowerCase();

  // We must load first to get the current list before modifying it
  loadEmails((emails) => {

    // Guard 3 — duplicate check
    if (emails.includes(email)) {
      showError('This email address is already saved.');
      return;
    }

    // All checks passed — add to array and save
    const updated = [...emails, email]; // spread creates a new array (don't mutate)

    saveEmails(updated, () => {
      emailInput.value = ''; // clear the input field
      clearError();
      renderEmailList(updated); // rebuild the UI with the new list
    });
  });
}


// ── 8. DELETE EMAIL HANDLER ──────────────────────────────────
function handleDelete(event) {

  // event.currentTarget is always the button the listener was
  // attached to — even if the user clicked the SVG icon inside it.
  // (event.target would be the SVG child, not the button itself.)
  const btn = event.currentTarget;
  const emailToDelete = btn.dataset.email; // read the data-email attribute

  loadEmails((emails) => {
    // .filter creates a new array with the target email removed
    const updated = emails.filter((item) => item !== emailToDelete);
    saveEmails(updated, () => {
      renderEmailList(updated);
    });
  });
}


// ── 9. CLEAR ALL HANDLER ─────────────────────────────────────
function handleClearAll() {
  // Save an empty array — this effectively wipes all saved emails
  saveEmails([], () => {
    renderEmailList([]);
  });
}


// ── 10. EVENT LISTENERS ──────────────────────────────────────
addBtn.addEventListener('click', handleAdd);

// Let the user press Enter instead of clicking Add
emailInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') handleAdd();
});

// Live: clear the error message as soon as the user starts retyping
emailInput.addEventListener('input', () => {
  if (!errorMsg.classList.contains('hidden')) clearError();
});

clearAllBtn.addEventListener('click', handleClearAll);


// ── 11. INITIALISE ───────────────────────────────────────────
// This runs immediately when the popup opens.
// It loads whatever is in storage and renders it — so the list
// is always up to date the moment the popup appears.
loadEmails(renderEmailList);