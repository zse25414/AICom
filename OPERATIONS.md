# Lumina 維運速查

## 啟動

```bash
npm install
cp .env.example .env   # 填入密鑰（範本已入庫；.env 勿提交）
npm run rag:setup      # 首次：RAG Python venv + 依賴
npm run dev            # 前端 :3456、API :3001、RAG :8000（concurrently，不等 /ready）
npm run dev:all        # 先 api+rag → 等 /ready → 再開前端（本機清空 MONGODB_URI，走 JSON store）
docker compose up      # Docker：web + api（無 RAG）
docker compose --profile full up   # 同上 + RAG
```

| 指令 | 行為差異 |
|------|----------|
| `npm run dev` | `predev` 建置後並行 web/api/rag；**不**輪詢就緒 |
| `npm run dev:all` | 等 API `/ready` 後才開前端；腳本會清掉 Mongo URI，永遠 JSON store |
| `docker compose up` | 開發映像 + 預設密鑰；**不含 RAG** |
| `docker compose --profile full up` | 含 RAG；storage bind `./rag_service/storage` |
| `docker compose -f docker-compose.prod.yml --profile full up` | 強制 secrets；Mongo／origins 必填；uploads + rag named volume |

僅 API：`npm run api`  
僅 RAG：`npm run rag`（跨平台；首次請先 `npm run rag:setup`）  
僅前端：`npm run start`（會先執行 build）

升級 RAG 向量檢索後請重新執行：`npm run rag:setup && npm run rag`

## 健康檢查

| 端點 | 用途 |
|------|------|
| `GET /health` | 服務資訊與儲存後端狀態 |
| `GET /ready` | 就緒探針（store + auth；RAG 為附加檢查） |

```bash
node scripts/check-ready.js                  # 單次（store + auth）
node scripts/check-ready.js --wait           # 輪詢直到就緒
node scripts/check-ready.js --require-rag    # RAG 未就緒則 exit 1
node scripts/check-ready.js --wait --require-rag
npm run test:ready -- --require-rag
```

`--require-rag`：`/ready` 的 `checks.rag` 必須為 true，否則非 0 exit（適合 CI／cron）。

## 必要環境變數（生產）

設定 `NODE_ENV=production` 或 `LUMINA_ENFORCE_SECRETS=1` 時，API 會拒絕缺少密鑰啟動。  
生產（`lib/db.js`）**必須** Mongo，禁止降級本機 JSON。

| 變數 | 說明 |
|------|------|
| `JWT_SECRET` | JWT 簽章 |
| `PIN_SALT` | 主管 PIN 雜湊 |
| `RAG_API_KEY` | RAG 服務閘道 |
| `DEEPSEEK_API_KEY` | AI 代理 |
| `MONGODB_URI` | 生產必填；未設則無法啟動 store |
| `ALLOWED_ORIGINS` | CORS 允許的前端 origin（逗號分隔）；prod compose 強制 |

建議一併：`REQUIRE_ENTERPRISE_AUTH=1`、`REQUIRE_MONGODB=1`、`RAG_SERVICE_URL`（Docker 內為 `http://rag:8000`）。

完整註解見 `.env.example`（開發預設 vs 生產必填兩段）。

## 安全預設

- `/api/chat`、`/api/rag/*` 需 JWT（開發可設 `ALLOW_ANONYMOUS_AI=1`）
- RAG 會驗證 `group_code` 成員資格
- 團隊敏感操作需 JWT + `memberId` 綁定（生產強制；可設 `REQUIRE_ENTERPRISE_AUTH=1`）
- `/uploads/*` 需 JWT，且僅群組成員可存取
- RAG proxy 對 client `api_base` 採 allowlist，避免金鑰外洩

## 測試與 CI

```bash
npm test                 # build + smoke + security + unsafe + register
npm run test:unsafe      # 檢查 JS 是否引用不存在的 DOM id
npm run test:ready       # 驗證 GET /ready（store + auth 就緒）
npm run test:enterprise  # 企業 API 整合測試
npm run test:coach-rag   # 教練知識庫問答 E2E
npm run test:integration # 上述 + register（需 API 運行）
node scripts/check-ready.js --wait   # 輪詢直到 API 就緒
CI=true npm run api &    # 背景啟動後
CI=true npm test         # HTTP 註冊測試不可 skip
```

前端設定頁與團隊頁會呼叫 `GET /ready` 顯示 API 就緒狀態（store / auth / RAG）。

GitHub Actions：`.github/workflows/ci.yml` 會 build、啟動 API、`/ready` 健康閘道、跑測試、再驗證 `/ready`。

## 建置（前端 Source of Truth）

```bash
npm run build            # Tailwind + lazy bundle（slices → 產物）
npm run build:app        # 僅合併前端模組（dev 全量）
npm run build:app:lazy   # lazy chunks（生產 build 使用）
```

| 項目 | 路徑 |
|------|------|
| **SoT（請改這裡）** | `js/modules/slices/*` + `js/modules/slices/manifest.json` |
| 建置腳本 | `scripts/build-app.js`、`scripts/build-app-lazy.js` |
| 產物（勿手改業務邏輯） | `js/lumina-app.js`、`js/modules/generated/*`、`js/chunks/*` |
| 廢棄 | `js/src/` — 勿再編輯；不會作為 bundle 真源 |

## 生產部署要點

```bash
# 於主機準備 .env（含 Mongo URI 與正式密鑰）後：
docker compose -f docker-compose.prod.yml --profile full up -d
```

- API：`uploads` 使用 named volume `uploads_data`（企業檔案持久化）
- RAG：storage 使用 named volume `rag_storage`
- `MONGODB_URI`、`ALLOWED_ORIGINS` 與四密鑰皆為 required（缺則 compose 拒絕啟動）
- web 使用 `http-server`（已列在 `dependencies`）；compose 以 `npm ci` 完整安裝以便 build（esbuild／tailwind）

## Demo Seed（幂等）

需 API 運行（知識庫上傳另需 RAG）。API 未起會 **exit 1** 並印出明確訊息。

```bash
npm run api          # 另開 terminal：npm run rag
npm run seed:demo    # 或 node scripts/seed-demo.js
```

| 項目 | 預設值（可用 env 覆寫） |
|------|------------------------|
| 帳號 | `demo@lumina.test`（`SEED_EMAIL`） |
| 密碼 | `demo-pass-1234`（`SEED_PASSWORD`） |
| 群組 | `SEED01`（`SEED_GROUP_CODE`） |
| 主管 PIN | `847293`（`SEED_MANAGER_PIN`） |
| 知識庫 | `general` + 固定「Lumina 新人手冊」文本 |

重複執行：用戶 409 → login；群組 409 → join；再 `upload-text`。

## RAG 索引備份

```bash
npm run backup:rag                     # 打包 rag_service/storage → backups/*.tar.gz
npm run backup:rag -- --with-uploads   # 一併打包 uploads/
node scripts/backup-rag-storage.js --no-compress   # 僅複製目錄
```

- 輸出目錄：`backups/`（已加入 `.gitignore`）
- 還原：`tar -xzf backups/rag-storage-YYYYMMDD-HHmmss.tar.gz -C .`
- Mongo：`mongodump`（依 `MONGODB_URI`；尚未包一鍵腳本）

## RAG 直連 smoke（Python）

需 RAG 服務在 :8000。若設定了 `RAG_API_KEY`，腳本會帶 `X-RAG-API-Key`：

```bash
# 於 repo root；可先載入 .env 中的 RAG_API_KEY
# PowerShell: $env:RAG_API_KEY="your-key"
cd rag_service
# Windows venv：
.\venv\Scripts\python.exe test_rag_flow.py
# 或系統 Python（需已安裝依賴）：
python test_rag_flow.py
```
