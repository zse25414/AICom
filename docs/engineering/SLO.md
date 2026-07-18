# Lumina 服務水準目標（SLO）

本機／單區部署的**工程目標**（非法律承諾）。試點期每週回顧一次。

## 可用性

| 指標 | 目標 | 量測 |
|------|------|------|
| `GET /health` | 99% 成功／月 | 外部 probe 或手動 |
| `GET /ready`（含 RAG profile） | 工作時間 99% | `npm run test:ready -- --wait` |
| 前端靜態可開 | 部署後 100% | CI build |

## 延遲（有 LLM 時）

| 指標 | 目標 | 備註 |
|------|------|------|
| 教練首 token／完整回覆 P95 | &lt; 12s | 依賴 DeepSeek／網路 |
| RAG query P95 | &lt; 8s | 冷索引另計 |
| 頁面切換（已載入 chunk） | &lt; 200ms 體感 | 本地 |

快取命中應 &lt; 100ms（本機 Map）。

## 正確性

| 指標 | 目標 |
|------|------|
| 主路徑 E2E | `npm test` 必綠 |
| 教練 UI 契約 | 無使用者氣泡直條、輸入單行預設 |
| 跨租戶讀檔 | security matrix 必綠（CI integration） |

## 錯誤預算

- 每月允許 **2 次** P0（登入全掛／資料錯租戶／主路徑完全不可用）  
- 超過則：**下一迭代凍結 feature，只修可靠度**

## 告警（建議）

| 條件 | 動作 |
|------|------|
| `/ready` 連續 3 次失敗 | 查 runbook：API／RAG |
| 日 AI 5xx 率 &gt; 10% | 查 DeepSeek key／配額 |
| 索引 failed 文件堆積 | 管理員重試 + 磁碟 |
