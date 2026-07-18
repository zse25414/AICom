# Phase 2 — 信任與變現（進行中）

> 承接 Phase 0+1。目標：投資敘事可講、使用成本可見、試點可執行。  
> 一句話：**用團隊知識庫，一步一步帶你做完「今天最重要的一件事」。**

## 本階段交付（程式 + 文件）

| ID | 交付 | 狀態 |
|----|------|------|
| P2-M | 定位一頁紙 | `docs/business/ONE-PAGER.md` |
| P2-P | 試點手冊與成功定義 | `docs/business/PILOT-PLAYBOOK.md` |
| P2-E-1 | AI 使用／成本本地儀表 | `utils/usage.js` + 設定頁 |
| P2-E-2 | 免費／Pro 日配額 | 同上；設定可切試點 Pro |
| P2-E-3 | 教練回覆短 TTL 快取 | coach agent + usage cache |
| P2-V | 空命中 CTA 維持 + 用量可見 | 設定頁 + track |
| P2-T | `npm run test:phase02` | 契約測試 |

## 試點成功定義（產品）

每隊 7 天內：

1. 上傳 ≥3 份文件且索引成功  
2. 教練查 KB ≥5 次  
3. 任務完成 ≥10 次  
4. 至少 1 人願意口頭/書面討論付費  

## 完成定義

- [x] 商業文件落地  
- [x] 設定頁可見今日 AI／RAG 用量與估算成本  
- [x] 免費層額滿有提示（可開試點 Pro）  
- [x] 相同教練查詢 5 分鐘內走快取  
- [x] `npm test` 含 phase02  

## 人工待辦（無法只靠程式）

- [ ] 聯繫 5 個種子團隊（見 PILOT-PLAYBOOK）  
- [ ] 完成至少 2 場訪談週記  

## 下一階段

→ **Phase 3**：`docs/roadmap/PHASE-3.md`（E2E、狀態契約、SLO、runbook、chunk 錯誤邊界）
