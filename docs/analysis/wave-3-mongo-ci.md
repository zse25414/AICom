# Wave 3 — Mongo CI

| 項目 | 內容 |
|------|------|
| 日期 | 2026-07-12 |
| 狀態 | 已落地 |

## 目標

在 CI 驗證 **REQUIRE_MONGODB=1** 生產路徑（不可靜默降級 JSON）。

## 交付

| 產物 | 說明 |
|------|------|
| `scripts/test-mongo-path.js` | 斷言 `/health` → `database.mode=mongodb`；register / group / document |
| `npm run test:mongo` | 本機指令 |
| CI job `integration-mongo` | `mongo:6` service + API + 契約子集 |
| OPERATIONS / README | 本機重現步驟 |

## 驗證

- GitHub Actions：`integration-mongo` 綠
- 本機：見 OPERATIONS「Mongo 路徑」
