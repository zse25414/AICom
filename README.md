# Lumina AI

個人／企業生產力與 RAG 知識庫應用。前端靜態頁 + Node API proxy + Python RAG 服務。

## 快速開始（本機開發）

### 前置需求

- **Node.js** 20+
- **Python** 3.10+（RAG；首次需建 venv）
- DeepSeek API key（`/api/chat` 與 RAG 問答）

### 安裝與啟動

```bash
npm install
cp .env.example .env          # 填入 DEEPSEEK_API_KEY 等密鑰
npm run rag:setup             # 建立 RAG venv + 安裝依賴（首次必做）
npm run dev                   # 前端 :3456、API :3001、RAG :8000
```

| 指令 | 說明 |
|------|------|
| `npm run dev` | 並行啟動 web + api + rag（不保證 `/ready`） |
| `npm run dev:all` | 先起 api/rag，等 `/ready` 後再開前端（本機強制 JSON store） |
| `npm run api` | 僅 API（:3001） |
| `npm run rag` | 僅 RAG（:8000；需先 `rag:setup`） |
| `npm run start` | 僅前端靜態伺服（會先 `build`） |

瀏覽：<http://localhost:3456>  
健康檢查：`GET http://localhost:3001/health`、`GET http://localhost:3001/ready`

## Docker

```bash
# 開發：web + api（預設密鑰；無 RAG）
docker compose up

# 開發含 RAG
docker compose --profile full up

# 生產（見下方 checklist）
docker compose -f docker-compose.prod.yml --profile full up -d
```

> `docker compose up` **不含** RAG。需要知識庫時加 `--profile full`。

## 前端開發注意

| 項目 | 路徑 |
|------|------|
| **Source of truth** | `js/modules/slices/*` + `js/modules/slices/manifest.json` |
| 建置 | `npm run build:app` / `npm run build` |
| 產物（勿手改邏輯） | `js/lumina-app.js`、`js/modules/generated/*` |

請改 **slices**，不要改已廢棄的 `js/src/` 或直接改 bundle。

## 生產 checklist

部署前確認：

- [ ] `.env` 已設定且**未**提交到 git
- [ ] `JWT_SECRET`、`PIN_SALT`、`RAG_API_KEY`、`DEEPSEEK_API_KEY` 為長隨機／正式金鑰
- [ ] `MONGODB_URI` 已設定（生產禁止 JSON 降級；CI 見 job `integration-mongo`，本機 `npm run test:mongo`）
- [ ] `ALLOWED_ORIGINS` 為實際前端 origin（逗號分隔）
- [ ] `NODE_ENV=production`（或 `LUMINA_ENFORCE_SECRETS=1`）
- [ ] uploads／RAG storage 有持久化 volume
- [ ] `GET /health`、`GET /ready` 通過

詳見 [`OPERATIONS.md`](./OPERATIONS.md)。

## 測試

```bash
npm test                     # build + smoke + security + register
npm run test:ready           # GET /ready
npm run test:ready -- --require-rag   # 強制 RAG 就緒
npm run test:integration     # 需 API（與部分案例需 RAG）已運行
```

## Demo 資料與備份

```bash
npm run seed:demo            # 幂等：demo 用戶 + SEED01 群組 + 新人手冊（需 API；RAG 上傳需 rag）
npm run backup:rag           # 打包 rag_service/storage → backups/
npm run backup:rag -- --with-uploads
```

詳見 [`OPERATIONS.md`](./OPERATIONS.md)（seed 帳密、還原 tar、`--require-rag`、`test_rag_flow.py`）。

CI：`.github/workflows/ci.yml`

## 架構模組（資深邊界）

| 層 | 路徑 | 說明 |
|----|------|------|
| **API 入口** | `api-proxy.js` | 薄封裝 → `server/bootstrap` |
| **API 模組** | `server/routes/*` | 各領域 HTTP（auth / user / enterprise / rag / chat / health） |
| **API 領域（過渡）** | `server/runtime-legacy.js` | 尚未拆完的實作；禁止再堆新功能 |
| **持久化** | `lib/*` | auth / enterprise / user-data store、JWT、寫檔佇列 |
| **前端 slices** | `js/modules/slices/*` | 唯一前端 source of truth |
| **RAG** | `rag_service/` | Python 索引與檢索 |

完整地圖：[`docs/architecture/MODULES.md`](./docs/architecture/MODULES.md)  
Server 說明：[`server/README.md`](./server/README.md)  
前端 slices：[`js/modules/slices/README.md`](./js/modules/slices/README.md)

## 文件與協作

| 文件 | 用途 |
|------|------|
| [`docs/architecture/MODULES.md`](./docs/architecture/MODULES.md) | 系統模組擁有權與演進規則 |
| [`OPERATIONS.md`](./OPERATIONS.md) | 維運速查、環境變數、建置、測試 |
| [`AGENTS.md`](./AGENTS.md) | Multi-Agent 協作與關鍵 API 保護 |
| [`TeamPlan.md`](./TeamPlan.md) | 產品願景與規格 |
| [`docs/`](./docs/) | 架構備忘與階段分析 |

## 授權

Private — 內部專案。
