import os
from typing import Optional

_BASE_DIR = os.path.dirname(__file__)
_CACHE_DIR = os.path.join(_BASE_DIR, ".cache")
os.makedirs(_CACHE_DIR, exist_ok=True)
os.environ.setdefault("HF_HOME", os.path.join(_CACHE_DIR, "hf"))
os.environ.setdefault("SENTENCE_TRANSFORMERS_HOME", os.path.join(_CACHE_DIR, "st"))
os.environ.setdefault("LLAMA_INDEX_CACHE_DIR", os.path.join(_CACHE_DIR, "llama"))

STORAGE_DIR = os.path.join(_BASE_DIR, "storage")
os.makedirs(STORAGE_DIR, exist_ok=True)

PORT = int(os.getenv("RAG_PORT", "8000"))
HOST = os.getenv("RAG_HOST", "127.0.0.1")

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "RAG_ALLOWED_ORIGINS",
        "http://localhost:3456,http://127.0.0.1:3456,http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_API_BASE = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com/v1").strip()
# Client-supplied api_base must be on this allowlist; untrusted values are ignored.
ALLOWED_LLM_API_BASES = {
    b.strip().rstrip("/")
    for b in os.getenv(
        "ALLOWED_LLM_API_BASES",
        "https://api.deepseek.com,https://api.deepseek.com/v1,https://api.openai.com/v1",
    ).split(",")
    if b.strip()
}
# Always include configured defaults
ALLOWED_LLM_API_BASES.add(DEEPSEEK_API_BASE.rstrip("/"))
ALLOWED_LLM_API_BASES.add("https://api.deepseek.com")
ALLOWED_LLM_API_BASES.add("https://api.openai.com/v1")


def is_allowed_llm_api_base(api_base: str) -> bool:
    n = (api_base or "").strip().rstrip("/")
    if not n:
        return False
    if n in ALLOWED_LLM_API_BASES:
        return True
    if f"{n}/v1" in ALLOWED_LLM_API_BASES:
        return True
    if n.endswith("/v1") and n[:-3].rstrip("/") in ALLOWED_LLM_API_BASES:
        return True
    return False


def resolve_llm_api_base(api_base: Optional[str], default: Optional[str] = None) -> str:
    """Return allowlisted api_base or safe default. Never trust arbitrary client URLs."""
    fallback = (default or DEEPSEEK_API_BASE).strip().rstrip("/")
    n = (api_base or "").strip().rstrip("/")
    if not n:
        return fallback
    if is_allowed_llm_api_base(n):
        if n in ("https://api.deepseek.com", "http://api.deepseek.com"):
            return DEEPSEEK_API_BASE.rstrip("/")
        return n
    return fallback

EMBEDDING_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "auto").strip().lower()
LOCAL_EMBED_MODEL = os.getenv(
    "LOCAL_EMBED_MODEL",
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
).strip()

CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "420"))
CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "80"))
VECTOR_TOP_K = int(os.getenv("RAG_VECTOR_TOP_K", "6"))
BM25_TOP_K = int(os.getenv("RAG_BM25_TOP_K", "6"))
FUSION_TOP_K = int(os.getenv("RAG_FUSION_TOP_K", "5"))
MIN_RELEVANCE_SCORE = float(os.getenv("RAG_MIN_RELEVANCE_SCORE", "0.01"))

SERVICE_VERSION = "2.0"
RAG_API_KEY = os.getenv("RAG_API_KEY", "").strip()
IS_PRODUCTION = os.getenv("NODE_ENV") == "production" or os.getenv("LUMINA_ENFORCE_SECRETS") == "1"

if IS_PRODUCTION and not RAG_API_KEY:
    raise SystemExit("[RAG] 生產環境必須設定 RAG_API_KEY")