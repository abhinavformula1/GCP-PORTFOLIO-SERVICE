/**
 * Internationalisation strings + page-level translation engine.
 *
 * Two dictionaries:
 *   - LANG:      runtime strings used by the chat assistant state machine
 *                (bot prompts, error labels, button captions). Some are
 *                functions so they can interpolate user-supplied values
 *                like the visitor's first name.
 *   - PAGE_LANG: static page-content strings keyed by `data-i18n`,
 *                `data-i18n-html` and `data-i18n-list` attributes on the
 *                rendered HTML. `applyPageLang(lang)` walks the document
 *                and swaps text/innerHTML/list contents in place.
 *
 * `currentLang` is exported as a live binding — importers see updates as
 * soon as `setCurrentLang(lang)` is called from main.js's setLang
 * orchestrator. The orchestrator stays in main.js because the language
 * flip needs to also re-render the open chat assistant (which lives in
 * the legacy IIFE for now).
 */

// ── LANG (chat assistant runtime strings) ────────────────────────────────────
export const LANG = {
  en: {
    teaserText: 'Hi! Looking to hire a Salesforce engineer?',
    teaserCta: "Let's talk",
    botGreeting: "Hi there! I'm Atlas, Abhinav's virtual assistant. To schedule a quick chat, I'll need a few details. What's your name?",
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
      nameLooksLikeGreeting: "Hi there! I meant your actual name — what should I call you?",
      nameTooShort: 'Please enter your full name (at least 2 letters).',
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
    botGreeting: "Bonjour! Je suis Atlas, l'assistant virtuel d'Abhinav. Pour planifier un échange, j'ai besoin de quelques informations. Quel est votre nom?",
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
      nameLooksLikeGreeting: 'Bonjour! Je voulais dire votre vrai nom — comment dois-je vous appeler?',
      nameTooShort: 'Veuillez entrer votre nom complet (au moins 2 lettres).',
      emailRequired: "L'email est requis.",
      emailInvalid: 'Entrez une adresse email valide.',
      company: "Veuillez entrer le nom de l'entreprise.",
      network: 'Erreur réseau. Veuillez réessayer.',
      generic: "Une erreur s'est produite. Veuillez réessayer.",
    },
  },
};

// ── PAGE_LANG (DOM-driven page translations, keyed by data-i18n*) ────────────
export const PAGE_LANG = {
  en: {
    headerTitle: 'Senior Salesforce Application Engineer',
    getInTouch: 'Get In Touch',
    hireTitleSent: 'Message sent',
    hireTitleAlready: 'Already received',
    hireSuccessHeadline: 'Message sent',
    hireSuccessBody: "Thanks for reaching out. I usually reply within 24 hours via email.",
    hireSuccessBodyNamed: "Thanks, {name}. I usually reply within 24 hours via email.",
    hireAlreadyHeadline: 'Already received',
    hireAlreadyBody: "Thanks again — your earlier message is in my queue. I'll get back to you within 1–2 business days.",
    hireAlreadyBodyNamed: "Thanks, {name} — your earlier message is in my queue. I'll get back to you within 1–2 business days.",
    hireSuccessDone: 'Done',
    referMe: 'Refer Me',
    downloadResume: 'Download Resume',
    systemDesign: 'System Design',
    systemDesignEyebrow: 'System Design',
    systemDesignStub: 'Soon',
    backToResume: 'Back to Resume',
    sd_gcp_sf_integration_title: 'GCP <-> Salesforce Integration',
    sd_gcp_sf_integration_subtitle: 'Bidirectional sync over JWT bearer + Named Credential callbacks',
    sd_event_driven_architecture_title: 'Event-Driven Architecture on Salesforce',
    sd_event_driven_architecture_subtitle: 'Platform Events vs Change Data Capture, with ordering + idempotency',
    sd_millions_of_records_title: 'Designing for Millions of Records',
    sd_millions_of_records_subtitle: 'Selective queries, async aggregation, skinny tables, and bulk-safe triggers',
    sd_sharing_and_visibility_title: 'Sharing & Visibility at Scale',
    sd_sharing_and_visibility_subtitle: 'Apex-managed sharing, account hierarchies, criteria-based rules',
    sd_cpq_bundle_modeling_title: 'CPQ Bundle Modelling',
    sd_cpq_bundle_modeling_subtitle: 'Product hierarchy, attribute inheritance, pricing waterfalls',
    sd_salesforce_devops_title: 'Salesforce DevOps with Copado',
    sd_salesforce_devops_subtitle: 'Branching, promotion, automated regression',
    referMeIntro: "Thanks for thinking of referring me — copy the email below, edit, and send. The resume link is included in the body so you don't have to attach anything.",
    referMeCopy: 'Copy email',
    referMePrivacy: 'Nothing leaves your device until you hit Send in your own email. No tracking, no backend processing.',
    resumePreviewTitle: 'Resume Preview',
    resumePreviewIntro: 'This PDF is generated live from the page above. Review it below, then download.',
    resumePreviewDownload: 'Download PDF',
    resumePreviewClose: 'Close',
    contactInfo: 'Contact info',
    contactInfoTitle: 'Contact Info',
    contactInfoIntro: 'Reach me through any of these channels — copy is one click away.',
    contactInfoEmail: 'Email',
    contactInfoPhone: 'Phone',
    contactInfoPhoneHint: 'Visible after sign-in with a verified work email.',
    contactInfoLinkedIn: 'LinkedIn',
    contactInfoTrailblazer: 'Trailblazer',
    contactInfoGithub: 'GitHub',
    contactInfoLocation: 'Location',
    contactInfoCopied: 'Copied to clipboard',
    recoTitle: 'Recommendations',
    recoSubtitle: "What people I've worked with — and recruiters I've spoken with — have to say.",
    recoCta: 'Leave a Recommendation',
    recoModalTitleEdit: 'Edit your Recommendation',
    recoSubmitNew: 'Post Recommendation',
    recoSubmitEdit: 'Update Recommendation',
    recoMenuLabel: 'Recommendation actions',
    recoEdit: 'Edit',
    recoDelete: 'Delete',
    recoDeleteConfirmTitle: 'Delete this recommendation?',
    recoDeleteConfirmHint: "Your reply from Abhinav will also be removed. This can't be undone.",
    recoDeleteConfirmBtn: 'Delete',
    recoDeleteCancelBtn: 'Cancel',
    recoDeleting: 'Deleting\u2026',
    recoDeleteFailed: "Couldn't delete just now. Please try again.",
    footerBuiltWith: 'Built with',
    footerTrademarkNote: 'Trademarks are property of their respective owners. This is a personal portfolio; no endorsement or sponsorship is implied.',
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
    hireTitleSent: 'Message envoyé',
    hireTitleAlready: 'Déjà reçu',
    hireSuccessHeadline: 'Message envoyé',
    hireSuccessBody: "Merci de votre message. Je réponds généralement sous 24 heures par e-mail.",
    hireSuccessBodyNamed: "Merci, {name}. Je réponds généralement sous 24 heures par e-mail.",
    hireAlreadyHeadline: 'Déjà reçu',
    hireAlreadyBody: "Merci à nouveau — votre précédent message est dans ma file. Je reviendrai vers vous sous 1 à 2 jours ouvrés.",
    hireAlreadyBodyNamed: "Merci, {name} — votre précédent message est dans ma file. Je reviendrai vers vous sous 1 à 2 jours ouvrés.",
    hireSuccessDone: 'Terminé',
    referMe: 'Me Recommander',
    downloadResume: 'Télécharger le CV',
    systemDesign: 'Conception système',
    systemDesignEyebrow: 'Conception système',
    systemDesignStub: 'Bientôt',
    backToResume: 'Retour au CV',
    sd_gcp_sf_integration_title: 'Intégration GCP <-> Salesforce',
    sd_gcp_sf_integration_subtitle: 'Synchronisation bidirectionnelle via JWT bearer + Named Credential',
    sd_event_driven_architecture_title: 'Architecture événementielle sur Salesforce',
    sd_event_driven_architecture_subtitle: 'Platform Events vs Change Data Capture, ordre et idempotence',
    sd_millions_of_records_title: "Concevoir pour des millions d'enregistrements",
    sd_millions_of_records_subtitle: 'Requêtes sélectives, agrégation async, skinny tables et triggers bulk-safe',
    sd_sharing_and_visibility_title: 'Partage & Visibilité à grande échelle',
    sd_sharing_and_visibility_subtitle: "Partage par Apex, hiérarchie de comptes, règles par critères",
    sd_cpq_bundle_modeling_title: 'Modélisation des bundles CPQ',
    sd_cpq_bundle_modeling_subtitle: "Hiérarchie produit, héritage d'attributs, cascade de prix",
    sd_salesforce_devops_title: 'DevOps Salesforce avec Copado',
    sd_salesforce_devops_subtitle: 'Branching, promotion, régression automatisée',
    referMeIntro: "Merci d'envisager de me recommander — copiez l'e-mail ci-dessous, modifiez-le et envoyez-le. Le lien du CV est inclus dans le corps du message, vous n'avez donc rien à joindre.",
    referMeCopy: "Copier l'e-mail",
    referMePrivacy: "Rien ne quitte votre appareil tant que vous n'avez pas cliqué sur Envoyer dans votre propre messagerie. Pas de traçage, pas de traitement côté serveur.",
    resumePreviewTitle: 'Aperçu du CV',
    resumePreviewIntro: "Ce PDF est généré en direct depuis la page ci-dessus. Vérifiez-le ci-dessous, puis téléchargez.",
    resumePreviewDownload: 'Télécharger le PDF',
    resumePreviewClose: 'Fermer',
    contactInfo: 'Coordonnées',
    contactInfoTitle: 'Coordonnées',
    contactInfoIntro: "Contactez-moi via l'un de ces canaux — copie en un clic.",
    contactInfoEmail: 'E-mail',
    contactInfoPhone: 'Téléphone',
    contactInfoPhoneHint: "Visible après connexion avec un e-mail professionnel vérifié.",
    contactInfoLinkedIn: 'LinkedIn',
    contactInfoTrailblazer: 'Trailblazer',
    contactInfoGithub: 'GitHub',
    contactInfoLocation: 'Localisation',
    contactInfoCopied: 'Copié dans le presse-papiers',
    recoTitle: 'Recommandations',
    recoSubtitle: "Ce que les personnes avec qui j'ai travaillé — et les recruteurs avec qui j'ai échangé — disent.",
    recoCta: 'Laisser une Recommandation',
    recoModalTitleEdit: 'Modifier votre Recommandation',
    recoSubmitNew: 'Publier la Recommandation',
    recoSubmitEdit: 'Mettre à jour la Recommandation',
    recoMenuLabel: 'Actions de la recommandation',
    recoEdit: 'Modifier',
    recoDelete: 'Supprimer',
    recoDeleteConfirmTitle: 'Supprimer cette recommandation ?',
    recoDeleteConfirmHint: "La réponse d'Abhinav sera également supprimée. Action irréversible.",
    recoDeleteConfirmBtn: 'Supprimer',
    recoDeleteCancelBtn: 'Annuler',
    recoDeleting: 'Suppression\u2026',
    recoDeleteFailed: "Impossible de supprimer pour l'instant. Veuillez réessayer.",
    footerBuiltWith: 'Conçu avec',
    footerTrademarkNote: "Les marques déposées appartiennent à leurs propriétaires respectifs. Ce site est un portfolio personnel ; aucun partenariat ni parrainage n'est sous-entendu.",
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

/**
 * Apply the active language's PAGE_LANG dictionary to the live DOM.
 * Walks three attribute groups:
 *   - [data-i18n]      → textContent
 *   - [data-i18n-html] → innerHTML (used when the source string contains
 *                        markup like <strong> for emphasis)
 *   - [data-i18n-list] → rebuilds <ul>/<ol> children from a string array
 * Also stamps the chosen `lang` onto the <html> element for accessibility
 * and search-engine signalling.
 */
export function applyPageLang(lang) {
  const d = PAGE_LANG[lang] || PAGE_LANG.en;
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    const key = el.getAttribute('data-i18n');
    if (d[key] !== undefined) el.textContent = d[key];
  });
  document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
    const key = el.getAttribute('data-i18n-html');
    if (d[key] !== undefined) el.innerHTML = d[key];
  });
  document.querySelectorAll('[data-i18n-list]').forEach(function (ul) {
    const key = ul.getAttribute('data-i18n-list');
    if (!d[key]) return;
    ul.innerHTML = '';
    d[key].forEach(function (item) {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    });
  });
  document.documentElement.lang = lang;
}

// ── currentLang (live binding) ───────────────────────────────────────────────
// Default to English; main.js's setLang orchestrator updates this whenever
// the user picks from the language select. Importers (chat, recommendations,
// refer, hireme) read the live binding and pick up changes for free.
export let currentLang = 'en';

export function setCurrentLang(lang) { currentLang = lang; }

/**
 * Convenience accessor for the active runtime dictionary, e.g. `t().botGreeting`.
 * Used everywhere the chat assistant needs to render i18n'd text.
 */
export function t() { return LANG[currentLang]; }
