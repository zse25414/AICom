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
from llama_index.core import Document, Settings, SimpleDirectoryReader, StorageContext, VectorStoreIndex, load_index_from_storage
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import NodeWithScore, TextNode
from llama_index.embeddings.openai import OpenAIEmbedding

def tokenize(text: str) -> List[str]:
    text = text.lower()
    return re.findall(r'[a-zA-Z0-9]+|[\u4e00-\u9fff]', text)

def retrieve_pure_python_bm25(docstore, query: str, top_k: int) -> List[NodeWithScore]:
    docs = docstore.docs
    if not docs:
        return []
        
    query_tokens = tokenize(query)
    if not query_tokens:
        return []
        
    doc_tokens = {}
    doc_lens = []
    for doc_id, node in docs.items():
        tokens = tokenize(node.text or "")
        doc_tokens[doc_id] = tokens
        doc_lens.append(len(tokens))
        
    avg_doc_len = sum(doc_lens) / len(doc_lens) if doc_lens else 1.0
    
    df = {}
    for token in query_tokens:
        df[token] = sum(1 for doc_id in docs if token in doc_tokens[doc_id])
        
    N = len(docs)
    idf = {}
    for token in query_tokens:
        df_t = df[token]
        idf[token] = math.log((N - df_t + 0.5) / (df_t + 0.5) + 1.0)
        
    k1 = 1.5
    b = 0.75
    
    scores = []
    for doc_id, node in docs.items():
        tokens = doc_tokens[doc_id]
        doc_len = len(tokens)
        
        tf = {}
        for token in query_tokens:
            tf[token] = tokens.count(token)
            
        score = 0.0
        for token in query_tokens:
            tf_t = tf[token]
            if tf_t > 0:
                numerator = tf_t * (k1 + 1)
                denominator = tf_t + k1 * (1.0 - b + b * (doc_len / avg_doc_len))
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


def _build_local_embed_model():
    global _embed_model_name
    try:
        from llama_index.embeddings.huggingface import HuggingFaceEmbedding

        model = HuggingFaceEmbedding(
            model_name=LOCAL_EMBED_MODEL,
            trust_remote_code=True,
            device="cpu",
        )
        _embed_model_name = LOCAL_EMBED_MODEL
        return model
    except Exception as exc:
        print(f"[Lumina RAG] 無法載入本地 embedding 模型 ({LOCAL_EMBED_MODEL}): {exc}")
        return None


def configure_embedding(openai_api_key: Optional[str] = None) -> Tuple[str, str]:
    """Configure embedding model for indexing and retrieval."""
    global _embed_model_name, _retrieval_mode

    embed_key = (openai_api_key or "").strip() or OPENAI_API_KEY
    embed_model = None

    if EMBEDDING_PROVIDER in ("openai", "auto") and embed_key:
        embed_model = OpenAIEmbedding(model="text-embedding-3-small", api_key=embed_key)
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

    use_deepseek = bool((deepseek_api_key or "").strip()) or "deepseek" in (api_base or DEEPSEEK_API_BASE).lower()
    if use_deepseek:
        _llm_api_base = (api_base or DEEPSEEK_API_BASE).strip().rstrip("/")
        _llm_model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    else:
        _llm_api_base = "https://api.openai.com/v1"
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


def _load_index(storage_dir: str) -> Optional[VectorStoreIndex]:
    if not os.path.exists(storage_dir):
        return None
    storage_context = StorageContext.from_defaults(persist_dir=storage_dir)
    index = load_index_from_storage(
        storage_context,
        embed_model=Settings.embed_model,
    )
    if not _index_has_nodes(index):
        return None
    return index


def _upsert_documents(group_code: str, kb_id: str, filename: str, documents: List[Document]) -> int:
    ref_doc_id = make_ref_doc_id(group_code, kb_id, filename)
    for doc in documents:
        doc.id_ = ref_doc_id
        doc.metadata = {
            "group_code": normalize_code(group_code),
            "kb_id": normalize_kb_id(kb_id),
            "filename": filename,
            "ref_doc_id": ref_doc_id,
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
        return len(nodes)

    try:
        index.delete_ref_doc(ref_doc_id, delete_from_docstore=True)
    except Exception:
        pass

    index.insert_nodes(nodes)
    index.storage_context.persist(persist_dir=storage_dir)
    return len(nodes)


def index_uploaded_file(group_code: str, kb_id: str, filename: str, file_bytes: bytes) -> int:
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

        return _upsert_documents(group_code, kb_id, filename, documents)
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


def index_text_document(group_code: str, kb_id: str, title: str, content: str, filename: Optional[str] = None) -> int:
    virtual_filename = filename or f"text::{title}.md"
    body = f"# {title}\n\n{content.strip()}"
    document = Document(text=body, metadata={"title": title})
    return _upsert_documents(group_code, kb_id, virtual_filename, [document])


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
        return True
    except Exception:
        storage_context = StorageContext.from_defaults(persist_dir=storage_dir)
        nodes_to_keep = []
        for node in storage_context.docstore.docs.values():
            if node.metadata.get("filename") != filename:
                nodes_to_keep.append(node)

        shutil.rmtree(storage_dir)
        os.makedirs(storage_dir, exist_ok=True)
        if nodes_to_keep:
            rebuilt = VectorStoreIndex(nodes_to_keep)
            rebuilt.storage_context.persist(persist_dir=storage_dir)
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


def _retrieve_from_index(index: VectorStoreIndex, query: str) -> List[NodeWithScore]:
    result_lists: List[List[NodeWithScore]] = []

    if Settings.embed_model is not None:
        try:
            result_lists.append(index.as_retriever(similarity_top_k=VECTOR_TOP_K).retrieve(query))
        except Exception as exc:
            print(f"[Lumina RAG] 向量檢索失敗: {exc}")

    try:
        results = retrieve_pure_python_bm25(index.docstore, query, BM25_TOP_K)
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


def retrieve_context(group_code: str, kb_ids: List[str], query: str) -> List[NodeWithScore]:
    all_nodes: List[NodeWithScore] = []

    for kb_id in kb_ids:
        storage_dir = kb_index_dir(group_code, kb_id)
        if not os.path.exists(storage_dir):
            continue
        try:
            index = _load_index(storage_dir)
            if index is None:
                continue
            all_nodes.extend(_retrieve_from_index(index, query))
        except Exception as exc:
            print(f"[Lumina RAG] 檢索 {kb_id} 失敗: {exc}")

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
        sources.append({
            "ref_id": ref_id,
            "filename": filename,
            "kb_id": kb_id,
            "doc_id": node.node.id_,
            "score": float(node.score if node.score is not None else 1.0),
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