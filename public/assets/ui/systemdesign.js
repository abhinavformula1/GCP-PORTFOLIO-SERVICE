/**
 * System Design view -- master/detail topic browser.
 *
 * A second persona for the same body grid: instead of "About + Skills" on
 * the left and "Work Experience + Projects" on the right, we surface a
 * curated catalogue of architecture / design write-ups (left) with the
 * selected topic's full body (right). The resume DOM is hidden, not
 * removed, so:
 *   - the Download Resume button keeps scraping the resume nodes via
 *     querySelector ([hidden] doesn't affect that), and
 *   - flipping back to the resume view is instantaneous (no re-render).
 *
 * URL hash routing -- #/system-design/<topic-id> -- is the source of
 * truth for which topic is rendered. That means back/forward, deep
 * links pasted to a colleague, and reload all converge on the same
 * state.
 *
 * Locale flip -- listens for the <html lang> attribute mutation that
 * applyPageLang performs at the end of every language switch -- and
 * re-renders the active topic body in the new locale. Topic short
 * labels (title/subtitle) are also exposed via PAGE_LANG so the page-
 * level translator picks them up for free.
 */

import { currentLang } from '../core/i18n.js';

// ── Topic catalogue ──────────────────────────────────────────────────────────
//
// New topics: append an entry. `id` becomes the URL hash, `tags` render as
// chips, `readMinutes` is a rough self-reported estimate.
//
// Each locale (en / fr) holds its own `title`, `subtitle`, and `body`. The
// body is raw HTML -- keep it self-contained; the prose styles in
// style.css's `.sd-detail` block handle h3 / p / ul / pre / code.
export const TOPICS = [
  // ── Flagship: Salesforce -> MuleSoft Authentication ────────────────────────
  {
    id: 'salesforce-mulesoft-authentication',
    category: 'integration',
    icon: 'key',
    status: 'Published',
    tags: ['Salesforce', 'MuleSoft', 'OAuth 2.0', 'Security'],
    readMinutes: 10,
    en: {
      title: 'Salesforce to MuleSoft Authentication',
      subtitle: 'OAuth 2.0 Client Credentials, Named Credentials, TLS, and bearer-token risk',
      body: [
        '<section class="sd-hero-block">',
        '<div class="sd-kicker">Selected design</div>',
        '<h3 id="executive-summary" data-toc-label="Summary">OAuth 2.0 Client Credentials via Salesforce External + Named Credentials</h3>',
        '<p>This design lets Salesforce prove application identity to MuleSoft without hard-coding secrets in Apex. OAuth handles application authentication, TLS protects the channel, and Salesforce manages token acquisition and reuse through platform configuration.</p>',
        '<div class="sd-decision-grid">',
        '<div><span>Caller</span><strong>Salesforce Apex</strong></div>',
        '<div><span>Gateway</span><strong>MuleSoft API</strong></div>',
        '<div><span>Grant</span><strong>Client Credentials</strong></div>',
        '<div><span>Risk focus</span><strong>Bearer token replay</strong></div>',
        '</div>',
        '</section>',
        '<h3 id="problem" data-toc-label="Problem">Problem</h3>',
        '<p>Salesforce is the system of record and MuleSoft fronts downstream business APIs. There is no browser, login page, or user session when Salesforce calls MuleSoft. The core question is: how does Salesforce prove its identity without scattering long-lived secrets across application code?</p>',
        '<h3 id="goals" data-toc-label="Goals">Design goals</h3>',
        '<div class="sd-card-grid">',
        '<div class="sd-info-card"><strong>Authenticate the caller</strong><span>Prove that Salesforce is the trusted application invoking MuleSoft.</span></div>',
        '<div class="sd-info-card"><strong>Protect credentials</strong><span>Keep client credentials out of Apex and source control.</span></div>',
        '<div class="sd-info-card"><strong>Use standards</strong><span>Prefer OAuth 2.0 and TLS over custom authentication code.</span></div>',
        '<div class="sd-info-card"><strong>Reduce operations risk</strong><span>Let the platform manage token lifecycle and reuse.</span></div>',
        '</div>',
        '<h3 id="trust-boundaries" data-toc-label="Trust boundaries">Trust boundaries</h3>',
        '<div class="sd-flow" aria-label="Trust boundary flow">',
        '<span>Apex</span><span>Salesforce Platform</span><span>Network</span><span>MuleSoft</span><span>Downstream APIs</span>',
        '</div>',
        '<p>The protected assets are the client id, client secret, access token, and business data. The attacker model includes network observation, replay attempts, log access, repository access, and over-privileged org access. It does not assume TLS cryptography or Salesforce encrypted credential storage can be broken.</p>',
        '<h3 id="alternatives" data-toc-label="Alternatives">Alternatives considered</h3>',
        '<div class="sd-comparison">',
        '<div class="sd-comparison-row"><strong>Basic Authentication</strong><span>Rejected</span><p>Simple, but long-lived credentials are transmitted on every request and rotation is weak.</p></div>',
        '<div class="sd-comparison-row"><strong>API Key</strong><span>Rejected</span><p>Operationally easy, but not identity-aware and difficult to audit.</p></div>',
        '<div class="sd-comparison-row sd-selected"><strong>OAuth 2.0 Client Credentials</strong><span>Selected</span><p>Industry standard, short-lived tokens, native Salesforce support, and platform-managed lifecycle.</p></div>',
        '<div class="sd-comparison-row"><strong>Mutual TLS</strong><span>Future maturity</span><p>Strong sender identity, but certificate lifecycle adds operational overhead.</p></div>',
        '<div class="sd-comparison-row"><strong>JWT Bearer Flow</strong><span>Not selected</span><p>Strong cryptographic identity, but private key operations were unnecessary for this use case.</p></div>',
        '</div>',
        '<h3 id="selected-architecture" data-toc-label="Architecture">Selected architecture</h3>',
        '<div class="sd-sequence">',
        '<div><b>1</b><span>Apex makes a callout through the Named Credential.</span></div>',
        '<div><b>2</b><span>Salesforce requests or reuses an OAuth access token.</span></div>',
        '<div><b>3</b><span>The Named Credential injects the token into the MuleSoft API request.</span></div>',
        '<div><b>4</b><span>MuleSoft validates the token and routes the business request.</span></div>',
        '</div>',
        '<p>Most business requests require only one outbound call because the platform reuses previously obtained tokens until expiry.</p>',
        '<h3 id="implementation" data-toc-label="Implementation">Salesforce implementation</h3>',
        '<div class="sd-card-grid">',
        '<div class="sd-info-card"><strong>External Credential</strong><span>Defines OAuth protocol, token endpoint, client credentials, and principal configuration.</span></div>',
        '<div class="sd-info-card"><strong>Named Credential</strong><span>Defines the endpoint, performs token injection, and enables token reuse.</span></div>',
        '</div>',
        '<h3 id="security-properties" data-toc-label="Security properties">Security properties achieved</h3>',
        '<table class="sd-matrix"><tbody>',
        '<tr><th>Authentication</th><td>OAuth 2.0 Client Credentials</td></tr>',
        '<tr><th>Confidentiality</th><td>TLS protects credentials, token, and business data in transit.</td></tr>',
        '<tr><th>Integrity</th><td>TLS protects transport integrity; JWT signatures provide token integrity if JWT access tokens are used.</td></tr>',
        '<tr><th>Credential protection</th><td>Salesforce encrypted credential storage, no hard-coded Apex secrets.</td></tr>',
        '<tr><th>Token lifecycle</th><td>Platform-managed acquisition, caching, and renewal.</td></tr>',
        '<tr><th>Replay resistance</th><td>Partial. Bearer tokens remain replayable until expiry if stolen.</td></tr>',
        '<tr><th>Sender constraint</th><td>Not implemented. mTLS or DPoP would be the next maturity step.</td></tr>',
        '</tbody></table>',
        '<h3 id="failure-modes" data-toc-label="Failure modes">Failure modes</h3>',
        '<div class="sd-risk-grid">',
        '<div class="sd-risk low"><strong>Token expires</strong><span>Automatic token renewal. Low operational risk.</span></div>',
        '<div class="sd-risk medium"><strong>Token stolen</strong><span>Replay possible until expiration. Mitigate with TLS and short token lifetime.</span></div>',
        '<div class="sd-risk high"><strong>Client secret leaked</strong><span>Attacker can request tokens. Requires immediate secret rotation.</span></div>',
        '<div class="sd-risk medium"><strong>TLS failure</strong><span>Credential and data compromise. Rely on certificate validation and strong TLS.</span></div>',
        '</div>',
        '<h3 id="bearer-token-risk" data-toc-label="Bearer tokens">Bearer-token risk</h3>',
        '<p>Bearer tokens behave like cash: possession is enough to use them. A signature can prevent forgery, but it does not prevent reuse. The strongest mitigation is sender-constrained tokens such as mTLS or DPoP, which bind the token to a specific client.</p>',
        '<h3 id="conclusions" data-toc-label="Conclusions">Architectural conclusions</h3>',
        '<ul>',
        '<li>OAuth solves application authentication.</li>',
        '<li>TLS protects communication and business data in transit.</li>',
        '<li>Platform-managed authentication reduces custom-code risk.</li>',
        '<li>Bearer-token replay remains the main residual risk.</li>',
        '<li>Sender-constrained tokens are the next security maturity step.</li>',
        '</ul>',
      ].join(''),
    },
    fr: {
      title: 'Authentification Salesforce vers MuleSoft',
      subtitle: 'OAuth 2.0 Client Credentials, Named Credentials, TLS et risque bearer-token',
      body: '<p>Version detaillee en anglais pour conserver la precision des termes de securite.</p>',
    },
  },

  // ── Topic 1: GCP <-> Salesforce Integration ────────────────────────────────
  {
    id: 'gcp-sf-integration',
    category: 'integration',
    icon: 'cloud_sync',
    status: 'Published',
    tags: ['GCP', 'Salesforce', 'Integration'],
    readMinutes: 6,
    en: {
      title: 'GCP <-> Salesforce Integration',
      subtitle: 'Bidirectional sync over JWT bearer + Named Credential callbacks',
      body: [
        '<h3>Problem</h3>',
        '<p>A public-facing site (Cloud Run) needs to push leads, recommendations, and chat transcripts to Salesforce CRM &mdash; and Salesforce, in turn, needs to call <em>back</em> into the site whenever the architect posts a reply to a recommendation. Two systems, two different identity models, no shared session.</p>',
        '<h3>Solution</h3>',
        '<ul>',
        '<li><strong>GCP &rarr; Salesforce:</strong> JWT-bearer OAuth flow via <code>jsforce</code>. The private key lives in Google Secret Manager and is fetched once at cold-start; tokens are cached in-process and refreshed on 401. No interactive login, no client secret on disk.</li>',
        '<li><strong>Apex REST endpoints:</strong> custom <code>/services/apexrest/recommendation</code> and <code>/services/apexrest/inquiry</code> wrap the upsert + side-effects (lead conversion, follow-up task creation) inside a Salesforce transaction so partial failures roll back cleanly.</li>',
        '<li><strong>Salesforce &rarr; GCP:</strong> an Apex trigger on <code>Recommendation__c</code> fires an HTTP callout via the <code>Portfolio_Service</code> Named Credential whenever the architect adds a reply. The linked External Credential injects a shared <code>X-API-Key</code> header.</li>',
        '<li><strong>Constant-time auth on the GCP side:</strong> the inbound webhook compares the header against <code>SF_CALLBACK_SECRET</code> (Secret Manager-backed) using <code>crypto.timingSafeEqual</code> &mdash; no string equality, no timing leaks.</li>',
        '</ul>',
        '<h3>Trade-offs</h3>',
        '<ul>',
        '<li>JWT-bearer is fire-and-forget at the auth layer (no refresh-token round-trip), but it requires a connected app per environment and a one-off admin pre-authorisation. Worth it for server-to-server.</li>',
        '<li>Named Credentials hide the auth header from Apex code &mdash; great for security review, slightly harder to debug. Solution: log <code>X-API-Key</code> presence (not value) and the response code into <code>Integration_Log__c</code>.</li>',
        '<li>Single shared secret for callbacks is simpler than mTLS but rotates manually. For a personal portfolio this is fine; for a regulated workload I would swap in mTLS or signed JWTs from SF.</li>',
        '</ul>',
      ].join(''),
    },
    fr: {
      title: 'Integration GCP <-> Salesforce',
      subtitle: 'Synchronisation bidirectionnelle via JWT bearer + Named Credential',
      body: [
        '<h3>Probleme</h3>',
        '<p>Un site public (Cloud Run) doit pousser des leads, des recommandations et des transcriptions de chat vers Salesforce CRM &mdash; et Salesforce doit, a son tour, rappeler le site lorsque l\'architecte poste une reponse. Deux systemes, deux modeles d\'identite distincts, aucune session partagee.</p>',
        '<h3>Solution</h3>',
        '<ul>',
        '<li><strong>GCP &rarr; Salesforce :</strong> flux OAuth JWT-bearer via <code>jsforce</code>. La cle privee reside dans Secret Manager et est recuperee une seule fois au demarrage a froid ; les tokens sont mis en cache et rafraichis sur 401. Pas de login interactif, aucun secret client sur disque.</li>',
        '<li><strong>Endpoints Apex REST :</strong> les routes personnalisees <code>/services/apexrest/recommendation</code> et <code>/services/apexrest/inquiry</code> encapsulent l\'upsert et les effets de bord dans une transaction Salesforce afin que les echecs partiels fassent rollback proprement.</li>',
        '<li><strong>Salesforce &rarr; GCP :</strong> un trigger Apex sur <code>Recommendation__c</code> declenche un callout HTTP via le Named Credential <code>Portfolio_Service</code> des qu\'une reponse est ajoutee. L\'External Credential injecte un en-tete <code>X-API-Key</code> partage.</li>',
        '<li><strong>Auth en temps constant cote GCP :</strong> le webhook entrant compare l\'en-tete a <code>SF_CALLBACK_SECRET</code> avec <code>crypto.timingSafeEqual</code>.</li>',
        '</ul>',
        '<h3>Compromis</h3>',
        '<ul>',
        '<li>Le JWT-bearer est sans etat cote auth mais requiert une application connectee par environnement et une pre-autorisation admin ponctuelle.</li>',
        '<li>Les Named Credentials masquent l\'en-tete d\'auth au code Apex &mdash; excellent pour la revue securite, plus difficile a debugger. Solution : tracer la presence de <code>X-API-Key</code> et le code retour dans <code>Integration_Log__c</code>.</li>',
        '<li>Un secret partage unique est plus simple que mTLS mais doit etre roule manuellement.</li>',
        '</ul>',
      ].join(''),
    },
  },

  // ── Topic 2: Event-Driven Architecture ─────────────────────────────────────
  {
    id: 'event-driven-architecture',
    category: 'architecture',
    icon: 'bolt',
    status: 'Published',
    tags: ['Salesforce', 'Platform Events', 'CDC', 'EDA'],
    readMinutes: 7,
    en: {
      title: 'Event-Driven Architecture on Salesforce',
      subtitle: 'Platform Events vs Change Data Capture, with ordering + idempotency',
      body: [
        '<h3>When to reach for which</h3>',
        '<ul>',
        '<li><strong>Platform Events:</strong> for application-level intent ("OrderSubmitted", "ContractActivated"). Schema is yours, replay-id is yours, you control whether subscribers run synchronously (Apex trigger on the event) or async (CometD / Pub/Sub API).</li>',
        '<li><strong>Change Data Capture (CDC):</strong> for "tell me when <em>any</em> field on this object changes" &mdash; typically for downstream replicas, search indexes, analytics warehouses. Schema is fixed by Salesforce; you opt in by SObject.</li>',
        '</ul>',
        '<h3>Ordering</h3>',
        '<p>Salesforce guarantees event order <em>per partition</em> only &mdash; and partitioning is by <code>EventUuid</code>, not by record id. If you need "all events for Account X arrive in order at consumer Y" you cannot rely on the platform; you need a sequence number stamped at publish-time and an out-of-order buffer at the consumer.</p>',
        '<h3>Idempotency</h3>',
        '<p>Both Platform Events and CDC are at-least-once. Treat the consumer as a state machine keyed by <code>(record_id, replay_id)</code>: store the latest replay-id processed per record, drop anything &le; that. CDC\'s <code>ChangeEventHeader.commitNumber</code> + <code>commitTimestamp</code> are useful tie-breakers for events that share a replay-id across the bulk API.</p>',
        '<h3>Failure modes I have hit</h3>',
        '<ul>',
        '<li><strong>24-hour replay window:</strong> miss it and you have to re-bootstrap from a snapshot. Always pair an event stream with a query-on-startup fallback.</li>',
        '<li><strong>Apex trigger on Platform Event:</strong> runs in a system context with its own governor limits &mdash; a noisy event burst can starve other async work. Bulkify aggressively, batch the side-effects.</li>',
        '<li><strong>CDC + record locks:</strong> CDC fires <em>after</em> the transaction commits, so any "update Account on receive" handler can deadlock with the source transaction. Solution: queue the update via Platform Event, do not mutate the source object directly from the CDC handler.</li>',
        '</ul>',
      ].join(''),
    },
    fr: {
      title: 'Architecture evenementielle sur Salesforce',
      subtitle: 'Platform Events vs Change Data Capture, ordre et idempotence',
      body: [
        '<h3>Quand utiliser quoi</h3>',
        '<ul>',
        '<li><strong>Platform Events :</strong> pour exprimer une intention applicative ("OrderSubmitted", "ContractActivated"). Schema personnalise, replay-id gere, abonnes synchrones (trigger Apex sur l\'evenement) ou asynchrones (CometD / Pub/Sub API).</li>',
        '<li><strong>Change Data Capture (CDC) :</strong> pour "previens-moi des qu\'un champ change sur cet objet" &mdash; typiquement pour les replicas downstream, les index de recherche ou les entrepots analytiques. Schema fixe par Salesforce, opt-in par SObject.</li>',
        '</ul>',
        '<h3>Ordre</h3>',
        '<p>Salesforce garantit l\'ordre <em>par partition</em> uniquement &mdash; et le partitionnement se fait par <code>EventUuid</code>, pas par id de record. Si vous avez besoin que "tous les evenements pour le compte X arrivent dans l\'ordre" vous ne pouvez pas vous reposer sur la plateforme ; il faut estampiller un numero de sequence a la publication et bufferiser au consommateur.</p>',
        '<h3>Idempotence</h3>',
        '<p>Platform Events et CDC sont en at-least-once. Traitez le consommateur comme une machine a etats indexee par <code>(record_id, replay_id)</code> : stockez le dernier replay-id traite par record et ignorez tout &le; a cette valeur.</p>',
        '<h3>Modes de panne vecus</h3>',
        '<ul>',
        '<li><strong>Fenetre de replay de 24 h :</strong> ratez-la et il faut re-bootstrapper depuis un snapshot. Prevoyez toujours un fallback "query au demarrage".</li>',
        '<li><strong>Trigger Apex sur Platform Event :</strong> s\'execute en contexte systeme avec ses propres governor limits &mdash; une rafale bruyante peut affamer le reste de l\'async. Bulkifiez agressivement.</li>',
        '<li><strong>CDC + verrous d\'enregistrement :</strong> CDC se declenche <em>apres</em> commit, donc un handler "update Account on receive" peut deadlock avec la transaction source. Solution : passer par un Platform Event, ne pas muter l\'objet source directement.</li>',
        '</ul>',
      ].join(''),
    },
  },

  // ── Topic 3: Designing for Millions of Records ─────────────────────────────
  {
    id: 'millions-of-records',
    category: 'scale',
    icon: 'database',
    status: 'Published',
    tags: ['Salesforce', 'Apex', 'Bulk', 'LDV'],
    readMinutes: 8,
    en: {
      title: 'Designing for Millions of Records',
      subtitle: 'Selective queries, async aggregation, skinny tables, and bulk-safe triggers',
      body: [
        '<h3>The shape of the problem</h3>',
        '<p>Anything past ~2 million records on a single SObject in Salesforce starts to feel different: triggers hit governor limits during bulk loads, list views time out, queries that worked at 100k records take 30s at 5M. The rules do not change &mdash; the cost of breaking them does.</p>',
        '<h3>Selective queries</h3>',
        '<ul>',
        '<li>Always filter on an indexed field. Indexed = primary key, foreign key, <em>External ID</em>, <em>Unique</em>, or any field marked indexed by support.</li>',
        '<li>Selectivity threshold: a filter is selective if it returns &lt; 10% of rows under 1M, &lt; 5% above. The query planner ignores indexes that do not meet this &mdash; you will silently get a table scan.</li>',
        '<li>Use <code>EXPLAIN</code> via Developer Console to confirm the index actually fired.</li>',
        '</ul>',
        '<h3>Skinny tables</h3>',
        '<p>For read-heavy reports/list-views on 5M+ records, request a skinny table from Salesforce support: a denormalised projection of just the columns you query, kept in sync by Salesforce. Avoids the row-by-row joins that drag custom report types under at scale.</p>',
        '<h3>Async aggregation</h3>',
        '<p>Roll-up summary fields do not scale past a few thousand children per parent before they start triggering recursive recalculation storms during bulk DML. Replace with:</p>',
        '<ul>',
        '<li><strong>Batch Apex</strong> on a schedule for non-real-time roll-ups.</li>',
        '<li><strong>Platform Events</strong> + a queueable consumer for near-real-time &mdash; publish "ChildChanged", debounce on a Map keyed by parent id, recompute once per parent per batch window.</li>',
        '</ul>',
        '<h3>Bulk-safe triggers</h3>',
        '<ul>',
        '<li>One trigger per object, dispatch to handler classes. Standard now &mdash; still worth saying.</li>',
        '<li>Never put SOQL inside a loop. The compiler will not catch it; PMD / Apex Code Analyzer will.</li>',
        '<li>Pre-compute the parent-child join once into a <code>Map&lt;Id, Account&gt;</code> at the top of the handler, then iterate the trigger set against the map.</li>',
        '<li>Honour <code>Trigger.isExecuting</code> for chained recursion guards &mdash; a static <code>Set&lt;Id&gt;</code> of "already processed in this transaction" ids is the cheapest re-entry guard.</li>',
        '</ul>',
      ].join(''),
    },
    fr: {
      title: 'Concevoir pour des millions d\'enregistrements',
      subtitle: 'Requetes selectives, agregation async, skinny tables et triggers bulk-safe',
      body: [
        '<h3>La forme du probleme</h3>',
        '<p>Au-dela de ~2 millions d\'enregistrements sur un meme SObject, tout devient different : les triggers atteignent les governor limits lors des bulk loads, les list views timeout, les requetes qui passaient a 100k records prennent 30s a 5M. Les regles ne changent pas &mdash; le cout de leur violation, oui.</p>',
        '<h3>Requetes selectives</h3>',
        '<ul>',
        '<li>Toujours filtrer sur un champ indexe. Indexe = primary key, foreign key, <em>External ID</em>, <em>Unique</em>, ou index demande au support.</li>',
        '<li>Seuil de selectivite : un filtre est selectif s\'il retourne &lt; 10% des lignes sous 1M, &lt; 5% au-dela. Sinon le query planner ignore l\'index &mdash; et c\'est un table scan silencieux.</li>',
        '<li>Utilisez <code>EXPLAIN</code> dans la Developer Console pour confirmer que l\'index a bien ete utilise.</li>',
        '</ul>',
        '<h3>Skinny tables</h3>',
        '<p>Pour des rapports / list views read-heavy au-dela de 5M de records, demandez au support Salesforce une skinny table : une projection denormalisee des colonnes interrogees, maintenue a jour par Salesforce.</p>',
        '<h3>Agregation asynchrone</h3>',
        '<p>Les roll-up summary fields ne tiennent pas la route au-dela de quelques milliers d\'enfants par parent. Remplacez par :</p>',
        '<ul>',
        '<li><strong>Batch Apex</strong> programme pour les agregations non temps reel.</li>',
        '<li><strong>Platform Events</strong> + consommateur queueable pour le quasi temps reel &mdash; publiez "ChildChanged", debounce dans une Map indexee par parent id, recalcule une fois par parent et par fenetre batch.</li>',
        '</ul>',
        '<h3>Triggers bulk-safe</h3>',
        '<ul>',
        '<li>Un trigger par objet, dispatch vers des handler classes.</li>',
        '<li>Jamais de SOQL dans une boucle. Le compilateur ne detecte pas ; PMD / Apex Code Analyzer si.</li>',
        '<li>Pre-calculez la jointure parent-enfant une fois dans une <code>Map&lt;Id, Account&gt;</code>, puis iterez sur le trigger set contre la map.</li>',
        '<li>Utilisez un static <code>Set&lt;Id&gt;</code> "deja traites" comme garde de re-entree.</li>',
        '</ul>',
      ].join(''),
    },
  },

  // ── Topic 4: Sharing & Visibility (stub) ───────────────────────────────────
  {
    id: 'sharing-and-visibility',
    category: 'security',
    icon: 'shield_person',
    status: 'Coming soon',
    tags: ['Salesforce', 'Sharing', 'Security'],
    readMinutes: 4,
    stub: true,
    en: {
      title: 'Sharing & Visibility at Scale',
      subtitle: 'Apex-managed sharing, account hierarchies, criteria-based rules',
      body: '<p><em>Coming soon.</em> The trade-offs between Org-Wide Defaults, Role Hierarchy, criteria-based Sharing Rules, manual sharing, and Apex-managed sharing &mdash; with a worked example from a multi-million-account telco roll-out.</p>',
    },
    fr: {
      title: 'Partage & Visibilite a grande echelle',
      subtitle: 'Partage par Apex, hierarchie de comptes, regles par criteres',
      body: '<p><em>A venir.</em> Les arbitrages entre Org-Wide Defaults, hierarchie de roles, regles de partage par criteres, partage manuel et partage gere par Apex &mdash; avec un exemple vecu sur un rollout telecom multi-millions de comptes.</p>',
    },
  },

  // ── Topic 5: CPQ Bundle Modelling (stub) ───────────────────────────────────
  {
    id: 'cpq-bundle-modeling',
    category: 'delivery',
    icon: 'inventory_2',
    status: 'Coming soon',
    tags: ['CPQ', 'Pricing', 'Product Modeling'],
    readMinutes: 5,
    stub: true,
    en: {
      title: 'CPQ Bundle Modelling',
      subtitle: 'Product hierarchy, attribute inheritance, pricing waterfalls',
      body: '<p><em>Coming soon.</em> How to model a configurable bundle so that adding a new option does not require touching pricing, eligibility, and template logic in three different places.</p>',
    },
    fr: {
      title: 'Modelisation des bundles CPQ',
      subtitle: 'Hierarchie produit, heritage d\'attributs, cascade de prix',
      body: '<p><em>A venir.</em> Comment modeliser un bundle configurable pour qu\'ajouter une option ne demande pas de toucher a trois endroits differents (pricing, eligibility, templates).</p>',
    },
  },

  // ── Topic 6: Salesforce DevOps with Copado (stub) ──────────────────────────
  {
    id: 'salesforce-devops',
    category: 'delivery',
    icon: 'rocket_launch',
    status: 'Coming soon',
    tags: ['DevOps', 'Copado', 'CI/CD'],
    readMinutes: 4,
    stub: true,
    en: {
      title: 'Salesforce DevOps with Copado',
      subtitle: 'Branching, promotion, automated regression',
      body: '<p><em>Coming soon.</em> A pragmatic branching strategy for a 30-developer Salesforce team, the promotion pipeline that keeps prod-only metadata in sync, and the regression suite that gates deployment.</p>',
    },
    fr: {
      title: 'DevOps Salesforce avec Copado',
      subtitle: 'Branching, promotion, regression automatisee',
      body: '<p><em>A venir.</em> Une strategie de branching pragmatique pour une equipe Salesforce de 30 developpeurs, le pipeline de promotion, et la suite de regression qui securise le deploiement.</p>',
    },
  },
];

// ── Module state ─────────────────────────────────────────────────────────────
let _activeView  = 'resume';   // 'resume' | 'sysdesign'
let _activeTopic = null;
let _resumeAside = null;
let _resumeMain  = null;
let _sdAside     = null;
let _sdDetail    = null;
let _btn         = null;
let _topicFilter = '';

const HASH_PREFIX = '#/system-design';
const CATEGORY_LABELS = {
  integration: 'Integration',
  architecture: 'Architecture',
  scale: 'Scale',
  security: 'Security',
  delivery: 'Delivery',
};

function topicById(id) {
  for (let i = 0; i < TOPICS.length; i++) {
    if (TOPICS[i].id === id) return TOPICS[i];
  }
  return null;
}

function localeOf(topic) {
  return topic[currentLang] || topic.en;
}

// Topic ids use hyphens (URL-friendly) but data-i18n / PAGE_LANG keys are
// JS identifiers, so we normalise hyphens to underscores when building
// per-topic keys. e.g. "gcp-sf-integration" -> "sd_gcp_sf_integration_title".
function topicKey(id, suffix) {
  return 'sd_' + String(id).replace(/-/g, '_') + '_' + suffix;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normaliseText(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function uiText(key) {
  const fr = currentLang === 'fr';
  const dict = {
    title:       fr ? 'Carnet d architecture' : 'Architecture Notes',
    intro:       fr ? 'Choisissez un sujet pour voir les compromis, les choix et les details d implementation.' : 'Choose a topic to review trade-offs, design choices, and implementation details.',
    search:      fr ? 'Filtrer les sujets' : 'Filter topics',
    noResults:   fr ? 'Aucun sujet ne correspond.' : 'No matching topics.',
    articleLabel: fr ? 'Note de conception' : 'Design note',
  };
  return dict[key] || '';
}

// ── DOM construction (lazy, idempotent) ──────────────────────────────────────
function ensureDom() {
  const body = document.querySelector('.body');
  if (!body) return false;

  if (!_resumeAside) {
    _resumeAside = body.querySelector('aside');
    _resumeMain  = body.querySelector('main');
    if (_resumeAside) _resumeAside.classList.add('resume-aside');
    if (_resumeMain)  _resumeMain.classList.add('resume-main');
  }

  if (_sdAside && _sdDetail) return true;

  _sdAside = document.createElement('aside');
  _sdAside.className = 'sd-topics';
  _sdAside.setAttribute('hidden', '');

  _sdDetail = document.createElement('main');
  _sdDetail.className = 'sd-detail';
  _sdDetail.setAttribute('hidden', '');

  body.appendChild(_sdAside);
  body.appendChild(_sdDetail);
  renderTopicList();
  return true;
}

// ── Rendering ────────────────────────────────────────────────────────────────
function renderTopicList() {
  if (!_sdAside) return;
  const query = normaliseText(_topicFilter);
  let html = '';
  html += '<div class="sd-topics-header">';
  html += '<div class="sd-eyebrow" data-i18n="systemDesignEyebrow">System Design</div>';
  html += '<h2 class="sd-topics-title">' + escapeHtml(uiText('title')) + '</h2>';
  html += '<p class="sd-topics-intro">' + escapeHtml(uiText('intro')) + '</p>';
  html += '<label class="sd-topic-search">';
  html += '<span class="material-symbols-outlined" aria-hidden="true">search</span>';
  html += '<input type="search" value="' + escapeHtml(_topicFilter) + '" placeholder="' + escapeHtml(uiText('search')) + '" aria-label="' + escapeHtml(uiText('search')) + '">';
  html += '</label>';
  html += '</div>';
  html += '<button type="button" class="sd-overview-link' + (!_activeTopic ? ' sd-active' : '') + '" data-topic-id="">';
  html += '<span class="material-symbols-outlined" aria-hidden="true">dashboard</span>';
  html += '<span>Overview</span>';
  html += '</button>';
  html += '<div class="sd-topic-list" role="list">';
  let visibleCount = 0;
  Object.keys(CATEGORY_LABELS).forEach(function (category) {
    let group = '';
    let groupCount = 0;
    for (let i = 0; i < TOPICS.length; i++) {
      const t = TOPICS[i];
      if ((t.category || 'architecture') !== category) continue;
      const loc = localeOf(t);
      const haystack = normaliseText(loc.title + ' ' + loc.subtitle + ' ' + (t.tags || []).join(' '));
      if (query && haystack.indexOf(query) === -1) continue;
      groupCount += 1;
      visibleCount += 1;
      const active = t.id === _activeTopic ? ' sd-active' : '';
      const disabled = t.stub ? ' sd-disabled' : '';
      group += '<li class="sd-topic-item' + active + disabled + '" data-topic-id="' + t.id + '">';
      group += '<button type="button" class="sd-topic-btn" data-topic-id="' + t.id + '"' + (t.id === _activeTopic ? ' aria-current="page"' : '') + '>';
      group += '<span class="material-symbols-outlined sd-topic-icon" aria-hidden="true">' + (t.icon || 'article') + '</span>';
      group += '<span class="sd-topic-text">';
      group += '<span class="sd-topic-title" data-i18n="' + topicKey(t.id, 'title') + '">' + escapeHtml(loc.title) + '</span>';
      group += '<span class="sd-topic-sub" data-i18n="' + topicKey(t.id, 'subtitle') + '">' + escapeHtml(loc.subtitle) + '</span>';
      group += '</span>';
      group += '</button>';
      group += '</li>';
    }
    if (groupCount) {
      html += '<section class="sd-topic-group">';
      html += '<div class="sd-topic-group-title">' + escapeHtml(CATEGORY_LABELS[category]) + '</div>';
      html += '<ul role="list">' + group + '</ul>';
      html += '</section>';
    }
  });
  if (!visibleCount) {
    html += '<div class="sd-topic-empty">' + escapeHtml(uiText('noResults')) + '</div>';
  }
  html += '</div>';
  _sdAside.innerHTML = html;
  const search = _sdAside.querySelector('.sd-topic-search input');
  if (search) {
    search.addEventListener('input', function () {
      _topicFilter = search.value || '';
      renderTopicList();
      highlightActiveTopic();
      const nextSearch = _sdAside.querySelector('.sd-topic-search input');
      if (nextSearch) {
        nextSearch.focus();
        nextSearch.setSelectionRange(nextSearch.value.length, nextSearch.value.length);
      }
    });
  }
  _sdAside.querySelectorAll('.sd-topic-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      const id = b.getAttribute('data-topic-id');
      location.hash = HASH_PREFIX + '/' + id;
    });
  });
  const overview = _sdAside.querySelector('.sd-overview-link');
  if (overview) {
    overview.addEventListener('click', function () {
      location.hash = HASH_PREFIX;
    });
  }
}

function renderLanding() {
  if (!_sdDetail) return;
  const published = TOPICS.filter(function (t) { return !t.stub; });
  const soon = TOPICS.filter(function (t) { return t.stub; });
  let html = '';
  html += '<section class="sd-landing">';
  html += '<div class="sd-landing-hero">';
  html += '<div class="sd-article-eyebrow">System Design</div>';
  html += '<h2>Architecture Notes</h2>';
  html += '<p>Deep-dive notes on Salesforce, GCP, MuleSoft, scale, security, and integration trade-offs. Built for recruiters, architects, and security reviewers who want more than resume bullets.</p>';
  html += '</div>';
  html += '<h3>Published notes</h3>';
  html += '<div class="sd-landing-grid">';
  published.forEach(function (t) {
    const loc = localeOf(t);
    html += '<button type="button" class="sd-landing-card" data-topic-id="' + t.id + '">';
    html += '<span class="material-symbols-outlined" aria-hidden="true">' + (t.icon || 'article') + '</span>';
    html += '<strong>' + escapeHtml(loc.title) + '</strong>';
    html += '<small>' + escapeHtml(loc.subtitle) + '</small>';
    html += '</button>';
  });
  html += '</div>';
  if (soon.length) {
    html += '<h3>Coming next</h3>';
    html += '<div class="sd-coming-grid">';
    soon.forEach(function (t) {
      const loc = localeOf(t);
      html += '<div class="sd-coming-card"><strong>' + escapeHtml(loc.title) + '</strong><span>Draft</span></div>';
    });
    html += '</div>';
  }
  html += '</section>';
  _sdDetail.innerHTML = html;
  _sdDetail.querySelectorAll('.sd-landing-card').forEach(function (card) {
    card.addEventListener('click', function () {
      location.hash = HASH_PREFIX + '/' + card.getAttribute('data-topic-id');
    });
  });
}

function renderTopicDetail() {
  if (!_sdDetail) return;
  const topic = topicById(_activeTopic);
  if (!topic) {
    _sdDetail.innerHTML = '<div class="sd-detail-empty">Pick a topic on the left.</div>';
    return;
  }
  const loc = localeOf(topic);
  let html = '<article class="sd-article">';
  html += '<header class="sd-article-head">';
  html += '<div class="sd-article-eyebrow">' + escapeHtml(uiText('articleLabel')) + '</div>';
  html += '<h2 class="sd-article-title">' + escapeHtml(loc.title) + '</h2>';
  if (loc.subtitle) {
    html += '<p class="sd-article-sub">' + escapeHtml(loc.subtitle) + '</p>';
  }
  html += '<div class="sd-article-meta">';
  if (topic.tags && topic.tags.length) {
    html += '<div class="sd-tags">';
    for (let i = 0; i < topic.tags.length; i++) {
      html += '<span class="sd-tag">' + escapeHtml(topic.tags[i]) + '</span>';
    }
    html += '</div>';
  }
  if (topic.readMinutes) {
    html += '<span class="sd-readtime"><span class="material-symbols-outlined" aria-hidden="true">schedule</span>' + topic.readMinutes + ' min</span>';
  }
  html += '</div>';
  html += '</header>';
  html += '<div class="sd-article-body">' + (loc.body || '') + '</div>';
  html += '</article>';
  _sdDetail.innerHTML = html;
  if (typeof _sdDetail.scrollIntoView === 'function') {
    _sdDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function highlightActiveTopic() {
  if (!_sdAside) return;
  _sdAside.querySelectorAll('.sd-topic-item').forEach(function (li) {
    if (li.getAttribute('data-topic-id') === _activeTopic) li.classList.add('sd-active');
    else li.classList.remove('sd-active');
  });
}

// ── View toggle ──────────────────────────────────────────────────────────────
function setView(view) {
  if (!ensureDom()) return;
  _activeView = view;
  const sysOn = view === 'sysdesign';
  const body = document.querySelector('.body');
  if (body) body.classList.toggle('sd-mode', sysOn);
  if (_resumeAside) _resumeAside.toggleAttribute('hidden', sysOn);
  if (_resumeMain)  _resumeMain.toggleAttribute('hidden', sysOn);
  _sdAside.toggleAttribute('hidden', !sysOn);
  _sdDetail.toggleAttribute('hidden', !sysOn);
  updateButton();
}

function updateButton() {
  const homeBtn = document.querySelector('.home-btn');
  const sysOn = _activeView === 'sysdesign';

  if (homeBtn) {
    homeBtn.setAttribute('aria-pressed', sysOn ? 'false' : 'true');
  }
  if (!_btn) return;

  const label = _btn.querySelector('[data-i18n="systemDesign"]');
  const icon  = _btn.querySelector('.material-symbols-outlined');
  if (label) {
    label.textContent = currentLang === 'fr' ? 'Conception systeme' : 'System Design';
  }
  if (icon) icon.textContent = 'schema';
  _btn.setAttribute('aria-pressed', sysOn ? 'true' : 'false');
}

// ── Hash routing ─────────────────────────────────────────────────────────────
function readHash() {
  const h = location.hash || '';
  if (h.indexOf(HASH_PREFIX) !== 0) return null;
  const rest = h.slice(HASH_PREFIX.length).replace(/^\//, '');
  return { id: rest || null };
}

function handleRoute() {
  const route = readHash();
  if (!route) {
    if (_activeView === 'sysdesign') setView('resume');
    return;
  }
  let id = route.id;
  if (!id) {
    _activeTopic = null;
    setView('sysdesign');
    renderTopicList();
    renderLanding();
    return;
  }
  if (!topicById(id)) id = TOPICS[0] ? TOPICS[0].id : null;
  _activeTopic = id;
  setView('sysdesign');
  renderTopicList();
  highlightActiveTopic();
  renderTopicDetail();
}

// ── Public API ───────────────────────────────────────────────────────────────
export function openSystemDesign(id) {
  ensureDom();
  if (id && topicById(id)) {
    location.hash = HASH_PREFIX + '/' + id;
    return;
  }
  if (_activeView === 'sysdesign') {
    return;
  }
  location.hash = HASH_PREFIX;
}

export function closeSystemDesign() {
  if (location.hash && location.hash.indexOf(HASH_PREFIX) === 0) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  setView('resume');
}

export function initSystemDesign() {
  _btn = document.querySelector('.systemdesign-btn');
  ensureDom();
  window.addEventListener('hashchange', handleRoute);
  const observer = new MutationObserver(function () {
    renderTopicList();
    highlightActiveTopic();
    if (_activeView === 'sysdesign') renderTopicDetail();
    updateButton();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  if (location.hash && location.hash.indexOf(HASH_PREFIX) === 0) {
    handleRoute();
  }
}
