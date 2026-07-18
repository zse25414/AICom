# Frontend Slices — 模組職責

> 只改這裡，再 `npm run build`。`js/lumina-app.js` 與 `generated/*` 是產物。

| Slice | 任務 | Bundle |
|-------|------|--------|
| `theme/` | 主題 token | core |
| `dom/` | DOM 小工具 | core |
| `utils/` | 純函式工具 | core |
| `bridge/actions` | 事件委派 | core |
| `auth/` | 登入註冊 session | core |
| `notifications/` | 團隊通知鈴 | core |
| `rag/client` | RAG HTTP 客戶端 | core |
| `rag/health` | RAG 健康與 KB 勾選 | core |
| `storage/*` | 持久化 / API key | core |
| `tasks/*` | 任務、專注、排程、評分 | core |
| `ui/dashboard` | 今日首屏 | core |
| `ui/navigation` | 導覽、快捷鍵 | core |
| `ui/onboarding` | 新人引導 / simple-mode | core |
| `ui/insights` | 數據洞察頁 | core |
| `ui/feedback` | toast / confetti | core |
| `ui/pwa` | SW / install | core |
| `enterprise/team-boot` | 企業 boot 常數與就緒 | core |
| `boot/init` | 啟動編排 | core |
| `coach/*` | 教練對話、拆解、方案 | **lazy** |
| `enterprise/team` | 團隊 UI 主體 | **lazy** |
| `enterprise/documents` | 知識庫文件 | **lazy** |

跨 slice 依賴：透過 `S` store 與已 export 的函式；避免 slice 互相 import（建置為 concat）。

完整系統地圖：`docs/architecture/MODULES.md`。
