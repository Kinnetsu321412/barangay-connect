// js/bulletin-admin.js
// =====================================================
// Announcements Admin Tab — Self-contained module.
// Mirrors curfew-admin.js architecture exactly.
//
// Firestore path:
//   barangays/{barangayId}/announcements/{id}
//
// Fields:
//   title, body, category, imageURL (opt), isPinned,
//   isUrgent, authorId, authorName, status, likeCount,
//   commentCount, createdAt, updatedAt, expiresAt (opt)
// =====================================================

import { auth, db } from './firebase-config.js';
import { userIndexDoc, userDoc, barangayId as toBid, announcementPhotoPath } from './db-paths.js';
import { uploadImage } from './storage.js';
import {
  collection, onSnapshot, addDoc, where, updateDoc, deleteDoc,
  doc, serverTimestamp, orderBy, query, getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";


// ── State ──────────────────────────────────────────────────────────
let _announcements = [];
let _editId        = null;
let _formVisible   = false;
let _barangay      = null;
let _col           = null;

// ── Bootstrap ──────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const snap = await getDoc(userIndexDoc(user.uid));
  if (!snap.exists()) return;

  const { barangay, role } = snap.data();
  if (role !== 'admin' && role !== 'officer') return;

  _barangay = barangay;
  _col = collection(db, 'barangays', toBid(_barangay), 'announcements');

  onSnapshot(
    query(_col, orderBy('isPinned', 'desc'), orderBy('createdAt', 'desc')),
    (snapshot) => {
      _announcements = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      renderList(snapshot.docs);
      if (!_editId && !_formVisible) renderForm(null);
    },
  );

  // Official announcements
  const qOfficial = query(
    collection(db, 'barangays', toBid(_barangay), 'announcements'),
    where('status', '==', 'published'),
    orderBy('createdAt', 'desc')
  );
  onSnapshot(qOfficial, snap => {
    renderPostList(snap.docs.map(d => ({ id: d.id, _col: 'announcements', ...d.data() })), 'officialPostsList');
  });

  // Community posts
  const qCommunity = query(
    collection(db, 'barangays', toBid(_barangay), 'communityPosts'),
    where('status', '==', 'published'),
    orderBy('createdAt', 'desc')
  );
  onSnapshot(qCommunity, snap => {
    renderPostList(snap.docs.map(d => ({ id: d.id, _col: 'communityPosts', ...d.data() })), 'communityPostsList');
  });

  renderForm(null);
});


// ── Category metadata ──────────────────────────────────────────────
const CATEGORIES = {
  general:        { label: 'General',        bg: '#f3f4f6', color: '#374151', border: '#d1d5db' },
  announcements:  { label: 'Announcement',   bg: '#eff6ff', color: '#1e3a5f', border: '#bfdbfe' },
  health:         { label: 'Health',         bg: '#f0fdf4', color: '#14532d', border: '#bbf7d0' },
  infrastructure: { label: 'Infrastructure', bg: '#fff8ed', color: '#92400e', border: '#fed7aa' },
  safety:         { label: 'Safety',         bg: '#fff0f0', color: '#7f1d1d', border: '#fecaca' },
  events:         { label: 'Events',         bg: '#f3f4f6', color: '#374151', border: '#d1d5db' },
};

function categoryChip(category) {
  const c = CATEGORIES[category] ?? CATEGORIES.general;
  return `<span style="background:${c.bg};color:${c.color};border:1px solid ${c.border};
    padding:2px 8px;border-radius:999px;font-size:.68rem;font-weight:700;">
    ${esc(c.label)}
  </span>`;
}

function statusChip(status) {
  return status === 'published'
    ? `<span style="background:#dcfce7;color:#15803d;padding:2px 9px;border-radius:999px;font-size:.72rem;font-weight:700;">Published</span>`
    : `<span style="background:#f3f4f6;color:#9ca3af;padding:2px 9px;border-radius:999px;font-size:.72rem;font-weight:700;">Draft</span>`;
}


// ── Render list ────────────────────────────────────────────────────
function renderList(docs) {
  const el = document.getElementById('announcementList');
  if (!el) return;

  const badge          = document.getElementById('announcementBadgeCount');
  const publishedCount = _announcements.filter(a => a.status === 'published').length;
  if (badge) {
    badge.textContent   = publishedCount;
    badge.style.display = publishedCount > 0 ? 'inline' : 'none';
  }

  if (!docs.length) {
    el.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:2.5rem;text-align:center;
        color:#aaa;box-shadow:0 1px 4px rgba(0,0,0,.07);">
        <div style="font-size:2rem;margin-bottom:.5rem;">📋</div>
        <p style="margin:0;font-size:.9rem;">No posts yet.<br>
          Use the button below to add one.</p>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div style="background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.07);overflow:hidden;">
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;
        padding:.55rem 1.25rem;border-bottom:1.5px solid #f0f0f0;
        font-size:.7rem;font-weight:700;text-transform:uppercase;
        letter-spacing:.07em;color:#bbb;background:#fafafa;">
        <span>Title &amp; Category</span>
        <span>Status &amp; Flags</span>
        <span>Posted</span>
        <span></span>
      </div>
      ${_announcements.map(a => buildListRow(a)).join('')}
    </div>`;

  lucide.createIcons({ el });
}

function buildListRow(a) {
  const isEditing = _editId === a.id;
  const createdAt = a.createdAt?.toDate?.()
    ?.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) ?? '—';

  const expiresAt = a.expiresAt?.toDate?.()
    ?.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) ?? null;

  const editIcon   = isEditing ? 'x'      : 'pencil';
  const editLabel  = isEditing ? 'Cancel' : 'Edit';
  const editBg     = isEditing ? '#fff5f5'  : '#fff';
  const editBorder = isEditing ? '#dc2626'  : '#e0e0e0';
  const editColor  = isEditing ? '#dc2626'  : '#555';
  const editHover  = isEditing ? '#fee2e2'  : '#f4f6f9';

  const pinnedBadge = a.isPinned ? `
    <span style="display:inline-flex;align-items:center;gap:3px;background:#fff8ed;
      color:#c2410c;padding:2px 8px;border-radius:999px;font-size:.68rem;font-weight:700;
      border:1px solid #fed7aa;">
      <i data-lucide="pin" style="width:10px;height:10px;"></i> Pinned
    </span>` : '';

  const urgentBadge = a.isUrgent ? `
    <span style="display:inline-flex;align-items:center;gap:3px;background:#fff0f0;
      color:#dc2626;padding:2px 8px;border-radius:999px;font-size:.68rem;font-weight:700;
      border:1px solid #fecaca;">
      <i data-lucide="alert-circle" style="width:10px;height:10px;"></i> Urgent
    </span>` : '';

  const thumbSection = a.imageURL ? `
    <div style="margin-top:5px;">
      <img src="${esc(a.imageURL)}" alt=""
        style="width:44px;height:30px;object-fit:cover;border-radius:4px;
          border:1px solid #e5e7eb;display:block;" />
    </div>` : '';

  return `
    <div data-announcement-id="${a.id}"
      style="display:grid;grid-template-columns:2fr 1fr 1fr auto;
        align-items:center;gap:.75rem;padding:.9rem 1.25rem;
        border-bottom:1px solid #f0f0f0;transition:background .2s,border-left .2s;
        border-left:3px solid ${a.isUrgent ? '#dc2626' : a.isPinned ? '#FFA135' : 'transparent'};
        ${isEditing ? 'background:#f0fdf4;border-left:3px solid #1a3a1a!important;' : ''}">

      <div>
        <div style="font-weight:700;font-size:.9rem;display:flex;align-items:center;
          flex-wrap:wrap;gap:.35rem;margin-bottom:4px;">
          ${esc(a.title)}
          ${isEditing ? `<span style="background:#1a3a1a;color:#fff;padding:1px 7px;
            border-radius:999px;font-size:.65rem;font-weight:700;">Editing</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;">
          ${categoryChip(a.category)}
          ${a.authorName ? `<span style="font-size:.73rem;color:#aaa;">by ${esc(a.authorName)}</span>` : ''}
        </div>
        ${thumbSection}
      </div>

      <div style="display:flex;flex-direction:column;gap:.3rem;">
        ${statusChip(a.status)}
        <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:2px;">
          ${pinnedBadge}${urgentBadge}
        </div>
      </div>

      <div>
        <div style="font-size:.78rem;color:#555;">${createdAt}</div>
        ${expiresAt ? `<div style="font-size:.7rem;color:#f59e0b;margin-top:1px;
          display:flex;align-items:center;gap:3px;">
          <i data-lucide="clock" style="width:10px;height:10px;"></i> Expires ${expiresAt}
        </div>` : ''}
        <div style="display:flex;align-items:center;gap:.35rem;margin-top:3px;
          font-size:.72rem;color:#bbb;">
          <i data-lucide="heart" style="width:12px;height:12px;color:#ef4444;"></i>
          <span>${Object.values(a.reactions ?? {}).reduce((a,b) => a+b, 0) || (a.likeCount ?? 0)}</span>
          <span style="color:#e5e7eb;">·</span>
          <i data-lucide="message-circle" style="width:12px;height:12px;color:#9ca3af;"></i>
          <span>${a.commentCount ?? 0}</span>
        </div>
      </div>

      <div style="display:flex;gap:.35rem;align-items:center;flex-shrink:0;">

        <button onclick="announcementTogglePin('${a.id}',${!a.isPinned})"
          title="${a.isPinned ? 'Unpin' : 'Pin to top'}"
          style="display:inline-flex;align-items:center;gap:.3rem;padding:5px 10px;
            border-radius:7px;border:1.5px solid ${a.isPinned ? '#fed7aa' : '#e0e0e0'};
            background:${a.isPinned ? '#fff8ed' : '#fff'};
            cursor:pointer;color:${a.isPinned ? '#c2410c' : '#555'};
            font-size:.78rem;font-weight:500;transition:all .15s;white-space:nowrap;"
          onmouseover="this.style.background='${a.isPinned ? '#fef3c7' : '#f4f6f9'}'"
          onmouseout="this.style.background='${a.isPinned ? '#fff8ed' : '#fff'}'">
          <i data-lucide="${a.isPinned ? 'pin-off' : 'pin'}" style="width:13px;height:13px;"></i>
        </button>

        <button onclick="announcementToggleUrgent('${a.id}',${!a.isUrgent})"
          title="${a.isUrgent ? 'Remove urgent' : 'Mark urgent'}"
          style="display:inline-flex;align-items:center;gap:.3rem;padding:5px 10px;
            border-radius:7px;border:1.5px solid ${a.isUrgent ? '#fecaca' : '#e0e0e0'};
            background:${a.isUrgent ? '#fff0f0' : '#fff'};
            cursor:pointer;color:${a.isUrgent ? '#dc2626' : '#555'};
            font-size:.78rem;font-weight:500;transition:all .15s;white-space:nowrap;"
          onmouseover="this.style.background='${a.isUrgent ? '#fee2e2' : '#f4f6f9'}'"
          onmouseout="this.style.background='${a.isUrgent ? '#fff0f0' : '#fff'}'">
          <i data-lucide="alert-circle" style="width:13px;height:13px;"></i>
        </button>

        <button onclick="announcementEdit('${a.id}')"
          title="${isEditing ? 'Cancel editing' : 'Edit'}"
          style="display:inline-flex;align-items:center;gap:.3rem;padding:5px 10px;
            border-radius:7px;border:1.5px solid ${editBorder};background:${editBg};
            cursor:pointer;color:${editColor};font-size:.78rem;font-weight:500;transition:all .15s;"
          onmouseover="this.style.background='${editHover}'"
          onmouseout="this.style.background='${editBg}'">
          <i data-lucide="${editIcon}" style="width:13px;height:13px;"></i>${editLabel}
        </button>

        <button onclick="announcementDelete('${a.id}','${esc(a.title)}')"
          title="Delete permanently"
          style="display:inline-flex;align-items:center;gap:.3rem;padding:5px 10px;
            border-radius:7px;border:1.5px solid #fca5a5;background:#fff;
            cursor:pointer;color:#dc2626;font-size:.78rem;font-weight:500;transition:all .15s;"
          onmouseover="this.style.background='#fef2f2'"
          onmouseout="this.style.background='#fff'">
          <i data-lucide="trash-2" style="width:13px;height:13px;"></i>
        </button>

      </div>
    </div>`;
}


// ── Render form ────────────────────────────────────────────────────
function renderForm(prefill) {
  const el = document.getElementById('announcementForm');
  if (!el) return;

  if (!_formVisible && !_editId) {
    el.innerHTML = `
      <button onclick="announcementShowForm()"
        style="display:flex;align-items:center;justify-content:center;gap:.6rem;
          width:100%;padding:.85rem 1.5rem;border-radius:12px;
          border:2px dashed #d1d5db;background:white;
          color:#374151;font-size:.9rem;font-weight:600;cursor:pointer;
          transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.04);"
        onmouseover="this.style.borderColor='#1a3a1a';this.style.color='#1a3a1a';this.style.background='#f0fdf4'"
        onmouseout="this.style.borderColor='#d1d5db';this.style.color='#374151';this.style.background='white'">
        <i data-lucide="plus-circle" style="width:18px;height:18px;"></i>
        Add Post
      </button>`;
    lucide.createIcons({ el });
    return;
  }

  const d      = prefill || {};
  const isEdit = !!_editId;

  // Date string for the expiresAt date input (YYYY-MM-DD)
  const expiresAtValue = d.expiresAt
    ? d.expiresAt.toDate().toISOString().slice(0, 10)
    : '';

  // Existing image preview (edit mode)
  const existingImagePreview = d.imageURL ? `
  <div style="margin-bottom:.75rem;position:relative;display:inline-block;">
    <img src="${esc(d.imageURL)}" alt="Current image"
      style="width:100%;max-height:130px;object-fit:cover;border-radius:8px;
        border:1px solid #e0e0e0;display:block;" />
    <button type="button" onclick="this.closest('div').dataset.remove='1';
        this.closest('div').style.opacity='.35';this.style.display='none';
        document.getElementById('anRemoveImage').checked=true;"
      style="position:absolute;top:-8px;right:-8px;width:22px;height:22px;
        border-radius:50%;background:#dc2626;color:#fff;border:none;
        cursor:pointer;font-size:.8rem;font-weight:700;line-height:1;
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 1px 4px rgba(0,0,0,.2);">✕</button>
    <input type="checkbox" id="anRemoveImage" style="display:none;" />
  </div>` : '';

  el.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:1.5rem;
      box-shadow:0 1px 4px rgba(0,0,0,.07);">

      <div style="display:flex;align-items:center;justify-content:space-between;
        margin-bottom:1.25rem;flex-wrap:wrap;gap:.5rem;">
        <h2 style="font-size:1rem;font-weight:700;margin:0;
          display:flex;align-items:center;gap:.5rem;">
          <i data-lucide="${isEdit ? 'pencil' : 'plus-circle'}"
            style="width:17px;height:17px;color:#1a3a1a;"></i>
          ${isEdit ? 'Edit Post' : 'Add Post'}
        </h2>
        ${isEdit ? `<span style="background:#fef9c3;color:#854d0e;padding:3px 10px;
          border-radius:999px;font-size:.73rem;font-weight:700;border:1px solid #fde68a;">
          Editing: ${esc(d.title || '')}
        </span>` : ''}
      </div>

      <div style="display:grid;gap:1rem;">

        <div>
          <label style="${labelStyle}">Title</label>
          <input id="anTitle" type="text" required
            value="${esc(d.title || '')}"
            placeholder="e.g. Free Medical Mission this Saturday"
            style="${inputStyle}" />
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div>
            <label style="${labelStyle}">Category</label>
            <select id="anCategory" style="${inputStyle}">
              ${Object.entries(CATEGORIES).map(([val, { label }]) =>
                `<option value="${val}" ${d.category === val ? 'selected' : ''}>${label}</option>`,
              ).join('')}
            </select>
          </div>
          <div>
            <label style="${labelStyle}">Status</label>
            <select id="anStatus" style="${inputStyle}">
              <option value="published" ${(d.status ?? 'published') === 'published' ? 'selected' : ''}>Published</option>
              <option value="draft"     ${d.status === 'draft' ? 'selected' : ''}>Draft</option>
            </select>
          </div>
        </div>

        <div>
          <label style="${labelStyle}">Body</label>
          <textarea id="anBody" rows="4"
            placeholder="Write your announcement here..."
            style="${inputStyle} resize:vertical;">${esc(d.body || '')}</textarea>
        </div>

        <!-- Image upload -->
        <div>
          <label style="${labelStyle}">Images (optional · up to 4)</label>
          ${existingImagePreview}
          <label for="anImageFile"
            style="display:flex;align-items:center;gap:.6rem;padding:.6rem .75rem;
              border:1.5px dashed #d1d5db;border-radius:8px;cursor:pointer;
              font-size:.82rem;color:#6b7280;background:#fafafa;transition:all .2s;"
            onmouseover="this.style.borderColor='#1a3a1a';this.style.color='#1a3a1a'"
            onmouseout="this.style.borderColor='#d1d5db';this.style.color='#6b7280'">
            <i data-lucide="image" style="width:15px;height:15px;flex-shrink:0;"></i>
            Tap to add photos (up to 4)
          </label>
          <input type="file" id="anImageFile" accept="image/jpeg,image/png,image/webp"
            multiple style="display:none;"
            onchange="previewAnnouncementImages(this)" />
          <div id="anImagePreviews"
            style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.5rem;"></div>
          <p style="font-size:.7rem;color:#aaa;margin:3px 0 0;">JPG, PNG or WEBP · max 5 MB each</p>
        </div>
        <input type="hidden" id="anCurrentImageURL" value="${esc(d.imageURL || '')}" />

        <!-- Expires at -->
        <div>
          <label style="${labelStyle}">Expires At (optional)</label>
          <input type="date" id="anExpiresAt"
            value="${expiresAtValue}"
            style="${inputStyle}" />
          <p style="font-size:.7rem;color:#aaa;margin:3px 0 0;">
            Post will hide from residents after this date. Leave blank to never expire.
          </p>
        </div>

        <div style="display:flex;gap:1.5rem;flex-wrap:wrap;align-items:center;">
          <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;
            font-size:.82rem;font-weight:600;color:#555;">
            <input type="checkbox" id="anPinned" ${d.isPinned ? 'checked' : ''}
              style="width:15px;height:15px;accent-color:#1a3a1a;cursor:pointer;" />
            <i data-lucide="pin" style="width:14px;height:14px;color:#c2410c;"></i>
            Pin to top
          </label>
          <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;
            font-size:.82rem;font-weight:600;color:#555;">
            <input type="checkbox" id="anUrgent" ${d.isUrgent ? 'checked' : ''}
              style="width:15px;height:15px;accent-color:#dc2626;cursor:pointer;" />
            <i data-lucide="alert-circle" style="width:14px;height:14px;color:#dc2626;"></i>
            Mark as urgent
          </label>
        </div>

        <div style="display:flex;gap:.6rem;margin-top:.25rem;flex-wrap:wrap;align-items:center;">
          <button type="button" onclick="announcementSave()"
            style="display:inline-flex;align-items:center;gap:.45rem;
              padding:.6rem 1.4rem;border-radius:8px;background:#1a3a1a;
              color:#fff;border:none;font-size:.9rem;font-weight:600;cursor:pointer;
              transition:background .15s;"
            onmouseover="this.style.background='#14291a'"
            onmouseout="this.style.background='#1a3a1a'">
            <i data-lucide="send" style="width:15px;height:15px;"></i>
            ${isEdit ? 'Update Post' : 'Publish Post'}
          </button>
          <button type="button" onclick="announcementCancelEdit()"
            style="padding:.6rem 1.1rem;border-radius:8px;border:1.5px solid #e0e0e0;
              background:#fff;color:#555;font-size:.9rem;font-weight:500;cursor:pointer;
              transition:background .15s;"
            onmouseover="this.style.background='#f4f6f9'"
            onmouseout="this.style.background='#fff'">
            ${isEdit ? 'Cancel' : 'Discard'}
          </button>
        </div>

      </div>
    </div>`;

  lucide.createIcons({ el });
}


// ── Show add form ──────────────────────────────────────────────────
window.announcementShowForm = function () {
  _formVisible = true;
  _editId      = null;
  renderForm(null);
  document.getElementById('announcementForm')
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};


// ── Edit ───────────────────────────────────────────────────────────
window.announcementEdit = async function (id) {
  if (_editId === id) {
    _editId = null; _formVisible = false;
    renderForm(null);
    renderList(_announcements.map(a => ({ id: a.id, data: () => a })));
    return;
  }
  const snap = await getDoc(doc(_col, id));
  if (!snap.exists()) return;
  _editId = id; _formVisible = true;
  renderForm(snap.data());
  renderList(_announcements.map(a => ({ id: a.id, data: () => a })));
  document.getElementById('announcementForm')
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};


// ── Cancel ─────────────────────────────────────────────────────────
window.announcementCancelEdit = function () {
  _editId = null; _formVisible = false;
  renderForm(null);
  renderList(_announcements.map(a => ({ id: a.id, data: () => a })));
};


// ── Save ───────────────────────────────────────────────────────────
window.announcementSave = async function () {
  if (!_col) { showAnnouncementToast('Not ready yet.', 'error'); return; }

  const title    = document.getElementById('anTitle')?.value.trim();
  const body     = document.getElementById('anBody')?.value.trim();
  const category = document.getElementById('anCategory')?.value || 'general';
  const status   = document.getElementById('anStatus')?.value   || 'published';
  const isPinned = document.getElementById('anPinned')?.checked  ?? false;
  const isUrgent = document.getElementById('anUrgent')?.checked  ?? false;

  if (!title) { showAnnouncementToast('Please enter a title.', 'error'); return; }
  if (!body)  { showAnnouncementToast('Please enter body content.', 'error'); return; }

  const saveBtn = document.querySelector('#announcementForm button[onclick="announcementSave()"]');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  // ── Resolve author name ──────────────────────────────────────────
  const user = auth.currentUser;
  let authorName = 'Admin';
  if (user) {
    try {
      const uSnap = await getDoc(userDoc(_barangay, user.uid));
      authorName  = uSnap.data()?.fullName ?? user.displayName ?? 'Admin';
    } catch (_) { /* non-fatal */ }
  }

  // ── Handle image upload / removal ────────────────────────────────
  const currentImageURL = document.getElementById('anCurrentImageURL')?.value || null;
  const imageFileEl = document.getElementById('anImageFile');
  const imageFiles  = imageFileEl?.files ? Array.from(imageFileEl.files).slice(0, 4) : [];
  const removeImage = document.getElementById('anRemoveImage')?.checked ?? false;

  let imageURLs = [];

  if (removeImage) {
    imageURLs = [];
  } else if (imageFiles.length) {
    try {
      for (const file of imageFiles) {
        const path = announcementPhotoPath(_barangay, `${Date.now()}-${Math.random().toString(36).slice(2)}.webp`);
        const url  = await uploadImage(file, path);
        imageURLs.push(url);
      }
    } catch (uploadErr) {
      showAnnouncementToast(`Image upload failed: ${uploadErr.message}`, 'error');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = _editId ? 'Update Post' : 'Publish Post'; }
      return;
    }
  } else if (currentImageURL && !removeImage) {
    // Keep existing — wrap in array for consistency
    imageURLs = [currentImageURL];
  }

  // ── Handle expiresAt ─────────────────────────────────────────────
  const expiresAtVal = document.getElementById('anExpiresAt')?.value;
  const expiresAt    = expiresAtVal ? new Date(`${expiresAtVal}T23:59:59`) : null;

  // ── Build payload ─────────────────────────────────────────────────
  const payload = {
    title, body, category, status, isPinned, isUrgent,
    imageURLs,
    imageURL: imageURLs[0] ?? null,
    expiresAt,
    updatedAt: serverTimestamp(),
  };

  try {
    if (_editId) {
      await updateDoc(doc(_col, _editId), payload);
      showAnnouncementToast('Post updated.', 'success');
    } else {
      await addDoc(_col, {
        ...payload,
        authorId:     user?.uid ?? 'system',
        authorName,
        likeCount:    0,
        commentCount: 0,
        createdAt:    serverTimestamp(),
      });
      showAnnouncementToast('Post published.', 'success');
    }
    _editId = null; _formVisible = false;
    renderForm(null);
    renderList(_announcements.map(a => ({ id: a.id, data: () => a })));
  } catch (err) {
    console.error('[announcements] save error:', err.code, err.message);
    showAnnouncementToast(`Failed to save: ${err.message}`, 'error');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = _editId ? 'Update Post' : 'Publish Post';
    }
  }
};


// ── Delete ─────────────────────────────────────────────────────────
window.announcementDelete = async function (id, title) {
  if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
  try {
    await deleteDoc(doc(_col, id));
    showAnnouncementToast('Post deleted.', 'success');
    if (_editId === id) { _editId = null; _formVisible = false; renderForm(null); }
  } catch (err) {
    showAnnouncementToast('Could not delete. Try again.', 'error');
  }
};


// ── Toggle pin ─────────────────────────────────────────────────────
window.announcementTogglePin = async function (id, newState) {
  try {
    const idx = _announcements.findIndex(a => a.id === id);
    if (idx !== -1) _announcements[idx].isPinned = newState;
    await updateDoc(doc(_col, id), { isPinned: newState, updatedAt: serverTimestamp() });
    showAnnouncementToast(newState ? 'Pinned to top.' : 'Unpinned.', 'success');
  } catch (err) {
    showAnnouncementToast('Could not update pin status.', 'error');
  }
};


// ── Toggle urgent ──────────────────────────────────────────────────
window.announcementToggleUrgent = async function (id, newState) {
  try {
    const idx = _announcements.findIndex(a => a.id === id);
    if (idx !== -1) _announcements[idx].isUrgent = newState;
    await updateDoc(doc(_col, id), { isUrgent: newState, updatedAt: serverTimestamp() });
    showAnnouncementToast(newState ? 'Marked as urgent.' : 'Urgent flag removed.', 'success');
  } catch (err) {
    showAnnouncementToast('Could not update urgent flag.', 'error');
  }
};


// ── Style constants ────────────────────────────────────────────────
const labelStyle = `display:block;font-size:.73rem;font-weight:700;
  text-transform:uppercase;color:#888;margin-bottom:4px;letter-spacing:.04em;`;
const inputStyle = `width:100%;padding:.55rem .75rem;border:1.5px solid #e0e0e0;
  border-radius:8px;font-size:.875rem;outline:none;
  transition:border-color .15s;box-sizing:border-box;`;


// ── Toast ──────────────────────────────────────────────────────────
function showAnnouncementToast(msg, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.innerHTML = `<i data-lucide="${type === 'success' ? 'check' : 'x-circle'}"></i>${esc(msg)}`;
  container.appendChild(t);
  lucide.createIcons({ el: t });
  setTimeout(() => t.remove(), 3500);
}

window.previewAnnouncementImages = function(input) {
  const container = document.getElementById('anImagePreviews');
  if (!container) return;
  container.innerHTML = '';
  const files = Array.from(input.files).slice(0, 4);

  files.forEach((file, idx) => {
    const reader = new FileReader();
    reader.onload = e => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;width:80px;height:60px;flex-shrink:0;';

      const img = document.createElement('img');
      img.src = e.target.result;
      img.style.cssText = 'width:80px;height:60px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb;display:block;';

      const removeBtn = document.createElement('button');
      removeBtn.innerHTML = '×';
      removeBtn.type = 'button';
      removeBtn.style.cssText = `position:absolute;top:-5px;right:-5px;
        width:18px;height:18px;border-radius:50%;background:#dc2626;color:#fff;
        border:none;cursor:pointer;font-size:.75rem;line-height:1;
        display:flex;align-items:center;justify-content:center;`;
      removeBtn.onclick = function() {
        const dt = new DataTransfer();
        Array.from(input.files).forEach((f, i) => {
          if (i !== idx) dt.items.add(f);
        });
        input.files = dt.files;
        window.previewAnnouncementImages(input);
      };

      wrap.appendChild(img);
      wrap.appendChild(removeBtn);
      container.appendChild(wrap);
    };
    reader.readAsDataURL(file);
  });

  if (input.files.length > 4) {
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    input.files = dt.files;
  }
};

window.setBulletinAdminTab = function(tab) {
  ['pending','official','community'].forEach(t => {
    document.getElementById(`${t}PostsList`).style.display = t === tab ? 'block' : 'none';
    const btn = document.getElementById(`tab-${t}`);
    if (btn) {
      btn.style.background = t === tab ? '#1a3a1a' : '#fff';
      btn.style.color = t === tab ? '#fff' : '#374151';
      btn.style.border = t === tab ? 'none' : '1.5px solid #e5e7eb';
    }
  });
};

function renderPostList(posts, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!posts.length) {
    el.innerHTML = `<div style="padding:2rem;text-align:center;color:#aaa;font-size:.9rem;">No posts yet.</div>`;
    return;
  }
  el.innerHTML = posts.map(p => {
    const time = p.createdAt?.toDate?.()
      ?.toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' }) ?? '—';
    const reactions = Object.values(p.reactions ?? {}).reduce((a,b) => a+b, 0) || (p.likeCount ?? 0);
    const imgs = p.imageURLs?.length ? p.imageURLs : (p.imageURL ? [p.imageURL] : []);
    return `
      <div style="background:#fff;border-radius:12px;padding:1.25rem;
        box-shadow:0 1px 4px rgba(0,0,0,.07);border-left:3px solid #1a3a1a;margin-bottom:.75rem;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:.75rem;">
          <div style="flex:1;min-width:0;">
            <p style="font-weight:700;margin:0 0 .2rem;">${esc(p.title)}</p>
            <p style="font-size:.78rem;color:#6b7280;margin:0 0 .4rem;">
              by ${esc(p.authorName ?? '—')} · ${time}
            </p>
            <p style="font-size:.82rem;color:#374151;margin:0 0 .5rem;">
              ${esc((p.body ?? '').slice(0,150))}${(p.body?.length ?? 0) > 150 ? '…' : ''}
            </p>
            ${imgs.length ? `<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.4rem;">
            ${imgs.map((url, i) => `<img src="${esc(url)}"
              style="width:64px;height:48px;object-fit:cover;border-radius:6px;
                border:1px solid #e5e7eb;cursor:pointer;"
              onclick="window.openImageViewer?.(['${imgs.map(u => esc(u)).join("','")}'],${i},'${esc(p.title)}')" />`).join('')}
          </div>` : ''}
            <p style="font-size:.72rem;color:#9ca3af;margin:0;">
              ♡ ${reactions} &nbsp;·&nbsp; 💬 ${p.commentCount ?? 0}
            </p>
          </div>
          <button onclick="viewReportedPost('${esc(p.id)}')"
            style="flex-shrink:0;padding:.45rem .9rem;border-radius:8px;background:#f3f4f6;
              color:#374151;border:1.5px solid #e5e7eb;font-size:.8rem;font-weight:600;cursor:pointer;margin-right:.35rem;">
            View
          </button>
          <button onclick="adminDeletePost('${esc(p.id)}','${esc(p._col)}')"
            style="flex-shrink:0;padding:.45rem .9rem;border-radius:8px;background:#fff;
              color:#dc2626;border:1.5px solid #fca5a5;font-size:.8rem;font-weight:600;cursor:pointer;">
            Delete
          </button>
        </div>
      </div>`;
  }).join('');
  lucide.createIcons({ el });
}

window.adminDeletePost = async function(id, col) {
  if (!confirm('Delete this post permanently?')) return;
  const bid = toBid(_barangay);
  try {
    await deleteDoc(doc(db, 'barangays', bid, col, id));
  } catch (err) { console.error(err); }
};

// ── XSS helper ────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


