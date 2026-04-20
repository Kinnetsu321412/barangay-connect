// js/community-posts-admin.js
// =====================================================
// Admin approval queue for resident community posts.
// Firestore: barangays/{barangayId}/communityPosts
// =====================================================

import { auth, db } from './firebase-config.js';
import { userIndexDoc, barangayId as toBid } from './db-paths.js';
import {
  collection, onSnapshot, query, where,
  orderBy, doc, updateDoc, deleteDoc, serverTimestamp, getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

let _col = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const snap = await getDoc(userIndexDoc(user.uid));
  if (!snap.exists()) return;

  const { barangay, role } = snap.data();
  if (role !== 'admin' && role !== 'officer') return;

  const bid = toBid(barangay);
  _col = collection(db, 'barangays', bid, 'communityPosts');

  // Listen to pending posts only
  const q = query(_col, where('status', '==', 'pending'), orderBy('createdAt', 'desc'));

  onSnapshot(q, snap => {
    const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Update badge
    const badge = document.getElementById('pendingPostsBadge');
    if (badge) {
      badge.textContent   = posts.length;
      badge.style.display = posts.length > 0 ? 'inline' : 'none';
      const mainBadge = document.getElementById('reportsMainBadge');
      if (mainBadge) { mainBadge.textContent = posts.length; mainBadge.style.display = posts.length > 0 ? 'inline' : 'none'; }
    }

    renderPendingPosts(posts);
  });
});

function renderPendingPosts(posts) {
  const el = document.getElementById('pendingPostsList');
  if (!el) return;

  if (!posts.length) {
    el.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:3rem;text-align:center;
        color:#aaa;box-shadow:0 1px 4px rgba(0,0,0,.07);">
        <div style="font-size:2rem;margin-bottom:.5rem;">✅</div>
        <p style="margin:0;font-size:.9rem;">No posts awaiting approval.</p>
      </div>`;
    return;
  }

  el.innerHTML = posts.map(p => buildPendingRow(p)).join('');
  lucide.createIcons({ el });
}

function buildPendingRow(p) {
  const time = p.createdAt?.toDate?.()
    ?.toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' }) ?? '—';

const imgsJson = p.imageURLs?.length
  ? encodeURIComponent(JSON.stringify(p.imageURLs))
  : null;

const images = p.imageURLs?.length
  ? `<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin:.6rem 0;">
      ${p.imageURLs.map((url, i) => `
        <div style="cursor:zoom-in;border-radius:8px;overflow:hidden;flex-shrink:0;
          border:1px solid #e5e7eb;background:#f3f4f6;"
          onclick="window.openImageViewer(JSON.parse(decodeURIComponent('${imgsJson}')),${i},'${esc(p.title)}')">
          <img src="${esc(url)}"
            style="width:120px;height:88px;object-fit:contain;display:block;" />
        </div>`).join('')}
     </div>` : '';

  return `
    <div style="background:#fff;border-radius:12px;padding:1.25rem;
      box-shadow:0 1px 4px rgba(0,0,0,.07);border-left:3px solid #f59e0b;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;
        gap:1rem;flex-wrap:wrap;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;flex-wrap:wrap;">
            <span style="font-weight:700;font-size:.95rem;">${esc(p.title)}</span>
            <span style="background:#fef3c7;color:#92400e;padding:2px 8px;
              border-radius:999px;font-size:.68rem;font-weight:700;">Pending</span>${p.flagReason ? `<span style="background:#fef2f2;color:#dc2626;padding:2px 8px;
  border-radius:999px;font-size:.68rem;font-weight:700;border:1px solid #fca5a5;">
  ⚑ ${formatFlagReason(p.flagReason)}
</span>` : ''}
            ${p.category && p.category !== 'general' ? `
              <span style="background:#f3f4f6;color:#374151;padding:2px 8px;
                border-radius:999px;font-size:.68rem;font-weight:600;">${esc(p.category)}</span>` : ''}
          </div>
          <p style="font-size:.78rem;color:#6b7280;margin:0 0 .4rem;">
            by ${esc(p.authorName)} · ${time}
          </p>
          <p style="font-size:.85rem;color:#374151;margin:0;line-height:1.5;">
            ${esc(p.body?.slice(0, 200))}${(p.body?.length ?? 0) > 200 ? '…' : ''}
          </p>
          ${images}
        </div>
        <div style="display:flex;gap:.5rem;flex-shrink:0;">
        <button onclick="viewReportedPost('${esc(p.id)}')"
        style="display:inline-flex;align-items:center;gap:.35rem;padding:.5rem 1rem;
            border-radius:8px;background:#f3f4f6;color:#374151;border:1.5px solid #e5e7eb;
            font-size:.82rem;font-weight:600;cursor:pointer;">
        <i data-lucide="eye" style="width:13px;height:13px;"></i> View
        </button>
          <button onclick="approvePost('${esc(p.id)}')"
            style="display:inline-flex;align-items:center;gap:.35rem;padding:.5rem 1rem;
              border-radius:8px;background:#1a3a1a;color:#fff;border:none;
              font-size:.82rem;font-weight:600;cursor:pointer;">
            <i data-lucide="check" style="width:13px;height:13px;"></i> Approve
          </button>
          <button onclick="rejectPost('${esc(p.id)}','${esc(p.title)}')"
            style="display:inline-flex;align-items:center;gap:.35rem;padding:.5rem 1rem;
              border-radius:8px;background:#fff;color:#dc2626;border:1.5px solid #fca5a5;
              font-size:.82rem;font-weight:600;cursor:pointer;">
            <i data-lucide="x" style="width:13px;height:13px;"></i> Reject
          </button>
        </div>
      </div>
    </div>`;
}

window.approvePost = async function(id) {
  if (!confirm('Approve this post? It will be visible to all residents.')) return;
  if (!_col) return;
  try {
    await updateDoc(doc(_col, id), {
      status:    'published',
      updatedAt: serverTimestamp(),
    });
    showToast('Post approved and published.', 'success');
  } catch (err) {
    showToast('Failed to approve post.', 'error');
  }
};

window.rejectPost = async function(id, title) {
  if (!confirm(`Reject and delete "${title}"?`)) return;
  if (!_col) return;
  try {
    await deleteDoc(doc(_col, id));
    showToast('Post rejected and removed.', 'success');
  } catch (err) {
    showToast('Failed to reject post.', 'error');
  }
};

function showToast(msg, type) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.innerHTML = `<i data-lucide="${type === 'success' ? 'check' : 'x-circle'}"></i>${esc(msg)}`;
  container.appendChild(t);
  lucide.createIcons({ el: t });
  setTimeout(() => t.remove(), 3500);
}

function formatFlagReason(reason) {
  if (!reason) return '';
  if (reason.startsWith('blocked_word:')) {
    return 'Blocked Word: ' + reason.replace('blocked_word:', '').trim();
  }
  return reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}