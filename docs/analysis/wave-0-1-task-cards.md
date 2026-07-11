# Wave 0 / Wave 1 — 已核准實作任務卡

| 項目 | 內容 |
|------|------|
| 核准日 | 2026-07-11 |
| 核准人 | 產品負責人（使用者） |
| 協調 | @Lumina Planner |
| 契約來源 | `docs/architecture/team-rag-api-gap-memo.md`、`docs/analysis/planner-synthesis-2026-07-11.md` |

---

## 已鎖定決策

| ID | 決策 | 狀態 |
|----|------|------|
| **W0** | 立刻執行安全 Wave 0 | ✅ 核准 |
| **D1** | RAG 寫入／刪除／KB 管理 = **manager only**；member 僅 list/query | ✅ 核准（對齊 TeamPlan） |
| **D2** | 允許 Enterprise 成功而 RAG 短暫落後；**UI 必須**顯示 `indexed` / `pending` / `failed`（禁止只顯示「已發布」） | ✅ 核准 |
| **W1-Ops** | Wave 1 含 README、`.env.example` 入庫、OPERATIONS、prod compose 對齊 | ✅ 核准 |
| **W2** | Wave 2（KB CRUD、tab、server 同步佇列、seed/backup、Mongo CI）排 **下一 sprint** | ✅ 核准排程 |

### 明確不做（本兩波）

- OCR / Word·MD 全格式 / 知識圖譜 / 自動摘要 / `@KB`
- 外部向量庫
- `api-proxy.js` 全量路由重構（允許最小抽離 RBAC／policy）
- Mongo collection 大拆
- Playwright 全站 E2E

---

## 執行順序

```
Wave 0（阻塞）→ @Reviewer 複審通過
    → Wave 1 並行：1A 後端 | 1B 前端 | 1C 維運
    → Wave 1D 測試（依賴 1A 行為；可先寫會紅的 case）
    → @Reviewer 抽樣 Wave 1
    → Planner 驗收 → 再開 Wave 2
```

---

# WAVE 0 — 安全緊急（必須先完成）

## 卡片 W0-CORE — @Core Coder

**優先級：** P0 Critical  
**預估：** 0.5–1 人日  
**關鍵 API：** `POST /api/rag/query`、`POST /api/chat`（限流共用邏輯）

### 必做

1. **`api_base` 金鑰外洩修復**（Reviewer #1）  
   - 位置：`api-proxy.js` 代理 `/api/rag/query` 注入伺服器 `DEEPSEEK_API_KEY` 時  
   - **強制** `api_base` 為 allowlist（至少 `https://api.deepseek.com`；可 env 擴充）  
   - 客戶端自帶 key 時：仍建議 allowlist；**禁止**「無客戶端 key + 任意 api_base + 伺服器 key」  
   - 同步檢查 `rag_service`：不可信 `api_base` 應被忽略或覆寫  
   - 前端若傳 `api_base`（`js/modules/slices/rag/client.js`）：不得再送惡意 base；或僅送允許值  

2. **AI 限流視窗**（Reviewer #2）  
   - `checkRateLimitBucket` 必須使用 `AI_RATE_LIMIT_WINDOW_MS`（設計為 1h、`AI_RATE_LIMIT_MAX=30`）  
   - 不得繼續誤用 `RATE_LIMIT_WINDOW_MS`（60s）套在 AI 桶  

### 驗收

- [ ] 已登入成員送 `api_base: https://evil.example` 且不帶 key → **不得**把 server key 打到 evil；應 400 或強制官方 base  
- [ ] AI 桶語意為約 30/小時/使用者（文件與 log 可驗證）  
- [ ] 不改 enterprise 業務語意；最小 diff  
- [ ] 回報 @Lumina Planner + 請 @Reviewer & Optimizer 複審  

### 禁止

- 大重構、拆檔除非為抽出 allowlist/rate-limit 小函式  
- 改 UI 文案（除非必須擋前端送 base）

---

## 卡片 W0-REV — @Reviewer & Optimizer

**優先級：** P0 閘道  
**預估：** 0.5 人日  
**依賴：** W0-CORE 完成  

### 必做

- 唯讀複審 W0 變更（`api-proxy.js`、必要時 `rag_engine.py` / rag client）  
- 確認 #1 Critical 關閉、#2 限流正確  
- 結論：`驗收通過` 或 `需要修改`（附具體位置）  

### 閘道

- **未通過不得開始依賴 W0 的 Wave 1 合併到 main 的宣稱完成**（本機可並行開發 1B/1C 文件，但後端關鍵路徑以複審為準）

---

# WAVE 1 — P0 可信閉環

## 卡片 W1-A — @Core Coder（後端契約）

**優先級：** P0  
**預估：** 2–3 人日  
**契約：** `docs/architecture/team-rag-api-gap-memo.md` §2–§4、§6.1、§7  
**依賴：** Wave 0 通過（可與 1B/1C 並行開發，合併順序 W0 先）

### 必做

1. **D1 RBAC**  
   - `POST /api/rag/document/upload`、`upload-text`、`delete`：**僅 group manager**  
   - member → **403** + 機器可讀 `code: ROLE_FORBIDDEN`（保留 `error` 字串）  
   - 非成員 → **403** `GROUP_FORBIDDEN`  
   - 無 JWT（產線）→ **401**  
   - query / kb list：member 可讀（維持）  

2. **錯誤 `code` 欄位**  
   - 至少：`ROLE_FORBIDDEN`、`GROUP_FORBIDDEN`、（可選）`UNAUTHORIZED`  

3. **刪除／索引一致性（最小）**  
   - enterprise `document/delete` 與 RAG delete 編排：軟刪或明確「刪 metadata 必嘗試清索引」  
   - 失敗時 metadata 或 `rag.status=failed` 可追蹤（對齊 D2）  
   - 避免「列表沒了、向量還在」無記錄  

4. **`rag.status` 契約（D2）**  
   - document metadata 支援：`pending` | `indexed` | `failed`（欄位名可 `rag.status` 或扁平 `ragStatus`，前後端一致）  
   - add/upload 成功 enterprise 後：初始 `pending`；RAG 成功 → `indexed`；失敗 → `failed`  

5. **citations（最小可用）**  
   - `POST /api/rag/query` 回應保留 `sources`，新增 `citations[]`：至少 `document_id`（能對上則填）、`title`/`filename`、`kb_id`、`score`；snippet 有則填  

### 驗收（給 QA）

- [ ] member upload-text/delete → 403 `ROLE_FORBIDDEN`  
- [ ] 他組 token → 403 `GROUP_FORBIDDEN`  
- [ ] 無 token → 401  
- [ ] manager 上傳後 document 有 `ragStatus`/`rag.status`  
- [ ] 刪除後 query 不得命中該內容（或 failed 可觀測 + 重試路徑）  
- [ ] query 含 `sources` + `citations`  

### 禁止

- 完整 KB CRUD UI/API（屬 Wave 2）  
- 完整 DocumentVersion 歷史（Wave 2+）  
- 在 rag_service 做 JWT／角色  

### 建議 PR

- PR-A：RBAC + error code  
- PR-C′：delete 編排 + rag.status  
- PR-D：citations normalize  

---

## 卡片 W1-B — @UI & UX Engineer + @Core Coder（前端）

**優先級：** P0  
**預估：** 1.5–2.5 人日  
**依賴：** D2 決策；後端 `ragStatus` 欄位就緒後接線（UI 可先 mock 狀態徽章）

### 必做（UI）

1. **P1-1** RAG 離線：不要整塊 hidden 選庫 → disabled + 說明；query 降級標「未使用知識庫」  
2. **P1-2** 來源：去掉誤導性「%」→ 高/中/低或條；chip 可開 snippet 或 fileUrl  
3. **P1-3** 文件卡徽章：`已發布 / 索引中 / 索引失敗` + 失敗重試；近 0 字 PDF 警告  
4. **P1-4** 選庫：加大 hit area；允許不勾選＝純教練；顯示「目前查：…」  

### 必做（前端邏輯，Core 或 UI 協作）

5. 離線 newDoc **必寫 `kbId`**  
6. RAG health：**禁止**硬編碼只信 `127.0.0.1:8000` 當唯一真相；優先 `/ready` 或可配置 API base  
7. 雙寫結果分流：enterprise OK + RAG fail → **failed** 狀態，不是單一成功 toast  

### 驗收

- [ ] 使用者能從 UI 區分「已存檔」與「可被教練檢索」  
- [ ] RAG 掛掉時教練仍可用且不誤導「有知識庫」  
- [ ] 只改介面層 + 必要 slices；不改 api-proxy 業務（除呼叫契約）  

### 禁止

- 獨立多 KB CRUD 管理頁（Wave 2）  
- `@KB` 語法  

---

## 卡片 W1-C — @Data & Automation

**優先級：** P0  
**預估：** 0.5–1.5 人日  
**可與 W0 完全並行**

### 必做

1. `.gitignore`：允許 `!.env.example`；**提交** `.env.example`  
2. 新增 root **`README.md`**：安裝、`npm run dev` / `dev:all`、`rag:setup`、Docker profile、生產 checklist、連結 OPERATIONS / AGENTS  
3. 更新 **`OPERATIONS.md`**：  
   - 前端 SoT = `js/modules/slices` + `manifest.json`（刪除／更正 `js/src`）  
   - 生產必填：`JWT_SECRET`、`PIN_SALT`、`RAG_API_KEY`、`DEEPSEEK_API_KEY`、`MONGODB_URI`、`ALLOWED_ORIGINS`  
   - `dev` vs `dev:all` 差異  
4. **`docker-compose.prod.yml`**：  
   - `MONGODB_URI` required  
   - API `uploads` volume  
   - web：`http-server` 可在 prod 使用（移 dependencies 或改啟動方式）  

### 驗收

- [ ] 乾淨 clone 可依 README 起 dev（有密鑰時）  
- [ ] 文件不再引導改 `js/src`  
- [ ] prod compose 不再「production 可無 Mongo」  

### 禁止

- Wave 2 的 seed/backup 大平台（可列 TODO）  
- 改業務 API 行為  

---

## 卡片 W1-D — @QA & Tester

**優先級：** P0  
**預估：** 1–2 人日  
**依賴：** W1-A 行為（可先寫 red tests）

### 必做（優先 case）

| ID | Case | 期望 |
|----|------|------|
| T1 | 無 JWT → `/api/rag/query`、`upload-text` | 401 |
| T2 | 跨群組 query / upload | 403 `GROUP_FORBIDDEN` |
| T3 | member RAG upload / delete | 403 `ROLE_FORBIDDEN` |
| T4 | 非成員 GET `/uploads/*` | 403/401 |
| T5 | manager 索引 → delete → query | 不得命中 |
| T6 | 弱 PIN create | 400 |
| T7 | 惡意 `api_base` + 無 client key | 不得外洩（400 或固定 base） |

### 交付

- 腳本進 `scripts/` 或擴充既有 `test-*.js`  
- CI `integration-test` 必跑上述（或子集 + 文件說明）  
- fixture：至少 manager + member 兩角色  

### 禁止

- 改生產業務邏輯繞過失敗  
- 只測 happy path  

---

## 卡片 W1-REV — @Reviewer & Optimizer

**優先級：** P0 收尾  
**依賴：** W1-A + W0 已合併意圖清楚  

### 必做

- 審查：RBAC、delete 一致性、rag.status、限流／allowlist 未回退  
- 最多 5 項高價值問題  
- 結論：`驗收通過` 或 `需要修改`  

---

# Wave 2 預告（已核准排程，本波不開工）

| 項 | 負責人 |
|----|--------|
| KB 一級 CRUD API | @Core Coder + 契約 @Backend Architect |
| 團隊知識庫 tab / 選庫空庫 | @UI & UX Engineer |
| Server-side RAG 同步佇列 | @Core Coder |
| seed-demo、backup、test_rag_flow+key、`--require-rag`、Mongo CI | @Data & Automation |
| 補 H6–H10 等 | @QA & Tester |
| 再審 | @Reviewer |

---

# 委派貼文（複製用）

## → Core Coder（先貼 Wave 0）

```
@Core Coder 執行 docs/analysis/wave-0-1-task-cards.md 卡片 W0-CORE。
決策：D1 manager only；D2 允許 RAG 落後+狀態。
完成後回報並請求 @Reviewer & Optimizer 複審 W0-REV。
不要做 Wave 1 大範圍 RBAC 以外的事直到 W0 通過（可另開分支並行，但先交付 W0）。
```

## → Reviewer（W0 後）

```
@Reviewer & Optimizer 執行卡片 W0-REV：複審 api_base allowlist 與 AI rate limit 修復。
只讀審查，結論驗收通過或需要修改。
```

## → 並行 Wave 1（W0 通過後或文件類可先）

```
@Data & Automation 執行 W1-C（README / env / OPERATIONS / prod compose）。
@UI & UX Engineer 執行 W1-B UI 項（狀態徽章可先前端 mock）。
@Core Coder 執行 W1-A（RBAC + rag.status + citations + 刪除編排）。
@QA & Tester 執行 W1-D（負向矩陣；W1-A 未合可先 red）。
```

## → Reviewer（Wave 1 收尾）

```
@Reviewer & Optimizer 執行 W1-REV。
```

## → Planner 彙整

```
@Lumina Planner 各卡完成後彙整驗收，決定是否開 Wave 2。
```

---

**Planner 狀態：** 決策已鎖定；任務卡已就緒。請依序在各 Agent Session 貼上「委派貼文」開工。
