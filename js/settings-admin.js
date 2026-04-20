// js/settings-admin.js
// =====================================================
// Admin Settings page — writes to:
//   barangays/{barangayId}/meta/settings
//
// Currently manages:
//   requirePostApproval (boolean) — read by community-posts.js
// =====================================================

import { auth, db } from './firebase-config.js';
import { userIndexDoc, barangayId as toBid } from './db-paths.js';
import {
  doc, getDoc, setDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

let _barangayId = null;
let _settingsRef = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const snap = await getDoc(userIndexDoc(user.uid));
  if (!snap.exists()) return;

  const { barangay, role } = snap.data();
  if (role !== 'admin' && role !== 'officer') return;

  _barangayId = toBid(barangay);
  _settingsRef = doc(db, 'barangays', _barangayId, 'meta', 'settings');

  onSnapshot(_settingsRef, (settingsSnap) => {
    const data = settingsSnap.exists() ? settingsSnap.data() : {};
    renderSettings(data);
  });
});

function renderSettings(data) {
  const container = document.getElementById('settingsContainer');
  if (!container) return;

  const requireApproval = data.requirePostApproval ?? false;

  container.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:1.5rem;
      box-shadow:0 1px 4px rgba(0,0,0,.07);max-width:600px;">

      <h2 style="font-size:1rem;font-weight:700;margin:0 0 1.25rem;
        display:flex;align-items:center;gap:.5rem;">
        <i data-lucide="message-square" style="width:17px;height:17px;color:#1a3a1a;"></i>
        Community Posts
      </h2>

      <div style="display:flex;align-items:flex-start;justify-content:space-between;
        gap:1rem;padding:1rem;border:1.5px solid #e5e7eb;border-radius:10px;">
        <div>
          <p style="font-weight:600;font-size:.9rem;margin:0 0 4px;">Require post approval</p>
          <p style="font-size:.78rem;color:#6b7280;margin:0;line-height:1.5;">
            When enabled, resident community posts are saved as
            <strong>pending</strong> and won't appear in the bulletin
            until an admin publishes them.
          </p>
        </div>
        <label style="flex-shrink:0;cursor:pointer;position:relative;
          width:44px;height:24px;display:inline-block;">
          <input type="checkbox" id="requireApprovalToggle"
            ${requireApproval ? 'checked' : ''}
            onchange="handleRequireApprovalToggle(this)"
            style="opacity:0;width:0;height:0;position:absolute;" />
          <span id="toggleTrack" style="
            position:absolute;inset:0;border-radius:999px;
            background:${requireApproval ? '#1a3a1a' : '#d1d5db'};
            transition:background .2s;cursor:pointer;">
            <span style="
              position:absolute;top:3px;
              left:${requireApproval ? '23px' : '3px'};
              width:18px;height:18px;border-radius:50%;
              background:#fff;transition:left .2s;
              box-shadow:0 1px 3px rgba(0,0,0,.2);">
            </span>
          </span>
        </label>
      </div>

    </div>

    <div style="background:#fff;border-radius:12px;padding:1.5rem;
      box-shadow:0 1px 4px rgba(0,0,0,.07);max-width:600px;margin-top:1rem;">
      <h2 style="font-size:1rem;font-weight:700;margin:0 0 1.25rem;
        display:flex;align-items:center;gap:.5rem;">
        <i data-lucide="edit-3" style="width:17px;height:17px;color:#1a3a1a;"></i>
        Post Limits
      </h2>
      <div style="padding:1rem;border:1.5px solid #e5e7eb;border-radius:10px;">
        <p style="font-weight:600;font-size:.9rem;margin:0 0 4px;">Default daily post limit</p>
        <p style="font-size:.78rem;color:#6b7280;margin:0 0 .75rem;line-height:1.5;">
          How many posts a resident can make per day by default. Individual overrides in Users &amp; Roles take priority.
        </p>
        <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
          <input type="number" id="defaultPostLimitInput" min="1" max="99"
            value="${data.defaultPostLimit ?? 3}"
            style="width:60px;padding:.4rem .6rem;border:1.5px solid #e0e0e0;border-radius:8px;
              font-size:.88rem;text-align:center;outline:none;font-weight:600;" />
          <span style="font-size:.78rem;color:#6b7280;">posts per day</span>
          <button onclick="saveDefaultPostLimit()"
            style="padding:.4rem .9rem;border-radius:8px;background:#1a3a1a;
              color:#fff;border:none;font-size:.78rem;font-weight:600;cursor:pointer;">
            Save
          </button>
        </div>
      </div>
    </div>

    <div style="background:#fff;border-radius:12px;padding:1.5rem;
      box-shadow:0 1px 4px rgba(0,0,0,.07);max-width:600px;margin-top:1rem;">

      <h2 style="font-size:1rem;font-weight:700;margin:0 0 1.25rem;
        display:flex;align-items:center;gap:.5rem;">
        <i data-lucide="shield" style="width:17px;height:17px;color:#1a3a1a;"></i>
        Content Moderation
      </h2>

      <!-- Block links toggle -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;
        gap:1rem;padding:1rem;border:1.5px solid #e5e7eb;border-radius:10px;margin-bottom:.75rem;">
        <div>
          <p style="font-weight:600;font-size:.9rem;margin:0 0 4px;">Block links in posts</p>
          <p style="font-size:.78rem;color:#6b7280;margin:0;line-height:1.5;">
            Posts containing URLs will be automatically flagged for review.
          </p>
        </div>
        <label style="flex-shrink:0;cursor:pointer;position:relative;width:44px;height:24px;display:inline-block;">
          <input type="checkbox" id="blockLinksToggle"
            ${data.blockedLinksEnabled ?? true ? 'checked' : ''}
            onchange="handleBlockLinksToggle(this)"
            style="opacity:0;width:0;height:0;position:absolute;" />
          <span id="blockLinksTrack" style="position:absolute;inset:0;border-radius:999px;
            background:${data.blockedLinksEnabled ?? true ? '#1a3a1a' : '#d1d5db'};
            transition:background .2s;cursor:pointer;">
            <span style="position:absolute;top:3px;
              left:${data.blockedLinksEnabled ?? true ? '23px' : '3px'};
              width:18px;height:18px;border-radius:50%;background:#fff;
              transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2);"></span>
          </span>
        </label>
      </div>

      <!-- Blocked words -->
      <div style="padding:1rem;border:1.5px solid #e5e7eb;border-radius:10px;margin-bottom:.75rem;">
        <p style="font-weight:600;font-size:.9rem;margin:0 0 4px;">Blocked words</p>
        <p style="font-size:.78rem;color:#6b7280;margin:0 0 .75rem;line-height:1.5;">
          Posts containing these words will be flagged for review. One word or phrase per line.
        </p>
        <textarea id="blockedWordsInput" rows="5"
          style="width:100%;padding:.55rem .75rem;border:1.5px solid #e0e0e0;border-radius:8px;
            font-size:.82rem;outline:none;resize:vertical;box-sizing:border-box;"
          placeholder="e.g.&#10;badword&#10;offensive phrase&#10;spam link">${(data.blockedWords ?? []).join('\n')}</textarea>
        <div style="display:flex;gap:.5rem;margin-top:.5rem;flex-wrap:wrap;">
          <button onclick="loadDefaultBlockedWords()"
            style="padding:.4rem .9rem;border-radius:8px;border:1.5px solid #e0e0e0;
              background:#fff;color:#555;font-size:.78rem;font-weight:600;cursor:pointer;">
            What's this?
          </button>
          <button onclick="saveBlockedWords()"
            style="padding:.4rem .9rem;border-radius:8px;background:#1a3a1a;
              color:#fff;border:none;font-size:.78rem;font-weight:600;cursor:pointer;">
            Save Words
          </button>
        </div>
      </div>

      <!-- Post warning text -->
      <div style="padding:1rem;border:1.5px solid #e5e7eb;border-radius:10px;margin-bottom:.75rem;">
        <p style="font-weight:600;font-size:.9rem;margin:0 0 4px;">Community guidelines notice</p>
        <p style="font-size:.78rem;color:#6b7280;margin:0 0 .75rem;line-height:1.5;">
          Shown to residents in the new post modal as a reminder.
        </p>
        <textarea id="postWarningInput" rows="2"
          style="width:100%;padding:.55rem .75rem;border:1.5px solid #e0e0e0;border-radius:8px;
            font-size:.82rem;outline:none;resize:vertical;box-sizing:border-box;"
          placeholder="e.g. Offensive, hateful, or spam posts will be removed.">${data.postWarningText ?? ''}</textarea>
        <button onclick="savePostWarning()"
          style="margin-top:.5rem;padding:.4rem .9rem;border-radius:8px;background:#1a3a1a;
            color:#fff;border:none;font-size:.78rem;font-weight:600;cursor:pointer;">
          Save Notice
        </button>
      </div>

      <!-- Daily post report limit -->
      <div style="padding:1rem;border:1.5px solid #e5e7eb;border-radius:10px;margin-bottom:.75rem;">
        <p style="font-weight:600;font-size:.9rem;margin:0 0 4px;">Daily post report limit per resident</p>
        <p style="font-size:.78rem;color:#6b7280;margin:0 0 .75rem;line-height:1.5;">
          Maximum number of post reports a resident can submit per day. Prevents spam abuse.
        </p>
        <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
          <input type="number" id="reportLimitInput" min="1" max="99"
            value="${data.dailyReportLimit ?? 3}"
            style="width:60px;padding:.4rem .6rem;border:1.5px solid #e0e0e0;border-radius:8px;
              font-size:.88rem;text-align:center;outline:none;font-weight:600;" />
          <span style="font-size:.78rem;color:#6b7280;">reports per day</span>
          <button onclick="saveReportLimit()"
            style="padding:.4rem .9rem;border-radius:8px;background:#1a3a1a;
              color:#fff;border:none;font-size:.78rem;font-weight:600;cursor:pointer;">
            Save
          </button>
        </div>
      </div>

      <!-- Daily comment report limit -->
      <div style="padding:1rem;border:1.5px solid #e5e7eb;border-radius:10px;">
        <p style="font-weight:600;font-size:.9rem;margin:0 0 4px;">Daily comment report limit per resident</p>
        <p style="font-size:.78rem;color:#6b7280;margin:0 0 .75rem;line-height:1.5;">
          Maximum number of comment reports a resident can submit per day. Defaults to 5 if not set.
        </p>
        <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
          <input type="number" id="commentReportLimitInput" min="1" max="99"
            value="${data.dailyCommentReportLimit ?? 5}"
            style="width:60px;padding:.4rem .6rem;border:1.5px solid #e0e0e0;border-radius:8px;
              font-size:.88rem;text-align:center;outline:none;font-weight:600;" />
          <span style="font-size:.78rem;color:#6b7280;">reports per day</span>
          <button onclick="saveCommentReportLimit()"
            style="padding:.4rem .9rem;border-radius:8px;background:#1a3a1a;
              color:#fff;border:none;font-size:.78rem;font-weight:600;cursor:pointer;">
            Save
          </button>
        </div>
      </div>

    </div>`;

  lucide.createIcons({ el: container });
}

window.handleRequireApprovalToggle = async function(checkbox) {
  if (!_settingsRef) return;

  const track = document.getElementById('toggleTrack');
  if (track) {
    track.style.background = checkbox.checked ? '#1a3a1a' : '#d1d5db';
    track.querySelector('span').style.left = checkbox.checked ? '23px' : '3px';
  }

  showSettingsToast('Saving…');

  try {
    await setDoc(_settingsRef, {
      requirePostApproval: checkbox.checked,
    }, { merge: true });

    showSettingsToast('Saved ✓', 'success');
  } catch (err) {
    console.error('[settings] save error:', err);
    checkbox.checked = !checkbox.checked;
  }
};

window.loadDefaultBlockedWords = function() {
  const el = document.getElementById('blockedWordsInput');
  if (el) el.value = '';
  alert('Automatic profanity filtering is enabled. Use this list for custom local words only.');
};

window.saveBlockedWords = async function() {
  if (!_settingsRef) return;
  const words = (document.getElementById('blockedWordsInput')?.value ?? '')
    .split('\n').map(w => w.trim().toLowerCase()).filter(Boolean);
  showSettingsToast('Saving…');
  try {
    await setDoc(_settingsRef, { blockedWords: words }, { merge: true });
    showSettingsToast('Saved ✓', 'success');
  } catch (err) {
    showSettingsToast('Failed to save. Try again.', 'error');
  }
};

window.savePostWarning = async function() {
  if (!_settingsRef) return;
  const text = document.getElementById('postWarningInput')?.value.trim() ?? '';
  showSettingsToast('Saving…');
  try {
    await setDoc(_settingsRef, { postWarningText: text }, { merge: true });
    showSettingsToast('Saved ✓', 'success');
  } catch (err) {
    showSettingsToast('Failed to save. Try again.', 'error');
  }
};

window.saveDefaultPostLimit = async function() {
  if (!_settingsRef) return;
  const val = parseInt(document.getElementById('defaultPostLimitInput')?.value, 10);
  if (isNaN(val) || val < 1 || val > 99) return;
  showSettingsToast('Saving…');
  try {
    await setDoc(_settingsRef, { defaultPostLimit: val }, { merge: true });
    showSettingsToast('Saved ✓', 'success');
  } catch {
    showSettingsToast('Failed to save. Try again.', 'error');
  }
};

window.saveReportLimit = async function() {
  if (!_settingsRef) return;
  const val = parseInt(document.getElementById('reportLimitInput')?.value, 10);
  if (isNaN(val) || val < 1 || val > 99) return;
  showSettingsToast('Saving…');
  try {
    await setDoc(_settingsRef, { dailyReportLimit: val }, { merge: true });
    showSettingsToast('Saved ✓', 'success');
  } catch {
    showSettingsToast('Failed to save. Try again.', 'error');
  }
};

window.saveCommentReportLimit = async function() {
  if (!_settingsRef) return;
  const val = parseInt(document.getElementById('commentReportLimitInput')?.value, 10);
  if (isNaN(val) || val < 1 || val > 99) return;
  showSettingsToast('Saving…');
  try {
    await setDoc(_settingsRef, { dailyCommentReportLimit: val }, { merge: true });
    showSettingsToast('Saved ✓', 'success');
  } catch {
    showSettingsToast('Failed to save. Try again.', 'error');
  }
};

function showSettingsToast(msg, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.innerHTML = `<i data-lucide="${type === 'success' ? 'check' : 'x-circle'}"></i>${msg}`;
  container.appendChild(t);
  lucide.createIcons({ el: t });
  setTimeout(() => t.remove(), 3500);
}

window.handleBlockLinksToggle = async function(checkbox) {
  if (!_settingsRef) return;
  const track = document.getElementById('blockLinksTrack');
  if (track) {
    track.style.background = checkbox.checked ? '#1a3a1a' : '#d1d5db';
    track.querySelector('span').style.left = checkbox.checked ? '23px' : '3px';
  }
  try {
    await setDoc(_settingsRef, { blockedLinksEnabled: checkbox.checked }, { merge: true });
  } catch (err) {
    checkbox.checked = !checkbox.checked;
  }
};