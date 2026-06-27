## Media governance (GCS) — Apple/Google-grade approach

### Problem
In a CMS, editors re-upload images while iterating. If the system stores every upload as a new object forever, you get:

- **Orphan objects**: images no longer referenced by any article
- **Cost creep**: GCS storage (and sometimes egress) grows silently
- **Risky cleanup**: age-based deletion can break old articles that are still live

### Design principles (how big teams solve it)
- **Source of truth**: content references live in Firestore articles; storage is “dumb” blobs.
- **Content-addressed storage**: identical media maps to the same object name (dedupe).
- **Deterministic transforms**: enforce a standard output format (JPEG) and max width.
- **Safe deletion**: delete only objects proven unreferenced by canonical content.
- **Transparency**: an admin screen that shows `image ⇄ article` mapping + an audit endpoint.

### What this repo implements

#### 1) Media audit API (safe mapping)
Endpoint:
- `GET /api/admin/media/audit`

Returns:
- All objects under `gs://$MEDIA_BUCKET/media/`
- Which articles reference which objects (thumbnail + body HTML scan)
- Which objects are **orphans** (not referenced by any article)

This is the *only* safe basis for cleanup (not object age).

#### 2) Admin “Media Library” module
In the admin UI you can view:
- Bucket inventory summary
- Each object + preview
- “Used by” list with click-to-open the article
- Orphans-only filter

#### 3) Upload normalisation (cost + consistency)
Server-side upload (`POST /api/media/upload`):
- Accepts JPEG/PNG/WebP/SVG uploads
- Normalises output to **JPEG**
- Resizes to a standard output per preset:
  - `preset=article`: **max width 1600px**, keeps aspect ratio (no fixed height)
  - `preset=thumb`: **max width 1200px**, keeps aspect ratio
  - `preset=hero`: **1600×900 (16:9)**, resized with **cover crop** for consistent hero tiles
- Uses content hash naming (`media/<hash>.jpg`) to **dedupe** re-uploads

### Operational playbook
- **Do not** use bucket lifecycle “delete after N days” on `media/` — it can delete images used in older articles.
- Use the **audit** result to decide deletions.
- Keep Artifact Registry cleanup policy (e.g., keep last 5 images + delete older than 1 day) separate from media storage.

### Future hardening (optional)
- Add a “Delete orphan” action wired to a backend delete endpoint (with a server-side “still orphan?” recheck).
- Add a scheduled cleanup job (Cloud Scheduler → Cloud Run Job) that:
  - runs audit
  - logs orphan candidates
  - deletes only after a review window / allowlist
- Add a metrics dashboard:
  - total media objects
  - orphan bytes
  - growth per week
