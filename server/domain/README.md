# Domain 模組（純領域 + HTTP handlers）

| 模組 | 任務 |
|------|------|
| util | clampText / uid / normalizeCode / parseQuery |
| pin | 主管 PIN |
| rate-limit | 限流桶 |
| llm | chat body / api_base allowlist |
| http | CORS / JSON / errors |
| auth-mw | JWT require* |
| enterprise/* | 群組、KB、文件 |
| rag/ops | RAG 代理與索引編排 |
| handlers/* | HTTP 適配 |

跨域呼叫統一 api.fn(...)；同域內可直接呼叫。
