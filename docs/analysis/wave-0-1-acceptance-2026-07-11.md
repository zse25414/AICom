# Wave 0 / Wave 1 驗收報告

| 項目 | 內容 |
|------|------|
| 角色 | @Lumina Planner |
| 日期 | 2026-07-11 |
| 對照 | `docs/analysis/wave-0-1-task-cards.md` |
| 證據 | working tree diff、Agent Session 回報、repo 現況掃描 |

---

## 總裁決

| 波次 | 裁決 | 說明 |
|------|------|------|
| **Wave 0（安全）** | ✅ **驗收通過** | W0-CORE 已落地；W0-REV 複審通過 |
| **Wave 1（P0 閉環）** | ❌ **未驗收** | W1-A/B/C/D 幾乎未開工；僅分析期文件存在 |
| **Wave 2** | ⏸️ **暫不開工** | 依核准排程保留；**必須 Wave 1 驗收通過後再開** |

**一句話：** 安全 P0 已補上關鍵洞，但產品可信閉環（RBAC、狀態、UX、文件、負向測）尚未交付 → **不能開 Wave 2 實作**。

---

## Wave 0 驗收明細

### 交付證據

| 項目 | 狀態 | 證據 |
|------|------|------|
| api_base allowlist + server key 強制 default | ✅ | `api-proxy.js` `resolveLlmApiBase` / query 注入；400 `API_BASE_FORBIDDEN` |
| RAG 端不可信 base 覆寫 | ✅ | `rag_service/config.py` `resolve_llm_api_base`；`rag_engine.configure_llm` |
| AI 限流 30/小時 | ✅ | `checkRateLimitBucket(..., AI_RATE_LIMIT_WINDOW_MS)` |
| 最小 diff、未動 enterprise 業務 | ✅ | git diff 僅 3 檔：`api-proxy.js`、`config.py`、`rag_engine.py` |
| @Core Coder 回報 | ✅ | Session「Grok Core Coder…」W0-CORE 完成回報 |
| @Reviewer W0-REV | ✅ | Session 複審：**#1 Critical 已關閉、#2 限流通過**；多層防線通過 |

### 殘餘注意（不擋 W0 通過）

| 項 | 嚴重度 | 說明 |
|----|--------|------|
| 變更 **未 commit** | 中 | 目前僅 working tree；建議盡快 commit，避免遺失 |
| Reviewer 可能提的次要項 | 低 | 以 W0-REV 結論為準；非阻塞 |
| 前端仍寫死 deepseek base | 低 | 已是安全值；W1 可不強制改 |

### W0 Checklist

- [x] 惡意 `api_base` + 無 client key → 不外洩 server key  
- [x] AI 桶使用 1h window  
- [x] Reviewer 驗收通過  

---

## Wave 1 驗收明細（逐卡）

| 卡片 | 負責人 | 裁決 | 現況 |
|------|--------|------|------|
| **W1-A** RBAC + rag.status + citations + 刪除編排 | @Core Coder | ❌ 未交付 | `assertRagGroupAccess` 仍只驗成員；upload/delete **無** manager；無 `ROLE_FORBIDDEN` / `GROUP_FORBIDDEN` code；無 `citations` 正規化；無 document `ragStatus` |
| **W1-B** 信任 UX | @UI & UX Engineer | ❌ 未交付 | Session 僅 Agent 就緒；無「未使用知識庫」、無索引狀態徽章、來源 % 仍舊（slices 未見對應改動） |
| **W1-C** README / env / OPERATIONS / compose | @Data & Automation | ❌ 未交付 | **無** `README.md`；`.env.example` **未** git 追蹤；`.gitignore` 仍 `.env.*`；OPERATIONS 仍寫 `js/src`；prod `MONGODB_URI` 仍可空 |
| **W1-D** 負向測試矩陣 | @QA & Tester | ❌ 未交付 | 無新 case（跨組/member 寫入/api_base/刪除後檢索）；Session 僅就緒 |
| **W1-REV** | @Reviewer | ⏸️ 未到 | 依賴 W1-A 完成 |

### W1 閘道結論

**不通過。** 不得宣稱 Wave 1 完成，不得啟動 Wave 2 實作。

---

## 與已鎖定決策的差距

| 決策 | 期望 | 現況 |
|------|------|------|
| D1 manager only | RAG 寫入 403 `ROLE_FORBIDDEN` | 任一群組成員仍可 upload/delete（僅 membership） |
| D2 RAG 落後+狀態 | UI/metadata `pending|indexed|failed` | 仍「發布成功」雙寫 best-effort，無持久狀態 |
| W1 Ops | README + env 入庫 + compose | 未做 |
| Wave 2 排程 | 下一 sprint | **維持排隊**，本報告不開卡開工 |

---

## 風險（若強行進 Wave 2）

1. 在未修 D1 下做 KB CRUD → 擴大 member 寫入面  
2. 在無 rag.status 下做 server 同步佇列 → 狀態語意更亂  
3. 在無負向測試下加功能 → 回歸無法偵測  
4. W0 未入庫 → 安全修復可能在分支切換中遺失  

---

## 重開 Wave 1 任務（必須完成後再 W2）

請各 Agent **重新貼卡**（內容見 `wave-0-1-task-cards.md`）：

### 立即（本週）

1. **@Core Coder — 先 commit W0**（若授權），再執行 **W1-A**  
2. **@Data & Automation — W1-C**（可完全並行）  
3. **@UI & UX Engineer — W1-B**（可並行；`ragStatus` 可先 mock）  
4. **@QA & Tester — W1-D**（可先 red tests；W1-A merge 後綠）  
5. **@Reviewer — W1-REV**（W1-A 完成後）  

### 建議 commit 訊息（W0 only，需使用者授權再 commit）

```
fix(security): allowlist LLM api_base and fix AI rate-limit window

Prevent DEEPSEEK key exfiltration via attacker-controlled api_base on
/api/rag/query; apply AI_RATE_LIMIT_WINDOW_MS (1h) to AI bucket.
Mirror allowlist in rag_service configure_llm.
```

---

## Wave 2 狀態：已排程、未開工

以下 **僅預告**，**禁止現在實作**：

| 項 | 負責人 | 前置 |
|----|--------|------|
| KB 一級 CRUD | @Core Coder + 契約備忘 | W1-A 通過 |
| 團隊知識庫 tab / 空庫 UX | @UI & UX Engineer | W1-B 通過 |
| Server-side RAG 同步佇列 | @Core Coder | W1-A rag.status + D2 |
| seed / backup / test_rag_flow+key / require-rag / Mongo CI | @Data & Automation | W1-C 通過 |
| 補 H6–H10 等 | @QA & Tester | W1-D 通過 |
| 再審 | @Reviewer | 上列完成 |

**Wave 2 正式開工條件（全部滿足）：**

1. W0 已 merge／可追溯 commit  
2. W1-A/B/C/D checklist 全綠  
3. W1-REV = `驗收通過`  
4. @Lumina Planner 發「Wave 2 開工令」+ 任務卡檔  

---

## 給使用者的一句指令建議

若要加速：

> 請各 Session 立刻執行 W1 對應卡片；Core 先把 W0 diff commit。完成後再 @Lumina Planner 複驗 Wave 1。

若要本協調 Session 代做：

> 授權 @Lumina Planner 轉派／或指定本 Session 以 Core Coder 身分實作 W0 commit + W1-A。

---

**Planner 簽署：** Wave 0 ✅ ｜ Wave 1 ❌ ｜ Wave 2 ⏸️ 排隊  
**下一步：** 重啟 Wave 1 四卡並行 → 複驗 → 再開 Wave 2 任務卡。
