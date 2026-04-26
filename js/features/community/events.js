/* ================================================
   events.js — BarangayConnect
   Resident-facing events system for community.html.
   Renders the Events tab: card grid, filters,
   pagination, and a read-only event detail modal.
   RSVP writes are Phase 3.

   Firestore path:
     barangays/{barangayId}/events/{eventId}
     barangays/{barangayId}/events/{eventId}/rsvps/{uid}

   Event document shape (relevant fields):
     title, description, category, imageURL,
     authorRole ("official"|"resident"),
     isApproved, dateStart, dateEnd, timeStart, timeEnd,
     location, totalSlots, showSlotsPublicly,
     waitlistEnabled, attendees[], waitlist[],
     status ("active"|"postponed"|"cancelled"|"completed"),
     statusReason, isPinned, isWalkIn,
     submittedBy, submittedByName, createdAt

   WHAT IS IN HERE:
     · initEvents() — auth bootstrap + Firestore subscription
     · Real-time onSnapshot — pinned first, then newest
     · Filter state — category, source, availability, myEvents
     · Card renderer with skeleton loader
     · Event detail modal (read-only)
     · View toggle wiring — Cards ↔ Calendar
     · Filter pill wiring — all controls in the Events panel
     · Pagination (PAGE_SIZE = 9)
     · Toast helper and XSS escape utility

   WHAT IS NOT IN HERE:
     · RSVP writes / waitlist joins     → events.js Phase 3
     · Calendar widget                  → events-calendar.js
     · Admin event management           → events-admin.js
     · Firestore path helpers           → db-paths.js
     · Firebase config                  → firebase-config.js

   REQUIRED IMPORTS:
     · /js/core/firebase-config.js      (db, auth)
     · /js/core/db-paths.js             (eventsCol, userIndexDoc, barangayId)
     · firebase-firestore.js@10.12.0    (onSnapshot, query, where, orderBy,
                                         orderBy, getDocs, getDoc)
     · firebase-auth.js@10.12.0         (onAuthStateChanged)

   QUICK REFERENCE:
     Init            → initEvents() [called from bootstrap on auth]
     Open detail     → window.openEventDetail(eventId)
     Category filter → window._filterEventCategory(cat)
     Pagination      → window._eventsPage(dir)
================================================ */


// ================================================
// IMPORTS
// ================================================

import { db, auth } from '/js/core/firebase-config.js';
import { eventsCol, eventDoc, userIndexDoc, barangayId as toBid } from '/js/core/db-paths.js';

import {
  onSnapshot, query, where, orderBy, getDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import {
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';


// ================================================
// CATEGORY META
// Updated to match Phase 1 category set.
// ================================================

const EVENT_CATS = {
  health:     { label: 'Health',      tagClass: 'tag--green', icon: 'activity'  },
  sports:     { label: 'Sports',      tagClass: 'tag--amber', icon: 'trophy'    },
  youth:      { label: 'Youth',       tagClass: 'tag--purple',icon: 'zap'       },
  livelihood: { label: 'Livelihood',  tagClass: 'tag--blue',  icon: 'briefcase' },
  culture:    { label: 'Culture',     tagClass: 'tag--teal',  icon: 'sparkles'  },
  seniors:    { label: 'Seniors',     tagClass: 'tag--red',   icon: 'heart'     },
};

const STATUS_LABELS = {
  postponed:  'Postponed',
  cancelled:  'Cancelled',
  completed:  'Completed',
};


// ================================================
// MODULE STATE
// ================================================

let _barangayId       = null;
let _uid              = null;
let _role             = 'resident';
let _allEvents        = [];       // live snapshot cache
let _userRsvps        = new Set(); // eventIds the user has RSVP'd (Phase 3)
let _unsub            = null;

/* Filter state */
let _activeCategory   = 'all';
let _activeSource     = 'all';   // 'all' | 'official' | 'community'
let _activeAvail      = 'all';   // 'all' | 'open' | 'walkin'
let _myEventsOnly     = false;

/* Pagination */
const PAGE_SIZE       = 9;
let _currentPage      = 0;


// ================================================
// INIT
// ================================================

/*
   Called after auth resolves with the user's resolved barangayId.
   Wires all filter controls then starts the Firestore subscription.
*/
export async function initEvents(barangayId, uid, role) {
  _barangayId = barangayId;
  _uid        = uid;
  _role       = role ?? 'resident';

  const grid = document.getElementById('eventsCardsGrid');
  if (!grid || !_barangayId) return;

  _wireFilters();
  _wireViewToggle();
  _renderSkeleton(grid);
  _subscribe(grid);

  /* Show Propose button for logged-in users */
  if (_uid) {
    const proposeBtn = document.getElementById('proposeEventBtn');
    if (proposeBtn) proposeBtn.style.display = '';
  }

  /* Show My Events toggle for logged-in users */
  if (_uid) {
    const myToggle = document.getElementById('myEventsToggle');
    if (myToggle) myToggle.style.display = '';
  }
}


// ================================================
// SUBSCRIPTION
// ================================================

/*
   Listens to approved, non-deleted events.
   Pinned events first, then newest first.
   Pending events from the current user are also included
   so they can see their own submissions.
*/
function _subscribe(grid) {
  if (_unsub) _unsub();

  const q = query(
    eventsCol(_barangayId),
    where('isApproved', '==', true),
    orderBy('isPinned',  'desc'),
    orderBy('createdAt', 'desc'),
  );

  _unsub = onSnapshot(q, snap => {
    _allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _currentPage = 0;
    _renderEvents(grid);
    /* Keep calendar in sync if it's currently visible */
    if (window.updateEventsCalendar
        && document.getElementById('eventsCalendarView')?.style.display !== 'none') {
      window.updateEventsCalendar(_allEvents);
    }
  }, err => {
    console.error('[events] subscription error', err);
  });
}


// ================================================
// FILTER HELPERS
// ================================================

function _applyFilters(events) {
  return events.filter(ev => {
    /* Category */
    if (_activeCategory !== 'all' && ev.category !== _activeCategory) return false;

    /* Source */
    if (_activeSource === 'official'  && ev.authorRole !== 'official')  return false;
    if (_activeSource === 'community' && ev.authorRole !== 'resident')  return false;

    /* Availability */
    if (_activeAvail === 'walkin' && !ev.isWalkIn) return false;
    if (_activeAvail === 'open') {
      const full = ev.totalSlots != null
        && (ev.attendees?.length ?? 0) >= ev.totalSlots
        && !ev.waitlistEnabled;
      if (full || ev.isWalkIn) return false;
    }

    /* My Events */
    if (_myEventsOnly && _uid) {
      if (!_userRsvps.has(ev.id) && ev.submittedBy !== _uid) return false;
    }

    return true;
  });
}


// ================================================
// RENDER — CARDS
// ================================================

function _renderEvents(grid) {
  if (!grid) return;

  const filtered = _applyFilters(_allEvents);
  const total    = filtered.length;
  const start    = _currentPage * PAGE_SIZE;
  const page     = filtered.slice(start, start + PAGE_SIZE);

  if (!total) {
    grid.innerHTML = _buildEmptyState();
    _renderPagination(null, 0, 0);
    if (typeof lucide !== 'undefined') lucide.createIcons({ el: grid });
    return;
  }

  grid.innerHTML = page.map(_buildEventCard).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons({ el: grid });

  _renderPagination(grid.parentElement, _currentPage, Math.ceil(total / PAGE_SIZE));
}

function _buildEventCard(ev) {
  const cat      = EVENT_CATS[ev.category] ?? { label: ev.category, tagClass: 'tag--gray', icon: 'calendar' };
  const dateStr  = _formatDateRange(ev.dateStart, ev.dateEnd);
  const timeStr  = ev.timeStart
    ? `${_fmt12(ev.timeStart)}${ev.timeEnd ? ` – ${_fmt12(ev.timeEnd)}` : ''}`
    : '';

  const categoryTag = `<span class="event-card__category-tag tag ${cat.tagClass}">${cat.label}</span>`;

  const sourceBadge = ev.authorRole === 'official'
    ? `<span class="event-card__source-badge">
         <i data-lucide="shield-check" style="width:10px;height:10px;"></i> Official
       </span>`
    : '';

  const statusBar = ev.status && ev.status !== 'active'
    ? `<div class="event-card__status-bar event-card__status-bar--${esc(ev.status)}">
         <i data-lucide="clock" style="width:12px;height:12px;"></i>
         ${STATUS_LABELS[ev.status] ?? ev.status}
       </div>`
    : '';

  const imgSrc = ev.imageURL || ev.imageURLs?.[0] || '';
  const imgHtml = imgSrc
    ? `<img class="event-card__img" src="${esc(imgSrc)}" alt="${esc(ev.title)}" loading="lazy" />`
    : `<div class="event-card__img" style="background:var(--gray-100);display:flex;align-items:center;justify-content:center;">
         <i data-lucide="${cat.icon}" style="width:32px;height:32px;color:var(--gray-300);stroke-width:1.5;"></i>
       </div>`;

  return `
    <article class="event-card" data-event-id="${esc(ev.id)}">
      ${statusBar}
      <div class="event-card__img-wrap">
        ${imgHtml}
        ${categoryTag}
        ${sourceBadge}
      </div>
      <div class="event-card__body">
        <h3 class="event-card__title">${esc(ev.title)}</h3>
        ${dateStr ? `<p class="event-card__date-row">
          <i data-lucide="calendar" style="width:13px;height:13px;"></i> ${esc(dateStr)}
        </p>` : ''}
        ${timeStr ? `<p class="event-card__date-row">
          <i data-lucide="clock" style="width:13px;height:13px;"></i> ${esc(timeStr)}
        </p>` : ''}
        ${ev.location ? `<p class="event-card__location-row">
          <i data-lucide="map-pin" style="width:13px;height:13px;"></i> ${esc(ev.location)}
        </p>` : ''}
        <div class="event-card__footer">
          ${_buildSlotsBadge(ev)}
          <button class="btn btn--green btn--sm"
            onclick="openEventDetail('${esc(ev.id)}')">
            View Details
          </button>
        </div>
      </div>
    </article>`;
}

function _buildSlotsBadge(ev) {
  if (ev.isWalkIn) {
    return `<span class="badge-slots" style="background:var(--green-100);color:var(--green-800);">
      <i data-lucide="check-circle"></i> Walk-in
    </span>`;
  }
  if (ev.totalSlots == null) {
    return `<span class="badge-slots" style="background:var(--green-100);color:var(--green-800);">
      <i data-lucide="users"></i> Open
    </span>`;
  }
  const taken    = ev.attendees?.length ?? 0;
  const remaining = ev.totalSlots - taken;
  if (remaining <= 0) {
    return ev.waitlistEnabled
      ? `<span class="badge-slots"><i data-lucide="clock"></i> Waitlist open</span>`
      : `<span class="badge-slots" style="background:var(--red-50);color:var(--red);">
           <i data-lucide="x-circle"></i> Full
         </span>`;
  }
  return `<span class="badge-slots"><i data-lucide="users"></i> ${remaining} slot${remaining !== 1 ? 's' : ''} left</span>`;
}

function _buildEmptyState() {
  return `
    <div class="events-empty" style="grid-column:1/-1;">
      <i data-lucide="calendar-x"></i>
      <p class="events-empty__title">No events found</p>
      <p class="events-empty__sub">Try a different category or check back later.</p>
    </div>`;
}


// ================================================
// RENDER — SKELETON
// ================================================

function _renderSkeleton(grid) {
  grid.innerHTML = Array.from({ length: 6 }).map(() => `
    <div class="events-skeleton">
      <div class="events-skeleton__img"></div>
      <div class="events-skeleton__body">
        <div class="skeleton skeleton--tag" style="width:70px;margin-bottom:4px;"></div>
        <div class="skeleton skeleton--title" style="margin-bottom:6px;"></div>
        <div class="skeleton skeleton--body"></div>
        <div class="skeleton skeleton--body-sm" style="margin-top:4px;"></div>
      </div>
    </div>`).join('');
}


// ================================================
// RENDER — PAGINATION
// ================================================

function _renderPagination(container, page, totalPages) {
  const existing = document.getElementById('eventsPagination');
  if (existing) existing.remove();
  if (!container || totalPages <= 1) return;

  const nav = document.createElement('div');
  nav.id = 'eventsPagination';
  nav.className = 'bulletin-pagination';
  nav.innerHTML = `
    <button class="btn btn--outline btn--sm" onclick="window._eventsPage(-1)"
      ${page === 0 ? 'disabled' : ''}>
      <i data-lucide="chevron-left"></i> Prev
    </button>
    <span class="bulletin-pagination__label">Page ${page + 1} of ${totalPages}</span>
    <button class="btn btn--outline btn--sm" onclick="window._eventsPage(1)"
      ${page >= totalPages - 1 ? 'disabled' : ''}>
      Next <i data-lucide="chevron-right"></i>
    </button>`;
  container.after(nav);
  if (typeof lucide !== 'undefined') lucide.createIcons({ el: nav });
}

window._eventsPage = function (dir) {
  const filtered    = _applyFilters(_allEvents);
  const totalPages  = Math.ceil(filtered.length / PAGE_SIZE);
  _currentPage      = Math.max(0, Math.min(_currentPage + dir, totalPages - 1));
  const grid        = document.getElementById('eventsCardsGrid');
  if (grid) {
    _renderEvents(grid);
    grid.closest('.community-panel-inner')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};


// ================================================
// EVENT DETAIL MODAL
// ================================================

window.openEventDetail = async function (eventId) {
  const modal   = document.getElementById('eventDetailModal');
  const bodyEl  = document.getElementById('eventDetailBody');
  const footerEl = document.getElementById('eventDetailFooter');
  if (!modal || !bodyEl) return;

  modal.classList.add('is-open');

  /* Try cache first, fall back to Firestore */
  let ev = _allEvents.find(e => e.id === eventId);
  if (!ev) {
    try {
      const snap = await getDoc(eventDoc(_barangayId, eventId));
      if (snap.exists()) ev = { id: snap.id, ...snap.data() };
    } catch { /* non-fatal */ }
  }

  if (!ev) {
    bodyEl.innerHTML = `<p style="color:var(--gray-400);text-align:center;padding:var(--space-xl) 0;">
      Event not found.
    </p>`;
    return;
  }

  const cat     = EVENT_CATS[ev.category] ?? { label: ev.category, tagClass: 'tag--gray', icon: 'calendar' };
  const dateStr = _formatDateRange(ev.dateStart, ev.dateEnd);
  const timeStr = ev.timeStart
    ? `${_fmt12(ev.timeStart)}${ev.timeEnd ? ` – ${_fmt12(ev.timeEnd)}` : ''}`
    : '';

  /* ── Header (injected into modal body since modal--event-detail has no header slot) ── */
  const _catHeaderColors = {
    health: 'var(--green-dark)', sports: '#76410f', youth: '#42207c',
    livelihood: '#184096', culture: '#0f766e', seniors: '#760f0f',
  };
  const headerColor = _catHeaderColors[ev.category] ?? (ev.authorRole === 'official' ? 'var(--green-dark)' : '#374151');
  const headerHtml = `
    <div class="modal__header" style="background:${headerColor};">
      <div class="modal__header-icon"><i data-lucide="${cat.icon}"></i></div>
      <div class="modal__header-content">
        <p class="modal__header-label">${cat.label}</p>
        <h2 class="modal__header-title">${esc(ev.title)}</h2>
        ${ev.authorRole === 'official'
          ? `<p class="modal__header-sub"><i data-lucide="shield-check" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> Official Event</p>`
          : `<p class="modal__header-sub">Community-submitted · ${esc(ev.submittedByName ?? 'Resident')}</p>`}
      </div>
      <button class="btn btn--close btn--sm modal__close" onclick="event.stopPropagation();closeModal('eventDetailModal')">
        <i data-lucide="x"></i>
      </button>
    </div>`;

  /* ── Slots info ── */
  const taken     = ev.attendees?.length ?? 0;
  const remaining = ev.totalSlots != null ? ev.totalSlots - taken : null;
  const slotsHtml = ev.showSlotsPublicly && ev.totalSlots != null
    ? `<div style="display:flex;align-items:center;gap:.5rem;font-size:var(--text-sm);color:var(--gray-600);margin-top:var(--space-sm);">
         <i data-lucide="users" style="width:14px;height:14px;flex-shrink:0;"></i>
         <span>${taken} registered · ${remaining != null ? `${remaining} slot${remaining !== 1 ? 's' : ''} remaining` : 'Unlimited'}</span>
       </div>
       ${ev.waitlistEnabled && ev.waitlist?.length
         ? `<div style="display:flex;align-items:center;gap:.5rem;font-size:var(--text-sm);color:var(--gray-500);">
              <i data-lucide="clock" style="width:14px;height:14px;flex-shrink:0;"></i>
              ${ev.waitlist.length} on waitlist
            </div>`
         : ''}`
    : '';

  /* ── Status notice ── */
  const statusHtml = ev.status && ev.status !== 'active'
    ? `<div class="event-card__status-bar event-card__status-bar--${esc(ev.status)}" style="border-radius:var(--radius-sm);margin-bottom:var(--space-md);">
         <i data-lucide="clock" style="width:14px;height:14px;"></i>
         ${STATUS_LABELS[ev.status] ?? ev.status}
         ${ev.statusReason ? ` — ${esc(ev.statusReason)}` : ''}
       </div>`
    : '';

  bodyEl.innerHTML = headerHtml + `
    <div style="padding:var(--space-lg);display:flex;flex-direction:column;gap:var(--space-md);">
      ${statusHtml}
      <div style="display:flex;flex-direction:column;gap:var(--space-sm);">
        <p class="modal-section-label">Date &amp; Time</p>
        ${dateStr ? `<div style="display:flex;align-items:center;gap:.5rem;font-size:var(--text-sm);color:var(--gray-700);">
          <i data-lucide="calendar" style="width:14px;height:14px;flex-shrink:0;"></i> ${esc(dateStr)}
        </div>` : ''}
        ${timeStr ? `<div style="display:flex;align-items:center;gap:.5rem;font-size:var(--text-sm);color:var(--gray-700);">
          <i data-lucide="clock" style="width:14px;height:14px;flex-shrink:0;"></i> ${esc(timeStr)}
        </div>` : ''}
        ${ev.location ? `<div style="display:flex;align-items:center;gap:.5rem;font-size:var(--text-sm);color:var(--gray-700);">
          <i data-lucide="map-pin" style="width:14px;height:14px;flex-shrink:0;"></i> ${esc(ev.location)}
        </div>` : ''}
      </div>
      ${ev.description ? `
        <div>
          <p class="modal-section-label">About this Event</p>
          <p style="font-size:var(--text-sm);color:var(--gray-600);line-height:var(--lh-relaxed);margin:0;">${esc(ev.description)}</p>
        </div>` : ''}
      ${slotsHtml ? `<div style="display:flex;flex-direction:column;gap:.25rem;">${slotsHtml}</div>` : ''}
    </div>`;

  /* ── Footer — RSVP stub (Phase 3) ── */
  if (footerEl) {
    const canRsvp  = ev.status === 'active' && _uid;
    const isFull   = ev.totalSlots != null
      && taken >= ev.totalSlots
      && !ev.waitlistEnabled;

    let actionBtn;
    if (!_uid) {
      actionBtn = `<span style="font-size:var(--text-sm);color:var(--gray-400);">Sign in to RSVP</span>`;
    } else if (ev.isWalkIn) {
      actionBtn = `<button class="btn btn--green btn--full" disabled>Walk-in Welcome — No RSVP Needed</button>`;
    } else if (isFull) {
      actionBtn = `<button class="btn btn--outline btn--full" disabled>Event Full</button>`;
    } else if (ev.waitlistEnabled && remaining <= 0) {
      actionBtn = `<button class="btn btn--orange btn--full" disabled>Join Waitlist — Coming Soon</button>`;
    } else {
      actionBtn = `<button class="btn btn--green btn--full" disabled>RSVP — Coming Soon</button>`;
    }

    footerEl.innerHTML = `
      <button class="btn btn--outline" onclick="closeModal('eventDetailModal')">Close</button>
      ${actionBtn}`;
  }

  if (typeof lucide !== 'undefined') lucide.createIcons({ el: modal });
};


// ================================================
// FILTER WIRING
// ================================================

function _wireFilters() {

  /* Category pills */
  document.getElementById('eventsCategoryFilters')?.querySelectorAll('.btn--filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('eventsCategoryFilters').querySelectorAll('.btn--filter')
        .forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _activeCategory = btn.dataset.category ?? 'all';
      _currentPage = 0;
      _renderEvents(document.getElementById('eventsCardsGrid'));
    });
  });

  /* Source seg */
  document.querySelectorAll('.events-seg-btn[data-source]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.events-seg-btn[data-source]')
        .forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _activeSource = btn.dataset.source ?? 'all';
      _currentPage = 0;
      _renderEvents(document.getElementById('eventsCardsGrid'));
    });
  });

  /* Availability seg */
  document.querySelectorAll('.events-seg-btn[data-avail]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.events-seg-btn[data-avail]')
        .forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _activeAvail = btn.dataset.avail ?? 'all';
      _currentPage = 0;
      _renderEvents(document.getElementById('eventsCardsGrid'));
    });
  });

  /* My Events toggle */
  document.getElementById('myEventsCheck')?.addEventListener('change', e => {
    _myEventsOnly = e.target.checked;
    _currentPage  = 0;
    _renderEvents(document.getElementById('eventsCardsGrid'));
  });
}


// ================================================
// VIEW TOGGLE WIRING — Cards ↔ Calendar
// ================================================

function _wireViewToggle() {
  document.querySelectorAll('.events-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.events-view-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const view = btn.dataset.view;
      const cardsView = document.getElementById('eventsCardsView');
      const calView   = document.getElementById('eventsCalendarView');
      if (cardsView) cardsView.style.display = view === 'cards' ? '' : 'none';
      if (calView)   calView.style.display   = view === 'calendar' ? '' : 'none';
      /* Phase 2.5 — calendar module hook */
      if (view === 'calendar' && window.initEventsCalendar) {
        window.initEventsCalendar(_allEvents, 'eventsCalContainer', 'eventsCalSidebarList', 'eventsCalSidebarTitle');
      }
    });
  });
}


// ================================================
// UTILITIES
// ================================================

function _formatDateRange(start, end) {
  if (!start) return '';
  const opts = { month: 'short', day: 'numeric', year: 'numeric' };
  const s    = new Date(start + 'T00:00:00');
  if (!end || end === start) return s.toLocaleDateString('en-PH', opts);
  const e    = new Date(end   + 'T00:00:00');
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} – ${e.getDate()}, ${e.getFullYear()}`;
  }
  return `${s.toLocaleDateString('en-PH', opts)} – ${e.toLocaleDateString('en-PH', opts)}`;
}

function _fmt12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm   = h >= 12 ? 'PM' : 'AM';
  const h12    = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _showToast(msg, type = 'success') {
  let c = document.getElementById('_eventsToasts');
  if (!c) {
    c = document.createElement('div');
    c.id = '_eventsToasts';
    c.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;display:flex;flex-direction:column;gap:.5rem;z-index:2100;pointer-events:none;';
    document.body.appendChild(c);
  }
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.style.pointerEvents = 'all';
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}


// ================================================
// BOOTSTRAP
// ================================================

/*
   Resolves auth state → userIndex → barangayId → initEvents.
   Shares the same auth listener pattern as community-polls.js
   and bulletin.js so they race-free resolve in parallel.
*/
onAuthStateChanged(auth, async user => {
  const grid = document.getElementById('eventsCardsGrid');
  if (!grid) return; // not on community page

  if (!user) {
    /* Guest — still show events if they exist, just no RSVP or propose */
    /* If _communityBid is already set by bulletin.js bootstrap, reuse it */
    if (window._communityBid) {
      _barangayId = window._communityBid;
      _wireFilters();
      _wireViewToggle();
      _renderSkeleton(grid);
      _subscribe(grid);
    } else {
      grid.innerHTML = _buildEmptyState();
    }
    return;
  }

  try {
    const snap  = await getDoc(userIndexDoc(user.uid));
    if (!snap.exists()) return;
    const { barangay, role } = snap.data();

    await initEvents(
      toBid(barangay),
      user.uid,
      role ?? 'resident',
    );
  } catch (err) {
    console.error('[events] bootstrap error', err);
    _showToast('Failed to load events.', 'error');
  }
});