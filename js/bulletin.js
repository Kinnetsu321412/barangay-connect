// js/bulletin.js
// =====================================================
// Resident-side Announcements — Community Bulletin Tab
// =====================================================

import { db } from './firebase-config.js';
import {
  collection, onSnapshot, query,
  where, orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  initComments, buildCommentThread, restoreOpenThreads,
} from './comments.js';
import {
  initCommunityPosts, subscribeCommunityPosts,
  submitCommunityPost, getModerationSettings,
} from './community-posts.js';
import { initNotifications } from './notifications.js';
import { openImageViewer as _openViewer, _injectImageViewer } from './image-viewer.js';

// ── Runtime state ─────────────────────────────────────────────────
let BARANGAY_ID        = null;
let _activeFilter      = 'all';
let _sourceFilter      = 'all';
let _allPosts          = [];
let _allCommunityPosts = [];
let _currentUid        = null;
let _currentUserName   = 'Resident';
let _currentUserRole   = 'resident';
const PAGE_SIZE        = 10;
let _currentPage       = 0;

// ── Reaction state ────────────────────────────────────────────────
const _reactState = new Map();
const _reactLock  = new Set();

// ── Emoji map ─────────────────────────────────────────────────────
const EMOJI = { heart: '❤️', laugh: '😂', wow: '😮', sad: '😢', like: '👍' };

// ── Category map ──────────────────────────────────────────────────
const CATEGORY_MAP = {
  announcements:  { tagClass: 'tag--blue',   accentClass: 'post-row--blue',   label: 'Announcement'   },
  health:         { tagClass: 'tag--green',  accentClass: 'post-row--green',  label: 'Health'         },
  infrastructure: { tagClass: 'tag--amber',  accentClass: 'post-row--orange', label: 'Infrastructure' },
  safety:         { tagClass: 'tag--red',    accentClass: 'post-row--red',    label: 'Safety'         },
  events:         { tagClass: 'tag--purple', accentClass: 'post-row--purple', label: 'Events'         },
  general:        { tagClass: 'tag--teal',   accentClass: 'post-row--teal',   label: 'General'        },
};
const categoryMeta = cat => CATEGORY_MAP[cat] ?? CATEGORY_MAP.general;

function relativeTime(ts) {
  if (!ts?.toDate) return '';
  const diff  = Date.now() - ts.toDate().getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return 'Just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  2) return 'Yesterday';
  if (days  <  7) return `${days} days ago`;
  return ts.toDate().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

window.openImageViewer = _openViewer;

// ================================================================
// BOOTSTRAP
// ================================================================
export async function initBulletin() {
  const listEl = document.getElementById('bulletinList');
  if (!listEl) return;

  renderSkeleton(listEl);
  _injectImageViewer();

  try {
    const { getDoc, doc: _docFn } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const { auth }                            = await import('./firebase-config.js');
    const { userIndexDoc, barangayId: toBid } = await import('./db-paths.js');

    await new Promise(resolve => {
      const unsub = auth.onAuthStateChanged(user => { unsub(); resolve(user); });
    }).then(async user => {
      if (!user) {
        listEl.innerHTML = `<p class="bulletin-empty-msg">Sign in to view announcements.</p>`;
        return;
      }
      _currentUid = user.uid;
      const snap  = await getDoc(userIndexDoc(user.uid));
      if (!snap.exists()) return;

      const data       = snap.data();
      BARANGAY_ID      = toBid(data.barangay);
      _currentUserRole = data.role || 'resident';

      if (_currentUserRole === 'admin' || _currentUserRole === 'officer') {
        document.querySelectorAll('.admin-only-option').forEach(o => o.style.display = '');
      }

      try {
        const uSnap      = await getDoc(_docFn(db, 'barangays', BARANGAY_ID, 'users', user.uid));
        _currentUserName = uSnap.exists()
          ? (uSnap.data().fullName ?? user.displayName ?? 'Resident')
          : (user.displayName ?? 'Resident');
      } catch (_) { _currentUserName = user.displayName ?? 'Resident'; }
    });
  } catch (err) {
    console.error('[bulletin] could not resolve barangay:', err);
    return;
  }

  if (!BARANGAY_ID) return;

  initComments(BARANGAY_ID, _currentUid, _currentUserName, _currentUserRole);
  initNotifications(BARANGAY_ID, _currentUid);
  initCommunityPosts(BARANGAY_ID, _currentUid, _currentUserName, _currentUserRole);
  window._communityBid    = BARANGAY_ID;
  window._currentUserRole = _currentUserRole;

  let _communityInitialLoad = true;

  subscribeCommunityPosts(posts => {
    const newIds    = posts.filter(p => !_allCommunityPosts.find(o => o.id === p.id)).map(p => p.id);
    const prevCount = _allCommunityPosts.length;
    _allCommunityPosts = posts;
    // Only reset to page 0 on structural changes after the initial load
    if (!_communityInitialLoad && posts.length !== prevCount) _currentPage = 0;
    _communityInitialLoad = false;
    renderBulletin(listEl);
    if (newIds.length) loadReactionState(newIds);
  });

  const q = query(
    collection(db, 'barangays', BARANGAY_ID, 'announcements'),
    where('status', '==', 'published'),
    orderBy('isPinned', 'desc'),
    orderBy('createdAt', 'desc'),
  );

  const hashPage = parseInt(new URLSearchParams(window.location.hash.slice(1)).get('page'), 10);
  if (!isNaN(hashPage) && hashPage > 0) _currentPage = hashPage;

  let _postsInitialLoad = true;

  onSnapshot(q, snap => {
    const newPosts  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const newIds    = newPosts.filter(p => !_allPosts.find(o => o.id === p.id)).map(p => p.id);
    const prevCount = _allPosts.length;
    _allPosts = newPosts;
    // Only reset to page 0 on structural changes after the initial load
    if (!_postsInitialLoad && _allPosts.length !== prevCount) _currentPage = 0;
    _postsInitialLoad = false;
    renderBulletin(listEl);
    if (newIds.length) loadReactionState(newIds);
  });

  // Source segmented control (All / Official / Community)
  document.querySelectorAll('.bulletin-source-seg__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bulletin-source-seg__btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _sourceFilter = btn.dataset.source ?? 'all';
      _currentPage  = 0;
      _clearHashPage();
      renderBulletin(listEl);
    });
  });

  // Category filter pills
  document.querySelectorAll('#bulletinCategoryFilters .btn--filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bulletinCategoryFilters .btn--filter').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _activeFilter = btn.textContent.trim().toLowerCase() === 'all' ? 'all' : btn.textContent.trim().toLowerCase();
      _currentPage  = 0;
      _clearHashPage();
      renderBulletin(listEl);
      loadReactionState([..._allPosts.map(p => p.id), ..._allCommunityPosts.map(p => p.id)]);
    });
  });
}


// ================================================================
// RENDER
// ================================================================
function renderBulletin(listEl) {
  document.querySelectorAll('.reaction-picker.is-open').forEach(p => p.classList.remove('is-open'));
  const now = new Date();

  const combined = [
    ..._allPosts.map(p => ({ ...p, _type: 'announcement' })),
    ..._allCommunityPosts,
  ].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    const ta = a.createdAt?.toDate?.() ?? new Date(0);
    const tb = b.createdAt?.toDate?.() ?? new Date(0);
    return tb - ta;
  });

  const filtered = (_activeFilter === 'all' ? combined : combined.filter(p => p.category === _activeFilter))
    .filter(p => {
      if (_sourceFilter === 'official'  && p._type === 'post') return false;
      if (_sourceFilter === 'community' && p._type !== 'post') return false;
      return !p.expiresAt || p.expiresAt.toDate() > now;
    });

  if (!filtered.length) {
      listEl.innerHTML = `<div class="bulletin-empty"><p class="bulletin-empty__text">No posts for this category yet.</p></div>`;
      document.getElementById('bulletinPaginationNav')?.remove();
      return;
    }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  if (_currentPage >= totalPages) _currentPage = Math.max(0, totalPages - 1);
  const paginated  = filtered.slice(_currentPage * PAGE_SIZE, (_currentPage + 1) * PAGE_SIZE);

  // Save carousel positions
  const savedCarousel = new Map();
  listEl.querySelectorAll('[id^="carousel-track-"]').forEach(track => {
    const pid = track.id.replace('carousel-track-', '');
    const w   = track.offsetWidth;
    savedCarousel.set(pid, w > 0 ? Math.round(track.scrollLeft / w) : 0);
  });

  const existingIds = [...listEl.querySelectorAll('article[data-post-id]')].map(a => a.dataset.postId);
  const newIds      = paginated.map(p => p.id);
  const sameStructure = existingIds.length === newIds.length && newIds.every((id, i) => id === existingIds[i]);

  if (sameStructure) {
    // Just patch the fields that change without rebuilding DOM
    paginated.forEach(post => {
      const article = listEl.querySelector(`article[data-post-id="${post.id}"]`);
      if (!article) return;
      // Patch comment count
      const commentBtn = article.querySelector('.post-comment-btn');
      if (commentBtn) commentBtn.childNodes[commentBtn.childNodes.length - 1].textContent = ` ${post.commentCount ?? 0}`;
      // Patch reaction summary (only if not currently reacted — _applyReactUI handles the reacted state)
      if (!_reactState.get(post.id)) {
        const countSpan = document.getElementById(`like-count-${post.id}`);
        if (countSpan) {
          const summary = buildReactionSummary(post.reactions, post.likeCount);
          countSpan.innerHTML = summary.total > 0
            ? summary.html
            : '<span style="color:var(--gray-400);font-size:var(--text-xs);font-family:var(--font-display);font-weight:var(--fw-semibold);">Like</span>';
        }
      }
    });
    _reactState.forEach((state, postId) => { _applyReactUI(postId); });
    return;
  }

  listEl.innerHTML = paginated.map(post => buildPostRow(post)).join('');
  lucide.createIcons({ el: listEl });

  savedCarousel.forEach((idx, pid) => { if (idx > 0) carouselGoTo(pid, idx); });
  _reactState.forEach((state, postId) => { if (state) _applyReactUI(postId); });

  // Wire reaction picker hover-close per post
  listEl.querySelectorAll('.post-reaction-wrap').forEach(wrap => {
    const btn    = wrap.querySelector('[id^="like-btn-"]');
    const picker = wrap.querySelector('.reaction-picker');
    if (!btn || !picker) return;
    let closeTimer;
    btn.addEventListener('mouseleave',    () => { closeTimer = setTimeout(() => picker.classList.remove('is-open'), 300); });
    picker.addEventListener('mouseenter', () => clearTimeout(closeTimer));
    picker.addEventListener('mouseleave', () => { closeTimer = setTimeout(() => picker.classList.remove('is-open'), 200); });
  });

  // Pagination
  document.getElementById('bulletinPaginationNav')?.remove();
  if (totalPages > 1) {
    const nav = document.createElement('div');
    nav.id        = 'bulletinPaginationNav';
    nav.className = 'bulletin-pagination';
    nav.innerHTML = `
      <button class="btn btn--outline btn--sm" onclick="window._bulletinPage(-1)"
        ${_currentPage === 0 ? 'disabled' : ''}>← Prev</button>
      <span class="bulletin-pagination__label">Page ${_currentPage + 1} of ${totalPages}</span>
      <button class="btn btn--outline btn--sm" onclick="window._bulletinPage(1)"
        ${_currentPage >= totalPages - 1 ? 'disabled' : ''}>Next →</button>`;
    listEl.after(nav);
  }

  restoreOpenThreads();
}


// ================================================================
// BUILD POST ROW
// ================================================================
function buildReactionSummary(reactions, fallbackCount) {
  const entries = Object.entries(reactions ?? {}).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  const total   = entries.reduce((a, [, b]) => a + b, 0) || (fallbackCount ?? 0);
  if (!total) return { html: '', total: 0, topEmoji: null };
  const tip      = entries.map(([t, c]) => `${EMOJI[t]} ${c}`).join('  ');
  const topTypes = entries.slice(0, 3).map(([t]) => t);
  const bubbles  = topTypes.map((type, i) =>
    `<span class="reaction-bubble" style="z-index:${3-i};margin-left:${i===0?0:-6}px">${EMOJI[type]}</span>`
  ).join('');
  return {
    html:     `<span class="reaction-summary-wrap" title="${tip}">${bubbles}<span class="reaction-summary-count">${total}</span></span>`,
    total,
    topEmoji: topTypes[0] ?? null,
  };
}

function buildRoleBadge(post, isCPost) {
  if (!isCPost) return `<span class="post-role-badge post-role-badge--official">✓ Official</span>`;
  const role = post.authorId === _currentUid ? _currentUserRole : (post.authorRole ?? 'resident');
  if (role === 'admin')   return `<span class="post-role-badge post-role-badge--admin">Admin</span>`;
  if (role === 'officer') return `<span class="post-role-badge post-role-badge--officer">Officer</span>`;
  return `<span class="post-role-badge post-role-badge--resident">Resident</span>`;
}

function buildPostRow(post) {
  const isCPost = post._type === 'post';
  const meta    = categoryMeta(post.category);
  const time    = relativeTime(post.createdAt);
  const excerpt = esc(post.body?.slice(0, 160) ?? '');
  const isLong  = (post.body?.length ?? 0) > 160;
  const pid     = esc(post.id);
  const ptitle  = esc(post.title ?? '');

  // ── Images & carousel ──────────────────────────────────────────
  const images = post.imageURLs?.length ? post.imageURLs : (post.imageURL ? [post.imageURL] : []);
  const imagesEncoded = encodeURIComponent(JSON.stringify(images));

  const imageSection = images.length ? `
    <div class="post-carousel" id="carousel-${pid}">
      <div class="post-carousel__track" id="carousel-track-${pid}">
        ${images.map((url, i) => `
          <div class="post-carousel__slide"
            onclick="openImageViewer(JSON.parse(decodeURIComponent('${imagesEncoded}')), ${i}, '${ptitle}')">
            <img src="${esc(url)}" alt="Post image ${i + 1}" loading="lazy" />
          </div>`).join('')}
      </div>
      ${images.length > 1 ? `
        <button class="post-carousel__nav post-carousel__nav--prev"
          onclick="event.stopPropagation();carouselGoTo('${pid}', carouselPrev('${pid}',${images.length}))"
          aria-label="Previous image">
          <i data-lucide="chevron-left"></i>
        </button>
        <button class="post-carousel__nav post-carousel__nav--next"
          onclick="event.stopPropagation();carouselGoTo('${pid}', carouselNext('${pid}',${images.length}))"
          aria-label="Next image">
          <i data-lucide="chevron-right"></i>
        </button>
        <div class="post-carousel__dots">
          ${images.map((_, i) => `
            <button class="post-carousel__dot${i === 0 ? ' is-active' : ''}"
              id="carousel-dot-${pid}-${i}"
              onclick="event.stopPropagation();carouselGoTo('${pid}',${i})"
              aria-label="Image ${i + 1}"></button>`).join('')}
        </div>` : ''}
    </div>` : '';

  // ── Decorative bars ────────────────────────────────────────────
  const pinnedBar = post.isPinned
    ? `<div class="post-pin-bar"><i data-lucide="pin"></i> PINNED</div>` : '';
  const urgentBar = post.isUrgent
    ? `<div class="post-urgent-bar"><i data-lucide="alert-circle"></i> URGENT</div>` : '';

  // ── Reaction button state ──────────────────────────────────────
  const myState  = _reactState.get(post.id);
  const summary  = buildReactionSummary(post.reactions, post.likeCount);
  // Button icon: your reaction emoji if reacted, else top reaction emoji, else 🤍
  const btnEmoji = myState
    ? (EMOJI[myState.type] ?? '❤️')
    : (summary.topEmoji ? EMOJI[summary.topEmoji] : '🤍');
  const isReacted = !!myState;

  const pickerBtns = Object.entries(EMOJI).map(([type, em]) => `
    <button class="reaction-picker__btn"
      onclick="handleReaction('${pid}','${type}')" title="${type}">${em}</button>`).join('');

  // ── Action buttons (··· row) ───────────────────────────────────
  const canAdminDel = isCPost && (_currentUserRole === 'admin' ||
    (_currentUserRole === 'officer' && post.authorRole !== 'admin'));
  const isOwn   = isCPost && post.authorId === _currentUid && _currentUserRole === 'resident';
  const isOther = isCPost && post.authorId !== _currentUid;

  const actionBtns = [
    canAdminDel ? `<button class="post-action-icon post-action-icon--danger" onclick="adminDeleteCommunityPost('${pid}')" title="Delete"><i data-lucide="trash-2"></i></button>` : '',
    isOwn       ? `<button class="post-action-icon" onclick="editCommunityPost('${pid}')" title="Edit"><i data-lucide="pencil"></i></button>` : '',
    isOwn       ? `<button class="post-action-icon post-action-icon--danger" onclick="deleteCommunityPost('${pid}')" title="Delete"><i data-lucide="trash-2"></i></button>` : '',
    isOther     ? `<button class="post-action-icon post-action-icon--danger" onclick="reportPost('${pid}','${ptitle}')" title="Report"><i data-lucide="flag"></i></button>` : '',
  ].filter(Boolean).join('');

  const moreSection = actionBtns ? `
    <button class="post-more-btn" onclick="togglePostActions('${pid}')" title="More">···</button>
    <div class="post-action-row" id="post-actions-${pid}">${actionBtns}</div>` : '';

  // ── Article classes ────────────────────────────────────────────
  const articleClass = [
    'post-row',
    isCPost ? `post-row--community post-row--accented ${meta.accentClass}`.trim() : `post-row--accented ${meta.accentClass}`.trim(),
  ].filter(Boolean).join(' ');

  return `
    <article class="${articleClass}"
      data-post-id="${pid}"
      data-parent-col="${isCPost ? 'communityPosts' : 'announcements'}">

      ${pinnedBar}
      ${urgentBar}

      <div class="post-row__tags">
        <span class="tag ${meta.tagClass}"
          onclick="window._filterByCategory('${esc(post.category)}')"
          style="cursor:pointer">${esc(meta.label)}</span>
        <span class="post-row__time">${time}</span>
        ${post.isEdited ? `<span class="post-edited-label">edited</span>` : ''}
      </div>

      <h3 class="post-row__title">${esc(post.title)}</h3>

      ${imageSection}

      <p class="post-row__excerpt">${excerpt}${isLong ? `<span style="color:var(--gray-400)">…</span>` : ''}</p>

      <div class="post-row__footer">

        <div class="post-footer__left">
          <div class="post-author-avatar">
            ${esc((post.authorName ?? 'BC').slice(0, 2).toUpperCase())}
          </div>
          <div class="post-footer__name-wrap">
            <span class="post-row__author">${esc(post.authorName ?? 'BarangayConnect')}</span>
            ${buildRoleBadge(post, isCPost)}
          </div>
        </div>

        <div class="post-footer__right">
          <div class="post-reaction-wrap">
            <button class="post-react-btn${isReacted ? ' is-reacted' : ''}"
              id="like-btn-${pid}"
              onmouseenter="toggleReactionPicker('${pid}')"
              onclick="handleReactionToggle('${pid}')">
              <span id="like-icon-display-${pid}" ${isReacted ? 'style="display:none;"' : ''}>
                <i data-lucide="heart" style="width:15px;height:15px;stroke-width:2;color:var(--gray-400);pointer-events:none;"></i>
              </span>
              <span class="post-react-btn__count" id="like-count-${pid}">
                ${summary.total > 0
                  ? summary.html
                  : `<span style="color:var(--gray-400);font-size:var(--text-xs);font-family:var(--font-display);font-weight:var(--fw-semibold);">Like</span>`}
              </span>
            </button>
            <div class="reaction-picker" id="reaction-picker-${pid}">
              ${pickerBtns}
            </div>
          </div>

           <button class="post-comment-btn" onclick="toggleComments('${pid}')">
            <i data-lucide="message-circle"></i>
            ${post.commentCount ?? 0}
          </button>

          ${moreSection}

        </div>
      </div>

      ${buildCommentThread(post.id, isCPost ? 'communityPosts' : 'announcements')}
    </article>`;
}

function _clearHashPage() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  params.delete('page');
  const newHash = params.toString();
  if (newHash) window.location.hash = newHash;
  else history.replaceState(null, '', window.location.pathname + window.location.search);
}

// ================================================================
// GLOBAL HELPERS
// ================================================================

window.togglePostActions = function (postId) {
  const row = document.getElementById(`post-actions-${postId}`);
  if (!row) return;
  document.querySelectorAll('.post-action-row.is-open').forEach(r => {
    if (r.id !== `post-actions-${postId}`) r.classList.remove('is-open');
  });
  row.classList.toggle('is-open');
};

document.addEventListener('click', e => {
  if (!e.target.closest('.post-more-btn') && !e.target.closest('.post-action-row')) {
    document.querySelectorAll('.post-action-row.is-open').forEach(r => r.classList.remove('is-open'));
  }
  if (!e.target.closest('.post-reaction-wrap')) {
    document.querySelectorAll('.reaction-picker').forEach(p => p.classList.remove('is-open'));
  }
});

window.toggleReactionPicker = function (postId) {
  const picker = document.getElementById(`reaction-picker-${postId}`);
  if (!picker) return;
  document.querySelectorAll('.reaction-picker').forEach(p => {
    if (p.id !== `reaction-picker-${postId}`) p.classList.remove('is-open');
  });
  picker.classList.add('is-open');
};

window.carouselGoTo = function (postId, index) {
  const track = document.getElementById(`carousel-track-${postId}`);
  if (!track) return;
  track.scrollLeft = track.offsetWidth * index;
  document.querySelectorAll(`[id^="carousel-dot-${postId}-"]`).forEach((dot, i) => {
    dot.classList.toggle('is-active', i === index);
  });
};

window.carouselPrev = function (postId, total) {
  const track = document.getElementById(`carousel-track-${postId}`);
  if (!track) return 0;
  const current = track.offsetWidth > 0 ? Math.round(track.scrollLeft / track.offsetWidth) : 0;
  return (current - 1 + total) % total;
};

window.carouselNext = function (postId, total) {
  const track = document.getElementById(`carousel-track-${postId}`);
  if (!track) return 0;
  const current = track.offsetWidth > 0 ? Math.round(track.scrollLeft / track.offsetWidth) : 0;
  return (current + 1) % total;
};

function renderSkeleton(listEl) {
  listEl.innerHTML = [1, 2, 3].map(() => `
    <article class="post-row post-row--accented" style="border-left-color:var(--gray-100);">
      <div class="post-row__tags">
        <span class="skeleton skeleton--tag"></span>
        <span class="skeleton skeleton--time"></span>
      </div>
      <div class="skeleton skeleton--title" style="margin-bottom:var(--space-sm);"></div>
      <div class="skeleton skeleton--body" style="margin-bottom:4px;"></div>
      <div class="skeleton skeleton--body-sm"></div>
    </article>`).join('');
}

async function loadReactionState(postIds) {
  if (!_currentUid || !BARANGAY_ID || !postIds.length) return;
  postIds = postIds.filter(id => !_reactState.has(id));
  if (!postIds.length) return;
  const { getDoc, doc: _d } =
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  await Promise.all(postIds.map(async postId => {
    try {
      const isCPost = !!_allCommunityPosts.find(p => p.id === postId);
      const col     = isCPost ? 'communityPosts' : 'announcements';
      const snap    = await getDoc(_d(db, 'barangays', BARANGAY_ID, col, postId, 'likes', _currentUid));
      _reactState.set(postId, snap.exists() ? { type: snap.data()?.type ?? 'heart' } : null);
      _applyReactUI(postId);
    } catch { /* non-fatal */ }
  }));
}

function _applyReactUI(postId) {
  const btn       = document.getElementById(`like-btn-${postId}`);
  const iconSpan  = document.getElementById(`like-icon-display-${postId}`);
  const countSpan = document.getElementById(`like-count-${postId}`);
  if (!btn) return;
  const state = _reactState.get(postId);
  btn.classList.toggle('is-reacted', !!state);
  const _post = [..._allPosts, ..._allCommunityPosts].find(p => p.id === postId);
  const _s    = _post ? buildReactionSummary(_post.reactions, _post.likeCount) : { html: '', total: 0 };
  if (state) {
    if (iconSpan) iconSpan.style.display = 'none';
    if (countSpan) countSpan.innerHTML = _s.total > 0
      ? _s.html
      : `<span style="color:var(--red);font-size:var(--text-xs);font-family:var(--font-display);font-weight:var(--fw-semibold);">${EMOJI[state.type] ?? '❤️'} 1</span>`;
  } else {
    if (iconSpan) {
      iconSpan.style.display = '';
      iconSpan.innerHTML = '<i data-lucide="heart" style="width:15px;height:15px;stroke-width:2;color:var(--gray-400);pointer-events:none;"></i>';
      lucide.createIcons({ el: iconSpan });
    }
    if (countSpan) countSpan.innerHTML = _s.total > 0
      ? _s.html
      : '<span style="color:var(--gray-400);font-size:var(--text-xs);font-family:var(--font-display);font-weight:var(--fw-semibold);">Like</span>';
  }
}

window.handleReactionToggle = function (postId) {
  handleReaction(postId, (_reactState.get(postId)?.type) ?? 'heart');
};

window.handleReaction = async function (postId, type) {
  if (!_currentUid || !BARANGAY_ID || _reactLock.has(postId)) return;
  _reactLock.add(postId);

  const btn    = document.getElementById(`like-btn-${postId}`);
  const picker = document.getElementById(`reaction-picker-${postId}`);
  if (btn)    btn.style.pointerEvents = 'none';
  if (picker) { picker.classList.remove('is-open'); picker.querySelectorAll('button').forEach(b => b.disabled = true); }

  const prevState  = _reactState.get(postId) ?? null;
  const prevType   = prevState?.type ?? null;
  const isSameType = prevType === type;

  try {
    const { doc: _d, setDoc, deleteDoc, updateDoc, increment, serverTimestamp: _ts, getDoc } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const isCPost = !!_allCommunityPosts.find(p => p.id === postId);
    const col     = isCPost ? 'communityPosts' : 'announcements';
    const postRef = _d(db, 'barangays', BARANGAY_ID, col, postId);
    const likeRef = _d(db, 'barangays', BARANGAY_ID, col, postId, 'likes', _currentUid);

    if (isSameType) {
      await deleteDoc(likeRef);
      await updateDoc(postRef, { [`reactions.${type}`]: increment(-1) });
      _reactState.set(postId, null);
    } else if (prevType) {
      await setDoc(likeRef, { type, userId: _currentUid, userName: _currentUserName, createdAt: _ts() }, { merge: true });
      await updateDoc(postRef, { [`reactions.${prevType}`]: increment(-1), [`reactions.${type}`]: increment(1) });
      _reactState.set(postId, { type });
    } else {
      await setDoc(likeRef, { type, userId: _currentUid, userName: _currentUserName, createdAt: _ts() }, { merge: true });
      await updateDoc(postRef, { [`reactions.${type}`]: increment(1) });
      _reactState.set(postId, { type });
    }

    const confirm = await getDoc(likeRef);
    _reactState.set(postId, confirm.exists() ? { type: confirm.data()?.type ?? type } : null);
  } catch (err) {
    console.error('[reaction]', err);
    _reactState.set(postId, prevState);
  } finally {
    _applyReactUI(postId);
    _reactLock.delete(postId);
    const b = document.getElementById(`like-btn-${postId}`);
    const p = document.getElementById(`reaction-picker-${postId}`);
    if (b) b.style.pointerEvents = '';
    if (p) p.querySelectorAll('button').forEach(b => b.disabled = false);
  }
};

function showToast(message, type = 'success') {
  let c = document.getElementById('bulletinToastContainer');
  if (!c) {
    c = document.createElement('div');
    c.id = 'bulletinToastContainer';
    c.className = 'toast-container';
    document.body.appendChild(c);
  }
  const t = document.createElement('div');
  t.className   = `toast toast--${type}`;
  t.textContent = message;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

window.editCommunityPost = async function (postId) {
  const { getDoc: _gd, doc: _d } =
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  const snap = await _gd(_d(db, 'barangays', BARANGAY_ID, 'communityPosts', postId));
  if (!snap.exists()) return;
  const data = snap.data();
  document.getElementById('newPostTitle').value    = data.title ?? '';
  document.getElementById('newPostBody').value     = data.body ?? '';
  document.getElementById('newPostCategory').value = data.category ?? 'general';
  document.getElementById('newPostCharCount').textContent = `${(data.body ?? '').length} / 500`;
  const imgSection = document.getElementById('newPostImages')?.closest('.form-group');
  if (imgSection) imgSection.style.display = 'none';
  const imgPreviews = document.getElementById('newPostImagePreviews');
  if (imgPreviews) imgPreviews.innerHTML = '';
  const btn = document.getElementById('newPostSubmitBtn');
  btn.dataset.editId = postId;
  btn.innerHTML = '<i data-lucide="save"></i> Update Post';
  lucide.createIcons({ el: btn });
  const settings = await getModerationSettings?.() ?? {};
  const banner   = document.getElementById('postWarningBanner');
  if (banner) { banner.textContent = settings.postWarningText || ''; banner.style.display = settings.postWarningText ? 'block' : 'none'; }
  openModal('newPostModal');
};

window.reportPost = function (postId, title) {
  const modal = document.getElementById('reportPostModal');
  if (!modal) return;
  modal.dataset.postId    = postId;
  modal.dataset.postTitle = title;
  openModal('reportPostModal');
};

window.submitReport = async function () {
  if (!_currentUid || !BARANGAY_ID) return;
  try {
    const { getDoc: _gd, doc: _d, collection: _col, query: _q, where: _w, getDocs } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const settingsSnap = await _gd(_d(db, 'barangays', BARANGAY_ID, 'meta', 'settings'));
    const dailyLimit   = settingsSnap.exists() ? (settingsSnap.data().dailyReportLimit ?? 3) : 3;
    if (_currentUserRole !== 'admin' && _currentUserRole !== 'officer') {
      const today = new Date().toISOString().slice(0, 10);
      const start = new Date(today + 'T00:00:00');
      const end   = new Date(today + 'T23:59:59');
      const rSnap = await getDocs(_q(_col(db, 'barangays', BARANGAY_ID, 'reportedPosts'), _w('reportedBy', '==', _currentUid)));
      const count = rSnap.docs.filter(d => { const t = d.data().createdAt?.toDate?.() ?? null; return t ? t >= start && t <= end : true; }).length;
      if (count >= dailyLimit) { alert(`You've reached the report limit of ${dailyLimit} per day.`); return; }
    }
  } catch { /* non-fatal */ }

  const modal    = document.getElementById('reportPostModal');
  const postId   = modal?.dataset.postId;
  const title    = modal?.dataset.postTitle;
  const category = document.getElementById('reportCategory')?.value;
  const desc     = document.getElementById('reportDescription')?.value.trim() || '';
  if (!postId) return;

  const { getDocs: _gs, collection: _c2, query: _q2, where: _w2 } =
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  const existing = await _gs(_q2(_c2(db, 'barangays', BARANGAY_ID, 'reportedPosts'), _w2('reportedBy', '==', _currentUid), _w2('postId', '==', postId)));
  if (!existing.empty) { closeModal('reportPostModal'); showToast('You already reported this post.', 'error'); return; }

  const submitBtn = modal.querySelector('.btn--red');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }
  try {
    const { addDoc: _add, collection: _c3, serverTimestamp: _ts } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await _add(_c3(db, 'barangays', BARANGAY_ID, 'reportedPosts'), {
      postId, postTitle: title, reportedBy: _currentUid, reportedByName: _currentUserName,
      category, reason: desc || category, status: 'pending', createdAt: _ts(),
    });
    closeModal('reportPostModal');
    showToast('Report submitted. Thank you.');
  } catch (err) { console.error('[report]', err); }
  finally { if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Report'; } }
};

window.adminDeleteCommunityPost = async function (postId) {
  if (_currentUserRole !== 'admin' && _currentUserRole !== 'officer') return;
  if (!confirm('Delete this community post as admin? This cannot be undone.')) return;
  try {
    const { doc: _d, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await deleteDoc(_d(db, 'barangays', BARANGAY_ID, 'communityPosts', postId));
  } catch (err) { console.error('[admin delete]', err); }
};

window.deleteCommunityPost = async function (postId) {
  if (!_currentUid || !BARANGAY_ID) return;
  if (!confirm('Delete your post? This cannot be undone.')) return;
  try {
    const { doc: _d, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await deleteDoc(_d(db, 'barangays', BARANGAY_ID, 'communityPosts', postId));
  } catch (err) { console.error('[delete post]', err); }
};

window._bulletinPage = function (dir) {
  _currentPage += dir;
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (_currentPage === 0) {
    _clearHashPage();
  } else {
    params.set('page', _currentPage);
    window.location.hash = params.toString();
  }
  renderBulletin(document.getElementById('bulletinList'));
  document.getElementById('bulletinList')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window._filterByCategory = function (category) {
  _activeFilter = category;
  _currentPage  = 0;
  _clearHashPage();
  document.querySelectorAll('#bulletinCategoryFilters .btn--filter').forEach(b => {
    b.classList.toggle('is-active', b.textContent.trim().toLowerCase() === category);
  });
  renderBulletin(document.getElementById('bulletinList'));
};
