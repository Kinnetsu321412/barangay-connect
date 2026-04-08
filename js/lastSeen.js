// js/lastSeen.js
// =====================================================
// Shared lastSeen heartbeat.
// Import and call startLastSeenHeartbeat() on every
// authenticated page (dashboard.html, admin.html, etc.)
// =====================================================

import { auth, db } from './firebase-config.js';
import { userDoc, userIndexDoc } from './db-paths.js';
import {
  updateDoc, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";


const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — adjust freely
let _heartbeatTimer = null;


// =====================================================
// WRITE LAST SEEN
// =====================================================
async function writeLastSeen(barangay, uid) {
  try {
    await updateDoc(userDoc(barangay, uid), {
      lastSeen: serverTimestamp(),
    });
  } catch (e) {
    // Non-fatal — don't block the user
    console.warn('lastSeen write failed:', e.message);
  }
}

// =====================================================
// START HEARTBEAT
// Call once per page after auth is confirmed.
// Writes immediately, then repeats on the interval.
// Stops automatically when the tab is hidden/closed.
// =====================================================
export async function startLastSeenHeartbeat() {
  onAuthStateChanged(auth, async (user) => {
    // Clear any previous timer (e.g. if auth state fires twice)
    if (_heartbeatTimer) {
      clearInterval(_heartbeatTimer);
      _heartbeatTimer = null;
    }

    if (!user) return;

    // Resolve barangay from index (fast single-doc read)
    let barangay;
    try {
      const indexSnap = await getDoc(userIndexDoc(user.uid));
      if (!indexSnap.exists()) return;

      const data = indexSnap.data();
      if (data.status !== 'active') return;
      barangay = data.barangay;
    } catch (e) {
      console.warn('lastSeen: could not read userIndex', e.message);
      return;
    }

    // Write immediately on page load / auth resolve
    await writeLastSeen(barangay, user.uid);

    // Then write on the interval while the tab is open
    _heartbeatTimer = setInterval(async () => {
      // Skip the write if the tab is hidden — saves writes when
      // the user leaves the tab open in the background
      if (document.visibilityState === 'hidden') return;
      await writeLastSeen(barangay, user.uid);
    }, HEARTBEAT_INTERVAL_MS);
  });
}
