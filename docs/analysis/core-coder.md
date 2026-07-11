# 技術債與實作風險報告（只讀）

> 視角：實作一致性／blast radius／維運可誤導性  
> 範圍：模組邊界、企業文件↔RAG 雙軌、離線／錯誤語意  
> **不改 code**

---

## 1. 模組邊界現況

### 1.1 `api-proxy.js` 職責是否過重？— **是（高）**

| 指標 | 現況 |
|------|------|
| 規模 | 約 **1409 行** 單檔 monolith |
| 已抽離 | `lib/auth*.js`、`lib/enterprise-store.js`、`lib/user-data-store.js`、`lib/db.js`（約 630 行） |
| 仍擠在同一 request loop | Auth、Enterprise CRUD、User data、RAG reverse proxy（含 multipart 重寫）、Chat、Uploads、Rate limit、`/health` `/ready` |

**職責清單（單檔）**：安全閘道、企業業務、檔案落地、`/api/rag/*` 轉發、AI chat 代理、就緒探針。  
`lib/*` 只分了 **資料層**，**路由／授權／代理協定** 仍全部耦合在 `api-proxy.js`。

**實作風險**：改 `document/add` 或 RAG proxy 任一處，都落在產品關鍵路徑（`AGENTS.md` 列管的 `POST /api/enterprise/*`、`POST /api/rag/*`），回歸面大、review 成本高。

---

### 1.2 `js/modules/slices/*` 與 bundle 一致性 — **建置鏈正確，文件／路徑漂移嚴重**

**實際 SoT（Source of Truth）**：

```
js/modules/slices/*  +  manifest.json
        ↓ scripts/build-app.js（esbuild，prestart/predev 會跑）
js/lumina-app.js  +  js/chunks/lumina-*.js
```

- Core 切片在 `manifest.json` 的 `core`；lazy 為 `coach/*`、`enterprise/documents.js`。
- Bundle 約 **277 行 minify**（生成物）；slices 約 **27 檔 / ~7k 行** 才是可維護源碼。
- `package.json` 的 `build` = Tailwind + `build:app:lazy`，**不是** `js/src` 合併。

**一致性結論**：程式建置路徑與 slices **一致**；但 OPERATIONS／歷史腳本與目錄 **不一致**（見下）。

---

### 1.3 `OPERATIONS.md` 寫 `js/src/`、目錄為空 — **流程級技術債（高）**

| 項目 | 狀態 |
|------|------|
| `js/src/` | **空目錄**（0 檔） |
| `OPERATIONS.md` L63–67 | 仍寫「合併 `js/src` → `lumina-app.js`」「請改 `js/src/`」 |
| `scripts/split-app.js` | 仍指向 `js/src/lumina-*.js`（舊拆分） |
| 真源 | `js/modules/slices/` + `scripts/build-app.js` |

**影響**：

1. **改錯檔**：新人可能直接改 `js/lumina-app.js` → 下次 `npm run build` / `prestart` **被覆寫**。  
2. **改空目錄**：以為「沒有前端源碼」或誤以為功能消失。  
3. **Code review 失焦**：diff 若只盯 bundle，會漏掉真正的 slices 變更。  
4. 與 `manifest.json` 的 lazy 邊界脫節，易引入「函式在 bundle 有、chunk 未 export」類問題。

---

## 2. 企業文件 vs RAG 雙軌 — **易不一致（最高優先痛點）**

### 資料流（現況）

```
[前端 saveTeamDocument]
   ├─ online:  POST /api/enterprise/group/document/add  → enterprise store + uploads
   │            然後  syncDocumentToRag()（best-effort，失敗只 toast）
   └─ offline: localStorage enterprise store
               然後  syncDocumentToRag()（同樣 best-effort）

[後端 document/add|delete]
   └─ 只動 enterprise store / 磁碟 uploads
      ❌ 不呼叫 RAG
```

關鍵位置：

- `api-proxy.js` ~733–834：`document/add|delete` 無 RAG 副作用  
- `js/modules/slices/enterprise/documents.js` ~320–351、417–426：客戶端雙寫  
- `js/modules/slices/rag/client.js`：`syncDocumentToRag` / `reindex*` / `deleteDocumentFromRag`

### 不一致場景（易踩）

| # | 場景 | 結果 |
|---|------|------|
| A | Enterprise 成功、RAG 失敗 | UI「文件已發布」但教練查不到 → **幽靈文件** |
| B | 刪除：store 成功、RAG delete 失敗 | 列表沒了，索引還在 → **幽靈知識** |
| C | 離線 newDoc **不存 `kbId`**（~310–319） | 之後 `deleteDocumentFromRag` 用 `doc.kbId \|\| 'general'` 可能 **刪錯 KB** |
| D | `reindexEnterpriseDocumentsToRag` 不帶 `fileData`（~72–79） | 空 content 的 PDF/Excel/圖 → 永久 reindex 失敗 |
| E | Health 恢復時 `ensureEnterpriseDocsInRag({ force: true })` | 可能全量重灌；引擎若非冪等 → 重複／負載尖峰 |
| F | 檔名推導 `getRagFilenameForDoc` vs 上傳時 `text::${title}.md` | 標題改動或僅 filename 路徑不一致 → **delete 對不到索引鍵** |
| G | 離線 `fileUrl: 'blob:local-pdf-file'` | 無法重放上傳、無法完整 reindex 二進位 |

**本質**：雙寫在 **客戶端、非交易、無 outbox、無對帳**。後端是 system of record for enterprise；RAG 是旁路 index，卻被產品文案當成「自動餵給 AI」。

---

## 3. 錯誤處理／離線

### 三套「離線」語意並存

| 機制 | 檔案 | 觸發 | 語意 |
|------|------|------|------|
| 瀏覽器 offline banner | `js/modules/slices/ui/pwa.js` ~168–189 | `navigator.onLine` | 裝置無網 |
| 企業 offline 旗標 + banner | `enterprise/team.js` ~237–243、372–375 | create/join API 失敗後 sticky `offline: true` | **本機企業模式**（未必是無網） |
| 團隊同步狀態 | `team.js` `updateTeamSyncStatus` ~160–184 | `GET /ready` | API/子系統就緒 |

### 具體坑

1. **`enterpriseFetch` 語意污染**（`team.js` ~23–39）  
   任何 `!res.ok` 或網路錯都 `offline: true`。  
   → 403／400／驗證失敗也會被當「離線」；create/join 可能誤入 local 群組，且 **session.offline 不會因 API 恢復而自動翻回**。

2. **RAG health 直連硬編碼**（`constants.js` `RAG_SERVICE_URL = "http://127.0.0.1:8000"` + `health.js` 每 10s）  
   - 繞過 `/api/rag/*` JWT 閘道  
   - 非本機／多主機部署幾乎永遠 `ragServiceActive=false`  
   - 與文件上傳走 `getEnterpriseBaseUrl()` **路徑分裂**  
   - 恢復 online 時 `force` 全量 reindex（見 §2 E）

3. **offline banner vs team-offline-banner**  
   使用者可能看到「已連線」但團隊仍離線模式，或相反；無統一「連線拓撲」模型。

4. **企業文件離線路徑**  
   可寫 local + 嘗試 RAG；**沒有**「回 online 後把 local 文件 reconcile 到 server」的佇列（任務有 `flushEnterpriseSyncQueue`，文件沒有對等機制）。

---

## 4. 最痛的 5 個實作風險（含路徑）

| 順位 | 風險 | 嚴重度 | 主要路徑 |
|------|------|--------|----------|
| **1** | **Enterprise / RAG 雙寫無交易** → 幽靈文件／幽靈索引、產品信任崩 | 致命 | `js/modules/slices/enterprise/documents.js`；`js/modules/slices/rag/client.js`；`api-proxy.js`（document add/delete 無 RAG 副作用） |
| **2** | **Reindex／ensure 不完整**（無 fileData、空 content PDF、force 全量） | 高 | `js/modules/slices/rag/client.js`（`reindexEnterpriseDocumentsToRag`、`ensureEnterpriseDocsInRag`）；`js/modules/slices/rag/health.js`（force reindex） |
| **3** | **離線文件 schema 缺口**（缺 `kbId`、假 blob URL）→ 刪除／KB 對不齊 | 高 | `js/modules/slices/enterprise/documents.js` ~290–332 |
| **4** | **`enterpriseFetch` 把業務錯誤當 offline** + session sticky | 高 | `js/modules/slices/enterprise/team.js` ~23–39、~224–244、~372–375 |
| **5** | **SoT 文件漂移（空 `js/src`）+ `api-proxy` 巨石** → 改錯檔／關鍵路徑回歸爆炸 | 高（流程+架構） | `OPERATIONS.md`；`js/src/`（空）；`scripts/build-app.js`；`api-proxy.js`；`js/modules/core/constants.js`（硬編碼 RAG URL） |

**附帶（未進 Top5 但 P1 後可排）**：  
- Lazy chunk 邊界（`enterprise/documents` 與 core 的 `rag/*` 交錯依賴）  
- 上傳 URL 在列表渲染時把 JWT 塞 query（`documents.js` `resolveDocFileUrl`）— 安全／洩漏面  
- `api-proxy` RAG multipart 手拼 boundary — 檔名特殊字元脆弱

---

## 5. 若進入 P1：建議改動檔案（≤6）與順序

> 仍不實作；目標：**先止血雙軌與語意，再碰巨石拆分**。

| 順序 | 檔案 | 建議改動方向（規格層） | 預估 |
|------|------|------------------------|------|
| **1** | `OPERATIONS.md` | 更正 SoT：`js/modules/slices/*` + `manifest.json` + `npm run build:app`；禁止手改 `js/lumina-app.js`；註明 `js/src` 廢棄 | XS |
| **2** | `js/modules/slices/enterprise/documents.js` | 離線 newDoc 寫入 `kbId`；雙寫結果分流（enterprise ok ≠ RAG ok 的 UX／狀態）；刪除時穩定 filename/kbId 契約 | S–M |
| **3** | `js/modules/slices/rag/client.js` | 統一 index key（filename 規範）；reindex 策略（僅 text 或明確 skip 二進位）；可選 sync status 回傳；避免 silent fail | M |
| **4** | `js/modules/slices/rag/health.js` | Health 改走 API base（或 `/ready` 的 rag check），拿掉硬編碼直連依賴；恢復時 **勿無條件 force 全量 reindex**（debounce／dirty set） | S–M |
| **5** | `js/modules/slices/enterprise/team.js` | `enterpriseFetch`：區分 network vs HTTP 業務錯誤；`offline` 僅網路層；可選 online 後清除 sticky offline | S |
| **6** | `api-proxy.js` **或** `js/modules/core/constants.js` | **二選一優先**：A) document add/delete 後 server-side 觸發／佇列 RAG（單一真相）；B) 至少可配置 `RAG_SERVICE_URL` 與前端對齊。**P1 建議先做 B + 文件契約，完整 server sync 可進 P1.5** | M（B 較小／A 較大） |

**建議落地順序邏輯**：  
文件防呆 → 前端雙寫契約與 schema → health 停止製造二次不一致 → offline 語意修正 → 後端或設定層收斂真相源。

**刻意不進 P1 前 6 檔**：`api-proxy` 大拆分、`lib/*` 路由重構、lazy chunk 重切 — 屬 P2 架構，避免與雙軌止血打架。

---

## 驗收對照

| 交付 | 狀態 |
|------|------|
| 模組邊界（proxy 過重、slices/bundle、js/src 空） | 已標註 |
| 企業 vs RAG 雙軌不一致風險 | 已標註（A–G） |
| 錯誤／離線（banner、RAG 輪詢） | 已標註 |
| Top 5 實作風險 + 路徑 | 已標註 |
| P1 ≤6 檔 + 順序 | 已標註 |
| 程式碼變更 | **無** |

---

## 總體推薦（權衡）

| 方案 | 優點 | 代價 | 建議 |
|------|------|------|------|
| **P1 止血（上表）** | 改動面可控、直接對齊產品「文件=可被 AI 讀」承諾 | 暫不拆 `api-proxy` | **採用** |
| 立刻 server 原子雙寫 | 真相單一 | 需 RAG 可用性／重試／對帳，動關鍵 API | **P1.5** |
| 先大拆 `api-proxy` | 長期可維護 | 不先修雙軌，痛點仍在 | **延後** |

**工作量（客觀粗估）**  
- P1 六檔規格落地：約 **1.5–3 人日**（不含完整 server-side RAG 佇列）  
- 若含 `document/*` 伺服器觸發 RAG + 對帳：**+2–4 人日**，且須走 `@Backend Architect` + 關鍵 API 審查  

---

下一步若要進入實作，建議先固定產品契約一句話：

> **「Enterprise document 成功」是否允許 RAG 落後？落後時 UI 要顯示什麼狀態？**

契約一訂，P1 的 documents／client／proxy 邊界就不會來回改。需要的話我可以再出一版「對帳狀態機（pending_index / indexed / index_failed）」的純規格草稿（仍不寫 code）。