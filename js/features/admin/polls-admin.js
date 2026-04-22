/* ================================================
   polls-admin.js — BarangayConnect
   Official and admin management for community polls.
   Handles create, edit, publish, close, soft-delete,
   pin/unpin, deadline extension, and analytics.

   Firestore path:
     barangays/{barangayId}/polls/{pollId}
     barangays/{barangayId}/polls/{pollId}/poll_actions/{id}

   WHAT IS IN HERE:
     · onAuthStateChanged bootstrap — resolves barangay, role
     · Real-time polls listener (all non-deleted polls)
     · Poll list renderer with role-gated action buttons
     · Create / edit form — dynamic options, date pickers
     · Integrity guard — question + options locked once votes exist
     · Publish — draft → active
     · Extend deadline — reason required, logged to poll_actions
     · Close early — admin only, confirmation required
     · Soft delete — admin only, isDeleted flag, warns if has votes
     · Pin / unpin — admin only
     · Inline analytics — per-option breakdown (anonymous)
     · Poll action logger (logPollAction)
     · Toast and esc utilities

   WHAT IS NOT IN HERE:
     · Resident vote submission UI       → community-polls.js
     · Poll styles                       → polls.css
     · Firebase config                   → firebase-config.js
     · Firestore poll path helpers       → db-paths.js

   REQUIRED IMPORTS:
     · ../../core/firebase-config.js     (auth, db)
     · ../../core/db-paths.js            (userIndexDoc, barangayId as toBid,
                                          pollsCol, pollDoc, pollActionsCol)
     · firebase-firestore.js@10.12.0
     · firebase-auth.js@10.12.0

   QUICK REFERENCE:
     Open create form  → window.openPollForm()
     Edit poll         → window.editPoll(pollId)
     Publish poll      → window.publishPoll(pollId)
     Extend deadline   → window.extendDeadline(pollId)
     Close poll        → window.closePoll(pollId)
     Delete poll       → window.deletePoll(pollId, hasVotes)
     Toggle pin        → window.togglePinPoll(pollId, isPinned)
     View analytics    → window.viewPollAnalytics(pollId)
================================================ */


// ================================================
// IMPORTS
// ================================================

import { auth, db }                          from '../../core/firebase-config.js';
import {
  userIndexDoc, barangayId as toBid,
  pollsCol, pollDoc, pollActionsCol,
} from '../../core/db-paths.js';

import {
  onSnapshot, query, where, orderBy,
  getDoc, addDoc, updateDoc, deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import { notifyAllInBarangay } from '../../shared/notifications.js';
import { showConfirm } from '/js/shared/confirm-modal.js';


// ================================================
// MODULE STATE
// ================================================

let _bid   = null; // barangayId string (path-safe)
let _uid   = null;
let _role  = null; // 'officer' | 'admin'
let _polls = [];   // latest snapshot array
let _editId = null; // pollId being edited; null = create mode

const _CAT_COLORS = {
  announcements:  { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  health:         { bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
  infrastructure: { bg: '#fffbeb', color: '#92400e', border: '#fde68a' },
  safety:         { bg: '#fef2f2', color: '#991b1b', border: '#fecaca' },
  events:         { bg: '#f5f3ff', color: '#6d28d9', border: '#ddd6fe' },
  livelihood:     { bg: '#fff7ed', color: '#9a3412', border: '#fed7aa' },
  youth:          { bg: '#fdf4ff', color: '#7e22ce', border: '#e9d5ff' },
  environment:    { bg: '#f0fdf4', color: '#065f46', border: '#6ee7b7' },
  general:        { bg: '#f0fdfa', color: '#0f766e', border: '#99f6e4' },
};


// ================================================
// BOOTSTRAP
// ================================================

/*
   Resolves the officer/admin's barangay from userIndex.
   Guards: only officer and admin roles proceed.
   Starts real-time listener and renders the shell on success.
*/
onAuthStateChanged(auth, async user => {
  if (!user) return;

  const snap = await getDoc(userIndexDoc(user.uid));
  if (!snap.exists()) return;

  const { barangay, role } = snap.data();
  if (role !== 'admin' && role !== 'officer') return;

  _uid  = user.uid;
  _role = role;
  _bid  = toBid(barangay);

  _renderShell();
  _listenPolls();
});


// ================================================
// SUBSCRIPTION
// ================================================

/*
   Listens to all non-deleted polls — includes drafts which are
   invisible to residents but visible in the admin panel.
   Ordered newest first.
*/
function _listenPolls() {
  const q = query(
    pollsCol(_bid),
    where('isDeleted', '==', false),
    orderBy('createdAt', 'desc'),
  );

  onSnapshot(q, snap => {
    _polls = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderList();
  });
}


// ================================================
// RENDER — Shell
// ================================================

/*
   Injects the polls panel structure into #community-sub-polls.
   Called once on bootstrap; the list container is updated
   by every snapshot via _renderList().
*/
function _renderShell() {
  const el = document.getElementById('community-sub-polls');
  if (!el) return;

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
      margin-bottom:1.25rem;flex-wrap:wrap;gap:.75rem;">
      <h1 style="font-size:1.5rem;font-weight:700;margin:0;">Community Polls</h1>
      <button onclick="window.openPollForm()"
        style="display:inline-flex;align-items:center;gap:.4rem;padding:.5rem 1.1rem;
          border-radius:8px;background:#1a3a1a;color:#fff;border:none;
          font-size:.85rem;font-weight:600;cursor:pointer;">
        <i data-lucide="plus"></i> Create Poll
      </button>
    </div>
    <div id="pollFormWrap" style="margin-bottom:1.5rem;"></div>
    <div id="pollAdminList" style="display:flex;flex-direction:column;gap:1rem;"></div>`;

  lucide.createIcons({ el });
}


// ================================================
// RENDER — Poll List
// ================================================

function _renderList() {
  const el = document.getElementById('pollAdminList');
  if (!el) return;

  if (!_polls.length) {
    el.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:3rem;text-align:center;
        color:#aaa;box-shadow:0 1px 4px rgba(0,0,0,.07);">
        <div style="font-size:2rem;margin-bottom:.5rem;">🗳️</div>
        <p style="margin:0;font-size:.9rem;">No polls yet. Create one above.</p>
      </div>`;
    return;
  }

  el.innerHTML = _polls.map(p => _buildPollRow(p)).join('');
  lucide.createIcons({ el });
}


// ================================================
// BUILD — Poll Row
// ================================================

function _buildPollRow(p) {
  const total    = p.totalVotes ?? 0;
  const hasVotes = total > 0;
  const isAdmin  = _role === 'admin';

  const statusColor = { draft: '#f59e0b', active: '#16a34a', closed: '#6b7280' }[p.status] ?? '#6b7280';

  const deadline = p.endDate?.toDate?.()?.toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) ?? '—';

  const canEdit = p.status === 'draft' || (p.status === 'active' && !hasVotes);

  const editBtn = canEdit
    ? _btn('pencil', 'Edit', `window.editPoll('${esc(p.id)}')`, '')
    : '';

  const publishBtn = p.status === 'draft'
    ? _btn('send', 'Publish', `window.publishPoll('${esc(p.id)}')`, 'green')
    : '';

  const extendBtn = p.status === 'active' && hasVotes
    ? _btn('calendar-plus', 'Extend', `window.extendDeadline('${esc(p.id)}')`, '')
    : '';

  const pinBtn = isAdmin
    ? _btn(
        p.isPinned ? 'pin-off' : 'pin',
        p.isPinned ? 'Unpin' : 'Pin',
        `window.togglePinPoll('${esc(p.id)}',${!!p.isPinned})`,
        p.isPinned ? 'amber' : '',
      )
    : '';

  const closeBtn = isAdmin && p.status === 'active'
    ? _btn('square', 'Close', `window.closePoll('${esc(p.id)}')`, 'red')
    : '';

  const analyticsBtn = hasVotes || p.status === 'closed'
    ? _btn('bar-chart-2', 'Analytics', `window.viewPollAnalytics('${esc(p.id)}')`, 'blue')
    : '';

  const deleteBtn = isAdmin
    ? _btn('trash-2', 'Delete', `window.deletePoll('${esc(p.id)}',${hasVotes})`, 'red')
    : '';

  const optPreview = Object.values(p.options ?? {})
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(o => `<span style="font-size:.75rem;color:#6b7280;">· ${esc(o.optionText)}</span>`)
    .join(' ');

  return `
    <div style="background:#fff;border-radius:12px;padding:1.25rem;
      box-shadow:0 1px 4px rgba(0,0,0,.07);border-left:3px solid ${statusColor};">

      <div style="margin-bottom:.75rem;">
        <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.25rem;">
          <span style="font-weight:700;font-size:.95rem;">${esc(p.title)}</span>
          <span style="background:${statusColor}1a;color:${statusColor};padding:2px 8px;
            border-radius:999px;font-size:.68rem;font-weight:700;border:1px solid ${statusColor}55;">
            ${p.status.toUpperCase()}
          </span>
          ${p.isPinned ? `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;
            border-radius:999px;font-size:.68rem;font-weight:700;">📌 Pinned</span>` : ''}
          ${p.category ? (() => { const c = _CAT_COLORS[p.category] ?? _CAT_COLORS.general;
            return `<span style="background:${c.bg};color:${c.color};border:1px solid ${c.border};padding:2px
            8px;border-radius:999px;font-size:.68rem;font-weight:600;">${p.category.charAt(0).toUpperCase()+p.category.slice(1)}</span>`; })() : ''}
          ${p.priority && p.priority !== 'normal' ? `<span style="background:#fef2f2;color:#b91c1c;
            padding:2px 8px;border-radius:999px;font-size:.68rem;font-weight:700;">
            ${esc(p.priority).toUpperCase()}</span>` : ''}
        </div>
        <p style="font-size:.75rem;color:#9ca3af;margin:0 0 .3rem;">
          Deadline: ${deadline} · ${total.toLocaleString()} vote${total !== 1 ? 's' : ''}
        </p>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;">${optPreview}</div>
      </div>

      <div style="display:flex;gap:.4rem;flex-wrap:wrap;">
        ${editBtn}${publishBtn}${extendBtn}${pinBtn}${closeBtn}${analyticsBtn}${deleteBtn}
      </div>

      <div id="analytics_${esc(p.id)}" style="display:none;margin-top:1rem;"></div>
    </div>`;
}

/*
   Tiny button builder — keeps _buildPollRow readable.
   color: '' = neutral gray, 'green' | 'red' | 'blue' | 'amber'
*/
function _btn(icon, label, onclick, color) {
  const styles = {
    '':      'background:#f3f4f6;color:#374151;border:1.5px solid #e5e7eb;',
    green:   'background:#1a3a1a;color:#fff;border:none;',
    red:     'background:#fff;color:#dc2626;border:1.5px solid #fca5a5;',
    blue:    'background:#eff6ff;color:#1d4ed8;border:1.5px solid #bfdbfe;',
    amber:   'background:#fef3c7;color:#92400e;border:1.5px solid #fde68a;',
  };
  return `
    <button onclick="${onclick}"
      style="display:inline-flex;align-items:center;gap:.35rem;padding:.4rem .85rem;
        border-radius:8px;${styles[color] ?? styles['']}
        font-size:.8rem;font-weight:600;cursor:pointer;">
      <i data-lucide="${icon}" style="width:12px;height:12px;"></i> ${label}
    </button>`;
}


// ================================================
// POLL FORM — Create / Edit
// ================================================

window.openPollForm = function (prefill = null) {
  _editId = prefill?.id ?? null;
  const wrap = document.getElementById('pollFormWrap');
  if (!wrap) return;
  const isAdmin  = _role === 'admin';
  const hasVotes = (prefill?.totalVotes ?? 0) > 0;

  /* Build existing options list for edit pre-fill */
  const existingOpts = prefill
    ? Object.entries(prefill.options ?? {})
        .sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0))
        .map(([, o]) => o.optionText)
    : ['', ''];

  const optsHtml = existingOpts.map((t, i) => _buildOptionField(i, t, hasVotes)).join('');

  const fmtDate = ts => {
    if (!ts) return '';
    const d = ts.toDate?.() ?? new Date(ts);
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d - offset).toISOString().slice(0, 16);
  };

  const cats = ['general','health','infrastructure','safety','events','livelihood','youth','environment'];
  const catOpts = cats.map(c =>
    `<option value="${c}" ${(prefill?.category ?? 'general') === c ? 'selected' : ''}>
      ${c.charAt(0).toUpperCase() + c.slice(1)}</option>`
  ).join('');

  const priOpts = ['normal','high','urgent'].map(v =>
    `<option value="${v}" ${(prefill?.priority ?? 'normal') === v ? 'selected' : ''}>
      ${v.charAt(0).toUpperCase() + v.slice(1)}</option>`
  ).join('');

  const disabled = hasVotes ? 'disabled style="background:#f9fafb;color:#9ca3af;"' : '';

  wrap.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:1.5rem;
      box-shadow:0 1px 6px rgba(0,0,0,.1);border:1.5px solid #e5e7eb;">

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
        <h2 style="font-size:1rem;font-weight:700;margin:0;">${_editId ? 'Edit Poll' : 'Create Poll'}</h2>
        <button onclick="window.closePollForm()"
          style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:1.1rem;padding:4px;">
          ✕
        </button>
      </div>

      ${hasVotes ? `
        <div style="display:flex;align-items:center;gap:.5rem;background:#fef9c3;
          border:1px solid #fde68a;border-radius:8px;padding:.6rem .85rem;
          font-size:.78rem;color:#92400e;margin-bottom:1rem;">
          <i data-lucide="alert-triangle" style="width:14px;height:14px;flex-shrink:0;"></i>
          Editing is disabled for the question and options because this poll already has
          active participants to ensure data integrity.
        </div>` : ''}

      <div style="display:flex;flex-direction:column;gap:1rem;">

        <div>
          <label style="display:block;font-size:.78rem;font-weight:600;color:#374151;margin-bottom:.3rem;">
            Question / Title *
          </label>
          <input id="pf_title" type="text" value="${esc(prefill?.title ?? '')}" ${disabled}
            placeholder="e.g. What new facility would you like most?"
            style="width:100%;padding:.55rem .8rem;border:1.5px solid #e5e7eb;
              border-radius:8px;font-size:.875rem;outline:none;box-sizing:border-box;" />
        </div>

        <div>
          <label style="display:block;font-size:.78rem;font-weight:600;color:#374151;margin-bottom:.3rem;">
            Description <span style="font-weight:400;color:#9ca3af;">(optional)</span>
          </label>
          <textarea id="pf_desc" rows="2"
            placeholder="Additional context for residents…"
            style="width:100%;padding:.55rem .8rem;border:1.5px solid #e5e7eb;
              border-radius:8px;font-size:.875rem;outline:none;resize:vertical;
              box-sizing:border-box;">${esc(prefill?.description ?? '')}</textarea>
        </div>

        <div style="display:grid;grid-template-columns:1fr ${isAdmin ? '1fr' : ''};gap:1rem;">
          <div>
            <label style="display:block;font-size:.78rem;font-weight:600;color:#374151;margin-bottom:.3rem;">
              Category
            </label>
            <select id="pf_category"
              style="width:100%;padding:.55rem .8rem;border:1.5px solid #e5e7eb;
                border-radius:8px;font-size:.875rem;outline:none;background:#fff;">
              ${catOpts}
            </select>
          </div>
          ${isAdmin ? `
          <div>
            <label style="display:block;font-size:.78rem;font-weight:600;color:#374151;margin-bottom:.3rem;">
              Priority
            </label>
            <select id="pf_priority"
              style="width:100%;padding:.55rem .8rem;border:1.5px solid #e5e7eb;
                border-radius:8px;font-size:.875rem;outline:none;background:#fff;">
              ${priOpts}
            </select>
          </div>` : ''}
        </div>

        <div>
          <label style="display:block;font-size:.78rem;font-weight:600;color:#374151;margin-bottom:.3rem;">
            Options * <span style="font-weight:400;color:#9ca3af;">(minimum 2)</span>
          </label>
          <div id="pf_options" style="display:flex;flex-direction:column;gap:.4rem;">
            ${optsHtml}
          </div>
          ${!hasVotes ? `
          <button onclick="window._addPollOption()"
            style="margin-top:.5rem;display:inline-flex;align-items:center;gap:.35rem;
              padding:.35rem .75rem;border-radius:8px;background:#f3f4f6;color:#374151;
              border:1.5px solid #e5e7eb;font-size:.8rem;font-weight:600;cursor:pointer;">
            <i data-lucide="plus" style="width:12px;height:12px;"></i> Add Option
          </button>` : ''}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div>
            <label style="display:block;font-size:.78rem;font-weight:600;color:#374151;margin-bottom:.3rem;">
              Start Date
            </label>
            <input id="pf_start" type="datetime-local" value="${fmtDate(prefill?.startDate)}"
            ${hasVotes ? 'disabled' : ''}
            style="width:100%;padding:.55rem .8rem;border:1.5px solid #e5e7eb;
                border-radius:8px;font-size:.875rem;outline:none;box-sizing:border-box;
                ${hasVotes ? 'background:#f9fafb;color:#9ca3af;' : ''}" />
          </div>
          <div>
            <label style="display:block;font-size:.78rem;font-weight:600;color:#374151;margin-bottom:.3rem;">
              End Date *
            </label>
             <input id="pf_end" type="datetime-local" value="${fmtDate(prefill?.endDate)}"
            ${hasVotes ? 'disabled' : ''}
            style="width:100%;padding:.55rem .8rem;border:1.5px solid #e5e7eb;
                border-radius:8px;font-size:.875rem;outline:none;box-sizing:border-box;
                ${hasVotes ? 'background:#f9fafb;color:#9ca3af;' : ''}" />
          </div>
        </div>

        <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;
          font-size:.82rem;font-weight:600;color:#374151;">
          <input id="pf_live" type="checkbox" ${prefill?.allowLiveResults ? 'checked' : ''}
            style="width:15px;height:15px;" />
          Show live results to residents before they vote
        </label>

        <div style="display:flex;gap:.5rem;justify-content:flex-end;
          padding-top:.75rem;border-top:1.5px solid #f0f0f0;flex-wrap:wrap;">
          <button onclick="window.closePollForm()"
            style="padding:.5rem 1rem;border-radius:8px;background:#f3f4f6;
              color:#374151;border:1.5px solid #e5e7eb;font-size:.85rem;font-weight:600;cursor:pointer;">
            Cancel
          </button>
          <button onclick="window.savePoll('draft')"
            style="padding:.5rem 1rem;border-radius:8px;background:#f3f4f6;
              color:#374151;border:1.5px solid #e5e7eb;font-size:.85rem;font-weight:600;cursor:pointer;">
            Save as Draft
          </button>
          <button onclick="window.savePoll('active')"
            style="padding:.5rem 1rem;border-radius:8px;background:#1a3a1a;
              color:#fff;border:none;font-size:.85rem;font-weight:600;cursor:pointer;">
            ${_editId ? 'Save Changes' : 'Create & Publish'}
          </button>
        </div>

      </div>
    </div>`;

  lucide.createIcons({ el: wrap });
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.closePollForm = function () {
  _editId = null;
  const wrap = document.getElementById('pollFormWrap');
  if (wrap) wrap.innerHTML = '';
};

function _buildOptionField(idx, value = '', disabled = false) {
  const dis = disabled ? 'disabled style="background:#f9fafb;color:#9ca3af;"' : '';
  return `
    <div class="pf_opt_row" style="display:flex;align-items:center;gap:.4rem;">
      <input type="text" class="pf_opt_input" value="${esc(value)}"
        placeholder="Option ${idx + 1}" ${dis}
        style="flex:1;padding:.5rem .75rem;border:1.5px solid #e5e7eb;
          border-radius:8px;font-size:.875rem;outline:none;" />
      ${!disabled ? `
      <button onclick="this.closest('.pf_opt_row').remove()"
        style="width:28px;height:28px;border-radius:50%;background:#fff;color:#dc2626;
          border:1.5px solid #fca5a5;cursor:pointer;display:flex;align-items:center;
          justify-content:center;flex-shrink:0;font-size:.9rem;line-height:1;">✕</button>` : ''}
    </div>`;
}

window._addPollOption = function () {
  const container = document.getElementById('pf_options');
  if (!container) return;
  const count = container.querySelectorAll('.pf_opt_row').length;
  container.insertAdjacentHTML('beforeend', _buildOptionField(count));
};


// ================================================
// FORM — Collect, Validate, Save
// ================================================

window.savePoll = async function (status) {
  const title = document.getElementById('pf_title')?.value.trim();
  if (!title) { showToast('Title is required.', 'error'); return; }

  const optInputs = [...document.querySelectorAll('#pf_options .pf_opt_input')]
    .map(i => i.value.trim()).filter(Boolean);
  if (optInputs.length < 2) { showToast('At least 2 options are required.', 'error'); return; }

  const existingPoll = _editId ? _polls.find(p => p.id === _editId) : null;
  const editingWithVotes = !!(_editId && (existingPoll?.totalVotes ?? 0) > 0);
  const startRaw  = document.getElementById('pf_start')?.value;
  const startDate = startRaw ? new Date(startRaw + ':00') : null;
  const endRaw    = document.getElementById('pf_end')?.value;
  const endDate   = endRaw   ? new Date(endRaw   + ':00') : null;
  if (!editingWithVotes) {
    if (!endDate) { showToast('End date is required.', 'error'); return; }
    if (isNaN(endDate)) { showToast('Invalid end date.', 'error'); return; }
    if (startDate && !isNaN(startDate) && endDate <= startDate) { showToast('End date must be after the start date.', 'error'); return; }
  }

  /* Preserve existing optionIds when editing to keep vote counts intact */
  const existingOpts = existingPoll
    ? Object.entries(existingPoll.options ?? {})
        .sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0))
    : [];

  const options = {};
  optInputs.forEach((text, i) => {
    const optId  = existingOpts[i]?.[0] ?? `o_${Math.random().toString(36).slice(2, 7)}`;
    options[optId] = {
      optionText: text,
      voteCount:  existingOpts[i]?.[1]?.voteCount ?? 0,
      order:      i,
    };
  });

  const payload = {
    description:      document.getElementById('pf_desc')?.value.trim() || null,
    category:         document.getElementById('pf_category')?.value || 'general',
    priority:         document.getElementById('pf_priority')?.value || 'normal',
    allowLiveResults: document.getElementById('pf_live')?.checked ?? false,
    startDate: (!editingWithVotes && startDate) ? startDate : (existingPoll?.startDate ?? null),
    endDate:   !editingWithVotes ? endDate : (existingPoll?.endDate ?? null),
    status,
    updatedAt:        serverTimestamp(),
  };

  if (_editId) {
    /*
       Integrity guard: if votes exist, title and options are disabled
       in the form and we must not overwrite them.
    */
    if (!(existingPoll?.totalVotes > 0)) {
      payload.title   = title;
      payload.options = options;
    }
  } else {
    payload.title        = title;
    payload.options      = options;
    payload.createdBy    = _uid;
    payload.createdByRole = _role;
    payload.isPinned     = false;
    payload.isDeleted    = false;
    payload.totalVotes   = 0;
    payload.createdAt    = serverTimestamp();
  }

  try {
    if (_editId) {
      await updateDoc(pollDoc(_bid, _editId), payload);
      await _logAction(_editId, 'edit', null);
      showToast('Poll updated.', 'success');
    } else {
      const ref = await addDoc(pollsCol(_bid), payload);
      await _logAction(ref.id, status === 'active' ? 'publish' : 'create_draft', null);
      showToast(status === 'active' ? 'Poll published.' : 'Draft saved.', 'success');
      if (status === 'active') {
        notifyAllInBarangay(_bid, { type: 'poll_created', actorId: _uid, postId: ref.id, postTitle: payload.title, description: payload.description ?? null });
      }
    }
    window.closePollForm();
  } catch (err) {
    showToast('Failed to save poll.', 'error');
    console.error('[polls-admin] save error', err);
  }
};


// ================================================
// ACTIONS — Edit / Publish
// ================================================

window.editPoll = function (pollId) {
  const poll = _polls.find(p => p.id === pollId);
  if (!poll) return;
  window.openPollForm(poll);
};

window.publishPoll = async function (pollId) {
  if (!confirm('Publish this poll? It will become visible to all residents.')) return;
  try {
    await updateDoc(pollDoc(_bid, pollId), { status: 'active', updatedAt: serverTimestamp() });
    await _logAction(pollId, 'publish', null);
    showToast('Poll published.', 'success');
    notifyAllInBarangay(_bid, { type: 'poll_created', actorId: _uid, postId: pollId,
    postTitle: _polls.find(p=>p.id===pollId)?.title ?? 'New Poll',
    description: _polls.find(p=>p.id===pollId)?.description ?? null });
  } catch { showToast('Failed to publish.', 'error'); }
};


// ================================================
// ACTIONS — Extend Deadline
// ================================================

/*
   Reason is required and logged to poll_actions.
   Uses a dynamically-created overlay to avoid modal dependencies.
*/
window.extendDeadline = function (pollId) {
  document.getElementById('_extendOverlay')?.remove();

  const div = document.createElement('div');
  div.id    = '_extendOverlay';
  div.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.45);
    z-index:1900;display:flex;align-items:center;justify-content:center;`;

  div.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:1.5rem;
      width:min(460px,92vw);box-shadow:0 20px 60px rgba(0,0,0,.2);"
      onclick="event.stopPropagation()">
      <h3 style="font-size:1rem;font-weight:700;margin:0 0 .4rem;">Extend Deadline</h3>
      <p style="font-size:.85rem;color:#6b7280;margin:0 0 1rem;">
        Please provide a reason for this extension.
        This will be displayed on the poll for transparency.
      </p>
      <label style="display:block;font-size:.78rem;font-weight:600;
        color:#374151;margin-bottom:.3rem;">New End Date *</label>
      <input id="_extDate" type="datetime-local"
        value="${(() => { const p = _polls.find(p => p.id === pollId); const d = p?.endDate?.toDate?.(); return d ? d.toISOString().slice(0,16) : ''; })()}"
        style="width:100%;padding:.55rem .8rem;border:1.5px solid #e5e7eb;
          border-radius:8px;font-size:.875rem;outline:none;
          box-sizing:border-box;margin-bottom:.75rem;" />
      <label style="display:block;font-size:.78rem;font-weight:600;
        color:#374151;margin-bottom:.3rem;">Reason *</label>
      <textarea id="_extReason" rows="3"
        placeholder="e.g. Low participation — extended one more week to allow more residents to respond."
        style="width:100%;padding:.55rem .8rem;border:1.5px solid #e5e7eb;
          border-radius:8px;font-size:.875rem;outline:none;resize:vertical;
          box-sizing:border-box;margin-bottom:1rem;"></textarea>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;">
        <button onclick="document.getElementById('_extendOverlay').remove()"
          style="padding:.5rem 1rem;border-radius:8px;background:#f3f4f6;
            color:#374151;border:1.5px solid #e5e7eb;font-size:.85rem;font-weight:600;cursor:pointer;">
          Cancel
        </button>
        <button onclick="window._submitExtend('${esc(pollId)}')"
          style="padding:.5rem 1rem;border-radius:8px;background:#1a3a1a;
            color:#fff;border:none;font-size:.85rem;font-weight:600;cursor:pointer;">
          Confirm Extension
        </button>
      </div>
    </div>`;

  div.addEventListener('click', () => div.remove());
  document.body.appendChild(div);
};

window._submitExtend = async function (pollId) {
  const rawDate = document.getElementById('_extDate')?.value ?? '';
  const newDate = rawDate ? new Date(rawDate + ':00') : new Date('');
  const reason  = document.getElementById('_extReason')?.value.trim();

  if (isNaN(newDate)) { showToast('Please enter a valid date.', 'error'); return; }
  const poll = _polls.find(p => p.id === pollId);
  const startDate = poll?.startDate?.toDate?.();
  if (startDate && newDate <= startDate) { showToast('New end date must be after the poll\'s start date.', 'error'); return; }
  const origEnd = poll?.endDate?.toDate?.();
  if (origEnd && newDate <= origEnd) { showToast('New end date must be after the original deadline.', 'error'); return; }
  if (!reason)         { showToast('A reason is required.', 'error'); return; }

  try {
    await updateDoc(pollDoc(_bid, pollId), { endDate: newDate, extensionReason: reason, deadlineExtendedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await _logAction(pollId, 'extend_deadline', reason);
    document.getElementById('_extendOverlay')?.remove();
    showToast('Deadline extended and logged.', 'success');
  } catch { showToast('Failed to extend deadline.', 'error'); }
};


// ================================================
// ACTIONS — Close / Delete / Pin (Admin only)
// ================================================

window.closePoll = async function (pollId) {
  if (!confirm('Close this poll early? Residents will no longer be able to vote.')) return;
  try {
    await updateDoc(pollDoc(_bid, pollId), { status: 'closed', updatedAt: serverTimestamp() });
    await _logAction(pollId, 'close_early', null);
    showToast('Poll closed.', 'success');
    notifyAllInBarangay(_bid, { type: 'poll_closed', actorId: _uid,
        postId: pollId, postTitle: _polls.find(p=>p.id===pollId)?.title ?? 'Poll',
        description: _polls.find(p=>p.id===pollId)?.description ?? null });
  } catch { showToast('Failed to close poll.', 'error'); }
};

/*
   Polls with votes are soft-deleted (isDeleted: true) to preserve
   the audit trail. Zero-vote polls are hard-deleted.
*/
window.deletePoll = async function (pollId) {
  if (!confirm('Archive this poll instead of deleting it permanently?')) return;

  try {
    await updateDoc(pollDoc(_bid, pollId), {
      isDeleted: true,
      updatedAt: serverTimestamp(),
    });

    await _logAction(pollId, 'soft_delete', null);
    showToast('Poll archived.', 'success');
  } catch {
    showToast('Failed to archive poll.', 'error');
  }
};

window.togglePinPoll = async function (pollId, currentlyPinned) {
  try {
    await updateDoc(pollDoc(_bid, pollId), { isPinned: !currentlyPinned, updatedAt: serverTimestamp() });
    await _logAction(pollId, currentlyPinned ? 'unpin' : 'pin', null);
    showToast(currentlyPinned ? 'Poll unpinned.' : 'Poll pinned.', 'success');
  } catch { showToast('Failed to update pin.', 'error'); }
};


// ================================================
// ANALYTICS
// ================================================

/*
   Toggles an inline analytics breakdown under the poll row.
   Shows only aggregated counts — no user identity is exposed.
*/
window.viewPollAnalytics = function (pollId) {
  const el = document.getElementById(`analytics_${pollId}`);
  if (!el) return;

  if (el.style.display !== 'none') { el.style.display = 'none'; return; }

  const poll  = _polls.find(p => p.id === pollId);
  if (!poll)  return;

  const total   = poll.totalVotes ?? 0;
  const options = Object.entries(poll.options ?? {})
    .sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0));

  const bars = options.map(([, opt]) => {
    const count = opt.voteCount ?? 0;
    const pct   = total > 0 ? Math.round(count / total * 100) : 0;
    return `
      <div style="margin-bottom:.65rem;">
        <div style="display:flex;justify-content:space-between;
          font-size:.8rem;font-weight:600;color:#374151;margin-bottom:.25rem;">
          <span>${esc(opt.optionText)}</span>
          <span>${count.toLocaleString()} (${pct}%)</span>
        </div>
        <div style="height:8px;background:#f3f4f6;border-radius:999px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:#1a3a1a;border-radius:999px;
            transition:width .5s ease;"></div>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div style="background:#f9fafb;border-radius:8px;padding:1rem;border:1px solid #e5e7eb;">
      <p style="font-size:.72rem;font-weight:700;text-transform:uppercase;
        color:#9ca3af;letter-spacing:.06em;margin:0 0 .75rem;">
        Analytics · ${total.toLocaleString()} total vote${total !== 1 ? 's' : ''}
      </p>
      ${bars || '<p style="font-size:.82rem;color:#aaa;margin:0;">No votes yet.</p>'}
    </div>`;
  el.style.display = 'block';
};


// ================================================
// POLL ACTION LOGGER
// ================================================

async function _logAction(pollId, actionType, reason) {
  try {
    await addDoc(pollActionsCol(_bid, pollId), {
      actionType,
      performedBy: _uid,
      role:        _role,
      reason:      reason ?? null,
      timestamp:   serverTimestamp(),
    });
  } catch { /* non-fatal */ }
}


// ================================================
// UTILITIES
// ================================================

function showToast(msg, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.innerHTML = `<i data-lucide="${type === 'success' ? 'check' : 'x-circle'}"></i>${esc(msg)}`;
  container.appendChild(t);
  lucide.createIcons({ el: t });
  setTimeout(() => t.remove(), 3500);
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}