# Wave 3 — 可觀測（Observability）

| 項目 | 內容 |
|------|------|
| 日期 | 2026-07-11 |
| 狀態 | 已實作 |

## 目標

讓運維與使用者能看懂：**API/RAG 是否就緒、索引為何失敗、pending 何時結束**。

## 交付

### 後端
- `classifyRagError` → 穩定 `RAG_*` 錯誤碼 + `retryable`
- document.rag 寫入 `lastErrorCode` / `lastErrorCategory` / `retryable`
- 記憶體環：`recentIndexEvents`（最多 40）
- `GET /ready`：`details`、`uptimeSec`、`backgroundIndexJobs`
- `GET /health`：含 RAG probe
- `GET /api/ops/status`：ops 快照（無密鑰）
- `GET|POST /api/enterprise/group/document/status`：輪詢單文件狀態

### 前端
- 設定頁：ready 詳情 + 近期索引事件
- RAG 狀態點顯示 latency / errorCode
- 文件徽章顯示錯誤碼；pending **自動輪詢**（4s，最多 ~3 分）

### 測試 / 文件
- `npm run test:w3-obs`
- CI integration 步驟
- `OPERATIONS.md` 更新

## 驗證

```bash
npm run api
npm run test:w3-obs
curl -s http://127.0.0.1:3001/api/ops/status
```
