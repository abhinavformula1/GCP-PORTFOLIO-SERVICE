#!/usr/bin/env python3
"""
Offline indexer for Atlas RAG.

Reads `systemDesignArticles` (published/stub), chunks into text, embeds via
Gemini embeddings endpoint, and upserts into Firestore `rag_chunks`.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv
from tqdm import tqdm

from google.cloud import firestore
from google.cloud.firestore_v1.vector import Vector


SYSTEM_DESIGN_COLLECTION = "systemDesignArticles"
RAG_COLLECTION = "rag_chunks"
INDEX_STATE_COLLECTION = "rag_index_state"

DEFAULT_EMBED_MODEL = "gemini-embedding-2"
DEFAULT_DIMS = 768

MAX_TEXT_CHARS = 8000


def _env(name: str, default: str = "") -> str:
    v = os.environ.get(name)
    return v if v is not None else default


def is_published_or_stub(doc: Dict[str, Any]) -> bool:
    status = str(doc.get("status", "")).strip().lower()
    stub = bool(doc.get("stub", False))
    return status == "published" or stub


def normalize_title(doc_id: str, doc: Dict[str, Any]) -> str:
    en = doc.get("en") if isinstance(doc.get("en"), dict) else {}
    title = ""
    if isinstance(en, dict):
        title = str(en.get("title") or "").strip()
    if not title:
        title = str(doc.get("title") or "").strip()
    return title or doc_id


def blocks_to_items(blocks: Any) -> List[Dict[str, Any]]:
    if not isinstance(blocks, list):
        return []
    out = []
    for b in blocks[:200]:
        if not isinstance(b, dict):
            continue
        t = str(b.get("type") or "paragraph")
        out.append({**b, "type": t})
    return out


def matrix_to_text(block: Dict[str, Any]) -> str:
    rows = block.get("rows")
    if not isinstance(rows, list):
        return ""
    lines = []
    for row in rows:
        cells = None
        if isinstance(row, dict) and isinstance(row.get("cells"), list):
            cells = row.get("cells")
        elif isinstance(row, list):
            cells = row
        if not isinstance(cells, list):
            continue
        lines.append(" | ".join([str(c) for c in cells]))
    return "\n".join(lines).strip()


def block_to_text(block: Dict[str, Any]) -> str:
    t = str(block.get("type") or "paragraph")
    if t == "matrix":
        return matrix_to_text(block)
    # Common fields we’ve seen in CMS blocks.
    for key in ("text", "content", "body", "code", "value", "title"):
        v = block.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    # Fallback: stringify a safe subset.
    if t == "heading" and isinstance(block.get("heading"), str):
        return str(block.get("heading")).strip()
    return ""


def clamp_int(v: Any, min_v: int, max_v: int) -> int:
    try:
        n = int(v)
    except Exception:
        return min_v
    return max(min_v, min(max_v, n))

def normalize_embed_model(model: str) -> str:
    raw = (model or "").strip()
    if raw.startswith("models/"):
        raw = raw[len("models/") :]
    aliases = {
        # Older docs/samples used this name; many keys no longer expose it.
        "text-embedding-004": "gemini-embedding-2",
        # Keep common naming variants safe.
        "embedding-001": "gemini-embedding-001",
    }
    return aliases.get(raw, raw) or DEFAULT_EMBED_MODEL


def pick_cut_index(text: str, limit: int, splitter_type: str) -> int:
    s = text or ""
    L = max(1, min(int(limit), len(s)))
    if len(s) <= L:
        return len(s)
    before = s[:L]

    hard = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", "]
    for sep in hard:
        idx = before.rfind(sep)
        if idx > 40:
            return idx + len(sep)

    if splitter_type == "markdown":
        idx = before.rfind("\n#")
        if idx > 40:
            return idx

    ws = before.rfind(" ")
    if ws > 40:
        return ws
    return L


@dataclass
class Chunk:
    article_id: str
    article_title: str
    chunk_index: int
    block_type: str
    text: str


def chunk_article(
    article_id: str,
    title: str,
    blocks: List[Dict[str, Any]],
    *,
    chunk_size: int = 4000,
    chunk_overlap: int = 200,
    splitter_type: str = "recursive",
) -> List[Chunk]:
    chunk_size = clamp_int(chunk_size, 500, 8000)
    chunk_overlap = clamp_int(chunk_overlap, 0, 1000)
    chunk_overlap = max(0, min(chunk_overlap, chunk_size - 1))
    splitter_type = (splitter_type or "recursive").strip().lower()

    raw: List[Tuple[str, str]] = []
    buf = ""
    buf_type = "paragraph"

    def emit(text: str, typ: str) -> None:
        t = (text or "").strip()
        if len(t) < 40:
            return
        raw.append((t, typ or "paragraph"))

    def flush() -> None:
        nonlocal buf, buf_type
        emit(buf, buf_type)
        buf = ""
        buf_type = "paragraph"

    def cut_if_needed() -> None:
        nonlocal buf, buf_type
        while len(buf) > chunk_size:
            cut = pick_cut_index(buf, chunk_size, splitter_type)
            head = buf[:cut]
            emit(head, buf_type)
            keep_from = max(0, cut - chunk_overlap)
            buf = buf[keep_from:].lstrip()
            if buf_type == "heading":
                buf_type = "paragraph"

    for block in blocks:
        typ = str(block.get("type") or "paragraph")
        text = block_to_text(block)
        if not text:
            continue

        is_structured = typ in ("matrix", "code")
        if is_structured:
            flush()
            emit(text, typ)
            continue

        if typ == "heading":
            flush()
            buf = ("# " + text) if splitter_type == "markdown" else text
            buf_type = "heading"
            cut_if_needed()
            continue

        buf = (buf + "\n\n" + text) if buf else text
        cut_if_needed()

    flush()

    chunks = []
    for i, (t, bt) in enumerate(raw):
        chunks.append(
            Chunk(
                article_id=article_id,
                article_title=title,
                chunk_index=i,
                block_type=bt,
                text=t[:MAX_TEXT_CHARS],
            )
        )
    return chunks


def embed_text(
    api_key: str,
    text: str,
    *,
    model: str = DEFAULT_EMBED_MODEL,
    dims: int = DEFAULT_DIMS,
    timeout_s: int = 20,
) -> List[float]:
    safe = (text or "").strip()[:MAX_TEXT_CHARS]
    if not safe:
        raise ValueError("embed_text: text must not be empty")

    model = normalize_embed_model(model or DEFAULT_EMBED_MODEL)
    dims = clamp_int(dims, 1, 2048)

    # Generative Language API (Gemini) embeddings endpoint.
    def _call(m: str) -> requests.Response:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:embedContent"
        payload = {
            "model": f"models/{m}",
            "content": {"parts": [{"text": safe}]},
            "outputDimensionality": dims,
        }
        return requests.post(url, params={"key": api_key}, json=payload, timeout=timeout_s)

    res = _call(model)
    if res.status_code == 404 and model != "gemini-embedding-001":
        # Fall back for API keys that don't expose the requested model.
        res = _call("gemini-embedding-001")

    if res.status_code >= 400:
        body = res.text[:500]
        raise RuntimeError(f"Gemini embed API error {res.status_code}: {body}")

    data = res.json()
    values = (data.get("embedding") or {}).get("values")
    if not isinstance(values, list) or not values:
        raise RuntimeError("Gemini embed API returned empty/malformed vector")
    return [float(x) for x in values]


def firestore_client(project_id: str, database_id: str) -> firestore.Client:
    project_id = (project_id or "").strip()
    database_id = (database_id or "").strip() or "(default)"
    if database_id != "(default)":
        return firestore.Client(project=project_id or None, database=database_id)
    return firestore.Client(project=project_id or None)


def delete_chunks_for_article(db: firestore.Client, article_id: str) -> None:
    if not article_id:
        return
    q = db.collection(RAG_COLLECTION).where("articleId", "==", article_id)
    docs = list(q.stream())
    if not docs:
        return
    # Batch delete (<=500 ops per batch)
    for i in range(0, len(docs), 450):
        batch = db.batch()
        for d in docs[i : i + 450]:
            batch.delete(d.reference)
        batch.commit()


def upsert_chunks(
    db: firestore.Client,
    chunks_with_embeddings: List[Tuple[Chunk, List[float]]],
    *,
    dry_run: bool = False,
) -> None:
    if not chunks_with_embeddings:
        return
    if dry_run:
        return

    col = db.collection(RAG_COLLECTION)
    now = firestore.SERVER_TIMESTAMP

    for i in range(0, len(chunks_with_embeddings), 450):
        batch = db.batch()
        for ch, emb in chunks_with_embeddings[i : i + 450]:
            doc_id = f"{ch.article_id}_chunk_{ch.chunk_index}"
            ref = col.document(doc_id)
            batch.set(
                ref,
                {
                    "articleId": ch.article_id,
                    "articleTitle": ch.article_title,
                    "chunkIndex": int(ch.chunk_index),
                    "blockType": ch.block_type,
                    "text": ch.text[:MAX_TEXT_CHARS],
                    "embedding": Vector(emb),
                    "indexedAt": now,
                },
            )
        batch.commit()


def fetch_articles(db: firestore.Client, *, include_unpublished: bool = False) -> List[Tuple[str, Dict[str, Any]]]:
    snap = db.collection(SYSTEM_DESIGN_COLLECTION).stream()
    docs = []
    for doc in snap:
        data = doc.to_dict() or {}
        if include_unpublished or is_published_or_stub(data):
            docs.append((doc.id, data))
    # Sort by order then title (best-effort)
    def key(item: Tuple[str, Dict[str, Any]]) -> Tuple[int, str]:
        _id, d = item
        order = int(d.get("order") or 999)
        title = normalize_title(_id, d).lower()
        return (order, title)

    docs.sort(key=key)
    return docs


def article_version(doc: Dict[str, Any]) -> int:
    try:
        return int(doc.get("version") or 0)
    except Exception:
        return 0


def index_fingerprint(
    *,
    embed_model: str,
    embed_dims: int,
    chunk_size: int,
    chunk_overlap: int,
    splitter_type: str,
) -> Dict[str, Any]:
    return {
        "embedModel": str(embed_model or "").strip(),
        "embedDims": int(embed_dims),
        "chunkSize": int(chunk_size),
        "chunkOverlap": int(chunk_overlap),
        "splitterType": str(splitter_type or "").strip().lower(),
    }


def get_index_states(db: firestore.Client, article_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    if not article_ids:
        return {}
    refs = [db.collection(INDEX_STATE_COLLECTION).document(aid) for aid in article_ids]
    out: Dict[str, Dict[str, Any]] = {}
    for snap in db.get_all(refs):
        if not snap.exists:
            continue
        try:
            out[snap.id] = snap.to_dict() or {}
        except Exception:
            continue
    return out


def should_reindex(
    *,
    state: Optional[Dict[str, Any]],
    doc: Dict[str, Any],
    fp: Dict[str, Any],
) -> bool:
    if not state:
        return True
    if int(state.get("articleVersion") or 0) != article_version(doc):
        return True
    for k, v in fp.items():
        if state.get(k) != v:
            return True
    return False


def write_index_state(
    db: firestore.Client,
    *,
    article_id: str,
    doc: Dict[str, Any],
    fp: Dict[str, Any],
    chunk_count: int,
    dry_run: bool,
) -> None:
    if dry_run:
        return
    ref = db.collection(INDEX_STATE_COLLECTION).document(article_id)
    payload = {
        "articleId": article_id,
        "articleVersion": article_version(doc),
        "chunkCount": int(chunk_count),
        "indexedAt": firestore.SERVER_TIMESTAMP,
        "status": str(doc.get("status") or ""),
        **fp,
    }
    ref.set(payload, merge=True)


def delete_index_state(db: firestore.Client, article_id: str, *, dry_run: bool) -> None:
    if dry_run:
        return
    db.collection(INDEX_STATE_COLLECTION).document(article_id).delete()


def run_index(
    *,
    mode: str,
    article_id: str,
    project_id: str,
    database_id: str,
    gemini_api_key: str,
    embed_model: str,
    embed_dims: int,
    chunk_size: int,
    chunk_overlap: int,
    splitter_type: str,
    dry_run: bool,
    limit: int,
) -> int:
    db = firestore_client(project_id, database_id)

    if mode == "reindex-one":
        if not article_id:
            raise SystemExit("--article-id is required for --mode reindex-one")
        docs = [(article_id, (db.collection(SYSTEM_DESIGN_COLLECTION).document(article_id).get()).to_dict() or {})]
    else:
        docs = fetch_articles(db, include_unpublished=(mode == "incremental"))

    if limit > 0:
        docs = docs[:limit]

    fp = index_fingerprint(
        embed_model=embed_model,
        embed_dims=embed_dims,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        splitter_type=splitter_type,
    )

    # Prefetch per-article index state so incremental runs don’t do N serial reads.
    states = {}
    if mode == "incremental":
        states = get_index_states(db, [doc_id for doc_id, _ in docs])

    processed = 0
    for doc_id, data in tqdm(docs, desc="Indexing articles"):
        if not data:
            continue
        if not is_published_or_stub(data):
            # If it was indexed before but is no longer eligible, clean up.
            if mode == "incremental" and doc_id in states:
                if not dry_run:
                    delete_chunks_for_article(db, doc_id)
                    delete_index_state(db, doc_id, dry_run=dry_run)
            continue

        if mode == "incremental":
            state = states.get(doc_id)
            if not should_reindex(state=state, doc=data, fp=fp):
                continue

        title = normalize_title(doc_id, data)
        blocks = blocks_to_items(data.get("blocks"))
        chunks = chunk_article(
            doc_id,
            title,
            blocks,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            splitter_type=splitter_type,
        )
        if not chunks:
            continue

        if not dry_run:
            delete_chunks_for_article(db, doc_id)

        chunks_with_embeddings: List[Tuple[Chunk, List[float]]] = []
        for ch in chunks:
            emb = embed_text(gemini_api_key, ch.text, model=embed_model, dims=embed_dims)
            chunks_with_embeddings.append((ch, emb))

        upsert_chunks(db, chunks_with_embeddings, dry_run=dry_run)
        write_index_state(
            db,
            article_id=doc_id,
            doc=data,
            fp=fp,
            chunk_count=len(chunks_with_embeddings),
            dry_run=dry_run,
        )
        processed += 1

    return processed


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="indexer_py", add_help=True)
    parser.add_argument("--mode", choices=["incremental", "reindex-all", "reindex-one"], default="incremental")
    parser.add_argument("--article-id", default="", help="Article id (doc id) for reindex-one.")
    parser.add_argument("--dry-run", action="store_true", help="Compute chunks/embeddings but do not write to Firestore.")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of articles (incremental/reindex-all).")

    parser.add_argument("--chunk-size", type=int, default=int(_env("ATLAS_CHUNK_SIZE", "4000")))
    parser.add_argument("--chunk-overlap", type=int, default=int(_env("ATLAS_CHUNK_OVERLAP", "200")))
    parser.add_argument("--splitter-type", choices=["recursive", "markdown"], default=_env("ATLAS_SPLITTER_TYPE", "recursive"))

    parser.add_argument("--embed-model", default=_env("ATLAS_EMBED_MODEL", DEFAULT_EMBED_MODEL))
    parser.add_argument("--embed-dims", type=int, default=int(_env("ATLAS_EMBED_DIMS", str(DEFAULT_DIMS))))

    args = parser.parse_args(argv)

    dotenv_path = _env("DOTENV_PATH", "")
    if dotenv_path:
        load_dotenv(dotenv_path, override=False)

    project_id = _env("FIRESTORE_PROJECT_ID") or _env("GOOGLE_CLOUD_PROJECT")
    database_id = _env("FIRESTORE_DATABASE_ID", "(default)")
    gemini_api_key = _env("GEMINI_API_KEY")

    if not gemini_api_key.strip():
        print("Missing GEMINI_API_KEY", file=sys.stderr)
        return 2

    processed = run_index(
        mode=args.mode,
        article_id=args.article_id.strip(),
        project_id=project_id.strip(),
        database_id=database_id.strip(),
        gemini_api_key=gemini_api_key.strip(),
        embed_model=str(args.embed_model).strip(),
        embed_dims=int(args.embed_dims),
        chunk_size=int(args.chunk_size),
        chunk_overlap=int(args.chunk_overlap),
        splitter_type=str(args.splitter_type).strip().lower(),
        dry_run=bool(args.dry_run),
        limit=int(args.limit),
    )

    print(f"Done. Indexed {processed} article(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

