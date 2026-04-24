/* ================================================
   gallery.js — BarangayConnect
   Featured Gallery tab panel. Renders a curated
   "best-of" view of the bulletin collection using
   the isFeatured flag as a reflection model.

   DATA MODEL:
     Source of truth: communityPosts + announcements collections.
     Featured flag:   isFeatured: true  (boolean)
     Sort key:        featuredAt: Timestamp (set when starred)
     Hero flag:       isHeroFeatured: true (only one at a time)
     Cover image:     featuredCoverIndex: number (index into imageURLs)

   WHAT IS IN HERE:
     · initGallery — bootstrap, auth resolution, Firestore subscriptions
     · renderGallery — hero card, masonry/grid, category filter, empty state
     · buildHeroCard — full-width featured hero card HTML
     · buildGalleryCard — individual masonry/grid card HTML
     · renderSkeleton — shimmering placeholder cards while loading
     · openGalleryViewer — opens image-viewer with "View Post" link
     · showCoverSelectModal — cover thumbnail picker for multi-image posts
       (called from bulletin.js toggleFeatured when images.length > 1)
     · handleDeepLink — opens a specific card via ?id=post_id URL param
     · Category filter, view toggle (masonry vs. grid)

   WHAT IS NOT IN HERE:
     · toggleFeatured write logic     → bulletin.js (window.toggleFeatured)
     · Image viewer modal             → image-viewer.js
     · Confirm modal                  → confirm-modal.js
     · Firebase config and db         → firebase-config.js
     · Firestore path helpers         → db-paths.js
     · Gallery styles                 → gallery.css

   REQUIRED IMPORTS:
     · ../../core/firebase-config.js (db, auth — dynamic)
     · ../../core/db-paths.js        (barangayId as toBid, userIndexDoc — dynamic)
     · ../../shared/image-viewer.js  (openImageViewer, _injectImageViewer)
     · ../../shared/confirm-modal.js (showConfirm)
     · firebase-firestore.js@10.12.0 (collection, query, where, orderBy,
                                      onSnapshot, getDoc, doc, updateDoc,
                                      serverTimestamp — dynamic)

   QUICK REFERENCE:
     Bootstrap            → export async function initGallery()
     Cover picker         → window.showCoverSelectModal(post, col)
     Open viewer          → (internal) openGalleryViewer(post)
     Category filter      → (internal) applyGalleryFilter(category)
     View toggle          → (internal) setGalleryView('masonry'|'grid')
================================================ */


// ================================================
// IMPORTS
// ================================================

import { db }                                          from '../../core/firebase-config.js';
import { openImageViewer as _openViewer, _injectImageViewer } from '../../shared/image-viewer.js';
import { showConfirm }                                 from '/js/shared/confirm-modal.js';

import {
  collection, query, where, orderBy, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


// ================================================
// MODULE STATE
// ================================================

let BARANGAY_ID      = null;
let _currentUid      = null;
let _currentUserRole = 'resident';

let _allFeatured     = [];   // merged + sorted featured posts
let _activeCategory  = 'all';
let _sourceFilter    = 'all';   // 'all' | 'official' | 'community'
let _sortMode        = 'newest'; // 'newest' | 'oldest' | 'popular' | 'commented'
let _viewMode        = 'masonry'; // 'masonry' | 'grid'
let _initialized     = false;


// ================================================
// CONSTANTS
// ================================================

/* Same category map as bulletin.js for consistent tag display */
const CATEGORY_MAP = {
  announcements:  { tagClass: 'tag--blue',   label: 'Announcement'   },
  health:         { tagClass: 'tag--green',  label: 'Health'         },
  infrastructure: { tagClass: 'tag--amber',  label: 'Infrastructure' },
  safety:         { tagClass: 'tag--red',    label: 'Safety'         },
  events:         { tagClass: 'tag--purple', label: 'Events'         },
  general:        { tagClass: 'tag--teal',   label: 'General'        },
};

const categoryMeta = cat => CATEGORY_MAP[cat] ?? CATEGORY_MAP.general;

/* Categories that have at least one featured post — used to build filter pills */
const KNOWN_CATEGORIES = ['general', 'announcements', 'health', 'infrastructure', 'safety', 'events'];


// ================================================
// UTILITIES
// ================================================

/* HTML-escapes a value for safe innerHTML interpolation */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

/* Returns the cover image URL for a featured post.
   Uses featuredCoverIndex if set; falls back to index 0. */
function getCoverUrl(post) {
  const images = post.imageURLs?.length
    ? post.imageURLs
    : (post.imageURL ? [post.imageURL] : []);
  if (!images.length) return null;
  const idx = typeof post.featuredCoverIndex === 'number'
    ? Math.min(post.featuredCoverIndex, images.length - 1)
    : 0;
  return images[idx];
}

/* Returns all image URLs for a post */
function getImages(post) {
  return post.imageURLs?.length
    ? post.imageURLs
    : (post.imageURL ? [post.imageURL] : []);
}


// ================================================
// BOOTSTRAP
// ================================================

/*
   Resolves the authenticated user's barangay and role, then
   subscribes to featured posts from both collections.
   Only runs once even if the gallery tab is opened multiple times.
*/
export async function initGallery() {
  /* Only initialize once per page load */
  if (_initialized) {
    _renderGallery();
    return;
  }

  const heroSlot = document.getElementById('galleryHeroSlot');
  const gridEl   = document.getElementById('galleryGrid');
  if (!heroSlot || !gridEl) return;

  _injectImageViewer();
  _renderSkeleton(heroSlot, gridEl);

  try {
    const { getDoc, doc: _docFn } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const { auth }                            = await import('../../core/firebase-config.js');
    const { userIndexDoc, barangayId: toBid } = await import('../../core/db-paths.js');

    await new Promise(resolve => {
      const unsub = auth.onAuthStateChanged(user => { unsub(); resolve(user); });
    }).then(async user => {
      if (!user) return;
      _currentUid = user.uid;
      const snap  = await getDoc(userIndexDoc(user.uid));
      if (!snap.exists()) return;
      const data       = snap.data();
      BARANGAY_ID      = toBid(data.barangay);
      _currentUserRole = data.role || 'resident';
    });

  } catch (err) {
    console.error('[gallery] could not resolve barangay:', err);
    return;
  }

  if (!BARANGAY_ID) return;

  /* ── Subscribe: featured announcements ── */
  const announcementsQ = query(
    collection(db, 'barangays', BARANGAY_ID, 'announcements'),
    where('isFeatured', '==', true),
    orderBy('featuredAt', 'desc'),
  );

  /* ── Subscribe: featured community posts ── */
  const communityQ = query(
    collection(db, 'barangays', BARANGAY_ID, 'communityPosts'),
    where('isFeatured', '==', true),
    where('status', '==', 'published'),
    orderBy('featuredAt', 'desc'),
  );

  let _announcementsFeatured = [];
  let _communityFeatured     = [];

  /* Merge both streams into _allFeatured on every update */
  function _mergeAndRender() {
    /* Merge both collections */
    const merged = [
      ..._announcementsFeatured.map(p => ({ ...p, _col: 'announcements' })),
      ..._communityFeatured.map(p => ({ ...p, _col: 'communityPosts' })),
    ];

    /* Sort hero first, then apply _sortMode */
    _allFeatured = merged.sort((a, b) => {
      if (a.isHeroFeatured && !b.isHeroFeatured) return -1;
      if (!a.isHeroFeatured && b.isHeroFeatured) return  1;

      if (_sortMode === 'oldest') {
        const ta = a.featuredAt?.toDate?.() ?? new Date(0);
        const tb = b.featuredAt?.toDate?.() ?? new Date(0);
        return ta - tb;
      }
      if (_sortMode === 'popular') {
        const ra = Object.values(a.reactions ?? {}).reduce((s, v) => s + v, 0) + (a.likeCount ?? 0);
        const rb = Object.values(b.reactions ?? {}).reduce((s, v) => s + v, 0) + (b.likeCount ?? 0);
        return rb - ra;
      }
      if (_sortMode === 'commented') {
        return (b.commentCount ?? 0) - (a.commentCount ?? 0);
      }
      /* default: newest featuredAt */
      const ta = a.featuredAt?.toDate?.() ?? new Date(0);
      const tb = b.featuredAt?.toDate?.() ?? new Date(0);
      return tb - ta;
    });

    _renderGallery();
    _buildCategoryFilters();
  }

  onSnapshot(announcementsQ, snap => {
    _announcementsFeatured = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _mergeAndRender();
  });

  onSnapshot(communityQ, snap => {
    _communityFeatured = snap.docs.map(d => ({ id: d.id, _type: 'post', ...d.data() }));
    _mergeAndRender();
  });

  /* Wire view-toggle buttons */
  document.querySelectorAll('.gallery-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.gallery-view-btn')
        .forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _viewMode = btn.dataset.view ?? 'masonry';
      _renderGallery();
    });
  });

  /* Wire source sub-filter */
  document.querySelectorAll('.gallery-source-seg__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.gallery-source-seg__btn')
        .forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _sourceFilter = btn.dataset.source ?? 'all';
      _renderGallery();
    });
  });

  /* Wire sort sub-filter */
  document.querySelectorAll('.gallery-sort-seg__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.gallery-sort-seg__btn')
        .forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _sortMode = btn.dataset.sort ?? 'newest';
      _mergeAndRender();
    });
  });

  /* ── Subscribe: pending feature requests (admin / officer only) ── */
  if (_currentUserRole === 'admin' || _currentUserRole === 'officer') {
    let _pendingAnnouncements = [];
    let _pendingCommunity     = [];

    function _mergePending() {
      _renderGalleryPendingQueue([
        ..._pendingAnnouncements.map(p => ({ ...p, _col: 'announcements' })),
        ..._pendingCommunity.map(p => ({ ...p, _col: 'communityPosts' })),
      ]);
    }

    onSnapshot(
      query(
        collection(db, 'barangays', BARANGAY_ID, 'announcements'),
        where('pendingFeatured', '==', true),
      ),
      snap => {
        _pendingAnnouncements = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _mergePending();
      }
    );

    onSnapshot(
      query(
        collection(db, 'barangays', BARANGAY_ID, 'communityPosts'),
        where('pendingFeatured', '==', true),
        where('status', '==', 'published'),
      ),
      snap => {
        _pendingCommunity = snap.docs.map(d => ({ id: d.id, _type: 'post', ...d.data() }));
        _mergePending();
      }
    );
  }

  /* Handle deep link ?id=post_id on first load */
  _handleDeepLink();

  _initialized = true;
}


// ================================================
// RENDER — Gallery
// ================================================

/*
   Applies the active category filter, separates the hero post,
   then renders the hero slot and the masonry/grid below.
*/
function _renderGallery() {
  const heroSlot = document.getElementById('galleryHeroSlot');
  const gridEl   = document.getElementById('galleryGrid');
  if (!heroSlot || !gridEl) return;

  /* Apply source filter */
  const sourceFiltered = _allFeatured.filter(p => {
    if (_sourceFilter === 'official'  && p._col !== 'announcements') return false;
    if (_sourceFilter === 'community' && p._col !== 'communityPosts') return false;
    return true;
  });

  /* Apply category filter */
  const filtered = _activeCategory === 'all'
    ? sourceFiltered
    : sourceFiltered.filter(p => p.category === _activeCategory);

  /* Empty state */
  if (!filtered.length) {
    heroSlot.innerHTML = '';
    gridEl.innerHTML   = `
      <div class="gallery-empty">
        <div class="gallery-empty__icon"><i data-lucide="star"></i></div>
        <p class="gallery-empty__title">No featured highlights to show yet.</p>
        <p class="gallery-empty__sub">
          ${_currentUserRole === 'admin' || _currentUserRole === 'officer'
            ? 'Use the ··· menu on any bulletin post to add it here.'
            : 'Check back soon for curated highlights from the barangay.'}
        </p>
      </div>`;
    lucide.createIcons({ el: gridEl });
    return;
  }

  /* Separate hero from the rest */
  const heroPost = filtered.find(p => p.isHeroFeatured) ?? null;
  const gridPosts = heroPost
    ? filtered.filter(p => p.id !== heroPost.id)
    : filtered;

  /* ── Hero card ── */
  if (heroPost) {
    heroSlot.innerHTML = _buildHeroCard(heroPost);
    lucide.createIcons({ el: heroSlot });
  } else {
    heroSlot.innerHTML = '';
  }

  /* ── Masonry / Grid ── */
  if (!gridPosts.length) {
    gridEl.innerHTML = '';
    return;
  }

  gridEl.className = _viewMode === 'grid' ? 'gallery-grid-standard' : 'gallery-masonry';
  gridEl.innerHTML = gridPosts.map(post => _buildGalleryCard(post)).join('');
  lucide.createIcons({ el: gridEl });
}


// ================================================
// BUILD — Hero Card
// ================================================

/* Returns the full HTML string for the pinned hero card */
function _buildHeroCard(post) {
  const coverUrl = getCoverUrl(post);
  if (!coverUrl) return '';

  const meta    = categoryMeta(post.category);
  const pid     = esc(post.id);
  const ptitle  = esc(post.title ?? '');
  const col     = esc(post._col ?? 'communityPosts');

  /* "View Post" link navigates to bulletin tab with scroll highlight */
  const viewPostHref = `community.html?scrollTo=${pid}&tab=bulletin`;

  return `
    <div class="gallery-hero"
      id="gallery-hero-${pid}"
      onclick="_galleryOpenViewer('${pid}')">

      <span class="gallery-hero__badge">
        <i data-lucide="star"></i> Featured Highlight
      </span>

      ${(_currentUserRole === 'admin' || _currentUserRole === 'officer') ? `
      <button class="gallery-hero__demote-btn"
        onclick="event.stopPropagation();_removeGalleryHero('${pid}')"
        title="Remove from hero slot">
        <i data-lucide="crown"></i> Hero
      </button>` : ''}

      <img
        src="${esc(coverUrl)}"
        alt="${ptitle}"
        class="gallery-hero__img"
        loading="eager" />

      <div class="gallery-hero__overlay">
        <span class="gallery-hero__eyebrow tag ${meta.tagClass}"
          style="align-self:flex-start;margin-bottom:var(--space-xs);">
          ${esc(meta.label)}
        </span>
        <h2 class="gallery-hero__title">${ptitle}</h2>
        <a class="gallery-hero__view-link"
          href="${viewPostHref}"
          onclick="event.stopPropagation()"
          title="View original post">
          <i data-lucide="arrow-up-right"></i> View Post
        </a>
      </div>
    </div>`;
}


// ================================================
// BUILD — Gallery Card
// ================================================

/* Returns the HTML for a single masonry or grid card */
function _buildGalleryCard(post) {
  const coverUrl = getCoverUrl(post);
  const meta     = categoryMeta(post.category);
  const pid      = esc(post.id);
  const ptitle   = esc(post.title ?? '');

  /* Placeholder for image-less posts — show a tinted color block */
  if (!coverUrl) {
    return `
      <div class="gallery-card"
        onclick="_galleryOpenViewer('${pid}')"
        style="min-height:120px;display:flex;align-items:center;justify-content:center;
          background:var(--muted-bg);">
        <span class="tag ${meta.tagClass}" style="pointer-events:none;">
          ${esc(meta.label)}
        </span>
        ${(_currentUserRole === 'admin' || _currentUserRole === 'officer') ? `
        <div class="gallery-card__admin-strip" style="position:absolute;">
          <button class="gallery-card__admin-btn"
            onclick="event.stopPropagation();_setGalleryHero('${pid}')"
            title="Set as hero highlight">
            <i data-lucide="crown"></i>
          </button>
        </div>` : ''}
      </div>`;
  }

  return `
    <div class="gallery-card" onclick="_galleryOpenViewer('${pid}')">
      <div class="gallery-card__img-wrap">
        <img
          src="${esc(coverUrl)}"
          alt="${ptitle}"
          class="gallery-card__img"
          loading="lazy" />
        <div class="gallery-card__overlay">
          <div class="gallery-card__meta">
            <span class="tag ${meta.tagClass}"
              style="align-self:flex-start;font-size:var(--text-2xs);">
              ${esc(meta.label)}
            </span>
            <p class="gallery-card__title">${ptitle}</p>
            <p class="gallery-card__byline">
              <span class="gallery-card__byline-author">
                <i data-lucide="user" style="width:9px;height:9px;"></i>
                ${esc(post.authorName ?? 'BarangayConnect')}
              </span>
              ${post.featuredByName ? `<span class="gallery-card__byline-sep">·</span>
              <span class="gallery-card__byline-feat">
                <i data-lucide="star" style="width:9px;height:9px;fill:var(--orange);color:var(--orange);"></i>
                ${esc(post.featuredByName)}
              </span>` : ''}
            </p>
          </div>
        </div>
        ${(_currentUserRole === 'admin' || _currentUserRole === 'officer') ? `
        <div class="gallery-card__admin-strip">
          <button class="gallery-card__admin-btn"
            onclick="event.stopPropagation();_setGalleryHero('${pid}')"
            title="Set as hero highlight">
            <i data-lucide="crown"></i>
          </button>
        </div>` : ''}
      </div>
    </div>`;
}


// ================================================
// OPEN VIEWER
// ================================================

/*
   Opens the shared image-viewer modal for a gallery post.
   Appends a "View Post" button to the viewer's accent bar.
*/
window._galleryOpenViewer = function (postId) {
  const post = _allFeatured.find(p => p.id === postId);
  if (!post) return;

  const images   = getImages(post);
  const coverIdx = typeof post.featuredCoverIndex === 'number'
    ? Math.min(post.featuredCoverIndex, images.length - 1)
    : 0;

  /* Open at cover index; fall back to 0 if no images */
  _openViewer(images.length ? images : [''], coverIdx, post.title ?? '');

  /* Inject "View Post" link into the viewer accent bar */
  requestAnimationFrame(() => {
    const accent = document.querySelector('#imgViewerOverlay .img-viewer__accent');
    if (!accent) return;

    /* Remove any previously injected gallery elements */
    accent.querySelectorAll('.gallery-viewer-link, .gallery-viewer-meta').forEach(el => el.remove());

    /* Author + featured-by chip */
    const meta = document.createElement('span');
    meta.className = 'gallery-viewer-meta';
    meta.innerHTML = `
      <i data-lucide="user" style="width:11px;height:11px;"></i>
      ${esc(post.authorName ?? 'BarangayConnect')}
      ${post.featuredByName
        ? `<span style="opacity:.5;margin:0 3px;">·</span>
           <i data-lucide="star" style="width:10px;height:10px;fill:var(--orange);color:var(--orange);"></i>
           ${esc(post.featuredByName)}`
        : ''}`;
    accent.appendChild(meta);
    lucide.createIcons({ el: meta });

    const href = `community.html?scrollTo=${encodeURIComponent(postId)}&tab=bulletin`;
    const link = document.createElement('a');
    link.className = 'gallery-viewer-link';
    link.href      = href;
    link.innerHTML = `<i data-lucide="arrow-up-right"></i> View Post`;
    accent.appendChild(link);
    lucide.createIcons({ el: link });

    /* Also update the deep-link URL so this item is shareable */
    const url = new URL(window.location.href);
    url.searchParams.set('id', postId);
    history.replaceState(null, '', url.toString());
  });
};


// ================================================
// DEEP LINK — ?id=post_id
// ================================================

/*
   On gallery tab activation, checks URL for ?id=post_id
   and opens the viewer for that post if it exists.
*/
function _handleDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const id     = params.get('id');
  if (!id) return;

  /* Wait for data to load before attempting to open */
  let attempts = 0;
  const MAX    = 12;

  (function tryOpen() {
    const post = _allFeatured.find(p => p.id === id);
    if (post) {
      window._galleryOpenViewer(id);
    } else if (attempts++ < MAX) {
      setTimeout(tryOpen, 300);
    }
  })();
}

/* Clear the ?id= param when the viewer is closed */
document.addEventListener('click', e => {
  if (e.target?.id === 'imgViewerClose' ||
      e.target?.closest('#imgViewerClose') ||
      e.target?.id === 'imgViewerOverlay') {
    const url = new URL(window.location.href);
    url.searchParams.delete('id');
    history.replaceState(null, '', url.toString());
  }
});


// ================================================
// CATEGORY FILTERS
// ================================================

/*
   Dynamically builds filter pills from categories found
   in the current featured posts set.
*/
function _buildCategoryFilters() {
  const container = document.getElementById('galleryCategoryFilters');
  if (!container) return;

  /* Always show all known categories regardless of whether posts exist */
  const pills = [
    `<button class="btn btn--filter${_activeCategory === 'all' ? ' is-active' : ''}"
      data-gallery-filter="all">All</button>`,
    ...KNOWN_CATEGORIES.map(cat => {
      const m = categoryMeta(cat);
      return `<button class="btn btn--filter${_activeCategory === cat ? ' is-active' : ''}"
        data-gallery-filter="${cat}">${esc(m.label)}</button>`;
    }),
  ].join('');

  container.innerHTML = pills;

  /* Wire click handlers */
  container.querySelectorAll('[data-gallery-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('[data-gallery-filter]')
        .forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _activeCategory = btn.dataset.galleryFilter ?? 'all';
      _renderGallery();
    });
  });
}

// ================================================
// PENDING FEATURE QUEUE
// ================================================

/*
   Renders the admin-only pending approval strip above the hero slot.
   Called on every snapshot update from both pending subscriptions.
   Admins see Approve / Reject buttons. Officers see "Awaiting admin".
*/
function _renderGalleryPendingQueue(pendingPosts) {
  const slot = document.getElementById('galleryPendingSlot');
  if (!slot) return;

  if (!pendingPosts.length) {
    slot.innerHTML = '';
    return;
  }

  const canApprove = _currentUserRole === 'admin';

  slot.innerHTML = `
    <div class="gallery-pending-queue">
      <div class="gallery-pending-queue__header">
        <i data-lucide="clock"></i>
        <span>Pending Feature Requests — ${pendingPosts.length} awaiting approval</span>
      </div>
      <div class="gallery-pending-queue__list">
        ${pendingPosts.map(post => {
          const meta = categoryMeta(post.category);
          const pid  = esc(post.id);
          const col  = esc(post._col);
          return `
            <div class="gallery-pending-item">
              <div class="gallery-pending-item__info">
                <span class="tag ${meta.tagClass}"
                  style="font-size:var(--text-2xs);flex-shrink:0;">
                  ${esc(meta.label)}
                </span>
                <p class="gallery-pending-item__title">${esc(post.title ?? '')}</p>
                <p class="gallery-pending-item__by">
                  Requested by ${esc(post.featuredByName ?? 'Officer')}
                </p>
              </div>
              <div class="gallery-pending-item__actions">
                ${canApprove ? `
                  <button class="btn btn--green btn--sm"
                    onclick="_approvePending('${pid}','${col}')">
                    <i data-lucide="check"></i> Approve
                  </button>
                  <button class="btn btn--outline btn--sm"
                    onclick="_rejectPending('${pid}','${col}')">
                    Reject
                  </button>` : `
                  <span class="gallery-pending-item__waiting">Awaiting admin</span>`}
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;
  lucide.createIcons({ el: slot });
}

/* Approves a pending feature request — admin only */
window._approvePending = async function (postId, col) {
  if (_currentUserRole !== 'admin') return;

  const ok = await showConfirm({
    title:   'Approve Feature Request?',
    body:    'This post will be added to the Featured Gallery.',
    confirm: 'Approve',
    cancel:  'Go Back',
    variant: 'confirm',
  });
  if (!ok) return;

  try {
    const { doc: _d, updateDoc, serverTimestamp: _ts, deleteField } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await updateDoc(_d(db, 'barangays', BARANGAY_ID, col, postId), {
      isFeatured:      true,
      featuredAt:      _ts(),
      pendingFeatured: deleteField(),
    });
  } catch (err) { console.error('[approvePending]', err); }
};

/* Rejects and clears a pending feature request — admin only */
window._rejectPending = async function (postId, col) {
  if (_currentUserRole !== 'admin') return;

  const ok = await showConfirm({
    title:   'Reject Feature Request?',
    body:    "The officer's request to feature this post will be dismissed.",
    confirm: 'Reject',
    cancel:  'Go Back',
    variant: 'warning',
  });
  if (!ok) return;

  try {
    const { doc: _d, updateDoc, deleteField } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await updateDoc(_d(db, 'barangays', BARANGAY_ID, col, postId), {
      pendingFeatured: deleteField(),
      featuredBy:      deleteField(),
      featuredByName:  deleteField(),
    });
  } catch (err) { console.error('[rejectPending]', err); }
};


// ================================================
// HERO PROMOTION
// ================================================

/*
   Promotes a featured post to the hero slot.
   Automatically demotes any existing hero first (single-hero rule).
*/
window._setGalleryHero = async function (postId) {
  if (_currentUserRole !== 'admin' && _currentUserRole !== 'officer') return;

  const post = _allFeatured.find(p => p.id === postId);
  if (!post) return;

  const ok = await showConfirm({
    title:   'Set as Hero Highlight?',
    body:    'This post will be pinned as the full-width hero card at the top of the gallery. The current hero (if any) will move back to the grid.',
    confirm: 'Set as Hero',
    cancel:  'Go Back',
    variant: 'confirm',
  });
  if (!ok) return;

  try {
    const { doc: _d, updateDoc, deleteField } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

    /* Demote existing hero(es) first */
    const existing = _allFeatured.filter(p => p.isHeroFeatured && p.id !== postId);
    await Promise.all(
      existing.map(h =>
        updateDoc(_d(db, 'barangays', BARANGAY_ID, h._col, h.id), { isHeroFeatured: deleteField() })
      )
    );

    /* Promote the new hero */
    await updateDoc(_d(db, 'barangays', BARANGAY_ID, post._col, postId), { isHeroFeatured: true });
  } catch (err) { console.error('[setGalleryHero]', err); }
};

/* Removes hero status and moves the post back to the regular grid */
window._removeGalleryHero = async function (postId) {
  if (_currentUserRole !== 'admin' && _currentUserRole !== 'officer') return;

  const post = _allFeatured.find(p => p.id === postId);
  if (!post) return;

  const ok = await showConfirm({
    title:   'Remove Hero Status?',
    body:    'This post will move back to the regular gallery grid.',
    confirm: 'Remove',
    cancel:  'Go Back',
    variant: 'warning',
  });
  if (!ok) return;

  try {
    const { doc: _d, updateDoc, deleteField } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await updateDoc(
      _d(db, 'barangays', BARANGAY_ID, post._col, postId),
      { isHeroFeatured: deleteField() }
    );
  } catch (err) { console.error('[removeGalleryHero]', err); }
};

// ================================================
// SKELETON LOADER
// ================================================

/* Renders a hero placeholder and masonry skeleton cards */
function _renderSkeleton(heroSlot, gridEl) {
  heroSlot.innerHTML = `<div class="gallery-hero-skeleton"></div>`;

  gridEl.className = 'gallery-masonry';
  gridEl.innerHTML = Array.from({ length: 8 }, () =>
    `<div class="gallery-skeleton" style="margin-bottom:var(--space-md);"></div>`,
  ).join('');
}


// ================================================
// COVER SELECTION MODAL
// ================================================

/*
   Called by bulletin.js's toggleFeatured when a post has more than
   one image and is being added to the gallery.

   Shows a custom confirm modal with a thumbnail row so the admin
   can choose which image becomes the gallery cover.

   Returns a Promise that resolves to:
     { confirmed: true, coverIndex: number }  — user confirmed
     { confirmed: false }                     — user cancelled

   window.showCoverSelectModal is called from bulletin.js after
   this module is loaded.
*/
window.showCoverSelectModal = function (post, col) {
  return new Promise(resolve => {
    const images = getImages(post);

    /* Single-image posts skip this step entirely */
    if (images.length <= 1) {
      resolve({ confirmed: true, coverIndex: 0 });
      return;
    }

    /* Build or reuse a dedicated cover-select overlay */
    let overlay = document.getElementById('_galleryCoverOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id        = '_galleryCoverOverlay';
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal modal--confirm" onclick="event.stopPropagation()">
          <div class="modal-confirm__icon"
            style="background:#f0fdf4;border-color:#bbf7d0;">
            <i data-lucide="image" style="width:28px;height:28px;stroke-width:2;color:#15803d;"></i>
          </div>
          <h2 class="modal-confirm__title">Choose a Cover</h2>
          <p class="modal-confirm__body">
            This post has multiple images. Select one to display in the gallery.
          </p>
          <div class="gallery-cover-strip" id="_galleryCoverStrip">
            <span class="gallery-cover-strip__label">Select cover image</span>
          </div>
          <div class="modal-confirm__footer">
            <button class="btn btn--outline" id="_galleryCoverCancel">Go Back</button>
            <button class="btn btn--full btn--green" id="_galleryCoverConfirm">
              Add to Gallery
            </button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      lucide.createIcons({ el: overlay });
    }

    /* Populate thumbnail strip */
    const strip = document.getElementById('_galleryCoverStrip');
    let selectedIdx = 0;

    /* Clear previous thumbs (keep the label span) */
    const label = strip.querySelector('.gallery-cover-strip__label');
    strip.innerHTML = '';
    if (label) strip.appendChild(label);
    else {
      const lbl = document.createElement('span');
      lbl.className   = 'gallery-cover-strip__label';
      lbl.textContent = 'Select cover image';
      strip.appendChild(lbl);
    }

    images.forEach((url, i) => {
      const btn = document.createElement('button');
      btn.className = `gallery-cover-thumb${i === 0 ? ' is-selected' : ''}`;
      btn.innerHTML = `<img src="${esc(url)}" alt="Image ${i + 1}" />`;
      btn.addEventListener('click', () => {
        strip.querySelectorAll('.gallery-cover-thumb')
          .forEach(t => t.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        selectedIdx = i;
      });
      strip.appendChild(btn);
    });

    /* Open overlay */
    overlay.classList.add('is-open');

    /* Wire buttons — clone to clear old listeners */
    const confirmBtn = document.getElementById('_galleryCoverConfirm');
    const cancelBtn  = document.getElementById('_galleryCoverCancel');

    const freshConfirm = confirmBtn.cloneNode(true);
    const freshCancel  = cancelBtn.cloneNode(true);
    confirmBtn.replaceWith(freshConfirm);
    cancelBtn.replaceWith(freshCancel);

    function _close(confirmed) {
      overlay.classList.remove('is-open');
      resolve(confirmed ? { confirmed: true, coverIndex: selectedIdx } : { confirmed: false });
    }

    freshConfirm.addEventListener('click', () => _close(true),  { once: true });
    freshCancel.addEventListener('click',  () => _close(false), { once: true });
    overlay.addEventListener('click', e => {
      if (e.target === overlay) _close(false);
    }, { once: true });
  });
};
