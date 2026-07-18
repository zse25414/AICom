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
| `domain/*` | 純領域 + handlers（各有任務） |
| `runtime-legacy.js` | 相容 re-export → `domain/` |
| `../lib/*` | 持久化與 JWT primitive |

領域細節：`server/domain/README.md`  
系統地圖：`docs/architecture/MODULES.md`。
