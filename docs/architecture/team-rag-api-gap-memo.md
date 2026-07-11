# 架構備忘：Team RAG「缺口 → 目標架構」

| 項目 | 內容 |
|------|------|
| 文件類型 | Backend Architect 設計備忘（**只設計、不寫 code**） |
| 對照來源 | `TeamPlan.md`、現況 `api-proxy.js`、`rag_service/`、`lib/*-store.js` |
| 讀者 | @Lumina Planner、@Core Coder、@Reviewer & Optimizer |
| 明確不在範圍 | 前端像素／視覺、測試腳本細節、部署自動化腳本 |
| 日期 | 2026-07-11 |

---

## 0. 一句話結論

現況已具備 **「群組隔離的 RAG 檢索 + 隱式多 KB + 文件 metadata 半成品」**；TeamPlan 要求的 **「KB 一級實體 CRUD、文件版本／軟刪除、角色級上傳權限、穩定 citations／錯誤碼契約」** 尚未成型。建議採 **api-proxy 當權限與 metadata 真相來源、rag_service 當索引與檢索引擎** 的雙層契約，以 P0 補齊權限與 KB／文件契約，避免前端繼續維護兩套文件狀態。

---

## 1. 現況 API 地圖

### 1.1 系統邊界

```
Browser (JWT)
    │
    ▼
api-proxy.js  (Node :3001)  ──  auth / user / enterprise / chat / rag proxy / uploads / health
    │
    ├─ lib/auth-store.js + lib/auth.js
    ├─ lib/user-data-store.js
    ├─ lib/enterprise-store.js  (JSON file 或 Mongo single-doc)
    │
    └─► rag_service (FastAPI :8000)  ──  向量索引 / 檢索 / 生成
              storage/{GROUP}/{kb_id}/index/
```

**責任現況：**

| 層 | 負責 | 不負責 |
|----|------|--------|
| `api-proxy` | JWT、群組成員檢查、企業任務／文件 metadata、代理 RAG、注入 LLM key | 切塊、embedding、向量檢索 |
| `rag_service` | 解析、chunk、index、query、sources | 使用者角色、企業 membership 真相、軟刪除／版本 |
| 前端 | 雙寫：enterprise document + RAG index | 伺服器端原子一致性 |

---

### 1.2 api-proxy.js 端點表（現況）

#### Auth

| 方法 | 路徑 | 認證 | 摘要 |
|------|------|------|------|
| POST | `/api/auth/register` | 無 | 註冊，回 token + user |
| POST | `/api/auth/login` | 無 | 登入 |
| GET | `/api/auth/me` | Bearer JWT | 目前使用者 |
| PATCH | `/api/auth/profile` | Bearer JWT | 更新 name/role（**個人顯示角色**，非群組 role） |

#### User data

| 方法 | 路徑 | 認證 | 摘要 |
|------|------|------|------|
| GET | `/api/user/data` | JWT | 個人狀態 blob |
| PUT | `/api/user/data` | JWT | 整包覆寫（含 version 遞增） |
| PATCH | `/api/user/data` | JWT | 合併更新 |

#### Enterprise

| 方法 | 路徑 | 認證／授權 | 摘要 |
|------|------|------------|------|
| POST | `/api/enterprise/group/create` | 可選 JWT | 建立群組 + manager 成員 |
| POST | `/api/enterprise/group/join` | 可選 JWT；manager 需 PIN | 加入／重入 |
| GET | `/api/enterprise/group/:code?memberId=` | member 驗證 | 群組資料（含 `documents[]`） |
| POST | `/api/enterprise/group/document/add` | **manager only** | 企業文件 metadata + 可選本機 uploads |
| POST | `/api/enterprise/group/document/delete` | **manager only** | **硬刪** metadata + 實體檔 |
| POST | `/api/enterprise/task/assign` | manager | 指派任務 |
| PATCH | `/api/enterprise/task/:id` | manager 或 assignee | 更新完成狀態 |
| GET | `/api/enterprise/notifications` | member | 通知列表 |
| PATCH | `/api/enterprise/notifications/read` | member | 標記已讀 |

#### Chat / RAG proxy / 基礎設施

| 方法 | 路徑 | 認證 | 摘要 |
|------|------|------|------|
| POST | `/api/chat` | `requireAiAuth`（產線 JWT；開發可 `ALLOW_ANONYMOUS_AI`） | 代理 DeepSeek chat completions |
| GET | `/api/rag/kb/list` | AI auth + **群組成員** | 代理 rag_service；KB 由目錄推導 |
| POST | `/api/rag/query` | 同上 + AI rate limit | 代理查詢；可注入 server DeepSeek key |
| POST | `/api/rag/document/upload-text` | 同上（**無 manager 限制**） | JSON 代理文字索引 |
| POST | `/api/rag/document/upload` | 同上（**無 manager 限制**） | JSON base64 → multipart 轉發 |
| POST | `/api/rag/document/delete` | 同上（**無 manager 限制**） | form 轉發硬刪索引 |
| GET | `/uploads/:file` | JWT + 群組文件歸屬 | 企業上傳檔 |
| GET | `/health` | 無 | 存活 + storage backend |
| GET | `/ready` | 無 | store / auth / rag 就緒 |

---

### 1.3 rag_service 端點表（現況）

| 方法 | 路徑 | 服務間認證 | 請求重點 | 回應重點 |
|------|------|------------|----------|----------|
| GET | `/health` | 免 key | — | status, embedding, retrieval |
| GET | `/api/rag/kb/list?group_code=` | `X-RAG-API-Key`（產線） | group_code | `{ ok, group_code, kb_ids[] }` |
| POST | `/api/rag/document/upload` | 同上 | form: group_code, kb_id, file | `{ ok, filename, chunks, embedding, retrieval }` |
| POST | `/api/rag/document/upload-text` | 同上 | JSON: group_code, kb_id, title, content, filename? | 同上 |
| POST | `/api/rag/document/delete` | 同上 | form: group_code, kb_id, filename | `{ ok, message }` / 404 |
| POST | `/api/rag/query` | 同上 | JSON: query, group_code, kb_ids[], keys? | `{ answer, sources[], retrieval_mode, embedding_mode }` |

**KB 現況語意：** 上傳時指定 `kb_id`（預設 `general`）即在 `storage/{GROUP}/{kb_id}/index` 建立目錄 → **隱式建立 KB**。  
**列表：** 掃描有 `index/` 子目錄的 kb 資料夾。  
**刪除 KB：** 無 API；僅能刪「某 filename 的索引」。

#### 現況 sources schema（query）

```json
{
  "ref_id": 1,
  "filename": "SOP.pdf",
  "kb_id": "general",
  "doc_id": "<llama-index-node-id>",
  "score": 0.42
}
```

缺口：無穩定 `document_id`、無 `title`、無 `chunk_text`／snippet、無 `version`、無頁碼／offset。

---

### 1.4 現況資料形狀（企業文件）

`group.documents[]`（enterprise-store，嵌在 group 內）：

| 欄位 | 現況 | 備註 |
|------|------|------|
| `id` | 有（hex uid） | enterprise 側 document id |
| `title` | 有 | |
| `content` | 有 | 文字內容或檔案描述／抽取文字 |
| `docType` | text / pdf / image / excel | |
| `fileUrl` | 可選 `/uploads/...` | 與 RAG 索引路徑無穩定關聯 |
| `filename` | 可選 | RAG 以 filename 當 ref_doc_id 一環 |
| `kbId` | 預設 general | 前端固定標籤：general / onboarding / specs / meetings |
| `author` | manager name | 非 userId |
| `createdAt` | ISO | |
| `version` | **無** | |
| `deletedAt` / soft delete | **無**（硬刪） | |
| `ragStatus` / `ragSyncedAt` | **無** | 前端 best-effort 雙寫 |

**雙軌問題：**  
- Enterprise metadata：`POST .../document/add`（manager only）  
- RAG index：`POST /api/rag/document/*`（任一群組成員皆可）  
→ 權限不一致；可能出現「索引有、列表無」或相反。

---

## 2. 對照 TeamPlan 的契約缺口

TeamPlan 核心要求摘要：

1. 多知識庫管理（建立／上傳／版本／刪除）  
2. 對話選 KB、回答引用來源  
3. 群組隔離 + 角色（管理員上傳管理、成員查詢）  
4. 真 RAG（非全文塞 prompt）

### 2.1 缺口矩陣

| TeamPlan 能力 | 現況 | 缺口等級 | 說明 |
|---------------|------|----------|------|
| 多 KB | 隱式（上傳帶 `kb_id`） | **高** | 無 create/rename/delete/list metadata（名稱、說明、建立者） |
| KB 列表 | 目錄掃描 `kb_ids[]` | 中 | 只有 id，無 displayName、docCount、updatedAt |
| 文件 metadata | enterprise.documents 半套 | 中 | 與 RAG 索引 id 未統一；無 list-by-kb 專用 API |
| 文件版本 | 無 | **高** | 同 filename 覆寫索引；無 version 歷史 |
| 軟刪除 | 無（硬刪） | **高** | 刪除即失索引；無法還原／審計 |
| 角色：manager 上傳 | enterprise 有；RAG 無 | **高** | RAG 寫入路徑任一 member 可打 |
| 角色：member 查詢 | 有（成員即可 query） | 低 | 符合 TeamPlan |
| 跨群組拒絕 | 403「你不是此群組成員」 | 中 | 缺穩定 **error code** 供前端分支 |
| query `kb_ids` | 已支援；空則掃全部 KB | 低 | 需文件化「空陣列 = 全 KB」語意 |
| citations schema | 最小 sources | **高** | 缺 document_id、snippet、version、title |
| 錯誤碼契約 | 多為中文 `error` 字串 | 中 | 無機器可讀 `code` |
| 獨立 KB CRUD | 無 | **高** | 見 2.2 決策 |

### 2.2 決策：是否需要獨立 KB CRUD？

| 方案 | 優點 | 缺點 | 建議 |
|------|------|------|------|
| A. 維持隱式（僅上傳建立） | 改動小 | 空 KB 無法預建；無法命名／刪除空殼；列表無 metadata | 不採用為目標 |
| B. **獨立 KB CRUD（建議）** | 對齊 TeamPlan「建立多個知識庫」；權限邊界清楚；UI 可先建 KB 再上傳 | 多一組端點；需 metadata 儲存 | **採用** |
| C. 僅 enterprise 側 KB registry、RAG 仍隱式 | 代理層掌控 | 刪 KB 時仍需呼叫 RAG 清目錄 | B 的實作細節可採此分層 |

**建議契約：**

- **api-proxy** 擁有 `KnowledgeBase` 與 `Document` metadata（JSON／Mongo 皆可）。  
- **rag_service** 維持以 `(group_code, kb_id, filename|doc_key)` 為索引鍵；新增可選 `DELETE /api/rag/kb` 清索引目錄（內部 API）。  
- 上傳前要求 KB 已存在（P0）；或允許 `auto_create=true` 相容舊客戶端（遷移期）。

### 2.3 角色權限目標矩陣

| 動作 | manager | member | 非成員 | 匿名（產線） |
|------|---------|--------|--------|--------------|
| 建立／改名／刪 KB | ✅ | ❌ 403 `ROLE_FORBIDDEN` | 403 `GROUP_FORBIDDEN` | 401 |
| 上傳／更新文件／版本 | ✅ | ❌ | 403 | 401 |
| 軟刪／還原文件 | ✅ | ❌ | 403 | 401 |
| 列表 KB／文件 | ✅ | ✅ | 403 | 401 |
| query / citations | ✅ | ✅ | 403 | 401 |

**現況偏差：** RAG upload/delete 對 member 仍放行 → P0 必修。

### 2.4 查詢請求／回應契約缺口

**請求（現況已有）：**

```json
{
  "query": "string",
  "group_code": "TEAM01",
  "kb_ids": ["general", "onboarding"]
}
```

**目標補強：**

| 欄位 | 規則 |
|------|------|
| `kb_ids` | 可選；`[]` 或省略 = 該群組全部 **active** KB |
| 非法 kb_id | 400 `INVALID_KB_ID` 或忽略未知 id（建議 **嚴格：未知 → 400**） |
| 無權 group | 403 `GROUP_FORBIDDEN` |

**citations 目標 schema：**

```json
{
  "answer": "...",
  "citations": [
    {
      "ref_id": 1,
      "document_id": "a1b2c3...",
      "kb_id": "onboarding",
      "title": "新人手冊",
      "filename": "onboarding.pdf",
      "version": 3,
      "snippet": "前 200 字…",
      "score": 0.81,
      "chunk_id": "optional-node-id"
    }
  ],
  "retrieval_mode": "hybrid",
  "embedding_mode": "..."
}
```

相容策略：P0 同時回 `sources`（舊）與 `citations`（新）；P2 再 deprecate `sources`。

### 2.5 建議統一錯誤碼（機器可讀）

所有 JSON 錯誤建議形狀：

```json
{
  "ok": false,
  "error": "人類可讀訊息",
  "code": "GROUP_FORBIDDEN"
}
```

| code | HTTP | 語意 |
|------|------|------|
| `AUTH_REQUIRED` | 401 | 未登入 |
| `GROUP_NOT_FOUND` | 404 | 群組不存在 |
| `GROUP_FORBIDDEN` | 403 | 非本群組成員（跨群組） |
| `ROLE_FORBIDDEN` | 403 | 成員身分不足（非 manager） |
| `KB_NOT_FOUND` | 404 | 知識庫不存在 |
| `KB_EXISTS` | 409 | 知識庫 id 衝突 |
| `DOC_NOT_FOUND` | 404 | 文件不存在或已刪 |
| `INVALID_KB_ID` | 400 | kb_id 格式或集合非法 |
| `VALIDATION_ERROR` | 400 | 參數缺漏／格式 |
| `RATE_LIMITED` | 429 | 限流 |
| `RAG_UNAVAILABLE` | 503 | rag_service 不可用 |
| `CONFLICT_VERSION` | 409 | 樂觀鎖／版本衝突（P1） |

---

## 3. 建議目標資料模型

設計原則：**同一模型** 可落在 JSON 檔（開發）或 Mongo（正式）；以 `groupCode` 為租戶邊界。

### 3.1 實體關係

```
Group 1──* Member(role: manager|member)
Group 1──* KnowledgeBase
KnowledgeBase 1──* Document
Document 1──* DocumentVersion   (P1；P0 可僅 currentVersion 欄位)
Document ──索引鍵──► rag_service ref_doc_id
```

### 3.2 KnowledgeBase

```json
{
  "id": "onboarding",
  "groupCode": "TEAM01",
  "displayName": "新人培訓",
  "description": "入職 SOP 與文化",
  "createdByMemberId": "…",
  "createdByUserId": "…",
  "createdAt": "ISO",
  "updatedAt": "ISO",
  "status": "active",
  "docCount": 12,
  "deletedAt": null
}
```

| 規則 | 說明 |
|------|------|
| `id` | 正規化：`[a-z0-9_-]{1,30}`（與現 `normalize_kb_id` 對齊） |
| 唯一鍵 | `(groupCode, id)` |
| 刪除 | P0：軟刪 `status=deleted` + 非同步清 RAG；P1：可還原 |

### 3.3 Document

```json
{
  "id": "d6c103254c7c7290",
  "groupCode": "TEAM01",
  "kbId": "onboarding",
  "title": "新人手冊",
  "docType": "pdf",
  "filename": "handbook.pdf",
  "mimeType": "application/pdf",
  "fileUrl": "/uploads/…",
  "contentPreview": "前 N 字…",
  "authorMemberId": "…",
  "authorName": "…",
  "createdAt": "ISO",
  "updatedAt": "ISO",
  "currentVersion": 2,
  "status": "active",
  "deletedAt": null,
  "rag": {
    "status": "indexed|pending|failed|deleted",
    "refDocId": "TEAM01::onboarding::handbook.pdf",
    "chunks": 42,
    "lastIndexedAt": "ISO",
    "lastError": null
  }
}
```

**索引鍵策略（重要）：**

| 策略 | 內容 | 建議 |
|------|------|------|
| 現況 | `group::kb::filename` | 檔名碰撞、改名困難 |
| 目標 | `group::kb::document_id` 或 `group::kb::document_id::v{n}` | **P0 採用 document_id**；filename 僅展示 |

遷移：舊索引以 filename 為 key 者，重新 index 時寫入 `rag.refDocId` 新格式。

### 3.4 DocumentVersion（P1）

```json
{
  "documentId": "…",
  "version": 2,
  "title": "…",
  "contentHash": "sha256…",
  "fileUrl": "…",
  "createdAt": "ISO",
  "createdByMemberId": "…",
  "ragRefDocId": "TEAM01::onboarding::docId::v2",
  "changeNote": "更新 Q3 流程"
}
```

P0：**只保留 `currentVersion` 遞增 + 覆寫索引**，不存完整歷史 blob。  
P1：寫入新版本、舊版本索引可選保留或標記 inactive。

### 3.5 儲存落地

#### JSON 後端（現 enterprise-data.json 演進）

```json
{
  "groups": {
    "TEAM01": {
      "code": "TEAM01",
      "name": "…",
      "members": […],
      "tasks": […],
      "notifications": […],
      "knowledgeBases": {
        "general": { "id": "general", "displayName": "一般預設", … },
        "onboarding": { … }
      },
      "documents": [ /* Document[] */ ]
    }
  }
}
```

- 相容：既有 `documents[]` 欄位擴充；缺 `knowledgeBases` 時啟動遷移：從 documents 的 `kbId` + 掃描行為推導預設 KB。  
- `general` 對每個群組 **lazy ensure**。

#### Mongo 後端（建議集合拆分，避免單 doc 膨脹）

| Collection | 鍵 | 說明 |
|------------|-----|------|
| `enterprise_groups` | `_id: groupCode` | 群組本體、members、tasks、notifications（沿用或漸進拆） |
| `knowledge_bases` | `{ groupCode, id }` unique | KB metadata |
| `documents` | `_id: documentId`；index `{ groupCode, kbId, status }` | 文件 metadata |
| `document_versions` | `{ documentId, version }` unique | P1 |

現況 Mongo 為 **單一 `enterprise_store` document**（整包 groups）。P0 可仍嵌在 group 內以降低改動；**P1 起建議拆 collection**，避免文件量上升時整包 replace 效能問題。此為架構建議，實作時由 @Core Coder 分 PR。

### 3.6 rag_service 側（最小 metadata）

向量節點 metadata 目標：

```json
{
  "group_code": "TEAM01",
  "kb_id": "onboarding",
  "document_id": "d6c1…",
  "version": 2,
  "filename": "handbook.pdf",
  "title": "新人手冊",
  "ref_doc_id": "TEAM01::onboarding::d6c1…"
}
```

rag_service **不**存角色；**不**當 document 列表真相來源。

---

## 4. 目標 API 契約（端點表）

### 4.1 公開（經 api-proxy，前端只打此層）

#### Knowledge Base

| 優先 | 方法 | 路徑 | 授權 | 說明 |
|------|------|------|------|------|
| P0 | POST | `/api/rag/kb` | manager | 建立 KB `{ group_code, id?, displayName, description? }` |
| P0 | GET | `/api/rag/kb` | member | 列表（取代／擴充僅回 kb_ids 的 list） |
| P1 | PATCH | `/api/rag/kb/:kbId` | manager | 改 displayName／description |
| P0 | DELETE | `/api/rag/kb/:kbId` | manager | 軟刪 KB + 級聯軟刪文件 + 清索引 |
| P0 | GET | `/api/rag/kb/list` | member | **相容別名**：可轉發新 list；保留 path 降低前端改動 |

#### Document

| 優先 | 方法 | 路徑 | 授權 | 說明 |
|------|------|------|------|------|
| P0 | POST | `/api/rag/document` | manager | 統一上傳入口（metadata + 觸發 index） |
| P0 | GET | `/api/rag/documents?group_code=&kb_id=&include_deleted=` | member | 分 KB 列表 |
| P1 | GET | `/api/rag/document/:id` | member | 單筆詳情 |
| P1 | POST | `/api/rag/document/:id/versions` | manager | 新版本上傳 |
| P0 | DELETE | `/api/rag/document/:id` | manager | **軟刪**（`status=deleted`） |
| P1 | POST | `/api/rag/document/:id/restore` | manager | 還原 |
| P0 | POST | `/api/rag/document/:id/reindex` | manager | 重跑索引 |

#### Query（演進）

| 優先 | 方法 | 路徑 | 授權 | 說明 |
|------|------|------|------|------|
| P0 | POST | `/api/rag/query` | member | 強化：權限、error code、`citations`；保留 `sources` |

#### 既有 enterprise document（遷移策略）

| 路徑 | 建議 |
|------|------|
| `POST /api/enterprise/group/document/add` | P0 內部改呼叫同一 Document service；或標 **deprecated**，代理到 `/api/rag/document` |
| `POST /api/enterprise/group/document/delete` | 改軟刪 + 同步 RAG；回應加 `code` |

避免長期維持兩套寫入 API。

### 4.2 內部（api-proxy → rag_service）

| 方法 | 路徑 | 說明 |
|------|------|------|
| 既有 upload / upload-text / delete / query | 保留 | proxy 補 `document_id` metadata |
| P0 新增 | `DELETE /api/rag/kb` body: group_code, kb_id | 刪整庫索引目錄 |
| P1 可選 | `GET /api/rag/document/meta` | 僅除錯；正式列表以 proxy metadata 為準 |

rag_service 持續以 `X-RAG-API-Key` 保護；**不對瀏覽器直連**（產線）。

---

## 5. api-proxy 模組切分建議（路由邊界，不實作）

現況 `api-proxy.js` 為單檔巨型路由。建議**邏輯邊界**如下（可先函式分檔，不必一次上框架）：

```
api-proxy.js                 # HTTP server 組裝、CORS、rate limit、listen
lib/http/
  respond.js                 # sendJson, securityHeaders, readBody
  rate-limit.js
lib/auth/*                   # 既有
lib/middleware/
  auth.js                    # requireAuth, requireAiAuth, getOptionalAuth
  enterprise-guard.js        # assertEnterpriseMember, assertRagGroupAccess
  rbac.js                    # requireGroupRole(group, user, 'manager')
routes/
  health.js                  # /health /ready
  auth.js                    # /api/auth/*
  user-data.js               # /api/user/*
  enterprise/
    groups.js                # create/join/get
    tasks.js
    notifications.js
    documents-legacy.js      # 過渡期 document/add|delete
  rag/
    kb.js                    # KB CRUD
    documents.js             # Document CRUD + soft delete
    query.js                 # query proxy + citations 正規化
    proxy-client.js          # buildRagHeaders, proxyRagJson/Get, multipart
  chat.js                    # /api/chat
  uploads.js                 # GET /uploads/*
services/
  kb-service.js              # KB 業務 + store 讀寫
  document-service.js        # Document/Version + 呼叫 rag proxy
  rag-index-bridge.js        # refDocId 規則、index/delete 編排
lib/enterprise-store.js      # 或拆 kb/document repository
```

### 5.1 依賴規則

| 模組 | 可依賴 | 不可依賴 |
|------|--------|----------|
| `routes/*` | middleware、services、http | rag_engine Python |
| `services/*` | store、proxy-client | 直接碰 Node `http` req/res 細節（盡量） |
| `proxy-client` | env、fetch | enterprise 業務 |
| `rag_service` | 自身 storage | JWT／member 表 |

### 5.2 單一寫入路徑（目標）

```
Manager 上傳
  → routes/rag/documents.js
  → rbac manager
  → document-service.create
       ├─ persist Document (status=active, rag.pending)
       └─ rag-index-bridge.index
            └─ rag_service upload*
       → update rag.status=indexed|failed
```

列表／權限以 **document-service** 為準；RAG 失敗不應留下「前端以為成功但不可查」的沉默狀態（至少 `rag.status=failed`）。

---

## 6. P0 / P1 / P2 優先 API 清單與破壞性風險

### 6.1 P0 — MVP 契約對齊（建議下一階段實作）

| # | 項目 | 破壞性風險 | 緩解 |
|---|------|------------|------|
| P0-1 | RAG 寫入路徑强制 **manager**；query/list 保持 member | **中**：現 member 若曾直打 upload 會 403 | 文件公告；前端本就 manager 上傳 |
| P0-2 | 統一錯誤 `code` 欄位 | **低** | 保留 `error` 字串 |
| P0-3 | KB 建立 + 列表（含 displayName） | **低** | `GET /api/rag/kb/list` 擴充為物件陣列時需相容：可同時回 `kb_ids` + `items` |
| P0-4 | KB 刪除（軟刪 + 清索引） | **中** | 僅 manager；需確認無進行中 query |
| P0-5 | Document 軟刪（enterprise + RAG 同步） | **中** | delete API 改語意：預設軟刪；`?hard=true` 僅內部 |
| P0-6 | query 回 `citations`（並保留 `sources`） | **低** | 雙欄位 |
| P0-7 | 上傳／刪除以 `document_id` 關聯 RAG | **中** | 遷移期 dual-key 查刪 |
| P0-8 | 禁止非成員跨群組（既有加強 + 穩定 code） | **低** | 已有 403，補 code |
| P0-9 | `kb_ids` 嚴格校驗與文件化 | **低–中** | 未知 id 由忽略改 400 時需前端先 list |

**P0 不做：** 完整版本歷史、知識圖譜、OCR 強化、審計日誌 UI、拆 Mongo collection（可設計預留欄位）。

### 6.2 P1 — 版本與治理

| # | 項目 | 破壞性風險 |
|---|------|------------|
| P1-1 | DocumentVersion 寫入與查歷史 | 低 |
| P1-2 | restore 軟刪文件／KB | 低 |
| P1-3 | PATCH KB metadata | 低 |
| P1-4 | reindex job 狀態與重試 | 低 |
| P1-5 | enterprise document/* **正式 deprecate** | 中（前端切換） |
| P1-6 | Mongo 集合拆分 + 遷移腳本 | **高**（資料路徑變更）→ 需 @Data & Automation 遷移計畫 |
| P1-7 | citations 含 snippet／page（若解析可得） | 低 |

### 6.3 P2 — 企業級加分

| # | 項目 | 破壞性風險 |
|---|------|------------|
| P2-1 | 審計日誌 API（誰上傳／刪除） | 低 |
| P2-2 | 文件摘要自動生成 webhook／通知 | 低 |
| P2-3 | 棄用 `sources` 只留 `citations` | **中** |
| P2-4 | 硬刪 purge 與 retention policy | 中 |
| P2-5 | 跨群組共享 KB（預設永不做，除非產品重開） | 高（安全模型） |
| P2-6 | 向量庫外移 Qdrant／Pinecone | **高**（rag_service 儲存抽象） |

### 6.4 關鍵路徑保護提醒

變更下列端點前須 @Backend Architect 影響分析 + @Reviewer & Optimizer 審查（專案規則）：

- `POST /api/auth/*`、`GET|PUT|PATCH /api/user/data`
- `POST /api/chat`
- `POST|GET /api/rag/*`
- `POST /api/enterprise/*`
- `GET /health`、`GET /ready`

---

## 7. 給 @Core Coder 的實作邊界

### 7.1 應實作

1. **api-proxy RBAC**  
   - `assertRagGroupAccess` 延伸：`requireManager` 用於 upload / delete / kb write。  
   - 錯誤回應帶 `code`（上表）。

2. **KB metadata 持久化**  
   - 在 enterprise store（或新 repository）落地 `knowledgeBases`。  
   - 群組建立時 ensure `general`。  
   - list API 合併 store metadata +（可選）rag 目錄校驗。

3. **Document 軟刪與 RAG 同步**  
   - delete：`status=deleted`、`deletedAt`；呼叫 rag delete；**不要**先砍 metadata 再失敗無稽核。  
   - 列表預設過濾 deleted。

4. **query 契約**  
   - proxy 層可 normalize rag_service 回應 → 填 `citations`；舊 `sources` 保留。  
   - 將 `document_id` 從 metadata 帶回（需 rag_engine metadata 小改，屬 rag_service 範圍）。

5. **模組切分**  
   - 優先抽 `routes/rag/*` + `services/document-service` + `rbac`；避免繼續堆單檔。  
   - **不**強制一次上 Express／框架，除非團隊另有決策。

6. **相容**  
   - 保留 `/api/rag/kb/list`、`/api/rag/document/upload-text` 等 path；內部轉新 service 即可。  
   - enterprise `document/add|delete`：同 service 或薄包裝。

### 7.2 不應實作（本設計階段禁區）

| 禁止 | 原因 |
|------|------|
| 前端像素／CSS／教練 UI 改版 | 交 @UI & UX Engineer |
| 測試腳本細節／覆蓋率達標工程 | 交 @QA & Tester（實作後另開） |
| 部署、Docker、線上遷移執行 | 交 @Data & Automation |
| 直接改關鍵 API 行為卻無錯誤碼與遷移說明 | 違反保護原則 |
| 在 rag_service 實作 JWT／角色 | 破壞分層 |
| 知識圖譜、OCR 大改、多 LLM 路由大重整 | P2+ |

### 7.3 建議 PR 切片（供 Planner 排程）

| PR | 內容 | 風險 |
|----|------|------|
| PR-A | RBAC manager-only on RAG write + error `code` | 中 |
| PR-B | KB create/list/delete metadata + list 相容 | 低 |
| PR-C | Document soft-delete + rag sync + document_id 索引鍵 | 中 |
| PR-D | query `citations` + rag metadata 欄位 | 低 |
| PR-E | 路由檔切分（行為不變） | 低 |
| PR-F | Version history（P1） | 中 |

### 7.4 驗收標準（給實作後 @QA）

- 非成員 query/upload → 403 `GROUP_FORBIDDEN`  
- member upload/delete/kb write → 403 `ROLE_FORBIDDEN`  
- manager 建立 KB → list 可見 displayName  
- 軟刪文件後 query 不再命中；metadata 列表預設不可見  
- query 同時含 `sources` 與 `citations`，且 `citations[].document_id` 可對回列表  
- `/ready` 在 rag 掛掉時仍可依現況語意回報（既有：ready 不强制 rag）

---

## 8. 風險總表

| 風險 | 影響 | 緩解 |
|------|------|------|
| 雙寫不一致（enterprise vs RAG） | 查得到卻列表沒有／相反 | 單一 document-service 編排；`rag.status` |
| filename 當索引鍵 | 撞名覆寫 | 改 document_id；遷移 reindex |
| 單檔 api-proxy 繼續膨脹 | 回歸成本高 | 按 §5 切路由 |
| Mongo 單 document 整包 groups | 文件多時寫放大 | P1 拆 collection |
| list 回傳形狀變更 | 前端 checkbox 壞掉 | 同時回 `kb_ids: string[]` |
| 軟刪未清向量 | 資料殘留／合規 | delete 編排必須等 rag 成功或記 failed 重試 |
| ALLOW_ANONYMOUS_AI 開發模式 | 誤開產線 | 既有 `IS_PRODUCTION` 強制關閉 |

---

## 9. 範圍外（再次確認）

- 前端版面、動效、design tokens  
- 測試案例逐條腳本  
- LlamaIndex → 其他框架重寫  
- 計費、SSO、On-prem 打包  

---

## 10. 交接

| 角色 | 下一步 |
|------|--------|
| **@Lumina Planner** | 依 §6、§7.3 排程 PR-A→E；標註關鍵 API 審查點 |
| **@Core Coder** | 僅在核准本備忘後實作；邊界見 §7 |
| **@Reviewer & Optimizer** | PR-A/C 必審 RBAC 與刪除一致性 |
| **@QA & Tester** | 契約測：角色矩陣 + citations schema（實作後） |
| **@Backend Architect** | 本文件為契約來源；若產品要「member 也可上傳」需重開權限決策 |

---

*本備忘為架構契約，不含實作程式碼。*
