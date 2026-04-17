// js/register.js
// =====================================================
// Handles: 3-step registration form
// Uploads: ID photos to Firebase Storage (barangay-scoped)
// Saves:   User data to Firestore barangay subcollection
//          + lightweight userIndex entry for auth routing
// =====================================================

import { auth, db } from './firebase-config.js';
import { uploadIdPhotos } from './storage.js';
import {
  userDoc,
  userIndexDoc,
  barangayCounterDoc,
  barangayAbbrev,
  barangayId as toBid,
} from './db-paths.js';
import { initLocationDropdowns } from './location.js';
import {
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  setDoc, runTransaction, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


// =====================================================
// STATE
// =====================================================
const formData = {
  firstName:     '',
  lastName:      '',
  email:         '',
  phone:         '',
  dob:           '',
  password:      '',
  province:      '',
  municipality:  '',
  barangay:      '',
  yearsResident: '',
  idType:        '',
  idNumber:      '',
  idFrontURL:    '',
  idBackURL:     '',
  addrPhase:  '',
  addrBlock:  '',
  addrLot:    '',
  addrPurok:  '',
  addrStreet: '',
};

let currentStep  = 1;
let idFrontFile  = null;
let idBackFile   = null;


// =====================================================
// ELEMENTS
// =====================================================
const steps = {
  1: document.getElementById('step1'),
  2: document.getElementById('step2'),
  3: document.getElementById('step3'),
};
const successScreen  = document.getElementById('successScreen');
const registerHeader = document.querySelector('.register-header');
const stepIndicator  = document.getElementById('stepIndicator');

const stepDots   = [null, document.getElementById('stepDot1'), document.getElementById('stepDot2'), document.getElementById('stepDot3')];
const connectors = [null, document.getElementById('connector1'), document.getElementById('connector2')];

const step1Form      = document.getElementById('step1Form');
const toggleRegPw    = document.getElementById('toggleRegPassword');
const regPassword    = document.getElementById('regPassword');

const step2Form      = document.getElementById('step2Form');
const step2Back      = document.getElementById('step2Back');

const step3Form      = document.getElementById('step3Form');
const step3Back      = document.getElementById('step3Back');
const step3Btn       = document.getElementById('step3Btn');
const submitSpinner  = document.getElementById('submitSpinner');
const submitError    = document.getElementById('submitError');

const uploadFrontArea = document.getElementById('uploadFrontArea');
const uploadBackArea  = document.getElementById('uploadBackArea');
const idPhotoFront    = document.getElementById('idPhotoFront');
const idPhotoBack     = document.getElementById('idPhotoBack');
const previewFront    = document.getElementById('previewFront');
const previewBack     = document.getElementById('previewBack');


// =====================================================
// STEP NAVIGATION
// =====================================================
function goToStep(n) {
  Object.values(steps).forEach(el => { if (el) el.hidden = true; });
  if (steps[n]) steps[n].hidden = false;
  currentStep = n;
  updateStepIndicator(n);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStepIndicator(active) {
  stepDots.forEach((dot, i) => {
    if (!dot) return;
    dot.classList.remove('active', 'completed', 'pending');
    if (i < active)        dot.classList.add('completed');
    else if (i === active) dot.classList.add('active');
    else                   dot.classList.add('pending');

    const circle = dot.querySelector('.step-item__circle');
    if (i < active) {
      circle.innerHTML = '<i data-lucide="check"></i>';
    } else {
      circle.textContent = i;
    }
  });

  connectors.forEach((c, i) => {
    if (!c) return;
    c.classList.toggle('active', i < active);
  });

  lucide.createIcons();
}


// =====================================================
// STEP 1 — SUBMIT
// =====================================================
if (step1Form) {
  step1Form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validateStep1()) return;

    formData.firstName = document.getElementById('firstName').value.trim();
    formData.lastName  = document.getElementById('lastName').value.trim();
    formData.email     = document.getElementById('regEmail').value.trim();
    formData.phone     = document.getElementById('phone').value.trim();
    formData.dob       = document.getElementById('dob').value;
    formData.password  = document.getElementById('regPassword').value;

    goToStep(2);

    if (!window._locationInit) {
      initLocationDropdowns();
      window._locationInit = true;
    }
  });
}

if (toggleRegPw) {
  toggleRegPw.addEventListener('click', () => {
    const isPassword = regPassword.type === 'password';
    regPassword.type = isPassword ? 'text' : 'password';
    toggleRegPw.innerHTML = isPassword
      ? '<i data-lucide="eye-off"></i>'
      : '<i data-lucide="eye"></i>';
    lucide.createIcons();
  });
}


// =====================================================
// STEP 2 — SUBMIT + BACK
// =====================================================
if (step2Back) step2Back.addEventListener('click', () => goToStep(1));

if (step2Form) {
  step2Form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validateStep2()) return;

    const provinceEl     = document.getElementById('province');
    const municipalityEl = document.getElementById('municipality');
    const barangayEl     = document.getElementById('barangay');

    formData.province     = provinceEl.options[provinceEl.selectedIndex].text;
    formData.municipality = municipalityEl.options[municipalityEl.selectedIndex].text;
    formData.barangay     = barangayEl.options[barangayEl.selectedIndex].text;
    formData.yearsResident = document.getElementById('yearsResident').value;
    formData.addrPhase  = document.getElementById('addrPhase').value.trim();
    formData.addrBlock  = document.getElementById('addrBlock').value.trim();
    formData.addrLot    = document.getElementById('addrLot').value.trim();
    formData.addrPurok  = document.getElementById('addrPurok').value.trim();
    formData.addrStreet = document.getElementById('addrStreet').value.trim();
    goToStep(3);
  });
}


// =====================================================
// STEP 3 — FILE UPLOAD PREVIEWS
// =====================================================
uploadFrontArea.addEventListener('click', () => idPhotoFront.click());
uploadBackArea.addEventListener('click',  () => idPhotoBack.click());

idPhotoFront.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!isValidImage(file)) { showFieldError('idFrontError', 'File must be JPG, PNG, or WEBP under 5MB.'); return; }
  idFrontFile = file;
  showImagePreview(previewFront, uploadFrontArea, file);
  clearFieldError('idFrontError');
});

idPhotoBack.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!isValidImage(file)) { showFieldError('idBackError', 'File must be JPG, PNG, or WEBP under 5MB.'); return; }
  idBackFile = file;
  showImagePreview(previewBack, uploadBackArea, file);
  clearFieldError('idBackError');
});

function isValidImage(file) {
  return ['image/jpeg','image/png','image/webp'].includes(file.type) && file.size <= 5 * 1024 * 1024;
}

function showImagePreview(imgEl, areaEl, file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    imgEl.src = e.target.result;
    imgEl.style.display = 'block';
    areaEl.querySelectorAll('[data-lucide], .upload-area__label, .upload-area__hint')
      .forEach(el => el.style.display = 'none');
  };
  reader.readAsDataURL(file);
}


// =====================================================
// STEP 3 — BACK
// =====================================================
if (step3Back) step3Back.addEventListener('click', () => goToStep(2));


// =====================================================
// STEP 3 — SUBMIT
// =====================================================
if (step3Form) {
  step3Form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateStep3()) return;

    formData.idType   = document.getElementById('idType').value;
    formData.idNumber = document.getElementById('idNumber').value.trim();

    setSubmitLoading(true);
    submitError.textContent = '';

    let createdUser = null;

    try {
      // 1. Create Firebase Auth account
      const userCredential = await createUserWithEmailAndPassword(
        auth, formData.email, formData.password
      );
      createdUser = userCredential.user;
      const uid = userCredential.user.uid;

      // 2. Upload ID photos — barangay-scoped path
      //    Storage: id-photos/{barangayId}/{uid}/front.webp
      const { frontURL, backURL } = await uploadIdPhotos(
        formData.barangay,
        uid,
        idFrontFile,
        idBackFile
      );

      formData.idFrontURL = frontURL;
      formData.idBackURL  = backURL;

      // 3. Assign a sequential resident ID number via Firestore transaction.
      //    The counter doc lives at: barangays/{barangayId}/meta/counter
      //    Shape: { total: <number> }
      //    The transaction ensures two simultaneous registrations never get
      //    the same number even under heavy load.
      //
      //    Format: BRY-[ABBREV]-[YEAR]-[00001]
      //      ABBREV = first 3 letters of barangay name, uppercase
      //      YEAR   = 4-digit registration year
      //      Seq    = zero-padded 5-digit counter (resets per barangay, not per year)
      //
      //    Examples:
      //      BRY-BAN-2024-00001   (1st resident of Bancod)
      //      BRY-SAN-2025-00042   (42nd resident of San Isidro)
      const counterRef = barangayCounterDoc(formData.barangay);
      let assignedIdNumber;

      await runTransaction(db, async (tx) => {
        const counterSnap = await tx.get(counterRef);
        const prevTotal   = counterSnap.exists() ? (counterSnap.data().total ?? 0) : 0;
        const nextTotal   = prevTotal + 1;

        tx.set(counterRef, { total: nextTotal }, { merge: true });

        const year    = new Date().getFullYear();
        const abbrev  = barangayAbbrev(formData.barangay);   // e.g. "BAN"
        const padded  = String(nextTotal).padStart(5, '0');  // e.g. "00001"
        assignedIdNumber = `BRY-${abbrev}-${year}-${padded}`;
      });

      // 4. Compute validUntil (3 years from now) as a Firestore Timestamp.
      //    Stored on the doc so admins can extend or revoke it independently
      //    of createdAt — no more hardcoding on the frontend.
      const validUntilDate = new Date();
      validUntilDate.setFullYear(validUntilDate.getFullYear() + 3);
      const validUntilTimestamp = Timestamp.fromDate(validUntilDate);

      // 5a. Save full user profile to barangay subcollection
      //     Firestore: barangays/{barangayId}/users/{uid}
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
        addrPhase:     formData.addrPhase,
        addrBlock:     formData.addrBlock,
        addrLot:       formData.addrLot,
        addrPurok:     formData.addrPurok,
        addrStreet:    formData.addrStreet,
        streetAddress: buildAddressString(formData),
        householdId:   generateHouseholdId(formData.barangay, formData),
        idType:        formData.idType,
        idNumber:      formData.idNumber,
        idFrontURL:    formData.idFrontURL,
        idBackURL:     formData.idBackURL,
        residentIdNumber: assignedIdNumber,   
        validUntil:    validUntilTimestamp,  
        role:          'resident',
        status:        'pending',
        createdAt:     serverTimestamp(),
      });

      // 5b. Write lightweight index for fast auth routing
      //     Firestore: userIndex/{uid}
      await setDoc(userIndexDoc(uid), {
        barangay:         formData.barangay,
        barangayId:       toBid(formData.barangay),
        municipality:     formData.municipality,
        province:         formData.province,  
        role:             'resident',
        status:           'pending',
        residentIdNumber: assignedIdNumber,
        householdId: generateHouseholdId(formData.barangay, formData),
      });

      // 6. Sign out and show success
      await signOut(auth);
      showSuccess();

    } catch (error) {
      // Rollback: delete the Auth account if anything after it failed,
      // so the email is freed and the user can try again.
      // NOTE: the counter increment is NOT rolled back — gaps in the sequence
      // are acceptable and much safer than a double-rollback race condition.
      if (createdUser) {
        try { await createdUser.delete(); } catch (e) {
          console.warn('Could not roll back auth account:', e.message);
        }
      }

      setSubmitLoading(false);
      submitError.textContent = getRegisterErrorMessage(error.code, error.message);
    }
  });
}


// =====================================================
// SUCCESS SCREEN
// =====================================================
function showSuccess() {
  Object.values(steps).forEach(el => { if (el) el.hidden = true; });
  registerHeader.hidden = true;
  stepIndicator.hidden  = true;
  successScreen.classList.add('show');
}


// =====================================================
// VALIDATION
// =====================================================
function validateStep1() {
  clearAllErrors(['firstNameError','lastNameError','regEmailError','phoneError','dobError','regPasswordError']);
  let valid = true;

  const firstName = document.getElementById('firstName').value.trim();
  const lastName  = document.getElementById('lastName').value.trim();
  const email     = document.getElementById('regEmail').value.trim();
  const phone     = document.getElementById('phone').value.trim();
  const dob       = document.getElementById('dob').value;
  const password  = document.getElementById('regPassword').value;

  if (!firstName) { showFieldError('firstNameError', 'First name is required.'); valid = false; }
  if (!lastName)  { showFieldError('lastNameError',  'Last name is required.');  valid = false; }

  if (!email) {
    showFieldError('regEmailError', 'Email is required.'); valid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showFieldError('regEmailError', 'Enter a valid email address.'); valid = false;
  }

  if (!phone) {
    showFieldError('phoneError', 'Phone number is required.'); valid = false;
  } else if (!/^09\d{9}$/.test(phone)) {
    showFieldError('phoneError', 'Enter a valid PH number (e.g. 09XX XXX XXXX).'); valid = false;
  }

  if (!dob) {
    showFieldError('dobError', 'Date of birth is required.'); valid = false;
  } else if (getAge(dob) < 15) {
    showFieldError('dobError', 'You must be at least 15 years old to register.'); valid = false;
  }

  if (!password) {
    showFieldError('regPasswordError', 'Password is required.'); valid = false;
  } else if (password.length < 8) {
    showFieldError('regPasswordError', 'Password must be at least 8 characters.'); valid = false;
  }

  return valid;
}

function validateStep2() {
  clearAllErrors(['provinceError','municipalityError','barangayError','yearsError']);
  let valid = true;
  const addrPhase = document.getElementById('addrPhase').value.trim();
  const addrBlock = document.getElementById('addrBlock').value.trim();

  if (!addrPhase) {
    showFieldError('addressError', 'Phase is required.');
    valid = false;
  } else if (!addrBlock) {
    showFieldError('addressError', 'Block is required.');
    valid = false;
  } else {
    clearFieldError('addressError');
  }
  if (!document.getElementById('province').value)
    { showFieldError('provinceError', 'Please select your province.'); valid = false; }
  if (!document.getElementById('municipality').value)
    { showFieldError('municipalityError', 'Please select your municipality.'); valid = false; }
  if (!document.getElementById('barangay').value)
    { showFieldError('barangayError', 'Please select your barangay.'); valid = false; }
  if (!document.getElementById('yearsResident').value || document.getElementById('yearsResident').value < 0)
    { showFieldError('yearsError', 'Enter how many years you have been a resident.'); valid = false; }

  return valid;
}

function validateStep3() {
  clearAllErrors(['idTypeError','idNumberError','idFrontError','idBackError']);
  let valid = true;

  if (!document.getElementById('idType').value)
    { showFieldError('idTypeError', 'Please select your ID type.'); valid = false; }
  if (!document.getElementById('idNumber').value.trim())
    { showFieldError('idNumberError', 'ID number is required.'); valid = false; }
  if (!idFrontFile)
    { showFieldError('idFrontError', 'Please upload the front of your ID.'); valid = false; }
  if (!idBackFile)
    { showFieldError('idBackError', 'Please upload the back of your ID.'); valid = false; }

  const tosCheckbox = document.getElementById('tosAgree');
  const tosError    = document.getElementById('tosError');
  if (!tosCheckbox.checked) {
    tosError.textContent = 'You must agree to the terms before submitting.';
    tosCheckbox.focus();
    valid = false;
  } else {
    tosError.textContent = '';
  }

  return valid;
}


// =====================================================
// HELPERS
// =====================================================
function showFieldError(id, message) {
  const el = document.getElementById(id);
  if (el) el.textContent = message;
}

function clearFieldError(id) {
  const el = document.getElementById(id);
  if (el) el.textContent = '';
}

function clearAllErrors(ids) { ids.forEach(clearFieldError); }

function getAge(dobString) {
  const today = new Date();
  const birth  = new Date(dobString);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function setSubmitLoading(isLoading) {
  step3Btn.disabled    = isLoading;
  submitSpinner.hidden = !isLoading;
  step3Btn.querySelector('span:first-of-type').textContent = isLoading
    ? 'Submitting…'
    : 'Submit Registration';
}

function getRegisterErrorMessage(code, fallback) {
  const messages = {
    'auth/email-already-in-use':   'An account with that email already exists. Try signing in.',
    'auth/invalid-email':          'That email address is not valid.',
    'auth/weak-password':          'Password is too weak. Use at least 8 characters.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return messages[code] || fallback || 'Something went wrong. Please try again.';
}

function buildAddressString(data) {
  const parts = [];
  if (data.addrPhase)  parts.push(data.addrPhase);
  if (data.addrBlock)  parts.push(`Blk. ${data.addrBlock}`);
  if (data.addrLot)    parts.push(`Lot ${data.addrLot}`);
  if (data.addrStreet) parts.push(data.addrStreet);
  if (data.addrPurok)  parts.push(data.addrPurok);
  return parts.join(', ');
}

function generateHouseholdId(barangay, data) {
  const n = s => (s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  // Phase + block are required
  // Lot included if present.
  const key = [n(data.addrPhase), n(data.addrBlock), n(data.addrLot)]
    .filter(Boolean)
    .join('_');
  return `${toBid(barangay)}_${key}`;
}