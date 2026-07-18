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

## 聯絡資訊

- 工程 On-call：（填寫）  
- 試點客戶窗口：（填寫）  
