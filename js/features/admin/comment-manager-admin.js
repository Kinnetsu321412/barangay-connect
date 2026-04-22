/* ================================================
   comment-manager-admin.js — BarangayConnect
   Admin comment manager. Aggregates and displays
   top-level comments and threaded replies from both
   announcements and communityPosts subcollections
   for a given barangay.

   Architecture:
     1. Fetch up to 50 recent posts per source collection
     2. For each post, fetch its top-level comments
     3. Build a recursive reply tree from the flat comment list
     4. Replies are loaded eagerly but rendered on demand (expand toggle)
     5. Delete works on both top-level comments and nested replies
     6. Source filter: all / announcements / communityPosts
     7. Search filter: author name, comment body, or post title

   WHAT IS IN HERE:
     · onAuthStateChanged bootstrap — resolves barangay and role
     · loadAllComments — fetches and tree-builds comments from both sources
     · renderComments — applies source and search filters, rebuilds list DOM
     · buildCommentRow — constructs a single top-level comment card
     · buildReplyRows — recursively constructs nested reply rows
     · toggleAdminReplies — expands / collapses a reply list
     · adminDeleteComment — Firestore delete + commentCount decrement + local state update
     · setCommentSource / filterComments — filter controls
     · refreshComments — manual reload trigger
     · switchBulletinView override — auto-loads on first tab open
     · Toast notifications and XSS escape utility

   WHAT IS NOT IN HERE:
     · Resident-facing comment UI and submission  → comments.js
     · Firebase config and db instance            → firebase-config.js
     · Firestore path helpers                     → db-paths.js
     · Global modal and frame styles              → frames.css

   REQUIRED IMPORTS:
     · ../../core/firebase-config.js          (auth, db)
     · ../../core/db-paths.js                 (userIndexDoc, barangayId as toBid)
     · firebase-firestore.js@10.12.0 (collection, getDocs, deleteDoc, doc,
                                      query, orderBy, limit, getDoc,
                                      updateDoc, increment)
     · firebase-auth.js@10.12.0      (onAuthStateChanged)

   QUICK REFERENCE:
     Bootstrap           → onAuthStateChanged (top-level, runs on load)
     Load comments       → loadAllComments()
     Render list         → renderComments()
     Delete comment      → window.adminDeleteComment(postId, commentId, col)
     Toggle replies      → window.toggleAdminReplies(commentId)
     Source filter       → window.setCommentSource(source, btn)
     Search filter       → window.filterComments()
     Manual refresh      → window.refreshComments()
================================================ */


// ================================================
// IMPORTS
// ================================================

import { auth, db }                          from '../../core/firebase-config.js';
import { userIndexDoc, barangayId as toBid } from '../../core/db-paths.js';

import {
  collection, getDocs, deleteDoc, doc,
  query, orderBy, limit, getDoc, updateDoc, increment,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";


// ================================================
// MODULE STATE
// ================================================

let _bid          = null; // resolved Firestore barangay ID
let _barangay     = null; // resolved barangay name
let _allComments  = [];   // flat list of { commentId, postId, postTitle, col, replies, ...commentData }
let _sourceFilter = 'all';
let _searchTerm   = '';


// ================================================
// BOOTSTRAP
// ================================================

/*
   Resolves the admin's barangay and role from userIndex.
   Sets module-level _bid and _barangay used by all subsequent operations.
*/

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const snap = await getDoc(userIndexDoc(user.uid));
  if (!snap.exists()) return;

  const { barangay, role } = snap.data();
  if (role !== 'admin' && role !== 'officer') return;

  _barangay = barangay;
  _bid      = toBid(barangay);
});


// ================================================
// LOAD COMMENTS
// ================================================

/*
   Fetches up to 50 recent posts from announcements and communityPosts,
   then fetches top-level comments per post and assembles a recursive
   reply tree. Results are sorted newest-first and stored in _allComments.
*/

async function loadAllComments() {
  if (!_bid) return;

  const listEl = document.getElementById('commentManagerList');
  if (!listEl) return;

  listEl.innerHTML = `<p style="color:#aaa;font-size:.9rem;padding:1rem 0;">Loading…</p>`;
  _allComments = [];

  const sources = [
    { col: 'announcements',  label: 'Official'   },
    { col: 'communityPosts', label: 'Community'  },
  ];

  for (const src of sources) {
    /* Fetch up to 50 recent posts per source */
    const postsSnap = await getDocs(query(
      collection(db, 'barangays', _bid, src.col),
      orderBy('createdAt', 'desc'),
      limit(50),
    )).catch(() => null);

    if (!postsSnap) continue;

    for (const postDoc of postsSnap.docs) {
      const postData = postDoc.data();

      /* Fetch top-level comments for this post */
      const commentsSnap = await getDocs(query(
        collection(db, 'barangays', _bid, src.col, postDoc.id, 'comments'),
        orderBy('createdAt', 'desc'),
        limit(100),
      )).catch(() => null);

      if (!commentsSnap) continue;

      /* Build a recursive tree from the flat comment list */
      const commentMap = new Map(
        commentsSnap.docs
          .map(d => ({ id: d.id, ...d.data(), replies: [] }))
          .map(c => [c.id, c]),
      );

      const topLevel = [];
      for (const c of commentMap.values()) {
        if (!c.parentCommentId) {
          topLevel.push(c);
        } else if (commentMap.has(c.parentCommentId)) {
          commentMap.get(c.parentCommentId).replies.push(c);
        }
      }

      /* Sort replies chronologically at every depth */
      function sortReplies(node) {
        node.replies.sort((a, b) =>
          (a.createdAt?.toDate?.() ?? 0) - (b.createdAt?.toDate?.() ?? 0),
        );
        node.replies.forEach(sortReplies);
      }
      topLevel.forEach(sortReplies);

      for (const commentNode of topLevel) {
        _allComments.push({
          commentId:  commentNode.id,
          postId:     postDoc.id,
          postTitle:  postData.title ?? '(no title)',
          postSource: src.label,
          col:        src.col,
          replyCount: commentNode.replies.length,
          replies:    commentNode.replies,
          ...commentNode,
        });
      }
    }
  }

  /* Sort all collected comments newest-first */
  _allComments.sort((a, b) => {
    const ta = a.createdAt?.toDate?.() ?? new Date(0);
    const tb = b.createdAt?.toDate?.() ?? new Date(0);
    return tb - ta;
  });

  renderComments();
}


// ================================================
// RENDER — Comment List
// ================================================

/* Applies source and search filters, then rebuilds the comment list DOM */
function renderComments() {
  const listEl = document.getElementById('commentManagerList');
  if (!listEl) return;

  let list = [..._allComments];

  if (_sourceFilter !== 'all') {
    list = list.filter(c => c.col === _sourceFilter);
  }

  if (_searchTerm) {
    const q = _searchTerm.toLowerCase();
    list = list.filter(c =>
      (c.authorName ?? '').toLowerCase().includes(q) ||
      (c.body       ?? '').toLowerCase().includes(q) ||
      (c.postTitle  ?? '').toLowerCase().includes(q),
    );
  }

  if (!list.length) {
    listEl.innerHTML = `
      <div style="
        background:    #fff;
        border-radius: 12px;
        padding:       3rem;
        text-align:    center;
        color:         #aaa;
        box-shadow:    0 1px 4px rgba(0,0,0,.07);
      ">
        <div style="font-size:2rem;margin-bottom:.5rem;">💬</div>
        <p style="margin:0;font-size:.9rem;">No comments found.</p>
      </div>`;
    return;
  }

  listEl.innerHTML = list.map(c => buildCommentRow(c)).join('');
  lucide.createIcons({ el: listEl });
}


// ================================================
// BUILD — Reply Rows (Recursive)
// ================================================

/*
   Recursively constructs indented reply rows for a given depth.
   Nested replies are collapsed behind an expand toggle.
*/

function buildReplyRows(replies, postId, col, depth = 0) {
  if (!replies?.length) return '';
  const indent = depth * 16;

  return replies.map(r => {
    const rTime = r.createdAt?.toDate?.()
      ?.toLocaleDateString('en-PH', {
        month:  'short',
        day:    'numeric',
        hour:   '2-digit',
        minute: '2-digit',
      }) ?? '—';

    const nestedSection = r.replies?.length ? `
      <div style="margin-top:.35rem;">
        <button
          onclick="toggleAdminReplies('${esc(r.id)}')"
          id="reply-toggle-${esc(r.id)}"
          style="
            background:  none;
            border:      none;
            cursor:      pointer;
            font-size:   .72rem;
            color:       #6b7280;
            font-weight: 600;
            padding:     0;
            display:     flex;
            align-items: center;
            gap:         .3rem;
            transition:  color .15s;
          "
          onmouseover="this.style.color='#374151'"
          onmouseout="this.style.color='#6b7280'">
          <i data-lucide="chevron-right"
            id="reply-chevron-${esc(r.id)}"
            style="width:12px;height:12px;transition:transform .2s;pointer-events:none;"></i>
          ${r.replies.length} ${r.replies.length === 1 ? 'reply' : 'replies'}
        </button>
        <div id="reply-list-${esc(r.id)}"
          style="display:none;margin-top:.3rem;">
          ${buildReplyRows(r.replies, postId, col, depth + 1)}
        </div>
      </div>` : '';

    return `
      <div style="
        display:      flex;
        gap:          .6rem;
        align-items:  flex-start;
        padding:      .5rem .6rem;
        margin-left:  ${indent}px;
        border-left:  2px solid #e5e7eb;
        margin-top:   .35rem;
      ">
        <div style="
          width:            20px;
          height:           20px;
          border-radius:    50%;
          background:       #e5e7eb;
          display:          flex;
          align-items:      center;
          justify-content:  center;
          font-size:        .55rem;
          font-weight:      700;
          color:            #6b7280;
          flex-shrink:      0;
        ">
          ${esc(String(r.authorName ?? 'U').slice(0, 2).toUpperCase())}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="
            display:     flex;
            align-items: center;
            gap:         .4rem;
            flex-wrap:   wrap;
            margin-bottom: 2px;
          ">
            <span style="font-size:.78rem;font-weight:700;color:#374151;">
              ${esc(r.authorName ?? 'Resident')}
            </span>
            <span style="font-size:.68rem;color:#9ca3af;">${rTime}</span>
            <span style="font-size:.68rem;color:#9ca3af;">❤️ ${r.likeCount ?? 0}</span>
          </div>
          <p style="
            font-size:   .8rem;
            color:       #4b5563;
            margin:      0;
            line-height: 1.4;
            word-break:  break-word;
          ">
            ${esc(r.body ?? '')}
          </p>
          ${nestedSection}
        </div>
        <button
          onclick="adminDeleteComment('${esc(postId)}','${esc(r.id)}','${esc(col)}')"
          title="Delete reply"
          style="
            flex-shrink: 0;
            background:  none;
            border:      none;
            cursor:      pointer;
            color:       #d1d5db;
            padding:     2px;
            transition:  color .15s;
          "
          onmouseover="this.style.color='#dc2626'"
          onmouseout="this.style.color='#d1d5db'">
          <i data-lucide="trash-2" style="width:12px;height:12px;pointer-events:none;"></i>
        </button>
      </div>`;
  }).join('');
}


// ================================================
// BUILD — Comment Row
// ================================================

/* Constructs and returns the HTML string for a single top-level comment card */
function buildCommentRow(c) {
  const time = c.createdAt?.toDate?.()
    ?.toLocaleDateString('en-PH', {
      month:  'short',
      day:    'numeric',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
    }) ?? '—';

  const sourceChip = c.col === 'announcements'
    ? `<span style="
        background:    #f0fdf4;
        color:         #15803d;
        padding:       2px 8px;
        border-radius: 999px;
        font-size:     .68rem;
        font-weight:   700;
        border:        1px solid #bbf7d0;
      ">✓ Official</span>`
    : `<span style="
        background:    #f9fafb;
        color:         #6b7280;
        padding:       2px 8px;
        border-radius: 999px;
        font-size:     .68rem;
        font-weight:   700;
        border:        1px solid #e5e7eb;
      ">Community</span>`;

  const repliesHtml    = buildReplyRows(c.replies ?? [], c.postId, c.col);
  const repliesSection = c.replyCount > 0 ? `
    <div style="margin-top:.5rem;">
      <button
        onclick="toggleAdminReplies('${esc(c.commentId)}')"
        id="reply-toggle-${esc(c.commentId)}"
        style="
          background:  none;
          border:      none;
          cursor:      pointer;
          font-size:   .75rem;
          color:       #6b7280;
          font-weight: 600;
          padding:     0;
          display:     flex;
          align-items: center;
          gap:         .3rem;
          transition:  color .15s;
        "
        onmouseover="this.style.color='#374151'"
        onmouseout="this.style.color='#6b7280'">
        <i data-lucide="chevron-right"
          id="reply-chevron-${esc(c.commentId)}"
          style="width:13px;height:13px;transition:transform .2s;pointer-events:none;"></i>
        ${c.replyCount} ${c.replyCount === 1 ? 'reply' : 'replies'}
      </button>
      <div id="reply-list-${esc(c.commentId)}"
        style="display:none;margin-top:.3rem;padding-left:.3rem;">
        ${repliesHtml}
      </div>
    </div>` : '';

  return `
    <div style="
      background:    #fff;
      border-radius: 12px;
      padding:       1.1rem 1.25rem;
      box-shadow:    0 1px 4px rgba(0,0,0,.07);
    " id="comment-row-${esc(c.commentId)}">

      <!-- Post context: source chip + post title -->
      <div style="
        display:     flex;
        align-items: center;
        gap:         .5rem;
        margin-bottom: .6rem;
        flex-wrap:   wrap;
      ">
        ${sourceChip}
        <span style="font-size:.75rem;color:#9ca3af;font-weight:500;">on</span>
        <span style="
          font-size:     .78rem;
          font-weight:   700;
          color:         #374151;
          max-width:     280px;
          overflow:      hidden;
          text-overflow: ellipsis;
          white-space:   nowrap;
        " title="${esc(c.postTitle)}">
          ${esc(c.postTitle)}
        </span>
      </div>

      <!-- Comment content -->
      <div style="display:flex;gap:.6rem;align-items:flex-start;">

        <!-- Avatar -->
        <div style="
          width:            28px;
          height:           28px;
          border-radius:    50%;
          background:       #e5e7eb;
          display:          flex;
          align-items:      center;
          justify-content:  center;
          font-size:        .62rem;
          font-weight:      700;
          color:            #6b7280;
          flex-shrink:      0;
        ">
          ${esc(String(c.authorName ?? 'U').slice(0, 2).toUpperCase())}
        </div>

        <div style="flex:1;min-width:0;">
          <div style="
            display:     flex;
            align-items: center;
            gap:         .4rem;
            flex-wrap:   wrap;
            margin-bottom: 3px;
          ">
            <span style="font-size:.82rem;font-weight:700;color:#374151;">
              ${esc(c.authorName ?? 'Resident')}
            </span>
            <span style="font-size:.72rem;color:#9ca3af;">${time}</span>
            <span style="font-size:.72rem;color:#9ca3af;">❤️ ${c.likeCount ?? 0}</span>
          </div>
          <p style="
            font-size:   .85rem;
            color:       #4b5563;
            margin:      0 0 .3rem;
            line-height: 1.5;
            word-break:  break-word;
          ">
            ${esc(c.body ?? '')}
          </p>
          ${repliesSection}
        </div>

        <!-- Delete comment button -->
        <button
          onclick="adminDeleteComment('${esc(c.postId)}','${esc(c.commentId)}','${esc(c.col)}')"
          title="Delete comment and all its replies"
          style="
            flex-shrink:  0;
            display:      inline-flex;
            align-items:  center;
            gap:          .3rem;
            padding:      .4rem .75rem;
            border-radius: 7px;
            border:       1.5px solid #fca5a5;
            background:   #fff;
            color:        #dc2626;
            font-size:    .75rem;
            font-weight:  600;
            cursor:       pointer;
            transition:   background .15s;
            white-space:  nowrap;
          "
          onmouseover="this.style.background='#fef2f2'"
          onmouseout="this.style.background='#fff'">
          <i data-lucide="trash-2" style="width:12px;height:12px;pointer-events:none;"></i>
          Delete
        </button>

      </div>
    </div>`;
}


// ================================================
// ACTIONS — Toggle Reply List
// ================================================

/* Expands or collapses a reply list and rotates the chevron accordingly */
window.toggleAdminReplies = function (commentId) {
  const list    = document.getElementById(`reply-list-${commentId}`);
  const chevron = document.getElementById(`reply-chevron-${commentId}`);
  if (!list) return;

  const isOpen             = list.style.display !== 'none';
  list.style.display       = isOpen ? 'none' : 'block';
  if (chevron) chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
};


// ================================================
// ACTIONS — Delete Comment
// ================================================

/*
   Deletes a comment document from Firestore, decrements commentCount
   on the parent post, then removes the entry from _allComments and
   re-renders the list.
*/

window.adminDeleteComment = async function (postId, commentId, col) {
  if (!confirm('Delete this comment? This cannot be undone.')) return;
  if (!_bid) return;

  try {
    const postRef    = doc(db, 'barangays', _bid, col, postId);
    const commentRef = doc(db, 'barangays', _bid, col, postId, 'comments', commentId);

    await deleteDoc(commentRef);
    await updateDoc(postRef, { commentCount: increment(-1) }).catch(() => {});

    /* Recursively remove the deleted ID from a reply tree */
    function removeFromTree(replies, id) {
      return replies
        .filter(r => r.id !== id)
        .map(r => ({ ...r, replies: removeFromTree(r.replies ?? [], id) }));
    }

    /* Remove from top-level and from nested replies */
    _allComments = _allComments
      .filter(c => c.commentId !== commentId)
      .map(c => {
        const updatedReplies = removeFromTree(c.replies ?? [], commentId);
        return { ...c, replies: updatedReplies, replyCount: updatedReplies.length };
      });

    renderComments();
    showCommentToast('Comment deleted.', 'success');

  } catch (err) {
    console.error('[comment-manager] delete:', err);
    showCommentToast('Failed to delete. Check permissions.', 'error');
  }
};


// ================================================
// FILTER CONTROLS
// ================================================

/* Updates the source filter and re-renders */
window.setCommentSource = function (source, btn) {
  _sourceFilter = source;
  document.querySelectorAll('.comment-source-btn').forEach(b => b.classList.remove('is-active'));
  btn.classList.add('is-active');
  renderComments();
};

/* Updates the search term from the search input and re-renders */
window.filterComments = function () {
  _searchTerm = document.getElementById('commentSearchInput')?.value.trim() ?? '';
  renderComments();
};


// ================================================
// REFRESH
// ================================================

/* Manually reloads all comments; updates the refresh button state during load */
window.refreshComments = async function () {
  const btn = document.querySelector('[onclick="refreshComments()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

  await loadAllComments();

  if (btn) {
    btn.disabled  = false;
    btn.innerHTML = '<i data-lucide="refresh-cw" style="width:13px;height:13px;"></i> Refresh';
    lucide.createIcons({ el: btn });
  }
};


// ================================================
// TAB HOOK — Auto-load on First Open
// ================================================

/*
   Wraps the global switchBulletinView to auto-trigger loadAllComments
   the first time the comments sub-tab is opened.
*/

const _origSwitchBulletinView = window.switchBulletinView;

window.switchBulletinView = function (view, btn) {
  _origSwitchBulletinView?.(view, btn);
  if (view === 'comments' && _allComments.length === 0 && _bid) {
    loadAllComments();
  }
};


// ================================================
// UTILITIES
// ================================================

/* Appends a transient toast to #toastContainer; auto-removes after 3.5s */
function showCommentToast(msg, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const t       = document.createElement('div');
  t.className   = `toast toast--${type}`;
  t.innerHTML   = `
    <i data-lucide="${type === 'success' ? 'check' : 'x-circle'}"></i>${esc(msg)}
  `;

  container.appendChild(t);
  lucide.createIcons({ el: t });
  setTimeout(() => t.remove(), 3500);
}

/* HTML-escapes a value for safe use in innerHTML interpolation */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}