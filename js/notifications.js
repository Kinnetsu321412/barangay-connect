// js/notifications.js
// =====================================================
// Per-user notification bell for the resident navbar.
//
// Firestore path:
//   barangays/{barangayId}/users/{uid}/notifications/{id}
//
// Call initNotifications() from community.html after auth.
// =====================================================

import { db } from './firebase-config.js';
import {
  collection, query, orderBy, limit,
  onSnapshot, updateDoc, deleteDoc, doc, writeBatch, getDocs, where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let _barangayId = null;
let _uid        = null;
let _unsub      = null;

export function initNotifications(barangayId, uid) {
  _barangayId = barangayId;
  _uid        = uid;

  const col = collection(db, 'barangays', barangayId, 'users', uid, 'notifications');
  const q   = query(col, orderBy('createdAt', 'desc'), limit(20));

  _unsub = onSnapshot(q, snap => {
    const notifs   = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const unread   = notifs.filter(n => !n.read).length;
    renderBell(unread);
    renderDropdown(notifs, barangayId, uid);
  });
}

// ── Bell badge ────────────────────────────────────────
function renderBell(unreadCount) {
  const dot = document.querySelector('.navbar__bell-dot');
  if (!dot) return;
  dot.style.display    = unreadCount > 0 ? 'block' : 'none';
  dot.textContent      = unreadCount > 9 ? '9+' : (unreadCount || '');
}

// ── Dropdown ──────────────────────────────────────────
function renderDropdown(notifs, barangayId, uid) {
  let panel = document.getElementById('notif-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'notif-panel';
    panel.style.cssText = `
      position:fixed;top:60px;right:1rem;
      width:min(360px,94vw);max-height:80vh;
      background:#fff;border-radius:16px;
      box-shadow:0 8px 32px rgba(0,0,0,.18);
      overflow:hidden;z-index:500;display:none;
      flex-direction:column;`;
    document.body.appendChild(panel);

    document.querySelector('.navbar__bell')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = panel.style.display === 'flex';
      panel.style.display = isOpen ? 'none' : 'flex';
      if (!isOpen) markAllRead(barangayId, uid);
    });

    document.addEventListener('click', () => { panel.style.display = 'none'; });
    panel.addEventListener('click', e => e.stopPropagation());
  }

  const unread = notifs.filter(n => !n.read).length;

  const ICONS = {
    comment: { icon: 'message-circle', bg: '#f0fdf4', color: '#15803d' },
    reply:   { icon: 'corner-down-right', bg: '#f0fdf4', color: '#15803d' },
    like:    { icon: 'heart', bg: '#fef2f2', color: '#dc2626' },
  };

  panel.innerHTML = `
    <!-- Header -->
    <div style="background:#1a3a1a;padding:1rem 1.1rem .75rem;flex-shrink:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.35rem;">
        <div style="display:flex;align-items:center;gap:.55rem;">
          <i data-lucide="bell" style="width:18px;height:18px;color:#fff;"></i>
          <span style="font-weight:700;font-size:1rem;color:#fff;">Notifications</span>
          ${unread > 0 ? `<span style="background:#f97316;color:#fff;font-size:.68rem;
            font-weight:700;padding:2px 8px;border-radius:999px;">${unread} new</span>` : ''}
        </div>
        <button onclick="document.getElementById('notif-panel').style.display='none'"
          style="background:rgba(255,255,255,.15);border:none;cursor:pointer;
            width:28px;height:28px;border-radius:50%;color:#fff;
            display:flex;align-items:center;justify-content:center;">
          <i data-lucide="x" style="width:14px;height:14px;pointer-events:none;"></i>
        </button>
      </div>
      ${notifs.length ? `
      <button onclick="clearAllNotifications('${barangayId}','${uid}')"
        style="background:none;border:none;cursor:pointer;color:rgba(255,255,255,.7);
          font-size:.75rem;padding:0;transition:color .15s;"
        onmouseover="this.style.color='#fff'"
        onmouseout="this.style.color='rgba(255,255,255,.7)'">
        Clear all notifications
      </button>` : ''}
    </div>

    <!-- List -->
    <div id="notif-list" style="overflow-y:auto;flex:1;">
      ${!notifs.length ? `
        <p style="padding:2.5rem;text-align:center;color:#9ca3af;font-size:.85rem;margin:0;">
          No notifications yet.
        </p>` :
        notifs.map(n => {
          const meta = ICONS[n.type] ?? ICONS.comment;
          const msg  = n.type === 'like'
            ? `liked your comment on`
            : n.type === 'reply'
            ? `replied to your comment on`
            : `commented on your post`;
          return `
          <div id="notif-row-${esc(n.id)}"
            onclick="handleNotifClick('${esc(n.id)}','${esc(n.postId)}','${esc(barangayId)}','${esc(uid)}')"
            style="display:flex;align-items:flex-start;gap:.75rem;
              padding:.85rem 1.1rem;border-bottom:1px solid #f3f4f6;
              cursor:pointer;transition:background .15s;position:relative;"
            onmouseover="this.style.background='#f9fafb'"
            onmouseout="this.style.background='transparent'">

            <!-- Icon -->
            <div style="width:40px;height:40px;border-radius:10px;flex-shrink:0;
              background:${meta.bg};display:flex;align-items:center;justify-content:center;">
              <i data-lucide="${meta.icon}" style="width:18px;height:18px;color:${meta.color};pointer-events:none;"></i>
            </div>

            <!-- Text -->
            <div style="flex:1;min-width:0;padding-right:1.5rem;">
              <p style="margin:0 0 2px;font-size:.82rem;color:#374151;line-height:1.4;
                font-weight:${n.read ? '400' : '600'};">
                <strong>${esc(n.actorName)}</strong> ${msg}
                <em>"${esc(n.postTitle)}"</em>
              </p>
              <p style="margin:0;font-size:.7rem;color:#9ca3af;">${relTime(n.createdAt)}</p>
            </div>

            <!-- Unread dot + dismiss -->
            <div style="position:absolute;right:.75rem;top:.85rem;
              display:flex;flex-direction:column;align-items:center;gap:.4rem;">
              ${!n.read ? `<div style="width:8px;height:8px;border-radius:50%;
                background:#f97316;flex-shrink:0;"></div>` : '<div style="width:8px;"></div>'}
              <button onclick="event.stopPropagation();dismissNotif('${esc(n.id)}','${esc(barangayId)}','${esc(uid)}')"
                style="background:none;border:none;cursor:pointer;color:#d1d5db;
                  padding:0;display:flex;transition:color .15s;"
                onmouseover="this.style.color='#6b7280'"
                onmouseout="this.style.color='#d1d5db'">
                <i data-lucide="x" style="width:13px;height:13px;pointer-events:none;"></i>
              </button>
            </div>

          </div>`;
        }).join('')
      }
    </div>`;

  lucide.createIcons({ el: panel });
}

// ── Write a notification ──────────────────────────────
export async function sendNotification(barangayId, recipientUid, data) {
  // Never notify yourself
  if (!recipientUid || recipientUid === data.actorId) return;
  const { addDoc, collection: _col, serverTimestamp: _ts } =
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  await addDoc(
    _col(db, 'barangays', barangayId, 'users', recipientUid, 'notifications'),
    {
      type:       data.type,        // 'comment' | 'reply' | 'like'
      actorId:    data.actorId,
      actorName:  data.actorName,
      postId:     data.postId,
      postTitle:  data.postTitle,
      commentId:  data.commentId ?? null,
      read:       false,
      createdAt:  _ts(),
    }
  );
}

// ── Click a notification ──────────────────────────────
window.handleNotifClick = async function(notifId, postId, barangayId, uid) {
  // Mark as read
  try {
    const ref = doc(db, 'barangays', barangayId, 'users', uid, 'notifications', notifId);
    await updateDoc(ref, { read: true });
  } catch (e) { /* non-fatal */ }

  // Close panel
  document.getElementById('notif-panel').style.display = 'none';

  // Scroll to post and open its comment thread
  const postEl = document.getElementById(`comment-thread-${postId}`)?.closest('article');
  if (postEl) {
    postEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    postEl.style.transition = 'box-shadow .3s';
    postEl.style.boxShadow  = '0 0 0 2px #f97316';
    setTimeout(() => { postEl.style.boxShadow = ''; }, 1800);
    // Open comment thread if not already open
    const thread = document.getElementById(`comment-thread-${postId}`);
    if (thread && (thread.style.display === 'none' || !thread.style.display)) {
      window.toggleComments?.(postId);
    }
  }
};

// ── Dismiss a single notification ────────────────────
window.dismissNotif = async function(notifId, barangayId, uid) {
  const row = document.getElementById(`notif-row-${notifId}`);
  if (row) {
    row.style.transition = 'transform .25s ease, opacity .25s ease';
    row.style.transform  = 'translateX(100%)';
    row.style.opacity    = '0';
    setTimeout(() => row.remove(), 260);
  }
  try {
    await deleteDoc(doc(db, 'barangays', barangayId, 'users', uid, 'notifications', notifId));
  } catch (e) { console.error('[notif] dismiss:', e); }
};

// ── Clear all notifications ───────────────────────────
window.clearAllNotifications = async function(barangayId, uid) {
  const list = document.getElementById('notif-list');
  const rows = list?.querySelectorAll('[id^="notif-row-"]');
  if (!rows?.length) return;

  // Staggered slide-out animation
  rows.forEach((row, i) => {
    setTimeout(() => {
      row.style.transition = 'transform .22s ease, opacity .22s ease';
      row.style.transform  = 'translateX(110%)';
      row.style.opacity    = '0';
    }, i * 45);
  });

  // Delete from Firestore after animation
  setTimeout(async () => {
    try {
      const col      = collection(db, 'barangays', barangayId, 'users', uid, 'notifications');
      const snap     = await getDocs(col);
      const batch    = writeBatch(db);
      snap.forEach(d => batch.delete(d.ref));
      await batch.commit();
    } catch (e) { console.error('[notif] clear all:', e); }
  }, rows.length * 45 + 250);
};

// ── Mark all read ─────────────────────────────────────
async function markAllRead(barangayId, uid) {
  const col   = collection(db, 'barangays', barangayId, 'users', uid, 'notifications');
  const q     = query(col, orderBy('createdAt', 'desc'), limit(20));
  // Use a snapshot from cache — don't re-fetch
  const batch = writeBatch(db);
  // We get the current list from the live listener's last snapshot
  // by querying unread docs directly:
  const { getDocs, where } =
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  const unreadQ    = query(col,
    (await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js")).where('read','==',false)
  );
  const unreadSnap = await getDocs(unreadQ);
  unreadSnap.forEach(d => batch.update(d.ref, { read: true }));
  await batch.commit();
}

// ── Helpers ───────────────────────────────────────────
function relTime(ts) {
  if (!ts?.toDate && !ts?.seconds) return '';
  const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  const d    = Date.now() - date.getTime();
  const m    = Math.floor(d / 60_000);
  const h    = Math.floor(d / 3_600_000);
  if (m  <  1) return 'just now';
  if (m  < 60) return `${m}m ago`;
  if (h  < 24) return `${h}h ago`;
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}