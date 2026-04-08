// =====================================================
// MIGRATION NOTES — register.js + auth.js
// Update these two files to use the new Firestore structure.
// =====================================================


// ─────────────────────────────────────────────────
// register.js — Step 3 submit (setDoc section)
// Replace the existing setDoc call with these two writes:
// ─────────────────────────────────────────────────

import { userDoc, userIndexDoc, barangayId } from './db-paths.js';
import { doc, setDoc, serverTimestamp } from "firebase-firestore.js"; // already imported

// REPLACE the existing setDoc block with:

const bId = barangayId(formData.barangay);  // e.g. "san_isidro"

// 1. Full user doc under their barangay
await setDoc(userDoc(formData.barangay, uid), {
  uid,
  firstName:     formData.firstName,
  lastName:      formData.lastName,
  fullName:      `${formData.firstName} ${formData.lastName}`,
  email:         formData.email,
  phone:         formData.phone,
  dob:           formData.dob,
  province:      formData.province,
  municipality:  formData.municipality,
  barangay:      formData.barangay,
  yearsResident: Number(formData.yearsResident),
  idType:        formData.idType,
  idNumber:      formData.idNumber,
  idFrontURL:    formData.idFrontURL,
  idBackURL:     formData.idBackURL,
  role:          'resident',
  status:        'pending',
  createdAt:     serverTimestamp(),
});

// 2. Lightweight index for fast auth lookup
await setDoc(userIndexDoc(uid), {
  barangay: formData.barangay,   // human-readable, matches Firestore doc ID barangayId()
  role:     'resident',
  status:   'pending',
});


// ─────────────────────────────────────────────────
// auth.js — getUserRole + login flow
// Replace getDoc(doc(db,'users', uid)) lookups with
// the two-step index → full doc pattern.
// ─────────────────────────────────────────────────

import { userDoc, userIndexDoc } from './db-paths.js';

// REPLACE the existing login flow after signInWithEmailAndPassword:

const userCredential = await signInWithEmailAndPassword(auth, email, password);
const user = userCredential.user;

// Step 1: fast index lookup (status + barangay + role)
const indexSnap = await getDoc(userIndexDoc(user.uid));
if (!indexSnap.exists()) {
  await signOut(auth);
  loginError.textContent = 'Account not found. Contact the barangay office.';
  return;
}

const { status, role, barangay } = indexSnap.data();

if (status === 'pending') {
  await signOut(auth);
  loginError.textContent = 'Your account is pending barangay approval. Please check back in 1–2 business days.';
  setLoading(false);
  return;
}

if (status === 'inactive') {
  await signOut(auth);
  loginError.textContent = 'Your account has been deactivated. Please contact the barangay office.';
  setLoading(false);
  return;
}

// Write lastSeen to the full user doc
await updateDoc(userDoc(barangay, user.uid), {
  lastSeen: serverTimestamp(),
});

redirectByRole(role);


// ─────────────────────────────────────────────────
// triggers.js (Cloud Functions) — update paths
// The Cloud Functions use Admin SDK paths.
// Replace "users/{uid}" collection references with
// "barangays/{barangayId}/users/{uid}".
//
// Since Cloud Functions receive the full document path
// in the event, you can extract barangayId like this:
// ─────────────────────────────────────────────────

// REPLACE trigger pattern from:
//   exports.deleteIdPhotosOnApproval = onDocumentUpdated("users/{uid}", ...)
// TO:
exports.deleteIdPhotosOnApproval = onDocumentUpdated(
  "barangays/{barangayId}/users/{uid}",
  async (event) => {
    const { barangayId, uid } = event.params;
    // rest of logic is identical — just use uid for storage paths
  }
);

// Same for deleteAuthOnUserDocDeletion:
exports.deleteAuthOnUserDocDeletion = onDocumentDeleted(
  "barangays/{barangayId}/users/{uid}",
  async (event) => {
    const { uid } = event.params;
    // rest of logic is identical
  }
);

// Also delete the userIndex doc on rejection (add to the rejection trigger):
// await db.collection('userIndex').doc(uid).delete();
