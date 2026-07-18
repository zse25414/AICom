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
| **Enterprise routes** | `server/routes/enterprise.js` | `/api/enterprise/*`（含 memberships / leave / kick） | 碰個人 JWT 註冊 |
| **RAG routes** | `server/routes/rag.js` | `/api/rag/*` | 直接改 Mongo 使用者 |
| **Chat routes** | `server/routes/chat.js` | `POST /api/chat` | 持久化任務 |
| **Health routes** | `server/routes/health.js` | `/health` `/ready` `/api/ops/*` | 回傳密鑰 |
| **Uploads routes** | `server/routes/uploads.js` | `GET /uploads/*` | 公開目錄列出 |
| **Domain 組裝** | `server/domain/index.js` | 註冊所有領域到 `api` 物件 | 路由細節 |
| **Domain util** | `server/domain/util.js` | clampText / uid / parseQuery | HTTP |
| **Domain pin** | `server/domain/pin.js` | 主管 PIN | 路由 |
| **Domain rate-limit** | `server/domain/rate-limit.js` | 限流桶 | 業務授權 |
| **Domain llm** | `server/domain/llm.js` | chat body / api_base | 路由 |
| **Domain http** | `server/domain/http.js` | CORS / JSON / errors | 領域規則 |
| **Domain auth-mw** | `server/domain/auth-mw.js` | JWT require* | 寫 store |
| **Domain enterprise** | `server/domain/enterprise/*` | 群組、KB、文件領域 | 前端 |
| **Domain rag** | `server/domain/rag/ops.js` | RAG 代理與索引編排 | UI |
| **Domain handlers** | `server/domain/handlers/*` | HTTP 適配層 | 持久化細節 |
| **Runtime 相容層** | `server/runtime-legacy.js` | re-export `domain/` | **禁止再堆邏輯** |
| **Auth primitive** | `lib/auth.js` | JWT / password hash | HTTP |
| **Auth store** | `lib/auth-store.js` | 使用者 CRUD | 路由 |
| **Enterprise store** | `lib/enterprise-store.js` | 群組 JSON/Mongo | 路由 |
| **User-data store** | `lib/user-data-store.js` | 個人 payload | 路由 |
| **DB** | `lib/db.js` | Mongo 連線 | 業務 |
| **Write queue** | `lib/write-queue.js` | 原子寫檔 / 鎖 | 業務 |
| **Env** | `lib/env.js` | 載入 `.env` | — |

### 2.2 請求分派

`handlers/dispatch.js` 的 `dispatchRequest` 與歷史 `api-proxy` 控制流 **1:1**。  
跨域呼叫統一 `api.fn(...)`（`register(api)` 組裝模式）。  
`server/routes/*` 為路由擁有權表面；實作在 `server/domain/*`。

### 2.3 演進規則

1. **新端點** → `server/domain/handlers/<x>.js` + `server/routes/<x>.js` 註冊。
2. **新領域邏輯** → `server/domain/<area>.js`，在 `domain/index.js` 的 `order` 掛上。
3. **禁止** 寫回 `runtime-legacy.js` 或加長 `api-proxy.js`。
4. **關鍵 API** 變更仍依 `AGENTS.md` 審查。
5. `api-proxy.js` 永遠保持薄入口（≤ 40 行）。

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
