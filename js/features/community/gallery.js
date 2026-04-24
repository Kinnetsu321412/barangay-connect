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
let _viewMode        = 'masonry'; // 'masonry' | 'grid' | 'albums'
let _initialized     = false;
let _allAlbums       = [];   // live album list
let _activeAlbumId   = null; // currently open album detail
let _bulkSelectMode  = false;  // whether bulk selection is active
let _bulkSelected    = new Set(); // postIds currently selected
let _bulkLongPress   = null;   // long-press timer handle


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

    /* Sort spotlight first, then apply _sortMode */
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
      const ta = a.featuredAt?.toDate?.() ?? new Date(0);
      const tb = b.featuredAt?.toDate?.() ?? new Date(0);
      return tb - ta;
    });

    if (_viewMode === 'albums') {
      /* Featured posts changed — album covers may need updating */
      if (_activeAlbumId) {
        _renderAlbumDetail(_activeAlbumId, document.getElementById('galleryGrid'));
      } else {
        _renderAlbumsView();
      }
    } else {
      _renderGallery();
    }
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
      _activeAlbumId = null;
      if (_viewMode === 'albums') {
        _renderAlbumsView();
      } else {
        _renderGallery();
      }
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

  /* ── Subscribe: albums ── */
  const albumsQ = query(
    collection(db, 'barangays', BARANGAY_ID, 'albums'),
    orderBy('createdAt', 'desc'),
  );

  onSnapshot(albumsQ, snap => {
    const prev = _allAlbums;
    _allAlbums = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _updateAlbumsBadge();

    if (_viewMode !== 'albums') return;

    if (_activeAlbumId) {
      /* Detail view — check if only postIds order changed, patch DOM if so */
      const prevAlbum = prev.find(a => a.id === _activeAlbumId);
      const newAlbum  = _allAlbums.find(a => a.id === _activeAlbumId);

      if (!newAlbum) {
        /* Album was deleted while viewing it */
        _activeAlbumId = null;
        _renderAlbumsView();
        return;
      }

      const prevIds = prevAlbum?.postIds ?? [];
      const newIds  = newAlbum?.postIds  ?? [];

      /* Check if only order changed (same set of IDs, different sequence) */
      const sameSet = prevIds.length === newIds.length &&
        [...prevIds].sort().join() === [...newIds].sort().join();

      if (sameSet && prevIds.join() !== newIds.join()) {
        /* Only reorder — patch DOM without full rebuild */
        _patchAlbumDetailOrder(newIds);
      } else {
        /* Posts added/removed or other change — full rebuild */
        _renderAlbumDetail(_activeAlbumId, document.getElementById('galleryGrid'));
      }
    } else {
      _renderAlbumsView();
    }
  });

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

      ${(_currentUserRole === 'admin' || _currentUserRole === 'officer') ? `
      <button class="gallery-hero__badge gallery-hero__badge--admin"
        onclick="event.stopPropagation();_removeGalleryHero('${pid}')"
        title="Remove from Spotlight">
        <i data-lucide="crown"></i>
      </button>` : `
      <span class="gallery-hero__badge">
        <i data-lucide="crown"></i>
      </span>`}

      <img
        src="${esc(coverUrl)}"
        alt="${ptitle}"
        class="gallery-hero__img"
        loading="eager" />

      <div class="gallery-hero__overlay">
        <span class="tag ${meta.tagClass}"
          style="align-self:flex-start;margin-bottom:var(--space-xs);pointer-events:none;">
          ${esc(meta.label)}
        </span>
        <h2 class="gallery-hero__title">${ptitle}</h2>
        <a class="btn btn--outline-hero btn--sm gallery-hero__view-link"
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
            onclick="event.stopPropagation();window._addPostToAlbum('${pid}','${esc(post._col ?? 'communityPosts')}',this)"
            title="Add to album">
            <i data-lucide="folder-plus"></i>
          </button>
          <button class="gallery-card__admin-btn"
            onclick="event.stopPropagation();_setGalleryHero('${pid}')"
            title="Set as Spotlight">
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
            onclick="event.stopPropagation();window._addPostToAlbum('${pid}','${esc(post._col ?? 'communityPosts')}',this)"
            title="Add to album">
            <i data-lucide="folder-plus"></i>
          </button>
          <button class="gallery-card__admin-btn"
            onclick="event.stopPropagation();_setGalleryHero('${pid}')"
            title="Set as Spotlight">
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
  const params   = new URLSearchParams(window.location.search);
  const id       = params.get('id');
  const albumId  = params.get('album');

  /* ── Post deep link — open image viewer ── */
  if (id) {
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

  /* ── Album deep link — switch to albums view and highlight card ── */
  if (albumId) {
    /* Switch the toggle button to albums mode */
    document.querySelectorAll('.gallery-view-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.view === 'albums');
    });
    _viewMode      = 'albums';
    _activeAlbumId = null;

    let attempts = 0;
    const MAX    = 12;

    (function tryHighlight() {
      if (_allAlbums.length) {
        _renderAlbumsView();
        /* Wait one frame for the DOM to paint then highlight */
        requestAnimationFrame(() => {
          const card = document.querySelector(
            `.gallery-album-card[data-album-id="${albumId}"]`
          );
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.style.transition = 'box-shadow .35s';
            card.style.boxShadow  =
              '0 0 0 3px var(--green-dark), 0 0 0 7px rgba(27,75,39,.18)';
            setTimeout(() => { card.style.boxShadow = ''; }, 2200);
          }
        });
      } else if (attempts++ < MAX) {
        setTimeout(tryHighlight, 300);
      }
    })();
  }
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
    title:   'Set as Spotlight?',
    body:    'This post will be spotlighted at the top of the gallery. The current spotlight (if any) will return to the grid.',
    confirm: 'Set as Spotlight',
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
    title:   'Remove Spotlight?',
    body:    'This post will return to the regular gallery grid.',
    confirm: 'Remove Spotlight',
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
// ALBUMS — View
// ================================================

/* Updates the Albums toggle badge without a full re-render */
function _updateAlbumsBadge() {
  const btn = document.querySelector('.gallery-view-btn[data-view="albums"]');
  if (!btn) return;
  const totalAlbums = _allAlbums.length;
  const totalPosts  = _allAlbums.reduce((sum, a) => sum + (a.postIds?.length ?? 0), 0);
  let badge = btn.querySelector('.gallery-albums-badge');
  if (!badge) {
    badge           = document.createElement('span');
    badge.className = 'gallery-albums-badge';
    btn.appendChild(badge);
  }
  badge.textContent   = totalAlbums ? `${totalAlbums} · ${totalPosts}` : '';
  badge.style.display = totalAlbums ? '' : 'none';
}

/*
   Patches the album detail grid card order in-place without
   rebuilding the DOM. Used when only postIds sequence changes
   (reorder from another tab/device).
   Re-wires arrow button disabled states after moving.
*/
function _patchAlbumDetailOrder(newIds) {
  const gridEl = document.getElementById('galleryGrid');
  if (!gridEl) return;

  const cards = [...gridEl.querySelectorAll('.gallery-card--reorderable')];
  if (!cards.length) return;

  /* Build a map of postId → card element */
  const cardMap = new Map(cards.map(c => [c.dataset.postId, c]));

  /* Reappend in new order — DOM moves are non-destructive */
  newIds.forEach(id => {
    const card = cardMap.get(id);
    if (card) gridEl.appendChild(card);
  });

  /* Re-wire arrow button disabled states */
  const reordered = [...gridEl.querySelectorAll('.gallery-card--reorderable')];
  reordered.forEach((card, i) => {
    const btns = card.querySelectorAll('.gallery-card__reorder-btn');
    if (btns[0]) btns[0].disabled = i === 0;
    if (btns[1]) btns[1].disabled = i === reordered.length - 1;
  });
}

// ================================================
// BULK SELECTION
// ================================================

/* Enters bulk selection mode and optionally pre-selects a post */
function _enterBulkSelect(firstPostId) {
  _bulkSelectMode = true;
  _bulkSelected.clear();
  if (firstPostId) _bulkSelected.add(firstPostId);
  _renderBulkToolbar();
  _refreshBulkCardStates();
}

/* Exits bulk selection mode and tears down toolbar */
window._exitBulkSelect = function () {
  _bulkSelectMode  = false;
  _bulkSelected.clear();
  document.getElementById('_galleryBulkToolbar')?.remove();
  _refreshBulkCardStates();
}

/* Routes card click — opens viewer normally, toggles selection in bulk mode */
window._handleAlbumCardClick = function (e, postId, albumId) {
  /* Ignore clicks that originated from admin strip buttons */
  if (e.target.closest('.gallery-card__admin-strip') ||
      e.target.closest('.gallery-card__reorder-btns')) return;

  if (_bulkSelectMode) {
    e.stopPropagation();
    _toggleBulkCard(postId);
    return;
  }
  _galleryOpenViewer(postId, albumId);
};

/* Starts a 600ms long-press timer to enter bulk selection mode */
window._startLongPress = function (e, postId) {
  if (!(_currentUserRole === 'admin' || _currentUserRole === 'officer')) return;
  if (_bulkSelectMode) return;
  _bulkLongPress = setTimeout(() => {
    _bulkLongPress = null;
    /* Provide haptic feedback on mobile if available */
    if (navigator.vibrate) navigator.vibrate(40);
    _enterBulkSelect(postId);
  }, 600);
};

/* Cancels the long-press timer */
window._cancelLongPress = function () {
  if (_bulkLongPress) {
    clearTimeout(_bulkLongPress);
    _bulkLongPress = null;
  }
};

/* Toggles a single card's selected state */
function _toggleBulkCard(postId) {
  if (_bulkSelected.has(postId)) {
    _bulkSelected.delete(postId);
  } else {
    _bulkSelected.add(postId);
  }
  _refreshBulkCardStates();
  _renderBulkToolbar();
}

/* Syncs .is-bulk-selected class and checkbox state on all cards */
function _refreshBulkCardStates() {
  const gridEl = document.getElementById('galleryGrid');
  if (!gridEl) return;
  gridEl.querySelectorAll('.gallery-card--reorderable').forEach(card => {
    const pid      = card.dataset.postId;
    const selected = _bulkSelected.has(pid);
    card.classList.toggle('is-bulk-selected', selected);
    card.classList.toggle('bulk-mode', _bulkSelectMode);
    const cb = card.querySelector('.gallery-bulk-checkbox');
    if (cb) cb.classList.toggle('is-checked', selected);
  });
}

/* Renders or updates the floating bulk toolbar */
function _renderBulkToolbar() {
  const count = _bulkSelected.size;

  let toolbar = document.getElementById('_galleryBulkToolbar');
  if (!toolbar) {
    toolbar           = document.createElement('div');
    toolbar.id        = '_galleryBulkToolbar';
    toolbar.className = 'gallery-bulk-toolbar';
    document.body.appendChild(toolbar);
  }

  toolbar.innerHTML = `
    <button class="gallery-bulk-toolbar__cancel"
      onclick="window._exitBulkSelect()">
      <i data-lucide="x"></i>
    </button>
    <span class="gallery-bulk-toolbar__count">
      ${count} post${count !== 1 ? 's' : ''} selected
    </span>
    <button class="gallery-bulk-toolbar__select-all"
      onclick="window._bulkSelectAll()">
      Select All
    </button>
    <button class="btn btn--green btn--sm gallery-bulk-toolbar__add"
      ${count === 0 ? 'disabled' : ''}
      onclick="window._bulkAddToAlbum()">
      <i data-lucide="folder-plus"></i> Add to Album
    </button>`;

  lucide.createIcons({ el: toolbar });
}

/* Selects all posts in the current album detail */
window._bulkSelectAll = function () {
  const gridEl = document.getElementById('galleryGrid');
  if (!gridEl) return;
  gridEl.querySelectorAll('.gallery-card--reorderable').forEach(card => {
    if (card.dataset.postId) _bulkSelected.add(card.dataset.postId);
  });
  _refreshBulkCardStates();
  _renderBulkToolbar();
};

/* Opens the album picker for all selected posts */
window._bulkAddToAlbum = async function () {
  if (!_bulkSelected.size || !_allAlbums.length) {
    if (!_allAlbums.length) {
      const ok = await showConfirm({
        title:   'No Albums Yet',
        body:    'Create an album first before adding posts.',
        confirm: 'Create Album',
        cancel:  'Go Back',
        variant: 'confirm',
      });
      if (ok) window._openCreateAlbum();
    }
    return;
  }

  const toolbar = document.getElementById('_galleryBulkToolbar');
  const addBtn  = toolbar?.querySelector('.gallery-bulk-toolbar__add');

  /* Show a simple album picker via showConfirm-style modal */
  let overlay = document.getElementById('_galleryBulkAlbumPicker');
  if (!overlay) {
    overlay           = document.createElement('div');
    overlay.id        = '_galleryBulkAlbumPicker';
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="modal modal--confirm" onclick="event.stopPropagation()"
      style="max-width:400px;">
      <div class="modal__header modal__header--green"
        style="border-radius:var(--radius-lg) var(--radius-lg) 0 0;">
        <div class="modal__header-icon"><i data-lucide="folder-plus"></i></div>
        <div class="modal__header-content">
          <p class="modal__header-label">Bulk Add</p>
          <h2 class="modal__header-title">Choose an Album</h2>
          <p class="modal__header-sub">
            Adding ${_bulkSelected.size} post${_bulkSelected.size !== 1 ? 's' : ''}
          </p>
        </div>
        <button class="btn btn--close btn--sm modal__close"
          onclick="document.getElementById('_galleryBulkAlbumPicker').classList.remove('is-open')">
          <i data-lucide="x"></i>
        </button>
      </div>
      <div class="modal__body" style="display:flex;flex-direction:column;gap:4px;padding:var(--space-md);">
        ${_allAlbums.map(album => `
          <button class="gallery-album-picker__item"
            onclick="window._bulkConfirmAdd('${esc(album.id)}')">
            <i data-lucide="folder"></i>
            ${esc(album.title)}
            <span style="margin-left:auto;font-size:var(--text-xs);color:var(--gray-400);">
              ${album.postIds?.length ?? 0} posts
            </span>
          </button>`).join('')}
      </div>
    </div>`;

  overlay.classList.add('is-open');
  overlay.onclick = e => { if (e.target === overlay) overlay.classList.remove('is-open'); };
  lucide.createIcons({ el: overlay });
};

/* Writes all selected postIds into the chosen album using arrayUnion */
window._bulkConfirmAdd = async function (albumId) {
  document.getElementById('_galleryBulkAlbumPicker')?.classList.remove('is-open');

  const ids   = [..._bulkSelected];
  const album = _allAlbums.find(a => a.id === albumId);

  try {
    const { doc: _d, updateDoc, arrayUnion } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await updateDoc(_d(db, 'barangays', BARANGAY_ID, 'albums', albumId), {
      postIds: arrayUnion(...ids),
    });
    _showGalleryToast(`${ids.length} post${ids.length !== 1 ? 's' : ''} added to "${album?.title ?? 'album'}"`);
    _exitBulkSelect();
  } catch (err) {
    console.error('[bulkAdd]', err);
    _showGalleryToast('Something went wrong. Please try again.', 'error');
  }
};

/* Called by ESC key to exit bulk mode */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _bulkSelectMode) _exitBulkSelect();
});

/*
   Renders the albums list or a single album detail,
   replacing the hero slot and grid area.
*/
function _renderAlbumsView() {
  const heroSlot = document.getElementById('galleryHeroSlot');
  const gridEl   = document.getElementById('galleryGrid');
  if (!heroSlot || !gridEl) return;

  heroSlot.innerHTML = '';

  /* If an album is open, render its detail view */
  if (_activeAlbumId) {
    _renderAlbumDetail(_activeAlbumId, gridEl);
    return;
  }

  /* Albums list */
  const canManage = _currentUserRole === 'admin' || _currentUserRole === 'officer';

  _updateAlbumsBadge();

  gridEl.className = 'gallery-albums-list';

  if (!_allAlbums.length) {
    /* Empty state — render outside the grid to avoid column weirdness */
    gridEl.innerHTML = canManage ? `
      <button class="gallery-album-create-btn" onclick="window._openCreateAlbum()">
        <i data-lucide="plus"></i> New Album
      </button>
      <div class="gallery-empty" style="grid-column:1/-1;">
        <div class="gallery-empty__icon"><i data-lucide="folder-open"></i></div>
        <p class="gallery-empty__title">No albums yet.</p>
        <p class="gallery-empty__sub">Create an album to group featured posts together.</p>
      </div>` : `
      <div class="gallery-empty" style="grid-column:1/-1;">
        <div class="gallery-empty__icon"><i data-lucide="folder-open"></i></div>
        <p class="gallery-empty__title">No albums yet.</p>
        <p class="gallery-empty__sub">Check back soon for curated albums.</p>
      </div>`;
  } else {
    gridEl.innerHTML = `
      ${canManage ? `
      <button class="gallery-album-create-btn" onclick="window._openCreateAlbum()">
        <i data-lucide="plus"></i> New Album
      </button>` : ''}
      ${_allAlbums.map(album => _buildAlbumCard(album)).join('')}`;
  }

  lucide.createIcons({ el: gridEl });
}

/* Returns HTML for a single album card in the list */
function _buildAlbumCard(album) {
  const pid        = esc(album.id);
  const coverPost = _allFeatured.find(p => p.id === album.coverPostId)
    ?? (album.postIds ?? []).map(id => _allFeatured.find(p => p.id === id)).find(p => p && getCoverUrl(p))
    ?? null;
  const coverUrl  = coverPost ? getCoverUrl(coverPost) : null;
  const postCount  = album.postIds?.length ?? 0;
  const canManage  = _currentUserRole === 'admin' || _currentUserRole === 'officer';

  return `
    <div class="gallery-album-card"
      data-album-id="${pid}"
      onclick="window._openAlbumDetail('${pid}')">
      <div class="gallery-album-card__cover">
        ${coverUrl
          ? `<img src="${esc(coverUrl)}" alt="${esc(album.title)}" loading="lazy" />`
          : `<div class="gallery-album-card__cover-empty">
              <i data-lucide="image" style="width:32px;height:32px;color:var(--gray-300);"></i>
             </div>`}
        <div class="gallery-album-card__overlay">
          <span class="gallery-album-card__count">
            <i data-lucide="images"></i> ${postCount} post${postCount !== 1 ? 's' : ''}
          </span>
        </div>
        ${canManage ? `
        <div class="gallery-card__admin-strip">
          <button class="gallery-card__admin-btn"
            onclick="event.stopPropagation();window._openEditAlbum('${pid}')"
            title="Edit album">
            <i data-lucide="pencil"></i>
          </button>
          <button class="gallery-card__admin-btn"
            onclick="event.stopPropagation();window._deleteAlbum('${pid}')"
            title="Delete album">
            <i data-lucide="trash-2"></i>
          </button>
        </div>` : ''}
      </div>
      <div class="gallery-album-card__body">
        <p class="gallery-album-card__title">${esc(album.title)}</p>
        ${album.description
          ? `<p class="gallery-album-card__desc">${esc(album.description)}</p>`
          : ''}
      </div>
    </div>`;
}

/*
   Renders the posts inside a single album, with a back button.
   Resolves postIds against _allFeatured — posts not in the featured
   set are shown as a greyed-out placeholder (may have been unfeatured).
*/
function _renderAlbumDetail(albumId, gridEl) {
  const album = _allAlbums.find(a => a.id === albumId);
  if (!album) { _activeAlbumId = null; _renderAlbumsView(); return; }

  const heroSlot = document.getElementById('galleryHeroSlot');
  if (heroSlot) {
    heroSlot.innerHTML = `
      <div class="gallery-album-header">
        <button class="gallery-album-back-btn" onclick="window._closeAlbumDetail()">
          <i data-lucide="arrow-left"></i> Albums
        </button>
        <div class="gallery-album-header__meta">
          <h2 class="gallery-album-header__title">${esc(album.title)}</h2>
          ${album.description
            ? `<p class="gallery-album-header__desc">${esc(album.description)}</p>`
            : ''}
        </div>
        ${(_currentUserRole === 'admin' || _currentUserRole === 'officer') ? `
        <button class="btn btn--outline btn--sm gallery-album-edit-btn"
          onclick="window._openEditAlbum('${esc(album.id)}')">
          <i data-lucide="pencil"></i> Edit
        </button>
        <button class="btn btn--outline btn--sm"
          style="color:var(--red);border-color:var(--red);"
          onclick="window._deleteAlbum('${esc(album.id)}').then(deleted => { if(deleted) window._closeAlbumDetail(); })">
          <i data-lucide="trash-2"></i> Delete
        </button>` : ''}
      </div>`;
    lucide.createIcons({ el: heroSlot });
  }

  const postIds = album.postIds ?? [];

  if (!postIds.length) {
    gridEl.className = 'gallery-masonry';
    gridEl.innerHTML = `
      <div class="gallery-empty" style="column-span:all;">
        <div class="gallery-empty__icon"><i data-lucide="image-off"></i></div>
        <p class="gallery-empty__title">No posts in this album yet.</p>
        <p class="gallery-empty__sub">Add posts using the ··· menu on the bulletin or the gallery card.</p>
      </div>`;
    lucide.createIcons({ el: gridEl });
    return;
  }

  /* Resolve post objects; keep order from postIds array */
  const posts = postIds
    .map(id => _allFeatured.find(p => p.id === id))
    .filter(Boolean);

  gridEl.className = 'gallery-masonry';
  gridEl.innerHTML = posts.map((post, i) => _buildAlbumPostCard(post, album, i, posts.length)).join('');
  lucide.createIcons({ el: gridEl });
  _wireDragReorder(gridEl, album.id);
}

/* Card variant for posts inside an album detail — adds album context to viewer */
function _buildAlbumPostCard(post, album, index, total) {
  const coverUrl  = getCoverUrl(post);
  const meta      = categoryMeta(post.category);
  const pid       = esc(post.id);
  const ptitle    = esc(post.title ?? '');
  const aid       = esc(album.id);
  const canManage = _currentUserRole === 'admin' || _currentUserRole === 'officer';

  if (!coverUrl) return '';

  return `
    <div class="gallery-card gallery-card--reorderable"
      draggable="${canManage ? 'true' : 'false'}"
      data-post-id="${pid}"
      data-album-id="${aid}"
      onclick="_handleAlbumCardClick(event,'${pid}','${aid}')"
      onmousedown="_startLongPress(event,'${pid}')"
      onmouseup="_cancelLongPress()"
      onmouseleave="_cancelLongPress()"
      ontouchstart="_startLongPress(event,'${pid}')"
      ontouchend="_cancelLongPress()"
      ontouchmove="_cancelLongPress()">
      <div class="gallery-card__img-wrap">
        <img src="${esc(coverUrl)}" alt="${ptitle}"
          class="gallery-card__img" loading="lazy" />
        <div class="gallery-card__overlay">
          <div class="gallery-card__meta">
            <span class="tag ${meta.tagClass}"
              style="align-self:flex-start;font-size:var(--text-2xs);">
              ${esc(meta.label)}
            </span>
            <p class="gallery-card__title">${ptitle}</p>
          </div>
        </div>
        ${canManage ? `
        <div class="gallery-bulk-checkbox" data-pid="${pid}">
          <i data-lucide="check" style="width:10px;height:10px;"></i>
        </div>
        <div class="gallery-card__admin-strip">
          <button class="gallery-card__admin-btn"
            onclick="event.stopPropagation();window._removePostFromAlbum('${pid}','${aid}')"
            title="Remove from album">
            <i data-lucide="folder-minus"></i>
          </button>
        </div>
        <div class="gallery-card__reorder-btns">
          <button class="gallery-card__reorder-btn"
            onclick="event.stopPropagation();window._reorderAlbumPost('${aid}','${pid}',-1)"
            title="Move left" ${index === 0 ? 'disabled' : ''}>
            <i data-lucide="chevron-left"></i>
          </button>
          <button class="gallery-card__reorder-btn"
            onclick="event.stopPropagation();window._reorderAlbumPost('${aid}','${pid}',1)"
            title="Move right" ${index === total - 1 ? 'disabled' : ''}>
            <i data-lucide="chevron-right"></i>
          </button>
        </div>` : ''}
      </div>
    </div>`;
}

/* Opens album detail — called by clicking an album card */
window._openAlbumDetail = function (albumId) {
  _activeAlbumId = albumId;
  const url = new URL(window.location.href);
  url.searchParams.set('album', albumId);
  url.searchParams.delete('id');
  history.replaceState(null, '', url.toString());
  const gridEl = document.getElementById('galleryGrid');
  if (gridEl) _renderAlbumDetail(albumId, gridEl);
};

/* Returns to the albums list */
window._closeAlbumDetail = function () {
  _activeAlbumId = null;
  const url = new URL(window.location.href);
  url.searchParams.delete('album');
  history.replaceState(null, '', url.toString());
  _renderAlbumsView();
};


// ================================================
// ALBUMS — Open viewer with album context
// ================================================

/*
   Override _galleryOpenViewer to accept an optional albumId.
   When provided, the accent bar shows the album name as context.
*/
const _originalGalleryOpenViewer = window._galleryOpenViewer;

window._galleryOpenViewer = function (postId, albumId) {
  const post = _allFeatured.find(p => p.id === postId);
  if (!post) return;

  const images   = getImages(post);
  const coverIdx = typeof post.featuredCoverIndex === 'number'
    ? Math.min(post.featuredCoverIndex, images.length - 1)
    : 0;

  _openViewer(images.length ? images : [''], coverIdx, post.title ?? '');

  requestAnimationFrame(() => {
    const accent = document.querySelector('#imgViewerOverlay .img-viewer__accent');
    if (!accent) return;

    accent.querySelectorAll(
      '.gallery-viewer-link, .gallery-viewer-meta, .gallery-viewer-album, .gallery-viewer-add-album'
    ).forEach(el => el.remove());

    /* Album context chip — shown when opened from an album detail */
    if (albumId) {
      const album = _allAlbums.find(a => a.id === albumId);
      if (album) {
        const chip = document.createElement('span');
        chip.className = 'gallery-viewer-album';
        chip.innerHTML = `<i data-lucide="folder"></i> ${esc(album.title)}`;
        accent.appendChild(chip);
        lucide.createIcons({ el: chip });
      }
    }

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

    /* Add to Album button — admin/officer only */
    if (_currentUserRole === 'admin' || _currentUserRole === 'officer') {
      const addBtn = document.createElement('button');
      addBtn.className = 'gallery-viewer-add-album';
      addBtn.innerHTML = `<i data-lucide="folder-plus"></i> Add to Album`;
      addBtn.onclick = () => {
        const post = _allFeatured.find(p => p.id === postId);
        if (post) window._addPostToAlbum(postId, post._col ?? 'communityPosts', addBtn);
      };
      accent.appendChild(addBtn);
      lucide.createIcons({ el: addBtn });
    }

    const url = new URL(window.location.href);
    url.searchParams.set('id', postId);
    history.replaceState(null, '', url.toString());
  });
};


// ================================================
// ALBUMS — Create / Edit / Delete
// ================================================

/* Opens the create album modal */
window._openCreateAlbum = function () {
  _openAlbumModal(null);
};

/* Opens the edit album modal pre-filled */
window._openEditAlbum = function (albumId) {
  _openAlbumModal(albumId);
};

/*
   Builds and opens the album create/edit modal.
   albumId === null → create mode; string → edit mode.
*/
function _openAlbumModal(albumId) {
  const isEdit = albumId !== null;
  const album  = isEdit ? _allAlbums.find(a => a.id === albumId) : null;

  let overlay = document.getElementById('_galleryAlbumModal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id        = '_galleryAlbumModal';
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
  }

  /* Build cover post options from _allFeatured */
  const coverOptions = _allFeatured
    .filter(p => getCoverUrl(p))
    .map(p => `<option value="${esc(p.id)}"
      ${album?.coverPostId === p.id ? 'selected' : ''}>
      ${esc(p.title ?? p.id)}
    </option>`)
    .join('');

  overlay.innerHTML = `
    <div class="modal modal--confirm" onclick="event.stopPropagation()"
      style="max-width:480px;">
      <div class="modal__header modal__header--green"
        style="border-radius:var(--radius-lg) var(--radius-lg) 0 0;">
        <div class="modal__header-icon">
          <i data-lucide="folder-plus"></i>
        </div>
        <div class="modal__header-content">
          <p class="modal__header-label">Gallery</p>
          <h2 class="modal__header-title">${isEdit ? 'Edit Album' : 'New Album'}</h2>
        </div>
        <button class="btn btn--close btn--sm modal__close"
          onclick="document.getElementById('_galleryAlbumModal').classList.remove('is-open')">
          <i data-lucide="x"></i>
        </button>
      </div>
      <div class="modal__body" style="display:flex;flex-direction:column;gap:var(--space-md);">
        <div class="form-group">
          <label class="form-label">Album Title</label>
          <input id="_albumTitleInput" class="form-input"
            placeholder="e.g. Fiesta 2025"
            value="${esc(album?.title ?? '')}" maxlength="60" />
        </div>
        <div class="form-group">
          <label class="form-label">
            Description
            <span style="color:var(--gray-400);font-weight:400;font-size:var(--text-xs);">(optional)</span>
          </label>
          <textarea id="_albumDescInput" class="form-input" rows="2"
            placeholder="A short description…"
            maxlength="200">${esc(album?.description ?? '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">
            Cover Post
            <span style="color:var(--gray-400);font-weight:400;font-size:var(--text-xs);">(optional)</span>
          </label>
          <select id="_albumCoverInput" class="form-select">
            <option value="">— None —</option>
            ${coverOptions}
          </select>
        </div>
      </div>
      <div class="modal__footer">
        <button class="btn btn--outline"
          onclick="document.getElementById('_galleryAlbumModal').classList.remove('is-open')">
          Cancel
        </button>
        <button class="btn btn--green btn--full"
          onclick="window._saveAlbum(${isEdit ? `'${esc(albumId)}'` : 'null'})">
          <i data-lucide="${isEdit ? 'save' : 'folder-plus'}"></i>
          ${isEdit ? 'Save Changes' : 'Create Album'}
        </button>
      </div>
    </div>`;

  overlay.classList.add('is-open');
  overlay.onclick = e => { if (e.target === overlay) overlay.classList.remove('is-open'); };
  lucide.createIcons({ el: overlay });
}

/* Writes the album to Firestore (create or update) */
window._saveAlbum = async function (albumId) {
  if (_currentUserRole !== 'admin' && _currentUserRole !== 'officer') return;

  const title   = document.getElementById('_albumTitleInput')?.value.trim();
  const desc    = document.getElementById('_albumDescInput')?.value.trim() || '';
  const coverId = document.getElementById('_albumCoverInput')?.value || '';

  if (!title) {
    document.getElementById('_albumTitleInput')?.focus();
    return;
  }

  const overlay = document.getElementById('_galleryAlbumModal');
  const saveBtn = overlay?.querySelector('.btn--green');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    const {
      doc: _d, updateDoc, addDoc, collection: _col, serverTimestamp: _ts,
    } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

    if (albumId) {
      /* Edit */
      await updateDoc(_d(db, 'barangays', BARANGAY_ID, 'albums', albumId), {
        title,
        description: desc,
        coverPostId: coverId || null,
        updatedAt:   _ts(),
      });
    } else {
      /* Create */
      await addDoc(_col(db, 'barangays', BARANGAY_ID, 'albums'), {
        title,
        description: desc,
        coverPostId: coverId || null,
        postIds:     [],
        createdBy:   _currentUid,
        createdAt:   _ts(),
      });
    }

    overlay?.classList.remove('is-open');
  } catch (err) {
    console.error('[saveAlbum]', err);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; }
  }
};

/* Deletes an album document (does not affect the posts themselves) */
window._deleteAlbum = async function (albumId) {
  if (_currentUserRole !== 'admin' && _currentUserRole !== 'officer') return false;

  const ok = await showConfirm({
    title:   'Delete Album?',
    body:    'The album will be deleted. Posts inside will not be affected.',
    confirm: 'Delete',
    cancel:  'Go Back',
    variant: 'danger',
  });
  if (!ok) return false;

  try {
    const { doc: _d, deleteDoc } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await deleteDoc(_d(db, 'barangays', BARANGAY_ID, 'albums', albumId));
    return true;
  } catch (err) {
    console.error('[deleteAlbum]', err);
    return false;
  }
};


// ================================================
// ALBUMS — Add / Remove Posts
// ================================================

/*
   Shows a dropdown picker of all albums so the user can
   add a post to one. Called from both the Gallery card
   admin strip and the Bulletin ··· menu.

   postId — the post to add
   col    — 'announcements' | 'communityPosts' (for reference, not written here)
   anchorEl — the button that was clicked (used to position the picker)
*/
window._addPostToAlbum = async function (postId, col, anchorEl) {
  if (_currentUserRole !== 'admin' && _currentUserRole !== 'officer') return;
  if (!_allAlbums.length) {
    /* No albums yet — offer to create one */
    const ok = await showConfirm({
      title:   'No Albums Yet',
      body:    'You haven\'t created any albums. Would you like to create one now?',
      confirm: 'Create Album',
      cancel:  'Go Back',
      variant: 'confirm',
    });
    if (ok) window._openCreateAlbum();
    return;
  }

  /* Build or reuse picker dropdown */
  let picker = document.getElementById('_albumPickerDropdown');
  if (!picker) {
    picker = document.createElement('div');
    picker.id        = '_albumPickerDropdown';
    picker.className = 'gallery-album-picker';
    document.body.appendChild(picker);
  }

  /* Position below anchor */
  if (anchorEl) {
    const rect      = anchorEl.getBoundingClientRect();
    picker.style.top  = `${rect.bottom + window.scrollY + 6}px`;
    picker.style.left = `${rect.left   + window.scrollX}px`;
  }

  picker.innerHTML = `
    <p class="gallery-album-picker__label">Add to album</p>
    ${_allAlbums.map(album => {
      const alreadyIn = (album.postIds ?? []).includes(postId);
      return `
        <button class="gallery-album-picker__item${alreadyIn ? ' is-in-album' : ''}"
          onclick="window._confirmAddToAlbum('${esc(postId)}','${esc(album.id)}',${alreadyIn})"
          ${alreadyIn ? 'title="Already in this album"' : ''}>
          <i data-lucide="${alreadyIn ? 'check' : 'folder-plus'}"></i>
          ${esc(album.title)}
        </button>`;
    }).join('')}`;

  picker.classList.add('is-open');
  lucide.createIcons({ el: picker });

  /* Close on outside click */
  setTimeout(() => {
    document.addEventListener('click', function _closePicker(e) {
      if (!picker.contains(e.target)) {
        picker.classList.remove('is-open');
        document.removeEventListener('click', _closePicker);
      }
    });
  }, 0);
};

/* Writes the postId into the album's postIds array */
window._confirmAddToAlbum = async function (postId, albumId, alreadyIn) {
  document.getElementById('_albumPickerDropdown')?.classList.remove('is-open');
  if (alreadyIn) return;

  try {
    const { doc: _d, updateDoc, arrayUnion } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await updateDoc(_d(db, 'barangays', BARANGAY_ID, 'albums', albumId), {
      postIds: arrayUnion(postId),
    });

    /* Toast — reuse bulletin's showToast if available, else console */
    const album = _allAlbums.find(a => a.id === albumId);
    _showGalleryToast(`Added to "${album?.title ?? 'album'}"`);
  } catch (err) { console.error('[addToAlbum]', err); }
};

/* Removes a postId from an album's postIds array */
window._removePostFromAlbum = async function (postId, albumId) {
  if (_currentUserRole !== 'admin' && _currentUserRole !== 'officer') return;

  const ok = await showConfirm({
    title:   'Remove from Album?',
    body:    'This post will be removed from the album. It will stay in the gallery.',
    confirm: 'Remove',
    cancel:  'Go Back',
    variant: 'warning',
  });
  if (!ok) return;

  try {
    const { doc: _d, updateDoc, arrayRemove } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await updateDoc(_d(db, 'barangays', BARANGAY_ID, 'albums', albumId), {
      postIds: arrayRemove(postId),
    });
    /* Re-render detail with updated data */
    if (_activeAlbumId === albumId) {
      const gridEl = document.getElementById('galleryGrid');
      if (gridEl) _renderAlbumDetail(albumId, gridEl);
    }
  } catch (err) { console.error('[removeFromAlbum]', err); }
};

/* Small toast for gallery-side feedback */
function _showGalleryToast(message, type = 'success') {
  let c = document.getElementById('bulletinToastContainer');
  if (!c) {
    c = document.createElement('div');
    c.id        = 'bulletinToastContainer';
    c.className = 'toast-container';
    document.body.appendChild(c);
  }
  const t     = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = message;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

/*
   Moves a post one position left (-1) or right (+1) in the album's postIds array.
   Writes the full reordered array back to Firestore.
*/
window._reorderAlbumPost = async function (albumId, postId, direction) {
  if (_currentUserRole !== 'admin' && _currentUserRole !== 'officer') return;

  const album = _allAlbums.find(a => a.id === albumId);
  if (!album) return;

  const ids  = [...(album.postIds ?? [])];
  const idx  = ids.indexOf(postId);
  if (idx === -1) return;

  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= ids.length) return;

  /* Swap */
  [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];

  try {
    const { doc: _d, updateDoc } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await updateDoc(_d(db, 'barangays', BARANGAY_ID, 'albums', albumId), { postIds: ids });
  } catch (err) { console.error('[reorderAlbumPost]', err); }
};

/*
   Wires HTML5 drag-and-drop reordering on the album detail grid.
   Works alongside the arrow buttons — both write to the same postIds array.
*/
function _wireDragReorder(gridEl, albumId) {
  if (_currentUserRole !== 'admin' && _currentUserRole !== 'officer') return;

  let _dragSrc = null;

  gridEl.querySelectorAll('.gallery-card--reorderable').forEach(card => {
    card.addEventListener('dragstart', e => {
      _dragSrc = card;
      card.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.postId);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      gridEl.querySelectorAll('.gallery-card--reorderable')
        .forEach(c => c.classList.remove('drag-over'));
      _dragSrc = null;
    });

    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (card !== _dragSrc) {
        gridEl.querySelectorAll('.gallery-card--reorderable')
          .forEach(c => c.classList.remove('drag-over'));
        card.classList.add('drag-over');
      }
    });

    card.addEventListener('drop', async e => {
      e.preventDefault();
      e.stopPropagation();
      if (!_dragSrc || _dragSrc === card) return;

      card.classList.remove('drag-over');

      const album = _allAlbums.find(a => a.id === albumId);
      if (!album) return;

      const ids     = [...(album.postIds ?? [])];
      const fromIdx = ids.indexOf(_dragSrc.dataset.postId);
      const toIdx   = ids.indexOf(card.dataset.postId);
      if (fromIdx === -1 || toIdx === -1) return;

      /* Reorder */
      ids.splice(toIdx, 0, ids.splice(fromIdx, 1)[0]);

      try {
        const { doc: _d, updateDoc } =
          await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        await updateDoc(_d(db, 'barangays', BARANGAY_ID, 'albums', albumId), { postIds: ids });
      } catch (err) { console.error('[dragReorder]', err); }
    });
  });
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

