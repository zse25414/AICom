# Lumina AI — 系統模組地圖

> 資深專案原則：**每個模組只擁有一類任務**；跨模組只透過公開介面；禁止再長出第二個「上帝檔」。

## 1. 執行時拓樸

```
Browser (:3456)
  lumina-ai.html + js/lumina-app.js (from slices)
        │
        ▼
Node API (:3001)  ← api-proxy.js → server/bootstrap
  routes/*  ──►  runtime-legacy / lib/*
        │
        ▼
Python RAG (:8000)  rag_service/main.py + rag_engine.py
```

| 進程 | 入口 | 職責 |
|------|------|------|
| Web | `npm run start` / `dev:all` | 靜態前端 |
| API | `node api-proxy.js` | 認證、用戶資料、企業、RAG 代理、LLM 代理 |
| RAG | `npm run rag` | 索引、檢索、摘要 |

---

## 2. 後端模組（`server/` + `lib/`）

### 2.1 擁有權表

| 模組 | 路徑 | 任務（只做這些） | 禁止 |
|------|------|------------------|------|
| **Config** | `server/config.js` | 環境變數、常數、生產密鑰檢查 | 路由、業務規則 |
| **App** | `server/app.js` | 組裝 `http.Server` | 寫業務 if/else |
| **Bootstrap** | `server/bootstrap.js` | init store + listen | 處理 HTTP body |
| **Auth routes** | `server/routes/auth.js` | `/api/auth/*` | 碰 enterprise store |
| **User-data routes** | `server/routes/user-data.js` | `/api/user/*` | 碰 RAG / 群組 |
| **Enterprise routes** | `server/routes/enterprise.js` | `/api/enterprise/*` | 碰個人 JWT 註冊 |
| **RAG routes** | `server/routes/rag.js` | `/api/rag/*` | 直接改 Mongo 使用者 |
| **Chat routes** | `server/routes/chat.js` | `POST /api/chat` | 持久化任務 |
| **Health routes** | `server/routes/health.js` | `/health` `/ready` `/api/ops/*` | 回傳密鑰 |
| **Uploads routes** | `server/routes/uploads.js` | `GET /uploads/*` | 公開目錄列出 |
| **Runtime (過渡)** | `server/runtime-legacy.js` | 尚未拆完的領域實作 | **禁止再堆新功能** |
| **Auth primitive** | `lib/auth.js` | JWT / password hash | HTTP |
| **Auth store** | `lib/auth-store.js` | 使用者 CRUD | 路由 |
| **Enterprise store** | `lib/enterprise-store.js` | 群組 JSON/Mongo | 路由 |
| **User-data store** | `lib/user-data-store.js` | 個人 payload | 路由 |
| **DB** | `lib/db.js` | Mongo 連線 | 業務 |
| **Write queue** | `lib/write-queue.js` | 原子寫檔 / 鎖 | 業務 |
| **Env** | `lib/env.js` | 載入 `.env` | — |

### 2.2 請求分派

目前 `createServer` 的控制流與拆分前 **1:1**（`dispatchRequest`），以保證行為不變。  
`server/routes/*` 是**擁有權邊界與後續拆分入口**：新端點必須落在對應 route 檔，不得寫回 `api-proxy.js`。

### 2.3 演進規則（Strangler）

1. **新端點** → 只加在 `server/routes/<domain>.js`（必要時抽 `server/domain/<x>.js`）。
2. **從 runtime-legacy 搬出** → 搬完刪對應函式；禁止雙寫。
3. **關鍵 API**（auth / user-data / chat / rag / enterprise / health）變更仍依 `AGENTS.md` 審查。
4. `api-proxy.js` 永遠保持薄入口（≤ 40 行）。

---

## 3. 前端模組（`js/modules/slices/`）

Source of truth：**只改 slices**，再 `npm run build`。

| 領域 | 路徑 | 任務 |
|------|------|------|
| **Boot** | `boot/init.js` | 啟動順序、onboarding 觸發 |
| **Bridge** | `bridge/actions.js` | `data-lumina-action` 委派 |
| **Auth** | `auth/index.js` | 登入 UI、session、同步 |
| **Tasks** | `tasks/*` | 任務 CRUD、專注、排程、評分 |
| **Coach** | `coach/*`（lazy） | 教練對話、拆解、方案 |
| **Enterprise** | `enterprise/*`（lazy + boot） | 團隊、文件 |
| **RAG** | `rag/*` | 健康檢查、KB 勾選、同步 |
| **Storage** | `storage/*` | 本機 / 雲端持久化 |
| **UI** | `ui/*` | 儀表板、導覽、onboarding、PWA |
| **Core state** | `js/modules/core/*` | 共用 store 分片 |
| **Manifest** | `slices/manifest.json` | core / lazy 清單 |

### Lazy 邊界

- **core**：首屏必備（今日、任務、導覽、auth）
- **lazy coach**：`coach` / `scheduler` 進頁才載
- **lazy enterprise-docs**：`team` 進頁才載

---

## 4. RAG 服務（`rag_service/`）

| 檔案 | 任務 |
|------|------|
| `main.py` | FastAPI 路由、auth header |
| `rag_engine.py` | 切塊、索引、檢索、融合 |
| `config.py` | 模型與路徑設定 |

API 的 `/api/rag/*` **只做代理與授權**，不實作向量檢索。

---

## 5. 新人開發指引

| 我想改… | 去這裡 |
|---------|--------|
| 登入／註冊 API | `server/routes/auth.js` + `lib/auth*.js` |
| 個人任務同步 | `server/routes/user-data.js` + `lib/user-data-store.js` |
| 團隊／文件 API | `server/routes/enterprise.js` + runtime enterprise handlers |
| 教練 UI | `js/modules/slices/coach/*` |
| 今日儀表板 | `js/modules/slices/ui/dashboard.js` + `tasks/*` |
| 新人引導 | `js/modules/slices/ui/onboarding.js` |
| RAG 檢索品質 | `rag_service/rag_engine.py` |

---

## 6. 驗收（模組化不破壞行為）

```bash
node --check server/runtime-legacy.js
npm run api                 # 或 npm run dev:all
curl http://127.0.0.1:3001/ready
npm run test:smoke
npm run test:security-api   # API 運行時
```
