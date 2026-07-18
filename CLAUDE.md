# Lumina AI — Claude Code 工作守則

個人／企業生產力 + RAG 知識庫應用。三個服務：前端靜態頁（:3456）+ Node API `api-proxy.js`（:3001）+ Python RAG `rag_service/`（:8000）。

> **產品與改善 backlog：** 根目錄 [`PRODUCT-CONTEXT.md`](./PRODUCT-CONTEXT.md)（新 session 先讀）。  
> **`AGENTS.md` 是 Grok CLI 專用文件，對 Claude Code session 一律不適用**（包括其中「禁止使用 Subagent」的規則）。Claude 的派工規則見 `docs/claude/MODEL-DISPATCH.md`。

## 鐵律（違反其一 = 這次改動作廢）

1. **前端只改 `js/modules/slices/*`**（含 `manifest.json`），改完必跑 `npm run build`。
   `js/lumina-app.js`、`js/modules/generated/*`、`js/chunks/*` 是建置產物，`js/src/` 已廢棄——都不准改。
2. **大檔案禁止整檔 Read**：`api-proxy.js`（3166 行）、`lumina-ai.html`（1708 行）、
   `package-lock.json`、`enterprise-data.json`、`user-data.json`、`auth-users.json`。
   先 Grep 定位行號，再 Read 帶 offset/limit（一次 ≤150 行）。跨檔搜尋派 `Explore` subagent。
3. **改關鍵 API 前先讀周邊再動手**：`/api/auth/*`、`/api/user/data`、`/api/chat`、`/api/rag/*`、
   `/api/enterprise/*`、`/health`、`/ready`。改完必跑對應測試（見下表）。
4. **宣稱完成前必過完成檢查**：見 `docs/claude/JUDGMENT.md` 的「何時算真的完成」。

## 常用命令與前置條件

| 目的 | 命令 | 前置條件 |
|------|------|----------|
| 全部起動 | `npm run dev:all` | `.env` 已設；首次先 `npm run rag:setup` |
| 僅 API | `npm run api` | — |
| 建置前端 | `npm run build` | 改過 slices 後必跑 |
| 基本測試 | `npm test` | 不需 API 運行 |
| 就緒檢查 | `node scripts/check-ready.js --wait` | API 已啟動 |
| 整合測試 | `npm run test:integration` | **API 必須已在運行**；部分案例需 RAG |
| 企業 API 測試 | `npm run test:enterprise` | **API 必須已在運行** |
| 教練 RAG E2E | `npm run test:coach-rag` | **API + RAG 必須已在運行** |

整合類測試失敗時，先確認是不是根本沒起服務（`curl http://127.0.0.1:3001/ready`），再懷疑程式。
完整維運細節（Docker、Mongo、環境變數、seed、備份）→ 讀 `OPERATIONS.md`。

## Shell 注意（Windows 11）

- 優先用 Bash tool 跑 POSIX 命令；PowerShell 是 5.1：**沒有 `&&`／`||`**（用 `;` 或 `if ($?)`），
  寫檔要 `-Encoding utf8`，**讀中文檔也要** `Get-Content -Encoding UTF8`（預設 ANSI 會亂碼且行數算錯）。
- 專案路徑含中文（`OneDrive\桌面`）且在 OneDrive 同步範圍：偶發檔案鎖定重試一次即可。

## 文件路由（按需讀取，不要全部預載）

| 情境 | 讀這份 |
|------|--------|
| 要派 subagent／選 model | `docs/claude/MODEL-DISPATCH.md` |
| 拿不準「完成了沒」「該不該問使用者」「要不要換方向」 | `docs/claude/JUDGMENT.md` |
| 要寫派工 prompt | `docs/claude/DELEGATION-TEMPLATES.md` |
| 要修改 CLAUDE.md 或 docs/claude/* 本身 | `docs/claude/MAINTENANCE.md`（**先讀再改**） |
| 想知道規則背後的原因 | `docs/claude/DIAGNOSIS.md` |
| 接手新 session、不確定環境有什麼坑 | `docs/claude/LETTER.md` |
| 維運／部署／測試細節 | `OPERATIONS.md` |
| 產品規格背景 | `TeamPlan.md`（歷史文件，以程式碼為準） |

`docs/analysis/` 是 2026-07 的歷史工作記錄，**不是現行規格**，查現況以程式碼為準。
