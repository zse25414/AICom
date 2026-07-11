# 架構備忘已交付

完整文件：[`docs/architecture/team-rag-api-gap-memo.md`](docs/architecture/team-rag-api-gap-memo.md)  
（只設計、無 code；明確排除前端像素與測試腳本細節）

---

## 一句話結論

現況是 **「群組隔離 RAG + 隱式多 KB + 文件 metadata 半成品」**；TeamPlan 要的 **KB 一級 CRUD、版本／軟刪除、manager 寫入權限、穩定 citations／錯誤碼** 尚未成型。建議：**api-proxy = 權限與 metadata 真相；rag_service = 索引／檢索引擎**。

---

## 現況 vs 缺口（精要）

| 面向 | 現況 | 缺口 |
|------|------|------|
| 多 KB | 上傳帶 `kb_id` 隱式建目錄；`GET /api/rag/kb/list` 只回 `kb_ids[]` | 無 create／rename／delete／displayName |
| 文件 | `enterprise.documents[]` + 前端雙寫 RAG | 無版本、硬刪、無 `rag.status`、id 與索引鍵不一致 |
| 權限 | enterprise 上傳限 manager；**RAG upload/delete 任一成員可打** | 與 TeamPlan 衝突 → **P0** |
| 跨群組 | 403「你不是此群組成員」 | 缺穩定 `code`（如 `GROUP_FORBIDDEN`） |
| query | 已有 `kb_ids`、最小 `sources` | 缺 `citations`（document_id、title、snippet、version） |

**KB CRUD 決策：需要獨立 CRUD**（方案 B），不能只靠上傳隱式建立。

---

## 目標分層與模型

- **KnowledgeBase**：`(groupCode, id)`、displayName、status、軟刪  
- **Document**：穩定 `id`、`kbId`、`currentVersion`、`status`、`rag.{status, refDocId, chunks}`  
- **DocumentVersion**：P1 完整歷史；P0 只遞增 `currentVersion` 並覆寫索引  
- **索引鍵**：由 `group::kb::filename` → **`group::kb::document_id`**（遷移期 dual-key）

JSON：嵌在 group 的 `knowledgeBases` + `documents[]`。  
Mongo：P0 可仍嵌套；**P1 建議拆** `knowledge_bases` / `documents` collection。

---

## P0 優先（破壞性風險）

| 項目 | 風險 |
|------|------|
| RAG 寫入限 manager + 錯誤 `code` | 中（曾直打 upload 的 member 會 403） |
| KB create／list／delete + list 相容 `kb_ids` + `items` | 低～中 |
| Document 軟刪 + RAG 同步 | 中 |
| query 同時回 `sources` + `citations` | 低 |
| `document_id` 關聯索引 | 中 |

P1：版本歷史、restore、deprecate enterprise document/*、Mongo 拆集合。  
P2：審計、棄用 `sources`、外移向量庫等。

---

## api-proxy 模組邊界（不實作）

建議切：`routes/rag/{kb,documents,query}`、`services/{kb,document,rag-index-bridge}`、`middleware/rbac`；**rag_service 不碰 JWT／角色**。

---

## 給 @Core Coder 的實作邊界

**應做：** RBAC、`code` 錯誤、KB metadata、軟刪編排、citations 正規化、路由抽離、path 相容。  
**不做：** UI、測試腳本、部署遷移執行、在 Python 層做會員角色、知識圖譜／OCR 大改。

建議 PR 切片：A RBAC → B KB → C 軟刪+document_id → D citations → E 檔案切分 → F 版本（P1）。

---

## 交接

| 角色 | 動作 |
|------|------|
| **@Lumina Planner** | 依備忘 §6／§7.3 排程 |
| **@Core Coder** | 核准後實作，守 §7 邊界 |
| **@Reviewer & Optimizer** | PR-A／C 必審 RBAC 與刪除一致性 |

若產品改為「member 也可上傳」，需重開權限決策後再改契約。