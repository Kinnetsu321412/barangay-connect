// functions/index.js
// =====================================================
// Cloud Function: deleteIdPhotosOnApproval
//
// Triggers automatically when a user document in
// Firestore changes from status "pending" -> "active".
//
// What it does:
//   1. Detects the status change
//   2. Deletes both ID photos from Firebase Storage
//   3. Clears the idFrontURL and idBackURL fields
//      in the user's Firestore document
//
// This means the admin panel only needs to do ONE
// thing: set status to "active". The cleanup is
// fully automatic.
// =====================================================

const {onDocumentUpdated} = require("firebase-functions/v2/firestore");
const {initializeApp} = require("firebase-admin/app");
const {getStorage} = require("firebase-admin/storage");
const {getFirestore} = require("firebase-admin/firestore");

initializeApp();

exports.deleteIdPhotosOnApproval = onDocumentUpdated(
    "users/{uid}",
    async (event) => {
      const before = event.data.before.data();
      const after = event.data.after.data();

      // ---- Only run when status changes pending -> active ----
      if (before.status !== "pending" || after.status !== "active") {
        return null;
      }

      const uid = event.params.uid;
      const bucket = getStorage().bucket();
      const db = getFirestore();

      console.log(`User ${uid} approved — deleting ID photos...`);

      // ---- Delete both photos from Firebase Storage ----
      const paths = [
        `id-photos/${uid}/front.webp`,
        `id-photos/${uid}/back.webp`,
      ];

      await Promise.all(
          paths.map(async (path) => {
            try {
              await bucket.file(path).delete();
              console.log(`Deleted: ${path}`);
            } catch (err) {
              if (err.code === 404) {
                console.warn(`File not found (already deleted?): ${path}`);
              } else {
                console.error(`Error deleting ${path}:`, err.message);
              }
            }
          }),
      );

      // ---- Clear the URLs from the Firestore user document ----
      await db.collection("users").doc(uid).update({
        idFrontURL: null,
        idBackURL: null,
        idPhotosDeletedAt: new Date().toISOString(),
      });

      console.log(`ID photos cleaned up for user ${uid}.`);
      return null;
    },
);
