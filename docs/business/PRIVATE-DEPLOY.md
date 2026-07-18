# 私有部署 Checklist（企業／試點）

適用：客戶要求資料不出境、或需內網 RAG。

## 最低架構

```
[ 瀏覽器 ] → [ 靜態前端 :3456 或 CDN ]
           → [ Node API :3001 ]
           → [ Python RAG :8000 ]
           → [ 可選 MongoDB ]
```

## 必備環境變數

| 變數 | 說明 |
|------|------|
| `JWT_SECRET` | 長隨機，禁止預設 |
| `PIN_SALT` | 企業 PIN |
| `DEEPSEEK_API_KEY` 或內網 LLM | 聊天／教練 |
| `RAG_API_KEY` | API↔RAG |
| `ALLOWED_ORIGINS` | 前端 origin |
| `NODE_ENV=production` | 強制密鑰檢查 |
| `MONGODB_URI` | 生產建議；否則明確接受檔案 store 風險 |

見 root `README.md` 生產 checklist、`OPERATIONS.md`。

## 部署步驟（摘要）

1. `docker compose -f docker-compose.prod.yml --profile full up -d`（或等價 K8s）  
2. 掛 volume：uploads、RAG storage、Mongo data  
3. `GET /health`、`GET /ready` 綠  
4. 建立第一個管理員帳號與團隊  
5. 上傳 3 份 SOP → 索引成功  
6. 走主路徑 E2E：任務 → 教練 → 完成  

## 安全

- [ ] HTTPS 終止  
- [ ] 不把 JWT 放 URL query  
- [ ] 備份腳本：`npm run backup:rag`  
- [ ] 日誌不含完整使用者訊息（若合規要求）  
- [ ] 定期輪替 `JWT_SECRET` 的程序（需重新登入）  

## 支援邊界

私有部署含：安裝手冊、健康檢查、索引失敗排查（見 `docs/engineering/RUNBOOK.md`）。  
不含：客製模型訓練、無限制改 UI 白牌（另案報價）。  
