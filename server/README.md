# Server 模組（API :3001）

每個模組只做一件事。跨模組只透過 export；`runtime-legacy.js` 只允許搬出、禁止堆新功能。

| 模組 | 任務 |
|------|------|
| `config.js` | 環境常數、生產密鑰檢查 |
| `app.js` | 組裝 HTTP Server |
| `bootstrap.js` | 初始化 DB/store 後 listen |
| `routes/auth` | `/api/auth/*` 註冊登入 |
| `routes/user-data` | `/api/user/*` 個人資料同步 |
| `routes/enterprise` | `/api/enterprise/*` 團隊 |
| `routes/rag` | `/api/rag/*` 知識庫代理 |
| `routes/chat` | `POST /api/chat` LLM |
| `routes/health` | `/health` `/ready` ops |
| `routes/uploads` | `/uploads/*` 檔案 |
| `runtime-legacy.js` | 過渡期領域實作（逐步拆出） |
| `../lib/*` | 持久化與 JWT primitive |

詳見 `docs/architecture/MODULES.md`。
