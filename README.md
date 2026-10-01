# Gmail Auto-CC Chrome Extension

A Chrome browser extension built with **HTML, CSS, and vanilla JavaScript** that automatically adds predefined email addresses to the **CC field of new Gmail compose windows**.

## Overview

The Gmail Auto-CC extension allows a user to save one or more default CC email addresses from the extension popup.

Whenever the user opens a new Gmail compose window, the extension detects the compose window and automatically adds the saved addresses to the CC field.

### Example

Saved CC addresses:

```text
john@gmail.com
sales@company.com
manager@company.com
```

When the user opens a new Gmail message:

```text
To: customer@example.com

CC: [john@gmail.com ×] [sales@company.com ×] [manager@company.com ×]

Subject:
```

The goal is to make the CC process automatic so the user does not need to enter the same CC addresses manually every time.

---

# Features

## 1. Manage Saved CC Addresses

The extension popup allows the user to:

* Add an email address
* Save multiple email addresses
* Validate email addresses
* Display saved email addresses
* Delete saved email addresses
* Prevent duplicate addresses
* Persist addresses using Chrome Storage

## 2. Automatic Gmail CC

When the user opens a new Gmail compose window, the extension:

1. Detects the compose window.
2. Locates the CC field.
3. Opens the CC field when necessary.
4. Retrieves saved CC addresses.
5. Adds the saved addresses to the CC field.
6. Prevents duplicate recipients.
7. Avoids processing the same compose window repeatedly.

---

# Technologies

This project intentionally uses simple web technologies.

| Technology         | Purpose                                             |
| ------------------ | --------------------------------------------------- |
| HTML               | Extension popup structure                           |
| CSS                | Popup design and styling                            |
| JavaScript         | Application logic and Gmail integration             |
| Chrome Manifest V3 | Extension configuration                             |
| Chrome Storage API | Persistent email storage                            |
| Content Scripts    | Running JavaScript inside Gmail                     |
| MutationObserver   | Detecting dynamically created Gmail compose windows |

No React, Vue, Angular, Firebase, or backend is required for the initial version.

---

# Project Structure

```text
gmail-cc-extension/
│
├── manifest.json
│
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
│
├── content/
   └── gmail.js

## File Responsibilities

### `manifest.json`

Defines the Chrome extension configuration, including:

* Extension name
* Version
* Permissions
* Gmail access
* Popup location
* Content scripts

### `popup/popup.html`

Contains the popup interface.

### `popup/popup.css`

Contains the popup styling.

### `popup/popup.js`

Handles:

* Adding emails
* Validating emails
* Displaying saved emails
* Deleting emails
* Reading/writing Chrome Storage

### `content/gmail.js`

Handles Gmail integration.

It is responsible for:

* Detecting Gmail compose windows
* Finding the CC field
* Reading saved addresses
* Adding recipients
* Preventing duplicate insertion
* Handling dynamic Gmail DOM changes

---

# How the Extension Works

The general flow is:

```text
User clicks extension icon
        ↓
Extension popup opens
        ↓
User adds CC email addresses
        ↓
Addresses are stored in Chrome Storage
        ↓
User opens Gmail
        ↓
User clicks Compose
        ↓
Content script detects compose window
        ↓
Extension finds CC field
        ↓
Extension reads saved addresses
        ↓
Extension inserts the addresses into CC
        ↓
Done
```

---

# Storage

Saved email addresses are stored using the Chrome Extension Storage API.

Example stored data:

```text
ccEmails:
[
    "john@gmail.com",
    "sales@company.com",
    "manager@company.com"
]
```

The popup and Gmail content script must use the **same storage area and storage key**.

For example:

```text
Storage area:
chrome.storage.sync

Storage key:
ccEmails
```

---

# Gmail Integration

Gmail is a dynamic web application, so the compose window is not necessarily present when the page first loads.

The extension therefore uses a `MutationObserver` to watch for dynamically added Gmail elements.

Conceptually:

```text
Gmail page loads
        ↓
Content script starts
        ↓
MutationObserver watches the DOM
        ↓
Compose window appears
        ↓
Extension detects it
        ↓
CC processing starts
```

---

# Important Gmail Compatibility Note

The Gmail compose interface is part of Google's web application and its internal DOM can change.

For this reason, the extension should avoid depending on only one CSS class or one DOM structure.

The Gmail integration should use:

* Multiple selector fallbacks
* DOM checks
* Timeouts
* Retry logic where appropriate
* Recipient verification
* Per-compose processing state

The extension should also be tested again when Gmail changes its interface.

---

# Development Roadmap

## Milestone 1 — Extension Basics

* Create `manifest.json`
* Create popup
* Load extension into Chrome
* Verify popup opens

## Milestone 2 — Email Manager

* Add email input
* Validate email
* Save email
* Display emails
* Delete emails
* Prevent duplicates
* Persist data

## Milestone 3 — Gmail Connection

* Load content script on Gmail
* Verify script execution
* Test Chrome DevTools logging

## Milestone 4 — Compose Detection

* Detect dynamically created compose windows
* Use `MutationObserver`
* Prevent duplicate processing

## Milestone 5 — CC Detection

* Find CC button
* Open CC field
* Find CC recipient input

## Milestone 6 — Automatic CC

* Read saved addresses
* Insert one recipient
* Insert multiple recipients
* Verify recipient chips
* Prevent duplicate recipients

## Milestone 7 — Reliability

* Handle multiple compose windows
* Handle closed compose windows
* Handle empty storage
* Handle invalid data
* Handle Gmail DOM changes
* Handle repeated DOM mutations

## Milestone 8 — UI Improvements(Future Improvements)

* Improve popup design
* Add enable/disable switch
* Add success/error messages
* Improve usability

---

# Testing Checklist

Before considering the extension stable, verify:

### Extension

* [ ] Extension loads without manifest errors
* [ ] Extension icon appears
* [ ] Popup opens
* [ ] Popup closes correctly

### Email Management

* [ ] Valid email can be added
* [ ] Invalid email is rejected
* [ ] Multiple emails can be saved
* [ ] Duplicate email is rejected
* [ ] Email can be deleted
* [ ] Saved emails remain after popup is reopened
* [ ] Saved emails remain after extension reload

### Gmail

* [ ] Content script runs on Gmail
* [ ] Compose window is detected
* [ ] CC field is found
* [ ] CC field opens when necessary
* [ ] First saved email appears as a recipient chip
* [ ] Multiple saved emails appear as recipient chips
* [ ] Duplicate recipients are prevented
* [ ] Same compose window is not processed repeatedly

---

# Example Expected Behavior

Suppose the extension contains:

```text
john@gmail.com
sales@company.com
manager@company.com
```

The user opens Gmail and clicks **Compose**.

The expected result is:

```text
CC: [john@gmail.com ×] [sales@company.com ×] [manager@company.com ×]
```

These must be actual Gmail recipient chips, not merely text left inside the CC input.

---

# Debugging

Open Gmail and press:

```text
F12
```

or:

```text
Ctrl + Shift + J
```

on Windows/Linux.

Then open the **Console** tab.

The extension logs messages such as:

```text
[Gmail Auto CC] Content script running.
[Gmail Auto CC] Compose window detected.
[Gmail Auto CC] CC input found.
[Gmail Auto CC] Processing emails.
```

Use these messages to determine which stage of the workflow is failing.

---

# Development Notes

When changing `gmail.js` during development:

1. Save the file.
2. Open `chrome://extensions`.
3. Reload the extension.
4. Refresh the Gmail tab.
5. Open a new Compose window.
6. Check the DevTools Console.

Refreshing Gmail after reloading the extension is important because the previous content-script instance can remain attached to the already-open Gmail page.

---

# Current Scope

### Supported

* Google Chrome
* Gmail
* Multiple saved CC email addresses
* Manifest V3
* HTML/CSS/JavaScript

### Not Yet Supported

* Outlook
* Other email providers
* Backend/server synchronization
* User accounts
* Team administration
* Centralized company configuration

Outlook support can be implemented later as a separate integration because Outlook and Gmail have different web interfaces and DOM structures.

---

# Future Improvements

Possible future versions may include:

* Outlook support
* Enable/Disable switch
* Per-domain CC settings
* Different CC lists for different Gmail accounts
* Import/export of CC lists
* Company-managed default CC addresses
* Options/settings page
* Chrome Web Store distribution
* Better Gmail compatibility handling
* Milestone 8 - UI Improvements

---

# Project Status

Current project stage:

```text
Gmail Auto-CC Chrome Extension
        ↓
Feature 1: Saved CC emails
        ↓
Feature 2: Gmail automatic CC
        ↓
Testing and reliability improvements
```

This project is currently intended for **local development and testing as an unpacked Chrome extension**.

---

# License

Add your preferred license here when the project is ready for distribution.
