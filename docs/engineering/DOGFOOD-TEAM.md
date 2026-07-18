# Dogfood：團隊主路徑（P1-5）

目標：驗證「註冊 → 建群 → 加人／指派 → 知識庫 → 教練可問」閉環可在試點環境重現。

## 前置

- `npm run dev:all`（API :3001、RAG :8000、前端 :3456）
- `npm run test:ready` 建議帶 RAG 就緒

## 手動清單（約 10–15 分鐘）

| # | 步驟 | 預期 |
|---|------|------|
| 1 | 註冊／登入兩個帳號（主管 + 成員） | token 有效、設定顯示已登入 |
| 2 | 主管建立團隊（群組碼 + PIN） | 團隊頁顯示群組、角色 manager |
| 3 | 成員以群組碼加入 | memberships 含該群 |
| 4 | 主管指派一筆團隊任務 | 成員側可見或通知 |
| 5 | 完成任務 | completed 同步 |
| 6 | 上傳一段文字知識（一般庫） | 文件列表出現；索引成功或可重試 |
| 7 | 教練勾選知識庫，問庫內問題 | 回答含知識要點 + sources |
| 8 | 主管離開／成員離開 | session 清空、不串台 |

## 自動化

```bash
# 需 API（+ RAG 給 golden / coach-rag）
npm run test:enterprise
npm run test:e2e-team
npm run test:coach-rag
npm run test:rag-golden
```

## 通過標準

- 手動清單 1–7 無阻斷；8 可選  
- `test:e2e-team` 綠  
- RAG 路徑：`test:rag-golden` 至少通過門檻題數（見腳本輸出）

## 失敗時

見 `RUNBOOK.md` 第 3（RAG）、第 4（團隊串台）節；產品內 **設定 → 回報問題**。
