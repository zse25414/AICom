# Phase 5 — 三視角收口（規劃中）

> 承接 Phase 0–4。目標：使用者體驗 9、工程品質 9.5、投資敘事把「程式能備好的證據基礎」全部就位。
> 基線（2026-07-18 外部評測）：使用者 ~6.5、投資 ~5.5、主管 ~8。
> 誠實前提：投資視角的上限取決於試點結果（P5-B4），程式碼無法替代付費意願證據。

## 軌道 A — 使用者體驗 → 9

| ID | 交付 | 內容 | 驗收標準 |
|----|------|------|----------|
| P5-A1 | 無 key 首次體驗 | 偵測無 API key 改走引導模式：示範任務 + 規則式教練預錄流程，結尾接 key 設定嚮導（5 步 + 一鍵測試連線） | 全新用戶不設 key，5 分鐘內走完「建任務 → 教練帶做 → 完成勾選」 |
| P5-A2 | 聊天 UI 回歸防線 | Playwright 真瀏覽器測試 + 截圖 diff 進 CI，覆蓋三個歷史 bug 現場：CJK 泡泡直條、輸入框高度、行動版寬度（承接 Phase 3.1 待辦） | 三類歷史 UI bug 各有一條能抓到回歸的測試 |
| P5-A3 | 一鍵啟動 | `npm run setup` 互動精靈（檢查 Node／Python／venv／key／埠占用，人話診斷）；README 首屏補 Docker 單行啟動 | 新機器 clone 到看見 UI ≤ 3 個指令 |
| P5-A4 | 色弱友善驗證 | 主題 token 對比度檢查腳本；狀態色不只靠紅綠區分 | 檢查腳本進 `npm test` |

## 軌道 B — 投資敘事 → 證據基礎就位

| ID | 交付 | 內容 | 驗收標準 |
|----|------|------|----------|
| P5-B1 | LLM 供應商抽象 | `server/domain/llm.js` 改 adapter：DeepSeek／OpenAI 相容／Anthropic，env 切換 | 換供應商只改 env；三家各一條 contract test |
| P5-B2 | 金流最小閉環 | Team Pro 接 Stripe（或綠界）Checkout + webhook 升級配額；先做「付費牆存在」，不做完整訂閱管理 | 一個真實測試卡流程能把帳號升成 Pro |
| P5-B3 | 試點遙測（opt-in） | 本地 `track()` 加彙總上報端點 + 管理儀表：試點四指標（上傳 ≥3、KB 查詢 ≥5、完成 ≥10、付費意願）逐隊可見 | 儀表板直接顯示每隊達標進度，不用人工詢問 |
| P5-B4 | 🧑 試點執行（人工） | 照 `docs/business/PILOT-PLAYBOOK.md` 聯繫 5 個種子團隊、2 場訪談週記 | 2–3 隊走完 7 天試點 |

## 軌道 C — 工程品質 → 9.5

| ID | 交付 | 內容 | 驗收標準 |
|----|------|------|----------|
| P5-C1 | 憑證整治（最急） | 輪換 MongoDB Atlas 密碼（舊組已被 OneDrive 同步）；`.env` 改從同步範圍外掛載（如 `%USERPROFILE%\.lumina\env`），repo 只留 example | 舊密碼失效；同步資料夾內無真實密鑰 |
| P5-C2 | JWT 換庫 | 手寫 HMAC（`lib/auth.js`）換 `jose`，token 格式相容不登出現有 session | 現有 token 驗證通過 + auth 測試全綠 |
| P5-C3 | 測試遷移 vitest | 漸進式：新測試一律 vitest，舊 `test-*.js` 動到才遷；CI 加覆蓋率報告（先報告後門檻） | 3 個月 vitest 佔比 >50%；auth／quota／rag 權限 100% |
| P5-C4 | 前端模組化（兩步） | 步驟一：slices concat 改 esbuild 真 ESM bundle（不改程式碼結構）；步驟二：全域 `S` 加 JSDoc 型別 + `tsc --checkJs` 進 CI。不做完整 TS 重寫 | import graph 成立、可偵測循環依賴；typecheck 進 CI |
| P5-C5 | 資料層收斂 | 寫明「Mongo 為生產唯一路徑」落日計畫；file store 降級為純開發用，補退場日期 | `docs/engineering/STATE-CONTRACT.md` 更新 |

## 執行順序

1. **P5-C1** 憑證整治（半天；唯一有現實風險）
2. **P5-A1 + P5-A3** 無 key 體驗 + setup 精靈（2–3 天；使用者分數最大單點）
3. **P5-A2** Playwright 回歸防線（2 天；止住聊天 UI 失血）
4. **P5-B1 + P5-C2** LLM 抽象 + JWT 換庫（各 1 天；低風險高回報）
5. **P5-B2 + P5-B3** 金流 + 遙測（3–4 天；配合試點啟動時間）
6. **P5-C3／C4／C5** 長跑項目，隨日常開發漸進，不設衝刺

純開發工作量約 2–3 週（不含試點執行）。

## 完成定義

- [x] 無 key 新用戶可完整體驗主路徑（P5-A1：訪客＋範例任務＋離線教練原有；新增 key 嚮導 `coach/keywizard.js` + 離線升級提示）
- [x] Playwright UI 回歸測試進 CI 且綠（P5-A2：`npm run test:ui`，9 項斷言覆蓋 CJK 泡泡／輸入框高度／行動版 375px）
- [x] 新機器 3 指令內啟動（P5-A3：`npm run setup` 精靈；README 快速開始已更新）
- [x] 對比度檢查進 `npm test`（P5-A4：`scripts/check-contrast.js`；slate-500/600 a11y 覆寫後全數 ≥ AA）
- [ ] LLM 供應商 env 可切換（P5-B1）
- [ ] 測試卡可完成 Pro 升級（P5-B2）
- [ ] 試點儀表板四指標可見（P5-B3）
- [ ] 同步資料夾內無真實密鑰、Atlas 已輪換（P5-C1）
- [ ] `jose` 取代手寫 JWT 且相容（P5-C2）
- [ ] 覆蓋率報告進 CI（P5-C3 起點）
- [ ] ESM bundle + typecheck 進 CI（P5-C4）
- [ ] STATE-CONTRACT 落日計畫更新（P5-C5）

## 人工待辦（無法只靠程式）

- [ ] 輪換 MongoDB Atlas 密碼（P5-C1 的人工半步；需登入 Atlas 後台）
- [ ] 聯繫 5 個種子團隊、2 場訪談週記（P5-B4）
- [ ] 金流商戶申請（Stripe／綠界帳號，P5-B2 前置）

## 刻意不做（防失焦）

- 完整 TypeScript 重寫（漸進 JSDoc typecheck 取代）
- 完整訂閱管理後台（先驗證付費牆）
- i18n 多語（等 wedge 市場驗證後再議）

## 下一階段

→ 視 P5-B4 試點結果決定：有付費意願證據 → 融資敘事／擴編；無 → 回頭修 wedge 定位。
