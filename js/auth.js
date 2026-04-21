// js/auth.js
// =====================================================
// Handles: Login form validation + Firebase sign-in
// Used on: login.html
// =====================================================

import { auth, db } from './firebase-config.js';
import { userDoc, userIndexDoc } from './db-paths.js';
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


// ---- Element references ----
const loginForm     = document.getElementById('loginForm');
const loginEmail    = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginBtn      = document.getElementById('loginBtn');
const loginSpinner  = document.getElementById('loginSpinner');
const loginError    = document.getElementById('loginError');
const emailError    = document.getElementById('emailError');
const passwordError = document.getElementById('passwordError');
const togglePwBtn   = document.getElementById('togglePassword');


// =====================================================
// 1. REDIRECT IF ALREADY LOGGED IN
// =====================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const indexSnap = await getDoc(userIndexDoc(user.uid));
  if (!indexSnap.exists()) return;

  const { barangay, status, role } = indexSnap.data(); // add barangay here

  if (status !== 'active') return;

  // ↓ add this before redirectByRole
  try {
    await updateDoc(userDoc(barangay, user.uid), {
      lastSeen: serverTimestamp(),
    });
  } catch (e) {
    console.warn('Could not write lastSeen:', e.message);
  }

  redirectByRole(role || 'resident');
});


// =====================================================
// 2. TOGGLE PASSWORD VISIBILITY
// =====================================================
if (togglePwBtn) {
  togglePwBtn.addEventListener('click', () => {
    const isPassword = loginPassword.type === 'password';
    loginPassword.type = isPassword ? 'text' : 'password';
    togglePwBtn.innerHTML = isPassword
      ? '<i data-lucide="eye-off"></i>'
      : '<i data-lucide="eye"></i>';
    lucide.createIcons();
  });
}


// =====================================================
// 3. FORM VALIDATION
// =====================================================
function validateLoginForm() {
  let valid = true;
  clearErrors();

  const email    = loginEmail.value.trim();
  const password = loginPassword.value;

  if (!email) {
    showError(emailError, loginEmail, 'Email address is required.');
    valid = false;
  } else if (!isValidEmail(email)) {
    showError(emailError, loginEmail, 'Please enter a valid email address.');
    valid = false;
  }

  if (!password) {
    showError(passwordError, loginPassword, 'Password is required.');
    valid = false;
  } else if (password.length < 6) {
    showError(passwordError, loginPassword, 'Password must be at least 6 characters.');
    valid = false;
  }

  return valid;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function showError(errorEl, inputEl, message) {
  if (errorEl) errorEl.textContent = message;
  if (inputEl) inputEl.classList.add('is-error');
}

function clearErrors() {
  [emailError, passwordError].forEach(el => { if (el) el.textContent = ''; });
  [loginEmail, loginPassword].forEach(el => { if (el) el.classList.remove('is-error'); });
  if (loginError) loginError.textContent = '';
}


// =====================================================
// 4. LOGIN FORM SUBMIT
// =====================================================
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateLoginForm()) return;

    setLoading(true);

    const email    = loginEmail.value.trim();
    const password = loginPassword.value;

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Step 1: fast index lookup — gets barangay, role, status
      const indexSnap = await getDoc(userIndexDoc(user.uid));
      if (!indexSnap.exists()) {
        await signOut(auth);
        setLoading(false);
        loginError.textContent = 'Account not found. Contact the barangay office.';
        return;
      }

      const { barangay, role, status } = indexSnap.data();

      if (status === 'pending') {
        await signOut(auth);
        setLoading(false);
        loginError.textContent = 'Your account is pending barangay approval. Please check back in 1–2 business days.';
        return;
      }

      if (status === 'inactive') {
        await signOut(auth);
        setLoading(false);
        loginError.textContent = 'Your account has been deactivated. Please contact the barangay office.';
        return;
      }

      // Step 2: write lastSeen to the full user doc (barangay-scoped path)
      try {
        await updateDoc(userDoc(barangay, user.uid), {
          lastSeen: serverTimestamp(),
        });
      // In auth.js — change the catch block
      } catch (e) {
        console.error('lastSeen FAILED:', e.code, e.message); // was console.warn
      }

      redirectByRole(role || 'resident');

    } catch (error) {
      setLoading(false);
      loginError.textContent = getFirebaseErrorMessage(error.code);
    }
  });
}


// =====================================================
// 5. HELPERS
// =====================================================
function redirectByRole(role) {
  switch (role) {
    case 'admin':   window.location.href = '../admin.html';     break;
    case 'officer': window.location.href = 'pages/home.html'; break;
    default:        window.location.href = 'pages/home.html'; break;
  }
}

function setLoading(isLoading) {
  loginBtn.disabled = isLoading;
  loginSpinner.hidden = !isLoading;
  loginBtn.querySelector('span:first-of-type').textContent = isLoading ? 'Signing in…' : 'Sign In';
}

function getFirebaseErrorMessage(code) {
  const messages = {
    'auth/user-not-found':         'No account found with that email address.',
    'auth/wrong-password':         'Incorrect password. Please try again.',
    'auth/invalid-email':          "That email address doesn't look right.",
    'auth/too-many-requests':      'Too many failed attempts. Please wait a moment.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/invalid-credential':     'Invalid email or password.',
  };
  return messages[code] || 'Something went wrong. Please try again.';
}