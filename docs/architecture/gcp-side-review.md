# GCP-Side Design & Agreements — Testimonial Sync

**Owner:** GCP team (portfolio-service repo)
**Last updated:** 2026-09-07
**Re:** "Salesforce ↔ GCP: Testimonial Sync" — Option 2: Apex trigger → GCP Pub/Sub → Cloud Function → Firestore
**Status:** ✅ **GCP side PROVISIONED & smoke-tested (2026-09-07).** All resources live in `asia-southeast1`; end-to-end publish→Firestore verified, idempotency fence verified. Handoff values for SF in §11. Only open item: finalize the WIF attribute-condition against a real SF token (§9).

---

## 1. Verified facts (live from `gcloud` / `sf`)

| Item | Value |
|---|---|
| **PROJECT_ID** | `project-a54fddae-d2d0-49c6-8e4` |
| **PROJECT_NUMBER** | `647206478056` |
| **Org parent** | organization `343902871289` (exists → org policy *can* apply; see §9) |
| **Firestore** | database `(default)`, location **`asia-southeast1`**, `FIRESTORE_NATIVE` |
| **Cloud Run** | region **`asia-southeast1`**, URL `https://portfolio-service-psbctvqb3a-as.a.run.app` |
| **Existing Pub/Sub topics** | only `container-analysis-*` — no collision with `sf-testimonial-events` / `-dlq` |
| **SF secrets on Cloud Run** | `SF_CALLBACK_SECRET` + JWT set (`SF_CLIENT_ID/PRIVATE_KEY/USERNAME/LOGIN_URL`) |
| **Firestore data today** | exactly **1** `recommendations` doc (uid `…6547`), `reply` set, `repliedAt:null` |
| **`Testimonial__c.Status__c` picklist** | **`{Active (default), Hidden}`** — NOT "Inactive" |
| **`Testimonial__c` sync fields** | `Google_UID__c` (string, req), `Reply__c` (textarea, nillable), `Replied_At__c` (datetime, nillable), `Status__c` (picklist), `Transaction_Id__c` (string), `LastModifiedDate`/`SystemModstamp` (datetime) |

**Region is `asia-southeast1`** for topic, DLQ, subscription, and Cloud Function (co-located with Firestore + Cloud Run). The original spec's `asia-south1` was a slip.

---

## 2. Decision: Option B (scoped sync) — field ownership

The app **already** writes `recommendations/{uid}` (on submit and reply), so the sync must not become a second writer of the same fields. Chosen model: each field has exactly one writer.

| Field | Owner | Notes |
|---|---|---|
| `uid, email, emailVerified, hostedDomain, name, company, avatarUrl, text, submittedAt` | **App** (`upsertRecommendation`, immutable creation data) | Sync never writes these |
| `status` | **App at create** (`Active`), **SF** thereafter | Values `{Active, Hidden}`; read model shows only `Active` |
| `reply`, `repliedAt` | **SF** (via sync) | App **stops** writing these — retire `writeRecommendationReply` + `POST /api/recommendation/:uid/reply` (the buggy callback dies here) |
| `sourceUpdatedAt` | **SF** (via sync) | Idempotency watermark; not exposed publicly |
| `updatedAt` | Whoever writes last (GCP `serverTimestamp`) | Read-model marker only; never used by the fence |

**Non-goal:** SF-origin creates (an admin adding a `Testimonial__c` with no prior site submission) never reach the site — the trigger is UPDATE-only and SF lacks the Google-identity creation fields. (E.g. existing SF record uid `…7323`, which has no Firestore doc, will not sync.)

---

## 3. Resolved field contract (from SF team)

- **`sourceUpdatedAt` ← `LastModifiedDate`**, serialized UTC ISO-8601 with millis + `Z` (`yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`). Never local tz.
- **`repliedAt` ← `Replied_At__c`, repurposed to "reply authored at"** (delivery is Pub/Sub's job now). SF sets it via a **before-update state machine**: stamp `System.now()` on blank→set; clear on set→blank; leave unchanged on edit→edit (preserves original authoring time). Admins never touch it directly. `null` if blank.
- **Reply cleared → propagate `null`.** Blanking `Reply__c` in SF blanks it on the site; `reply:null` and `repliedAt:null` move together. `null` is a valid propagated value, not "ignore."
- **`status` values are `Active` / `Hidden`** (not "Inactive"). Function validates `status ∈ {Active, Hidden}`.
- **Trigger fires only when `Reply__c` OR `Status__c` changed**, gated on `Testimonial_Sync_Config__mdt.Sync_Enabled__c = true`, skipped in `Test.isRunningTest()` unless a test opts in. `Replied_At__c` is excluded from the fire-check (it's derived from `Reply__c`).

---

## 4. Cloud Function behavior (GCP side)

- **Wire:** native **Eventarc 2nd-gen Pub/Sub trigger** (not a hand-defined push sub). Handler consumes the **CloudEvent** shape: `event.data.message.data` → base64-decode → JSON-parse; attributes at `event.data.message.attributes`; `messageId` logged.
- **Attribute gate first:** ack-drop-log any `eventType !== 'testimonial.updated'` or unknown `eventVersion` (**`1.0`**) **before** decoding the body (forward-compat guard). Both values are env-overridable (`ACCEPTED_EVENT_TYPE`, `ACCEPTED_EVENT_VERSIONS`). Drops log at **WARNING** so a contract drift is visible, not silent.
- **Validate only SF-owned fields:** `uid` required; `status ∈ {Active, Hidden}`; `reply` ≤ 1000 chars if present; `sourceUpdatedAt` parseable. Absence of app-owned fields (`email`, etc.) is **not** an error.
- **No orphan docs:** get-first; if the doc doesn't exist → **ack + WARN log + metric**, do **not** create / DLQ / retry (expected for SF-origin records).
- **Idempotency fence:** write iff `existing.sourceUpdatedAt` is missing **OR** `incoming.sourceUpdatedAt > existing.sourceUpdatedAt`; else drop. `>=` semantics (**drop on tie**) — correct for at-least-once redelivery after a successful-write-then-timeout.
- **Merge-write only** `{reply, repliedAt, status, sourceUpdatedAt}` + `updatedAt` (`serverTimestamp`), `merge:true`. Never touches app-owned fields.
- **Timestamp conversion (critical):** convert incoming ISO strings → Firestore `Timestamp` on write — `repliedAt: iso ? Timestamp.fromDate(new Date(iso)) : null`, and store `sourceUpdatedAt` as a `Timestamp`. The read model calls `.toMillis()`; a raw ISO string would render `repliedAt` as `null` on the site.
- **Retry only on transient errors** (5xx from Firestore, network). Validation failures and stale-event drops **ack** (2xx) so Pub/Sub stops redelivering. After 5 failed deliveries → DLQ.

---

## 5. GCP resources to provision (on "go")

1. **Enable APIs:** `cloudfunctions`, `eventarc`, `sts` (already on: `artifactregistry, cloudbuild, firestore, iamcredentials, logging, monitoring, pubsub, run, secretmanager`).
2. **Pub/Sub** (all `asia-southeast1`): topic `sf-testimonial-events` (24 h retention); DLQ `sf-testimonial-events-dlq` (7 d) **+ a bare `sf-testimonial-events-dlq-sub`** so the depth alert has a subscription metric to read; the Eventarc-managed subscription with DLQ + retry (ack 60 s, max 5 attempts, backoff 10 s–600 s).
3. **Service accounts:**
   - `sa-sf-publisher` — `roles/pubsub.publisher` **topic-scoped** (not project).
   - `sa-firestore-writer` — `roles/datastore.user`, `roles/logging.logWriter`, `roles/monitoring.metricWriter`, **plus** `roles/run.invoker` + `roles/eventarc.eventReceiver` (needed for the trigger to fire); Pub/Sub service agent gets token-creator for OIDC push.
4. **WIF pool/provider** (`salesforce-pool` / `salesforce-oidc`) — created with a placeholder binding; finalized after validating the attribute mapping against a real SF test token (**`sub` vs `azp`** to be confirmed with the token). Fallback: SA JSON key (90-day rotation) delivered via Secret Manager / secure channel, **never chat**.
5. **Cloud Function** `sync-testimonial-to-firestore` (2nd-gen, Node 20, `asia-southeast1`, 256 MB, min 0 / max 5, internal ingress, `sa-firestore-writer`).

---

## 6. Environment, backfill, kill switch

- **Environment:** ship to the **prod topic**; smoke-test against a pre-seeded throwaway `recommendations/SMOKETEST-<uuid>` doc with `status:'Hidden'` (invisible on the site because the read model filters `Active`), then delete it. No mirror stack, no `testMode` code. **SF ships 1 Named Credential.**
- **Backfill:** **(a) + manual touch.** Only 1 doc exists; after go-live, if you want it to reflect SF as the new `reply` owner, re-save its `Testimonial__c` in SF to fire the update trigger — **after confirming SF's `Reply__c` holds the desired text** (SF now wins and would overwrite the current Firestore text). No job.
- **Kill switch — two independent layers:**
  - **SF-side (primary, graceful):** `Testimonial_Sync_Config__mdt.Sync_Enabled__c = false` — stops publishing at the source.
  - **GCP-side (circuit breaker):** disable the Eventarc subscription (or drop function `max-instances` to 0) — stops consumption when the *function* is the problem; events queue in the topic (24 h) and replay when re-enabled.
  - Do **not** use "delete the Named Credential" (blunt, lossy).

---

## 7. Monitoring (from SF spec, corrected)

Dashboard `sf-firestore-sync`; alerts: function error rate > 1%/5 min; **DLQ count > 0 for > 1 min** (needs `…-dlq-sub`); oldest unacked age > 300 s; publish failures > 0/5 min; invocations > 1000/day; monthly spend > $5. No `/health/sync-dead` endpoint — SF-side give-up (401/429/governor) is triaged from `Integration_Log__c`; over-monitoring a ~handful/year flow is net-negative.

---

## 8. Cost & volume

Firestore shows **1** recommendation today, so "~10 events/year" is generous. All resources sit within free tier → **~$0/mo**; the `> $5` spend alert is the tripwire. (This is why Option 2 was chosen over the ~$50/mo always-on Cloud Run gRPC subscriber, which remains documented future state.)

---

## 9. Open item (not blocking)

- **WIF org-policy (§9.1):** there **is** an org parent (`343902871289`) that can impose policy, and the Org Policy API is off / needs org-viewer to read. Build **WIF-first**; if the binding is rejected, fall back to key-file (no SF code change either way). Definitive check needs org access or simply attempting the binding.

---

## 10. Strategic note

`TESTIMONIAL_UPSERT` carries `reply`, so this sync **supersedes** the old reply-callback (`POST /api/recommendation/:uid/reply`) and its 401 secret-mismatch bug retires with it. Only one path writes `reply` (the sync) — enforced by the Option B ownership table (§2).

---

## 11. Provisioned resources & SF-team handoff (2026-09-07)

All created in project `project-a54fddae-d2d0-49c6-8e4` (number `647206478056`), region `asia-southeast1`.

| Resource | Name / value |
|---|---|
| **Publish topic** | `projects/project-a54fddae-d2d0-49c6-8e4/topics/sf-testimonial-events` (24 h retention) |
| **DLQ topic** | `sf-testimonial-events-dlq` (7 d) + bare sub `sf-testimonial-events-dlq-sub` (depth-alert metric) |
| **Eventarc subscription** | `eventarc-asia-southeast1-sync-testimonial-to-firestore-789288-sub-371` — ack 60 s, DLQ after 5 attempts, backoff 10 s–600 s |
| **Cloud Function** | `sync-testimonial-to-firestore` (gen2, Node 20, 256 Mi, min 0/max 5, internal ingress, `ACTIVE`) |
| **Runtime + trigger SA** | `sa-firestore-writer@project-a54fddae-d2d0-49c6-8e4.iam.gserviceaccount.com` |
| **Publisher SA (for SF)** | `sa-sf-publisher@project-a54fddae-d2d0-49c6-8e4.iam.gserviceaccount.com` — `roles/pubsub.publisher` scoped to the topic only |

**WIF (keyless auth) — what SF sets on the OIDC token:**

- **Token `aud`** (STS audience):
  `//iam.googleapis.com/projects/647206478056/locations/global/workloadIdentityPools/salesforce-pool/providers/salesforce-oidc`
- **Issuer** (must match SF My Domain, verified reachable): `https://orgfarm-2bd28edbe2-dev-ed.develop.my.salesforce.com` (JWKS `/id/keys`, RS256).
- **Impersonation target:** `sa-sf-publisher@…` — the `roles/iam.workloadIdentityUser` binding is **pending**: it will be scoped to the exact `sub`/`azp` from a real SF test token (§9). Send one JWT and I finalize the binding + attribute-condition.
- **Fallback** if org policy blocks WIF: SA JSON key for `sa-sf-publisher`, delivered via Secret Manager / secure channel — **never chat**.

**Verified in the smoke test:** published a `TESTIMONIAL_UPSERT` (attrs `eventType=TESTIMONIAL_UPSERT, eventVersion=v3`) → function applied `reply/repliedAt(as Timestamp)/status/sourceUpdatedAt` onto a throwaway `Hidden` doc, left app-owned fields untouched; a replay with equal `sourceUpdatedAt` was correctly dropped by the fence. Throwaway doc deleted.

**Accepted attributes:** `eventType` must equal `testimonial.updated`; `eventVersion` ∈ {`1.0`} (override via env `ACCEPTED_EVENT_TYPE` / `ACCEPTED_EVENT_VERSIONS`). Body is JSON `{uid, reply, repliedAt, status, sourceUpdatedAt}`. Function source: [functions/sync-testimonial-to-firestore/](../../functions/sync-testimonial-to-firestore/).

**2026-09-08 contract fix:** the gate originally expected `eventType=TESTIMONIAL_UPSERT` / `eventVersion∈{v1,v2,v3}`, but the deployed SF publisher (`TestimonialSyncQueueable`) sends `eventType=testimonial.updated` / `eventVersion=1.0`. Every live message tripped the gate and was ack-dropped (silently, at INFO) — no DLQ, no Firestore write, `sourceUpdatedAt` never appeared on the doc. Fixed by aligning the gate to the publisher's actual attributes and raising drop logs to WARNING. Verified end-to-end: real reply for uid `117265929042470906547` published → `sync_applied` → Firestore doc carries `reply/repliedAt/status/sourceUpdatedAt`, app-owned `name` untouched.
