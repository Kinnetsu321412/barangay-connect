// js/db-paths.js
// =====================================================
// Single source of truth for ALL Firestore and Storage
// paths in the project. Import from here everywhere —
// never hardcode paths in individual files.
//
// FIRESTORE STRUCTURE:
//   barangays/{barangayId}/users/{uid}     full user doc
//   userIndex/{uid}                         fast auth routing
//                                            top-level on purpose —
//                                           at login we don't know the
//                                           barangay yet, so this must
//                                           be reachable by UID alone.
//
// STORAGE STRUCTURE
//   barangays/{barangayId}/id-photos/{uid}/front.webp
//   barangays/{barangayId}/id-photos/{uid}/back.webp
//   barangays/{barangayId}/avatars/{uid}.webp
//   barangays/{barangayId}/reports/{uid}/{reportId}.webp
//   barangays/{barangayId}/announcements/{fileName}
//   barangays/{barangayId}/posts/{uid}/{fileName}
//   barangays/{barangayId}/pets/{uid}/{fileName}
// =====================================================

import { db } from './firebase-config.js';
import {
  doc, collection
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


// =====================================================
// BARANGAY ID
// Converts any barangay display name to a safe
// Firestore/Storage path segment.
//   "San Isidro" → "san_isidro"
//   "Barangay 1" → "barangay_1"
// =====================================================
export function barangayId(barangayName) {
  return String(barangayName)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}


// =====================================================
// FIRESTORE PATHS
// =====================================================

// Full user document: barangays/{barangayId}/users/{uid}
export function userDoc(barangay, uid) {
  return doc(db, 'barangays', barangayId(barangay), 'users', uid);
}

// Users subcollection: barangays/{barangayId}/users
export function usersCol(barangay) {
  return collection(db, 'barangays', barangayId(barangay), 'users');
}

// Lightweight auth index: userIndex/{uid}
// Stays top-level — auth.js needs this before it knows the barangay.
// Contains: { barangay, barangayId, role, status }
export function userIndexDoc(uid) {
  return doc(db, 'userIndex', uid);
}


// =====================================================
// STORAGE PATHS
// All assets live under barangays/{barangayId}/ first,
// then by type, keeping everything consistently grouped.
// Returns string paths (not refs — import ref() where needed).
// =====================================================

// barangays/{barangayId}/id-photos/{uid}/front.webp
export function idPhotoFrontPath(barangay, uid) {
  return `barangays/${barangayId(barangay)}/id-photos/${uid}/front.webp`;
}

// barangays/{barangayId}/id-photos/{uid}/back.webp
export function idPhotoBackPath(barangay, uid) {
  return `barangays/${barangayId(barangay)}/id-photos/${uid}/back.webp`;
}

// barangays/{barangayId}/avatars/{uid}.webp
export function avatarPath(barangay, uid) {
  return `barangays/${barangayId(barangay)}/avatars/${uid}.webp`;
}

// barangays/{barangayId}/reports/{uid}/{reportId}.webp
export function reportPhotoPath(barangay, uid, reportId) {
  return `barangays/${barangayId(barangay)}/reports/${uid}/${reportId}.webp`;
}

// barangays/{barangayId}/announcements/{fileName}
export function announcementPhotoPath(barangay, fileName) {
  return `barangays/${barangayId(barangay)}/announcements/${fileName}`;
}

// barangays/{barangayId}/posts/{uid}/{fileName}
export function postPhotoPath(barangay, uid, fileName) {
  return `barangays/${barangayId(barangay)}/posts/${uid}/${fileName}`;
}

// barangays/{barangayId}/pets/{uid}/{fileName}
export function petPhotoPath(barangay, uid, fileName) {
  return `barangays/${barangayId(barangay)}/pets/${uid}/${fileName}`;
}