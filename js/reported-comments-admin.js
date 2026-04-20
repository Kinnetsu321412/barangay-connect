// js/reported-comments-admin.js
import { auth, db } from './firebase-config.js';
import { userIndexDoc, barangayId as toBid } from './db-paths.js';
import {
  collection, onSnapshot, query, where, orderBy,
  doc, updateDoc, deleteDoc, getDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

let _bid = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const snap = await getDoc(userIndexDoc(user.uid));
  if (!snap.exists()) return;
  const { barangay, role } = snap.data();
  if (role !== 'admin' && role !== 'officer') return;
  _bid = toBid(barangay);

  const q = query(
    collection(db, 'barangays', _bid, 'reportedComments'),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc'),
  );

  onSnapshot(q, snap => {
    const reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const badge = document.getElementById('reportedCommentsBadge');
    if (badge) {
      badge.textContent   = reports.length;
      badge.style.display = reports.length ? 'inline' : 'none';
    }
    renderReportedComments(reports);
  });
});

async function renderReportedComments(reports) {
  const el = document.getElementById('reportedCommentsList');
  if (!el) return;

  if (!reports.length) {
    el.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:3rem;text-align:center;
        color:#aaa;box-shadow:0 1px 4px rgba(0,0,0,.07);">
        <div style="font-size:2rem;margin-bottom:.5rem;">💬</div>
        <p style="margin:0;font-size:.9rem;">No reported comments.</p>
      </div>`;
    return;
  }

  // Fetch comment bodies in parallel
  const enriched = await Promise.all(reports.map(async r => {
    let commentBody = '(comment not found)';
    let postTitle   = '(post not found)';
    for (const col of ['communityPosts', 'announcements']) {
      try {
        const cSnap = await getDoc(
          doc(db, 'barangays', _bid, col, r.postId, 'comments', r.commentId)
        );
        if (cSnap.exists()) {
          commentBody = cSnap.data().body ?? commentBody;
          // Also try to get post title
          const pSnap = await getDoc(doc(db, 'barangays', _bid, col, r.postId));
          if (pSnap.exists()) postTitle = pSnap.data().title ?? postTitle;
          break;
        }
      } catch {}
    }
    return { ...r, commentBody, postTitle };
  }));

  el.innerHTML = enriched.map(r => `
    <div style="background:#fff;border-radius:12px;padding:1.25rem;
      box-shadow:0 1px 4px rgba(0,0,0,.07);border-left:3px solid #f59e0b;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;
        gap:1rem;flex-wrap:wrap;">
        <div style="flex:1;min-width:0;">
          <p style="font-size:.72rem;color:#9ca3af;margin:0 0 .2rem;">
            On post: <strong style="color:#374151;">${esc(r.postTitle)}</strong>
          </p>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;
            padding:.55rem .75rem;margin-bottom:.4rem;">
            <p style="font-size:.85rem;color:#374151;margin:0;line-height:1.5;">
              "${esc(r.commentBody)}"
            </p>
          </div>
          <p style="font-size:.78rem;color:var(--gray-500);margin:0 0 .15rem;">
            Reported by: <strong>${esc(r.reportedByName ?? r.reportedBy)}</strong>
          </p>
          <p style="font-size:.78rem;color:var(--red);margin:0 0 .1rem;">
            Reason: ${esc(r.reason?.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()) ?? '—')}
          </p>
          ${r.details ? `<p style="font-size:.75rem;color:var(--gray-400);margin:0;">${esc(r.details)}</p>` : ''}
        </div>
        <div style="display:flex;gap:.5rem;flex-shrink:0;flex-wrap:wrap;">
          <button onclick="dismissCommentReport('${esc(r.id)}')"
            style="display:inline-flex;align-items:center;gap:.35rem;padding:.5rem 1rem;
              border-radius:8px;background:#1a3a1a;color:#fff;border:none;
              font-size:.82rem;font-weight:600;cursor:pointer;">
            Dismiss
          </button>
          <button onclick="deleteReportedComment('${esc(r.id)}','${esc(r.postId)}','${esc(r.commentId)}')"
            style="display:inline-flex;align-items:center;gap:.35rem;padding:.5rem 1rem;
              border-radius:8px;background:#fff;color:#dc2626;border:1.5px solid #fca5a5;
              font-size:.82rem;font-weight:600;cursor:pointer;">
            Delete Comment
          </button>
        </div>
      </div>
    </div>`).join('');

  lucide.createIcons({ el });
}

window.dismissCommentReport = async function(reportId) {
  if (!_bid) return;
  await updateDoc(doc(db, 'barangays', _bid, 'reportedComments', reportId), {
    status: 'dismissed', updatedAt: serverTimestamp(),
  });
};

window.deleteReportedComment = async function(reportId, postId, commentId) {
  if (!confirm('Delete this comment permanently?')) return;
  if (!_bid) return;
  for (const col of ['communityPosts', 'announcements']) {
    try {
      const ref = doc(db, 'barangays', _bid, col, postId, 'comments', commentId);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      await deleteDoc(ref);
const { increment: _inc, updateDoc: _upd } =
  await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
await _upd(doc(db, 'barangays', _bid, col, postId), { commentCount: _inc(-1) });
      break;
    } catch {}
  }
  await updateDoc(doc(db, 'barangays', _bid, 'reportedComments', reportId), {
    status: 'actioned', updatedAt: serverTimestamp(),
  });
};

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}