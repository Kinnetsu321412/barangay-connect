// functions/index.js
// =====================================================
// Cloud Functions — Firebase Admin SDK
// =====================================================

const {
  onDocumentUpdated,
  onDocumentDeleted,
} = require("firebase-functions/v2/firestore");

const {initializeApp} = require("firebase-admin/app");
const {getStorage} = require("firebase-admin/storage");
const {getFirestore} = require("firebase-admin/firestore");
const {getAuth} = require("firebase-admin/auth");

initializeApp();


// =====================================================
// PATH HELPERS — must mirror db-paths.js on the client
// =====================================================

/**
 * Returns the storage path for a user's front ID photo.
 * @param {string} barangayId - The ID of the barangay.
 * @param {string} uid - The user's UID.
 * @return {string} Full storage path to the front ID photo.
 */
function idPhotoFrontPath(barangayId, uid) {
  return `barangays/${barangayId}/id-photos/${uid}/front.webp`;
}

/**
 * Returns the storage path for a user's back ID photo.
 * @param {string} barangayId - The ID of the barangay.
 * @param {string} uid - The user's UID.
 * @return {string} Full storage path to the back ID photo.
 */
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
      const after = event.data.after.data();

      if (before.status !== "pending" || after.status !== "active") return null;

      const {barangayId, uid} = event.params;
      const bucket = getStorage().bucket();
      const db = getFirestore();

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
            idFrontURL: null,
            idBackURL: null,
            idPhotosDeletedAt: new Date().toISOString(),
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
      const {barangayId, uid} = event.params;
      const bucket = getStorage().bucket();
      const db = getFirestore();

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
