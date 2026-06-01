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

  function saveSiteProfile(p) {
    siteProfile = p;
    try { sessionStorage.setItem('portfolio_profile', JSON.stringify(p)); } catch (_) {}
    updateTopbarUser(p);
  }

  function updateTopbarUser(p) {
    var el    = document.getElementById('topbarUser');
    var photo = document.getElementById('topbarUserPhoto');
    var name  = document.getElementById('topbarUserName');
    if (!el) return;
    if (p && p.type !== 'guest' && p.picture) {
      photo.src = p.picture;
      photo.alt = p.name;
      if (name) name.textContent = p.name;
      el.removeAttribute('hidden');
    } else {
      el.setAttribute('hidden', '');
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
    overlay.removeAttribute('hidden');
    // Render Google button once GIS loads
    if (window.google && window.google.accounts) {
      initGoogleSignIn();
    }
  }

  function hideWelcomeOverlay() {
    var overlay = document.getElementById('welcomeOverlay');
    if (overlay) overlay.setAttribute('hidden', '');
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
      profile = { name: payload.name, email: payload.email, picture: payload.picture };
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
      yearsExp: 'Years Experience',
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
      yearsExp: "Ans d'Expérience",
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
    document.getElementById('langEN').classList.toggle('lang-active', lang === 'en');
    document.getElementById('langFR').classList.toggle('lang-active', lang === 'fr');
    // Update page content
    applyPageLang(lang);
    // Update teaser bubble text
    var teaserText = document.querySelector('.chat-teaser-text');
    var teaserCta  = document.querySelector('.chat-teaser-cta');
    if (teaserText) teaserText.textContent = t().teaserText;
    if (teaserCta)  teaserCta.textContent  = t().teaserCta;
    // If assistant is open, restart it in the new language
    var overlay = document.getElementById('assistantOverlay');
    if (!overlay.hasAttribute('hidden')) {
      openAssistant();
    }
  }
  window.setLang = setLang;

  /* ── Chat Launcher ── */
  var teaserShown = false;

  // Populate page content in default language on load
  applyPageLang('en');

  // Restore topbar user if session exists
  if (siteProfile) {
    updateTopbarUser(siteProfile);
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

  function showTeaser() {
    teaserShown = true;
    var teaser = document.getElementById('chatTeaser');
    teaser.removeAttribute('hidden');
    var openIcon  = document.querySelector('.chat-fab-icon-open');
    var closeIcon = document.querySelector('.chat-fab-icon-close');
    openIcon.style.display  = 'none';
    closeIcon.style.display = '';
  }

  function hideTeaser() {
    document.getElementById('chatTeaser').setAttribute('hidden', '');
    var openIcon  = document.querySelector('.chat-fab-icon-open');
    var closeIcon = document.querySelector('.chat-fab-icon-close');
    openIcon.style.display  = '';
    closeIcon.style.display = 'none';
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
    document.querySelector('.chat-fab-icon-open').style.display = '';
    document.querySelector('.chat-fab-icon-close').style.display = 'none';
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

  function closeHireMe() {
    const overlay = document.getElementById('hireMeOverlay');
    overlay.setAttribute('hidden', '');
    document.getElementById('hireMeForm').reset();
    ['hm-name', 'hm-email', 'hm-company'].forEach(function (id) {
      clearErr(id);
    });
    document.getElementById('hm-global-error').hidden = true;
    document.getElementById('hm-success').hidden = true;
    document.getElementById('hireMeForm').hidden = false;
    document.getElementById('hm-submit-btn').disabled = false;
  }
  window.closeHireMe = closeHireMe;

  // Close on overlay background click
  document.getElementById('hireMeOverlay').addEventListener('click', function (e) {
    if (e.target === this) closeHireMe();
  });

  // Close on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeHireMe();
  });

  function setErr(fieldId, msg) {
    var input = document.getElementById(fieldId);
    var errEl = document.getElementById(fieldId + '-err');
    if (input) input.classList.add('hm-err');
    if (errEl) errEl.textContent = msg;
  }

  function clearErr(fieldId) {
    var input = document.getElementById(fieldId);
    var errEl = document.getElementById(fieldId + '-err');
    if (input) input.classList.remove('hm-err');
    if (errEl) errEl.textContent = '';
  }

  function validate() {
    var name    = document.getElementById('hm-name').value.trim();
    var email   = document.getElementById('hm-email').value.trim();
    var company = document.getElementById('hm-company').value.trim();
    var ok = true;
    ['hm-name', 'hm-email', 'hm-company'].forEach(clearErr);

    if (!name)    { setErr('hm-name', 'Full name is required.'); ok = false; }
    if (!email)   { setErr('hm-email', 'Work email is required.'); ok = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErr('hm-email', 'Enter a valid email address.'); ok = false;
    }
    if (!company) { setErr('hm-company', 'Company name is required.'); ok = false; }

    return ok;
  }

  document.getElementById('hireMeForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!validate()) return;

    var btn       = document.getElementById('hm-submit-btn');
    var globalErr = document.getElementById('hm-global-error');
    btn.disabled = true;
    btn.textContent = 'Sending\u2026';
    globalErr.hidden = true;

    var payload = {
      name:    document.getElementById('hm-name').value.trim(),
      email:   document.getElementById('hm-email').value.trim(),
      company: document.getElementById('hm-company').value.trim(),
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
        btn.textContent = 'Send Message';
      }
    } catch (_) {
      globalErr.textContent = 'Network error. Please check your connection and try again.';
      globalErr.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Send Message';
    }
  });
})();
