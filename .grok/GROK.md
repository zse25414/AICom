# Lumina AI — Grok 全域指令

> 本檔為專案層級 Agent 行為準則。Dashboard 獨立 Agent 定義見 `.grok/agents/`；Slash Skills 見 `.grok/skills/`。

## 產品定位

**Lumina AI（光流 AI）** 是個人與團隊生產力工具，核心能力包含：

- 目標分解、智能排程、AI 教練
- 團隊模式（群組、任務指派、完成追蹤）
- 團隊專屬 RAG 知識庫（上傳 → 切塊 → Embedding → 檢索 → 引用來源）

## 技術棧速查

| 層級 | 路徑 / 技術 |
|------|-------------|
| 前端頁面 | `lumina-ai.html` |
| 前端模組 | `js/modules/slices/**`（編輯此處；勿直接改會被覆寫的 bundle） |
| 前端打包 | `js/lumina-app.js`（`npm run build:app` 產生） |
| 樣式 | `css/lumina.css`、`css/tailwind-input.css` → `css/tailwind.build.css` |
| Node API | `api-proxy.js` + `lib/*`（:3001） |
| RAG 服務 | `rag_service/`（Python FastAPI :8000） |
| 腳本 / 測試 | `scripts/`、`test-*.js`、`check-*.js` |
| 維運 | `OPERATIONS.md` |

## 關鍵 API（變更前須評估）

以下端點涉及認證、資料隔離或 AI 成本，變更前須 **@Backend Architect** 評估 + **@Reviewer & Optimizer** 審查：

- `POST /api/auth/register`、`POST /api/auth/login`
- `GET|PUT|PATCH /api/user/data`
- `POST /api/chat`
- `POST /api/rag/*`、`GET /api/rag/*`
- `POST /api/enterprise/*`
- `GET /health`、`GET /ready`

## 常用命令

```bash
npm run dev              # 前端 :3456 + API :3001 + RAG :8000
npm run build            # Tailwind + 前端 bundle
npm test                 # build + smoke + security + unsafe + register
npm run test:enterprise  # 企業 API 整合
npm run test:coach-rag   # 教練知識庫 E2E（需服務運行）
npm run test:integration # 整合測試（需 API）
```

## 通用鐵律

1. **繁體中文**回覆使用者；程式碼、註解、commit message 用英文
2. **最小改動**：只改任務需要的檔案，不順手重構
3. **前端編輯** `js/modules/slices/` 與 `js/modules/core/`，不要手改 `js/lumina-app.js` / `js/modules/generated/*` 的業務邏輯
4. **安全預設**：JWT、群組隔離、`RAG_API_KEY`、速率限制不可弱化
5. **驗證有證據**：宣稱完成前須有實際 build/test 輸出
6. **獨立 Agent Session**：複雜跨模組任務委派 Dashboard Agent，不使用內部 `spawn_subagent` 取代

## 目錄對照

| 路徑 | 用途 |
|------|------|
| `.grok/GROK.md` | 本檔：全域指令 |
| `.grok/agents/` | Dashboard / CLI Agent 定義（`grok --agent <name>`） |
| `.grok/skills/` | Slash Skills（`/orchestrator`、`/impl` 等） |
| `.grok/commands/` | 扁平 Slash 指令（與 Skills 互補） |
| `.grok/instructions/` | UI 風格指南 |
| `AGENTS.md` | 多 Agent 協作與 @ 委派規則 |
| `scripts/rebuild_agents.ps1` | 重建 Agent Session 說明與檢查 |
