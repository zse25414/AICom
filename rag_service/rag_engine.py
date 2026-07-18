import json
import os
import re
import shutil
import tempfile
import urllib.error
import urllib.request
from typing import List, Optional, Tuple

import config  # noqa: F401 — set cache paths before heavy ML imports

import math
import re
from collections import Counter
from llama_index.core import Document, Settings, SimpleDirectoryReader, StorageContext, VectorStoreIndex, load_index_from_storage
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import NodeWithScore, TextNode
from llama_index.embeddings.openai import OpenAIEmbedding

def tokenize(text: str) -> List[str]:
    """英數詞 + CJK unigram/bigram。
    CJK 連續段同時輸出單字與相鄰雙字：bigram 提供片語精度（「請假」不再命中只含
    「請」「假」散字的塊），unigram 保住單字查詢的召回。文件與查詢用同一分詞。"""
    text = text.lower()
    tokens: List[str] = []
    for match in re.finditer(r"[a-z0-9]+|[一-鿿]+", text):
        seg = match.group(0)
        if seg[0].isascii():
            tokens.append(seg)
            continue
        tokens.extend(seg)
        tokens.extend(seg[i:i + 2] for i in range(len(seg) - 1))
    return tokens


class _Bm25Stats:
    """BM25 語料統計（per index 快取，隨索引快取一起失效）。"""
    __slots__ = ("doc_counters", "doc_lens", "avg_doc_len", "n_docs")

    def __init__(self, docs: dict):
        self.doc_counters = {}
        self.doc_lens = {}
        for doc_id, node in docs.items():
            counter = Counter(tokenize(node.text or ""))
            self.doc_counters[doc_id] = counter
            self.doc_lens[doc_id] = sum(counter.values())
        self.n_docs = len(self.doc_counters)
        self.avg_doc_len = (
            sum(self.doc_lens.values()) / self.n_docs if self.n_docs else 1.0
        )


def retrieve_pure_python_bm25(docstore, query, top_k, stats=None) -> List[NodeWithScore]:
    docs = docstore.docs
    if not docs:
        return []

    query_tokens = tokenize(query)
    if not query_tokens:
        return []

    if stats is None:
        stats = _Bm25Stats(docs)

    N = stats.n_docs
    idf = {}
    for token in set(query_tokens):
        df_t = sum(1 for c in stats.doc_counters.values() if token in c)
        idf[token] = math.log((N - df_t + 0.5) / (df_t + 0.5) + 1.0)

    k1 = 1.5
    b = 0.75

    scores = []
    for doc_id, node in docs.items():
        counter = stats.doc_counters.get(doc_id)
        if counter is None:
            counter = Counter(tokenize(node.text or ""))
        doc_len = stats.doc_lens.get(doc_id) or sum(counter.values())

        score = 0.0
        for token in query_tokens:
            tf_t = counter.get(token, 0)
            if tf_t > 0:
                numerator = tf_t * (k1 + 1)
                denominator = tf_t + k1 * (1.0 - b + b * (doc_len / stats.avg_doc_len))
                score += idf[token] * (numerator / denominator)

        if score > 0:
            scores.append(NodeWithScore(node=node, score=score))

    scores.sort(key=lambda x: x.score, reverse=True)
    return scores[:top_k]

from config import (
    BM25_TOP_K,
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    DEEPSEEK_API_BASE,
    DEEPSEEK_API_KEY,
    EMBEDDING_PROVIDER,
    FUSION_TOP_K,
    LOCAL_EMBED_MODEL,
    MIN_RELEVANCE_SCORE,
    OPENAI_API_KEY,
    STORAGE_DIR,
    VECTOR_TOP_K,
    resolve_llm_api_base,
)

_embed_model_name: Optional[str] = None
_retrieval_mode: str = "hybrid"
_llm_api_key: Optional[str] = None
_llm_api_base: str = DEEPSEEK_API_BASE
_llm_model: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")


def normalize_code(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", str(value or "").strip().upper())


def normalize_kb_id(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9_-]", "", str(value or "general").strip().lower())
    return cleaned or "general"


def make_ref_doc_id(group_code: str, kb_id: str, filename: str) -> str:
    return f"{normalize_code(group_code)}::{normalize_kb_id(kb_id)}::{filename}"


def kb_index_dir(group_code: str, kb_id: str) -> str:
    return os.path.join(STORAGE_DIR, normalize_code(group_code), normalize_kb_id(kb_id), "index")


def list_group_kbs(group_code: str) -> List[str]:
    group_dir = os.path.join(STORAGE_DIR, normalize_code(group_code))
    if not os.path.isdir(group_dir):
        return []
    kb_ids = []
    for name in os.listdir(group_dir):
        if os.path.isdir(os.path.join(group_dir, name, "index")):
            kb_ids.append(name)
    return sorted(kb_ids)


def list_kb_documents(group_code: str, kb_id: str) -> List[dict]:
    """列出 KB 內實際可被檢索的來源文件（以 filename 去重，含 chunk 數）。"""
    storage_dir = kb_index_dir(group_code, kb_id)
    index = _load_index(storage_dir)
    if index is None:
        return []
    docs: dict = {}
    for node in index.docstore.docs.values():
        meta = node.metadata or {}
        filename = meta.get("filename") or "unknown"
        entry = docs.setdefault(
            filename,
            {
                "filename": filename,
                "document_id": meta.get("document_id"),
                "title": meta.get("title"),
                "chunks": 0,
            },
        )
        entry["chunks"] += 1
        if not entry.get("document_id") and meta.get("document_id"):
            entry["document_id"] = meta.get("document_id")
        if not entry.get("title") and meta.get("title"):
            entry["title"] = meta.get("title")
    return sorted(docs.values(), key=lambda d: d["filename"])


def delete_kb_index(group_code: str, kb_id: str) -> bool:
    """Remove entire knowledge-base storage directory (index + leftovers)."""
    code = normalize_code(group_code)
    kb = normalize_kb_id(kb_id)
    if not code or not kb:
        return False
    kb_dir = os.path.join(STORAGE_DIR, code, kb)
    if not os.path.isdir(kb_dir):
        return False
    shutil.rmtree(kb_dir, ignore_errors=True)
    _invalidate_index_cache(os.path.join(kb_dir, "index"))
    return not os.path.isdir(kb_dir)


# 模型與索引快取：configure_embedding 每個請求都會被呼叫，
# 重建 HuggingFaceEmbedding 等於每次查詢重載模型（實測 ~6s/查詢的主因）。
_local_embed_model_cache = None
_local_embed_model_failed = False
_openai_embed_cache: dict = {}


def _build_local_embed_model():
    global _embed_model_name, _local_embed_model_cache, _local_embed_model_failed
    if _local_embed_model_cache is not None:
        _embed_model_name = LOCAL_EMBED_MODEL
        return _local_embed_model_cache
    if _local_embed_model_failed:
        return None
    try:
        from llama_index.embeddings.huggingface import HuggingFaceEmbedding

        model = HuggingFaceEmbedding(
            model_name=LOCAL_EMBED_MODEL,
            trust_remote_code=True,
            device="cpu",
        )
        _embed_model_name = LOCAL_EMBED_MODEL
        _local_embed_model_cache = model
        return model
    except Exception as exc:
        print(f"[Lumina RAG] 無法載入本地 embedding 模型 ({LOCAL_EMBED_MODEL}): {exc}")
        _local_embed_model_failed = True
        return None


def configure_embedding(openai_api_key: Optional[str] = None) -> Tuple[str, str]:
    """Configure embedding model for indexing and retrieval."""
    global _embed_model_name, _retrieval_mode

    embed_key = (openai_api_key or "").strip() or OPENAI_API_KEY
    embed_model = None

    if EMBEDDING_PROVIDER in ("openai", "auto") and embed_key:
        embed_model = _openai_embed_cache.get(embed_key)
        if embed_model is None:
            embed_model = OpenAIEmbedding(model="text-embedding-3-small", api_key=embed_key)
            _openai_embed_cache.clear()  # 只留最近一把 key，避免累積
            _openai_embed_cache[embed_key] = embed_model
        _embed_model_name = "text-embedding-3-small"
    elif EMBEDDING_PROVIDER in ("local", "auto"):
        embed_model = _build_local_embed_model()

    Settings.embed_model = embed_model
    _retrieval_mode = "hybrid" if embed_model else "bm25"
    return (_embed_model_name or "bm25-only", _retrieval_mode)


def configure_llm(
    openai_api_key: Optional[str] = None,
    deepseek_api_key: Optional[str] = None,
    api_base: Optional[str] = None,
) -> None:
    """Configure LLM credentials for answer generation."""
    global _llm_api_key, _llm_api_base, _llm_model

    llm_key = (
        (deepseek_api_key or "").strip()
        or (openai_api_key or "").strip()
        or DEEPSEEK_API_KEY
        or OPENAI_API_KEY
    )
    if not llm_key:
        raise ValueError("未設定 LLM API Key，請在環境變數設定 DEEPSEEK_API_KEY 或 OPENAI_API_KEY")

    # Never honor untrusted client api_base (SSRF / key exfiltration defense).
    has_deepseek_key = bool((deepseek_api_key or "").strip())
    has_openai_key = bool((openai_api_key or "").strip())
    # Prefer DeepSeek when its key is present, or when only server/env keys apply.
    use_deepseek = has_deepseek_key or not has_openai_key
    if use_deepseek:
        _llm_api_base = resolve_llm_api_base(api_base, DEEPSEEK_API_BASE)
        _llm_model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    else:
        _llm_api_base = resolve_llm_api_base(api_base, "https://api.openai.com/v1")
        _llm_model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    _llm_api_key = llm_key


def configure_runtime(
    openai_api_key: Optional[str] = None,
    deepseek_api_key: Optional[str] = None,
    api_base: Optional[str] = None,
) -> Tuple[str, str]:
    """Configure embedding + LLM. Returns (embedding_mode, retrieval_mode)."""
    info = configure_embedding(openai_api_key)
    configure_llm(openai_api_key, deepseek_api_key, api_base)
    return info


def get_runtime_info() -> dict:
    return {
        "embedding": _embed_model_name or "bm25-only",
        "retrieval": _retrieval_mode,
    }


def _split_documents(documents: List[Document]) -> List[TextNode]:
    splitter = SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)
    return splitter.get_nodes_from_documents(documents)


def _index_has_nodes(index: Optional[VectorStoreIndex]) -> bool:
    if index is None:
        return False
    try:
        if index.docstore and index.docstore.docs:
            return len(index.docstore.docs) > 0
    except Exception:
        pass
    return False


# ---- 索引 / BM25 快取 ----
# 每個查詢從磁碟重載索引 + 重新分詞整個語料庫是延遲另兩個大戶。
# 以 docstore.json mtime 為簽章：本程序內寫入後主動失效；外部改動（還原備份）靠 mtime 偵測。
_index_cache: dict = {}
_bm25_stats_cache: dict = {}


def _index_signature(storage_dir: str) -> Optional[float]:
    try:
        return os.path.getmtime(os.path.join(storage_dir, "docstore.json"))
    except OSError:
        return None


def _invalidate_index_cache(storage_dir: str) -> None:
    _index_cache.pop(storage_dir, None)
    _bm25_stats_cache.pop(storage_dir, None)


def _get_bm25_stats(storage_dir: str, index: VectorStoreIndex) -> _Bm25Stats:
    cached = _bm25_stats_cache.get(storage_dir)
    sig = _index_signature(storage_dir)
    if cached is not None and cached[0] == sig:
        return cached[1]
    stats = _Bm25Stats(index.docstore.docs)
    _bm25_stats_cache[storage_dir] = (sig, stats)
    return stats


def _load_index(storage_dir: str) -> Optional[VectorStoreIndex]:
    if not os.path.exists(storage_dir):
        return None
    sig = _index_signature(storage_dir)
    cached = _index_cache.get(storage_dir)
    if cached is not None and sig is not None and cached[0] == sig and cached[1] == _embed_model_name:
        return cached[2]
    storage_context = StorageContext.from_defaults(persist_dir=storage_dir)
    index = load_index_from_storage(
        storage_context,
        embed_model=Settings.embed_model,
    )
    if not _index_has_nodes(index):
        _invalidate_index_cache(storage_dir)
        return None
    _index_cache[storage_dir] = (sig, _embed_model_name, index)
    _bm25_stats_cache.pop(storage_dir, None)
    return index


def _refresh_index_cache(storage_dir: str, index: VectorStoreIndex) -> None:
    """寫入（persist）後以新簽章回填快取，下個查詢不必重載。"""
    sig = _index_signature(storage_dir)
    if sig is None:
        _invalidate_index_cache(storage_dir)
        return
    _index_cache[storage_dir] = (sig, _embed_model_name, index)
    _bm25_stats_cache.pop(storage_dir, None)


def _upsert_documents(
    group_code: str,
    kb_id: str,
    filename: str,
    documents: List[Document],
    document_id: Optional[str] = None,
    title: Optional[str] = None,
) -> int:
    ref_doc_id = make_ref_doc_id(group_code, kb_id, filename)
    doc_id = (document_id or "").strip() or None
    title_val = (title or "").strip() or None
    for doc in documents:
        doc.id_ = ref_doc_id
        # Preserve any existing title from Document, then apply canonical fields
        prev_title = (doc.metadata or {}).get("title") if isinstance(doc.metadata, dict) else None
        doc.metadata = {
            "group_code": normalize_code(group_code),
            "kb_id": normalize_kb_id(kb_id),
            "filename": filename,
            "ref_doc_id": ref_doc_id,
            "document_id": doc_id,
            "title": title_val or prev_title,
        }

    nodes = _split_documents(documents)
    if not nodes:
        raise ValueError("文件切塊後為空，請確認內容是否有效")

    storage_dir = kb_index_dir(group_code, kb_id)
    os.makedirs(os.path.dirname(storage_dir), exist_ok=True)

    index = _load_index(storage_dir)
    if index is None:
        index = VectorStoreIndex(nodes)
        index.storage_context.persist(persist_dir=storage_dir)
        _refresh_index_cache(storage_dir, index)
        return len(nodes)

    try:
        index.delete_ref_doc(ref_doc_id, delete_from_docstore=True)
    except Exception:
        pass

    index.insert_nodes(nodes)
    index.storage_context.persist(persist_dir=storage_dir)
    _refresh_index_cache(storage_dir, index)
    return len(nodes)


def index_uploaded_file(
    group_code: str,
    kb_id: str,
    filename: str,
    file_bytes: bytes,
    document_id: Optional[str] = None,
    title: Optional[str] = None,
) -> int:
    suffix = os.path.splitext(filename)[1] or ".txt"
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(file_bytes)
            temp_path = temp_file.name

        reader = SimpleDirectoryReader(input_files=[temp_path])
        documents = reader.load_data()
        if not documents:
            raise ValueError("無法解析該檔案內容")

        return _upsert_documents(
            group_code,
            kb_id,
            filename,
            documents,
            document_id=document_id,
            title=title,
        )
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


def index_text_document(
    group_code: str,
    kb_id: str,
    title: str,
    content: str,
    filename: Optional[str] = None,
    document_id: Optional[str] = None,
) -> int:
    virtual_filename = filename or f"text::{title}.md"
    body = f"# {title}\n\n{content.strip()}"
    document = Document(text=body, metadata={"title": title})
    return _upsert_documents(
        group_code,
        kb_id,
        virtual_filename,
        [document],
        document_id=document_id,
        title=title,
    )


def delete_document_index(group_code: str, kb_id: str, filename: str) -> bool:
    storage_dir = kb_index_dir(group_code, kb_id)
    if not os.path.exists(storage_dir):
        return False

    ref_doc_id = make_ref_doc_id(group_code, kb_id, filename)
    index = _load_index(storage_dir)
    if index is None:
        return False

    try:
        index.delete_ref_doc(ref_doc_id, delete_from_docstore=True)
        index.storage_context.persist(persist_dir=storage_dir)
        _refresh_index_cache(storage_dir, index)
        return True
    except Exception:
        storage_context = StorageContext.from_defaults(persist_dir=storage_dir)
        nodes_to_keep = []
        for node in storage_context.docstore.docs.values():
            if node.metadata.get("filename") != filename:
                nodes_to_keep.append(node)

        shutil.rmtree(storage_dir)
        os.makedirs(storage_dir, exist_ok=True)
        _invalidate_index_cache(storage_dir)
        if nodes_to_keep:
            rebuilt = VectorStoreIndex(nodes_to_keep)
            rebuilt.storage_context.persist(persist_dir=storage_dir)
            _refresh_index_cache(storage_dir, rebuilt)
        return True


def _reciprocal_rank_fusion(result_lists: List[List[NodeWithScore]], k: int = 60) -> List[NodeWithScore]:
    scores = {}
    nodes = {}
    for results in result_lists:
        for rank, item in enumerate(results):
            node_id = item.node.node_id
            nodes[node_id] = item
            scores[node_id] = scores.get(node_id, 0.0) + 1.0 / (k + rank + 1)

    fused = []
    for node_id, score in sorted(scores.items(), key=lambda x: x[1], reverse=True):
        base = nodes[node_id]
        fused.append(NodeWithScore(node=base.node, score=score))
    return fused


def _retrieve_from_index(
    index: VectorStoreIndex, query: str, storage_dir: Optional[str] = None
) -> List[NodeWithScore]:
    result_lists: List[List[NodeWithScore]] = []

    if Settings.embed_model is not None:
        try:
            result_lists.append(index.as_retriever(similarity_top_k=VECTOR_TOP_K).retrieve(query))
        except Exception as exc:
            print(f"[Lumina RAG] 向量檢索失敗: {exc}")

    try:
        stats = _get_bm25_stats(storage_dir, index) if storage_dir else None
        results = retrieve_pure_python_bm25(index.docstore, query, BM25_TOP_K, stats=stats)
        result_lists.append(results)
    except Exception as exc:
        print(f"[Lumina RAG] BM25 檢索失敗: {exc}")

    if not result_lists:
        return index.as_retriever(similarity_top_k=VECTOR_TOP_K).retrieve(query)
    if len(result_lists) == 1:
        return result_lists[0]
    return _reciprocal_rank_fusion(result_lists)[:FUSION_TOP_K]


def _dedupe_nodes(nodes: List[NodeWithScore]) -> List[NodeWithScore]:
    seen = set()
    deduped = []
    for node in nodes:
        text_key = (node.node.text or "")[:160]
        meta_key = (
            node.node.metadata.get("filename"),
            node.node.metadata.get("kb_id"),
            text_key,
        )
        if meta_key in seen:
            continue
        seen.add(meta_key)
        deduped.append(node)
    return deduped


def retrieve_context(
    group_code: str,
    kb_ids: List[str],
    query: str,
    document_ids: Optional[List[str]] = None,
    document_filenames: Optional[List[str]] = None,
) -> List[NodeWithScore]:
    all_nodes: List[NodeWithScore] = []
    doc_filter = None
    if document_ids:
        doc_filter = {str(x).strip() for x in document_ids if str(x).strip()}
        if not doc_filter:
            doc_filter = None
    name_filter = None
    if document_filenames:
        name_filter = {str(x).strip() for x in document_filenames if str(x).strip()}
        if not name_filter:
            name_filter = None

    for kb_id in kb_ids:
        storage_dir = kb_index_dir(group_code, kb_id)
        if not os.path.exists(storage_dir):
            continue
        try:
            index = _load_index(storage_dir)
            if index is None:
                continue
            all_nodes.extend(_retrieve_from_index(index, query, storage_dir=storage_dir))
        except Exception as exc:
            print(f"[Lumina RAG] 檢索 {kb_id} 失敗: {exc}")

    if not all_nodes:
        return []

    # Task-bound documents: match document_id (preferred) or filename (legacy indexes)
    if doc_filter or name_filter:
        scoped = []
        for n in all_nodes:
            meta = getattr(n.node, "metadata", None) or {}
            did = meta.get("document_id")
            fname = meta.get("filename")
            ok = False
            if doc_filter and did is not None and str(did).strip() in doc_filter:
                ok = True
            if name_filter and fname is not None and str(fname).strip() in name_filter:
                ok = True
            if ok:
                scoped.append(n)
        all_nodes = scoped
        if not all_nodes:
            return []

    all_nodes = _dedupe_nodes(all_nodes)
    all_nodes.sort(key=lambda n: n.score if n.score is not None else 0.0, reverse=True)

    filtered = [
        n for n in all_nodes
        if n.score is None or n.score >= MIN_RELEVANCE_SCORE
    ]
    # BM25 fusion scores are rank-based and often << MIN_RELEVANCE_SCORE
    if not filtered and all_nodes:
        return all_nodes[:FUSION_TOP_K]
    return filtered[:FUSION_TOP_K]


def build_sources(nodes: List[NodeWithScore]) -> Tuple[str, List[dict]]:
    context_chunks = []
    sources = []

    for idx, node in enumerate(nodes):
        meta = node.node.metadata
        ref_id = idx + 1
        filename = meta.get("filename", "未知檔案")
        kb_id = meta.get("kb_id", "general")
        context_chunks.append(
            f"[{ref_id}] 知識庫：{kb_id}｜來源：{filename}\n{node.node.text}"
        )
        text = node.node.text or ""
        sources.append({
            "ref_id": ref_id,
            "filename": filename,
            "kb_id": kb_id,
            "doc_id": node.node.id_,
            "document_id": meta.get("document_id"),
            "title": meta.get("title"),
            "score": float(node.score if node.score is not None else 1.0),
            "snippet": text[:200] if text else None,
        })

    return "\n\n".join(context_chunks), sources


def generate_answer(query: str, context_text: str) -> str:
    system_prompt = (
        "你現在是 Lumina AI 團隊專屬智慧教練。\n"
        "請根據下方提供的「參考文獻與團隊資料」回答用戶的問題。回答時必須遵循以下規則：\n"
        "1. 回答內容必須完全基於參考文獻，不要憑空編造。\n"
        "2. 當你陳述參考文獻中的事實時，請在句尾標記對應的來源編號，格式為 [1] 或 [2] 等。\n"
        "3. 若參考文獻中的資訊與問題無關，請直接回答「抱歉，根據目前的知識庫資料，我無法回答此問題。」\n"
        "4. 使用繁體中文，條理清晰，必要時使用條列式。\n\n"
        f"=== 參考文獻與團隊資料 ===\n{context_text}\n======================="
    )

    if not _llm_api_key:
        raise ValueError("未設定 LLM API Key，請在環境變數設定 DEEPSEEK_API_KEY 或 OPENAI_API_KEY")

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": query},
    ]
    payload = {
        "model": _llm_model,
        "messages": messages,
        "temperature": 0.2,
        "stream": False,
    }
    url = f"{_llm_api_base.rstrip('/')}/chat/completions"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {_llm_api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LLM API 錯誤 ({exc.code}): {body[:300]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"LLM API 連線失敗: {exc.reason}") from exc

    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"LLM API 回應格式異常: {data}") from exc