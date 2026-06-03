/**
 * Topbar user widget — avatar + dropdown + sign-in button.
 *
 * Pure DOM module: takes a profile-shaped object and toggles which of
 * the two topbar states is shown (signed-in vs guest). The actual
 * sign-in/sign-out flow lives in auth.js + main.js's orchestrator —
 * this module only renders.
 *
 * Dropdown toggle uses a one-shot document-level click listener to
 * close on outside-click, so we don't burn a permanent listener for a
 * rarely-opened menu.
 */

export function updateTopbarUser(p) {
  var el       = document.getElementById('topbarUser');
  var photo    = document.getElementById('topbarUserPhoto');
  var name     = document.getElementById('topbarUserName');
  var signInEl = document.getElementById('topbarSignInBtn');
  if (!el) return;

  var signedIn = !!(p && p.type !== 'guest' && p.picture);

  if (signedIn) {
    photo.src = p.picture;
    photo.alt = p.name;
    if (name) name.textContent = p.name;
    el.removeAttribute('hidden');
    if (signInEl) signInEl.setAttribute('hidden', '');
  } else {
    el.setAttribute('hidden', '');
    // Show "Sign in" in the top bar for guests / signed-out users
    if (signInEl) signInEl.removeAttribute('hidden');
  }
}

export function toggleUserMenu() {
  var dd = document.getElementById('topbarDropdown');
  if (!dd) return;
  if (dd.hasAttribute('hidden')) {
    dd.removeAttribute('hidden');
    // Close when clicking outside
    setTimeout(function () {
      document.addEventListener('click', closeUserMenu, { once: true });
    }, 0);
  } else {
    dd.setAttribute('hidden', '');
  }
}

export function closeUserMenu() {
  var dd = document.getElementById('topbarDropdown');
  if (dd) dd.setAttribute('hidden', '');
}
