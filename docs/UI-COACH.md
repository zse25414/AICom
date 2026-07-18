# 教練 UI Design Tokens（禁止自由發揮）

變更教練介面前必讀。大改須附前後截圖，並跑 `npm run test:phase01`。

## 產品模式

| 模式 | 觸發 | UI |
|------|------|-----|
| 帶做 | 有任務 + 點「帶我做」 | 頂部任務 select + 步驟條 + 對話 |
| 問答 | 無任務或 freeform | 僅對話；可問知識庫 |

## 尺寸

| Token | 值 |
|-------|-----|
| 輸入預設 | **1 行**（`font-size 0.9rem × line-height 1.35`） |
| 輸入最大 | **6 行**，超出內捲 |
| 使用者氣泡 | `width: fit-content`；`max-width: min(85%, 28rem)`；**禁止** `min-w-0` 導致中文直條 |
| 教練訊息 | 左對齊 + 頭像；長文可折疊（約 6 行） |
| Composer bar | 緊湊 padding（約 0.28rem 垂直） |

## 互動

- Enter 送出、Shift+Enter 換行  
- 任務切換：頂部 `<select id="coach-task-select">`  
- `[選項: …]` 僅最後一則教練訊息顯示 chip  

## 回覆可讀性（必守）

- 結構：重點 2–3 句 → 3–6 步（可含簡短理由）→ 可選檢查點  
- 長度：約 220–480 字為宜，必要時到 ~600；上限約 2600  
- `normalizeCoachReplyText`：剝除 `**`、`#`、代碼塊後再顯示  
- 溫度約 0.55（不太乾、不太花）  
- 選項 chip 短（≤18 字）、每則 2–3 個  
- 禁止空泛一兩句；也禁止演講長文與花式 markdown

## 禁止

- 整頁重做教練 layout（無 RFC + 前後截圖）  
- 使用者氣泡使用 `word-break: break-word` + `min-width: 0` 的 shrink-to-fit 組合  
- 輸入框固定多行 `rows>=2` 或 `field-sizing: content` 造成空框過高  
- 鼓勵模型「深入、嚴謹、markdown 結構化」導致閱讀障礙的 prompt 文案
