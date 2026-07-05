# Lumina 維運速查

## 啟動

```bash
npm install
cp .env.example .env   # 填入密鑰
npm run dev            # 前端 :3456、API :3001、RAG :8000（concurrently）
npm run dev:all        # 同上，並等待 /ready 後再開前端
docker compose up      # Docker 啟動 web + api（RAG: --profile full）
```

僅 API：`npm run api`  
僅 RAG：`npm run rag`（跨平台；首次請先 `npm run rag:setup`）  
僅前端：`npm run start`（會先執行 build）

升級 RAG 向量檢索後請重新執行：`npm run rag:setup && npm run rag`

## 健康檢查

| 端點 | 用途 |
|------|------|
| `GET /health` | 服務資訊與儲存後端狀態 |
| `GET /ready` | 就緒探針（store + auth；RAG 為附加檢查） |

## 必要環境變數（生產）

- `JWT_SECRET` — JWT 簽章
- `PIN_SALT` — 主管 PIN 雜湊
- `RAG_API_KEY` — RAG 服務閘道
- `DEEPSEEK_API_KEY` — AI 代理

設定 `NODE_ENV=production` 或 `LUMINA_ENFORCE_SECRETS=1` 時，缺少上述任一項 API 會拒絕啟動。

## 安全預設

- `/api/chat`、`/api/rag/*` 需 JWT（開發可設 `ALLOW_ANONYMOUS_AI=1`）
- RAG 會驗證 `group_code` 成員資格
- 團隊敏感操作需 JWT + `memberId` 綁定（生產強制；可設 `REQUIRE_ENTERPRISE_AUTH=1`）
- `/uploads/*` 需 JWT，且僅群組成員可存取

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

## 建置

```bash
npm run build            # Tailwind + 合併 js/src → lumina-app.js
npm run build:app        # 僅合併前端模組
```

編輯前端請改 `js/src/`，勿直接改會被覆寫的 bundle 邏輯。