// js/location.js
// =====================================================
// Cascading location dropdowns using the PSGC API
// (Philippine Standard Geographic Code — official gov data)
//
// API base: https://psgc.gitlab.io/api
//
// Flow: Province → Municipality/City → Barangay
// Each select is disabled until the parent is chosen.
// =====================================================

const PSGC = 'https://psgc.gitlab.io/api';

// =====================================================
// ELEMENTS
// =====================================================
const provinceSelect     = document.getElementById('province');
const municipalitySelect = document.getElementById('municipality');
const barangaySelect     = document.getElementById('barangay');

const provinceError     = document.getElementById('provinceError');
const municipalityError = document.getElementById('municipalityError');
const barangayError     = document.getElementById('barangayError');


// =====================================================
// HELPERS
// =====================================================

// Sorts an array of { name } objects alphabetically
function sortByName(arr) {
  return arr.sort((a, b) => a.name.localeCompare(b.name));
}

// Sets a select to a loading state while data is fetching
function setLoading(selectEl, labelEl, isLoading, loadingText = 'Loading...') {
  selectEl.disabled = isLoading;
  if (isLoading) {
    selectEl.innerHTML = `<option value="">${loadingText}</option>`;
    if (labelEl) labelEl.classList.add('form-label--loading');
  } else {
    if (labelEl) labelEl.classList.remove('form-label--loading');
  }
}

// Resets a select to its default disabled/empty state
function resetSelect(selectEl, placeholder) {
  selectEl.innerHTML = `<option value="" disabled selected>${placeholder}</option>`;
  selectEl.disabled = true;
}

// Clears a field error span
function clearError(el) {
  if (el) el.textContent = '';
}


// =====================================================
// LOAD PROVINCES on page load
// =====================================================
export async function initLocationDropdowns() {
  const provinceLabel     = document.querySelector('label[for="province"]');

  setLoading(provinceSelect, provinceLabel, true, 'Loading provinces...');

  try {
    const res  = await fetch(`${PSGC}/provinces/`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const sorted = sortByName(data);

    provinceSelect.innerHTML = `<option value="" disabled selected>Select your province</option>`;
    sorted.forEach(({ code, name }) => {
      const opt = document.createElement('option');
      opt.value       = code;
      opt.textContent = name;
      provinceSelect.appendChild(opt);
    });

    provinceSelect.disabled = false;

  } catch (err) {
    console.error('Failed to load provinces:', err);
    provinceSelect.innerHTML = `<option value="">Failed to load — refresh page</option>`;
    provinceSelect.disabled = true;
  }
}


// =====================================================
// ON PROVINCE CHANGE → load municipalities/cities
// =====================================================
if (provinceSelect) {
  provinceSelect.addEventListener('change', async () => {
    const code = provinceSelect.value;
    clearError(provinceError);

    // Reset downstream
    resetSelect(municipalitySelect, 'Select your municipality / city');
    resetSelect(barangaySelect,     'Select your barangay');

    if (!code) return;

    const municipalityLabel = document.querySelector('label[for="municipality"]');
    setLoading(municipalitySelect, municipalityLabel, true, 'Loading municipalities...');

    try {
      const res  = await fetch(`${PSGC}/provinces/${code}/cities-municipalities/`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const sorted = sortByName(data);

      municipalitySelect.innerHTML = `<option value="" disabled selected>Select your municipality / city</option>`;
      sorted.forEach(({ code: mCode, name }) => {
        const opt = document.createElement('option');
        opt.value       = mCode;
        opt.textContent = name;
        municipalitySelect.appendChild(opt);
      });

      municipalitySelect.disabled = false;

    } catch (err) {
      console.error('Failed to load municipalities:', err);
      municipalitySelect.innerHTML = `<option value="">Failed to load — try again</option>`;
      municipalitySelect.disabled = true;
    }
  });
}


// =====================================================
// ON MUNICIPALITY CHANGE → load barangays
// =====================================================
if (municipalitySelect) {
  municipalitySelect.addEventListener('change', async () => {
    const code = municipalitySelect.value;
    clearError(municipalityError);

    // Reset downstream
    resetSelect(barangaySelect, 'Select your barangay');

    if (!code) return;

    const barangayLabel = document.querySelector('label[for="barangay"]');
    setLoading(barangaySelect, barangayLabel, true, 'Loading barangays...');

    try {
      const res  = await fetch(`${PSGC}/cities-municipalities/${code}/barangays/`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const sorted = sortByName(data);

      barangaySelect.innerHTML = `<option value="" disabled selected>Select your barangay</option>`;
      sorted.forEach(({ code: bCode, name }) => {
        const opt = document.createElement('option');
        // Store the barangay name as the value (what gets saved to Firestore)
        // If you want the PSGC code stored instead, use bCode
        opt.value       = name;
        opt.dataset.code = bCode;
        opt.textContent = name;
        barangaySelect.appendChild(opt);
      });

      barangaySelect.disabled = false;

    } catch (err) {
      console.error('Failed to load barangays:', err);
      barangaySelect.innerHTML = `<option value="">Failed to load — try again</option>`;
      barangaySelect.disabled = true;
    }
  });
}
