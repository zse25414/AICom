# 事故 Runbook（精簡）

## 1. 登入失敗／一直 429

1. `GET http://127.0.0.1:3001/ready`  
2. 確認 auth 路徑不吃全域 rate limit（歷史 bug）  
3. 清瀏覽器 localStorage 中錯誤 session 後重試  
4. 查 API log：PIN lock／弱密鑰  

## 2. 教練無回應／永遠「思考中」

1. 設定：API 是否啟用、proxy URL  
2. Console：`getAnalyticsSummary()` 是否有 `coach_error`  
3. 用量是否額滿：設定 → AI 用量；可開試點 Pro  
4. Network：`/api/chat` 或 RAG `/api/rag/query`  
5. Chunk：console 是否 `Failed to load coach chunk` → 硬重新整理  

## 3. RAG 未就緒

1. `npm run rag:setup` 後 `npm run rag`  
2. `GET /ready` 看 rag.ok  
3. 文件索引 failed → 團隊知識庫重試  
4. 無命中：換庫、上傳、@庫名  

## 4. 團隊退不出／看到別人的群

1. 確認已登入同一帳號  
2. leave 後 memberships 應為空且不從舊 LS 回灌  
3. 換帳號應清 enterprise session  

## 5. 部署後畫面舊／功能怪

1. Ctrl+F5／清 SW cache  
2. 確認 `npm run build` 產物已部署  
3. 查 bundle size CI 是否綠  

## 6. 使用者回報／試點客訴

1. 請對方在產品內：**設定 → 說明與回報 → 回報問題**  
2. 複製全文（含診斷摘要）貼到工單或寄 on-call  
3. 對照本文件第 1–5 節分類處理  
4. 本機歷史：瀏覽器 `localStorage.lumina_support_reports_v1`（僅用戶端）

## 聯絡資訊（部署時填寫）

| 欄位 | 值 | 說明 |
|------|-----|------|
| 工程 On-call | （填寫姓名／輪值表 URL） | 事故與 P0 |
| On-call 郵件 | 設 `window.__LUMINA_SUPPORT_EMAIL__` 或改 `getSupportContactEmail()` 預設 | 產品「開郵件」收件人 |
| 試點客戶窗口 | （填寫） | 商務／成功經理 |
| 狀態頁／群組 | （填寫 Slack／Discord） | 對外公告 |

環境建議（文件化，非強制 env）：

- `LUMINA_SUPPORT_EMAIL` — 部署說明用，前端可注入為 `window.__LUMINA_SUPPORT_EMAIL__`
- `LUMINA_ONCALL_URL` — 輪值表或 PagerDuty  

