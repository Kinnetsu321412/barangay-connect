// functions/index.js
// =====================================================
// Cloud Functions — Firebase Admin SDK
// =====================================================

const {
  onDocumentUpdated,
  onDocumentDeleted,
} = require("firebase-functions/v2/firestore");

const { onSchedule } = require("firebase-functions/v2/scheduler"); // ← ADD

const { initializeApp } = require("firebase-admin/app");
const { getStorage }    = require("firebase-admin/storage");
const { getFirestore, Timestamp } = require("firebase-admin/firestore"); // ← ADD Timestamp
const { getAuth }       = require("firebase-admin/auth");

const Parser = require("rss-parser"); // ← ADD (npm install rss-parser in /functions)

initializeApp();


// =====================================================
// PATH HELPERS — must mirror db-paths.js on the client
// =====================================================

function idPhotoFrontPath(barangayId, uid) {
  return `barangays/${barangayId}/id-photos/${uid}/front.webp`;
}

function idPhotoBackPath(barangayId, uid) {
  return `barangays/${barangayId}/id-photos/${uid}/back.webp`;
}


// =====================================================
// 1. DELETE ID PHOTOS ON APPROVAL  (pending → active)
// =====================================================
exports.deleteIdPhotosOnApproval = onDocumentUpdated(
    "barangays/{barangayId}/users/{uid}",
    async (event) => {
      const before = event.data.before.data();
      const after  = event.data.after.data();

      if (before.status !== "pending" || after.status !== "active") return null;

      const { barangayId, uid } = event.params;
      const bucket = getStorage().bucket();
      const db     = getFirestore();

      console.log(`User ${uid} approved — deleting ID photos...`);

      await Promise.all(
          [idPhotoFrontPath(barangayId, uid), idPhotoBackPath(barangayId, uid)]
              .map(async (path) => {
                try {
                  await bucket.file(path).delete();
                  console.log(`Deleted: ${path}`);
                } catch (err) {
                  if (err.code === 404) {
                    console.warn(`Already gone: ${path}`);
                  } else {
                    console.error(`Error deleting ${path}:`, err.message);
                  }
                }
              }),
      );

      await db
          .collection("barangays").doc(barangayId)
          .collection("users").doc(uid)
          .update({
            idFrontURL:          null,
            idBackURL:           null,
            idPhotosDeletedAt:   new Date().toISOString(),
          });

      console.log(`ID photos cleaned up for user ${uid}.`);
      return null;
    },
);


// =====================================================
// 2. DELETE AUTH + STORAGE + INDEX ON DOC DELETION
//    Fires when admin rejects an applicant
// =====================================================
exports.deleteAuthOnUserDocDeletion = onDocumentDeleted(
    "barangays/{barangayId}/users/{uid}",
    async (event) => {
      const { barangayId, uid } = event.params;
      const bucket = getStorage().bucket();
      const db     = getFirestore();

      await Promise.all(
          [idPhotoFrontPath(barangayId, uid), idPhotoBackPath(barangayId, uid)]
              .map(async (path) => {
                try {
                  await bucket.file(path).delete();
                } catch (err) {
                  if (err.code !== 404) {
                    console.error(`Error deleting ${path}:`, err.message);
                  }
                }
              }),
      );

      try {
        await db.collection("userIndex").doc(uid).delete();
        console.log(`userIndex deleted for: ${uid}`);
      } catch (err) {
        console.warn(`Could not delete userIndex for ${uid}:`, err.message);
      }

      try {
        await getAuth().deleteUser(uid);
        console.log(`Auth account deleted for rejected user: ${uid}`);
      } catch (err) {
        console.warn(`Could not delete auth for ${uid}:`, err.message);
      }

      return null;
    },
);


// =====================================================
// 3. POLL PAGASA RSS — runs every 30 minutes
//    Writes to siteAlerts — picked up by alerts.js
//    onSnapshot on every open browser tab automatically.
//
//    BARANGAY_ID must match your Firestore doc ID
//    (same output as barangayId('Bancod') → 'bancod').
// =====================================================

const BARANGAY_ID  = "bancod"; // ← change if your barangay ID differs
const MAX_AGE_HOURS = 12;       // ignore bulletins older than this

const PAGASA_FEEDS = [
  {
    url:      "https://www.pagasa.dost.gov.ph/rss/weather-warning",
    type:     "weather",
    severity: "orange",
    label:    "PAGASA Weather Warning",
  },
  {
    url:      "https://www.pagasa.dost.gov.ph/rss/tropical-cyclone-bulletin",
    type:     "weather",
    severity: "red",
    label:    "PAGASA Typhoon Bulletin",
  },
];

exports.pollPagasaAlerts = onSchedule("every 30 minutes", async () => {
  const db     = getFirestore();
  const parser = new Parser({ timeout: 10_000 });
  const col    = db.collection(`barangays/${BARANGAY_ID}/siteAlerts`);
  const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;

  for (const feed of PAGASA_FEEDS) {
    let parsed;

    try {
      parsed = await parser.parseURL(feed.url);
    } catch (err) {
      // Network hiccup or PAGASA downtime — log and move on,
      // never crash the whole run over one feed
      console.warn(`[pagasa] Could not fetch ${feed.url}:`, err.message);
      continue;
    }

    if (!parsed.items?.length) continue;

    // Only look at the single most recent item per feed
    const item    = parsed.items[0];
    const pubDate = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();

    if (pubDate < cutoff) {
      console.log(`[pagasa] Stale — skipping: ${item.title}`);
      continue;
    }

    // Stable dedup key derived from the item link or title.
    // Using the doc ID for idempotent set() means re-polling
    // the same bulletin never creates duplicate alerts.
    const dedupId = `pagasa-${Buffer
      .from(item.link || item.title || String(pubDate))
      .toString("base64")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 40)}`;

    const existing = await col.doc(dedupId).get();
    if (existing.exists) {
      console.log(`[pagasa] Already stored: ${dedupId}`);
      continue;
    }

    // PAGASA RSS descriptions are HTML — strip tags before storing
    const rawDesc   = item.contentSnippet || item.summary || item.content || "";
    const cleanDesc = rawDesc
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280);

    await col.doc(dedupId).set({
      type:        feed.type,
      severity:    feed.severity,
      title:       `${feed.label}: ${(item.title || "").trim()}`,
      message:     cleanDesc || "See the PAGASA website for the full bulletin.",
      source:      "pagasa",
      active:      true,
      dismissible: true,
      // Auto-expires so old bulletins vanish without admin action
      expiresAt:   Timestamp.fromMillis(pubDate + MAX_AGE_HOURS * 60 * 60 * 1000),
      createdAt:   Timestamp.now(),
      createdBy:   "system",
    });

    console.log(`[pagasa] Stored: ${feed.label} — ${item.title}`);
  }

  console.log("[pagasa] Poll complete.");
});