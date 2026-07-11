# 關鍵路徑唯讀風險審查報告

**範圍**：`api-proxy.js`（auth / enterprise 文件 / rag proxy / chat）、`lib/auth.js` + `lib/*-store.js`、`rag_service/main.py` + `rag_engine.py`  
**方法**：靜態閱讀，不改 code、不跑破壞性命令  
**基準**：Assume Breach、不信任客戶端；產線以 `docker-compose.prod.yml`（`REQUIRE_ENTERPRISE_AUTH=1`、密鑰強制）為對照

---

## 最多 5 項高價值問題

### 1. 伺服器 `DEEPSEEK_API_KEY` 可經客戶端 `api_base` 外洩

| 欄位 | 內容 |
|------|------|
| **位置** | `api-proxy.js` ~L1220–1224（`/api/rag/query`）；`rag_engine.py` `configure_llm` / `generate_answer`（`_llm_api_base`） |
| **類別** | 密鑰外洩 / 信任邊界 |
| **風險** | **Critical**。已登入且有群組成員身份的使用者可送：不帶 key + 自訂 `api_base: https://attacker/...`。Proxy 會注入伺服器 `API_KEY`，且 `body.api_base = body.api_base \|\| default` **保留攻擊者 endpoint**。RAG 以 `Authorization: Bearer <server-key>` 打到攻擊者 URL → **公司 DeepSeek key 外洩**。前端也會傳 `api_base`（`js/modules/slices/rag/client.js`），攻擊面真實存在。`/api/chat` 則固定打 DeepSeek，無此洞。 |
| **建議** | ① 注入伺服器 key 時**強制** `api_base` 為 allowlist（僅 `api.deepseek.com` / 白名單）。② 客戶端自帶 key 才允許自訂 base（仍建議 allowlist）。③ RAG 端忽略或覆寫不可信 `api_base`。 |

---

### 2. AI 限流視窗名存實亡（成本放大）

| 欄位 | 內容 |
|------|------|
| **位置** | `api-proxy.js` L81–82、L166–175、L307–309；用於 `/api/chat`、`/api/rag/query` |
| **類別** | 濫用 / 成本控制 |
| **風險** | **High**。宣告 `AI_RATE_LIMIT_WINDOW_MS = 1h`、`AI_RATE_LIMIT_MAX = 30`，但 `checkRateLimitBucket` **一律用** `RATE_LIMIT_WINDOW_MS`（60s）。實際約 **30 次/分鐘/使用者**，非 30 次/小時。再加全域 120/min，內部若帳號被盜或腳本狂打，帳單風險明顯高於設計意圖。 |
| **建議** | `checkRateLimitBucket` 接受 `windowMs`；AI 桶改用 `AI_RATE_LIMIT_WINDOW_MS`。產線可再加 per-user daily budget。 |

---

### 3. 非生產預設：`memberId` 近乎能力憑證（團隊隔離薄弱）

| 欄位 | 內容 |
|------|------|
| **位置** | `api-proxy.js` `assertEnterpriseMember`（L388–421）、enterprise 文件/任務/群組讀取 |
| **類別** | 授權 / 多租戶隔離 |
| **風險** | **High（dev/staging）；產線 docker 已緩解**。`REQUIRE_ENTERPRISE_AUTH` 僅在 `IS_PRODUCTION` 或 env=1 時開啟。關閉時：成員若尚未綁 `userId`，**只要知道 `memberId` 即可**讀群組、扮主管加刪文件、指派任務。`memberId` 為 8 bytes hex，不可暴力猜，但常落在 localStorage / 分享 / 日誌。`group/create|join` 可不帶 JWT。產線 `docker-compose.prod.yml` 有 `REQUIRE_ENTERPRISE_AUTH=1`，邏輯正確。 |
| **建議** | Staging 也開 `REQUIRE_ENTERPRISE_AUTH=1`。長期：敏感操作一律 JWT；`memberId` 僅作 UX，不作唯一身分。未綁定成員禁止敏感寫入。 |

---

### 4. RAG 寫入/刪除 RBAC 與企業文件不一致；服務端僅 API Key + `group_code`

| 欄位 | 內容 |
|------|------|
| **位置** | Proxy：`/api/rag/document/upload*`、`delete`（`assertRagGroupAccess` 即可）；Enterprise：`document/add|delete` 需 manager。RAG：`main.py` 中介層僅驗 `X-RAG-API-Key`，無使用者/角色。 |
| **類別** | 授權 / 橫向越權 |
| **風險** | **High（資料完整性）**。企業「文件 metadata」僅主管可改，但**任一群組成員**可對同一 `group_code` 索引、覆寫、刪除 KB。RAG 服務本身信任「持有 key 的呼叫端」：key 外洩或內網誤暴露時，可遍歷任意 `group_code` 讀寫索引。Docker 以 `expose` 不映射 host port 是正確的，**依賴網路拓撲**。 |
| **建議** | Upload/delete 對齊 manager（或獨立 `kb_admin`）。RAG 僅 loopback / 內網 + 強 `RAG_API_KEY`。可選：proxy 覆寫 body 的 `group_code` 為已授權值，避免參數竄改。 |

---

### 5. 檔案型 store 無鎖 RMW（多寫入者資料遺失）

| 欄位 | 內容 |
|------|------|
| **位置** | `lib/enterprise-store.js`、`auth-store.js`、`user-data-store.js`：`load` → 改記憶體 → `writeFileSync` / Mongo `replaceOne` 整份 `groups` |
| **類別** | 完整性 / 可用性 |
| **風險** | **Medium–High（多使用者並行）**。JSON 模式兩請求交錯可互相覆寫（任務、文件、成員）。Mongo 整 document `replaceOne` 同樣是 last-write-wins。內部 2–3 人偶發可接受；並行指派/同步會出現「幽靈還原」。 |
| **建議** | 內部 MVP：Mongo + 操作級更新（或樂觀鎖 `version`）。檔案模式加 mutex / 單寫者佇列。`user-data` 的 merge 已有時間戳，enterprise 宜比照。 |

---

## 結論

### **需要修改**（修完後可當 MVP 內部用）

| 優先 | 項目 | 是否必須 |
|------|------|----------|
| P0 | **#1 `api_base` + 伺服器 key 注入** | **必須修**（任何有 `DEEPSEEK_API_KEY` 的環境） |
| P0/P1 | **#2 AI 限流視窗未套用** | **強烈必須**（一上 chat/rag 計費就應修） |
| P1 | #3 Staging 強制 enterprise JWT | 內部可信可暫緩；對外/半公開 **必須** |
| P1 | #4 RAG 寫入角色 + 網路隔離 | 內部小團隊可暫緩；多角色/敏感 KB **必須** |
| P2 | #5 Store 並發 | 檔案後端、>少量並行時再修 |

**驗收條件（修 P0 後）**：  
- 不開 `ALLOW_ANONYMOUS_AI`  
- 內部仍建議 `REQUIRE_ENTERPRISE_AUTH=1`  
- RAG 不對公網、`RAG_API_KEY` 已設  
- JWT/PIN/RAG/DeepSeek 密鑰非預設  

則可標：**MVP 可內部用**。  
**未修 #1 前不建議**即使是內部環境掛真實 API key。

---

## 已有防護（簡述）

- 產線 `enforceProductionSecrets`（JWT / PIN_SALT / RAG / DeepSeek）
- Auth：bcrypt、登入限流、Mongo email unique index
- Chat：`sanitizeChatBody`、固定 DeepSeek URL、預設需 JWT
- Uploads：JWT + 群組成員對 `fileUrl` 檢查、路徑 basename
- RAG：`normalize_code` / `normalize_kb_id` 限制路徑字元；預設 `HOST=127.0.0.1`
- PIN：弱 PIN 拒絕、嘗試鎖定、bcrypt（含 legacy 升級）

---

## 效能關注

### 1. Embedding 冷啟動
- `rag_engine._build_local_embed_model` + startup `configure_embedding`：首次載入 HF `paraphrase-multilingual-MiniLM-L12-v2` 可達數十秒～數分鐘（CPU、磁碟）。
- Docker health `start_period: 60–90s` 合理，但首查/首索引仍可能再觸發載入。
- **建議**：預熱就緒探測（embedding 真的 encode 過一次再標 ready）；或產線改 API embedding 避開本機模型。

### 2. BM25 全掃
- `retrieve_pure_python_bm25`：每次 query 對 **docstore 全部節點** tokenize、算 DF/TF；`tokens.count` 使單 query 偏 O(N·|q|·L)。
- 文件/chunk 變多後，hybrid 中 BM25 會變成延遲主因；向量路相對固定 top_k。
- **建議**：索引時快取 token/tf；或限制 BM25 候選集；chunk 增長後評估專業檢索引擎。

### 3. 單檔 `api-proxy.js`（~1400 行）
- Auth / enterprise / RAG proxy / chat / upload / 限流全在一 process：CPU 密集 RAG 代理與 JSON RMW 會互相搶事件迴圈；故障域大、審查成本高。
- **建議**：路由拆模組不必立刻；先把限流/金鑰策略抽成明確 policy。中期：AI 與 enterprise 分離 process 或 queue，避免慢 RAG 拖垮 auth。

---

## 攻擊面一覽（精簡）

```
[Client] --JWT--> [api-proxy :3001] --X-RAG-API-Key--> [rag :8000 內網]
                      |                                      |
                 DEEPSEEK key                           僅 group_code 隔離
                 enterprise store                        無 user RBAC
```

最值錢的下一步：**鎖死 `api_base` allowlist，並修正 AI rate-limit 視窗**；其餘可依暴露程度排程。  

（本報告為唯讀審查，未修改任何程式碼。）