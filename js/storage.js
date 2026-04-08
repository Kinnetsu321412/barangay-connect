// js/storage.js
// =====================================================
// Handles all Firebase Storage uploads for the project.
// Import this in any file that needs image uploading.
//
// Storage paths now include barangay for organisation:
//   id-photos/{barangayId}/{uid}/front.webp
//   id-photos/{barangayId}/{uid}/back.webp
//   avatars/{barangayId}/{uid}.webp
// =====================================================

import { storage } from './firebase-config.js';
import { idPhotoFrontPath, idPhotoBackPath } from './db-paths.js';
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";


// =====================================================
// compressImage(file, maxWidthPx, qualityPercent)
// =====================================================
export function compressImage(file, maxWidth = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let width  = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width  = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('Image compression failed.')); return; }
          resolve(new File([blob], 'compressed.webp', { type: 'image/webp' }));
        },
        'image/webp',
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load image for compression.'));
    };

    img.src = url;
  });
}


// =====================================================
// uploadImage(file, storagePath)
// Compresses then uploads. Returns public download URL.
// =====================================================
export async function uploadImage(file, storagePath) {
  if (!file)        throw new Error('No file provided.');
  if (!storagePath) throw new Error('No storage path provided.');

  validateImageFile(file);

  const compressed = await compressImage(file);
  const storageRef = ref(storage, storagePath);

  const snapshot = await uploadBytes(storageRef, compressed, {
    contentType: 'image/webp',
    customMetadata: {
      originalName: file.name,
      uploadedAt:   new Date().toISOString(),
    },
  });

  return await getDownloadURL(snapshot.ref);
}


// =====================================================
// uploadIdPhotos(barangay, uid, frontFile, backFile)
//
// Uploads both ID photos scoped to the user's barangay.
// Paths: id-photos/{barangayId}/{uid}/front.webp
//        id-photos/{barangayId}/{uid}/back.webp
//
// Usage:
//   const { frontURL, backURL } = await uploadIdPhotos(barangay, uid, front, back);
// =====================================================
export async function uploadIdPhotos(barangay, uid, frontFile, backFile) {
  const [frontURL, backURL] = await Promise.all([
    uploadImage(frontFile, idPhotoFrontPath(barangay, uid)),
    uploadImage(backFile,  idPhotoBackPath(barangay, uid)),
  ]);

  return { frontURL, backURL };
}


// =====================================================
// deleteIdPhotos(barangay, uid)
//
// Deletes both ID photos for a user.
// Called on rejection (client-side) and on approval
// (Cloud Function). Both now use barangay-scoped paths.
//
// Usage:
//   await deleteIdPhotos(barangay, uid);
// =====================================================
export async function deleteIdPhotos(barangay, uid) {
  const paths = [
    idPhotoFrontPath(barangay, uid),
    idPhotoBackPath(barangay, uid),
  ];

  await Promise.all(
    paths.map(async (path) => {
      try {
        await deleteObject(ref(storage, path));
      } catch (err) {
        if (err.code !== 'storage/object-not-found') {
          console.warn(`Could not delete ${path}:`, err.message);
        }
      }
    })
  );
}


// =====================================================
// validateImageFile(file)
// =====================================================
export function validateImageFile(file) {
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX     = 5 * 1024 * 1024;

  if (!ALLOWED.includes(file.type)) throw new Error('Only JPG, PNG, or WEBP images are allowed.');
  if (file.size > MAX)              throw new Error('Image must be under 5MB.');
}


// =====================================================
// previewImage(file, imgElement)
// =====================================================
export function previewImage(file, imgElement) {
  if (!file || !imgElement) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    imgElement.src = e.target.result;
    imgElement.style.display = 'block';
  };
  reader.readAsDataURL(file);
}
