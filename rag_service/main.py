import os
import shutil
import tempfile
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# LlamaIndex Imports
from llama_index.core import (
    Document,
    VectorStoreIndex,
    SimpleDirectoryReader,
    StorageContext,
    load_index_from_storage,
    Settings
)
from llama_index.core.node_parser import SentenceSplitter
from llama_index.embeddings.openai import OpenAIEmbedding
from llama_index.llms.openai import OpenAI

app = FastAPI(title="Lumina AI - RAG Knowledge Base Service")

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STORAGE_DIR = os.path.join(os.path.dirname(__file__), "storage")
os.makedirs(STORAGE_DIR, exist_ok=True)

class QueryRequest(BaseModel):
    query: str
    group_code: str
    kb_ids: List[str]
    openai_api_key: Optional[str] = None
    deepseek_api_key: Optional[str] = None
    api_base: Optional[str] = None

class QueryResponse(BaseModel):
    answer: str
    sources: List[dict]

class KBListResponse(BaseModel):
    kb_ids: List[str]

def configure_settings(openai_api_key: Optional[str], deepseek_api_key: Optional[str], api_base: Optional[str]):
    """Configures LlamaIndex settings dynamically using the user's API keys."""
    # Use OpenAI API Key if available; otherwise use DeepSeek key for LLM
    llm_key = deepseek_api_key or openai_api_key or os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY")
    llm_base = api_base or os.getenv("DEEPSEEK_API_BASE") or "https://api.deepseek.com/v1"
    
    # Configure LLM (Default to DeepSeek if deepseek key is supplied)
    if deepseek_api_key or "deepseek" in llm_base.lower():
        Settings.llm = OpenAI(
            model="deepseek-chat",
            api_key=llm_key,
            api_base=llm_base,
            temperature=0.2
        )
    else:
        Settings.llm = OpenAI(
            model="gpt-4o-mini",
            api_key=llm_key,
            temperature=0.2
        )

    # Configure Embedding Model (Requires OpenAI API Key)
    embed_key = openai_api_key or os.getenv("OPENAI_API_KEY")
    if embed_key:
        Settings.embed_model = OpenAIEmbedding(
            model="text-embedding-3-small",
            api_key=embed_key
        )
    else:
        # Fallback to mock embedding model if no OpenAI Key is provided
        # This keeps the service running and avoids crashing when only DeepSeek is used
        from llama_index.core.embeddings import MockEmbedding
        Settings.embed_model = MockEmbedding(embed_dim=1536)

@app.post("/api/rag/document/upload")
async def upload_document(
    group_code: str = Form(...),
    kb_id: str = Form(...),
    openai_api_key: Optional[str] = Form(None),
    deepseek_api_key: Optional[str] = Form(None),
    file: UploadFile = File(...)
):
    # Configure settings with the supplied keys
    configure_settings(openai_api_key, deepseek_api_key, None)
    
    kb_dir = os.path.join(STORAGE_DIR, group_code, kb_id)
    os.makedirs(kb_dir, exist_ok=True)

    # Save uploaded file to temp file
    suffix = os.path.splitext(file.filename)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        content = await file.read()
        temp_file.write(content)
        temp_path = temp_file.name

    try:
        # Read the document using SimpleDirectoryReader
        reader = SimpleDirectoryReader(input_files=[temp_path])
        documents = reader.load_data()
        
        if not documents:
            raise HTTPException(status_code=400, detail="無法解析該檔案內容")

        # Overwrite metadata for each document
        for doc in documents:
            doc.metadata = {
                "group_code": group_code,
                "kb_id": kb_id,
                "filename": file.filename
            }

        # Splitting
        splitter = SentenceSplitter(chunk_size=512, chunk_overlap=50)
        nodes = splitter.get_nodes_from_documents(documents)

        # Load or create index
        storage_dir = os.path.join(kb_dir, "index")
        if os.path.exists(storage_dir):
            storage_context = StorageContext.from_defaults(persist_dir=storage_dir)
            index = load_index_from_storage(storage_context)
            index.insert_nodes(nodes)
            index.storage_context.persist(persist_dir=storage_dir)
        else:
            index = VectorStoreIndex(nodes)
            index.storage_context.persist(persist_dir=storage_dir)

        return {"ok": True, "filename": file.filename, "chunks": len(nodes)}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"上傳與解析失敗: {str(e)}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.post("/api/rag/document/delete")
async def delete_document(
    group_code: str = Form(...),
    kb_id: str = Form(...),
    filename: str = Form(...),
    openai_api_key: Optional[str] = Form(None),
    deepseek_api_key: Optional[str] = Form(None)
):
    configure_settings(openai_api_key, deepseek_api_key, None)
    
    kb_dir = os.path.join(STORAGE_DIR, group_code, kb_id, "index")
    if not os.path.exists(kb_dir):
        raise HTTPException(status_code=404, detail="知識庫不存在")
        
    try:
        # Load index
        storage_context = StorageContext.from_defaults(persist_dir=kb_dir)
        index = load_index_from_storage(storage_context)
        
        # In simple vector store, we can delete nodes by metadata
        # LlamaIndex doesn't support generic metadata deletion directly on VectorStoreIndex out-of-the-box easily
        # So we rebuild the index excluding the nodes matching the filename
        doc_store = storage_context.docstore
        all_ref_docs = doc_store.docs
        
        nodes_to_keep = []
        for doc_id, node in all_ref_docs.items():
            if node.metadata.get("filename") != filename:
                nodes_to_keep.append(node)
                
        # Re-save the clean index
        shutil.rmtree(kb_dir)
        os.makedirs(kb_dir, exist_ok=True)
        index = VectorStoreIndex(nodes_to_keep)
        index.storage_context.persist(persist_dir=kb_dir)
        
        return {"ok": True, "message": f"檔案 {filename} 已自知識庫刪除"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"刪除失敗: {str(e)}")

@app.post("/api/rag/query", response_model=QueryResponse)
async def query_knowledge_base(req: QueryRequest):
    configure_settings(req.openai_api_key, req.deepseek_api_key, req.api_base)
    
    all_nodes = []
    
    # Query each requested knowledge base index to find relevant chunks
    for kb_id in req.kb_ids:
        kb_index_dir = os.path.join(STORAGE_DIR, req.group_code, kb_id, "index")
        if not os.path.exists(kb_index_dir):
            continue
            
        try:
            storage_context = StorageContext.from_defaults(persist_dir=kb_index_dir)
            index = load_index_from_storage(storage_context)
            
            # Retrieve top 3 relevant chunks
            retriever = index.as_retriever(similarity_top_k=3)
            retrieved_nodes = retriever.retrieve(req.query)
            all_nodes.extend(retrieved_nodes)
        except Exception as e:
            print(f"[Lumina RAG] 讀取/檢索 {kb_id} 失敗: {e}")

    if not all_nodes:
        return QueryResponse(
            answer="抱歉，根據目前的知識庫資料，我找不到與此問題相關的參考資訊。",
            sources=[]
        )

    # Sort nodes by score descending and take top 5
    # For MockEmbedding, score might be None, so default to 0.0
    all_nodes.sort(key=lambda n: n.score if n.score is not None else 0.0, reverse=True)
    top_nodes = all_nodes[:5]

    # Format context and track unique sources
    context_chunks = []
    sources = []
    
    for idx, node in enumerate(top_nodes):
        meta = node.node.metadata
        ref_id = idx + 1
        filename = meta.get("filename", "未知檔案")
        context_chunks.append(f"[{ref_id}] 來源檔案：{filename}\n{node.node.text}")
        sources.append({
            "ref_id": ref_id,
            "filename": filename,
            "doc_id": node.node.id_,
            "score": float(node.score if node.score is not None else 1.0)
        })

    context_text = "\n\n".join(context_chunks)

    # Create the augmented RAG prompt
    system_prompt = (
        "你現在是 Lumina AI 團隊專屬智慧教練。\n"
        "請根據下方提供的「參考文獻與團隊資料」回答用戶的問題。回答時必須遵循以下規則：\n"
        "1. 回答內容必須完全基於參考文獻，不要憑空編造。\n"
        "2. 當你陳述參考文獻中的事實時，請在句尾標記對應的來源編號，格式為 [1] 或 [2] 等。\n"
        "3. 若參考文獻中的資訊與問題無關，請直接回答「抱歉，根據目前的知識庫資料，我無法回答此問題。」\n\n"
        f"=== 參考文獻與團隊資料 ===\n{context_text}\n======================="
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": req.query}
    ]

    try:
        response = Settings.llm.chat(messages)
        answer = response.message.content
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM 呼叫失敗: {str(e)}")

    return QueryResponse(answer=answer, sources=sources)

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "lumina-rag-service"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
