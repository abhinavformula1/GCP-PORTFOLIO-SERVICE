(function () {
  'use strict';

  /* ── Google Sign-In ──────────────────────────────────────────
     Paste your OAuth 2.0 Client ID here after creating it in
     GCP Console → APIs & Services → Credentials.
     Leave empty ('') to skip the Google sign-in pre-step.
  ─────────────────────────────────────────────────────────── */
  var GOOGLE_CLIENT_ID = '647206478056-rd95imm61c309o4tc5ekddgkmk50fdvp.apps.googleusercontent.com';

  /* ── Google ID-token cache ───────────────────────────────────
     We hold the credential after sign-in so subsequent API calls
     (chat history, etc.) can authenticate as the user. Tokens are
     1-hour valid; on 401 we surface that to the caller and the
     user signs in again on next interaction.
  ─────────────────────────────────────────────────────────── */
  var googleCredential = sessionStorage.getItem('portfolio_credential') || null;
  function setGoogleCredential(token) {
    googleCredential = token || null;
    try {
      if (token) sessionStorage.setItem('portfolio_credential', token);
      else       sessionStorage.removeItem('portfolio_credential');
    } catch (_) {}
  }

  function authedFetch(url, opts) {
    opts = opts || {};
    if (!googleCredential) return Promise.resolve(null);
    var headers = Object.assign({}, opts.headers || {}, {
      'Authorization': 'Bearer ' + googleCredential,
      'Content-Type':  'application/json',
    });
    return fetch(url, Object.assign({}, opts, { headers: headers }))
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  // Persisted site-level profile (survives tab session)
  var siteProfile = (function () {
    try { return JSON.parse(sessionStorage.getItem('portfolio_profile') || 'null'); } catch (_) { return null; }
  }());

  // Pending chat history loaded after sign-in — applied when chat opens
  var pendingChatHistory = null;

  // The signed-in visitor's existing recommendation, if any. Recomputed by
  // refreshRecommendations() on every list re-fetch by matching siteProfile.sub
  // against item.id (the Google UID is the Firestore doc id and the SF
  // External Id, so id-equality is the source of truth for "is this mine").
  // Null when the visitor is signed out OR signed in but hasn't posted yet.
  var myRecommendation = null;

  function saveSiteProfile(p) {
    siteProfile = p;
    try { sessionStorage.setItem('portfolio_profile', JSON.stringify(p)); } catch (_) {}
    updateTopbarUser(p);
    // The contact reveal lives in sessionStorage too — on reload we want the
    // phone to stay revealed without re-asking the server until the token
    // expires. We re-apply whatever the server last decided.
    applyContactPolicy(p && p.contact);
  }

  /**
   * Apply the server's contact-reveal decision to the DOM.
   *
   * Privacy note: the phone number itself only enters the page when the
   * server explicitly returned it (i.e. the verified email matches an
   * allow-listed domain). Any other path keeps the masked placeholder.
   *
   * @param {{canSeePhone: boolean, phone: string|null, matchedDomain: string|null}|null|undefined} contact
   */
  function applyContactPolicy(contact) {
    var phoneRow   = document.getElementById('contactPhone');
    var phoneText  = document.getElementById('contactPhoneText');
    var phoneBadge = document.getElementById('contactPhoneBadge');
    if (!phoneRow || !phoneText) return;

    if (contact && contact.canSeePhone && contact.phone) {
      phoneText.textContent = contact.phone;
      phoneRow.setAttribute('href', 'tel:' + contact.phone.replace(/[^+\d]/g, ''));
      phoneRow.classList.add('contact-revealed');
      phoneRow.removeAttribute('aria-disabled');
      if (phoneBadge) {
        phoneBadge.textContent = 'Verified ' + contact.matchedDomain;
        phoneBadge.hidden = false;
      }
    } else {
      // Reset to the masked, non-clickable placeholder.
      phoneText.textContent = '+91-xxxxxxxxxx';
      phoneRow.removeAttribute('href');
      phoneRow.classList.remove('contact-revealed');
      phoneRow.setAttribute('aria-disabled', 'true');
      if (phoneBadge) phoneBadge.hidden = true;
    }
  }

  function updateTopbarUser(p) {
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

  function toggleUserMenu() {
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
  function closeUserMenu() {
    var dd = document.getElementById('topbarDropdown');
    if (dd) dd.setAttribute('hidden', '');
  }
  window.toggleUserMenu = toggleUserMenu;

  function signOut() {
    saveSiteProfile(null);
    try { sessionStorage.removeItem('portfolio_profile'); } catch (_) {}
    try { sessionStorage.removeItem('welcome_toast_shown'); } catch (_) {}
    setGoogleCredential(null);
    pendingChatHistory = null;
    siteProfile = null;
    // Drop any "edit mode" stickiness from the previous session so the CTA
    // immediately reverts to "Leave a Recommendation" — even though the
    // visitor's card stays public on the site, signed-out visitors aren't
    // allowed to edit it (re-auth required, by design).
    myRecommendation = null;
    if (typeof updateRecommendationCta === 'function') updateRecommendationCta();
    updateTopbarUser(null);
    closeUserMenu();
    if (window.google && window.google.accounts) {
      google.accounts.id.disableAutoSelect();
    }

    // Wipe any in-flight chat state so the next user starts clean
    resetChatState();
    var chatOpen = !document.getElementById('assistantOverlay').hasAttribute('hidden');
    if (chatOpen) {
      forceCloseAssistantSafe();
    }

    showWelcomeOverlay();
  }
  window.signOut = signOut;

  /**
   * Wipes the in-memory chat state and any DOM mirrors so a new user
   * starts from a clean slate. Safe to call even if the chat panel
   * isn't open.
   */
  function resetChatState() {
    if (typeof state === 'object' && state) {
      state.step = 0;
      state.answers = { name: '', email: '', company: '', role: '', contractType: '', urgency: '', slot: '' };
      state.googleProfile  = null;
      state.showGoogleStep = false;
      state.minimised      = false;
    }
    var msgs = document.getElementById('gaMessages');
    if (msgs) msgs.innerHTML = '';
    var avatar = document.querySelector('.ga-avatar');
    if (avatar) { avatar.innerHTML = 'AK'; avatar.style.background = ''; avatar.style.padding = ''; }
    var headerName = document.querySelector('.ga-header-name');
    if (headerName) headerName.textContent = "Abhinav's Assistant";
  }

  // Defensive wrapper — forceCloseAssistant is defined later in the IIFE,
  // so we route through a lookup at call time.
  function forceCloseAssistantSafe() {
    if (typeof forceCloseAssistant === 'function') {
      forceCloseAssistant();
    } else {
      var ov = document.getElementById('assistantOverlay');
      if (ov) ov.setAttribute('hidden', '');
    }
  }

  function initGoogleSignIn() {
    if (!GOOGLE_CLIENT_ID || !window.google) return;
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleSignIn,
      auto_select: false,
      cancel_on_tap_outside: false,
    });
    // Render button in welcome overlay if shown
    var welcomeBtn = document.getElementById('welcomeGoogleBtn');
    if (welcomeBtn && welcomeBtn.childElementCount === 0) {
      google.accounts.id.renderButton(welcomeBtn, {
        theme: 'filled_black', size: 'large', text: 'continue_with',
        shape: 'rectangular', width: 280,
      });
    }
  }

  function showWelcomeOverlay() {
    var overlay = document.getElementById('welcomeOverlay');
    if (!overlay) return;
    // <md-dialog> may not be upgraded yet (ESM module loads async from CDN).
    if (customElements.get('md-dialog')) {
      if (typeof overlay.show === 'function') overlay.show();
      else overlay.removeAttribute('hidden');
    } else {
      customElements.whenDefined('md-dialog').then(function () {
        if (typeof overlay.show === 'function') overlay.show();
        else overlay.removeAttribute('hidden');
      });
    }
    if (window.google && window.google.accounts) {
      initGoogleSignIn();
    }
  }
  window.showWelcomeOverlay = showWelcomeOverlay;

  function hideWelcomeOverlay() {
    var overlay = document.getElementById('welcomeOverlay');
    if (!overlay) return;
    if (typeof overlay.close === 'function') overlay.close();
    else overlay.setAttribute('hidden', '');
  }

  /* ── Welcome-Back Toast ──────────────────────────────────────
     Transient banner pinned top-right, auto-dismisses after 10s.
     Shows once per session to avoid being annoying on refresh.
  ─────────────────────────────────────────────────────────── */
  var WELCOME_TOAST_TTL_MS = 10000;
  var _welcomeToastTimer = null;

  function getInitials(fullName) {
    if (!fullName) return '?';
    var parts = String(fullName).trim().split(/\s+/);
    var first = parts[0] ? parts[0][0] : '';
    var last  = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase() || '?';
  }

  function closeWelcomeToast() {
    var toast = document.getElementById('welcomeToast');
    if (!toast) return;
    toast.classList.remove('show');
    if (_welcomeToastTimer) { clearTimeout(_welcomeToastTimer); _welcomeToastTimer = null; }
    setTimeout(function () { toast.setAttribute('hidden', ''); }, 300);
  }
  window.closeWelcomeToast = closeWelcomeToast;

  function showWelcomeToast(profile, opts) {
    if (!profile || !profile.name) return;
    opts = opts || {};

    // Show only once per browser-tab session unless explicitly forced
    // (forced = right after a fresh Google sign-in).
    if (!opts.force) {
      try {
        if (sessionStorage.getItem('welcome_toast_shown') === '1') return;
      } catch (_) {}
    }

    var toast    = document.getElementById('welcomeToast');
    var photoEl  = document.getElementById('welcomeToastPhoto');
    var titleEl  = document.getElementById('welcomeToastTitle');
    var nameEl   = document.getElementById('welcomeToastName');
    var closeEl  = document.getElementById('welcomeToastClose');
    if (!toast || !photoEl || !titleEl || !nameEl) return;

    var first = profile.name.split(' ')[0];
    titleEl.textContent = profile.isReturning ? t().toastWelcomeBack : t().toastWelcomeNew;
    nameEl.textContent  = first;

    photoEl.innerHTML = '';
    if (profile.picture) {
      var img = document.createElement('img');
      img.src = profile.picture;
      img.alt = first;
      img.referrerPolicy = 'no-referrer';
      img.onerror = function () { photoEl.textContent = getInitials(profile.name); };
      photoEl.appendChild(img);
    } else {
      photoEl.textContent = getInitials(profile.name);
    }

    if (closeEl && !closeEl._wired) {
      closeEl.addEventListener('click', closeWelcomeToast);
      closeEl._wired = true;
    }

    toast.removeAttribute('hidden');
    // Kick off the slide-in on the next frame so the transition runs
    requestAnimationFrame(function () { toast.classList.add('show'); });

    if (_welcomeToastTimer) clearTimeout(_welcomeToastTimer);
    _welcomeToastTimer = setTimeout(closeWelcomeToast, WELCOME_TOAST_TTL_MS);

    try { sessionStorage.setItem('welcome_toast_shown', '1'); } catch (_) {}
  }

  function handleGoogleSignIn(response) {
    var profile;
    try {
      var payload = JSON.parse(atob(response.credential.split('.')[1]));
      // sub = Google's stable user identifier. Stored alongside the visible
      // profile fields so the client can identify "its own" recommendation
      // in the public list (the Firestore doc id IS this sub claim) without
      // needing a separate /api/recommendation/me round-trip.
      profile = {
        sub:     payload.sub,
        name:    payload.name,
        email:   payload.email,
        picture: payload.picture,
      };
    } catch (_) {
      hideWelcomeOverlay();
      return;
    }

    // If a different user is signing in (or this was previously a guest
    // session), wipe any in-memory chat state so the new user starts clean.
    var prevEmail = (siteProfile && siteProfile.email) || '';
    if (prevEmail && prevEmail !== profile.email) {
      resetChatState();
      pendingChatHistory = null;
      var ov = document.getElementById('assistantOverlay');
      if (ov && !ov.hasAttribute('hidden')) forceCloseAssistantSafe();
    }

    // Cache the credential — chat APIs use it as a Bearer token
    setGoogleCredential(response.credential);

    hideWelcomeOverlay();

    // Ask the backend whether this is a returning visitor. We do this in
    // parallel with the rest of the UI flow — if the call fails we still
    // sign the user in, just without the "welcome back" personalisation.
    fetch('/api/session/start', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ credential: response.credential }),
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        if (data && data.success) {
          profile.isReturning = !!data.isReturning;
          profile.visitCount  = data.visitCount  || 1;
          profile.lastSeenAt  = data.lastSeenAt  || null;
          // Apply the server's contact-reveal decision. The phone number
          // never lived in HTML — the server only returns it when the
          // verified email belongs to an allow-listed org (google.com,
          // salesforce.com). Any other path (guest / @gmail / random)
          // gets contact.canSeePhone === false and the masked placeholder
          // remains in place.
          profile.contact = data.contact || null;
          applyContactPolicy(profile.contact);
        }
        saveSiteProfile(profile);

        // Reset the once-per-session guard so a fresh sign-in always shows
        try { sessionStorage.removeItem('welcome_toast_shown'); } catch (_) {}
        showWelcomeToast(profile, { force: true });

        // Fetch the user's in-progress chat (if any) so we can resume
        // exactly where they left off when they next open the assistant.
        return authedFetch('/api/chat/active');
      })
      .then(function (chatRes) {
        if (chatRes && chatRes.success && chatRes.chat) {
          pendingChatHistory = chatRes.chat;
        }
        var chatOpen = !document.getElementById('assistantOverlay').hasAttribute('hidden');
        if (chatOpen) applyGoogleProfileToChat(profile);

        // Now that we know the visitor's sub, re-fetch the recommendation
        // list so myRecommendation gets populated and the section CTA can
        // flip to "Edit your Recommendation" if they've posted before.
        // Cheap call — Cloud Run sets s-maxage=30 on this endpoint.
        if (typeof refreshRecommendations === 'function') refreshRecommendations();
      });
  }

  function applyGoogleProfileToChat(profile) {
    state.googleProfile  = profile;
    state.answers.name   = profile.name;
    state.answers.email  = profile.email;
    state.showGoogleStep = false;

    // Always update the avatar and header name
    var avatar = document.querySelector('.ga-avatar');
    if (avatar && profile.picture) {
      avatar.innerHTML = '<img src="' + profile.picture + '" alt="' + profile.name + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">';
      avatar.style.background = 'none';
      avatar.style.padding = '0';
    }
    var headerName = document.querySelector('.ga-header-name');
    if (headerName) headerName.textContent = profile.name.split(' ')[0] + "'s session";

    // Only restart the chat if we're still at the very beginning (pre-step or name/email)
    if (state.step <= 1) {
      var first = profile.name.split(' ')[0];

      // Resume from saved history if the user has an active chat in Firestore
      if (pendingChatHistory && pendingChatHistory.step > 1) {
        document.getElementById('gaMessages').innerHTML = '';
        var resumeMsg = (profile.isReturning ? t().botWelcomeBack(first) : t().botWelcomeNew(first))
                        + ' ' + (t().botResume || '(picking up where we left off)');
        addBotMessage(resumeMsg, function () {
          renderRestoredMessages(pendingChatHistory.messages || []);
          state.step    = Math.min(pendingChatHistory.step, STEPS.length);
          state.answers = mergeAnswers(state.answers, pendingChatHistory.answers || {});
          // Always trust Google's verified name/email over saved values
          state.answers.name  = profile.name;
          state.answers.email = profile.email;
          pendingChatHistory = null;
          renderStep();
        });
      } else {
        state.step = 2;
        document.getElementById('gaMessages').innerHTML = '';
        var greeting = profile.isReturning
          ? t().botWelcomeBack(first)
          : t().botWelcomeNew(first);
        addBotMessage(greeting);
        pendingChatHistory = null;
        renderStep();
      }
    }
    // If already mid-conversation, just silently update name/email in answers — don't disrupt
  }

  // Append saved messages without animation — used when restoring history.
  function renderRestoredMessages(messages) {
    var msgs = document.getElementById('gaMessages');
    if (!msgs || !messages || !messages.length) return;
    messages.forEach(function (m) {
      if (!m || !m.text) return;
      var wrap = document.createElement('div');
      wrap.className = 'ga-msg ' + (m.role === 'user' ? 'ga-msg-user' : 'ga-msg-bot');
      var bubbleCls = m.role === 'user' ? 'ga-bubble-user' : 'ga-bubble-bot';
      wrap.innerHTML = '<div class="ga-bubble ' + bubbleCls + '">' + escHtml(m.text) + '</div>';
      msgs.appendChild(wrap);
    });
    scrollMessages();
  }

  function mergeAnswers(target, source) {
    target = target || {};
    Object.keys(source || {}).forEach(function (k) {
      if (source[k] !== undefined && source[k] !== null && source[k] !== '') target[k] = source[k];
    });
    return target;
  }

  /* ═══════════════════════════════════════════════════════════
     GUIDED ASSISTANT — state machine
  ═══════════════════════════════════════════════════════════ */

  var SLOTS = [
    'Mon 28 Apr · 10:00 AM IST',
    'Mon 28 Apr · 3:00 PM IST',
    'Tue 29 Apr · 11:00 AM IST',
    'Wed 30 Apr · 2:00 PM IST',
    'Thu 1 May · 4:00 PM IST',
  ];

  var TOTAL_STEPS = 7;

  var state = {
    step: 0,
    answers: { name: '', email: '', company: '', role: '', contractType: '', urgency: '', slot: '' },
    googleProfile: null,
    showGoogleStep: false,
    minimised: false,
  };

  var STEPS = [
    {
      key: 'name',
      bot: function () { return t().botGreeting; },
      inputType: 'text',
      placeholder: function () { return t().namePlaceholder; },
      validate: function (v) { return v.trim().length > 0 ? null : t().errors.name; },
    },
    {
      key: 'email',
      bot: function (a) { return t().botEmail(a.name.split(' ')[0]); },
      inputType: 'text',
      placeholder: function () { return t().emailPlaceholder; },
      validate: function (v) {
        if (!v.trim()) return t().errors.emailRequired;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : t().errors.emailInvalid;
      },
    },
    {
      key: 'company',
      bot: function () { return t().botCompany; },
      inputType: 'text',
      placeholder: function () { return t().companyPlaceholder; },
      validate: function (v) { return v.trim().length > 0 ? null : t().errors.company; },
    },
    {
      key: 'role',
      bot: function () { return t().botRole; },
      inputType: 'choice',
      choices: function () { return t().choices.roles; },
    },
    {
      key: 'contractType',
      bot: function () { return t().botContract; },
      inputType: 'choice',
      choices: function () { return t().choices.contracts; },
    },
    {
      key: 'urgency',
      bot: function () { return t().botUrgency; },
      inputType: 'choice',
      choices: function () { return t().choices.urgency; },
    },
    {
      key: 'slot',
      bot: function () { return t().botSlot; },
      inputType: 'slots',
    },
  ];

  /* ── Language toggle ── */
  var LANG = {
    en: {
      teaserText: 'Hi! Looking to hire a Salesforce engineer?',
      teaserCta: "Let's talk",
      botGreeting: "Hi there! I'm Abhinav's assistant. To schedule a quick chat, I'll need a few details. What's your name?",
      botEmail: function (name) { return 'Nice to meet you, ' + name + "! What's your work email?"; },
      botCompany: 'Which company are you from?',
      botRole: 'What kind of role are you looking to fill?',
      botContract: 'Is this a permanent or contract position?',
      botUrgency: 'How soon are you looking to hire?',
      botSlot: 'Great! Pick a time slot that works for you.',
      botConfirm: "Perfect! I've noted everything. Click \"Confirm & Schedule\" to lock in your slot.",
      botDone: function (name, email) { return 'All set, ' + name + "! Your slot is confirmed. I'll send a calendar invite to " + email + '. Looking forward to speaking!'; },
      botDuplicate: function (name) { return "Looks like you've already reached out, " + name + " — thanks! I'll get back to you within 1\u20132 business days."; },
      botWelcomeNew:  function (name) { return 'Welcome, ' + name + '! I have your details from Google. Just a few more questions.'; },
      botWelcomeBack: function (name) { return 'Welcome back, ' + name + '! Good to see you again \u2014 a couple of quick questions and we\u2019re set.'; },
      botResume:      'Picking up where we left off.',
      toastWelcomeBack: 'Welcome back!',
      toastWelcomeNew:  'Welcome!',
      choices: {
        roles: ['SF Developer', 'SF Architect', 'Tech Lead', 'Consulting', 'Other'],
        contracts: ['Permanent', 'Contract', 'Freelance'],
        urgency: ['Immediately', 'Within 1 month', '3+ months'],
      },
      confirmBtn: 'Confirm & Schedule',
      confirmBtnBusy: 'Scheduling\u2026',
      closeBtn: 'Close',
      namePlaceholder: 'Your full name',
      emailPlaceholder: 'your@company.com',
      companyPlaceholder: 'Company name',
      continueBtn: 'Continue',
      errors: {
        name: 'Please enter your name.',
        emailRequired: 'Email is required.',
        emailInvalid: 'Enter a valid email address.',
        company: 'Please enter your company.',
        network: 'Network error. Please try again.',
        generic: 'Something went wrong. Please try again.',
      },
    },
    fr: {
      teaserText: 'Bonjour! Vous recrutez un ingénieur Salesforce?',
      teaserCta: 'Discutons',
      botGreeting: "Bonjour! Je suis l'assistant d'Abhinav. Pour planifier un échange, j'ai besoin de quelques informations. Quel est votre nom?",
      botEmail: function (name) { return 'Ravi de vous rencontrer, ' + name + '! Quelle est votre adresse email professionnelle?'; },
      botCompany: 'De quelle entreprise venez-vous?',
      botRole: 'Quel type de poste souhaitez-vous pourvoir?',
      botContract: "S'agit-il d'un poste permanent ou en contrat?",
      botUrgency: 'Dans quel délai souhaitez-vous recruter?',
      botSlot: 'Parfait! Choisissez un créneau qui vous convient.',
      botConfirm: 'Parfait! Cliquez sur "Confirmer" pour valider votre créneau.',
      botDone: function (name, email) { return 'Tout est prêt, ' + name + '! Votre créneau est confirmé. Je vous enverrai une invitation à ' + email + '. À bientôt!'; },
      botDuplicate: function (name) { return 'Vous nous avez déjà contactés, ' + name + ' \u2014 merci! Je vous répondrai sous 1 à 2 jours ouvrés.'; },
      botWelcomeNew:  function (name) { return 'Bienvenue, ' + name + ' ! J\u2019ai vos informations Google. Encore quelques questions.'; },
      botWelcomeBack: function (name) { return 'Bon retour, ' + name + ' ! Ravi de vous revoir \u2014 quelques questions rapides et nous sommes prêts.'; },
      botResume:      'Reprenons o\u00f9 nous en \u00e9tions.',
      toastWelcomeBack: 'Bon retour !',
      toastWelcomeNew:  'Bienvenue !',
      choices: {
        roles: ['Développeur SF', 'Architecte SF', 'Tech Lead', 'Conseil', 'Autre'],
        contracts: ['CDI', 'CDD / Contrat', 'Freelance'],
        urgency: ['Immédiatement', 'Dans 1 mois', '3 mois et plus'],
      },
      confirmBtn: 'Confirmer le créneau',
      confirmBtnBusy: 'Envoi\u2026',
      closeBtn: 'Fermer',
      namePlaceholder: 'Votre nom complet',
      emailPlaceholder: 'vous@entreprise.com',
      companyPlaceholder: "Nom de l'entreprise",
      continueBtn: 'Continuer',
      errors: {
        name: 'Veuillez entrer votre nom.',
        emailRequired: "L'email est requis.",
        emailInvalid: 'Entrez une adresse email valide.',
        company: "Veuillez entrer le nom de l'entreprise.",
        network: 'Erreur réseau. Veuillez réessayer.',
        generic: "Une erreur s'est produite. Veuillez réessayer.",
      },
    },
  };

  /* ── Page-level translations ─────────────────────────────── */
  var PAGE_LANG = {
    en: {
      headerTitle: 'Senior Salesforce Application Engineer',
      getInTouch: 'Get In Touch',
      referMe: 'Refer Me',
      downloadResume: 'Download Resume',
      referMeIntro: "Thanks for thinking of referring me — copy the email below, edit, and send. The resume link is included in the body so you don't have to attach anything.",
      referMeCopy: 'Copy email',
      referMeOpen: 'Open in email client',
      referMePrivacy: 'Nothing leaves your device until you hit Send in your own email. No tracking, no backend processing.',
      recoTitle: 'Recommendations',
      recoSubtitle: "What people I've worked with — and recruiters I've spoken with — have to say.",
      recoCta: 'Leave a Recommendation',
      recoCtaEdit: 'Edit your Recommendation',
      recoModalTitleEdit: 'Edit your Recommendation',
      recoSubmitNew: 'Post Recommendation',
      recoSubmitEdit: 'Update Recommendation',
      yearsExp: 'Years Experience',
      // Welcome / Login overlay
      welcomeTitle:    "Abhinav's Portfolio",
      welcomeSub:      'Senior Salesforce Application Engineer',
      welcomeDesc:     'Sign in with Google for a personalised experience, or continue as a guest.',
      welcomeOr:       'or',
      welcomeGuestBtn: 'Maybe later',
      welcomeNote:     'Your details are only used to personalise the scheduling assistant.',
      topbarSignIn:    'Sign in',
      aboutMe: 'About Me',
      about1: 'Senior Salesforce Application Engineer with <strong style="color:var(--text)">12+ years of experience</strong> across Salesforce development, architecture, and DevOps, building scalable enterprise applications using Apex, Lightning Web Components, and API-driven integrations.',
      about2: 'Experienced across Sales Cloud, Service Cloud, Experience Cloud, and Salesforce Communications Cloud, with deep expertise in CPQ, Contract Lifecycle Management, and Order Management.',
      skills: 'Skills',
      skillCore: 'Salesforce Core',
      education: 'Education',
      degree: 'Bachelor of Engineering (B.E.)',
      graduated: 'Graduated 2012',
      certifications: 'Certifications',
      workExp: 'Work Experience',
      keyProjects: 'Key Projects',
      job1: ['Designed and developed scalable Salesforce applications using Apex, LWC, Flows, and event-driven automation to support enterprise customer service workflows.', 'Implemented Salesforce Industries (Communications Cloud) solutions across CPQ and Order Management, designing order decomposition and orchestration flows integrated with external billing systems.', 'Developed and supported Experience Cloud portals with custom components, access models, and performance optimizations.', 'Built and maintained API-driven integrations using REST services and Platform Events for reliable communication between Salesforce and downstream systems.', 'Leveraged AI-assisted development tools (Cursor) to accelerate development cycles, improve code quality, and reduce implementation time.'],
      job2: ['Designed and implemented enterprise CPQ and CLM solutions using Conga (Apttus), consolidating multiple legacy back-office systems for product sales, pricing, billing, and contract management.', 'Architected product configuration and pricing models supporting complex bundle structures, multi-currency pricing, approval workflows, and automated deal guidance.', 'Developed scalable customizations using Apex, LWC, and asynchronous Apex (Batch, Queueable, Scheduled) to support high-volume business operations.', 'Managed CI/CD processes using Bitbucket and Jenkins, supporting code reviews, pull requests, and controlled deployments across environments.', 'Led product, approval, and template migrations using X-Author tools and Talend-based data integration workflows ensuring data consistency.'],
      job3: ['Developed Salesforce-based onboarding solutions integrating capture, decisioning, and fulfillment workflows for banking onboarding processes.', 'Built API-based integrations between Salesforce and downstream banking systems enabling seamless data exchange across onboarding and servicing platforms.'],
      job4: ['Developed and enhanced Salesforce CRM solutions supporting customer service workflows for game purchase and support-related inquiries.', 'Implemented automation and customizations using Apex, Visualforce, and workflow automation to improve case management efficiency.'],
      proj1: ['Designed order orchestration and decomposition workflows using Salesforce Industries Order Management to manage product packaging and order processing.', 'Designed and implemented integrations between Salesforce OM and external billing systems, enabling automated technical product processing and downstream fulfillment.', 'Developed orchestration logic supporting end-to-end order lifecycle processing through API-based integrations.'],
      proj2: ['Implemented CPQ and contract lifecycle workflows using Salesforce Industries CPQ, enabling automated contract generation and eSignature processing.', 'Configured document templates and data mappings using OmniStudio Integration Procedures and DataRaptors to support contract automation.', 'Supported deployment and release activities using Copado across multiple environments.'],
      proj3: ['Developed quoting workflows using OmniScripts, FlexCards, DataRaptors, and Integration Procedures within Salesforce Industries CPQ.', 'Implemented multi-language support using Translation Workbench for global users.', 'Managed product configuration deployments using IDX tools ensuring consistency across environments.'],
    },
    fr: {
      headerTitle: 'Ingénieur Senior en Applications Salesforce',
      getInTouch: 'Me Contacter',
      referMe: 'Me Recommander',
      downloadResume: 'Télécharger le CV',
      referMeIntro: "Merci d'envisager de me recommander — copiez l'e-mail ci-dessous, modifiez-le et envoyez-le. Le lien du CV est inclus dans le corps du message, vous n'avez donc rien à joindre.",
      referMeCopy: "Copier l'e-mail",
      referMeOpen: 'Ouvrir dans la messagerie',
      referMePrivacy: "Rien ne quitte votre appareil tant que vous n'avez pas cliqué sur Envoyer dans votre propre messagerie. Pas de traçage, pas de traitement côté serveur.",
      recoTitle: 'Recommandations',
      recoSubtitle: "Ce que les personnes avec qui j'ai travaillé — et les recruteurs avec qui j'ai échangé — disent.",
      recoCta: 'Laisser une Recommandation',
      recoCtaEdit: 'Modifier votre Recommandation',
      recoModalTitleEdit: 'Modifier votre Recommandation',
      recoSubmitNew: 'Publier la Recommandation',
      recoSubmitEdit: 'Mettre à jour la Recommandation',
      yearsExp: "Ans d'Expérience",
      // Welcome / Login overlay
      welcomeTitle:    "Le Portfolio d'Abhinav",
      welcomeSub:      'Ingénieur Senior en Applications Salesforce',
      welcomeDesc:     "Connectez-vous avec Google pour une expérience personnalisée, ou continuez en tant qu'invité.",
      welcomeOr:       'ou',
      welcomeGuestBtn: 'Plus tard, peut-être',
      welcomeNote:     "Vos informations sont uniquement utilisées pour personnaliser l'assistant de planification.",
      topbarSignIn:    'Se connecter',
      aboutMe: 'À Propos',
      about1: 'Ingénieur Senior en Applications Salesforce avec <strong style="color:var(--text)">plus de 12 ans d\'expérience</strong> en développement, architecture et DevOps Salesforce, spécialisé dans la création d\'applications d\'entreprise évolutives avec Apex, Lightning Web Components et des intégrations API.',
      about2: 'Expérimenté sur Sales Cloud, Service Cloud, Experience Cloud et Salesforce Communications Cloud, avec une expertise approfondie en CPQ, gestion du cycle de vie des contrats et gestion des commandes.',
      skills: 'Compétences',
      skillCore: 'Salesforce Core',
      education: 'Formation',
      degree: 'Licence en Ingénierie (B.E.)',
      graduated: 'Diplômé en 2012',
      certifications: 'Certifications',
      workExp: 'Expérience Professionnelle',
      keyProjects: 'Projets Clés',
      job1: ["Conception et développement d'applications Salesforce évolutives avec Apex, LWC, Flows et l'automatisation pilotée par événements pour les flux de travail de service client.", "Mise en œuvre de Salesforce Industries (Communications Cloud) sur CPQ et Order Management, conception de flux d'orchestration intégrés aux systèmes de facturation externes.", "Développement et support de portails Experience Cloud avec composants personnalisés, modèles d'accès et optimisations de performance.", "Création et maintenance d'intégrations API avec REST et Platform Events pour la communication entre Salesforce et les systèmes downstream.", "Utilisation d'outils de développement assistés par IA (Cursor) pour accélérer les cycles de développement et améliorer la qualité du code."],
      job2: ["Conception et implémentation de solutions CPQ et CLM d'entreprise avec Conga (Apttus), consolidant plusieurs systèmes back-office pour les ventes, la tarification et la gestion des contrats.", "Architecture de modèles de configuration de produits et de tarification supportant des structures de bundles complexes, la tarification multi-devises et les flux d'approbation.", "Développement de personnalisations évolutives avec Apex, LWC et Apex asynchrone (Batch, Queueable, Scheduled) pour les opérations à haut volume.", "Gestion des processus CI/CD avec Bitbucket et Jenkins, supportant les revues de code et les déploiements contrôlés.", "Pilotage des migrations de produits, d'approbations et de modèles avec les outils X-Author et les workflows d'intégration Talend."],
      job3: ["Développement de solutions d'onboarding Salesforce intégrant la capture, la prise de décision et les flux d'exécution pour les processus d'intégration bancaire.", "Création d'intégrations API entre Salesforce et les systèmes bancaires downstream pour un échange de données fluide."],
      job4: ["Développement et amélioration de solutions CRM Salesforce pour les flux de service client liés aux achats de jeux.", "Implémentation de l'automatisation et des personnalisations avec Apex, Visualforce et l'automatisation des workflows pour améliorer la gestion des cas."],
      proj1: ["Conception des flux d'orchestration et de décomposition des commandes avec Salesforce Industries Order Management.", "Conception et implémentation des intégrations entre Salesforce OM et les systèmes de facturation externes.", "Développement de la logique d'orchestration supportant le cycle de vie complet des commandes via des intégrations API."],
      proj2: ["Implémentation des flux CPQ et de cycle de vie des contrats avec Salesforce Industries CPQ, permettant la génération automatisée de contrats et la signature électronique.", "Configuration des modèles de documents et des mappings de données avec OmniStudio Integration Procedures et DataRaptors.", "Support des activités de déploiement et de mise en production avec Copado sur plusieurs environnements."],
      proj3: ["Développement des flux de devis avec OmniScripts, FlexCards, DataRaptors et Integration Procedures dans Salesforce Industries CPQ.", "Implémentation du support multilingue avec Translation Workbench pour les utilisateurs globaux.", "Gestion des déploiements de configuration produit avec les outils IDX pour garantir la cohérence entre les environnements."],
    },
  };

  function applyPageLang(lang) {
    var d = PAGE_LANG[lang] || PAGE_LANG.en;
    // Simple text replacements
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (d[key] !== undefined) el.textContent = d[key];
    });
    // HTML replacements (for elements with inner tags like <strong>)
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (d[key] !== undefined) el.innerHTML = d[key];
    });
    // List replacements
    document.querySelectorAll('[data-i18n-list]').forEach(function (ul) {
      var key = ul.getAttribute('data-i18n-list');
      if (!d[key]) return;
      ul.innerHTML = '';
      d[key].forEach(function (item) {
        var li = document.createElement('li');
        li.textContent = item;
        ul.appendChild(li);
      });
    });
    document.documentElement.lang = lang;
  }

  var currentLang = 'en';
  function t() { return LANG[currentLang]; }

  function setLang(lang) {
    currentLang = lang;
    var langSelect = document.getElementById('langSelect');
    if (langSelect && langSelect.value !== lang) langSelect.value = lang;
    applyPageLang(lang);
    var teaserText = document.querySelector('.chat-teaser-text');
    var teaserCta  = document.querySelector('.chat-teaser-cta');
    if (teaserText) teaserText.textContent = t().teaserText;
    if (teaserCta)  teaserCta.textContent  = t().teaserCta;
    var overlay = document.getElementById('assistantOverlay');
    if (!overlay.hasAttribute('hidden')) {
      openAssistant();
    }
  }
  window.setLang = setLang;

  /**
   * Inject a stylesheet into a custom element's shadow root.
   *
   * Several @material/web@1.5.1 components (notably <md-outlined-select>'s
   * internal field height and <md-filled-button>'s internal padding) have
   * baked-in values that the *public* CSS custom-property tokens don't
   * actually override. We reach into the shadow DOM via `adoptedStyleSheets`
   * — the modern Web-Components-friendly equivalent of `!important` — and
   * fall back to a plain <style> on browsers without constructable
   * stylesheet support.
   *
   * Idempotent and silent on failure: each call still works if a previous
   * sheet was already adopted.
   */
  function injectShadowStyle(host, css) {
    if (!host || !host.shadowRoot) return;
    var sr = host.shadowRoot;
    try {
      if (typeof CSSStyleSheet === 'function' && Array.isArray(sr.adoptedStyleSheets)) {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        sr.adoptedStyleSheets = sr.adoptedStyleSheets.concat([sheet]);
        return;
      }
    } catch (_) { /* fall through to <style> fallback */ }
    var style = document.createElement('style');
    style.textContent = css;
    sr.appendChild(style);
  }

  // Wire the M3 outlined-select to setLang. Listen on `change` (fires when
  // the user picks an option from the dropdown menu).
  //
  // Also: force the inner <md-outlined-field>'s height to 40px so the
  // select harmonises with the 40px theme-toggle and Sign-in button. The
  // public --md-outlined-field-container-height token *is* set on the
  // host, but @material/web@1.5.1 hard-codes a `min-height: 56px` on the
  // internal field that the token doesn't override.
  customElements.whenDefined('md-outlined-select').then(function () {
    var langSelect = document.getElementById('langSelect');
    if (!langSelect) return;
    langSelect.addEventListener('change', function () {
      setLang(langSelect.value);
    });
    injectShadowStyle(
      langSelect,
      'md-outlined-field { min-height: 40px !important; height: 40px !important; }'
    );
  });

  // Force breathing space inside <md-filled-button> for our two brand
  // buttons (.hire-me-btn and .hm-submit). In @material/web@1.5.1, the
  // inner `<button class="button">` rendered into the shadow DOM has zero
  // horizontal padding and an 8px icon-label gap baked into the component
  // stylesheet — the public --md-filled-button-leading-space / -with-icon-
  // spacing tokens don't actually reach it. We use the same shadow-DOM
  // injection trick as the language select to add real padding + a wider
  // icon-label gap, so our primary CTA reads as substantial instead of
  // cramped.
  var BRAND_BUTTON_CSS = [
    '.button {',
    '  padding-inline: 28px !important;',
    '  gap: 12px !important;',
    '}',
    '.label { white-space: nowrap; }',
  ].join('\n');
  customElements.whenDefined('md-filled-button').then(function () {
    document.querySelectorAll('.hire-me-btn, .hm-submit, .refer-copy-btn').forEach(function (btn) {
      injectShadowStyle(btn, BRAND_BUTTON_CSS);
    });
  });
  // The "Refer Me" CTA is an <md-outlined-button>, which uses a separate
  // custom element. Same horizontal-padding fix applies — without it the
  // icon and label crash into each other. Wait until the outlined variant
  // is registered before injecting. We also extend this to .refer-mailto-btn
  // (the "Open in email client" button inside the Refer Me dialog).
  customElements.whenDefined('md-outlined-button').then(function () {
    document.querySelectorAll('.refer-btn, .refer-mailto-btn').forEach(function (btn) {
      injectShadowStyle(btn, BRAND_BUTTON_CSS);
    });
  });

  /* ── Theme toggle (light / dark) ──
     Honours OS preference on first visit, then pins user choice in
     localStorage. Driven by [data-theme="light"|"dark"] on <html>;
     CSS swaps M3 color tokens which cascade to every brand alias. */
  var THEME_KEY = 'portfolio_theme';
  function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === 'light' || theme === 'dark') {
      root.setAttribute('data-theme', theme);
    } else {
      root.removeAttribute('data-theme');
    }
  }
  function currentTheme() {
    var stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  // Apply on boot (defensive — the boot script in index.html already does this
  // pre-paint, but we re-sync in case the toggle's `selected` state changes).
  applyTheme(currentTheme());

  customElements.whenDefined('md-outlined-icon-button').then(function () {
    var btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    var isLight = currentTheme() === 'light';
    btn.selected = isLight;
    btn.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
    btn.addEventListener('change', function () {
      var nextTheme = btn.selected ? 'light' : 'dark';
      applyTheme(nextTheme);
      localStorage.setItem(THEME_KEY, nextTheme);
      btn.setAttribute(
        'aria-label',
        btn.selected ? 'Switch to dark mode' : 'Switch to light mode'
      );
    });
  });

  /* ── Chat Launcher ── */
  var teaserShown = false;

  /* ── Location popover (timezone-aware) ──
     Shows Abhinav's current local time, the delta vs the viewer's resolved
     timezone, and a working-hours status pill. Pure browser primitives —
     Intl + Date + setInterval, no API keys, no network calls.

     Why this matters for a recruiter: timezone is the first practical
     question on every remote-hire conversation. Answering it inline
     removes a step from their workflow. */
  function initLocationPopover() {
    var el = document.getElementById('contactLocation');
    if (!el) return;

    var timeEl   = document.getElementById('locPopoverTime');
    var deltaEl  = document.getElementById('locPopoverDelta');
    var statusEl = document.getElementById('locPopoverStatus');
    var statusTextEl = document.getElementById('locPopoverStatusText');
    if (!timeEl || !deltaEl || !statusEl || !statusTextEl) return;

    var IST_TZ = 'Asia/Kolkata';
    // 9 AM – 8 PM IST = comfortable working window.
    var WORKING_START_HOUR = 9;
    var WORKING_END_HOUR   = 20;

    // Resolve the viewer's timezone via Intl. Falls back gracefully on
    // ancient browsers; on undetectable TZs we just hide the delta line.
    var viewerTz = '';
    try { viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}

    /** Format the IST hour:minute as HH:MM (24h, locale-stable). */
    function formatIstHHMM(now) {
      try {
        return new Intl.DateTimeFormat('en-GB', {
          timeZone: IST_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(now);
      } catch (_) {
        return '--:--';
      }
    }

    /** Returns the integer "hour" in the IST timezone for status logic. */
    function istHour(now) {
      try {
        return parseInt(new Intl.DateTimeFormat('en-GB', {
          timeZone: IST_TZ, hour: '2-digit', hour12: false,
        }).format(now), 10);
      } catch (_) {
        return -1;
      }
    }

    /** Compute the offset (in hours, signed) between IST and the viewer's TZ.
     *  Uses the formatToParts trick to ask Intl for the IST time and the
     *  viewer's local time at the same instant, then diffs them.
     *  Stable across DST transitions — we recompute on every tick. */
    function computeDeltaHours(now) {
      if (!viewerTz) return null;
      try {
        function localOffsetMinutes(tz) {
          // Build a "wall clock" Date as if the instant were in `tz`, then
          // diff it from the actual UTC instant to recover the offset.
          var dtf = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          });
          var parts = dtf.formatToParts(now).reduce(function (acc, p) {
            if (p.type !== 'literal') acc[p.type] = p.value; return acc;
          }, {});
          var asUTC = Date.UTC(
            +parts.year, +parts.month - 1, +parts.day,
            +parts.hour, +parts.minute, +parts.second
          );
          return (asUTC - now.getTime()) / 60000;
        }
        var istMin    = localOffsetMinutes(IST_TZ);
        var viewerMin = localOffsetMinutes(viewerTz);
        return (istMin - viewerMin) / 60;
      } catch (_) {
        return null;
      }
    }

    function formatDelta(hours) {
      if (hours == null) return '';
      if (Math.abs(hours) < 0.01) return 'Same timezone as you';
      var rounded = Math.round(hours * 2) / 2;
      var abs = Math.abs(rounded);
      var label = (abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(1)) + ' h';
      return rounded > 0
        ? label + ' ahead of you'
        : label + ' behind you';
    }

    function updateStatus(hour) {
      var status, label;
      if (hour < 0) {                                 status = 'asleep';  label = '—'; }
      else if (hour >= WORKING_START_HOUR && hour < WORKING_END_HOUR) { status = 'working'; label = 'Working hours'; }
      else if (hour >= WORKING_END_HOUR  && hour < 23) { status = 'late';    label = 'Late evening'; }
      else                                            { status = 'asleep';  label = 'Likely asleep'; }
      statusEl.setAttribute('data-status', status);
      statusTextEl.textContent = label;
    }

    function tick() {
      var now = new Date();
      timeEl.textContent  = formatIstHHMM(now);
      deltaEl.textContent = formatDelta(computeDeltaHours(now));
      updateStatus(istHour(now));
    }

    tick();
    // Update once a minute. setInterval is fine here — the page lives for
    // the duration of a recruiter's visit, no need for visibilitychange games.
    setInterval(tick, 60 * 1000);
  }

  // Populate page content in default language on load
  applyPageLang('en');

  // Initialise the location popover (independent of sign-in state).
  initLocationPopover();

  // Restore topbar user if session exists
  if (siteProfile) {
    updateTopbarUser(siteProfile);
    // Re-apply the cached server contact-reveal decision so a returning
    // signed-in viewer's phone stays revealed across reloads (until token
    // expiry / sign-out clears the profile).
    applyContactPolicy(siteProfile.contact);
    // Show the once-per-session welcome toast for signed-in (non-guest) users
    if (siteProfile.type !== 'guest' && siteProfile.name) {
      // Defer to next tick so DOM/CSS are settled before the slide-in
      setTimeout(function () { showWelcomeToast(siteProfile); }, 200);
    }
  } else {
    showWelcomeOverlay();
  }

  // Guest button on welcome overlay
  document.getElementById('welcomeGuestBtn').addEventListener('click', function () {
    saveSiteProfile({ type: 'guest' });
    hideWelcomeOverlay();
  });

  // Close (X) button on welcome overlay — same effect as "Continue as Guest"
  // (dismiss the modal, browse anonymously, signin remains available in the topbar).
  var welcomeCloseBtn = document.getElementById('welcomeCloseBtn');
  if (welcomeCloseBtn) {
    welcomeCloseBtn.addEventListener('click', function () {
      saveSiteProfile({ type: 'guest' });
      hideWelcomeOverlay();
    });
  }

  // Catch-all: if the welcome <md-dialog> closes for ANY reason (Esc key,
  // scrim click, Maybe later, X) and we still don't have a profile, default
  // to a guest session so the topbar Sign-in button reveals itself.
  customElements.whenDefined('md-dialog').then(function () {
    var welcomeOverlay = document.getElementById('welcomeOverlay');
    if (!welcomeOverlay) return;
    welcomeOverlay.addEventListener('close', function () {
      if (!siteProfile) {
        saveSiteProfile({ type: 'guest' });
      }
    });
  });

  // Top-bar "Sign in" button — re-opens the welcome overlay so guests can
  // upgrade to a signed-in session at any time.
  var topbarSignInBtn = document.getElementById('topbarSignInBtn');
  if (topbarSignInBtn) {
    topbarSignInBtn.addEventListener('click', showWelcomeOverlay);
  }

  // Init Google Sign-In once the GIS library has loaded
  if (GOOGLE_CLIENT_ID) {
    var _gsiPoll = setInterval(function () {
      if (window.google && window.google.accounts) {
        clearInterval(_gsiPoll);
        initGoogleSignIn();
      }
    }, 200);
  }

  // ── Resizable chat panel ──────────────────────────────────────
  // Persisted in localStorage so the user's preferred width survives reloads.
  // Supports both mouse and touch (Pointer Events).
  (function () {
    var handle  = document.getElementById('gaResizeHandle');
    var overlay = document.getElementById('assistantOverlay');
    if (!handle || !overlay) return;

    var MIN_W = 300;
    var MAX_W = 680;
    var STORAGE_KEY = 'portfolio_chat_width';

    // Restore saved width on init
    try {
      var saved = parseInt(localStorage.getItem(STORAGE_KEY) || '', 10);
      if (saved && saved >= MIN_W && saved <= MAX_W) {
        overlay.style.width = saved + 'px';
      }
    } catch (_) {}

    var dragging = false, startX = 0, startW = 0;

    function onDown(e) {
      dragging = true;
      startX = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX);
      startW = overlay.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ew-resize';
      e.preventDefault();
    }

    function onMove(e) {
      if (!dragging) return;
      var clientX = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX);
      var newW = Math.min(MAX_W, Math.max(MIN_W, startW + (startX - clientX)));
      overlay.style.width = newW + 'px';
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      try { localStorage.setItem(STORAGE_KEY, String(overlay.offsetWidth)); } catch (_) {}
    }

    handle.addEventListener('mousedown',  onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    handle.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend',  onUp);

    // Double-click to reset to default width
    handle.addEventListener('dblclick', function () {
      overlay.style.width = '';
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    });
  }());

  setTimeout(function () {
    var launcher = document.getElementById('chatLauncher');
    launcher.removeAttribute('hidden');
    // Show teaser bubble after launcher appears
    setTimeout(function () {
      if (!teaserShown) showTeaser();
    }, 600);
  }, 5000);

  function setFabIcon(name) {
    var icon = document.getElementById('chatFabIcon');
    if (icon) icon.textContent = name;
  }

  function showTeaser() {
    teaserShown = true;
    document.getElementById('chatTeaser').removeAttribute('hidden');
    setFabIcon('close');
  }

  function hideTeaser() {
    document.getElementById('chatTeaser').setAttribute('hidden', '');
    setFabIcon('chat');
  }

  function toggleChatTeaser() {
    if (state.minimised) {
      resumeAssistant();
      return;
    }
    var teaser = document.getElementById('chatTeaser');
    if (teaser.hasAttribute('hidden')) {
      showTeaser();
    } else {
      hideTeaser();
    }
  }
  window.toggleChatTeaser = toggleChatTeaser;

  document.getElementById('chatTeaserClose').addEventListener('click', function (e) {
    e.stopPropagation();
    hideTeaser();
  });

  function openAssistant() {
    state.step = 0;
    state.answers  = { name: '', email: '', company: '', role: '', contractType: '', urgency: '', slot: '' };
    state.googleProfile  = null;
    state.showGoogleStep = false;
    // Reset avatar and header
    var avatar = document.querySelector('.ga-avatar');
    if (avatar) { avatar.innerHTML = 'AK'; avatar.style.background = ''; avatar.style.padding = ''; }
    var headerName = document.querySelector('.ga-header-name');
    if (headerName) headerName.textContent = "Abhinav's Assistant";
    document.getElementById('gaMessages').innerHTML = '';
    document.getElementById('assistantOverlay').removeAttribute('hidden');
    hideTeaser();

    // Show the "Start over" button only for signed-in users (it operates
    // on Firestore-backed history, which guests don't have).
    setStartOverBtnVisible(!!(siteProfile && siteProfile.type !== 'guest'));

    // If already signed in from welcome screen, skip sign-in step
    if (siteProfile && siteProfile.type !== 'guest') {
      applyGoogleProfileToChat(siteProfile);
    } else {
      state.showGoogleStep = !!(GOOGLE_CLIENT_ID && window.google && (!siteProfile));
      renderStep();
    }
  }
  window.openAssistant = openAssistant;

  function closeAssistant() {
    // Mid-conversation — ask for confirmation
    if (state.step > 0 && state.step < STEPS.length) {
      showCloseConfirm();
      return;
    }
    forceCloseAssistant();
  }
  window.closeAssistant = closeAssistant;

  function forceCloseAssistant() {
    state.minimised = false;
    document.getElementById('assistantOverlay').setAttribute('hidden', '');
    // Remove confirm dialog if present
    var existing = document.getElementById('gaCloseConfirm');
    if (existing) existing.remove();
  }

  function showCloseConfirm() {
    // Don't stack multiple dialogs
    if (document.getElementById('gaCloseConfirm')) return;

    var dialog = document.createElement('div');
    dialog.id = 'gaCloseConfirm';
    dialog.className = 'ga-close-confirm';
    dialog.innerHTML =
      '<p class="ga-confirm-msg">End this conversation? Your progress will be lost.</p>' +
      '<div class="ga-confirm-btns">' +
        '<button class="ga-confirm-stay">Keep chatting</button>' +
        '<button class="ga-confirm-end">End conversation</button>' +
      '</div>';

    dialog.querySelector('.ga-confirm-stay').onclick = function () {
      dialog.remove();
    };
    dialog.querySelector('.ga-confirm-end').onclick = function () {
      dialog.remove();
      forceCloseAssistant();
    };

    document.querySelector('.ga-modal').appendChild(dialog);
  }

  function minimiseAssistant() {
    state.minimised = true;
    document.getElementById('assistantOverlay').setAttribute('hidden', '');
    var launcher = document.getElementById('chatLauncher');
    launcher.removeAttribute('hidden');
    setFabIcon('chat');
  }
  window.minimiseAssistant = minimiseAssistant;

  /**
   * "Start over" — clears the in-memory chat, deletes the active chat
   * from Firestore, then re-opens fresh. Only meaningful for signed-in users.
   */
  function restartAssistant() {
    if (googleCredential) {
      authedFetch('/api/chat/active', { method: 'DELETE' });
    }
    pendingChatHistory = null;
    resetChatState();
    var ov = document.getElementById('assistantOverlay');
    if (ov && !ov.hasAttribute('hidden')) {
      // Re-render: openAssistant() will run the greeting + step 0 again
      forceCloseAssistantSafe();
      setTimeout(function () {
        if (typeof openAssistant === 'function') openAssistant();
      }, 0);
    }
  }
  window.restartAssistant = restartAssistant;

  function setStartOverBtnVisible(visible) {
    var btn = document.getElementById('gaStartOverBtn');
    if (!btn) return;
    if (visible) btn.removeAttribute('hidden');
    else         btn.setAttribute('hidden', '');
  }

  function resumeAssistant() {
    state.minimised = false;
    document.getElementById('assistantOverlay').removeAttribute('hidden');
    hideTeaser();
  }
  window.resumeAssistant = resumeAssistant;

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAssistant();
  });

  function updateProgress() {
    var pct = Math.round((state.step / TOTAL_STEPS) * 100);
    document.getElementById('gaProgressBar').style.width = pct + '%';
  }

  function renderGoogleStep() {
    var area = document.getElementById('gaInputArea');
    area.innerHTML = '';

    addBotMessage("Hi! To save time, you can sign in with Google — I'll auto-fill your name and email. Or continue as a guest and I'll ask you a couple of questions.");

    var wrap = document.createElement('div');
    wrap.className = 'ga-google-step';

    var googleBtnDiv = document.createElement('div');
    googleBtnDiv.id = 'googleSignInBtn';
    googleBtnDiv.className = 'ga-google-btn-wrap';

    var sep = document.createElement('div');
    sep.className = 'ga-google-sep';
    sep.textContent = 'or';

    var guestBtn = document.createElement('button');
    guestBtn.className = 'ga-guest-btn';
    guestBtn.textContent = 'Continue as Guest';
    guestBtn.onclick = function () {
      state.showGoogleStep = false;
      document.getElementById('gaMessages').innerHTML = '';
      renderStep();
    };

    wrap.appendChild(googleBtnDiv);
    wrap.appendChild(sep);
    wrap.appendChild(guestBtn);
    area.appendChild(wrap);

    if (window.google && window.google.accounts && GOOGLE_CLIENT_ID) {
      google.accounts.id.renderButton(googleBtnDiv, {
        theme: 'filled_black',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        width: 260,
      });
    }
  }

  function renderStep() {
    if (state.showGoogleStep) { renderGoogleStep(); return; }
    updateProgress();
    if (state.step >= STEPS.length) { renderConfirm(); return; }
    var stepDef = STEPS[state.step];
    var botText = stepDef.bot(state.answers);
    addBotMessage(botText, function () {
      renderInputArea(stepDef);
    });
  }

  function addBotMessage(text, cb) {
    var msgs = document.getElementById('gaMessages');
    var wrap = document.createElement('div');
    wrap.className = 'ga-msg ga-msg-bot ga-msg-enter';
    wrap.innerHTML = '<div class="ga-bubble ga-bubble-bot">' + escHtml(text) + '</div>';
    msgs.appendChild(wrap);
    scrollMessages();
    persistChatTurn('bot', text);
    setTimeout(function () { wrap.classList.remove('ga-msg-enter'); if (cb) cb(); }, 300);
  }

  function addUserMessage(text) {
    var msgs = document.getElementById('gaMessages');
    var wrap = document.createElement('div');
    wrap.className = 'ga-msg ga-msg-user ga-msg-enter';
    wrap.innerHTML = '<div class="ga-bubble ga-bubble-user">' + escHtml(text) + '</div>';
    msgs.appendChild(wrap);
    scrollMessages();
    persistChatTurn('user', text);
    setTimeout(function () { wrap.classList.remove('ga-msg-enter'); }, 300);
  }

  /**
   * Fire-and-forget: persists the latest turn + current chat state to
   * Firestore via /api/chat/active. Only runs for signed-in users with a
   * cached Google credential. Silent on failure (chat UX never blocks).
   */
  function persistChatTurn(role, text) {
    if (!googleCredential) return;
    if (!siteProfile || siteProfile.type === 'guest') return;
    try {
      authedFetch('/api/chat/active', {
        method: 'POST',
        body:   JSON.stringify({
          step:    state && typeof state.step === 'number' ? state.step : 0,
          answers: state && state.answers ? state.answers : {},
          locale:  (typeof currentLang === 'string' ? currentLang : 'en'),
          message: { role: role === 'user' ? 'user' : 'bot', text: String(text || '') },
        }),
      });
    } catch (_) {}
  }

  function renderInputArea(stepDef) {
    var area = document.getElementById('gaInputArea');
    area.innerHTML = '';

    if (stepDef.inputType === 'text') {
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'ga-text-input';
      inp.placeholder = stepDef.placeholder ? stepDef.placeholder() : '';
      var err = document.createElement('div');
      err.className = 'ga-input-err';
      var btn = document.createElement('button');
      btn.className = 'ga-send-btn';
      btn.textContent = t().continueBtn;
      btn.onclick = function () {
        var val = inp.value;
        var e = stepDef.validate(val);
        if (e) { err.textContent = e; return; }
        err.textContent = '';
        state.answers[stepDef.key] = val.trim();
        addUserMessage(val.trim());
        area.innerHTML = '';
        state.step++;
        setTimeout(renderStep, 400);
      };
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.onclick(); });
      area.appendChild(inp);
      area.appendChild(err);
      area.appendChild(btn);
      setTimeout(function () { inp.focus(); }, 50);

    } else if (stepDef.inputType === 'choice') {
      var grid = document.createElement('div');
      grid.className = 'ga-choice-grid';
      stepDef.choices().forEach(function (choice) {
        var btn = document.createElement('button');
        btn.className = 'ga-choice-btn';
        btn.textContent = choice;
        btn.onclick = function () {
          state.answers[stepDef.key] = choice;
          addUserMessage(choice);
          area.innerHTML = '';
          state.step++;
          setTimeout(renderStep, 400);
        };
        grid.appendChild(btn);
      });
      area.appendChild(grid);

    } else if (stepDef.inputType === 'slots') {
      var slotGrid = document.createElement('div');
      slotGrid.className = 'ga-slot-grid';
      SLOTS.forEach(function (slot) {
        var btn = document.createElement('button');
        btn.className = 'ga-slot-btn';
        btn.textContent = slot;
        btn.onclick = function () {
          state.answers.slot = slot;
          addUserMessage(slot);
          area.innerHTML = '';
          state.step++;
          setTimeout(renderStep, 400);
        };
        slotGrid.appendChild(btn);
      });
      area.appendChild(slotGrid);
    }
  }

  function renderConfirm() {
    updateProgress();
    var a = state.answers;
    addBotMessage(
      t().botConfirm,
      function () {
        var area = document.getElementById('gaInputArea');
        area.innerHTML = '';

        var summary = document.createElement('div');
        summary.className = 'ga-confirm-summary';
        summary.innerHTML =
          '<div class="ga-summary-row"><span>Name</span><strong>' + escHtml(a.name) + '</strong></div>' +
          '<div class="ga-summary-row"><span>Email</span><strong>' + escHtml(a.email) + '</strong></div>' +
          '<div class="ga-summary-row"><span>Company</span><strong>' + escHtml(a.company) + '</strong></div>' +
          '<div class="ga-summary-row"><span>Role</span><strong>' + escHtml(a.role) + '</strong></div>' +
          '<div class="ga-summary-row"><span>Type</span><strong>' + escHtml(a.contractType) + '</strong></div>' +
          '<div class="ga-summary-row"><span>Urgency</span><strong>' + escHtml(a.urgency) + '</strong></div>' +
          '<div class="ga-summary-row"><span>Slot</span><strong>' + escHtml(a.slot) + '</strong></div>';

        var summaryBtn = document.createElement('button');
        summaryBtn.className = 'ga-summary-btn';
        summaryBtn.textContent = 'Get AI Summary';
        summaryBtn.onclick = function () { requestSummary(summaryBtn); };

        var summaryOut = document.createElement('div');
        summaryOut.className = 'ga-summary-out';
        summaryOut.id = 'gaSummaryOut';

        var confirmBtn = document.createElement('button');
        confirmBtn.className = 'ga-send-btn';
        confirmBtn.style.marginTop = '4px';
        confirmBtn.textContent = t().confirmBtn;
        confirmBtn.onclick = function () { submitAssistant(confirmBtn); };

        var errDiv = document.createElement('div');
        errDiv.className = 'ga-input-err';
        errDiv.id = 'gaSubmitErr';

        area.appendChild(summary);
        area.appendChild(summaryBtn);
        area.appendChild(summaryOut);
        area.appendChild(confirmBtn);
        area.appendChild(errDiv);
      }
    );
  }

  async function submitAssistant(btn) {
    btn.disabled = true;
    btn.textContent = t().confirmBtnBusy;
    document.getElementById('gaSubmitErr').textContent = '';

    var a = state.answers;
    try {
      var res = await fetch('/api/hire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: a.name,
          email: a.email,
          company: a.company,
          role: a.role,
          contractType: a.contractType,
          urgency: a.urgency,
          slot: a.slot,
        }),
      });
      var data = await res.json();
      if (res.ok && data.success) {
        // Move active chat → completed-inquiries history (signed-in users only)
        if (googleCredential) {
          authedFetch('/api/chat/complete', {
            method: 'POST',
            body:   JSON.stringify({
              salesforceId:     data.recordId || null,
              alreadySubmitted: !!data.alreadySubmitted,
            }),
          });
        }
        renderDone(!!data.alreadySubmitted);
      } else {
        document.getElementById('gaSubmitErr').textContent = (data && data.error) || 'Something went wrong. Please try again.';
        btn.disabled = false;
        btn.textContent = 'Confirm & Schedule';
      }
    } catch (_) {
      document.getElementById('gaSubmitErr').textContent = 'Network error. Please try again.';
      btn.disabled = false;
      btn.textContent = 'Confirm & Schedule';
    }
  }

  function renderDone(alreadySubmitted) {
    document.getElementById('gaProgressBar').style.width = '100%';
    var area = document.getElementById('gaInputArea');
    area.innerHTML = '';

    var firstName = state.answers.name.split(' ')[0];
    var message = alreadySubmitted
      ? t().botDuplicate(firstName)
      : t().botDone(firstName, state.answers.email);

    addBotMessage(message, function () {
      var done = document.createElement('div');
      done.className = 'ga-done';

      var checkEl = document.createElement('div');
      checkEl.className = 'ga-done-check';
      checkEl.innerHTML = '&#10003;';
      done.appendChild(checkEl);

      // Skip the slot/summary widgets for duplicate submissions — there's
      // no new booking to confirm or summarise.
      if (!alreadySubmitted) {
        var slotEl = document.createElement('div');
        slotEl.className = 'ga-done-slot';
        slotEl.textContent = state.answers.slot;

        var summaryBtn = document.createElement('button');
        summaryBtn.className = 'ga-summary-btn';
        summaryBtn.textContent = 'Get AI Summary';
        summaryBtn.onclick = function () { requestSummary(summaryBtn); };

        var summaryOut = document.createElement('div');
        summaryOut.className = 'ga-summary-out';
        summaryOut.id = 'gaSummaryOut';

        done.appendChild(slotEl);
        done.appendChild(summaryBtn);
        done.appendChild(summaryOut);
      }

      var closeBtn = document.createElement('button');
      closeBtn.className = 'ga-done-close';
      closeBtn.textContent = t().closeBtn;
      closeBtn.onclick = closeAssistant;
      done.appendChild(closeBtn);

      area.appendChild(done);
    });
  }

  async function requestSummary(btn) {
    btn.disabled = true;
    btn.textContent = 'Generating\u2026';
    var out = document.getElementById('gaSummaryOut');
    out.textContent = '';
    out.className = 'ga-summary-out';

    try {
      var res = await fetch('/api/summarise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:         state.answers.name,
          company:      state.answers.company,
          role:         state.answers.role,
          contractType: state.answers.contractType,
          urgency:      state.answers.urgency,
          slot:         state.answers.slot,
        }),
      });
      var data = await res.json();
      if (res.ok && data.summary) {
        out.textContent = data.summary;
        out.className = 'ga-summary-out ga-summary-ready';
        btn.textContent = 'Copy Summary';
        btn.disabled = false;
        btn.onclick = function () {
          navigator.clipboard.writeText(data.summary).then(function () {
            btn.textContent = 'Copied!';
            setTimeout(function () { btn.textContent = 'Copy Summary'; }, 2000);
          });
        };
      } else {
        out.textContent = data.error || 'Could not generate summary.';
        out.className = 'ga-summary-out ga-summary-err';
        btn.textContent = 'Retry';
        btn.disabled = false;
        btn.onclick = function () { requestSummary(btn); };
      }
    } catch (_) {
      out.textContent = 'Network error. Please try again.';
      out.className = 'ga-summary-out ga-summary-err';
      btn.textContent = 'Retry';
      btn.disabled = false;
        btn.onclick = function () { requestSummary(btn); };
    }
  }

  function scrollMessages() {
    var msgs = document.getElementById('gaMessages');
    msgs.scrollTop = msgs.scrollHeight;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ═══════════════════════════════════════════════════════════
     LEGACY HIRE ME MODAL (kept as-is)
  ═══════════════════════════════════════════════════════════ */

  // Open an <md-dialog>, waiting for the custom element to be upgraded
  // (the @material/web ESM script loads asynchronously from CDN, so
  // .show() may not yet exist on first render).
  function whenMdDialogReady(cb) {
    if (customElements.get('md-dialog')) { cb(); return; }
    customElements.whenDefined('md-dialog').then(cb);
  }

  function openHireMe() {
    var overlay = document.getElementById('hireMeOverlay');
    if (!overlay) return;
    whenMdDialogReady(function () {
      if (typeof overlay.show === 'function') overlay.show();
      else overlay.removeAttribute('hidden');
    });
  }
  window.openHireMe = openHireMe;

  function closeHireMe() {
    var overlay = document.getElementById('hireMeOverlay');
    if (typeof overlay.close === 'function') overlay.close();
    else overlay.setAttribute('hidden', '');
    document.getElementById('hireMeForm').reset();
    ['hm-name', 'hm-email', 'hm-company', 'hm-description'].forEach(function (id) {
      clearErr(id);
    });
    document.getElementById('hm-global-error').hidden = true;
    document.getElementById('hm-success').hidden = true;
    document.getElementById('hireMeForm').hidden = false;
    document.getElementById('hm-submit-btn').disabled = false;
    var lbl = document.getElementById('hm-submit-label');
    if (lbl) lbl.textContent = 'Send Message';
  }
  window.closeHireMe = closeHireMe;

  // <md-dialog> handles outside-click (scrim) and Escape key natively.
  // Listen for its `close` event to clean up form state.
  document.getElementById('hireMeOverlay').addEventListener('close', function () {
    document.getElementById('hireMeForm').reset();
    ['hm-name', 'hm-email', 'hm-company', 'hm-description'].forEach(clearErr);
    document.getElementById('hm-global-error').hidden = true;
    document.getElementById('hm-success').hidden = true;
    document.getElementById('hireMeForm').hidden = false;
    document.getElementById('hm-submit-btn').disabled = false;
    var lbl = document.getElementById('hm-submit-label');
    if (lbl) lbl.textContent = 'Send Message';
  });

  function setErr(fieldId, msg) {
    var field = document.getElementById(fieldId);
    if (!field) return;
    field.error = true;
    field.errorText = msg;
  }

  function clearErr(fieldId) {
    var field = document.getElementById(fieldId);
    if (!field) return;
    field.error = false;
    field.errorText = '';
  }

  function validate() {
    var name        = document.getElementById('hm-name').value.trim();
    var email       = document.getElementById('hm-email').value.trim();
    var company     = document.getElementById('hm-company').value.trim();
    var description = document.getElementById('hm-description').value.trim();
    var ok = true;
    ['hm-name', 'hm-email', 'hm-company', 'hm-description'].forEach(clearErr);

    if (!name)    { setErr('hm-name', 'Full name is required.'); ok = false; }
    if (!email)   { setErr('hm-email', 'Work email is required.'); ok = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErr('hm-email', 'Enter a valid email address.'); ok = false;
    }
    if (!company) { setErr('hm-company', 'Company name is required.'); ok = false; }
    if (description.length > 255) {
      setErr('hm-description', 'Message must be 255 characters or fewer.');
      ok = false;
    }

    return ok;
  }

  document.getElementById('hireMeForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!validate()) return;

    var btn       = document.getElementById('hm-submit-btn');
    var btnLabel  = document.getElementById('hm-submit-label');
    var globalErr = document.getElementById('hm-global-error');
    btn.disabled = true;
    if (btnLabel) btnLabel.textContent = 'Sending\u2026';
    globalErr.hidden = true;

    var payload = {
      name:        document.getElementById('hm-name').value.trim(),
      email:       document.getElementById('hm-email').value.trim(),
      company:     document.getElementById('hm-company').value.trim(),
      description: document.getElementById('hm-description').value.trim(),
    };

    try {
      var res  = await fetch('/api/hire', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      var data = await res.json();
      if (res.ok && data.success) {
        document.getElementById('hireMeForm').hidden = true;
        var successTextEl = document.getElementById('hm-success-text');
        if (successTextEl) {
          successTextEl.textContent = data.alreadySubmitted
            ? "✓ You've already reached out — thanks! I'll get back to you within 1–2 business days."
            : "✓ Message sent! I'll be in touch soon.";
        }
        document.getElementById('hm-success').hidden = false;
      } else {
        globalErr.textContent = (data && data.error) || t().errors.generic;
        globalErr.hidden = false;
        btn.disabled = false;
        if (btnLabel) btnLabel.textContent = 'Send Message';
      }
    } catch (_) {
      globalErr.textContent = 'Network error. Please check your connection and try again.';
      globalErr.hidden = false;
      btn.disabled = false;
      if (btnLabel) btnLabel.textContent = 'Send Message';
    }
  });

  /* ── "Refer Me" modal ────────────────────────────────────────────────────
     Pure client-side. Renders an editable email template, supports copy-
     to-clipboard and a `mailto:` launch for the visitor's default email
     client. No POST to the backend, no rate limit, no Salesforce write.
     The visitor sends from their own account, so we don't carry the abuse
     risk or sender-verification overhead a server-side mailer would.

     Why no backend tracking? The Recommendations feature already carries
     the SF integration narrative (custom object + Apex REST + trigger +
     callout). Forcing every UI feature through Salesforce dilutes that
     story; this stays deliberately lean. ─────────────────────────────── */

  function getReferEmailSubject() {
    return 'Referral — Abhinav Kumar for Senior Salesforce Engineer';
  }

  /**
   * Canonical public URL of the deployed portfolio. Used in the Refer Me
   * email body so the link the recruiter sees is always one they can
   * actually open — even when the visitor is previewing the page on
   * localhost or a private IP.
   *
   * Update this if you ever point a custom domain at the Cloud Run service.
   */
  var PORTFOLIO_PUBLIC_URL = 'https://portfolio-service-647206478056.asia-southeast1.run.app';

  /**
   * Public Google Drive shareable URL of the resume.
   *
   * We embed this in the Refer Me email body instead of asking the referrer
   * to download the PDF and re-attach it themselves — copy + send is faster
   * than copy + download + attach + send. The recipient clicks the link and
   * gets Drive's inline preview (no Drive account required if the file is
   * shared with "Anyone with the link can view").
   *
   * Setup (one-time):
   *   1. Upload your resume PDF to Google Drive.
   *   2. Right-click → "Get link" → set access to "Anyone with the link"
   *      with "Viewer" permission.
   *   3. Copy the URL Drive shows you (looks like
   *      https://drive.google.com/file/d/<FILE_ID>/view?usp=sharing) and
   *      paste it below, replacing the placeholder.
   *
   * If left as the placeholder, the email body still works — the recruiter
   * just sees a non-functional URL. Update before deploying.
   */
  var RESUME_DRIVE_URL = 'https://drive.google.com/file/d/REPLACE_WITH_YOUR_DRIVE_FILE_ID/view?usp=sharing';

  /**
   * Resolve the URL to embed in the email body.
   *
   * On a real public origin (e.g. the Cloud Run hostname or a custom
   * domain) we just use what the visitor is looking at — keeps things in
   * sync if you rename the service or move to a custom domain. On
   * localhost / private network ranges / file:// we fall back to the
   * canonical public URL, otherwise the recipient's inbox renders an
   * unreachable link.
   */
  function getPortfolioPublicUrl() {
    var origin = (window.location && window.location.origin) || '';
    var isUnreachable = !origin
      || /^https?:\/\/(localhost|127\.|192\.168\.|10\.|0\.0\.0\.0)/.test(origin)
      || origin.indexOf('file://') === 0;
    return isUnreachable ? PORTFOLIO_PUBLIC_URL : origin;
  }

  /**
   * Build the default email body. Three pieces of personalisation:
   *
   *   1. The portfolio URL is resolved via getPortfolioPublicUrl() — never
   *      a localhost / private-net link in the rendered template.
   *   2. The resume URL is the public Google Drive link (RESUME_DRIVE_URL),
   *      so the referrer doesn't need to download and re-attach a PDF —
   *      they just copy the email and hit Send.
   *   3. The signer name (the closing "Best, …") auto-fills from the
   *      cached Google profile when the visitor is signed in. Falls back
   *      to the {{your name}} placeholder for guests / signed-out users
   *      so they can swap in their own name inline before sending.
   *
   * The {{their first name}} placeholder stays unfilled — that's the
   * recruiter on the receiving end, which the referrer needs to type in
   * themselves.
   */
  function getReferEmailBody() {
    var origin = getPortfolioPublicUrl();
    var signerName = (siteProfile && siteProfile.type !== 'guest' && siteProfile.name)
      ? siteProfile.name
      : '{{your name}}';
    return [
      'Hi {{their first name}},',
      '',
      "I came across Abhinav Kumar's portfolio and thought he'd be a strong",
      'fit for a Senior Salesforce Engineer role on your team. He has 12+',
      'years of depth across Apex, LWC, OmniStudio, and CPQ, with production',
      'work at Salesforce, TCS, Cognizant, and Mindtree.',
      '',
      'His resume:',
      '  ' + RESUME_DRIVE_URL,
      '',
      'Full portfolio with project breakdowns and recommendations:',
      '  ' + origin,
      '',
      "If there's a fit, you can reach him directly at:",
      '  abhinavformula1@gmail.com',
      '',
      'Best,',
      signerName,
    ].join('\n');
  }

  function openReferMe() {
    var overlay = document.getElementById('referMeOverlay');
    if (!overlay) return;
    // Wait for both the dialog AND the inner text fields to upgrade before
    // setting .value — M3 components can drop early property writes if the
    // ESM bundle hasn't registered the custom element yet.
    Promise.all([
      customElements.whenDefined('md-dialog'),
      customElements.whenDefined('md-outlined-text-field'),
    ]).then(function () {
      var subjectEl = document.getElementById('refer-subject');
      var bodyEl    = document.getElementById('refer-body');
      if (subjectEl) subjectEl.value = getReferEmailSubject();
      if (bodyEl)    bodyEl.value    = getReferEmailBody();
      if (typeof overlay.show === 'function') overlay.show();
      else overlay.removeAttribute('hidden');
    });
  }
  window.openReferMe = openReferMe;

  function closeReferMe() {
    var overlay = document.getElementById('referMeOverlay');
    if (!overlay) return;
    if (typeof overlay.close === 'function') overlay.close();
    else overlay.setAttribute('hidden', '');
  }
  window.closeReferMe = closeReferMe;

  // Compose the canonical "Subject: ...\n\nBody" string used by both the
  // clipboard path and as the source-of-truth render of the user's edits.
  function buildReferComposed() {
    var subjectEl = document.getElementById('refer-subject');
    var bodyEl    = document.getElementById('refer-body');
    var subject = (subjectEl && subjectEl.value) || getReferEmailSubject();
    var body    = (bodyEl && bodyEl.value)       || getReferEmailBody();
    return { subject: subject, body: body, combined: 'Subject: ' + subject + '\n\n' + body };
  }

  // Flash a transient label change on the copy button. Cheap, no toast
  // infrastructure needed.
  function flashCopyLabel(msg) {
    var labelEl = document.getElementById('refer-copy-label');
    if (!labelEl) return;
    if (labelEl._restoreTimer) clearTimeout(labelEl._restoreTimer);
    var prev = labelEl._originalText || labelEl.textContent;
    labelEl._originalText = prev;
    labelEl.textContent = msg;
    labelEl._restoreTimer = setTimeout(function () {
      labelEl.textContent = labelEl._originalText;
    }, 1800);
  }

  function handleReferCopy() {
    var msg = buildReferComposed().combined;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(msg)
        .then(function () { flashCopyLabel('Copied \u2713'); })
        .catch(function () { fallbackCopy(msg); });
    } else {
      fallbackCopy(msg);
    }
  }

  // Legacy fallback for browsers where the async clipboard API is blocked
  // (older Safari/WebViews, restricted iframes). Synchronous execCommand
  // still works there.
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      flashCopyLabel(ok ? 'Copied \u2713' : 'Copy failed');
    } catch (_) {
      flashCopyLabel('Copy failed');
    }
  }

  function handleReferMailto() {
    var c = buildReferComposed();
    // mailto:?subject=...&body=... — recipient is intentionally left empty
    // so the visitor types the recruiter's address into their own email
    // client. Body is URL-encoded so newlines survive into Gmail / Outlook
    // / Apple Mail.
    var href = 'mailto:?subject=' + encodeURIComponent(c.subject)
             + '&body='          + encodeURIComponent(c.body);
    // Most browsers cap mailto: URLs ~2 KB. Our default body is ~600 chars,
    // so we're comfortably under. If the visitor edits heavily and overflows,
    // the Copy button is the always-works fallback.
    window.location.href = href;
  }

  // Wire the action buttons once their custom elements have upgraded.
  // We guard with `_wired` so re-opening the dialog doesn't stack listeners.
  customElements.whenDefined('md-filled-button').then(function () {
    var btn = document.getElementById('refer-copy-btn');
    if (btn && !btn._wired) {
      btn._wired = true;
      btn.addEventListener('click', handleReferCopy);
    }
  });
  customElements.whenDefined('md-outlined-button').then(function () {
    var btn = document.getElementById('refer-mailto-btn');
    if (btn && !btn._wired) {
      btn._wired = true;
      btn.addEventListener('click', handleReferMailto);
    }
  });

  /* ── Recommendations section ─────────────────────────────────────────────
     Three concerns colocated:
       1. RENDER  — fetch /api/recommendations on load, hydrate cards.
       2. GATE    — the "Leave a Recommendation" CTA only opens the modal
                    for Google-signed-in users; otherwise prompt sign-in.
       3. SUBMIT  — POST to /api/recommendation with the cached Google
                    credential as Bearer; on success, optimistically
                    re-render so the new card shows immediately. ────────── */
  function renderRecommendation(item) {
    var card = document.createElement('article');
    card.className = 'reco-card';
    card.setAttribute('data-uid', item.id);

    // Header: avatar + name @ company + when
    var header = document.createElement('header');
    header.className = 'reco-card-header';

    if (item.avatarUrl) {
      var img = document.createElement('img');
      img.className = 'reco-avatar';
      img.src   = item.avatarUrl;
      img.alt   = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      header.appendChild(img);
    } else {
      var initials = document.createElement('div');
      initials.className = 'reco-avatar reco-avatar-initials';
      initials.textContent = (item.name || '?').slice(0, 1).toUpperCase();
      header.appendChild(initials);
    }

    var who = document.createElement('div');
    who.className = 'reco-who';
    var nameEl = document.createElement('div');
    nameEl.className = 'reco-name';
    nameEl.textContent = item.name || 'Anonymous';
    var compEl = document.createElement('div');
    compEl.className = 'reco-company';
    compEl.textContent = item.company || '';
    who.appendChild(nameEl);
    if (item.company) who.appendChild(compEl);
    header.appendChild(who);

    // Pick the timestamp to render. If the recommendation has been edited
    // since first submission, show the edit time prefixed with "Updated"
    // so it doesn't look stale. The 60s tolerance avoids flagging the
    // trivial submittedAt/updatedAt skew that exists on the very first
    // write (Firestore server-timestamps land a few ms apart).
    var when = document.createElement('time');
    when.className = 'reco-when';
    var displayMs    = item.submittedAt;
    var displayLabel = '';
    if (item.updatedAt && item.submittedAt &&
        (item.updatedAt - item.submittedAt) > 60 * 1000) {
      displayMs    = item.updatedAt;
      displayLabel = 'Updated ';
    }
    when.textContent = displayLabel + formatRecoTimestamp(displayMs);
    if (displayMs) when.dateTime = new Date(displayMs).toISOString();
    header.appendChild(when);

    card.appendChild(header);

    // Body: recommendation text
    var text = document.createElement('p');
    text.className = 'reco-text';
    text.textContent = item.text || '';
    card.appendChild(text);

    // Reply (only if Abhinav has replied — flowed in via SF → GCP callback)
    if (item.reply) {
      var reply = document.createElement('div');
      reply.className = 'reco-reply';

      var replyHead = document.createElement('div');
      replyHead.className = 'reco-reply-head';
      var icon = document.createElement('span');
      icon.className = 'material-symbols-outlined reco-reply-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = 'reply';
      replyHead.appendChild(icon);
      var replyAuthor = document.createElement('span');
      replyAuthor.className = 'reco-reply-author';
      replyAuthor.textContent = 'Abhinav';
      replyHead.appendChild(replyAuthor);
      if (item.repliedAt) {
        var replyWhen = document.createElement('time');
        replyWhen.className = 'reco-reply-when';
        replyWhen.textContent = formatRecoTimestamp(item.repliedAt);
        replyWhen.dateTime = new Date(item.repliedAt).toISOString();
        replyHead.appendChild(replyWhen);
      }
      reply.appendChild(replyHead);

      var replyText = document.createElement('p');
      replyText.className = 'reco-reply-text';
      replyText.textContent = item.reply;
      reply.appendChild(replyText);

      card.appendChild(reply);
    }

    return card;
  }

  // Friendly relative-time. "just now" / "5m" / "3h" / "2d" / "Jan 12".
  function formatRecoTimestamp(ms) {
    if (!ms) return '';
    var diff = Date.now() - ms;
    if (diff < 60 * 1000)             return 'just now';
    if (diff < 60 * 60 * 1000)        return Math.floor(diff / 60000) + 'm';
    if (diff < 24 * 60 * 60 * 1000)   return Math.floor(diff / 3600000) + 'h';
    if (diff < 7  * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + 'd';
    var d = new Date(ms);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /**
   * Re-fetch the recommendation list and re-render the grid.
   *
   * The endpoint sets a 30-second public + CDN cache so a recruiter
   * refreshing the page doesn't hammer Firestore. That cache is the
   * right default for passive page loads — but it's wrong for the
   * RIGHT-AFTER-SUBMIT call, where the user expects to see their
   * own card immediately.
   *
   * Pass `{ bustCache: true }` from the post-submit path to skip both
   * browser and CDN caches via a unique query string. Other callers
   * (initial page load, visibilitychange) get the cached path so the
   * cache still does its job for everyone else.
   */
  function refreshRecommendations(opts) {
    opts = opts || {};
    var grid  = document.getElementById('recosGrid');
    var empty = document.getElementById('recosEmpty');
    if (!grid) return;
    var url = '/api/recommendations';
    if (opts.bustCache) url += '?_=' + Date.now();
    fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.recommendations)) return;

        // Find the visitor's own recommendation (if any) by matching their
        // Google sub against the public list's id field. Doing this here —
        // inside the success handler — keeps the CTA in sync with whatever
        // the server believes is currently active, including replies that
        // landed while we were on another tab.
        var mySub = (siteProfile && siteProfile.sub) || null;
        myRecommendation = mySub
          ? (data.recommendations.find(function (it) { return it.id === mySub; }) || null)
          : null;
        updateRecommendationCta();

        grid.innerHTML = '';
        if (data.recommendations.length === 0) {
          if (empty) empty.hidden = false;
          return;
        }
        if (empty) empty.hidden = true;
        data.recommendations.forEach(function (item) {
          grid.appendChild(renderRecommendation(item));
        });
      })
      .catch(function () { /* silent — section just stays empty */ });
  }

  /**
   * Re-renders the section CTA based on whether the visitor already has
   * an active recommendation. We swap the data-i18n key so a later
   * language toggle still picks up the right localized copy, AND we set
   * textContent immediately for the current language. Icon ligature is
   * also flipped for visual reinforcement.
   */
  function updateRecommendationCta() {
    var btn = document.getElementById('recosCtaBtn');
    if (!btn) return;
    var labelEl = btn.querySelector('[data-i18n]');
    var iconEl  = btn.querySelector('[slot="icon"]');
    var key     = myRecommendation ? 'recoCtaEdit' : 'recoCta';
    if (labelEl) {
      labelEl.setAttribute('data-i18n', key);
      var d = PAGE_LANG[currentLang] || PAGE_LANG.en;
      if (d[key]) labelEl.textContent = d[key];
    }
    if (iconEl) iconEl.textContent = myRecommendation ? 'edit' : 'rate_review';
  }
  refreshRecommendations();
  // Re-fetch when the user comes back to the tab (covers replies arriving
  // while they were in another tab — cheap, debounced by the 30s s-maxage).
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refreshRecommendations();
  });

  // ── Gate the CTA on Google sign-in state ───────────────────────────────
  function isSignedIn() { return !!googleCredential; }

  function openLeaveRecommendation() {
    if (!isSignedIn()) {
      // Not signed in — redirect them through the existing welcome flow.
      // It already handles Google Sign-In + remembers them, so by the time
      // they come back to click the CTA we'll have a credential cached.
      var welcome = document.getElementById('welcomeOverlay');
      if (welcome && typeof welcome.show === 'function') {
        welcome.show();
        return;
      }
      // Fallback for an exotic state — prompt and bail.
      alert('Please sign in with Google first to leave a recommendation.');
      return;
    }

    // Hydrate the identity preview from cached profile so the user sees
    // exactly what their card will look like before they hit submit.
    var profile = siteProfile || {};
    var avatar = document.getElementById('lr-avatar');
    var name   = document.getElementById('lr-name');
    var comp   = document.getElementById('lr-company');
    if (avatar && profile.picture) avatar.src = profile.picture;
    if (avatar) avatar.alt = profile.name || '';
    if (name)   name.textContent = profile.name || '';
    if (comp)   comp.textContent = (profile.email || '').split('@')[1] || '';

    // Edit-vs-new mode. The data layer is already idempotent on Google UID
    // (POST /api/recommendation upserts the same Firestore doc and the same
    // SF Testimonial__c via External Id), so all we have to flip on the
    // client is the modal chrome + textarea contents. The submit handler
    // doesn't need to know whether it's an edit — it sends the same
    // payload either way and the server figures out isNew.
    var titleEl = document.getElementById('lr-title-text');
    var lblEl   = document.getElementById('lr-submit-label');
    var textEl  = document.getElementById('lr-text');
    var d       = PAGE_LANG[currentLang] || PAGE_LANG.en;
    var isEdit  = !!myRecommendation;

    if (titleEl) titleEl.textContent = isEdit
      ? (d.recoModalTitleEdit || 'Edit your Recommendation')
      : (d.recoCta            || 'Leave a Recommendation');
    if (lblEl)   lblEl.textContent   = isEdit
      ? (d.recoSubmitEdit || 'Update Recommendation')
      : (d.recoSubmitNew  || 'Post Recommendation');

    // Pre-fill (or clear) the textarea. md-outlined-text-field only honours
    // .value once the custom element has upgraded, so wait for definition
    // before writing — otherwise the assignment can be silently dropped on
    // a cold load.
    customElements.whenDefined('md-outlined-text-field').then(function () {
      if (textEl) textEl.value = isEdit ? (myRecommendation.text || '') : '';
    });

    var overlay = document.getElementById('leaveRecoOverlay');
    if (!overlay) return;
    whenMdDialogReady(function () {
      if (typeof overlay.show === 'function') overlay.show();
      else overlay.removeAttribute('hidden');
    });
  }
  window.openLeaveRecommendation = openLeaveRecommendation;

  function closeLeaveRecommendation() {
    var overlay = document.getElementById('leaveRecoOverlay');
    if (!overlay) return;
    if (typeof overlay.close === 'function') overlay.close();
    else overlay.setAttribute('hidden', '');
    resetLeaveRecoForm();
  }
  window.closeLeaveRecommendation = closeLeaveRecommendation;

  function resetLeaveRecoForm() {
    var form = document.getElementById('leaveRecoForm');
    if (form) form.reset();
    // form.reset() doesn't reliably clear md-outlined-text-field once we've
    // programmatically assigned .value (edit mode pre-fills via the property,
    // not the attribute, so the "default" is still empty in form-internals
    // terms — but some Material versions hold on to the last property value).
    // Clear it explicitly so the next "new" open starts clean.
    var textEl = document.getElementById('lr-text');
    if (textEl) textEl.value = '';
    clearErr('lr-text');
    var globalErr = document.getElementById('lr-global-error');
    if (globalErr) globalErr.hidden = true;
    var btn = document.getElementById('lr-submit-btn');
    if (btn) btn.disabled = false;
    // Reset the chrome back to "new" defaults — openLeaveRecommendation()
    // will re-flip to edit mode if needed on the next open.
    var lbl = document.getElementById('lr-submit-label');
    if (lbl) lbl.textContent = 'Post Recommendation';
    var titleEl = document.getElementById('lr-title-text');
    if (titleEl) titleEl.textContent = 'Leave a Recommendation';
  }

  var lrOverlay = document.getElementById('leaveRecoOverlay');
  if (lrOverlay) lrOverlay.addEventListener('close', resetLeaveRecoForm);

  function validateLeaveReco() {
    var text = document.getElementById('lr-text').value.trim();
    clearErr('lr-text');
    if (!text) { setErr('lr-text', 'Please share a recommendation.'); return false; }
    if (text.length > 2000) {
      setErr('lr-text', 'Recommendation must be 2000 characters or fewer.');
      return false;
    }
    return true;
  }

  var lrForm = document.getElementById('leaveRecoForm');
  if (lrForm) lrForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!isSignedIn()) {
      // Edge case: token expired between modal-open and submit. Bail to
      // sign-in so the next attempt has a fresh credential.
      closeLeaveRecommendation();
      openLeaveRecommendation();
      return;
    }
    if (!validateLeaveReco()) return;

    var btn       = document.getElementById('lr-submit-btn');
    var btnLabel  = document.getElementById('lr-submit-label');
    var globalErr = document.getElementById('lr-global-error');

    // Mode is fixed at submit time — myRecommendation reflects what was
    // shown to the user when they opened the modal. We capture it locally
    // so the loading / error labels stay coherent even if a background
    // refresh changes myRecommendation while the request is in flight.
    var isEdit      = !!myRecommendation;
    var idleLabel   = isEdit ? 'Update Recommendation' : 'Post Recommendation';
    var loadingLbl  = isEdit ? 'Updating\u2026'         : 'Posting\u2026';

    btn.disabled = true;
    if (btnLabel) btnLabel.textContent = loadingLbl;
    globalErr.hidden = true;

    var payload = { text: document.getElementById('lr-text').value.trim() };

    function fail(msg) {
      globalErr.textContent = msg;
      globalErr.hidden = false;
      btn.disabled = false;
      if (btnLabel) btnLabel.textContent = idleLabel;
    }

    try {
      var res = await fetch('/api/recommendation', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + googleCredential,
        },
        body: JSON.stringify(payload),
      });
      var data = await res.json();

      if (res.status === 401) {
        // Token expired or invalid — clear and reprompt.
        setGoogleCredential(null);
        return fail('Your session expired. Please sign in again.');
      }

      if (res.status === 429) {
        return fail((data && (data.error || data.message))
          || "You've reached the recommendation limit for now. Try again in an hour.");
      }

      if (res.ok && data.success) {
        // Streamlined success path: close the modal immediately, refresh
        // the public list (cache-busted), and scroll the user to their
        // card. The card itself — with its "Updated just now" pill — is
        // the confirmation. No success banner, no timeout, no flicker.
        closeLeaveRecommendation();
        refreshRecommendations({ bustCache: true });
        var section = document.getElementById('recosSection');
        if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      fail((data && (data.error || data.message)) || 'Submission failed. Please try again.');
    } catch (_) {
      fail('Network error. Please check your connection and try again.');
    }
  });
})();
