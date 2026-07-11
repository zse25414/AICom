# Wave 1 複驗報告 + Wave 2 開工令

| 項目 | 內容 |
|------|------|
| 角色 | @Lumina Planner |
| 日期 | 2026-07-11 |
| 對照 | `wave-0-1-task-cards.md`、先前 `wave-0-1-acceptance-2026-07-11.md` |
| 方法 | 程式／文件／測試資產靜態複驗 + `node --check` |

---

## 1. 總裁決

| 波次 | 裁決 |
|------|------|
| **Wave 0** | ✅ 維持通過（commit `006f92a`） |
| **Wave 1** | ✅ **複驗通過（附殘餘條件）** |
| **Wave 2** | 🟢 **正式開工**（見 §5 任務卡） |

### 殘餘條件（不擋開工，但必須在 Wave 2 第 0 步處理）

| ID | 條件 | 負責 |
|----|------|------|
| **R1** | Wave 1 變更仍在 **working tree 未 commit**（大量 diff）→ 合併前須入庫 | @Core Coder + @Data（分 PR 亦可） |
| **R2** | 正式 **@Reviewer W1-REV** Session 報告未見 → Wave 2 **第一道閘** 補做唯讀複審 | @Reviewer & Optimizer |
| **R3** | 本機未在本複驗中實際跑 integration／security-matrix（僅靜態 + syntax）→ CI 或本機綠燈後再合 main | @QA / 合併者 |

---

## 2. Wave 1 逐卡複驗

### W1-A — @Core Coder ✅

| 驗收項 | 結果 | 證據 |
|--------|------|------|
| RAG write `requireManager: true` | ✅ | `upload` / `upload-text` / `delete` 皆 `assertRagGroupAccess(..., { requireManager: true })` |
| `ROLE_FORBIDDEN` / `GROUP_FORBIDDEN` / `UNAUTHORIZED` | ✅ | `assertRagGroupAccess` + enterprise document 路徑 |
| `ragStatus` pending/indexed/failed | ✅ | `setDocumentRagStatus` / `persistDocumentRagStatus`；document/add 初值 `pending` |
| 刪除清索引 | ✅ | enterprise `document/delete` 先 `proxyRagDeleteIndex`，失敗記 `ragStatus=failed` + warning |
| query `citations` + 保留 `sources` | ✅ | `normalizeRagCitations` 於 `/api/rag/query` 回應附加 |
| 語法 | ✅ | `node --check api-proxy.js` |

**D1 / D2：** 已對齊（manager only + 狀態可追蹤）。

**小瑕疵（非阻塞）：** soft-delete 成功分支曾短暫 `setDocumentRagStatus(..., 'indexed')` 再覆寫 `deleted`，可整理；不影響閘道。

---

### W1-B — @UI & UX Engineer ✅

| 驗收項 | 結果 | 證據 |
|--------|------|------|
| RAG 離線不隱藏選庫 | ✅ | `rag/health.js` `updateRagSelectorChrome`：team 內 always show + offline class |
| 降級「未使用知識庫」 | ✅ | `coach/agent.js` |
| 來源相關度非誤導 % | ✅ | 相關度 label／drawer（`coach-source-rel`） |
| 文件徽章 pending/indexed/failed + 重試 | ✅ | `enterprise/documents.js` `doc-rag-badge-*` |
| 發布 ≠ 索引 toast | ✅ | 「已存檔，但知識庫索引失敗」 |
| 選庫摘要「目前查：…」／純教練 | ✅ | `updateRagQuerySummary` |
| Health 優先 `/ready` | ✅ | `probeRagServiceOnline` |
| 樣式 | ✅ | `css/lumina.css` 大量 badge／selector 樣式 |
| 語法 | ✅ | slices `node --check` |

---

### W1-C — @Data & Automation ✅

| 驗收項 | 結果 | 證據 |
|--------|------|------|
| `README.md` | ✅ | 安裝、dev/dev:all、Docker profile、slices SoT、生產 checklist |
| `.env.example` + gitignore 例外 | ✅ | `!.env.example`；檔案 untracked 待 commit |
| `OPERATIONS.md` slices／Mongo／ALLOWED_ORIGINS | ✅ | 已改 SoT 與必填表 |
| prod compose Mongo required + uploads volume | ✅ | `MONGODB_URI:?required`、`uploads_data`、web `npm ci`（含 build 工具） |

---

### W1-D — @QA & Tester ✅（資產齊；執行待 CI/本機）

| 驗收項 | 結果 | 證據 |
|--------|------|------|
| T1–T7 腳本 | ✅ | `scripts/test-security-matrix.js` |
| npm script | ✅ | `test:security-matrix` |
| 接入 integration | ✅ | `test-integration.js` 引入 |
| CI step | ✅ | `.github/workflows/ci.yml`「Security matrix (W1-D negative)」 |
| 雙 user／雙 group fixture | ✅ | 腳本內 register + create/join |

**執行狀態：** 複驗當下未起服務跑綠燈 → 列 **R3**。

---

### W1-REV — ⚠️ 程序殘餘

- 未見獨立「W1-REV 驗收通過」Session 報告。  
- Planner 靜態複驗 **功能閘道視為通過**；**合規閘道**要求 Wave 2 開工後 **24h 內**完成 R2。

---

## 3. 與前次「Wave 1 未通過」的差異

| 前次（首次驗收） | 本次複驗 |
|------------------|----------|
| 僅 W0 三檔 | W1 後端 RBAC／status／citations 齊 |
| 無 README／compose 修正 | README + OPERATIONS + prod compose 齊 |
| 無 UX 狀態 | 徽章／離線選庫／來源／toast 齊 |
| 無負向測 | security-matrix + CI 掛載 |
| W0 未 commit | W0 已 `006f92a` |

---

## 4. Wave 2 開工令

**生效：** 立即  
**前置必做（Day 0）：**

1. **Commit / PR 收斂 Wave 1**（可拆）：  
   - `feat(w1): RAG RBAC, ragStatus, citations`  
   - `feat(w1-ui): knowledge trust UX`  
   - `docs(ops): README, env example, prod compose`  
   - `test(w1): security matrix + CI`  
2. **@Reviewer W1-REV** 對上述 diff 出結論（通過或列必修）  
3. **CI integration + security-matrix 綠**（或本機 `npm run test:security-matrix` 在 API+RAG 下通過）

**Day 0 未完成不得 merge Wave 2 功能 PR 到 main。** 可先開 branch 開發。

---

## 5. Wave 2 任務卡（開工）

### 卡片 W2-0 — Day 0 閘道（全員）

| 項 | 負責 |
|----|------|
| Commit Wave 1 工作區 | Core / Data / UI 依 diff 歸屬 |
| W1-REV 唯讀報告 | @Reviewer & Optimizer |
| security-matrix 綠燈證據 | @QA & Tester |

---

### 卡片 W2-A — KB 一級 CRUD @Core Coder

**契約：** `docs/architecture/team-rag-api-gap-memo.md` §2.2、§6.2  

**必做：**

1. `KnowledgeBase` metadata：create / list（`kb_ids` + `items` 相容）/ delete（軟刪 + 清索引）  
2. 上傳前 KB 存在（或 `auto_create` 遷移期）  
3. displayName、status、建立者  
4. manager only 寫；member list  

**驗收：** 可建「專案 A」空庫 → list 見名稱 → 刪後不可查。  
**Reviewer：** 必審。

---

### 卡片 W2-B — 團隊知識庫 tab / 空庫 UX @UI & UX Engineer

**依賴：** W2-A list API 或暫用現有 list 擴充  

**必做：**

1. 團隊頁 **知識庫一級 tab**（或「更多 → 知識庫」捷徑）  
2. 選庫顯示空庫警告／文件數（有則顯示）  
3. 建立／刪除庫的最小 UI（接 W2-A）  
4. 維持 W1 信任狀態不回退  

**禁止：** 主導航第五格「知識庫」（未加入團隊時空白率高）。

---

### 卡片 W2-C — Server-side RAG 同步佇列 @Core Coder

**依賴：** W1 ragStatus  

**必做：**

1. document add/delete **伺服器編排** RAG（減少純前端雙寫）  
2. 失敗重試／`rag.status=failed` 可觀測  
3. 可選 outbox 或同步 await + 狀態回寫  

**驗收：** 關前端仍可由 API 路徑達到 indexed；刪除後 query 不命中。

---

### 卡片 W2-D — Ops 生命週期 @Data & Automation

**必做：**

1. `scripts/seed-demo.js`（或等價）固定 DEMO 群組 + 手冊文本  
2. backup：`rag_service/storage` tarball 說明 + 可選 uploads  
3. 修 `rag_service/test_rag_flow.py` 帶 `X-RAG-API-Key`；CI 可選 step  
4. `check-ready.js --require-rag`（或等價）  
5. （可選二期）Mongo service CI job  

---

### 卡片 W2-E — 測試加深 @QA & Tester

**必做：**

1. 對 W2-A KB CRUD 的 RBAC／跨組 case  
2. 刪除鏈（enterprise + KB delete）→ query 不命中  
3. 空檔／超大／非法類型（H6）  
4. 維持 security-matrix 不紅  

---

### 卡片 W2-F — 版本歷史（可選本 sprint 後半）@Core Coder

**契約 P1 DocumentVersion：** 新版本上傳、list history、可選 restore。  
若工期緊可 **推遲 Wave 2.1**，須 Planner 標註。

---

### 卡片 W2-REV — @Reviewer & Optimizer

- **先：** W1-REV（R2）  
- **後：** 每個含關鍵 API 的 PR（KB CRUD、server sync）必審  

---

## 6. Wave 2 依賴圖

```
[R1 commit W1] ──┬── [R2 W1-REV] ──┬── [R3 CI/matrix 綠]
                 │                 │
                 ▼                 ▼
            W2-A KB CRUD ──────► W2-B UI tab
                 │
                 ▼
            W2-C server sync
                 │
     W2-D ops ───┼─── W2-E tests
                 ▼
              W2-REV
                 ▼
         Planner Wave 2 驗收
```

可並行：W2-D 與 W2-A；W2-B 在 list API 草案後可 mock。

---

## 7. Wave 2 明確不做（維持）

- OCR／Word·MD 全格式大改  
- 知識圖譜／自動摘要／`@KB`  
- 外移 Qdrant／Pinecone  
- `api-proxy` 全量框架重寫（允許持續抽 routes）  
- Mongo collection 大拆（除非 W2-C 證明必要）  

---

## 8. 委派貼文（複製用）

### Day 0

```
@Core Coder / 相關作者：將 Wave 1 working tree 整理成 PR 並 commit（見 wave-1-reverify-and-wave-2-kickoff.md R1）。
@Reviewer & Optimizer：執行 W1-REV，對 W1 diff 出「驗收通過」或「需要修改」。
@QA & Tester：本機或 CI 跑 npm run test:security-matrix，回報綠燈證據。
```

### Wave 2 功能

```
@Core Coder 執行 W2-A（KB CRUD），契約見 docs/architecture/team-rag-api-gap-memo.md。
@UI & UX Engineer 執行 W2-B（知識庫 tab + 空庫 UX）。
@Core Coder（可串）執行 W2-C（server-side RAG 同步）。
@Data & Automation 執行 W2-D（seed/backup/require-rag/test_rag_flow）。
@QA & Tester 執行 W2-E。
@Reviewer 審關鍵 API PR。
完成後 @Lumina Planner 做 Wave 2 驗收。
```

---

## 9. Planner 簽署

| 項目 | 狀態 |
|------|------|
| Wave 1 複驗 | ✅ 通過（R1–R3 殘餘） |
| Wave 2 開工令 | 🟢 **已發布** |
| 下一里程碑 | Day 0 閘道 → W2-A/B/C/D/E → Planner 驗收 |

**生效宣告：**  
自本文件起，團隊得依 §5 開立 Wave 2 分支與任務；**main 合併**須滿足 Day 0（R1–R3）。
