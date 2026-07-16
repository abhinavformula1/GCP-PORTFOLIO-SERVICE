# GCP Portfolio Service

Personal portfolio site for **Abhinav Kumar** — Senior Salesforce Application Engineer — deployed on Google Cloud Platform with a Salesforce integration backbone.

## Stack

- **Runtime**: Node.js + Express on **Cloud Run** (`asia-southeast1`)
- **Storage**: **Firestore** (visitor sessions, chat history, recommendations, hire-me leads)
- **Secrets**: **Google Secret Manager** (Salesforce JWT key, Google OAuth client)
- **CI/CD**: **Cloud Build** trigger from GitHub `main`
- **Salesforce**: jsforce + JWT bearer flow → custom Apex REST endpoints (`/services/apexrest/recommendation`, `/services/apexrest/inquiry`) and standard Lead/Contact upserts
- **Salesforce → GCP callbacks**: Apex triggers fire HTTP callouts via the `Portfolio_Service` Named Credential when a testimonial reply is added in SF, and the GCP backend persists the reply to Firestore for the public site to render

## Frontend

Vanilla HTML / CSS / ES-modules — no framework. Material 3 web components for forms and dialogs. The page itself is the source of truth for the resume PDF (generated client-side on demand by scraping the live DOM).

## Local development

```bash
npm install
npm run dev        # node --watch server.js
```

Set `GOOGLE_CLIENT_ID`, `SF_*`, and Firestore creds via `.env` (see `src/config/index.js` for the full list). Salesforce integration is gracefully skipped when `SF_*` envs are absent, so local dev works without a Salesforce dev org. Atlas can also optionally use Tavily for live web augmentation on current-event or time-sensitive questions when `TAVILY_API_KEY` is set.

## Deployment

Pushing to `main` triggers Cloud Build, which runs `cloudbuild.yaml`:
1. Builds a container image and tags it with the commit SHA
2. Pushes to Artifact Registry (`asia-southeast1-docker.pkg.dev/<project>/portfolio-service/app`)
3. Deploys to the `portfolio-service` Cloud Run service in `asia-southeast1`

> Note: the Cloud Run service name and Artifact Registry repo are still `portfolio-service` (pre-rename). See deployment migration notes if/when those are renamed to `gcp-portfolio-service`.
