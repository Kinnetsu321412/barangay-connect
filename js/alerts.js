// js/alerts.js
// ─────────────────────────────────────────────────────────────────
// Shared alert banner system. Add to EVERY page:
//   <script type="module" src="js/alerts.js"></script>
//   (adjust path depth as needed — "../js/alerts.js" etc.)
//
// Sources:
//   1. Firestore siteAlerts — admin-created, real-time via onSnapshot
//   2. USGS Earthquake API  — free, no key, polls every 5 min
//      covers Philippines bounding box, mag ≥ 4.5
//
// Dismiss state lives in sessionStorage — survives page navigation
// within a tab, clears when the tab closes.
// ─────────────────────────────────────────────────────────────────

import { auth, db }          from './firebase-config.js';
import { userIndexDoc, barangayId as toBid, userDoc } from './db-paths.js';
import {
  collection, query, where, onSnapshot, getDoc, addDoc, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";


// ── Config ───────────────────────────────────────────────────────

const USGS_POLL_MS  = 5 * 60 * 1000; // 5 minutes
const USGS_LOOKBACK = 6 * 60 * 60 * 1000; // only show quakes < 6h old
const STORAGE_KEY   = 'bc_dismissed_alerts';

// ── Alert sounds ─────────────────────────────────────────────────
// Add your files to assets/sounds/ and map them by severity.
// Adjust the path depth if alerts.js is used on pages in subdirectories
// e.g. '../assets/sounds/...' for pages one level deep.

const ALERT_SOUNDS = {
  red:    new Audio('../assets/sounds/alert-red.mp3'),    // emergency — loud/urgent
  orange: new Audio('../assets/sounds/alert-orange.mp3'), // advisory — moderate
  green:  new Audio('../assets/sounds/alert-green.mp3'),  // resolved — soft chime
  blue:   new Audio('../assets/sounds/alert-blue.mp3'),   // info — subtle
};

// Preload so there's no delay on first play
Object.values(ALERT_SOUNDS).forEach(a => { a.preload = 'auto'; });

// Severity → CSS class + Lucide icon
const SEVERITY_MAP = {
  red:    { cls: 'alert-banner--red',    icon: 'siren'          },
  orange: { cls: 'alert-banner--orange', icon: 'triangle-alert' },
  green:  { cls: 'alert-banner--green',  icon: 'circle-check'   },
  blue:   { cls: 'alert-banner--blue',   icon: 'info'           },
};

function playAlertSound(severity) {
  const audio = ALERT_SOUNDS[severity];
  if (!audio) return;

  // Browsers block autoplay until the user has interacted with the page.
  // If it fails silently that's fine — the banner still shows.
  audio.currentTime = 0; // rewind so repeated alerts replay from the start
  audio.play().catch(() => {});
}


// ── Session-dismissed set ────────────────────────────────────────

function getDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); }
  catch { return new Set(); }
}

function saveDismissed(id) {
  const s = getDismissed();
  s.add(id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...s]));
}


// ── Banner stack container ───────────────────────────────────────
// Injected as the very first child of <body>, above the static
// .alert-banner that may already exist in the HTML.

function getStack() {
  let el = document.getElementById('js-alert-stack');
  if (!el) {
    el = document.createElement('div');
    el.id = 'js-alert-stack';
    el.style.cssText = `
      position: sticky;
      top: var(--navbar-h);
      z-index: 399;
      width: 100%;
    `;

    const navbar = document.querySelector('.navbar');
    if (navbar) {
      navbar.insertAdjacentElement('afterend', el);
    } else {
      document.body.prepend(el); // fallback for pages without a navbar
    }
  }
  return el;
}


// ── Render a single banner ───────────────────────────────────────

function renderBanner(id, { severity = 'blue', title, message, dismissible = true }) {
  if (getDismissed().has(id))               return;
  if (document.getElementById(`jsa-${id}`)) return;

  const { cls, icon } = SEVERITY_MAP[severity] ?? SEVERITY_MAP.blue;

  const div = document.createElement('div');
  div.id        = `jsa-${id}`;
  div.className = `alert-banner ${cls}`;
  div.setAttribute('role', 'alert');
  div.innerHTML = `
    <i data-lucide="${icon}"></i>
    <p><strong>${esc(title)}:</strong> ${esc(message)}</p>
    ${dismissible
      ? `<button class="btn btn--close btn--sm" aria-label="Dismiss alert">
           <i data-lucide="x"></i>
         </button>`
      : ''}
  `;

  if (dismissible) {
    div.querySelector('button').addEventListener('click', () => {
      saveDismissed(id);
      div.remove();
    });
  }

  getStack().prepend(div);
  if (window.lucide) lucide.createIcons({ el: div });

  // ← Play sound after banner is in the DOM
  playAlertSound(severity);
}

function removeBanner(id) {
  document.getElementById(`jsa-${id}`)?.remove();
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


// ── Firestore real-time listener ─────────────────────────────────
// onSnapshot = instant push to every open tab the moment admin
// creates, edits, or deactivates an alert.

let _unsubFirestore = null;

function listenAlerts(barangay) {
  if (_unsubFirestore) { _unsubFirestore(); }

  const col = collection(db, 'barangays', toBid(barangay), 'siteAlerts');
  const q   = query(col, where('active', '==', true));

  _unsubFirestore = onSnapshot(q, (snap) => {
    const now       = new Date();
    const activeIds = new Set();

    snap.forEach(docSnap => {
      const d = docSnap.data();

      // Respect expiresAt — treat as inactive if past
      if (d.expiresAt && d.expiresAt.toDate() < now) return;

      activeIds.add(docSnap.id);
      renderBanner(docSnap.id, d);
    });

    // Remove banners for alerts deleted/deactivated in Firestore
    document.querySelectorAll('[id^="jsa-"]').forEach(el => {
      const rawId = el.id.slice(4); // strip "jsa-"
      if (rawId.startsWith('usgs-')) return; // USGS handled separately
      if (!activeIds.has(rawId)) el.remove();
    });
  });
}

// ── Curfew banner listener ────────────────────────────────────────
// Checks active curfew schedules every minute and shows/hides a banner.

let _curfewTimer = null;

function listenCurfews(barangay, userDob = null) {
  const col = collection(db, 'barangays', toBid(barangay), 'curfewSchedules');
  const q   = query(col, where('active', '==', true));

  function getUserAge() {
  if (!userDob) return null;
  const today = new Date(), birth = new Date(userDob + 'T00:00:00');
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

  onSnapshot(q, (snap) => {
    if (_curfewTimer) clearInterval(_curfewTimer);
    const schedules = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    function check() {
      const now    = new Date();
      const today  = now.toISOString().slice(0, 10);
      const hhmm   = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()];
      console.log('[curfew check]', { hhmm, dayName, schedules });
      let active = null;

      for (const s of schedules) {
        if (s.type === 'weekly') {
          if (!(s.days||[]).includes(dayName)) continue;
          if ((s.exceptions||[]).includes(today)) continue;
        } else if (s.type === 'once') {
          if (s.date !== today) continue;
        } else {
          // manual — already filtered by active:true above, so always show
          active = s; break;
        }
        // Check time window (handles overnight: e.g. 22:00–05:00)
        const crosses = s.endTime < s.startTime;
        const inWindow = crosses
          ? (hhmm >= s.startTime || hhmm < s.endTime)
          : (hhmm >= s.startTime && hhmm < s.endTime);
        if (inWindow) { active = s; break; }
      }

      if (active) {
        const age = getUserAge();
        //console.log('[curfew]', { affects: active.affects, age, userDob });
        
        const shouldSkip = (() => {
        if (!age) return false;
        if (active.affects === 'Minors Only' && age >= 18) return true;
        if (active.affects?.startsWith('Ages ')) {
          const parts = active.affects.replace('Ages ', '').split('-');
          const min = Number(parts[0]), max = Number(parts[1]);
          if (age < min || age > max) return true;
        }
        return false;
      })();

      if (shouldSkip) {
        removeBanner('curfew-active');
      } else {
        removeBanner('curfew-active');
        renderBanner('curfew-active', {
          severity: 'orange',
          title: `Curfew in effect — ${active.name}`,
          message: `${active.startTime} – ${active.endTime}. ${
            active.affects?.toLowerCase() === 'minors only'
              ? 'Minors must be accompanied by a guardian.'
              : 'All residents must observe curfew hours.'
          }`,
          dismissible: false,
        });
      }
      } else {
        removeBanner('curfew-active');
      }
    }
    check();
    _curfewTimer = setInterval(check, 60_000); // re-check every minute
  });
}


// ── USGS Earthquake polling ──────────────────────────────────────
// Scoped to the Philippines bounding box, mag ≥ 4.5.
// Renders locally (sessionStorage dedup). Does NOT write to Firestore —
// admins can create a proper alert from the admin panel if needed.
//
// Optional: add OpenWeatherMap weather alerts below this function.
// API: https://api.openweathermap.org/data/3.0/onecall
//      Add 'alerts' to the exclude param and parse res.alerts[].
//      Requires a free API key at openweathermap.org.

let _lastUsgsId = localStorage.getItem('bc_usgs_last') || null;

async function pollUsgs() {
  const since = new Date(Date.now() - USGS_LOOKBACK).toISOString().slice(0, 19);
  const url   =
    'https://earthquake.usgs.gov/fdsnws/event/1/query' +
    '?format=geojson&minmagnitude=4.5' +
    '&minlatitude=5.5&maxlatitude=21.5' +
    '&minlongitude=115&maxlongitude=127' +
    `&starttime=${since}&orderby=time&limit=1`;

  try {
    const res  = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return;

    const json = await res.json();
    if (!json.features?.length) return;

    const { id, properties: p } = json.features[0];

    if (id === _lastUsgsId) return; // same event, skip
    _lastUsgsId = id;
    localStorage.setItem('bc_usgs_last', id);

    const mag   = Number(p.mag ?? 0).toFixed(1);
    const place = p.place || 'near the Philippines';
    const time  = new Date(p.time).toLocaleTimeString('en-PH', {
      hour: '2-digit', minute: '2-digit',
    });

    renderBanner(`usgs-${id}`, {
      severity:    parseFloat(mag) >= 6.0 ? 'red' : 'orange',
      title:       `Earthquake M${mag}`,
      message:     `${place} at ${time}. Stay calm and follow PHIVOLCS advisories.`,
      dismissible: true,
    });

  } catch {
    // Network error — fail silently, never break the page
  }
}


// ── Test helper (admin console / dev only) ───────────────────────
// Usage from browser console: createTestAlert()

window.createTestAlert = async function (barangayName = 'Bancod') {
  const bid = toBid(barangayName);
  const col = collection(db, 'barangays', bid, 'siteAlerts');
  const ref = await addDoc(col, {
    type:        'test',
    severity:    'orange',
    title:       'TEST ALERT — Admin Drill',
    message:     'This is a test. Dismiss it and reload — it should stay dismissed.',
    source:      'admin',
    active:      true,
    dismissible: true,
    expiresAt:   Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
    createdAt:   Timestamp.now(),
    createdBy:   'admin-test',
  });
  console.log('[test] Alert written:', ref.id);
}

// ── Bootstrap ───────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
  // USGS runs regardless of login state
  await pollUsgs();
  setInterval(pollUsgs, USGS_POLL_MS);

  if (!user) return; // Firestore alerts need barangay scope

  try {
    const snap = await getDoc(userIndexDoc(user.uid));
    if (!snap.exists()) return;

    const { barangay } = snap.data();
    listenAlerts(barangay);

    // Fetch DOB for age-based curfew filtering
    let userDob = null;
    try {
      const fullSnap = await getDoc(userDoc(barangay, user.uid));
      if (fullSnap.exists()) userDob = fullSnap.data().dob ?? null;
    } catch (e) {}
    listenCurfews(barangay, userDob);
  } catch (err) {
    console.warn('[alerts.js] Firestore subscription failed:', err.message);
  }
});