// js/community-posts.js
// =====================================================
// Resident community posts — merged into the bulletin feed.
//
// Firestore path:
//   barangays/{barangayId}/communityPosts/{id}
//
// Fields:
//   title, body, category, imageURL (opt), authorId,
//   authorName, status (pending|published), likeCount,
//   commentCount, createdAt, dailyCount (not stored here —
//   tracked via a separate date-keyed doc per user)
// =====================================================

import { db } from './firebase-config.js';
import {
  collection, addDoc, query, where, orderBy,
  onSnapshot, serverTimestamp, getDoc, doc, updateDoc,
  increment, getDocs, limit,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { uploadImage } from './storage.js';
import { postPhotoPath } from './db-paths.js';

let _barangayId   = null;
let _uid          = null;
let _role         = 'resident';
let _userName     = 'Resident';
let _onPostsReady = null; // callback(posts[])

export function initCommunityPosts(barangayId, uid, userName, role) {
  _barangayId = barangayId;
  _uid        = uid;
  _role       = role || 'resident';
  _userName   = userName;
}

// ── Listen to published posts ─────────────────────────────────────
export function subscribeCommunityPosts(callback) {
  if (!_barangayId) return () => {};
  const col = collection(db, 'barangays', _barangayId, 'communityPosts');
  const q   = query(col, where('status', '==', 'published'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, _type: 'post', ...d.data() })));
  });
}

// ── Check daily limit ─────────────────────────────────────────────
async function getTodayPostCount() {
  if (!_barangayId || !_uid) { console.warn('[limit] not ready', _barangayId, _uid); return 0; }
  const today = new Date().toISOString().slice(0, 10);
  const col   = collection(db, 'barangays', _barangayId, 'communityPosts');
  const start = new Date(today + 'T00:00:00');
  const end   = new Date(today + 'T23:59:59');
  const q     = query(col, where('authorId', '==', _uid), limit(20));
  const snap  = await getDocs(q);
  const count = snap.docs.filter(d => {
    const t = d.data().createdAt?.toDate?.() ?? new Date(0);
    return t >= start && t <= end;
  }).length;
  console.log('[limit] today count:', count);
  return count;
}


export async function getModerationSettings() {
  if (!_barangayId) return { requirePostApproval: false, blockedWords: [], blockedLinksEnabled: true, postWarningText: '' };
  try {
    const snap = await getDoc(doc(db, 'barangays', _barangayId, 'meta', 'settings'));
    if (!snap.exists()) return { requirePostApproval: false, blockedWords: [], blockedLinksEnabled: true, postWarningText: '' };
    return snap.data();
  } catch { return { requirePostApproval: false, blockedWords: [], blockedLinksEnabled: true, postWarningText: '' }; }
}

// ── Check if barangay requires approval ───────────────────────────
export async function requiresApproval() {
  const s = await getModerationSettings();
  return s.requirePostApproval ?? false;
}

// ── Submit a new post ─────────────────────────────────────────────
export async function submitCommunityPost({ title, body, category, imageFiles }) {
  if (!_barangayId || !_uid) throw new Error('Not initialized.');
 if (!title?.trim()) throw new Error('Title is required.');

const count = await getTodayPostCount();

// Check per-user override from their barangay user doc
const settings = await getModerationSettings();
let effectiveLimit = settings.defaultPostLimit ?? 3;
try {
  const { getDoc: _gd, doc: _d } =
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  const uSnap = await _gd(_d(db, 'barangays', _barangayId, 'users', _uid));
  if (uSnap.exists()) {
    const role = uSnap.data().role;
    const override = uSnap.data().postLimitOverride;
    if (role === 'admin' || role === 'officer') {
      effectiveLimit = Infinity; // admins/officers always unlimited
    } else if (typeof override === 'number') {
      effectiveLimit = override === -1 ? Infinity : override;
    }
  }
} catch { /* non-fatal, fall back to default */ }

if (effectiveLimit !== Infinity && count >= effectiveLimit) {
    throw new Error(`You've reached the daily limit of ${effectiveLimit} posts. Try again tomorrow.`);
  }

  const blockedWords  = settings.blockedWords ?? [];
  const blockLinks    = settings.blockedLinksEnabled ?? false;
  const combinedText  = `${title} ${body}`.toLowerCase();

  // Check admin-defined blocked words locally
  const hitWord = blockedWords.find(w => w && combinedText.includes(w.toLowerCase()));

  // Check links
  const hasLink = blockLinks && /https?:\/\/|www\./i.test(combinedText);

  // Check via PurgoMalum free profanity API
  let hasProfanity = false;
  try {
    const apiRes = await fetch(
      `https://www.purgomalum.com/service/containsprofanity?text=${encodeURIComponent(combinedText)}`,
      { signal: AbortSignal.timeout(3000) }
    );
    hasProfanity = (await apiRes.text()).trim() === 'true';
    //console.log('[profanity check result]', hasProfanity, '| text:', combinedText);
  } catch {
    // API unavailable — fail open, don't block the post
    hasProfanity = false;
  }

    // Fetch role directly from barangay user doc
    const userRole = _role;

  const isPrivileged = userRole === 'admin' || userRole === 'officer';
  //console.log('[debug]', { requirePostApproval: settings.requirePostApproval, hitWord, hasLink, hasProfanity, isPrivileged });
  let flagReason = null;
if (!isPrivileged) {
  if (hasProfanity) flagReason = 'profanity';
  else if (hitWord) flagReason = `blocked_word:${hitWord}`;
  else if (hasLink) flagReason = 'link';
  else if (settings.requirePostApproval) flagReason = 'approval_required';
}
  const needsApproval = !isPrivileged && ((settings.requirePostApproval ?? false) || !!hitWord || hasLink || hasProfanity);

  const imageURLs = [];

  if (imageFiles?.length) {
    for (const file of imageFiles) {
      const path = postPhotoPath(_barangayId, _uid, `${Date.now()}-${Math.random().toString(36).slice(2)}.webp`);
      const url  = await uploadImage(file, path);
      imageURLs.push(url);
    }
  }

  const payload = {
    title:        title.trim(),
    body:         body.trim(),
    category:     category || 'general',
    imageURLs,
    authorId:     _uid,
    authorName:   _userName,
    authorRole:   userRole,
    status:       needsApproval ? 'pending' : 'published',
    flagReason: flagReason ?? null,
    likeCount:    0,
    commentCount: 0,
    createdAt:    serverTimestamp(),
    updatedAt:    serverTimestamp(),
  };

  await addDoc(collection(db, 'barangays', _barangayId, 'communityPosts'), payload);
  return needsApproval;
}