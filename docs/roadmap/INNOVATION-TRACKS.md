# 創新軌道（Innovation Tracks）— 讓 Lumina 變得特別的五項技術

> 撰於 2026-07-19。定位：**PHASE-5 之後的差異化投資選單**，不是已排程的 backlog。
> 前提：P0/P1 工程項已關閉（RAG 對帳、附件上雲等，見 `PRODUCT-CONTEXT.md` §5）。
> 每項含：差異化理由、資料流、動哪些檔、分期 commit、驗收方式、風險。
> 排序 = 差異化 × 可行性。**若只做一項，做軌道 1。**

共同原則：

- 不打斷主路徑（建任務 → 教練帶做 → 完成）；所有新能力都是主路徑的增強。
- 沿用既有機制：slices 前端、`data-lumina-action` 動作層、`/api/user/data` 同步、
  RAG proxy、analytics `track()`。不引入新框架。
- 隱私底線：個人執行數據留在本機／個人雲端資料，團隊聚合一律匿名化。

---

## 軌道 1：活的 SOP — 知識庫文件編譯成可執行流程 ⭐

### 為什麼特別

所有競品的 RAG 都是「查了回答你」。Lumina 獨有執行閉環，把兩者接起來：
**文件不是拿來讀的，是拿來跑的**。再加上回饋迴路——統計成員在 SOP 第幾步卡住、
哪一步問最多問題——文件品質第一次有客觀數據。產品從「知識庫＋教練」升級為
「會自我改善的團隊作業系統」。

### 資料流

```
manager 發布文件（既有 document/add）
  └─ LLM 編譯：content → steps[]（title/action/預估時長/引用段落）
       存 doc.compiledPlan（enterprise store，隨版本走）
成員在教練選「跑這份 SOP」
  └─ 生成引導 session（沿用 focusSession.steps 機制）
       每步完成/卡住/提問 → track('sop_step', {docId, version, step, event})
manager 儀表板
  └─ 聚合卡點：GET /api/enterprise/group/document/insights（匿名計數）
```

### 動哪些檔

| 檔案 | 改動 |
|------|------|
| `server/domain/enterprise/documents.js` | 發布/新版時觸發編譯（可 lazy：首次被「跑」才編） |
| `server/domain/llm.js` | 編譯 prompt：content → JSON steps（重用 chat 代理） |
| `js/modules/slices/coach/plans.js`、`coach/decompose.js` | steps 注入引導 session |
| `js/modules/slices/enterprise/documents.js` | 文件卡片加「跑這份 SOP」＋ manager 卡點徽章 |
| `js/modules/slices/utils/analytics.js` | `sop_step` 事件 |
| 新 `server/domain/handlers/enterprise.js` 路由 | insights 聚合（僅 manager，計數不含個資） |

### 分期 commit

1. `feat(sop)`: 文件 → steps 編譯 + 存 compiledPlan（含契約測試：JSON schema 驗證）
2. `feat(sop)`: 教練「跑這份 SOP」引導 session + 進度回寫
3. `feat(sop)`: 卡點統計 + manager insights 面板
4. `test(sop)`: E2E — 發布 → 編譯 → 跑完 → insights 有計數

### 驗收

- 發布一份 3 步驟 SOP，成員端一鍵進入引導，每步有引用來源段落。
- 兩個成員在第 2 步點「卡住」→ manager 面板顯示「步驟 2：卡住 ×2」。
- 文件發新版後 compiledPlan 重編，舊版統計保留（版本機制已有，W2）。

### 風險

- LLM 編譯品質不穩 → steps 需 schema 驗證＋保底（失敗退回純文件模式，不阻斷發布）。
- 編譯成本 → lazy 編譯＋以 contentHash 快取（版本機制已存 hash）。
- 估工：**3–4 個工作天**（不含 insights 面板打磨）。

---

## 軌道 2：個人執行模式模型 — 教練真的「認識你」

### 為什麼特別

`dailyHistory`、`trackedFocusByDay`、完成率、拆分記錄、`utils/exec-memory.js` 已經在
收集金礦級數據，目前只拿來畫圖。建**執行畫像**後教練能說出通用助手說不出的話：
「你週二早上的完成率全週最高，難任務排明早第一個」「超過 60 分鐘的任務你完成率
只有四成——先拆」。數據全在本機／個人資料，符合隱私路線，**規則引擎就能做，不必等 ML**。

### 資料流

```
既有：dailyHistory / trackedFocusByDay / tasks(duration, completed, splitFrom)
  └─ 新 utils/exec-profile.js：純函數彙算 →
       { bestHours[], taskSizeSweetSpot, splitLift, categoryBias, streakPattern }
       （本機計算，隨 /api/user/data 同步；無伺服器端運算）
教練 prompt 注入（coach/agent.js buildContext 處）
  └─ 一段 ≤300 字的「執行畫像摘要」＋ 排程建議規則
今日排序（tasks/scoring.js）
  └─ rankTasksByNextStepScore 加 profile 權重（bestHours × 任務難度）
```

### 動哪些檔

| 檔案 | 改動 |
|------|------|
| 新 `js/modules/slices/utils/exec-profile.js` | 畫像彙算（純函數，可單測） |
| `js/modules/slices/coach/agent.js` | prompt 注入畫像摘要 |
| `js/modules/slices/tasks/scoring.js` | 排序權重 |
| `lib/user-data-store.js` | payload 加 `execProfile`（sanitize 白名單） |
| `js/modules/slices/ui/insights.js` | 「你的執行模式」卡片（給使用者看得到、可關閉） |

### 分期 commit

1. `feat(profile)`: exec-profile 彙算 + 單元測試（給定固定 history 斷言輸出）
2. `feat(profile)`: 教練 prompt 注入 + 排序權重（feature flag：`S.userProfile.enableExecProfile`）
3. `feat(profile)`: insights 卡片 + user-data 同步

### 驗收

- 單測：餵 14 天假數據，斷言 bestHours 與 sweet spot 正確。
- 教練回覆可觀察到引用畫像（「你通常在…」）；關掉 flag 後不再引用。
- 畫像不含任務內容原文（只有統計量），check `npm run test:attachments` 型的契約測試驗 sanitize。

### 風險

- 數據少時畫像亂講 → 樣本門檻（<7 天資料不啟用）＋語氣降級（「初步觀察」）。
- 使用者反感被分析 → 預設開但畫像卡片可見＋一鍵關閉（透明優先）。
- 估工：**2–3 個工作天**。

---

## 軌道 3：教練工具化（Agentic Coach）＋ MCP 出口

### 為什麼特別

現在教練靠 `[選項:]` 文字約定，只能「建議」。升級成 tool-calling 後教練**直接動手**：
建任務、拆任務、排今日、查庫、附件存 KB——每個動作以可撤銷的操作卡片呈現。
第二步把 Lumina 包成 **MCP server**，使用者的 Claude 等 AI 助手能操作自己的任務與
知識庫——「能被別的 AI 操作的生產力工具」目前是藍海。

### 資料流

```
coach/agent.js 送出 → DeepSeek function calling（tools 清單）
  └─ tool_call 回來 → 前端動作層執行（addTask/splitTask/queryRag…）
       → 操作卡片（已執行 + Undo）→ 結果回填對話續跑
MCP server（新 mcp/ 目錄，Node）
  └─ tools: list_tasks / add_task / complete_task / query_kb / add_document
       認證：既有 JWT Bearer；權限完全等同該使用者本人
```

### 動哪些檔

| 檔案 | 改動 |
|------|------|
| `js/modules/slices/coach/agent.js` | tools 定義 + tool_call 迴圈 + 操作卡片 UI |
| `server/domain/llm.js` | chat 代理透傳 `tools` / `tool_calls`（DeepSeek 相容 OpenAI 格式） |
| 既有動作函數（tasks/coach slices） | 不改邏輯，只被映射為工具 |
| 新 `mcp/server.js` | MCP stdio/HTTP server，薄包 `/api/*`（獨立行程，不動 api-proxy） |
| `OPERATIONS.md` | MCP 啟動與授權說明 |

### 分期 commit

1. `feat(agent)`: 3 個低風險工具（add_task / split_task / query_kb）+ 操作卡片 + Undo
2. `feat(agent)`: 全工具集 + 高風險動作（刪除類）強制確認
3. `feat(mcp)`: MCP server + 文件 + 契約測試（未授權 401、越權 403）

### 驗收

- 對教練說「幫我把這個任務拆成兩半」→ 出現已執行卡片，任務實際被拆，Undo 可回復。
- 高風險工具（刪除）永遠先出確認卡，不會直接執行。
- MCP：`add_task` 建的任務出現在網頁端；用他人 token 操作回 403。

### 風險

- 模型亂呼叫工具 → 工具白名單分級（自動執行／需確認）＋每輪工具呼叫上限。
- DeepSeek function calling 相容性 → 先以 2–3 工具驗證，不行退回結構化 JSON 約定。
- 估工：**4–5 個工作天**（MCP 佔 1.5）。

---

## 軌道 4：知識庫內容級對帳 — 矛盾偵測

### 為什麼特別

storage 級對帳已做（`POST /api/rag/reconcile`，2026-07-19）。下一層是**內容級**：
新文件入庫時檢索相似段落，LLM 判斷是否與既有文件矛盾（「本文說報銷 30 天，
《報銷流程 v2》§3 說 15 天」），提醒 manager。團隊知識庫最大死因是內容腐爛互相
打架——沒有產品在解這個。版本機制（W2）＋檢索＋LLM 三塊都是現成的。

### 資料流

```
document/add / 新版本（既有流程，索引完成後）
  └─ 背景 job：以新文件關鍵段落 query 同群組其他文件（既有 /api/rag/query 檢索路徑，不生成答案）
       → 相似度 > 門檻的段落對，送 LLM 判斷：{矛盾|重複|互補|無關} + 摘要
       → 存 doc.contentAudit[]（enterprise store）
manager 文件列表
  └─ 「與 X 文件疑似矛盾」徽章 → 點開對照卡（兩段原文並排 + LLM 摘要）
       → 動作：標記已處理／發新版修正／忽略
```

### 動哪些檔

| 檔案 | 改動 |
|------|------|
| `server/domain/rag/ops.js` | 背景 audit job（掛在索引完成 hook 後，同 runBackgroundRagIndex 模式） |
| `rag_service/main.py` | 可選：純檢索端點（不走 LLM 生成）——已有 retrieve 邏輯，抽端點即可 |
| `server/domain/llm.js` | 矛盾判斷 prompt（強制 JSON 輸出） |
| `js/modules/slices/enterprise/documents.js` | 徽章 + 對照卡 + 處理動作 |

### 分期 commit

1. `feat(kb-audit)`: 檢索端點 + 背景比對 job + contentAudit 存檔（含契約測試）
2. `feat(kb-audit)`: manager UI（徽章／對照卡／處理動作）
3. `test(kb-audit)`: golden 案例——固定兩份矛盾文件，斷言被抓到；兩份互補文件不誤報

### 驗收

- 上傳「報銷 15 天」後再傳「報銷 30 天」→ 新文件出現矛盾徽章，對照卡兩段原文正確。
- 互補內容（不同主題）不誤報；audit 失敗不影響發布與索引（同 RAG 失敗降級原則）。

### 風險

- 誤報疲勞 → 只在 manager 端顯示、可忽略、門檻保守起步（高相似 + LLM 高信心才標）。
- 大庫比對成本 → 只比對新文件 vs 既有（增量），不做全庫兩兩比對。
- 估工：**3 個工作天**。

---

## 軌道 5：完全離線的本地 LLM 教練

### 為什麼特別

已有離線規則教練與本地 embedding。補上本地 LLM（Ollama / llama.cpp，Qwen 4B 級）
後，做到**斷網、零 API key、資料不出機器**的完整教練。對 `docs/business/PRIVATE-DEPLOY.md`
瞄準的私有部署客群（在乎資料主權的中小企業），「AI 生產力工具，你的資料連我們都
碰不到」是決定性賣點。

### 資料流

```
教練 fallback 鏈（現況：DeepSeek → 離線規則教練）
  └─ 變成：DeepSeek → 本地 LLM（OLLAMA_URL 有設且 /api/tags 可達）→ 規則教練
rag_service 答案生成
  └─ configure_llm 加 provider：OLLAMA_URL 指向 OpenAI 相容端點（Ollama 原生支援 /v1）
```

### 動哪些檔

| 檔案 | 改動 |
|------|------|
| `server/config.js` | `OLLAMA_URL`（並入 ALLOWED_LLM_API_BASES 邏輯） |
| `server/domain/llm.js` | provider 選擇：deepseek → ollama → 無 |
| `rag_service/rag_engine.py` | `configure_llm` 支援本地 base（沿用 OpenAI 相容路徑） |
| `js/modules/slices/coach/agent.js`、`storage/api.js` | 設定頁「本地模型」選項 + 狀態徽章 |
| `OPERATIONS.md`、`docs/business/PRIVATE-DEPLOY.md` | 部署指南（模型建議與硬體需求） |

### 分期 commit

1. `feat(local-llm)`: server/rag 雙邊 provider 支援 + `/ready` 顯示 llm provider
2. `feat(local-llm)`: 設定 UI + fallback 鏈接入教練
3. `docs`: 私有部署指南更新 + 煙霧測試（`OLLAMA_URL` 指向 mock server 的契約測試）

### 驗收

- 拔掉 `DEEPSEEK_API_KEY`、起 Ollama → 教練與 RAG 問答完整可用，`/ready` 顯示 `llm: ollama`。
- Ollama 也不在 → 平滑退回規則教練（現有行為不變）。
- CI 用 mock OpenAI-相容 server 驗 provider 切換（不真跑模型）。

### 風險

- 小模型回覆品質 → prompt 為小模型精簡版（教練 prompt 已有離線分支經驗）；明示徽章
  「本地模型」管理預期。
- 授權與模型散布 → 只做「指向使用者自己的 Ollama」，不代下載模型。
- 估工：**2–3 個工作天**。

---

## 附錄：會議語音 → 待辦（與軌道 1 共用管線）

backlog P1-任務 既有項的升級版：本地 Whisper 轉寫 → LLM 抽決議/待辦 →
進今日佇列＋指派成員。與軌道 1 同屬「非結構內容 → 可執行任務」管線，
建議在軌道 1 落地後順做（估 2 個工作天）。

---

## 總覽與建議順序

| 軌道 | 差異化 | 估工 | 依賴 |
|------|--------|------|------|
| 1 活的 SOP | ⭐⭐⭐ 產品靈魂 | 3–4 天 | 無 |
| 2 執行畫像 | ⭐⭐⭐ 護城河（數據在你手上） | 2–3 天 | 無 |
| 3 Agentic + MCP | ⭐⭐ 體驗躍遷 + 藍海入口 | 4–5 天 | 無 |
| 4 內容級對帳 | ⭐⭐ B 端賣點 | 3 天 | 軌道無依賴（storage 對帳已有） |
| 5 本地 LLM | ⭐⭐ 私有部署決定性賣點 | 2–3 天 | 無 |

- **先做 1 + 2**（合計約一週）：同時強化教練、知識庫、團隊三條線，且全部吃現有數據。
- 3 做完後 4、5 按銷售對象決定（雲端團隊客 → 4；私有部署客 → 5）。
- 每軌道完成後照慣例：更新 `PRODUCT-CONTEXT.md` §5、對應測試進 CI、
  完成判準依 `docs/claude/JUDGMENT.md`。
