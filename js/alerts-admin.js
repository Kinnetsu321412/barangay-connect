/* ================================================
   alerts-admin.js — BarangayConnect
   Admin interface for broadcasting and managing site-wide alerts.
   Runs only for authenticated users; scoped to their barangay.

   WHAT IS IN HERE:
     · Severity design token maps and label strings
     · Module-level state (countdown timer, current collection ref, form visibility)
     · injectConfirmModal     — lazily injects the two-step publish modal into the DOM
     · showPublishConfirm     — returns a Promise; resolves on publish, rejects on cancel
     · renderAlertForm        — toggles between the collapsed button and the full form
     · handleCreateAlert      — reads form, runs the confirm flow, writes to Firestore
     · initAlertsAdmin        — bootstraps the snapshot listener and form for a barangay
     · renderAlertList        — renders the full list of alert management rows
     · buildAlertRow          — builds a single alert row element with toggle / delete actions
     · toggleAlert            — flips the active flag on an alert document
     · deleteAlert            — permanently removes an alert document
     · esc                    — HTML-escapes strings for safe innerHTML interpolation
     · showAdminToast         — appends a transient toast to #toastContainer

   WHAT IS NOT IN HERE:
     · Firebase config and db instance         → firebase-config.js
     · Firestore path helpers                  → db-paths.js
     · Global modal / frame styles             → frames.css
     · Resident-facing alert banner rendering  → alerts.js

   REQUIRED IMPORTS:
     · ./firebase-config.js          (auth, db)
     · ./db-paths.js                 (userIndexDoc, barangayId as toBid)
     · firebase-firestore.js@10.12.0 (collection, onSnapshot, addDoc, updateDoc,
                                      deleteDoc, doc, serverTimestamp, Timestamp,
                                      orderBy, query, getDoc)
     · firebase-auth.js@10.12.0      (onAuthStateChanged)

   QUICK REFERENCE:
     Bootstrap          → onAuthStateChanged (top-level, runs on load)
     Init per barangay  → initAlertsAdmin(barangay)
     Confirm flow       → showPublishConfirm(alertData) → Promise
     Form toggle        → window.showAlertForm() / window.hideAlertForm()
     Row actions        → window.toggleAlert(id, barangayId, newState)
                          window.deleteAlert(id, barangay)
================================================ */


// ================================================
// IMPORTS
// ================================================

import { auth, db }                           from './firebase-config.js';
import { userIndexDoc, barangayId as toBid }  from './db-paths.js';

import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, Timestamp, orderBy, query,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";


// ================================================
// CONSTANTS — Severity Maps
// ================================================

/* Maps severity keys to design token sets for inline styling */
const SEVERITY = {
  red:    { bg: 'var(--red-100)',  text: 'var(--red-900)',     border: 'var(--red)'          },
  orange: { bg: 'var(--amber-50)', text: 'var(--amber-950)',   border: 'var(--orange-hover)' },
  green:  { bg: 'var(--green-50)', text: 'var(--success-800)', border: 'var(--green-dark)'   },
  blue:   { bg: 'var(--blue-50)',  text: 'var(--blue-800)',    border: 'var(--blue-600)'     },
};

/* Fallback tokens used when a severity key is unrecognised */
const SEVERITY_FALLBACK = {
  bg: 'var(--gray-100)', text: 'var(--gray-700)', border: 'var(--gray-400)',
};

/* Human-readable labels rendered in the publish confirm summary */
const SEVERITY_LABELS = {
  red:    '🔴 Red — Emergency',
  orange: '🟠 Orange — Advisory',
  green:  '🟢 Green — Resolved',
  blue:   '🔵 Blue — Info',
};


// ================================================
// CONSTANTS — Countdown Ring
// ================================================

const COUNTDOWN_SECS     = 5;
const RING_CIRCUMFERENCE = 163.4;   // 2π × r(26) — kept for reference
const RING_R             = 30;
const RING_CIRC          = 2 * Math.PI * RING_R;  // 188.5 — used by the ring animation


// ================================================
// MODULE STATE
// ================================================

let _countdownTimer   = null;   // setInterval handle for the publish countdown
let _currentCol       = null;   // Firestore collection ref, set by initAlertsAdmin
let _alertFormVisible = false;  // tracks whether the create form is expanded


// ================================================
// CONFIRM MODAL — Injection
// ================================================

/*
   Lazily injects the two-step publish modal into the document body.
   Safe to call multiple times — exits early if the modal already exists.
*/

function injectConfirmModal() {
  if (document.getElementById('alertPublishModal')) return;

  const el = document.createElement('div');
  el.innerHTML = `
    <div class="modal-backdrop" id="alertPublishModal"
         role="dialog" aria-modal="true" aria-labelledby="apmTitle">
      <div class="modal">

        <!-- STEP 1: Warning notice -->
        <div id="apmStep1">
          <div class="modal__icon modal__icon--officer" id="apmIcon">
            <i data-lucide="triangle-alert"></i>
          </div>
          <div class="modal__title" id="apmTitle">Broadcast Alert?</div>
          <div class="modal__body" id="apmBody"></div>
          <div class="modal__actions">
            <button class="modal__btn modal__btn--cancel" id="apmCancelBtn1">
              <i data-lucide="x"></i> Cancel
            </button>
            <button class="modal__btn modal__btn--confirm admin-confirm"
                    id="apmProceedBtn">
              <i data-lucide="arrow-right"></i> I Understand, Proceed
            </button>
          </div>
        </div>

        <!-- STEP 2: Countdown (hidden until step 1 confirmed) -->
        <div id="apmStep2" hidden>
          <div class="modal__icon modal__icon--officer">
            <i data-lucide="clock"></i>
          </div>
          <div class="modal__title">Publishing in…</div>
          <div class="modal__body">
            <p style="
              font-size:   var(--text-base-sm);
              color:       var(--text-muted);
              text-align:  center;
              margin:      0;
              line-height: var(--lh-relaxed);
            ">
              The alert will go live when the timer hits zero.<br>
              You can still cancel now.
            </p>
          </div>

          <!-- Countdown ring -->
          <div style="
            display:        flex;
            flex-direction: column;
            align-items:    center;
            gap:            var(--space-sm);
            margin:         var(--space-lg) 0;
          ">
            <div style="position: relative; width: 72px; height: 72px;">
              <svg width="72" height="72" style="transform: rotate(-90deg);">
                <circle cx="36" cy="36" r="30"
                  fill="none"
                  stroke="var(--gray-100)"
                  stroke-width="5" />
                <circle id="apmRing" cx="36" cy="36" r="30"
                  fill="none"
                  stroke="var(--orange)"
                  stroke-width="5"
                  stroke-linecap="round"
                  stroke-dasharray="188.5"
                  stroke-dashoffset="0"
                  style="transition: stroke-dashoffset 1s linear, stroke 0.3s;" />
              </svg>
              <span id="apmCountNum" style="
                position:        absolute;
                inset:           0;
                display:         flex;
                align-items:     center;
                justify-content: center;
                font-family:     var(--font-display);
                font-weight:     var(--fw-black);
                font-size:       var(--text-2xl);
                color:           var(--orange-hover);
                transition:      color 0.3s;
              ">5</span>
            </div>
            <p style="
              font-size: var(--text-sm);
              color:     var(--text-muted);
              margin:    0;
            ">
              Auto-publishing in <strong id="apmCountLabel">5</strong>s…
            </p>
          </div>

          <div class="modal__actions">
            <button class="modal__btn modal__btn--cancel" id="apmCancelBtn2">
              <i data-lucide="x"></i> Cancel
            </button>
            <button class="modal__btn modal__btn--confirm admin-confirm"
                    id="apmPublishNowBtn">
              <i data-lucide="send"></i> Publish Now
            </button>
          </div>
        </div>

      </div>
    </div>
  `;

  document.body.appendChild(el.firstElementChild);
  lucide.createIcons({ el: document.getElementById('alertPublishModal') });
}


// ================================================
// CONFIRM MODAL — Two-Step Publish Flow
// ================================================

/*
   Returns a Promise that resolves when the admin confirms publication
   (either via "Publish Now" or countdown expiry) and rejects on cancel.

   Step 1 — displays a broadcast warning and alert summary.
            Admin must click "I Understand, Proceed" to continue.
   Step 2 — shows a 5-second countdown ring; auto-resolves at zero.
            Admin can still cancel or skip ahead with "Publish Now".

   Nothing is written to Firestore here — the caller (handleCreateAlert)
   awaits this Promise and writes only on resolve.
*/

function showPublishConfirm(alertData) {
  injectConfirmModal();

  return new Promise((resolve, reject) => {
    const modal      = document.getElementById('alertPublishModal');
    const step1      = document.getElementById('apmStep1');
    const step2      = document.getElementById('apmStep2');
    const body       = document.getElementById('apmBody');
    const icon       = document.getElementById('apmIcon');
    const ring       = document.getElementById('apmRing');
    const countNum   = document.getElementById('apmCountNum');
    const countLabel = document.getElementById('apmCountLabel');
    const cancelBtn1 = document.getElementById('apmCancelBtn1');
    const cancelBtn2 = document.getElementById('apmCancelBtn2');
    const proceedBtn = document.getElementById('apmProceedBtn');
    const nowBtn     = document.getElementById('apmPublishNowBtn');

    /* Reset to step 1 */
    step1.hidden = false;
    step2.hidden = true;

    /* Colour the icon to match severity */
    icon.className = 'modal__icon';
    if      (alertData.severity === 'red')   icon.classList.add('modal__icon--admin');
    else if (alertData.severity === 'green') icon.classList.add('modal__icon--resident');
    else                                     icon.classList.add('modal__icon--officer');

    /* Build expiry line for the summary block */
    const expiryLine = alertData.expiresAt
      ? `<br>⏱ Auto-expires: <strong>${alertData.expiresAt.toDate().toLocaleString('en-PH', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })}</strong>`
      : '';

    body.innerHTML = `
      <!-- Broadcast warning notice -->
      <div style="
        background:    var(--amber-50);
        border:        1.5px solid var(--amber-200);
        border-radius: var(--radius-md);
        padding:       var(--space-md);
        margin-bottom: var(--space-md);
        display:       flex;
        gap:           var(--space-sm);
        align-items:   flex-start;
      ">
        <i data-lucide="users" style="
          color:       var(--orange-hover);
          flex-shrink: 0;
          margin-top:  2px;
          width: 18px; height: 18px;
        "></i>
        <p style="
          font-size:   var(--text-base-sm);
          font-weight: var(--fw-semibold);
          color:       var(--amber-950);
          margin:      0;
          line-height: var(--lh-snug);
        ">
          This alert will be <strong>immediately visible to every resident</strong>
          currently viewing the site. Non-dismissible alerts cannot be closed
          by residents until you deactivate them.
        </p>
      </div>

      <!-- Alert summary -->
      <div style="
        background:    var(--gray-50);
        border:        1.5px solid var(--gray-200);
        border-radius: var(--radius-md);
        padding:       var(--space-md);
        font-size:     var(--text-sm);
        color:         var(--text-dark);
        line-height:   var(--lh-relaxed);
      ">
        <strong>${esc(alertData.title)}</strong><br>
        ${esc(alertData.message)}<br>
        <span style="color: var(--text-muted);">
          ${SEVERITY_LABELS[alertData.severity] ?? alertData.severity}
          &nbsp;·&nbsp; Type: ${alertData.type}
          &nbsp;·&nbsp; ${alertData.dismissible ? 'Dismissible' : '⚠️ Non-dismissible'}
          ${expiryLine}
        </span>
      </div>
    `;

    lucide.createIcons({ el: body });
    modal.classList.add('visible');


    // ---- Step 1 handlers ----

    function onCancel() {
      cleanup();
      reject(new Error('cancelled'));
    }

    function onProceed() {
      step1.hidden = true;
      step2.hidden = false;
      startCountdown();
    }

    cancelBtn1.addEventListener('click', onCancel,  { once: true });
    proceedBtn.addEventListener('click', onProceed, { once: true });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) onCancel();
    }, { once: true });


    // ---- Step 2: countdown ----

    function startCountdown() {
      let remaining = COUNTDOWN_SECS;

      ring.style.strokeDasharray  = String(RING_CIRC);
      ring.style.strokeDashoffset = '0';
      ring.style.stroke           = 'var(--orange)';
      countNum.style.color        = 'var(--orange-hover)';
      countNum.textContent        = remaining;
      countLabel.textContent      = remaining;

      function tick() {
        remaining -= 1;
        countNum.textContent   = remaining;
        countLabel.textContent = remaining;

        const progress = (COUNTDOWN_SECS - remaining) / COUNTDOWN_SECS;
        ring.style.strokeDashoffset = String(RING_CIRC * progress);

        /* Turn red in the last 2 seconds as a visual urgency cue */
        if (remaining <= 2) {
          ring.style.stroke    = 'var(--red)';
          countNum.style.color = 'var(--red)';
        }

        if (remaining <= 0) {
          cleanup();
          resolve();
        }
      }

      _countdownTimer = setInterval(tick, 1000);

      cancelBtn2.addEventListener('click', onCancel,     { once: true });
      nowBtn.addEventListener(    'click', onPublishNow, { once: true });
    }

    function onPublishNow() {
      cleanup();
      resolve();
    }


    // ---- Shared cleanup ----

    function cleanup() {
      clearInterval(_countdownTimer);
      _countdownTimer = null;

      /* Reset visual state for the next open */
      ring.style.stroke    = 'var(--orange)';
      countNum.style.color = 'var(--orange-hover)';

      modal.classList.remove('visible');

      /*
         Belt-and-suspenders listener removal. Most listeners use {once:true},
         but cancelBtn2 may fire after the countdown already cleaned up —
         safe to call removeEventListener on a listener that no longer exists.
      */
      cancelBtn1.removeEventListener('click', onCancel);
      cancelBtn2.removeEventListener('click', onCancel);
      proceedBtn.removeEventListener('click', onProceed);
      nowBtn.removeEventListener(    'click', onPublishNow);
    }
  });
}


// ================================================
// ALERT FORM — Render, Show, Hide
// ================================================

/*
   Renders either the collapsed "Publish New Alert" trigger button
   or the full create form, depending on _alertFormVisible.
   Called by initAlertsAdmin on load and by show/hideAlertForm.
*/

function renderAlertForm(col) {
  const wrap = document.getElementById('alertCreateFormWrap');
  if (!wrap) return;

  if (!_alertFormVisible) {
    wrap.innerHTML = `
      <button onclick="showAlertForm()"
        style="display:flex;align-items:center;justify-content:center;gap:.6rem;
          width:100%;padding:.85rem 1.5rem;border-radius:12px;
          border:2px dashed #d1d5db;background:white;
          color:#374151;font-size:.9rem;font-weight:600;cursor:pointer;
          transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.04);margin-bottom:2rem;"
        onmouseover="this.style.borderColor='#1a3a1a';this.style.color='#1a3a1a';this.style.background='#f0fdf4'"
        onmouseout="this.style.borderColor='#d1d5db';this.style.color='#374151';this.style.background='white'">
        <i data-lucide="plus-circle" style="width:18px;height:18px;"></i>
        Publish New Alert
      </button>`;
    lucide.createIcons({ el: wrap });
    return;
  }

  wrap.innerHTML = `
    <div style="background:white;border-radius:12px;padding:1.5rem;
      box-shadow:0 1px 4px rgba(0,0,0,0.08);margin-bottom:2rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
        <h2 style="font-size:1rem;font-weight:700;margin:0;">Publish New Alert</h2>
        <button onclick="hideAlertForm()"
          style="padding:.4rem .9rem;border-radius:8px;border:1.5px solid #e0e0e0;
            background:#fff;color:#555;font-size:.8rem;font-weight:500;cursor:pointer;">
          Cancel
        </button>
      </div>
      <form id="alertCreateForm" style="display:grid;gap:1rem;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;">
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;text-transform:uppercase;color:#888;margin-bottom:4px">Severity</label>
            <select id="alertSeverity" style="width:100%;padding:0.55rem 0.75rem;border:1.5px solid #e0e0e0;border-radius:8px;font-size:0.875rem;outline:none;">
              <option value="orange">🟠 Orange — Advisory</option>
              <option value="red">🔴 Red — Emergency</option>
              <option value="blue">🔵 Blue — Info</option>
              <option value="green">🟢 Green — Resolved</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;text-transform:uppercase;color:#888;margin-bottom:4px">Type</label>
            <select id="alertType" style="width:100%;padding:0.55rem 0.75rem;border:1.5px solid #e0e0e0;border-radius:8px;font-size:0.875rem;outline:none;">
              <option value="weather">Weather</option>
              <option value="earthquake">Earthquake</option>
              <option value="emergency">Emergency</option>
              <option value="maintenance">Maintenance</option>
              <option value="info">Info</option>
            </select>
          </div>
          <div style="display:flex;align-items:flex-end;gap:0.5rem;padding-bottom:2px;">
            <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.875rem;font-weight:500;cursor:pointer;">
              <input type="checkbox" id="alertDismissible" checked style="width:16px;height:16px;" />
              Users can dismiss
            </label>
          </div>
        </div>
        <div>
          <label style="display:block;font-size:0.75rem;font-weight:600;text-transform:uppercase;color:#888;margin-bottom:4px">Title</label>
          <input id="alertTitle" type="text" required placeholder="e.g. Weather Advisory, Typhoon Carina"
            style="width:100%;padding:0.55rem 0.75rem;border:1.5px solid #e0e0e0;border-radius:8px;font-size:0.875rem;outline:none;" />
        </div>
        <div>
          <label style="display:block;font-size:0.75rem;font-weight:600;text-transform:uppercase;color:#888;margin-bottom:4px">Message</label>
          <textarea id="alertMessage" required rows="2" placeholder="Brief description visible to all residents…"
            style="width:100%;padding:0.55rem 0.75rem;border:1.5px solid #e0e0e0;border-radius:8px;font-size:0.875rem;outline:none;resize:vertical;"></textarea>
        </div>
        <div>
          <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.875rem;font-weight:500;cursor:pointer;margin-bottom:0.5rem;">
            <input type="checkbox" id="alertExpiresToggle" style="width:16px;height:16px;" onchange="document.getElementById('alertExpiresWrap').hidden = !this.checked" />
            Set expiry time (auto-hide after)
          </label>
          <div id="alertExpiresWrap" hidden>
            <input type="datetime-local" id="alertExpiresAt"
              style="padding:0.55rem 0.75rem;border:1.5px solid #e0e0e0;border-radius:8px;font-size:0.875rem;outline:none;" />
          </div>
        </div>
        <div>
          <button type="submit" id="alertCreateBtn" class="btn btn--success">
            <i data-lucide="send"></i> Publish Alert
          </button>
        </div>
      </form>
    </div>`;

  lucide.createIcons({ el: wrap });

  document.getElementById('alertCreateForm')
    ?.addEventListener('submit', (e) => { e.preventDefault(); handleCreateAlert(col); });
}

/* Expands the create form and scrolls it into view */
window.showAlertForm = function() {
  _alertFormVisible = true;
  renderAlertForm(_currentCol);
  document.getElementById('alertCreateFormWrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/* Collapses the create form back to the trigger button */
window.hideAlertForm = function() {
  _alertFormVisible = false;
  renderAlertForm(_currentCol);
};


// ================================================
// ALERT FORM — Create Handler
// ================================================

/*
   Reads and validates the form fields, runs the two-step publish confirm,
   and writes the new alert to Firestore on resolve.
   The form stays populated if the admin cancels the confirm flow.
*/

async function handleCreateAlert(col) {
  const btn = document.getElementById('alertCreateBtn');

  const title       = document.getElementById('alertTitle').value.trim();
  const message     = document.getElementById('alertMessage').value.trim();
  const severity    = document.getElementById('alertSeverity').value;
  const type        = document.getElementById('alertType').value;
  const dismissible = document.getElementById('alertDismissible').checked;
  const useExpiry   = document.getElementById('alertExpiresToggle').checked;
  const expiresVal  = document.getElementById('alertExpiresAt').value;

  let expiresAt = null;
  if (useExpiry && expiresVal) {
    expiresAt = Timestamp.fromDate(new Date(expiresVal));
  }

  const alertData = {
    type, severity, title, message,
    source: 'admin', active: true, dismissible, expiresAt,
  };

  /* Run two-step confirm before touching Firestore */
  try {
    await showPublishConfirm(alertData);
  } catch {
    return; // Admin cancelled — form stays populated, nothing written
  }

  btn.disabled = true;

  try {
    await addDoc(col, {
      ...alertData,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.uid,
    });

    _alertFormVisible = false;
    renderAlertForm(col);
    showAdminToast('Alert published — visible to all residents now.', 'success');

  } catch (err) {
    console.error('Create alert failed:', err);
    showAdminToast('Failed to publish alert. Please try again.', 'error');
  } finally {
    btn.disabled = false;
  }
}


// ================================================
// BOOTSTRAP
// ================================================

/*
   Resolves the admin's barangay from userIndex, then initialises
   the snapshot listener and form. Dynamic import of getDoc avoids
   a circular dependency with the top-level imports.
*/

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const { getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  const snap = await getDoc(userIndexDoc(user.uid));
  if (!snap.exists()) return;

  const { barangay } = snap.data();
  initAlertsAdmin(barangay);
});

function initAlertsAdmin(barangay) {
  const col = collection(db, 'barangays', toBid(barangay), 'siteAlerts');
  _currentCol = col;

  const q = query(col, orderBy('createdAt', 'desc'));
  onSnapshot(q, (snap) => renderAlertList(barangay, snap.docs));

  renderAlertForm(col);

  document.getElementById('alertExpiresToggle')
    ?.addEventListener('change', (e) => {
      document.getElementById('alertExpiresWrap').hidden = !e.target.checked;
    });
}


// ================================================
// ALERT LIST — Render
// ================================================

/*
   Renders all alert management rows into #alertsList.
   Shows an empty state when the snapshot contains no documents.
   Note: the empty-state innerHTML must be set explicitly here —
   the initial "Loading…" placeholder is never auto-cleared by the snapshot.
*/

function renderAlertList(barangay, docs) {
  const container = document.getElementById('alertsList');
  if (!container) return;

  if (!docs.length) {
    container.innerHTML = `
      <div style="
        background:    var(--white);
        border-radius: var(--radius-md);
        padding:       var(--space-2xl) var(--space-lg);
        box-shadow:    var(--shadow-sm);
        text-align:    center;
        color:         var(--gray-400);
      ">
        <i data-lucide="bell-off" style="
          width: 32px; height: 32px;
          margin-bottom: var(--space-sm);
          color: var(--gray-200);
          display: block;
          margin-inline: auto;
        "></i>
        <p style="font-size: var(--text-sm); margin: 0;">
          No alerts yet. Use the form above to broadcast one.
        </p>
      </div>
    `;
    lucide.createIcons({ el: container });
    return;
  }

  container.innerHTML = '';
  docs.forEach(docSnap => {
    container.appendChild(buildAlertRow(barangay, docSnap.id, docSnap.data()));
  });
  lucide.createIcons({ el: container });
}


// ================================================
// ALERT LIST — Build Row
// ================================================

/*
   Constructs and returns the DOM element for a single alert management row.
   Includes severity pill, title, message, metadata, and toggle / delete buttons.
*/

function buildAlertRow(barangay, id, d) {
  const sev     = SEVERITY[d.severity] ?? SEVERITY_FALLBACK;
  const expires = d.expiresAt
    ? `Expires ${d.expiresAt.toDate().toLocaleString('en-PH', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })}`
    : 'No expiry';
  const created = d.createdAt?.toDate?.()
    ?.toLocaleString('en-PH', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    ?? '—';

  const row = document.createElement('div');
  row.style.cssText = `
    background:    var(--white);
    border-radius: var(--radius-md);
    padding:       var(--space-md) var(--space-lg);
    box-shadow:    var(--shadow-sm);
    display:       grid;
    grid-template-columns: auto 1fr auto;
    gap:           var(--space-md);
    align-items:   start;
    opacity:       ${d.active ? '1' : '0.55'};
    border-left:   4px solid ${sev.border};
    transition:    opacity var(--transition);
  `;

  row.innerHTML = `
    <div>
      <span style="
        display:        inline-flex;
        align-items:    center;
        background:     ${sev.bg};
        color:          ${sev.text};
        padding:        4px 10px;
        border-radius:  var(--radius-full);
        font-size:      var(--text-2xs);
        font-weight:    var(--fw-bold);
        font-family:    var(--font-display);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        white-space:    nowrap;
      ">${esc(d.severity ?? 'blue')}</span>
    </div>

    <div>
      <p style="
        font-weight: var(--fw-semibold);
        font-size:   var(--text-base-sm);
        font-family: var(--font-display);
        color:       var(--text-dark);
        margin:      0 0 2px;
      ">
        ${esc(d.title)}
        ${d.active
          ? `<span style="background:var(--success-100);color:var(--success-800);
              font-size:var(--text-2xs);font-weight:var(--fw-bold);
              padding:2px 8px;border-radius:var(--radius-full);margin-left:6px;
              vertical-align:middle;">LIVE</span>`
          : `<span style="background:var(--gray-100);color:var(--gray-500);
              font-size:var(--text-2xs);font-weight:var(--fw-bold);
              padding:2px 8px;border-radius:var(--radius-full);margin-left:6px;
              vertical-align:middle;">INACTIVE</span>`
        }
      </p>
      <p style="font-size:var(--text-sm);color:var(--text-muted);
                margin:0 0 var(--space-xs);">
        ${esc(d.message)}
      </p>
      <p style="font-size:var(--text-2xs);color:var(--gray-400);margin:0;">
        ${esc(d.type)} &middot; ${esc(d.source)}
        &middot; Created ${created} &middot; ${expires}
        ${d.dismissible
          ? ''
          : `&middot; <strong style="color:var(--red);">Non-dismissible</strong>`}
      </p>
    </div>

    <div style="display:flex;gap:var(--space-sm);flex-shrink:0;">
      <button
        onclick="toggleAlert('${id}','${toBid(barangay)}',${!d.active})"
        title="${d.active ? 'Deactivate' : 'Reactivate'}"
        style="padding:6px 12px;border-radius:var(--radius-sm);
               border:1.5px solid var(--gray-200);background:var(--white);
               color:var(--gray-700);font-size:var(--text-sm);
               font-weight:var(--fw-semibold);cursor:pointer;">
        <i data-lucide="${d.active ? 'eye-off' : 'eye'}"></i>
      </button>
      <button
        onclick="deleteAlert('${id}','${barangay}')"
        title="Delete permanently"
        style="padding:6px 12px;border-radius:var(--radius-sm);
               border:1.5px solid var(--red-200);background:var(--red-50);
               color:var(--red);font-size:var(--text-sm);
               font-weight:var(--fw-semibold);cursor:pointer;">
        <i data-lucide="trash-2"></i>
      </button>
    </div>
  `;

  return row;
}


// ================================================
// ALERT ACTIONS — Toggle / Delete
// ================================================

/* Flips the active flag on an alert document */
window.toggleAlert = async function(id, barangayId, newState) {
  try {
    await updateDoc(doc(db, 'barangays', barangayId, 'siteAlerts', id), {
      active: newState,
    });
    showAdminToast(newState ? 'Alert reactivated.' : 'Alert deactivated.', 'success');
  } catch (err) {
    console.error('Toggle failed:', err);
    showAdminToast('Could not update alert.', 'error');
  }
};

/* Permanently removes an alert document after a native confirm */
window.deleteAlert = async function(id, barangay) {
  if (!confirm('Permanently delete this alert? This cannot be undone.')) return;
  try {
    await deleteDoc(doc(db, 'barangays', toBid(barangay), 'siteAlerts', id));
    showAdminToast('Alert deleted.', 'success');
  } catch (err) {
    console.error('Delete failed:', err);
    showAdminToast('Could not delete alert.', 'error');
  }
};


// ================================================
// UTILITIES
// ================================================

/* HTML-escapes a value for safe use in innerHTML interpolation */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

/* Appends a transient toast to #toastContainer; auto-removes after 3.5s */
function showAdminToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast     = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <i data-lucide="${type === 'success' ? 'check' : 'x-circle'}"></i>
    ${esc(message)}
  `;

  container.appendChild(toast);
  lucide.createIcons({ el: toast });
  setTimeout(() => toast.remove(), 3500);
}
