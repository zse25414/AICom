# Lumina AI — Multi-Agent 協作規則

> **產品與改善 backlog 統一入口：** 根目錄 [`PRODUCT-CONTEXT.md`](./PRODUCT-CONTEXT.md)（先讀再派工）。  
> Grok 專屬 Agent 團隊定義於 `.grok/` 目錄。詳見 `.grok/GROK.md`。

## 協調者（本 Session）

| @標記 | 角色 | 啟動方式 |
|-------|------|----------|
| @Lumina Planner | Senior TPM，任務拆解與彙整 | `grok --agent "Lumina Planner"` |

## 獨立 Agent 清單（請在對應 Session 中 @ 或切換後委派）

| @標記 | 角色 | 專長 | Agent 檔案 |
|-------|------|------|------------|
| @Backend Architect | 後端架構師 | API 設計、資料模型、RAG 介面契約 | `backend-architect.md` |
| @Core Coder | 資深全端開發 | `api-proxy.js`、`lib/`、`js/modules/` 實作 | `core-coder.md` |
| @UI & UX Engineer | UI/UX 資深工程師 | 介面設計、互動流程、HTML/CSS、教練/團隊 UX | `ui-ux-engineer.md` |
| @Data & Automation | 資料與自動化 | 批次處理、測試腳本、部署、線上驗證 | `data-automation.md` |
| @QA & Tester | 測試工程師 | 單元/整合測試、冒煙、回歸驗證 | `qa-tester.md` |
| @Reviewer & Optimizer | 審查與優化 | Code review、效能、安全、重構建議 | `reviewer-optimizer.md` |

## Skill / Slash 專家（同 Session 內調度）

| 指令 | 角色 | 用途 |
|------|------|------|
| `/orchestrator` | 總指揮 | 複雜任務拆解與驗收 |
| `/analyst` | 需求分析 | 坑點、方案、工作量（不實作） |
| `/impl` | 實作 | 邏輯落地 |
| `/ui` | UI | 介面層改動 |
| `/test` | 測試 | 只寫測試 |
| `/reviewer` | 審查 | 只讀審查報告 |
| `/security` | 安全 | 攻擊面與防護設計 |
| `/quickfix` | 快修 | <20 分鐘單點修復 |

## @ 標記使用方式

1. **委派任務**：在訊息開頭或任務描述使用 `@AgentName`，例如：
   - `@Backend Architect 設計 RAG 文件版本 API 契約`
   - `@Core Coder 實作 lib/auth-store.js 索引優化`
   - `@UI & UX Engineer 優化教練對話來源引用 UI`
2. **切換 Session**：在 Grok Dashboard 點選對應 Agent（或 `grok --agent "<name>"`），將完整任務貼上。
3. **禁止使用內部 Subagent**：複雜跨模組任務必須委派給上表獨立 Agent，不使用 `spawn_subagent` / Task 工具取代。
4. **彙整規則**：@Lumina Planner 等待各 Agent 完成後再彙整，不交叉混寫。

## 標準委派流程

```
@Backend Architect → 設計 / API 契約
@UI & UX Engineer  → 介面設計與實作（HTML/CSS/互動）
@Core Coder        → 業務邏輯與 API 整合（依架構交付物）
@Data & Automation → 腳本 / 部署 / 線上驗證
@QA & Tester       → 測試與回歸
@Reviewer & Optimizer → 審查（部署前必經）
@Lumina Planner    → 彙整與下一階段建議
```

## Grok 專屬配置目錄（`.grok/`）

| 路徑 | 用途 |
|------|------|
| `.grok/GROK.md` | Grok 全域指令（繁體中文） |
| `.grok/agents/` | Dashboard 獨立 Agent 定義（`grok --agent` 啟動） |
| `.grok/skills/` | Slash 指令 Skills（`/orchestrator`、`/impl` 等） |
| `.grok/commands/` | 扁平 Slash 指令（與 Skills 互補） |
| `.grok/instructions/` | UI 風格指南 |

重建 Agent Session：執行 `scripts/rebuild_agents.ps1`

## 關鍵 API 保護原則

以下端點為產品關鍵路徑，變更前須 @Backend Architect 評估 + @Reviewer & Optimizer 審查：

- `POST /api/auth/register`、`POST /api/auth/login`
- `GET|PUT|PATCH /api/user/data`
- `POST /api/chat`
- `POST /api/rag/*`、`GET /api/rag/*`
- `POST /api/enterprise/*`
- `GET /health`、`GET /ready`
