# Lumina AI — AI 工具快速上下文

> **給 Cursor / Claude / Grok / Codex 等 AI 助手：先讀本檔再改程式。**  
> 更新原則：產品行為或優先 backlog 變了就改這裡；細節再連到下方「深讀」。  
> 最後對齊程式現況：約 2026-07（以 repo 為準，歷史 `docs/analysis/*` 僅作參考）。

---

## 1. 產品是什麼（30 秒）

**Lumina AI（光流）**：個人／小團隊生產力工具。  
核心不是「再多一個聊天窗」，而是：

> **用（可選的）團隊知識庫，一步一步帶你做完今天最重要的一件事。**

| 主路徑 | 說明 |
|--------|------|
| 今日 | 排序「今日第一步」→ 專注／完成閉環 |
| 教練 | 步驟引導、卡住拆解、選項點選、可附檔 |
| 知識庫 | 團隊 RAG；**預設純教練**，勾選庫或 @庫名才查 |
| 任務 | 可綁 KB／文件；完成可 Undo；可拆 Part |

商業一頁紙：`docs/business/ONE-PAGER.md`  
試點：`docs/business/PILOT-PLAYBOOK.md`

---

## 2. 技術架構（必知）

```
瀏覽器靜態頁 :3456          Node API :3001              Python RAG :8000
lumina-ai.html          →   api-proxy.js / server/   →   rag_service/
js/modules/slices/* ──build──► js/lumina-app.js + chunks
```

| 層 | 路徑 | 注意 |
|----|------|------|
| **前端 SoT** | `js/modules/slices/*` + `manifest.json` | 改完 **必** `npm run build` |
| **禁止手改** | `js/lumina-app.js`、`js/modules/generated/*`、`js/chunks/*`、`js/src/`（廢棄） | 會被覆寫 |
| **狀態** | `globalThis.__LUMINA_STORE__`（`S`） | 契約：`docs/engineering/STATE-CONTRACT.md` |
| **Auth / 使用者資料** | `lib/auth-store.js`、`POST /api/auth/*`、`/api/user/data` | 關鍵路徑 |
| **企業／團隊** | `lib/enterprise-store.js`、`/api/enterprise/*` | 群組隔離 |
| **RAG** | `rag_service/`、經 API proxy 的 `/api/rag/*` | 需 `X-RAG-API-Key` 等 |

本機：`npm run dev:all` → 前端 http://127.0.0.1:3456/lumina-ai.html  
就緒：`GET :3001/ready`（`npm run test:ready`）

**前端鐵律（CLAUDE.md / AGENTS.md）**  
- 大檔勿整檔讀：`api-proxy.js`、`lumina-ai.html` 等 → Grep 定位再分段讀  
- 關鍵 API 變更前評估：auth、user/data、chat、rag、enterprise、health/ready  

---

## 3. 核心產品行為（避免改壞）

### 3.1 教練

- 無任務 = 自由問答（freeform）；有任務可「帶我做」引導步驟。  
- 回覆要有可執行步驟 + `[選項: …]`。  
- **無 API Key** 仍可用離線規則教練。  
- Key：預設 session；可選「本機記住」。嚮導：`coach/keywizard.js`。  
- 附件：`coach/attachments.js`（圖壓縮、文字摘錄、任務綁定）。  

### 3.2 RAG 與團隊

- **加入團隊 ≠ 強制 RAG**。`S.checkedRagKbs` **預設 `[]` = 純教練**。  
- 勾選知識庫或 `@庫名` / 任務綁定才查庫。  
- 自由問答 + 有 citations → 可直接 RAG 答；**引導任務** → RAG 當摘錄、仍由教練帶做。  
- 頂欄「知識庫」可開面板；有 **「純教練」** 芯片。  

### 3.3 任務

- 今日佇列、完成 Undo、splitTask 時長重分配、會議後待辦等。  

---

## 4. 現況完成度（粗估）

| 面向 | 狀態 | 說明 |
|------|------|------|
| 個人主路徑 | 強 | 建任務 → 教練 → 完成；E2E / dogfood 文件有 |
| 教練 UX | 中上 | Grok 風對話、離線、附件、Key 嚮導 |
| 團隊 + RAG | 中 | 有上傳／查詢／隔離；信任與雙寫仍有債 |
| 工程可維運 | 中上 | 測試、SLO、runbook、bundle gate |
| 商業／金流 | 弱 | 用量本機統計有；**付費閉環未做** |
| 文件入口 | 改善中 | 本檔即為 AI 統一入口 |

---

## 5. 建議優先改善（Backlog）

> 實作時以**程式與使用者痛點**為準；下列依上線價值排序。金流可獨立排程。

### P0 — 上線／信任（阻斷或嚴重）

| ID | 項目 | 備註 |
|----|------|------|
| P0-金流 | 付費／配額升級真實閉環 | 先前刻意延後；產品變現關鍵 |
| P0-secret | 生產 secrets 不可用預設值 | **已做**：生產缺 secret 啟動即 exit 1；dev `/ready` 顯示 `details.secrets` 警告。HTTPS 仍待部署層 |
| P0-RAG信任 | 文件「已發布」vs「可被檢索」狀態一致 | **已做**：`POST /api/rag/reconcile`（manager）＋文件工具列「索引對帳」按鈕；伺服器每 60 分自動對帳（`RAG_RECONCILE_INTERVAL_MS`，只重排索引不清殘留）。E2E 驗證過 |
| P0-主路徑 | 新人 5 分鐘 dogfood 常綠 | `docs/engineering/DOGFOOD-5MIN.md` |

### P1 — 實用／黏著

| ID | 項目 |
|----|------|
| P1-RAG-UX | 知識庫選取可發現、純教練預設（**近期已修一輪**，持續驗證） |
| P1-附件雲端 | 教練附件可選上傳伺服器／進知識庫（**已做**：附件背景上雲 `/api/user/attachment` 僅本人可讀、自由對話 thread 隨 user/data 跨裝置同步（tombstone 防復活）、manager 可把附件存入知識庫） |
| P1-任務 | 完成→下一項、會議→待辦、虛擬列表大清單 |
| P1-安全 | 來源檔勿 `?token=` 進 URL（**已做**：documents 列表改 Bearer fetch → blob，比照教練來源開啟） |
| P1-評測 | `npm run test:rag-golden` 當回歸門檻（**已做**：CI 獨立 `rag-golden` job，走無 LLM key 的檢索摘要 fallback） |

### P2 — 打磨

| ID | 項目 |
|----|------|
| P2-modal | 危險操作 App modal（**已做**） |
| P2-對話持久 | 自由教練 thread localStorage（**已做**） |
| P2-SW | shell network-first + 更新橫幅（**已做**） |
| P2-確認 | 持續清掉殘留 UX 債 |

### 已知技術債（勿當現行規格）

- `docs/analysis/*`：2026-07 波次分析，**歷史**，查現況以程式為準。  
- `TeamPlan.md`：早期願景／RAG 規格，**部分已過時**（例如「單一 HTML + localStorage」已非全貌）。  
- `api-proxy.js` 體量大；部分邏輯在 `server/`、`lib/`。  
- 生產 Mongo 路徑與 JSON 降級行為不同，部署前讀 `OPERATIONS.md`。  

---

## 6. 常用命令

```bash
npm run dev:all          # 全服務
npm run build            # 前端建置（改 slices 後必跑）
npm test                 # 離線可跑的契約／smoke
npm run test:e2e         # 主路徑 jsdom
npm run test:e2e-team    # 團隊 API（需 :3001）
npm run test:rag-golden  # RAG 黃金題（需 API+RAG）
npm run test:ready       # /ready
```

---

## 7. 檔案地圖（改哪裡）

| 想改… | 優先看 |
|--------|--------|
| 教練對話／選項／RAG 何時介入 | `js/modules/slices/coach/agent.js` |
| 知識庫勾選 UI | `js/modules/slices/rag/health.js`、`lumina-ai.html` 教練區 |
| 附件 | `js/modules/slices/coach/attachments.js` |
| 任務完成／拆分 | `js/modules/slices/tasks/*` |
| 團隊文件上傳 | `js/modules/slices/enterprise/documents.js` |
| API Key 儲存 | `js/modules/slices/storage/api.js` |
| 設計 token／教練 CSS | `css/lumina.css`、`docs/UI-COACH.md` |
| 多 Agent 派工（Grok） | `AGENTS.md`、`.grok/` |
| Claude Code 派工 | `CLAUDE.md`、`docs/claude/*` |

---

## 8. 深讀索引（按需，不要一次全載）

| 需求 | 檔案 |
|------|------|
| 商業定位 | `docs/business/ONE-PAGER.md` |
| 維運／部署 | `OPERATIONS.md`、`docs/business/PRIVATE-DEPLOY.md` |
| 前端模組 | `docs/architecture/MODULES.md`、`js/modules/slices/README.md` |
| 狀態契約 | `docs/engineering/STATE-CONTRACT.md` |
| 事故 | `docs/engineering/RUNBOOK.md` |
| SLO | `docs/engineering/SLO.md` |
| 階段路線 | `docs/roadmap/PHASE-*.md` |
| 差異化創新選單（活的 SOP、執行畫像、Agentic、內容對帳、本地 LLM） | `docs/roadmap/INNOVATION-TRACKS.md` |
| 5 分鐘 dogfood | `docs/engineering/DOGFOOD-5MIN.md` |
| 團隊 dogfood | `docs/engineering/DOGFOOD-TEAM.md` |
| 人類 README | `README.md` |

---

## 9. 對 AI 的工作約定（摘要）

1. **先理解主路徑**：建任務 → 教練帶做 → 勾選完成；改動勿打斷此閉環。  
2. **只改 slices + 必要 HTML/CSS/API**，改完 build + 相關 test。  
3. **不要發明金流**除非任務明確要求。  
4. **RAG 預設可關**；不要再做成「進團隊就只能查庫」。  
5. **宣稱完成前**：`npm test`（或任務指定的 integration／rag 測）。  
6. 發現新的產品債：補一筆到本檔 **§5**，不要只寫在對話裡。  

---

## 10. 一句話給新 Session

你正在維護 **Lumina AI**：執行閉環生產力 + 可選團隊 RAG。  
前端 SoT 在 `js/modules/slices/*`。  
產品與改善清單以 **本檔** 為準；細節再下鑽 `docs/` 與程式。
