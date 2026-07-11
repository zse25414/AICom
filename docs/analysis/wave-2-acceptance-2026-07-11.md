# Wave 2 驗收彙整

| 項目 | 內容 |
|------|------|
| 角色 | @Lumina Planner |
| 日期 | 2026-07-11 |
| main 基準 | `6c55bcc` + 後續 CI 掛載 commit |
| 決策 | D1 manager only；D2 ragStatus 可觀測；方案 B 本 Session 派工 |

---

## 1. 總裁決

| 波次 | 裁決 |
|------|------|
| **Wave 2** | ✅ **功能驗收通過（可進入維運／下一主題）** |
| 殘餘 | 非阻塞：RAG 服務在 CI/本機偶發 index Internal Server Error；restore 在 RAG wipe 失敗時正確不 soft-delete |

---

## 2. 卡片完成表

| 卡片 | 狀態 | 證據 |
|------|------|------|
| **W2-A** KB 一級 CRUD | ✅ | `POST/GET/DELETE /api/rag/kb*`；metadata `items`+`kb_ids` |
| **W2-B** 知識庫 tab + 空庫 UX | ✅ | 團隊一級 tab；空庫 banner；選庫不整塊隱藏 |
| **W2-C** Server RAG 同步 | ✅ | `orchestrateDocumentRagIndex`；reindex API；前端避免雙寫 |
| **W2-D** seed / backup / require-rag | ✅ | `npm run seed:demo`、`backup:rag`、check-ready `--require-rag` |
| **W2-E** 契約測試 | ✅ | `test-w2-kb-sync.js` 18/18；CI 步驟 |
| **W2-F** 文件版本 | ✅ | version/versions/restore API + UI `v{n}`；`test-w2-versions` 7/7 |
| **W2-REV P0** | ✅ | 幽靈索引補償；KB wipe 失敗閉合；uploads cascade；前端 ragDeleteOk |

---

## 3. 測試與 CI

| 指令 | 用途 |
|------|------|
| `npm run test:security-matrix` | W1 負向矩陣 |
| `npm run test:w2-kb` | W2-E KB/RBAC/document |
| `npm run test:w2-versions` | W2-F 版本契約 |
| `npm run test:integration` | 含上述腳本鏈 |
| CI integration-test | security-matrix + w2-kb + **w2-versions** + coach-rag |

---

## 4. 明確不做（維持）

- OCR / Word·MD 全格式  
- 知識圖譜 / 自動摘要 / `@KB`  
- 外移 Qdrant/Pinecone  
- 多版向量並存  
- Mongo collection 大拆  

---

## 5. 建議下一主題（Wave 3 候選）

| 優先 | 主題 | 說明 |
|------|------|------|
| P1 | 生產可觀測 | RAG index 錯誤分類、pending 輪詢/推送、health dashboard |
| P1 | Mongo CI job | 對齊 prod `REQUIRE_MONGODB` 主路徑 |
| P2 | member 可讀 KB list 正向測 + REST DELETE path | W2-E 剩餘缺口 |
| P2 | 版本 UI 不因 re-render 收合 | UX polish |
| P3 | 審計日誌 / 文件級 ACL 細分 | 企業合規 |

---

## 6. 給使用者

Wave 2 功能與契約測試已閉環。後續可：

1. 看 GitHub Actions 是否綠  
2. 選 Wave 3 主題開工  
3. 或本機 `npm run seed:demo` 做 demo 驗收  

**Planner 簽署：** Wave 2 ✅ 驗收通過  
