# Phase 3 — 工程機體（進行中）

> 目標：主管視角 9 分 — 可測、可恢復、可交接。  
> 承接 Phase 0–2。

## 交付清單

| ID | 交付 | 位置 |
|----|------|------|
| P3-D-1 | 狀態契約 | `docs/engineering/STATE-CONTRACT.md` |
| P3-D-2 | SLO | `docs/engineering/SLO.md` |
| P3-D-3 | 事故 Runbook | `docs/engineering/RUNBOOK.md` |
| P3-T-1 | 主路徑 E2E（jsdom） | `scripts/test-e2e-main-path.js` |
| P3-T-2 | 教練視覺契約（靜態） | `scripts/test-visual-coach-contract.js` |
| P3-T-3 | phase03 閘門 | `scripts/test-phase03.js` → `npm test` |
| P3-R-1 | chunk 載入失敗邊界 | build-app lazy + `showCoachChunkError` |

## 完成定義

- [x] 工程文件三份  
- [x] E2E 主路徑自動化綠  
- [x] 教練 CSS／HTML 契約防直條回歸  
- [x] 教練 chunk 失敗有 UI 提示  
- [x] `npm test` 含 phase03  

## 仍屬後續（Phase 3.1+）

- Playwright 真瀏覽器截圖 diff（可選安裝）  
- 多租戶跨 group 自動化（已有 security matrix，可加深）  
- 雙週「B 週只修品質」流程寫入團隊習慣  

## 下一階段

→ **Phase 4**：`docs/roadmap/PHASE-4.md`（模板、執行記憶、KB 健康、私有部署）
