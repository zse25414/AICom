import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import config  # noqa: F401 — set cache paths before heavy ML imports

from typing import List, Optional

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel, Field

from config import ALLOWED_ORIGINS, HOST, IS_PRODUCTION, PORT, RAG_API_KEY, SERVICE_VERSION
from rag_engine import (
    build_sources,
    configure_embedding,
    configure_llm,
    configure_runtime,
    delete_document_index,
    generate_answer,
    get_runtime_info,
    index_text_document,
    index_uploaded_file,
    list_group_kbs,
    normalize_code,
    normalize_kb_id,
    retrieve_context,
)

app = FastAPI(title="Lumina AI - RAG Knowledge Base Service", version=SERVICE_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-RAG-API-Key"],
)


class RagApiKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/health":
            return await call_next(request)
        if IS_PRODUCTION or RAG_API_KEY:
            if not RAG_API_KEY:
                raise HTTPException(status_code=503, detail="RAG API key not configured")
            provided = request.headers.get("X-RAG-API-Key", "").strip()
            if provided != RAG_API_KEY:
                raise HTTPException(status_code=401, detail="Invalid or missing RAG API key")
        return await call_next(request)


app.add_middleware(RagApiKeyMiddleware)


class QueryRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4000)
    group_code: str
    kb_ids: List[str] = Field(default_factory=list)
    openai_api_key: Optional[str] = None
    deepseek_api_key: Optional[str] = None
    api_base: Optional[str] = None


class TextUploadRequest(BaseModel):
    group_code: str
    kb_id: str = "general"
    title: str
    content: str
    filename: Optional[str] = None
    openai_api_key: Optional[str] = None
    deepseek_api_key: Optional[str] = None


class QueryResponse(BaseModel):
    answer: str
    sources: List[dict]
    retrieval_mode: str
    embedding_mode: str


@app.on_event("startup")
async def startup_event():
    try:
        configure_embedding()
        info = get_runtime_info()
        print(f"[Lumina RAG] 啟動完成 — embedding: {info['embedding']}, retrieval: {info['retrieval']}")
        if not (os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY")):
            print("[Lumina RAG] 未設定 LLM Key，查詢生成答案需 DEEPSEEK_API_KEY 或 OPENAI_API_KEY")
    except Exception as exc:
        print(f"[Lumina RAG] 啟動 embedding 失敗: {exc}")


@app.get("/health")
async def health_check():
    info = get_runtime_info()
    return {
        "status": "ok",
        "service": "lumina-rag-service",
        "version": SERVICE_VERSION,
        "embedding": info["embedding"],
        "retrieval": info["retrieval"],
    }


@app.get("/api/rag/kb/list")
async def list_knowledge_bases(group_code: str):
    code = normalize_code(group_code)
    if not code:
        raise HTTPException(status_code=400, detail="group_code 無效")
    return {"ok": True, "group_code": code, "kb_ids": list_group_kbs(code)}


@app.post("/api/rag/document/upload")
async def upload_document(
    group_code: str = Form(...),
    kb_id: str = Form("general"),
    file: UploadFile = File(...),
    openai_api_key: Optional[str] = Form(None),
    deepseek_api_key: Optional[str] = Form(None),
):
    code = normalize_code(group_code)
    kb = normalize_kb_id(kb_id)
    if not code:
        raise HTTPException(status_code=400, detail="group_code 無效")
    if not file.filename:
        raise HTTPException(status_code=400, detail="缺少檔名")

    try:
        configure_embedding(openai_api_key)
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="檔案為空")
        chunks = index_uploaded_file(code, kb, file.filename, content)
        info = get_runtime_info()
        return {
            "ok": True,
            "filename": file.filename,
            "chunks": chunks,
            "embedding": info["embedding"],
            "retrieval": info["retrieval"],
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"上傳與解析失敗: {str(exc)}") from exc


@app.post("/api/rag/document/upload-text")
async def upload_text_document(req: TextUploadRequest):
    code = normalize_code(req.group_code)
    kb = normalize_kb_id(req.kb_id)
    title = (req.title or "").strip()
    content = (req.content or "").strip()

    if not code:
        raise HTTPException(status_code=400, detail="group_code 無效")
    if not title:
        raise HTTPException(status_code=400, detail="請提供文件標題")
    if not content:
        raise HTTPException(status_code=400, detail="請提供文件內容")

    try:
        configure_embedding(req.openai_api_key)
        chunks = index_text_document(code, kb, title, content, req.filename)
        info = get_runtime_info()
        return {
            "ok": True,
            "filename": req.filename or f"text::{title}.md",
            "chunks": chunks,
            "embedding": info["embedding"],
            "retrieval": info["retrieval"],
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"文字索引失敗: {str(exc)}") from exc


@app.post("/api/rag/document/delete")
async def delete_document(
    group_code: str = Form(...),
    kb_id: str = Form("general"),
    filename: str = Form(...),
    openai_api_key: Optional[str] = Form(None),
    deepseek_api_key: Optional[str] = Form(None),
):
    code = normalize_code(group_code)
    kb = normalize_kb_id(kb_id)
    name = (filename or "").strip()
    if not code or not name:
        raise HTTPException(status_code=400, detail="group_code 或 filename 無效")

    try:
        configure_embedding(openai_api_key)
        deleted = delete_document_index(code, kb, name)
        if not deleted:
            raise HTTPException(status_code=404, detail="知識庫不存在")
        return {"ok": True, "message": f"檔案 {name} 已自知識庫刪除"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"刪除失敗: {str(exc)}") from exc


@app.post("/api/rag/query", response_model=QueryResponse)
async def query_knowledge_base(req: QueryRequest):
    code = normalize_code(req.group_code)
    if not code:
        raise HTTPException(status_code=400, detail="group_code 無效")

    kb_ids = [normalize_kb_id(k) for k in (req.kb_ids or []) if str(k).strip()]
    if not kb_ids:
        kb_ids = list_group_kbs(code) or ["general"]

    query = req.query.strip()
    try:
        configure_embedding(req.openai_api_key)
        top_nodes = retrieve_context(code, kb_ids, query)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    info = get_runtime_info()

    if not top_nodes:
        return QueryResponse(
            answer="抱歉，根據目前的知識庫資料，我找不到與此問題相關的參考資訊。",
            sources=[],
            retrieval_mode=info["retrieval"],
            embedding_mode=info["embedding"],
        )

    context_text, sources = build_sources(top_nodes)
    try:
        configure_llm(req.openai_api_key, req.deepseek_api_key, req.api_base)
        answer = generate_answer(query, context_text)
    except ValueError as exc:
        if "未設定 LLM API Key" not in str(exc):
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        snippets = [s.strip() for s in context_text.split("\n\n") if s.strip()][:3]
        preview = "\n\n".join(snippets)
        answer = (
            "（未設定 LLM API Key，以下為知識庫檢索摘要）\n\n"
            f"{preview}\n\n"
            "請到「設定 → DeepSeek AI 連線」填入 API Key 並儲存，"
            "或由管理員在伺服器設定 DEEPSEEK_API_KEY。"
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"LLM 呼叫失敗: {str(exc)}") from exc

    return QueryResponse(
        answer=answer,
        sources=sources,
        retrieval_mode=info["retrieval"],
        embedding_mode=info["embedding"],
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)