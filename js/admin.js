// js/admin.js

import { auth, db } from './firebase-config.js';
import { deleteIdPhotos } from './storage.js';
import { usersCol, userDoc, userIndexDoc } from './db-paths.js';
import {
  query, where, onSnapshot,
  updateDoc, deleteDoc, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";


// =====================================================
// GUARD: Admins only. Fetches their barangay for scoping.
// =====================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }

  const indexSnap = await getDoc(userIndexDoc(user.uid));
  if (!indexSnap.exists()) { window.location.href = 'index.html'; return; }

  const { barangay, role } = indexSnap.data();
  if (role !== 'admin') { window.location.href = 'dashboard.html'; return; }

  loadPendingUsers(barangay, user.uid);
});


// =====================================================
// LOAD PENDING USERS — real-time, barangay-scoped
// Sorted: current admin's own entry first (if present),
//         then newest submissions at the top.
// =====================================================
function loadPendingUsers(barangay, currentUid) {
  const container    = document.getElementById('pendingList');
  const emptyState   = document.getElementById('emptyState');
  const loadingState = document.getElementById('loadingState');

  const q = query(
    usersCol(barangay),
    where('status', '==', 'pending')
  );

  onSnapshot(q, (snapshot) => {
    loadingState.hidden = true;

    const badge = document.getElementById('pendingBadgeCount');
    if (badge) {
      badge.textContent   = snapshot.size;
      badge.style.display = snapshot.size > 0 ? 'inline' : 'none';
    }

    if (snapshot.empty) {
      emptyState.hidden  = false;
      container.innerHTML = '';
      return;
    }

    emptyState.hidden = true;

    // Build list, sort newest-first, current user always at top
    const users = snapshot.docs.map(d => ({
      uid:       d.id,
      _barangay: barangay,
      ...d.data(),
    }));

    users.sort((a, b) => {
      // Current admin's own entry always pins to top
      if (a.uid === currentUid) return -1;
      if (b.uid === currentUid) return  1;
      // Everyone else alphabetically by full name
      const aName = (a.fullName ?? `${a.firstName} ${a.lastName}`).toLowerCase();
      const bName = (b.fullName ?? `${b.firstName} ${b.lastName}`).toLowerCase();
      return aName.localeCompare(bName);
    });

    container.innerHTML = '';
    users.forEach(user => container.appendChild(buildCard(user)));
  });
}


// =====================================================
// BUILD APPLICANT CARD
// =====================================================
function buildCard(user) {
  const card = document.createElement('div');
  card.className = 'applicant-card';
  card.id = `card-${user.uid}`;

  const dob = user.dob
    ? new Date(user.dob).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

  const createdAt = user.createdAt?.toDate?.()
    ?.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    ?? '—';

  card.innerHTML = `
    <div class="applicant-card__header">
      <div class="applicant-card__name">${user.fullName ?? `${user.firstName} ${user.lastName}`}</div>
      <span class="badge badge--pending">Pending</span>
    </div>

    <div class="applicant-card__grid">
      <div class="detail-item">
        <span class="detail-item__label">Email</span>
        <span class="detail-item__value">${user.email}</span>
      </div>
      <div class="detail-item">
        <span class="detail-item__label">Phone</span>
        <span class="detail-item__value">${user.phone}</span>
      </div>
      <div class="detail-item">
        <span class="detail-item__label">Date of Birth</span>
        <span class="detail-item__value">${dob}</span>
      </div>
      <div class="detail-item">
        <span class="detail-item__label">Barangay</span>
        <span class="detail-item__value">${user.barangay}</span>
      </div>
      <div class="detail-item">
        <span class="detail-item__label">Years as Resident</span>
        <span class="detail-item__value">${user.yearsResident}</span>
      </div>
      <div class="detail-item">
        <span class="detail-item__label">ID Type</span>
        <span class="detail-item__value">${user.idType}</span>
      </div>
      <div class="detail-item">
        <span class="detail-item__label">ID Number</span>
        <span class="detail-item__value">${user.idNumber}</span>
      </div>
      <div class="detail-item">
        <span class="detail-item__label">Submitted</span>
        <span class="detail-item__value">${createdAt}</span>
      </div>
    </div>

    <div class="applicant-card__ids">
      <div class="id-photo-wrap">
        <span class="id-photo-wrap__label">Front of ID</span>
        ${user.idFrontURL
          ? `<a href="${user.idFrontURL}" target="_blank" rel="noopener">
               <img class="id-photo" src="${user.idFrontURL}" alt="ID Front" />
             </a>`
          : '<p class="id-photo--missing">Photo not available</p>'
        }
      </div>
      <div class="id-photo-wrap">
        <span class="id-photo-wrap__label">Back of ID</span>
        ${user.idBackURL
          ? `<a href="${user.idBackURL}" target="_blank" rel="noopener">
               <img class="id-photo" src="${user.idBackURL}" alt="ID Back" />
             </a>`
          : '<p class="id-photo--missing">Photo not available</p>'
        }
      </div>
    </div>

    <div class="applicant-card__actions">
      <button class="btn btn--danger"
        onclick="rejectUser('${user.uid}', '${user._barangay}', '${user.fullName ?? user.firstName}')">
        <i data-lucide="x-circle"></i> Reject
      </button>
      <button class="btn btn--success"
        onclick="approveUser('${user.uid}', '${user._barangay}', '${user.fullName ?? user.firstName}')">
        <i data-lucide="check-circle"></i> Approve
      </button>
    </div>

    <p class="applicant-card__feedback" id="feedback-${user.uid}"></p>
  `;

  lucide.createIcons({ el: card });
  return card;
}


// =====================================================
// APPROVE USER
// Sets status → active. Cloud Function deletes photos.
// =====================================================
window.approveUser = async function(uid, barangay, name) {
  if (!confirm(`Approve ${name}? They will be able to sign in immediately.`)) return;

  const btn      = document.querySelector(`#card-${uid} .btn--success`);
  const feedback = document.getElementById(`feedback-${uid}`);
  btn.disabled    = true;
  btn.textContent = 'Approving…';

  try {
    await updateDoc(userDoc(barangay, uid), {
      status:     'active',
      approvedAt: serverTimestamp(),
    });

    await updateDoc(userIndexDoc(uid), {
      role:   'resident',
      status: 'active',
    });

    // Card disappears via onSnapshot

  } catch (err) {
    console.error('Approve failed:', err);
    btn.disabled   = false;
    btn.innerHTML  = '<i data-lucide="check-circle"></i> Approve';
    feedback.textContent = 'Failed to approve. Try again.';
    feedback.style.color = 'red';
    lucide.createIcons({ el: btn });
  }
};


// =====================================================
// REJECT USER
// Client deletes photos + doc. CF cleans up Auth account.
// =====================================================
window.rejectUser = async function(uid, barangay, name) {
  if (!confirm(`Reject ${name}? This will permanently delete their application.`)) return;

  const btn      = document.querySelector(`#card-${uid} .btn--danger`);
  const feedback = document.getElementById(`feedback-${uid}`);
  btn.disabled    = true;
  btn.textContent = 'Rejecting…';

  try {
    await deleteIdPhotos(barangay, uid);    // storage.js — uses new barangay-first paths
    await deleteDoc(userDoc(barangay, uid)); // triggers CF → deletes Auth + userIndex
    // Card disappears via onSnapshot

  } catch (err) {
    console.error('Reject failed:', err);
    btn.disabled   = false;
    btn.innerHTML  = '<i data-lucide="x-circle"></i> Reject';
    feedback.textContent = 'Failed to reject. Try again.';
    feedback.style.color = 'red';
    lucide.createIcons({ el: btn });
  }
};