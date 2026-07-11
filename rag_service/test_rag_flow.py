import json
import os
import urllib.error
import urllib.request

BASE = os.getenv("RAG_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
RAG_API_KEY = os.getenv("RAG_API_KEY", "").strip()


def _headers(include_json=False):
    h = {}
    if include_json:
        h["Content-Type"] = "application/json"
    if RAG_API_KEY:
        h["X-RAG-API-Key"] = RAG_API_KEY
    return h


def post(path, payload):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=_headers(include_json=True),
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"POST {path} → HTTP {e.code}: {body}") from e


def get(path):
    req = urllib.request.Request(BASE + path, headers=_headers(), method="GET")
    try:
        with urllib.request.urlopen(req) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GET {path} → HTTP {e.code}: {body}") from e


def main():
    print("=== 1. Health ===")
    print(json.dumps(get("/health"), ensure_ascii=False, indent=2))

    print("\n=== 2. Upload text ===")
    upload = post(
        "/api/rag/document/upload-text",
        {
            "group_code": "DEMO03",
            "kb_id": "general",
            "title": "Lumina 新人手冊",
            "content": "第一天請完成帳號設定、加入 Slack 頻道，並參加下午三點的團隊同步會議。",
        },
    )
    print(json.dumps(upload, ensure_ascii=False, indent=2))

    print("\n=== 3. KB list ===")
    print(json.dumps(get("/api/rag/kb/list?group_code=DEMO03"), ensure_ascii=False, indent=2))

    from rag_engine import build_sources, configure_embedding, retrieve_context

    configure_embedding()
    nodes = retrieve_context("DEMO03", ["general"], "第一天要做什麼")
    ctx, sources = build_sources(nodes)
    print("\n=== 4. Retrieval ===")
    print("hits:", len(nodes))
    print("sources:", json.dumps(sources, ensure_ascii=False, indent=2))
    print("preview:", ctx[:200])

    print("\n=== 5. Query (needs LLM key) ===")
    try:
        query = post(
            "/api/rag/query",
            {
                "query": "第一天要做什麼？",
                "group_code": "DEMO03",
                "kb_ids": ["general"],
            },
        )
        print(json.dumps(query, ensure_ascii=False, indent=2))
    except Exception as exc:
        print("query skipped:", exc)


if __name__ == "__main__":
    main()