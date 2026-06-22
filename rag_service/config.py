import os

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