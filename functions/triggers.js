// functions/index.js
// =====================================================
// Cloud Functions — Firebase Admin SDK
// =====================================================

const {
  onDocumentUpdated,
  onDocumentDeleted,
  onDocumentCreated,
} = require("firebase-functions/v2/firestore");

const {onSchedule} = require("firebase-functions/v2/scheduler");

const {initializeApp} = require("firebase-admin/app");
const {getStorage} = require("firebase-admin/storage");
const {
  getFirestore,
  Timestamp,
} = require("firebase-admin/firestore");
const {getAuth} = require("firebase-admin/auth");

const Parser = require("rss-parser");

initializeApp();

// =====================================================
// PATH HELPERS
// =====================================================

function idPhotoFrontPath(barangayId, uid) {
  return `barangays/${barangayId}/id-photos/${uid}/front.webp`;
}

function idPhotoBackPath(barangayId, uid) {
  return `barangays/${barangayId}/id-photos/${uid}/back.webp`;
}

// =====================================================
// 1. DELETE ID PHOTOS ON APPROVAL
// =====================================================

exports.deleteIdPhotosOnApproval = onDocumentUpdated(
    "barangays/{barangayId}/users/{uid}",
    async (event) => {
      const before = event.data.before.data();
      const after = event.data.after.data();

      if (before.status !== "pending" || after.status !== "active") {
        return null;
      }

      const {barangayId, uid} = event.params;
      const bucket = getStorage().bucket();
      const db = getFirestore();

      await Promise.all(
          [idPhotoFrontPath(barangayId, uid), idPhotoBackPath(barangayId, uid)].map(
              async (path) => {
                try {
                  await bucket.file(path).delete();
                } catch (err) {
                  if (err.code !== 404) {
                    console.error(`Error deleting ${path}:`, err.message);
                  }
                }
              },
          ),
      );

      await db
          .collection("barangays")
          .doc(barangayId)
          .collection("users")
          .doc(uid)
          .update({
            idFrontURL: null,
            idBackURL: null,
            idPhotosDeletedAt: new Date().toISOString(),
          });

      return null;
    },
);

// =====================================================
// 2. DELETE AUTH ON USER DOC DELETE
// =====================================================

exports.deleteAuthOnUserDocDeletion = onDocumentDeleted(
    "barangays/{barangayId}/users/{uid}",
    async (event) => {
      const {barangayId, uid} = event.params;
      const bucket = getStorage().bucket();
      const db = getFirestore();

      await Promise.all(
          [idPhotoFrontPath(barangayId, uid), idPhotoBackPath(barangayId, uid)].map(
              async (path) => {
                try {
                  await bucket.file(path).delete();
                } catch (err) {
                  if (err.code !== 404) {
                    console.error(`Error deleting ${path}:`, err.message);
                  }
                }
              },
          ),
      );

      try {
        await db.collection("userIndex").doc(uid).delete();
      } catch (err) {
        console.warn(err.message);
      }

      try {
        await getAuth().deleteUser(uid);
      } catch (err) {
        console.warn(err.message);
      }

      return null;
    },
);

// =====================================================
// 3. PAGASA POLLER
// =====================================================

const BARANGAY_ID = "bancod";
const MAX_AGE_HOURS = 12;

const PAGASA_FEEDS = [
  {
    url: "https://www.pagasa.dost.gov.ph/rss/weather-warning",
    type: "weather",
    severity: "orange",
    label: "PAGASA Weather Warning",
  },
  {
    url:
      "https://www.pagasa.dost.gov.ph/rss/tropical-cyclone-bulletin",
    type: "weather",
    severity: "red",
    label: "PAGASA Typhoon Bulletin",
  },
];

exports.pollPagasaAlerts = onSchedule(
    "every 30 minutes",
    async () => {
      const db = getFirestore();
      const parser = new Parser({timeout: 10000});
      const col = db.collection(
          `barangays/${BARANGAY_ID}/siteAlerts`,
      );

      const cutoff =
      Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;

      for (const feed of PAGASA_FEEDS) {
        let parsed;

        try {
          parsed = await parser.parseURL(feed.url);
        } catch (err) {
          console.warn(err.message);
          continue;
        }

        if (!parsed.items?.length) continue;

        const item = parsed.items[0];
        const pubDate = item.pubDate ?
        new Date(item.pubDate).getTime() :
        Date.now();

        if (pubDate < cutoff) continue;

        const dedupId = `pagasa-${Buffer.from(
            item.link || item.title || String(pubDate),
        )
            .toString("base64")
            .replace(/[^a-zA-Z0-9]/g, "")
            .slice(0, 40)}`;

        const existing = await col.doc(dedupId).get();
        if (existing.exists) continue;

        const rawDesc =
        item.contentSnippet ||
        item.summary ||
        item.content ||
        "";

        const cleanDesc = rawDesc
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 280);

        await col.doc(dedupId).set({
          type: feed.type,
          severity: feed.severity,
          title: `${feed.label}: ${(item.title || "").trim()}`,
          message:
          cleanDesc ||
          "See the PAGASA website for full bulletin.",
          source: "pagasa",
          active: true,
          dismissible: true,
          expiresAt: Timestamp.fromMillis(
              pubDate + MAX_AGE_HOURS * 60 * 60 * 1000,
          ),
          createdAt: Timestamp.now(),
          createdBy: "system",
        });
      }

      return null;
    },
);

// =====================================================
// 4. LIKE NOTIFICATION
// =====================================================

exports.notifyOnLike = onDocumentCreated(
    "barangays/{barangayId}/announcements/{postId}/likes/{likerId}",
    async (event) => {
      const {barangayId, postId, likerId} = event.params;
      const db = getFirestore();

      const postSnap = await db
          .collection(`barangays/${barangayId}/announcements`)
          .doc(postId)
          .get();

      if (!postSnap.exists) return null;

      const post = postSnap.data();
      const authorId = post.authorId;

      if (!authorId || authorId === likerId) return null;

      const likerSnap = await db
          .collection(`barangays/${barangayId}/users`)
          .doc(likerId)
          .get();

      const likerName = likerSnap.exists ?
      likerSnap.data().fullName ?? "Someone" :
      "Someone";

      await db
          .collection(
              `barangays/${barangayId}/users/${authorId}/notifications`,
          )
          .add({
            type: "like",
            postId,
            postTitle: post.title ?? "",
            actorName: likerName,
            read: false,
            createdAt: new Date(),
          });

      return null;
    },
);

// =====================================================
// 5. COMMENT NOTIFICATION
// =====================================================

exports.notifyOnComment = onDocumentCreated(
    "barangays/{barangayId}/announcements/{postId}/comments/{commentId}",
    async (event) => {
      const {barangayId, postId} = event.params;
      const db = getFirestore();

      const comment = event.data.data();

      const postSnap = await db
          .collection(`barangays/${barangayId}/announcements`)
          .doc(postId)
          .get();

      if (!postSnap.exists) return null;

      const post = postSnap.data();
      const authorId = post.authorId;

      if (!authorId || authorId === comment.authorId) {
        return null;
      }

      await db
          .collection(
              `barangays/${barangayId}/users/${authorId}/notifications`,
          )
          .add({
            type: "comment",
            postId,
            postTitle: post.title ?? "",
            actorName: comment.authorName ?? "Someone",
            read: false,
            createdAt: new Date(),
          });

      return null;
    },
);
