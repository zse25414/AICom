# Lumina 狀態契約（S / Store）

> 來源：`js/modules/core/store.js` → `globalThis.__LUMINA_STORE__`（**跨 lazy chunk 單例**）。

## 鐵律

1. **禁止**在 lazy chunk 內 `createStore()` 新實例。  
2. 新增 `S.xxx` 欄位必須登記本文件 + 預設值（domain/cache/ui/timers/collections）。  
3. 寫入任務後必須 `saveState()`（或明確的暫存路徑）。  
4. 教練不得在未 `rebuildTaskIndex` 時假設 `taskById` 最新（完成／刪除後注意）。

## 關鍵欄位（主路徑）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `S.tasks` | `Task[]` | 個人任務 SoT |
| `S.todayFocusTaskId` | number\|null | 今日焦點 |
| `S.focusSession` | object\|null | 專注／教練 session（可含 `coachActive`, `freeform`, `steps`） |
| `S.coachAgentMessages` | array | 教練對話（上限截斷） |
| `S.userProfile` | object | 含 `apiEnabled`, `apiMode`, `plan`（free/pro） |
| `S.enterpriseSession` | object\|null | 當前團隊 |
| `S.checkedRagKbs` | string[] | 教練勾選庫 |
| `S.ragServiceActive` | boolean | RAG 探活 |

## Task 最小形狀

```js
{
  id: number,
  name: string,
  duration: number,   // minutes
  energy: 1-5,
  category: string,
  due: 'YYYY-MM-DD',
  completed: boolean,
  updatedAt?: ISO string,
  kbIds?: string[],
  docIds?: string[],
  source?: string,    // demo | coach | quick_add | ...
  enterpriseTaskId?: string
}
```

## 事件（analytics）

見 `utils/analytics.js`：`track(name, props)` → `localStorage.lumina_analytics_v1`。

主路徑：`task_created` → `coach_start` → `task_completed` → `main_path_complete`（同 session）。

## 用量

見 `utils/usage.js`：`lumina_usage_v1`、`lumina_plan`。
