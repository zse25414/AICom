# 維運／部署／資料管線／CI 缺口分析（只分析）

## 1. 需求本質拆解

| 維度 | 核心目標 | 現況約束 |
|------|----------|----------|
| 啟動／環境 | 本機與生產可重現啟動 | `dev` / `dev:all` / Docker profiles 已存在，但生產強制項與範本有漂移 |
| RAG 生命週期 | setup → 索引 → 持久化 → 備份／遷移 | 僅有 `rag:setup` + 本機 `storage/`；無備份、無遷移、無 seed 契約 |
| CI | 關鍵路徑自動驗收 | 整合測覆蓋 auth／enterprise／coach-rag；漏 RAG 直測、Mongo、部分負向安全 |
| 文件 | 新人／維運可自助 onboarding | **無 root README**；`OPERATIONS.md` 部分過時；`.env.example` **未進 git** |

**隱含需求：** 可從乾淨 clone 走到「可跑 + 可驗 + 可還原資料」，且生產不會靜默降級或丟資料。

---

## 2. 維運缺口清單（按嚴重度）

### P0 — 會直接阻斷部署或 onboarding

| ID | 缺口 | 證據 | 影響 |
|----|------|------|------|
| **P0-1** | 生產強制 Mongo，但 compose 可空 | `lib/db.js`：`REQUIRE_MONGODB = IS_PRODUCTION`，無 `MONGODB_URI` 即 throw；`docker-compose.prod.yml` 卻是 `MONGODB_URI: ${MONGODB_URI:-}`（可空） | 設 `NODE_ENV=production` 卻未給 Mongo → API **直接拒絕啟動**；文件／compose 暗示「可選」 |
| **P0-2** | `.env.example` 未納入版本庫 | `.gitignore` 有 `.env.*`；`git ls-files` 無 `.env.example` | clone 後無範本；`OPERATIONS.md` 的 `cp .env.example .env` **對新人失效** |
| **P0-3** | 生產 web 用 `npm ci --omit=dev` + `npx http-server` | `http-server` 在 **devDependencies** | 生產 web container 可能找不到 `http-server` 而起不來 |
| **P0-4** | 生產 API 無持久 volume | prod compose 僅 `rag_storage`；`uploads/`、`*-data.json` 無掛載 | 若誤用 JSON 模式或未上 Mongo，重啟即丟企業／上傳資料；即使用 Mongo，**uploads 仍 ephemeral** |

### P1 — 健康／資料／CI 關鍵缺口

| ID | 缺口 | 證據 | 影響 |
|----|------|------|------|
| **P1-1** | CI 未跑 `rag_service/test_rag_flow.py` | `ci.yml` 僅 Node 整合測；無 `python -m … test_rag_flow` | RAG 直連契約（health／upload／retrieve）回歸靠手動 |
| **P1-2** | `test_rag_flow.py` 與 API Key 閘道不相容 | 中介層要求 `X-RAG-API-Key`；腳本 POST **無 key** | 只要設了 `RAG_API_KEY`（CI／prod 必設）腳本即 401；現況為「半廢腳本」 |
| **P1-3** | CI 就緒閘道不強制 RAG | `check-ready.js --wait` **無** `--require-rag`；`/ready` 的 `ready` 只看 store+auth | RAG 起不來時 CI 仍可能過（coach-rag 才會晚點爆） |
| **P1-4** | 負向安全覆蓋不足 | `test-security-api.js`：無 RAG 未授權、跨 group、錯 `X-RAG-API-Key`、uploads 跨租戶 | 關鍵路徑安全靠 code review，非自動化 |
| **P1-5** | Mongo 路徑零 CI | 無 Mongo service／無 `REQUIRE_MONGODB=1` 路徑測 | 生產主路徑未驗；僅 JSON 降級路徑有測 |
| **P1-6** | 無備份／遷移／seed 腳本 | `scripts/` 無 backup／seed／data-migrate；`storage/` 僅本機 demo 目錄且 gitignore | 無法還原索引、無法標準 demo 環境、升級 embedding 後無重索引 SOP |
| **P1-7** | 無定期健康巡檢自動化 | 僅 Docker healthcheck + 一次性 `check-ready`；無 cron／canary 腳本 | 線上靜默劣化（RAG embedding 掛掉、Mongo 慢）難及早發現 |
| **P1-8** | prod：API 不 `depends_on: rag` | rag 為 optional profile；API 不依賴 rag healthy | `--profile full` 時 API 可能先 healthy，RAG 仍 cold start 數十秒 |

### P2 — 文件／腳本漂移與體驗債

| ID | 缺口 | 證據 | 影響 |
|----|------|------|------|
| **P2-1** | **無 root `README.md`** | 倉庫根目錄僅 `OPERATIONS.md` / `AGENTS.md` / `TeamPlan.md` | onboarding 無「30 秒起跑」、無架構入口、無連結 CI／安全預設 |
| **P2-2** | `OPERATIONS.md` 建置路徑過時 | 寫「改 `js/src/`」；實際 bundle 來源為 `js/modules/slices` | 新人改錯目錄，build 被覆寫 |
| **P2-3** | `OPERATIONS.md` 測試描述偏舊 | `npm test` 實際含 `test-security-api`、bundle size；文件只寫 smoke+security+unsafe+register | 維運以為 CI 範圍較小 |
| **P2-4** | 生產必要變數文件不完整 | 文件列 JWT/PIN/RAG/DEEPSEEK；**未列** 生產實際必備的 `ALLOWED_ORIGINS`、`MONGODB_URI` | 部署 checklist 漏項 |
| **P2-5** | `.env.example` 與程式／compose 不一致 | 範本未標 `ALLOWED_ORIGINS` 為生產必填；未強調 production **必填 Mongo**；RAG 側 `RAG_PORT`/`RAG_HOST` 未文件化 | 環境對齊靠口頭 |
| **P2-6** | `dev` vs `dev:all` 差異未寫清 | `dev`=concurrently 三服務；`dev:all` 強制 `MONGODB_URI=''`、ready 逾時仍開前端 | 以為兩者等價；Mongo 本機行為不同 |
| **P2-7** | Docker profile 說明偏簡 | `full` 才有 RAG；prod 無 API↔RAG 健康依賴；dev 綁定本機 storage bind-mount | 誤以為 `docker compose up` 含完整 AI |
| **P2-8** | RAG 升級重索引僅一句話 | 「升級後 `rag:setup && rag`」— 未說明 storage 相容性、是否需清空索引 | 向量維度／模型變更後 silent bad retrieval |

---

## 3. 分項現況對照

### 3.1 啟動／環境

| 指令 | 行為 | 備註 |
|------|------|------|
| `npm run dev` | `predev` → build:dev；concurrently web:3456 + api:3001 + rag | 不保證 `/ready`；RAG 需先 `rag:setup` |
| `npm run dev:all` | api（**清空 Mongo URI**）+ rag → 等 `/ready` → web | 逾時仍開前端；永遠走 JSON store |
| `docker compose up` | web + api（dev 預設密鑰） | **無 RAG** |
| `docker compose --profile full up` | + rag，bind `./rag_service/storage` | 本機開發用 |
| `docker compose -f docker-compose.prod.yml --profile full up` | 強制 secrets；rag named volume | **P0 矛盾點見上** |

**生產強制項完整性：**

| 變數 | 程式 enforce | compose prod | `.env.example` | OPERATIONS |
|------|--------------|--------------|----------------|------------|
| `JWT_SECRET` | ✓ | ✓ required | 有（未進 git） | ✓ |
| `PIN_SALT` | ✓ | ✓ | 有 | ✓ |
| `RAG_API_KEY` | ✓（API+RAG） | ✓ | 有 | ✓ |
| `DEEPSEEK_API_KEY` | ✓ | ✓ API；**RAG 容器未注入**（靠 proxy 注入 body） | 有 | ✓ |
| `ALLOWED_ORIGINS` | 無 exit，但 prod compose required | ✓ | 有預設，未標 production 必填 | **缺** |
| `MONGODB_URI` | 生產 **必填** | 可空 | 註解為選用 | **缺／錯誤暗示** |
| `REQUIRE_ENTERPRISE_AUTH` | 生產等同開啟 | 強制 1 | 註解 | 有提 |
| `LUMINA_ENFORCE_SECRETS` | 等同 production | 強制 1 | 註解 | 有提 |

### 3.2 RAG 生命週期

```
rag:setup (venv+pip) → npm run rag (uvicorn)
        → storage/{GROUP}/{kb_id}/index/  (LlamaIndex 本機 JSON 向量)
        → （無）backup / export / reindex / migrate / seed
```

| 階段 | 現況 | 缺失 |
|------|------|------|
| Setup | `scripts/setup-rag.js` 跨平台 venv | 未 pin 重型 ML 版本鎖定策略；首次下載 model 慢，無 progress SOP |
| 本機 storage | gitignore；目錄結構 group/kb | 無大小／磁碟告警；demo 資料僅本機殘留 |
| 運行 | 預設 local embedding；prod 強制 API key | Docker rag **無 DEEPSEEK**（query 依賴 api-proxy 注入，合理但未文件化） |
| 備份 | 無 | 無 tar storage、無 Mongo dump、無 uploads 同步 |
| 遷移 | 僅前端 code migrate 腳本 | 無 group rename、無 embedding 模型升級 reindex、無 JSON→Mongo 匯入 |
| Seed | 無 | 無「建立 DEMO 群組 + 上傳手冊」一鍵腳本（CI coach-rag 自建臨時群組，非 seed） |

### 3.3 CI（`.github/workflows/ci.yml`）

| Job | 做了 | 沒做 |
|-----|------|------|
| `unit-test` | `npm ci` + `npm test`（build lazy、bundle size、init、security static、unsafe DOM、register 本地、security-api **local crypto**） | API 未起 → register HTTP 可 skip（非 CI 嚴格時）；**無** `SECURITY_HTTP_TESTS` |
| `integration-test` | 起 RAG + API；ready wait；auth / enterprise / security HTTP / coach-rag / integration；post ready | **`test_rag_flow.py`**；**`--require-rag`**；**Mongo**；RAG 錯 key／跨 group 負向；uploads 授權負向；Docker build 冒煙 |

**漏測對照（你點名的三項）：**

1. **`rag_service/test_rag_flow.py`** — 完全未進 CI；且現況不帶 API key，進 CI 也會紅。
2. **負向安全** — 僅有：無 token 401、query token、弱 PIN、user data 401、chat 401/500、安全標頭。缺：RAG 401、跨 `group_code` 403、錯誤 RAG key、uploads 非成員 403、企業 memberId 錯綁。
3. **Mongo 路徑** — 零覆蓋；`test-register.js` 還 **delete `MONGODB_URI`**，刻意避開 Mongo。

### 3.4 文件與腳本漂移

| 文件／腳本 | 狀態 |
|------------|------|
| **README** | **不存在** → 最大 onboarding 斷點 |
| **OPERATIONS.md** | 有用速查，但：build 路徑錯、env 不全、測試清單舊、無 Mongo／備份／Docker 陷阱 |
| **`.env.example`** | 本機有、**git 無**（`.env.*` 誤傷） |
| **TeamPlan.md** | 產品願景／規格，非維運手冊 |
| **docs/architecture/…** | 架構缺口，非 day-2 ops |
| **scripts** | 測／build／rag setup 齊；**缺** backup、seed、reindex、mongo-smoke、health-watch |

**缺 README 的具體影響：**

- 不知道先 Python 還是 Node、先 `rag:setup` 還是 `npm install`
- 不知道生產必須 Mongo + 四密鑰 + `ALLOWED_ORIGINS`
- 不知道前端改 `js/modules/slices` 而非舊 `js/src`
- 不知道 `docker compose up` **不含** RAG
- Agent／人類都只能翻散落 md 與原始碼

---

## 4. 優雅方案建議（不實作，只定方向）

### 原則

1. **單一真相來源：** 生產「必填 env 清單」只維護一處（建議 `.env.example` + 短表進 README），程式 enforce 與 compose 對齊。
2. **資料路徑二選一寫死：** 生產 = Mongo + 命名 volume（uploads／rag）；禁止「production + 無 volume JSON」的假路徑。
3. **CI 分層：** unit（無服務）→ integration-json（現有）→ integration-mongo（service container）→ rag-direct（修好 key 的 `test_rag_flow`）。
4. **Day-2 最小集：** health 輪詢、backup 一鍵、seed 一鍵 — 三支腳本勝過長文件。

### 建議腳本／文件更新清單

| 優先 | 類型 | 建議產物 | 用途 |
|------|------|----------|------|
| P0 | 設定 | 修正 `.gitignore`：`!.env.example`；提交範本 | onboarding 可複製 |
| P0 | 文件 | 新增 root **`README.md`**（安裝、dev、Docker、生產 checklist、連結 OPERATIONS） | 入口 |
| P0 | 文件 | 更新 **`OPERATIONS.md`**：Mongo 必填、`ALLOWED_ORIGINS`、前端路徑 `js/modules/slices`、`dev` vs `dev:all`、prod volume、測試完整清單 | 維運真相 |
| P0 | Compose | `docker-compose.prod.yml`：`MONGODB_URI` 改 `:?required`；API volume `uploads`；web 把 `http-server` 移 dependencies 或改 prod 映像；可選 `depends_on: rag` when profile full | 可部署 |
| P1 | 腳本 | `scripts/backup-rag-storage.js`（或 `.ps1/.sh`）打包 `rag_service/storage` + 可選 uploads | 備份 |
| P1 | 腳本 | `scripts/backup-mongo.sh` / `mongodump` wrapper（env 驅動） | DB 備份 |
| P1 | 腳本 | `scripts/seed-demo.js`：註冊 demo 用戶、建 DEMO 群組、upload-text 固定手冊 | 本機／staging 可重現 |
| P1 | 腳本 | `scripts/reindex-rag.md` 或 `rag:reindex`：清空／重建索引 SOP | embedding 升級 |
| P1 | 測試 | 修 `test_rag_flow.py` 讀 `RAG_API_KEY` header；CI 加 step | RAG 直測 |
| P1 | CI | `check-ready.js --wait --require-rag`；可選 `mongo:6` service + `REQUIRE_MONGODB=1` job | 閘道對齊生產 |
| P1 | 測試 | 擴 `test-security-api.js`：RAG 無 JWT、跨 group、錯 RAG key、upload 403 | 負向安全 |
| P1 | 腳本 | `scripts/health-watch.js`：輪詢 `/health`+`/ready`（可 `--require-rag`）退出碼給 cron／uptime | 健康檢查自動化 |
| P2 | 文件 | `.env.example` 分「開發預設／生產必填」兩段註解 | 減少誤用 |
| P2 | Compose | dev compose 註明 profile full 冷啟動時間與 model cache volume | 開發體驗 |

### P1 自動化建議（你指定的三塊）

| 主題 | 建議最小實作 | 驗收 |
|------|--------------|------|
| **健康檢查** | 既有 `check-ready.js` 擴為 cron 友好：`--require-rag`、JSON 輸出、非 0 exit；Docker 已有 healthcheck 可保留 | CI post-step + 本機 `npm run test:ready -- --require-rag` |
| **備份** | 日級：`storage/` tarball + `mongodump` + `uploads/`；檔名帶 timestamp；文件寫還原指令 | 乾跑還原到另一目錄可 `rag` 讀到索引 |
| **Seed 資料** | 幂等 seed：固定 group code（如 `SEED01`）、固定 KB 文本、可 `--reset` | 新人 `npm run seed:demo` 後 coach 問答有來源 |

---

## 5. 權衡矩陣與總體推薦

| 方案 | 優點 | 代價 | 建議 |
|------|------|------|------|
| A. 只補文件 | 快 | 生產 compose 仍可踩雷 | 不夠 |
| B. 文件 + 修 prod compose + `.env.example` 入庫 | 堵住 P0 | 不增加 CI 信心 | **本週必做** |
| C. B + CI RAG 直測 + 負向安全 + Mongo job | 接近生產可信 | CI 時間／secret／Mongo 服務成本 | **下一個 sprint** |
| D. 完整 backup／seed／reindex 平台化 | day-2 成熟 | 工作量大 | 與企業客戶並行，勿一次做過大 |

**總體推薦：B → C 順序**；腳本以「可 cron、可本機、零額外表板」為主，避免先上複雜 orchestration。

---

## 6. 工作量評估（人天，約）

| 包 | 內容 | 估時 | 風險 |
|----|------|------|------|
| **Ops P0 文件／設定** | README、OPERATIONS 修正、gitignore、env 範本入庫 | **0.5–1 d** | 低 |
| **Prod compose 對齊** | Mongo required、uploads volume、http-server 依賴、可選 depends_on | **0.5–1 d** | 中（需實機驗證） |
| **修 test_rag_flow + 進 CI + require-rag** | header、CI step、閘道 | **0.5 d** | 低–中（embedding 下載冷啟動） |
| **負向安全擴充** | 4–6 個 HTTP case | **0.5–1 d** | 低 |
| **Mongo CI job** | service + 精簡 smoke | **1–1.5 d** | 中（連線／索引） |
| **backup + seed + health-watch** | 三支腳本 + OPERATIONS 章節 | **1–1.5 d** | 低 |
| **合計到「可維運 MVP」** | B+C 精簡版（Mongo job 可二期） | **約 3–5 d** | — |

---

## 7. 驗收物總表

### 維運缺口清單（精簡版）

1. 生產 Mongo 必填 vs compose／文件可選 — **矛盾**  
2. `.env.example` 被 gitignore — **範本未進庫**  
3. 生產 web `omit=dev` + http-server — **可能起不來**  
4. 生產 API 無 uploads（與 JSON）持久化 — **資料風險**  
5. CI 無 `test_rag_flow`、無強制 RAG ready、無 Mongo、負向安全偏薄  
6. 無 backup／migrate／seed／health-watch  
7. 無 README；OPERATIONS 路徑／env／測試漂移  

### 建議腳本／文件更新清單（精簡版）

| 動作 | 路徑 |
|------|------|
| 新增 | `README.md` |
| 更新 | `OPERATIONS.md`、`.env.example`、`.gitignore`、`docker-compose.prod.yml`、`package.json`（依賴／scripts） |
| 修復後納入 CI | `rag_service/test_rag_flow.py`、`.github/workflows/ci.yml` |
| 新增腳本 | `scripts/seed-demo.js`、`scripts/backup-*.{js,sh}`、`scripts/health-watch.js`（或擴充 `check-ready.js`） |
| 擴測 | `scripts/test-security-api.js`（RAG／跨租戶／uploads） |
| 可選二期 | Mongo service job、`rag:reindex` |

---

**結論：** 本機「能跑」的路徑大致齊（`dev` / `dev:all` / `rag:setup`），但 **生產契約與文件／compose 未對齊**，且 **RAG 資料生命週期與 CI 對生產主路徑（Mongo + RAG 閘道）幾乎是盲區**。建議先修 P0（env 入庫、README、prod compose、Mongo 必填一致性），再補 P1 自動化（health／backup／seed + CI RAG／負向／Mongo）。

如需下一步，可在同一 session 用 `/impl` 或委派 `@Data & Automation` 依上述清單開 PR（仍建議拆成「P0 文件+compose」與「P1 CI+腳本」兩 PR）。