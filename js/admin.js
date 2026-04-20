// js/admin.js

import { auth, db } from './firebase-config.js';
import { deleteIdPhotos } from './storage.js';
import { usersCol, userDoc, userIndexDoc } from './db-paths.js';
import {
  query, where, onSnapshot,
  updateDoc, deleteDoc, serverTimestamp, getDoc,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";


// =====================================================
// GUARD: Admins only. Fetches their barangay for scoping.
// =====================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = '../index.html'; return; }

  const indexSnap = await getDoc(userIndexDoc(user.uid));
  if (!indexSnap.exists()) { window.location.href = '../index.html'; return; }

  const { barangay, role } = indexSnap.data();
  if (role !== 'admin') { window.location.href = '../index.html'; return; }

  loadPendingUsers(barangay, user.uid);
});


// =====================================================
// LOAD PENDING USERS — real-time, by barangay
//  =====================================================
let allUsers = [];

function loadPendingUsers(barangay, currentUid) {
  const container    = document.getElementById('pendingList');
  const emptyState   = document.getElementById('emptyState');
  const loadingState = document.getElementById('loadingState');
  const searchInput  = document.getElementById('pendingSearch');

  function renderFiltered(term) {
    container.innerHTML = '';

    // No search term — show everything, or defer to the real empty state
    if (!term) {
      if (allUsers.length === 0) {
        emptyState.hidden = false;
        return;
      }
      emptyState.hidden = true;
      allUsers.forEach(user => container.appendChild(buildCard(user)));
      return;
    }

    // Strip dashes from the term too, so "BAN2024" and "00001" both match
    // "BRY-BAN-2024-00001" without the user needing to type exact formatting
    const termClean = term.replace(/-/g, '');

    const filtered = allUsers.filter(u => {
      const name    = (u.fullName ?? `${u.firstName ?? ''} ${u.lastName ?? ''}`).toLowerCase();
      const mail    = (u.email ?? '').toLowerCase();
      const id      = (u.residentIdNumber ?? '').toLowerCase();
      const idClean = id.replace(/-/g, '');

      return (
        name.includes(term)      ||
        mail.includes(term)      ||
        id.includes(term)        ||   // exact with dashes: "BRY-BAN"
        idClean.includes(termClean)   // without dashes:    "ban2024" or "00001"
      );
    });

    if (filtered.length === 0) {
      container.innerHTML = `<p style="color:#888;padding:1rem 0">No results for "${term}".</p>`;
      return;
    }

    filtered.forEach(user => container.appendChild(buildCard(user)));
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderFiltered(searchInput.value.trim().toLowerCase());
    });
  }
  
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

      const subBadge = document.getElementById('pendingSubBadge');
      if (subBadge) {
        subBadge.textContent = snapshot.size;
        subBadge.style.display = snapshot.size > 0 ? 'inline' : 'none';
      }
    }

    if (snapshot.empty) {
      emptyState.hidden   = false;
      container.innerHTML = '';
      return;
    }

    emptyState.hidden = true;

    allUsers = snapshot.docs.map(d => ({ uid: d.id, _barangay: barangay, ...d.data() }));
    allUsers.sort((a, b) => {
      if (a.uid === currentUid) return -1;
      if (b.uid === currentUid) return  1;
      const aName = (a.fullName ?? `${a.firstName} ${a.lastName}`).toLowerCase();
      const bName = (b.fullName ?? `${b.firstName} ${b.lastName}`).toLowerCase();
      return aName.localeCompare(bName);
    });

    // Re-apply whatever the admin has typed when the list refreshes live
    const term = searchInput?.value.trim().toLowerCase() ?? '';
    renderFiltered(term);
  });
}


// =====================================================
// BUILD APPLICANT CARD
// =====================================================
function buildCard(user) {
  const card = document.createElement('div');
  card.className = 'applicant-card';
  card.id = `card-${user.uid}`;

  // Store both photo URLs on the card element so the lightbox
  // can read them without embedding long Firebase URLs in onclick strings.
  card.dataset.idurls = JSON.stringify([
    { url: user.idFrontURL || '', label: 'Front of ID' },
    { url: user.idBackURL  || '', label: 'Back of ID'  },
  ]);

  const dob = user.dob
    ? new Date(user.dob).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

  const createdAt = user.createdAt?.toDate?.()
    ?.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    ?? '—';

  const frontThumb = user.idFrontURL
    ? `<img class="id-photo" src="${user.idFrontURL}" alt="ID Front"
          onclick="openLightbox(JSON.parse(this.closest('.applicant-card').dataset.idurls), 0)"
          title="Click to enlarge" />`
    : '<p class="id-photo--missing">Photo not available</p>';

  const backThumb = user.idBackURL
    ? `<img class="id-photo" src="${user.idBackURL}" alt="ID Back"
          onclick="openLightbox(JSON.parse(this.closest('.applicant-card').dataset.idurls), 1)"
          title="Click to enlarge" />`
    : '<p class="id-photo--missing">Photo not available</p>';

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
      <div class="detail-item" style="grid-column: 1 / -1;">
        <span class="detail-item__label">Home Address</span>
        <span class="detail-item__value">${user.streetAddress || '—'}</span>
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
      <div class="detail-item">
        <span class="detail-item__label">Resident ID</span>
        <span class="detail-item__value">${user.residentIdNumber ?? '—'}</span>
      </div>
    </div>

    <div class="applicant-card__ids">
      <div class="id-photo-wrap">
        <span class="id-photo-wrap__label">Front of ID</span>
        ${frontThumb}
      </div>
      <div class="id-photo-wrap">
        <span class="id-photo-wrap__label">Back of ID</span>
        ${backThumb}
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
// Sets status → active, scrubs all verification data.
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
      // Scrub verification data — no longer needed after approval
      idNumber:   deleteField(),
      idType:     deleteField(),
      idFrontURL: deleteField(),
      idBackURL:  deleteField(),
    });

    await updateDoc(userIndexDoc(uid), {
      role:   'resident',
      status: 'active',
    });

    // Also delete the Storage photos (belt-and-suspenders alongside the
    // Cloud Function path — whichever runs first, the other is a no-op)
    try {
      await deleteIdPhotos(barangay, uid);
    } catch (storageErr) {
      // Non-fatal — photos may already have been cleaned up by CF
      console.warn('Storage cleanup on approval:', storageErr.message);
    }

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
// Deletes photos + doc. Cloud Function cleans up Auth account.
// =====================================================
window.rejectUser = async function(uid, barangay, name) {
  if (!confirm(`Reject ${name}? This will permanently delete their application.`)) return;

  const btn      = document.querySelector(`#card-${uid} .btn--danger`);
  const feedback = document.getElementById(`feedback-${uid}`);
  btn.disabled    = true;
  btn.textContent = 'Rejecting…';

  try {
    await deleteIdPhotos(barangay, uid);     // storage.js — barangay-scoped paths
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
