// js/nav-auth.js
// Shared across all pages.
// Resolves the logged-in user's role and sets body class + navbar pill.
// profile.js imports and calls this too, so logic lives in one place.

import { auth } from './firebase-config.js';
import { initNotifications } from './notifications.js';
import { userIndexDoc } from './db-paths.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export function initNavAuth({ onResolved } = {}) {
  // Apply cached role instantly — no flash
  const cached = sessionStorage.getItem('bc_role');
  if (cached) _applyRole(cached);

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      sessionStorage.removeItem('bc_role');
      document.body.removeAttribute('data-role-init');
      return;
    }
    try {
      const snap = await getDoc(userIndexDoc(user.uid));
      const role = snap.exists() ? (snap.data().role || 'resident') : 'resident';
      sessionStorage.setItem('bc_role', role);
      _applyRole(role);
      const barangay = snap.data().barangay;
      initNotifications(barangay, user.uid);
      onResolved?.({ user, role, barangay: snap.data().barangay });
    } catch (_) {
    } finally {
      document.body.removeAttribute('data-role-init');
    }
  });
}

function _applyRole(role) {
  document.body.className = `role-${role}`;
  const navRoleEl = document.getElementById('navRole');
  if (navRoleEl) {
    const label = { resident: 'Resident', officer: 'Barangay Officer', admin: 'Admin' }[role] || 'Resident';
    navRoleEl.textContent = label;
    navRoleEl.className   = `navbar__role navbar__role--${role}`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const mobileDrawer = document.getElementById('mobileDrawer');
  if (hamburgerBtn && mobileDrawer) {
    hamburgerBtn.addEventListener('click', () => mobileDrawer.classList.toggle('is-open'));
  }

  const navbar = document.getElementById('mainNavbar');
  if (navbar) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 60) {
        navbar.classList.remove('navbar--transparent');
      } else {
        navbar.classList.add('navbar--transparent');
      }
    }, { passive: true });
  }
});

// Auto-run on every page that imports this file
initNavAuth();