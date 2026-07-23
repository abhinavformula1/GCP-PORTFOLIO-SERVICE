## Offline RAG Indexer (Python)

This folder contains an **offline indexing job** that:

- Reads published articles from Firestore (`systemDesignArticles`)
- Chunks them into embedding-ready text
- Calls Gemini Embeddings (Generative Language API) to create vectors
- Upserts deterministic docs into Firestore `rag_chunks/{articleId}_chunk_{chunkIndex}`

This is intentionally **decoupled** from the Node.js web server so you can run it:

- Locally (developer laptop)
- As a **Cloud Run Job** (batch), triggered by Cloud Scheduler / manual runs

### Prerequisites

- Python 3.9+
- Firestore access (either local ADC via `gcloud auth application-default login`, or a service account via `GOOGLE_APPLICATION_CREDENTIALS`)
- Env vars (same names as the Node runtime):
  - `FIRESTORE_PROJECT_ID` (or `GOOGLE_CLOUD_PROJECT`)
  - `FIRESTORE_DATABASE_ID` (optional, default `(default)`)
  - `GEMINI_API_KEY`

### Local run

From repo root:

```bash
cd tools/indexer_py
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# optional: load env vars from repo root .env
export DOTENV_PATH=../../.env

python main.py --mode reindex-all
```

### Cloud Run Job (outline)

#### 1) Build & push image (Artifact Registry)

```bash
# Set these once
export PROJECT_ID="YOUR_GCP_PROJECT_ID"
export REGION="us-central1"
export REPO="portfolio-jobs"
export IMAGE="rag-indexer"

# Create repo (one-time)
gcloud artifacts repositories create "$REPO" \
  --project "$PROJECT_ID" \
  --location "$REGION" \
  --repository-format docker

# Build and push
gcloud builds submit \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --tag "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/$IMAGE:latest" \
  --file tools/indexer_py/Dockerfile \
  .
```

#### 2) Create secret (recommended)

```bash
printf "%s" "YOUR_GEMINI_API_KEY" | gcloud secrets create GEMINI_API_KEY --data-file=-
gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --member="serviceAccount:YOUR_RUNTIME_SA@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

#### 3) Deploy Cloud Run Job

```bash
export JOB_NAME="rag-indexer"
export RUNTIME_SA="YOUR_RUNTIME_SA@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud run jobs deploy "$JOB_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/$IMAGE:latest" \
  --service-account "$RUNTIME_SA" \
  --set-env-vars "FIRESTORE_PROJECT_ID=$PROJECT_ID" \
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest" \
  --command "python" \
  --args "/app/main.py,--mode,incremental"
```

#### 4) Run on demand

```bash
gcloud run jobs execute "$JOB_NAME" --project "$PROJECT_ID" --region "$REGION"
```

#### 5) Schedule (Cloud Scheduler → HTTP → Run Jobs API)

Easiest: create a scheduler that calls the Cloud Run Jobs **Executions** API with OIDC.
If you want, tell me your `PROJECT_ID`, `REGION`, and desired cadence and I’ll generate
the exact `gcloud scheduler jobs create http ...` command.

### Common commands

- Incremental (recommended — only reindex changed articles):

```bash
python main.py --mode incremental
```

- Reindex everything:

```bash
python main.py --mode reindex-all
```

- Reindex a single article:

```bash
python main.py --mode reindex-one --article-id "<ARTICLE_ID>"
```

- Dry run (no writes):

```bash
python main.py --mode reindex-all --dry-run
```

