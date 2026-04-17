// js/roles.js
// =====================================================
// Users & Roles tab — scoped to admin's barangay.
// Firestore path: barangays/{barangayId}/users/{uid}
// =====================================================

import { auth, db } from './firebase-config.js';
import { usersCol, userDoc, userIndexDoc } from './db-paths.js';
import {
  query, where, onSnapshot,
  updateDoc, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";


// =====================================================
// STATE
// =====================================================
let allUsers          = [];
let currentFilter     = 'all';
let currentSearch     = '';
let adminBarangay     = '';
let adminUid          = '';
let currentHousehold = '';

let pendingChange     = null;


// =====================================================
// TAB SWITCHING
// =====================================================
window.switchTab = function(tab) {
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`panel-${tab}`).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
};


// =====================================================
// INIT
// =====================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const indexSnap = await getDoc(userIndexDoc(user.uid));
  if (!indexSnap.exists() || indexSnap.data().role !== 'admin') return;

  adminUid      = user.uid;
  adminBarangay = indexSnap.data().barangay || '';

  // Write lastSeen for the admin themselves
  try {
    await updateDoc(userDoc(adminBarangay, user.uid), {
      lastSeen: serverTimestamp(),
    });
  } catch (e) {
    console.warn('lastSeen write failed:', e.message);
  }

  loadUsers();
});


// =====================================================
// LOAD USERS
// =====================================================
function loadUsers() {
  const table = document.getElementById('usersTable');

  const q = query(
    usersCol(adminBarangay),
    where('status', '==', 'active')
  );

  onSnapshot(q, (snapshot) => {
    allUsers = [];
    snapshot.forEach((docSnap) => {
      const d = docSnap.data();
      allUsers.push({
        uid:        docSnap.id,
        fullName:   d.fullName ?? `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim(),
        email:      d.email    ?? '',
        phone:      d.phone ?? '',
        role:       d.role     ?? 'resident',
        barangay:   d.barangay ?? '',
        residentIdNumber: d.residentIdNumber ?? '—',
        streetAddress: d.streetAddress ?? '',
        householdId:   d.householdId   ?? '',
        createdAt:  d.createdAt,
        lastSeen:   d.lastSeen  ?? null,
        superAdmin: d.superAdmin === true,
      });
    });
    renderUsers();
  });
}


// =====================================================
// RENDER
// =====================================================
function renderUsers() {
  const table = document.getElementById('usersTable');
  let list = [...allUsers];

  if (currentFilter !== 'all') list = list.filter(u => u.role === currentFilter);

  if (currentSearch) 
  {
    const q = currentSearch.toLowerCase();
    const qClean = q.replace(/-/g, '');
    list = list.filter(u => {
      const id      = (u.residentIdNumber ?? '').toLowerCase();
      const idClean = id.replace(/-/g, '');
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)    ||
        id.includes(q)                       ||
        idClean.includes(qClean)
      );
    });
  }

  list.sort((a, b) => {
    if (a.uid === adminUid) return -1;
    if (b.uid === adminUid) return  1;
    return a.fullName.localeCompare(b.fullName);
  });

  if (list.length === 0) {
    table.innerHTML = `<div class="users-empty">No users found.</div>`;
    lucide.createIcons({ el: table });
    return;
  }

  if (currentHousehold) {
    list = list.filter(u => u.householdId === currentHousehold);
  }

  table.innerHTML = list.map(u => buildUserRow(u)).join('');
  buildHouseholdBar();
  lucide.createIcons({ el: table });
  initTooltips();   // attach JS tooltips after each render
}


// =====================================================
// BUILD USER ROW
// =====================================================
function buildUserRow(user) {
  const isMe         = user.uid === adminUid;
  const isSuperAdmin = user.superAdmin === true;

  const initials       = getInitials(user.fullName);
  const roleBadgeClass = `role-badge--${user.role}`;
  const joinDate       = user.createdAt?.toDate?.()
    ? user.createdAt.toDate().toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';

  const { statusClass, statusLabel } = getStatusInfo(user.lastSeen);

  const youChip = isMe
    ? `<span class="you-chip" title="You cannot change your own role"><i data-lucide="user-check"></i> You</span>`
    : '';

  const superBadge = isSuperAdmin
    ? `<span class="super-badge" title="Protected — cannot be modified by any admin"><i data-lucide="crown"></i> Protected</span>`
    : '';

  const makeBtn = (role, icon) => {
    const isCurrent = user.role === role;
    const currentClass = isCurrent ? `current-role current-role--${role}` : '';
    const colorClass   = `role-action-btn--${role}`;

    let tooltip;
    let disabled = '';

    if (isSuperAdmin)      { disabled = 'disabled'; tooltip = 'Protected — cannot be modified'; }
    else if (isMe)         { disabled = 'disabled'; tooltip = "This is you — you can't change your own role"; }
    else if (isCurrent)    { disabled = 'disabled'; tooltip = `Already ${roleDisplayName(role)}`; }
    else                   { tooltip = `Set as ${roleDisplayName(role)}`; }

    return `<button
      class="role-action-btn ${colorClass} ${currentClass}"
      data-tooltip="${tooltip}"
      onclick="openRoleModal('${user.uid}', '${escapeAttr(user.fullName)}', '${user.role}', '${role}', ${isSuperAdmin}, ${isMe})"
      ${disabled}
    ><i data-lucide="${icon}"></i></button>`;
  };

    return `
    <div class="user-row" id="row-${user.uid}" ${isMe ? 'style="background:#f8fdf9"' : ''}>

      <!-- COL 1: Avatar + Name + Since + Resident ID -->
      <div class="user-info">
        <div class="user-avatar user-avatar--${user.role}">${initials}</div>
        <div style="min-width:0;">
          <div class="user-name">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">${escapeHtml(user.fullName)}</span>
            ${youChip}${superBadge}
          </div>
          <div class="user-since">Since ${joinDate}</div>
          <div style="font-size:0.72rem;color:#aaa;margin-top:2px;font-family:monospace;">${escapeHtml(user.residentIdNumber)}</div>
        </div>
      </div>

      <!-- COL 2: Email + Phone (separate column, truncates cleanly) -->
      <div style="min-width:0;display:flex;flex-direction:column;gap:3px;overflow:hidden;">
        <span style="font-size:0.82rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#333;">${escapeHtml(user.email)}</span>
        <span style="font-size:0.78rem;color:#999;">${escapeHtml(user.phone || '—')}</span>
        <span style="font-size:0.75rem;color:#bbb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(user.streetAddress || '—')}
        </span>
      </div>

      <!-- COL 3: Role badge -->
      <div class="role-badge ${roleBadgeClass}">
        <i data-lucide="${roleIconName(user.role)}"></i>
        ${roleDisplayName(user.role)}
      </div>

      <!-- COL 4: Status -->
      <div class="status-dot ${statusClass}">${statusLabel}</div>

      <!-- COL 5: Role action buttons -->
      <div class="role-actions">
        ${makeBtn('resident', 'user')}
        ${makeBtn('officer',  'shield')}
        ${makeBtn('admin',    'settings')}
      </div>

    </div>
  `;
}

// =====================================================
//                  JS TOOLTIP
// =====================================================
function initTooltips() {
  const tip = document.getElementById('adminTooltip');

  document.querySelectorAll('[data-tooltip]').forEach(el => {
    // Remove old listeners by cloning (clean slate each render)
    el.addEventListener('mouseenter', (e) => {
      const text = el.getAttribute('data-tooltip');
      if (!text) return;

      tip.textContent = text;
      tip.classList.add('visible');

      // Rebuild arrow (textContent clears children)
      positionTooltip(tip, el);
    });

    el.addEventListener('mousemove', () => positionTooltip(tip, el));

    el.addEventListener('mouseleave', () => {
      tip.classList.remove('visible');
    });
  });
}

function positionTooltip(tip, anchor) {
  const rect   = anchor.getBoundingClientRect();
  const tipW   = tip.offsetWidth;
  const tipH   = tip.offsetHeight;
  const margin = 8;

  // Center horizontally above the button
  let left = rect.left + rect.width / 2 - tipW / 2;
  let top  = rect.top - tipH - margin;

  // Clamp to viewport so it never clips
  const vw = window.innerWidth;
  if (left < margin)        left = margin;
  if (left + tipW > vw - margin) left = vw - margin - tipW;

  // If it would go above the viewport, flip below
  if (top < margin) top = rect.bottom + margin;

  tip.style.left = `${left}px`;
  tip.style.top  = `${top}px`;
}


// =====================================================
// STATUS
// =====================================================
function getStatusInfo(lastSeen) {
  if (!lastSeen) return { statusClass: 'status-dot--offline', statusLabel: 'Offline' };
  const seenDate   = lastSeen?.toDate?.() ?? new Date(lastSeen);
  const minutesAgo = (Date.now() - seenDate.getTime()) / 60000;
  if (minutesAgo <= 5)  return { statusClass: 'status-dot--online',  statusLabel: 'Online' };
  if (minutesAgo <= 60) return { statusClass: 'status-dot--recent',  statusLabel: 'Recently active' };
                        return { statusClass: 'status-dot--offline', statusLabel: 'Offline' };
}


// =====================================================
// FILTER + SEARCH
// =====================================================
window.setRoleFilter = function(role, btn) {
  currentFilter = role;
  document.querySelectorAll('.role-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderUsers();
};

window.filterUsers = function() {
  currentSearch = document.getElementById('rolesSearch').value.trim();
  renderUsers();
};


// =====================================================
// MODAL
// =====================================================
window.openRoleModal = function(uid, name, currentRole, newRole, isSuperAdmin, isMe) {
  if (currentRole === newRole || isSuperAdmin || isMe) return;

  pendingChange = { uid, name, currentRole, newRole };

  const icon       = document.getElementById('modalIcon');
  const iconInner  = document.getElementById('modalIconInner');
  const confirmBtn = document.getElementById('modalConfirmBtn');
  const adminWrap  = document.getElementById('adminConfirmWrap');
  const adminInput = document.getElementById('adminConfirmInput');

  icon.className = `modal__icon modal__icon--${newRole}`;
  iconInner.setAttribute('data-lucide', roleIconName(newRole));
  lucide.createIcons({ el: icon });

  document.getElementById('modalTitle').textContent = `Assign as ${roleDisplayName(newRole)}`;

  document.getElementById('modalBody').innerHTML =
    `You are about to change <strong>${escapeHtml(name)}</strong>'s role
     from <strong>${roleDisplayName(currentRole)}</strong>
     to <strong>${roleDisplayName(newRole)}</strong>.
     ${newRole === 'admin'
       ? `<br><br>⚠️ <strong>Administrator access grants full control</strong> over this barangay panel.
          Only assign this to someone you fully trust.`
       : 'This takes effect immediately.'
     }`;

  if (newRole === 'admin') {
    adminWrap.classList.add('visible');
    adminInput.value = '';
    adminInput.classList.remove('error');
    confirmBtn.disabled = true;
    confirmBtn.classList.add('admin-confirm');
    confirmBtn.textContent = 'Assign as Admin';
  } else {
    adminWrap.classList.remove('visible');
    confirmBtn.disabled = false;
    confirmBtn.classList.remove('admin-confirm');
    confirmBtn.textContent = `Assign as ${roleDisplayName(newRole)}`;
  }

  document.getElementById('roleModal').classList.add('visible');
};

window.closeModal = function() {
  document.getElementById('roleModal').classList.remove('visible');
  pendingChange = null;
};

window.onAdminConfirmInput = function() {
  const input = document.getElementById('adminConfirmInput');
  const btn   = document.getElementById('modalConfirmBtn');
  const valid = input.value.trim() === 'CONFIRM ADMIN';
  btn.disabled = !valid;
  input.classList.toggle('error', input.value.length > 0 && !valid);
};

document.getElementById('roleModal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});


// =====================================================
// CONFIRM ROLE CHANGE
// =====================================================
window.confirmRoleChange = async function() {
  if (!pendingChange) return;

  const { uid, name, newRole } = pendingChange;
  const btn = document.getElementById('modalConfirmBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    // Update both the main doc and the index
    await updateDoc(userDoc(adminBarangay, uid), {
      role:          newRole,
      roleUpdatedAt: serverTimestamp(),
    });
    await updateDoc(userIndexDoc(uid), { role: newRole });

    closeModal();
    showToast(`${name} is now a ${roleDisplayName(newRole)}.`, 'success');

  } catch (err) {
    console.error('Role update failed:', err);
    closeModal();
    showToast('Failed to update role. Try again.', 'error');
  }
};


// =====================================================
// TOAST
// =====================================================
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast     = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <i data-lucide="${type === 'success' ? 'check-circle' : 'alert-circle'}"></i>
    ${escapeHtml(message)}
  `;
  container.appendChild(toast);
  lucide.createIcons({ el: toast });
  setTimeout(() => {
    toast.style.opacity    = '0';
    toast.style.transform  = 'translateY(12px)';
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    setTimeout(() => toast.remove(), 350);
  }, 3500);
}


// =====================================================
// HOUSEHOLD
// =====================================================
window.setHouseholdFilter = function(id) {
  currentHousehold = id;
  renderUsers();
};

function buildHouseholdBar() {
  const bar = document.getElementById('householdBar');
  if (!bar) return;

  const counts = {};
  allUsers.forEach(u => {
    if (u.householdId) counts[u.householdId] = (counts[u.householdId] || 0) + 1;
  });
  const grouped = Object.keys(counts).filter(id => counts[id] >= 2);

  // Hide the whole section if nothing to show
  const section = bar.closest('div[style]') ?? bar.parentElement;
  if (grouped.length === 0 && !currentHousehold) {
    if (section) section.style.display = 'none';
    bar.innerHTML = '';
    return;
  }
  if (section) section.style.display = '';

  bar.innerHTML = grouped.map(hid => {
    const count   = counts[hid];
    const address = allUsers.find(u => u.householdId === hid)?.streetAddress || hid;
    const active  = currentHousehold === hid
      ? 'style="background:#1a3a1a;color:white;border-color:#1a3a1a"'
      : '';
    return `<button class="role-filter-btn" onclick="setHouseholdFilter('${hid}')" ${active}>
      <i data-lucide="home"></i> ${escapeHtml(address)}&nbsp;<strong>(${count})</strong>
    </button>`;
  }).join('') + (currentHousehold
    ? `<button class="role-filter-btn" onclick="setHouseholdFilter('')">
        <i data-lucide="x"></i> Clear
       </button>`
    : '');

  lucide.createIcons({ el: bar });
}

// =====================================================
// HELPERS
// =====================================================
function getInitials(name) {
  return name.split(' ').slice(0, 2).map(n => n[0] ?? '').join('').toUpperCase();
}
function roleDisplayName(role) {
  return { resident: 'Resident', officer: 'Barangay Officer', admin: 'Administrator' }[role] ?? role;
}
function roleIconName(role) {
  return { resident: 'user', officer: 'shield', admin: 'settings' }[role] ?? 'user';
}
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escapeAttr(str) {
  return String(str).replace(/'/g,"\\'");
}