# Phase 0 + 1 執行建案（進行中）

> 目標：大眾主路徑 → 9 分方向；工程可量測／可回歸。  
> 產品一句話（90 天凍結）：**用團隊知識庫，一步一步帶你做完「今天最重要的一件事」。**

## Phase 0 — 凍結與基準

### 範圍凍結（In）

1. 註冊／登入  
2. 今日快加任務  
3. 選任務 → 教練帶做  
4. 完成 → 下一件  
5. （可選）團隊文件 → 教練引用  

### 範圍凍結（Out — 本階段不開新 feature）

- 洞察／週報大改  
- 新第三方整合  
- 教練整頁視覺重構（僅允許 bugfix + token 收斂）  
- 新 RAG 架構實驗進 main  

### 埋點事件（`track(name, props)`）

| 事件 | 時機 |
|------|------|
| `session_boot` | App 初始化成功 |
| `task_created` | 快加／排程新增／demo／教練抽待辦 |
| `demo_seeded` | 一鍵體驗 |
| `coach_open` | 進入教練並選定／無任務 |
| `coach_start` | 點「帶我做」開始引導 |
| `coach_message` | 送出教練訊息 |
| `coach_error` | 教練 AI／RAG 失敗降級 |
| `rag_empty` | 有查 KB 但 0 來源 |
| `task_completed` | 任務勾完成 |
| `main_path_complete` | 同 session 內 task_created→coach_start→task_completed |

事件本地緩衝：`localStorage.lumina_analytics_v1`（最近 200 筆），供本機驗收與未來上傳。

### 基準錄影 checklist（人工）

- [ ] 冷啟動 0 任務 → 一鍵體驗 → 帶做 → 完成  
- [ ] 快加任務 → 教練帶做 → 完成  
- [ ] （可選）團隊上傳 1 文件 → 教練有引用或空命中 CTA  

---

## Phase 1 — 主路徑極簡 + 教練穩定

| ID | 工作 | 狀態 |
|----|------|------|
| P1-IA-1 | 首屏一句話 + 新人 3 CTA | 本 PR |
| P1-IA-2 | simple-mode 藏次要雜訊 | 本 PR |
| P1-C-* | 輸入框單行增高、使用者氣泡橫向 | 已合入／維持 |
| P1-Q-1 | `docs/UI-COACH.md` design tokens | 本 PR |
| P1-Q-2 | `npm run test:phase01` 埋點與契約 smoke | 本 PR |

### 完成定義（Phase 0+1）— 2026-07-18 已落地

- [x] 凍結文件落地（本檔 + `docs/UI-COACH.md`）  
- [x] `track` 可寫入 localStorage（`js/modules/slices/utils/analytics.js`）  
- [x] 主路徑關鍵點有埋點  
- [x] 首屏文案與新人 CTA 對齊一句話  
- [x] `npm test` + `npm run test:phase01` 綠  
- [ ] 人工基準錄影 2 支（見上 checklist）  

### 本機驗收埋點

瀏覽器 console：

```js
getAnalyticsSummary()
getAnalyticsEvents(20)
```

---

## 下一階段

→ **Phase 2 已開工並落地**：見 `docs/roadmap/PHASE-2.md`。
