# 測試缺口報告 · 回歸風險地圖

> **範圍**：只分析、不寫新測試  
> **依據**：`package.json`、`.github/workflows/ci.yml`、`scripts/test-*.js`、`check-*.js`、`api-proxy.js`、`docs/architecture/team-rag-api-gap-memo.md`  
> **日期**：2026-07-11

---

## 1. 現有測試資產地圖

### 1.1 指令總覽

| 指令 / 腳本 | 類型 | 層級 | 需服務 | 是否進 `npm test` | 是否進 CI |
|-------------|------|------|--------|-------------------|-----------|
| `npm test` | 聚合 | 混合 | 可選 API | ✅ 本體 | ✅ `unit-test` job |
| `build:app:lazy` + `check-bundle-size` | 建置閘道 | 靜態 | 否 | ✅ | 隨 unit |
| `test-init.js` (`test:smoke`) | 前端 smoke | 偽 E2E（JSDOM） | 否 | ✅ | unit |
| `check-security.js` | 前端安全單元 | 單元（DOM） | 否 | ✅ | unit |
| `check-unsafe.js` | DOM id 靜態掃描 | 靜態 | 否 | ✅ | unit |
| `scripts/test-register.js` | 註冊流程 | 單元 + 可選 HTTP | HTTP 可 skip | ✅ | unit（HTTP 在 CI 有 API 時才穩） |
| `scripts/test-security-api.js` | 密碼學 + 可選 HTTP 安全 | 單元／整合 | HTTP 預設 **skip** | ✅（多數只跑 crypto） | unit 本地 crypto；integration 設 `SECURITY_HTTP_TESTS=1` |
| `scripts/test-auth.js` | 認證 happy path | 整合 | **API 必起** | ❌ | ✅ integration |
| `scripts/test-enterprise.js` | 企業 happy path | 整合 | API | ❌ | ✅ integration |
| `scripts/test-coach-rag.js` | 教練 RAG 正例 | 整合／E2E | API + RAG | ❌ | ✅ integration |
| `scripts/test-integration.js` | register+enterprise+coach-rag | 套件 | API（CI 硬性） | ❌ | ✅ integration |
| `scripts/check-ready.js` | `/ready` 健康閘 | 運維 smoke | API | ❌（`test:ready`） | ✅ integration |
| `check-handlers.js` | onclick 對 handler | 靜態、**疑似過期** | 否 | ❌ 未掛 script | ❌ |
| `check-ids.js` | getElementById 對 HTML | 靜態、**疑似過期** | 否 | ❌ 未掛 script | ❌ |
| `rag_service/test_rag_flow.py` | RAG 手動 smoke | 手動 E2E | RAG 直連 :8000 | ❌ | ❌ |

### 1.2 `npm test` 實際在驗什麼

```
build lazy bundle
  → bundle size gate
  → JSDOM: initializeApp + 導航 + 少數 feature（無真 API）
  → sanitizeHtml / isSafeHttpUrl / mergeTasks
  → getElementById 與 HTML id 對齊
  → lib 層註冊（JSON store，不依賴 Mongo）
  → bcrypt PIN 概念 +（無 SECURITY_HTTP_TESTS 時）整段 HTTP 安全測 SKIP
```

**沒有**涵蓋：跨使用者、跨群組、uploads 授權、RAG 負向、manager RBAC、刪除一致性、限流、弱 PIN 的 HTTP 實測（unit job）。

### 1.3 CI 實際在驗什麼

| Job | 內容 | 盲點 |
|-----|------|------|
| `unit-test` | `npm test` | 安全 HTTP 預設 skip；無 enterprise/RAG 負向 |
| `integration-test` | 起 RAG + API → auth / enterprise / security-http / coach-rag / integration / ready | **幾乎全是 happy path**；雙人雙組 fixture 不存在；member vs manager 寫入未分；刪除後檢索未驗 |

### 1.4 覆蓋形狀（現況）

```
        /\
       /E2E\     ← coach-rag 1 條正例；無瀏覽器真 E2E
      /------\
     / 整合   \  ← auth/enterprise/security-http 正例為主
    /----------\
   / 單元+靜態  \ ← DOM smoke、XSS 小測、bundle、register store
  /--------------\
```

沒有 Jest/Vitest/Playwright；沒有 fixture 工廠；沒有「拒絕矩陣」自動化。

---

## 2. 未覆蓋的高風險場景（≥ 8）

| # | 場景 | 風險 | 現況行為（程式） | 現有測試 |
|---|------|------|------------------|----------|
| **H1** | **跨群組讀寫** | 租戶隔離破口 | `assertRagGroupAccess` 非成員 → 403；但**無人用雙 token / 雙 group 驗證** | 無 |
| **H2** | **未授權 `/uploads/*`** | 文件外洩 | 需 JWT + `canAccessUpload`（僅群組成員） | 無（無上傳→再 GET 負向） |
| **H3** | **RAG 無 JWT** | 匿名讀寫知識庫 | `requireAiAuth` → 401（產線／CI 關匿名） | security-http 只測 chat/user；**不測 `/api/rag/*` 401** |
| **H4** | **member（非 manager）走 RAG 上傳／刪除** | 角色越權 | **現況允許**任何群組成員 upload-text/upload/delete（架構備忘 P0） | coach-rag 用 manager 路徑，**從不測 member 應拒** |
| **H5** | **enterprise 刪除後 RAG 仍可檢索** | 幽靈索引／合規 | document/delete 刪 metadata+檔；**不保證清向量**；雙寫不同 API | 無 delete→query 鏈 |
| **H6** | **大檔／空檔／非法副檔名** | DoS、壞索引、繞過 | body 6MB、upload 5MB、ext 白名單；空 content 邊界未系統測 | 無 |
| **H7** | **弱 PIN** | 主管接管 | `WEAK_PINS` + 長度；HTTP 僅 integration + `SECURITY_HTTP_TESTS=1` 有「0000→400」 | unit 的 security-api **只測「847293 不在弱清單」字串概念** |
| **H8** | **`ALLOW_ANONYMOUS_AI=1`** | 開發旗標誤開 = chat/RAG 匿名 +（搭配未強制 enterprise auth）群組可繞 | 產線強制關；**無回歸測「誤開時行為／產線禁止」** | 無 |
| H9 | 偽造 `memberId` 操他組任務／通知 | IDOR | 依 `REQUIRE_ENTERPRISE_AUTH` + userId 綁定；CI 有開，本地預設可能鬆 | enterprise 測試**同人同 token 正例** |
| H10 | 直連 `rag_service:8000` 略過 proxy | 繞過 JWT/RBAC | 依 `RAG_API_KEY`；CI 有 key，開發可無 key | 無「無 key / 錯 key」測 |
| H11 | PIN 暴力（5 次鎖 15 分） | 暴力破解 | 有實作 | 無 |
| H12 | user-data 跨 user 讀寫 | 個資外洩 | JWT 綁 userId | 僅「無 token 401」 |

使用者點名的 8 條 **H1–H8 皆屬「產品級回歸風險」且目前自動化空白或僅概念覆蓋**。

---

## 3. 為什麼「CI 通過 ≠ 產品安全」

### 3.1 CI 驗證的是「正例可跑通」，不是「攻擊面關閉」

| CI 綠燈代表 | 不代表 |
|-------------|--------|
| Bundle 能建、前端能 init、少數 XSS helper 正常 | 伺服器授權矩陣正確 |
| 註冊／登入／建組／上傳文字／查詢答案有字 | 非成員、他組、匿名、弱角色被拒絕 |
| `/ready` store+auth（+RAG 可選）就緒 | 刪除一致性、限流、檔案 ACL、旗標誤設 |
| integration 在 `REQUIRE_ENTERPRISE_AUTH=1` 下 happy path | 本地／預設 env 行為與產線一致 |

### 3.2 結構性假安全感

1. **`npm test` 內的 security-api 可全綠而 HTTP 全 skip**  
   本機與 unit job 預設：`SKIP HTTP security tests` → 只證明 bcrypt 能 hash `847293`。

2. **權限雙軌未被測試暴露**  
   enterprise `document/add` = manager only；`/api/rag/document/*` = 任一 member。  
   coach-rag 只打後者且用建立者 token → **永遠測不到 RBAC 缺口**。

3. **無「拒絕」斷言文化**  
   assert 多為 `status === 200`；幾乎沒有「必須 401/403/400」的矩陣表（除 security-http 少數條）。

4. **無多租戶 fixture**  
   單 email、單 group、單 token → 跨群組／跨帳號攻擊路徑在測試資料層不存在。

5. **前端 check 與後端安全無關**  
   `check-security` = sanitizeHtml；`check-unsafe` = DOM id。通過 ≠ API 安全。

6. **過期腳本仍在 repo**  
   `check-handlers` / `check-ids` 假設 HTML 內聯 script，與模組化現況可能脫節，且未進 CI → 靜默失效。

7. **RAG Python smoke 不進 CI**  
   且直連 :8000，不經 proxy JWT → 與產品威脅模型不一致。

**結論**：CI 是 **可用性 + 窄 happy-path 回歸**；產品安全需要 **授權負向矩陣 + 雙寫一致性 + 環境旗標契約**，目前幾乎未自動化。

---

## 4. 建議測試金字塔與優先 10 個 case

### 4.1 建議金字塔（對齊現有腳本風格，不強推大框架）

| 層 | 比例（目標） | 內容 | 落地方式 |
|----|--------------|------|----------|
| **單元** | ~50% | `isValidManagerPin`、`assertRagGroupAccess` 純邏輯、`canAccessUpload`、body/size、token parse | 抽純函式或對 lib 直接 require；現多埋在 `api-proxy.js` → **可測性問題** |
| **整合（API）** | ~35% | 雙 user / 雙 group、RBAC、uploads、RAG 經 proxy、PIN 鎖定 | 擴充 `scripts/test-*.js` + fixture；進 integration job |
| **E2E** | ~15% | 教練選 KB 問答、主管上傳→成員查、刪除後 UI/API 一致 | 保留 coach-rag；補「刪除鏈」「member 拒寫」；瀏覽器 E2E 可後置 |

```
         ╱╲
        ╱E2E╲         教練+團隊關鍵旅程 2–4 條
       ╱──────╲
      ╱ 整合API ╲      授權矩陣 + 刪除一致性 + uploads
     ╱────────────╲
    ╱ 單元 / 契約  ╲   PIN、flag、限流、路徑規則、error 語意
   ╱────────────────╲
```

### 4.2 優先 10 個 case（建議實作順序）

| 優先 | Case ID | 層級 | 步驟摘要 | 期望 | 對應風險 |
|------|---------|------|----------|------|----------|
| **P1** | `AUTH-RAG-NO-JWT` | 整合 | 無 Bearer 打 `/api/rag/query` 與 `upload-text` | **401** | H3 |
| **P2** | `ISO-CROSS-GROUP-QUERY` | 整合 | UserA∈G1，UserB∈G2；B 帶 token query G1 | **403** | H1 |
| **P3** | `ISO-CROSS-GROUP-UPLOAD` | 整合 | 同上，B upload-text 到 G1 | **403** | H1 |
| **P4** | `RBAC-MEMBER-RAG-WRITE` | 整合 | G 內 member（非 manager）upload-text / delete | 目標 **403**（現況可能 200 → 當 bug 單） | H4 |
| **P5** | `UPLOADS-DENY-NON-MEMBER` | 整合 | manager 上傳得 `/uploads/x`；他組 user GET | **403**；無 token **401** | H2 |
| **P6** | `DELETE-NO-RETRIEVE` | 整合/E2E | 索引文件 → enterprise 或 RAG delete → query 關鍵句 | **不得再命中該內容** | H5 |
| **P7** | `PIN-WEAK-HTTP` | 整合 | create group pin=`0000`/`1234`/缺 pin | **400**（固定進 unit 也可 mock） | H7 |
| **P8** | `FILE-EMPTY-OVERSIZE` | 整合 | 空 content upload-text；>5MB base64；`.exe` | **400/413** 等明確失敗 | H6 |
| **P9** | `FLAG-ANON-AI-CONTRACT` | 整合 | `ALLOW_ANONYMOUS_AI` off：chat/rag 無 JWT 401；on 僅非 production 可開（或產線模擬拒絕） | 契約鎖定 | H8 |
| **P10** | `ENT-IDOR-MEMBERID` | 整合 | UserA 用 UserB 的 memberId assign/patch/notif | **403**（REQUIRE_ENTERPRISE_AUTH=1） | H9 |

其餘建議排隊：PIN 鎖定 429、`RAG_API_KEY` 錯 key、user-data 跨 user、rate limit 429、chat 無 key 500 語意。

---

## 5. 可測性問題（會卡住補測）

| 問題 | 影響 | 建議方向（分析，不實作） |
|------|------|--------------------------|
| **授權邏輯鎖在 `api-proxy.js` 巨型檔** | 難單元測 `assertRagGroupAccess` / PIN / upload ACL | 抽 `lib/middleware/*`（架構備忘已建議） |
| **無 fixture / 多 user 工廠** | 每支腳本自註冊，無法穩定雙租戶 | `createUserPair()`, `createGroupWithManagerAndMember()` |
| **整合測試需手動或 CI 起 API+RAG** | 本機 `npm test` 假綠；漏跑 integration 就漏安全 | 文件化 `dev:all` + 單一 `test:security-matrix`；unit 至少不 skip 純邏輯 |
| **`SECURITY_HTTP_TESTS` 預設關** | 安全測名存實亡 | unit 測純函式；HTTP 負向進 integration 必跑（CI 已部分做） |
| **正例與負例混在同一腳本且無 test runner** | 失敗訊息粗糙、難平行 | 可維持 node 腳本，但要 **編號 case + 彙總表** |
| **enterprise metadata 與 RAG index 兩條寫入** | E2E 難定義「刪除成功」 | 契約測必須同時查 list + query；未來單一 document-service |
| **RAG 依賴 embedding/LLM key** | coach-rag 在 CI 用 placeholder key，答案品質不穩定 | 檢索層用固定向量或 mock；只 assert status/sources 結構時較穩 |
| **共用 `enterprise-data.json` / `auth-users.json`** | 平行測污染、難 CI 隔離 | temp data dir + env 指向測試檔 |
| **`check-handlers` / `check-ids` 與模組化脫節** | 誤導或無法跑 | 淘汰或改掃 modules + data-lumina-action |
| **無瀏覽器 E2E harness** | 前端雙寫、token 存放、CORS 未覆蓋 | 優先 API 矩陣；UI E2E 第二階段 |
| **錯誤僅中文 `error` 字串** | 斷言 fragile | 架構備忘的 `code` 欄位落地後可穩定測 |

---

## 6. 驗收交付彙總

### 6.1 一句話

**現有資產能保證「主路徑能註冊、建組、問知識庫」；不能保證「跨租戶隔離、角色寫入、檔案 ACL、刪除後不可檢索、旗標與弱 PIN」——而這些才是產品安全回歸的核心。**

### 6.2 優先 case 表（交付用）

| # | Case | 嚴重度 | 現覆蓋 | 建議層 |
|---|------|--------|--------|--------|
| 1 | RAG 無 JWT → 401 | 高 | 無 | 整合 |
| 2 | 跨群組 query → 403 | 高 | 無 | 整合 |
| 3 | 跨群組 upload → 403 | 高 | 無 | 整合 |
| 4 | member RAG 寫入 → 403（或記已知缺陷） | 高 | 無（且現況可能放行） | 整合 |
| 5 | 非成員 GET `/uploads/*` → 403 | 高 | 無 | 整合 |
| 6 | 刪除後 query 不可命中 | 高 | 無 | 整合/E2E |
| 7 | 弱 PIN → 400 | 中高 | 僅 integration HTTP | 單元+整合 |
| 8 | 空檔／超大／非法類型 | 中 | 無 | 整合 |
| 9 | `ALLOW_ANONYMOUS_AI` 契約 | 中高 | 無 | 整合（env 矩陣） |
| 10 | 偽造 memberId IDOR | 高 | 無 | 整合 |

### 6.3 建議後續角色（依 Agents.md，不在本報告實作）

| 角色 | 動作 |
|------|------|
| @QA & Tester | 依 P1–P10 補腳本；拒絕矩陣進 CI integration |
| @Backend Architect | H4/H5 屬契約／RBAC，與 gap-memo P0 對齊後再改期望 |
| @Core Coder | 抽 middleware 提升可測性；修好 RBAC 後測才應全綠 |
| @Reviewer & Optimizer | 關鍵 API 變更 + 新安全測一併審 |

---

**本報告為純分析交付物：測試缺口報告 + 優先 case 表。未新增任何測試程式碼。**