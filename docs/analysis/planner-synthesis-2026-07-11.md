# Lumina Planner 彙整報告

| 項目 | 內容 |
|------|------|
| 日期 | 2026-07-11 |
| 角色 | @Lumina Planner（只彙整、不實作） |
| 來源 | 六位專家分析 + 架構備忘 |
| 狀態 | **分析波完成 → 待你核准 P0/P1 範圍** |

---

## 1. 各專家交付狀態

| 專家 | Session 主題 | 交付物 | 結論摘要 |
|------|--------------|--------|----------|
| **@Backend Architect** | RAG API Gap → 目標架構 | `docs/architecture/team-rag-api-gap-memo.md`、`docs/analysis/backend-architect.md` | 現況 = 隱式多 KB + metadata 半成品；需 **proxy=權限/metadata 真相、RAG=引擎**；獨立 KB CRUD；RAG 寫入需 manager |
| **@UI & UX Engineer** | 知識庫 UX 缺口 | `docs/analysis/ui-ux.md` | 信任閉環破洞：發布≠索引、RAG 失敗靜默降級、來源 % 誤導；P1 先修可見性／來源／雙階段狀態 |
| **@Core Coder** | 技術債與實作風險 | `docs/analysis/core-coder.md` | **雙寫無交易**為致命風險；`api-proxy` 巨石；`js/src` 文件漂移；P1 先止血 ≤6 檔，晚拆巨石 |
| **@Data & Automation** | 維運／部署／CI | `docs/analysis/data-automation.md` | 生產契約 vs compose/文件矛盾；無 README；`.env.example` 未入庫；無 backup/seed；CI 缺 RAG 直測／Mongo |
| **@QA & Tester** | 測試缺口地圖 | `docs/analysis/qa-tester.md` | **CI 綠 ≠ 安全**；缺授權負向矩陣；H1–H8 高風險未自動化 |
| **@Reviewer & Optimizer** | 關鍵路徑唯讀審查 | `docs/analysis/reviewer-optimizer.md` | **需要修改**；P0 必須修 `api_base` 金鑰外洩 + AI 限流視窗錯誤 |

---

## 2. 跨專家共識（高置信）

下列結論被 **≥2 位專家獨立指出**，Planner 定調為「事實」而非單點意見：

### 共識 A — 雙軌文件／RAG 是系統級主風險

| 來源 | 說法 |
|------|------|
| Architect | enterprise document 與 RAG 權限／id 不一致 |
| Core Coder | 前端 best-effort 雙寫 → 幽靈文件／幽靈索引 |
| UI | 「已發布」toast ≠ 教練查得到 |
| QA | H5 刪除後仍可檢索未測 |
| Reviewer | RAG 寫入任一 member；enterprise 僅 manager |

**定調：** P0/P1 必須處理「寫入權限一致 + 狀態可見 + 刪除一致性」；完整 server 原子雙寫可為 P1.5。

### 共識 B — 安全：CI 與產品威脅模型脫節

| 來源 | 說法 |
|------|------|
| QA | happy-path 為主；無跨租戶 fixture |
| Data | 負向安全薄；無 Mongo CI |
| Reviewer | **Critical**：`api_base` + 伺服器 key 注入可外洩 DEEPSEEK key |

**定調：** 任何掛真實 `DEEPSEEK_API_KEY` 的環境，**必須先修 Reviewer #1**。

### 共識 C — 文件／onboarding 漂移

| 來源 | 說法 |
|------|------|
| Core Coder | OPERATIONS 寫 `js/src/`（空），真源是 `js/modules/slices/` |
| Data | 無 README；`.env.example` 被 gitignore；prod compose 可空 Mongo |

**定調：** Ops P0（文件 + compose + env 範本）可與安全 P0 **並行**，不依賴架構大改。

### 共識 D — 產品定位：MVP 可內部用，但非 TeamPlan 完成

| 面向 | 已有 | 未有 |
|------|------|------|
| 真 RAG | hybrid 檢索、sources、群組隔離基礎 | 穩定 citations、版本、KB CRUD |
| 企業 | 群組／任務／manager 文件 metadata | 細 RBAC 全路徑、審計 |
| 品質 | CI unit + integration happy path | 授權矩陣、刪除鏈、Mongo 路徑 |

---

## 3. 衝突與決策（需你拍板）

| ID | 議題 | 各方立場 | Planner 預設建議 |
|----|------|----------|------------------|
| **D1** | member 可否上傳／刪 RAG？ | Architect／Reviewer／QA：應對齊 **manager only**；現況允許 member | **採 manager only**（對齊 TeamPlan）。若你要「全員可貢獻知識」需重開契約 |
| **D2** | Enterprise 成功但 RAG 落後，UI 怎麼辦？ | UI／Coder：必須分狀態；Architect：要 `rag.status` | **允許短暫落後**，UI 顯示 `indexed / pending / failed`，禁止只顯示「已發布」 |
| **D3** | 何時拆 `api-proxy`？ | Coder：P2；Architect：PR-E 可中期 | **P0/P1 不拆巨石**，只抽 RBAC／限流／allowlist 必要點 |
| **D4** | 向量庫外移？ | TeamPlan 長期；現況本機 storage | **P0–P1 不外移**；P2+ 再評 |
| **D5** | 產品主軸 | 個人教練 vs 企業 KB | 未決策；影響導航。UI 建議 **知識庫附屬團隊、教練消費** |

---

## 4. 鎖定範圍建議（核准後進入實作波）

### ⛔ 本波明確不做

- OCR、Word/MD 全格式、知識圖譜、自動摘要、@KB 語法
- 外部向量庫（Qdrant/Pinecone）
- Playwright 全站 E2E
- `api-proxy` 全量路由重構
- Mongo collection 大拆（備忘 P1-6，延後）

---

### 🔴 Wave 0 — 安全緊急（Reviewer 強制，1–2 人日）

| 項 | 負責人 | 內容 | 依據 |
|----|--------|------|------|
| W0-1 | @Core Coder | `/api/rag/query` 注入 server key 時 **強制 api_base allowlist**；忽略客戶端惡意 base | Reviewer #1 **Critical** |
| W0-2 | @Core Coder | AI rate limit 改用 `AI_RATE_LIMIT_WINDOW_MS`（1h/30） | Reviewer #2 |
| W0-3 | @Reviewer & Optimizer | 複審 W0-1/2 通過才進 Wave 1 | 關鍵 API |

---

### 🟠 Wave 1 — P0 可信閉環（約 4–7 人日，可並行）

#### 1A 後端契約（Architect 備忘 P0）

| 項 | 負責人 | 內容 |
|----|--------|------|
| W1-A1 | @Core Coder | RAG upload/delete **manager only** + 機器可讀 `code`（`ROLE_FORBIDDEN` 等） |
| W1-A2 | @Core Coder | Document 軟刪／索引鍵朝 `document_id` 過渡（或至少 delete→清索引編排） |
| W1-A3 | @Core Coder | query 回應補 `citations`（document_id, title, snippet 可先 partial） |
| W1-A4 | @Backend Architect | 契約凍結（若實作偏離備忘需更新 memo） |

#### 1B 前端信任 UX（UI P1-1～4）

| 項 | 負責人 | 內容 |
|----|--------|------|
| W1-B1 | @UI & UX Engineer | RAG 離線不隱藏選庫；降級標「未使用知識庫」 |
| W1-B2 | @UI & UX Engineer | 來源：去掉誤導 %；可點 snippet／開檔 |
| W1-B3 | @UI & UX Engineer + @Core Coder | 文件卡：已發布／索引中／失敗 + 重試；0 字 PDF 警告 |
| W1-B4 | @Core Coder | offline schema 補 `kbId`；health 不硬編碼直連（可配置） |

#### 1C 維運 P0（Data）

| 項 | 負責人 | 內容 |
|----|--------|------|
| W1-C1 | @Data & Automation | `.env.example` 入庫（gitignore 例外）；新增 `README.md` |
| W1-C2 | @Data & Automation | 修 `OPERATIONS.md`（slices 路徑、Mongo 必填、`ALLOWED_ORIGINS`） |
| W1-C3 | @Data & Automation | `docker-compose.prod.yml`：Mongo required、uploads volume、http-server 依賴 |

#### 1D 測試 P0（QA）

| 項 | 負責人 | 內容 |
|----|--------|------|
| W1-D1 | @QA & Tester | 優先 case：AUTH-RAG-NO-JWT、跨群組 403、member RAG 寫入 403、DELETE-NO-RETRIEVE、api_base 不可劫持（若可測） |
| W1-D2 | @QA & Tester | 進 CI integration；fixture 雙 user／雙 group 最小集 |

---

### 🟡 Wave 2 — P1 產品／治理（約 5–10 人日）

| 項 | 負責人 | 內容 |
|----|--------|------|
| W2-1 | @Core Coder | KB 一級 CRUD（create/list/delete + displayName） |
| W2-2 | @UI & UX Engineer | 團隊頁知識庫 tab；選庫顯示空庫；IA P1-5 |
| W2-3 | @Core Coder | Server-side RAG 同步佇列（P1.5）或完整 `rag.status` 對帳 |
| W2-4 | @Data & Automation | seed-demo、backup storage、test_rag_flow + key、`--require-rag`、可選 Mongo CI |
| W2-5 | @QA & Tester | 補 H6–H10；PIN 鎖定；uploads ACL |
| W2-6 | @Reviewer | Wave 1 後全面再審 RBAC + 刪除一致性 |

---

## 5. 建議執行順序（依賴圖）

```
        ┌─ W0-1 api_base allowlist ─┐
        │                           ├─→ Reviewer 複審 ─┐
        └─ W0-2 AI rate limit ──────┘                  │
                                                       ▼
    ┌─ W1-A RBAC + citations ──────────────┐     ┌─ W1-D 安全矩陣測 ─┐
    ├─ W1-B UX 信任閉環 ───────────────────┼────►│                    ├─→ Wave 2
    └─ W1-C README/env/compose ────────────┘     └─ Reviewer 抽樣 ───┘
         （可與 W1-A/B 完全並行）
```

**總工期粗估（單線約 1 人）：**  
- Wave 0：0.5–1 d  
- Wave 1：4–7 d  
- Wave 2：5–10 d  

**雙人並行（後端 + 前端／ops）：** Wave 1 可壓到約 **3–4 日曆日**。

---

## 6. 需求完整性總表（對 TeamPlan）

| 需求 | 判定 | 進入波次 |
|------|------|----------|
| 真 RAG + 引用 | 實作（強化 citations） | W1-A3 / W1-B2 |
| 群組隔離 | 實作（補測 + 強化） | W1-D |
| manager 上傳／member 查 | 實作（修 RAG 寫入） | W1-A1 |
| 多 KB 管理 | 部分 → Wave 2 | W2-1 |
| 文件版本 | 推遲 | Wave 2+（備忘 P1） |
| 細角色／審計 | 推遲 | Wave 2+ |
| OCR／多格式 | 拒絕本季（除非另開） | — |
| 知識圖譜／自動摘要 | 拒絕本季 | — |
| 外移向量庫 | 推遲 | P2 |

---

## 7. 給你的核准清單（回覆即可開工）

請直接回覆例如：`核准 Wave 0+1，D1=manager only，D2=允許 RAG 落後+狀態徽章`。

1. **是否立刻啟動 Wave 0（安全）？** 建議：**是（強制）**  
2. **D1 權限：** manager only（建議）／member 可上傳（需改契約）  
3. **D2 RAG 落後：** 允許+狀態（建議）／必須原子成功才顯示發布  
4. **Wave 1 是否含 Ops README／compose？** 建議：**是**  
5. **Wave 2 是否排進下一 sprint？** 是／否  

---

## 8. 原始報告索引

| 路徑 |
|------|
| `docs/architecture/team-rag-api-gap-memo.md` |
| `docs/analysis/backend-architect.md` |
| `docs/analysis/ui-ux.md` |
| `docs/analysis/core-coder.md` |
| `docs/analysis/data-automation.md` |
| `docs/analysis/qa-tester.md` |
| `docs/analysis/reviewer-optimizer.md` |
| `docs/analysis/planner-synthesis-2026-07-11.md`（本檔） |

---

**Planner 狀態：** 分析波 **已彙整完成**。等待你的核准後，再拆具體實作任務給 @Core Coder / @UI / @Data / @QA，並安排 @Reviewer 卡點。
