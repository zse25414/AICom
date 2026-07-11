# UI Design Principles — AI Coding Instructions

> 将此文件内容粘贴到 AI coding agent 的系统提示中，或作为 `.cursorrules` / `CLAUDE.md` 的一部分。
> 来源：Linux DO Henry_He Vibe Coding 设计术语系列 + 实战经验

---

## 核心原则

**用英文设计术语沟通，不用中文模糊描述。**

| ❌ 不要说 | ✅ 要说 |
|-----------|--------|
| "高级感" | `refined visual hierarchy with generous whitespace` |
| "再改改" | `increase tracking to 0.02em, lighten neutral-500 to neutral-400` |
| "好看一点" | `use a 12-column grid, 24px gutter, card-based layout` |
| "颜色不对" | `primary color needs higher chroma in OKLCH, current feels muted` |

---

## 布局

### 栅格
- 默认使用 **12-column CSS Grid**，24px gutter，80px margin
- 卡片布局用 **Modular Grid**（行+列双重约束）
- 宽屏正文容器设 `max-width: 680px` 并居中

### 选择布局模式
- 文章/文档 → **Single-column**
- 后台/设置 → **Sidebar**（260px nav left + fluid content）
- 登录/对比 → **Split**（左右两大区）
- 商品/列表 → **Card Grid**（3-4 columns, 16px gap）
- 仪表盘 → **Dashboard**（KPI cards top + charts grid）
- 邮件/设置 → **Master-detail**（list left, detail right）

### 响应式
- Breakpoint 基于**内容何时撑不住**，非设备尺寸
- 移动端默认单栏，平板 2 栏，桌面 3-4 栏
- 使用 **Container Query** 而非全局 breakpoint（更精准）
- 移动端注意 **Safe Area**（刘海、手势条）

### 前端实现
- 页面骨架 → **CSS Grid**
- 导航栏/按钮组/卡片内部 → **Flexbox**
- 覆盖/固定 → `position: absolute/fixed/sticky`
- 层级问题先查父级 **Stacking Context**

---

## 文字排版

### 字体选择
- UI 界面 → **Sans-Serif**（Inter, system font stack）
- 长文阅读 → **Serif**（可选，中文用宋体/楷体系列）
- 代码 → **Monospace**（JetBrains Mono, Fira Code）

### 字号阶梯（REM 为准，PX 仅作参考）
```css
--text-xs:   0.75rem;   /* 12px — 辅助信息、标签 */
--text-sm:   0.875rem;  /* 14px — 正文（中文最小可读）*/
--text-base: 1rem;      /* 16px — 正文（推荐）*/
--text-lg:   1.125rem;  /* 18px — 引言、摘要 */
--text-2xl:  1.5rem;    /* 24px — H3 */
--text-4xl:  2rem;      /* 32px — H2 */
--text-6xl:  3rem;      /* 48px — H1 */
```

### 行高与字距
- 正文 `line-height: 1.5-1.7`
- 标题 `line-height: 1.1-1.3`, `letter-spacing: -0.02em`
- 按钮/标签 `letter-spacing: 0.01-0.04em`（正值，增加辨识度）
- 段落间距 ≈ 1 倍行高；模块间距用 spacing token，不写死

### 单位规则
- **字号/行高** → `REM`（全局缩放，无累乘）
- **组件内边距/间距** → `PX` 或 spacing token（稳定不随字号变化）
- **文本嵌套缩放** → `EM`（谨慎，只用于 padding 跟字号联动的场景）
- **输入框/代码块列宽** → `CH`
- **边框/阴影** → `PX`（像素精确，不随缩放）

### 加载
- 字体加载时用 **FOUT** 策略（先用系统字体，加载完切换）
- 设置 `font-display: swap`
- 代码中**禁用 Ligature**（`=>` 不能变连字）

---

## 间距系统

**必须用 spacing token，不写死数值。**

```css
/* Base 4px，8px 步进为主 */
--space-1:  4px;   /* xxs — icon gap，紧凑行内间距 */
--space-2:  8px;   /* xs  — 相邻元素间距 */
--space-3:  12px;  /* sm  — 表单字段内边距 */
--space-4:  16px;  /* md  — 默认内容区 padding */
--space-6:  24px;  /* lg  — 卡片内边距、网格 gutter */
--space-8:  32px;  /* xl  — 区块间距 */
--space-12: 48px;  /* xxl — 大区块分隔 */
--space-24: 96px;  /* section — 页面级章节间距 */
```

使用规律：
- 表单字段之间 → `--space-4`
- 卡片内边距 → `--space-6`
- 段落/卡片间 → `--space-8`
- 页面章节间 → `--space-12` ~ `--space-24`

---

## 组件规范

### Border Radius 阶梯
```css
--radius-none: 0px;      /* 全出血 banner/nav */
--radius-sm:   4px;      /* 输入框、复选框 */
--radius-md:   8px;      /* 卡片、下拉、提示框 */
--radius-lg:   12px;     /* 模态框、大容器 */
--radius-full: 9999px;   /* 按钮 pill、标签、开关 */
```

### Elevation / Shadow
```css
/* 无装饰阴影原则：深度来自表面颜色差异，阴影只用于交互反馈 */
--shadow-sm: 0 1px 3px rgba(0,0,0,0.08);                        /* 悬停卡片 */
--shadow-md: 0 4px 12px rgba(0,0,0,0.12);                       /* 下拉菜单、浮动操作 */
--shadow-lg: 0 8px 32px rgba(0,0,0,0.12);                       /* 模态框 */
--focus-ring: 0 0 0 3px rgba(var(--color-primary-rgb), 0.20);   /* 键盘焦点环 */
```
- 卡片静止态：无阴影（用表面色区分深度）
- 卡片 hover/pressed：升到 `--shadow-sm`
- 下拉/弹出层：`--shadow-md`
- 模态框：`--shadow-lg` + 遮罩层

### Z-index 分层
```css
--z-base:     0;    /* 默认文档流 */
--z-sticky:   10;   /* sticky header/footer */
--z-dropdown: 100;  /* 下拉菜单、tooltip */
--z-modal:    200;  /* 模态框、抽屉 */
--z-toast:    300;  /* toast 通知，最顶层 */
```
**铁律：不写裸数字 `z-index: 9999`，从 token 取值。**

### 动效规范
```css
/* 时长 */
--duration-micro:  100ms;   /* 颜色切换、状态点亮 */
--duration-fast:   150ms;   /* 按钮 hover/press */
--duration-base:   250ms;   /* 卡片 hover、下拉展开 */
--duration-enter:  350ms;   /* 模态框/抽屉进入 */

/* 缓动 */
--ease-out:    cubic-bezier(0.0, 0.0, 0.2, 1);   /* 元素进入 */
--ease-in-out: cubic-bezier(0.4, 0.0, 0.2, 1);   /* 元素移动 */
```
- 颜色/透明度过渡 → `--duration-micro` + `ease`
- 大多数交互反馈 → `--duration-fast` + `--ease-out`
- 模态框/抽屉 → `--duration-enter` + `--ease-out`
- 禁止对 layout/transform 用超过 400ms 的 transition

### 组件状态完备性

每个交互组件必须定义以下全部状态：

| 状态 | 视觉信号 |
|------|----------|
| `default` | 基础样式 |
| `hover` | 背景色变浅/加深 8%，`cursor: pointer` |
| `active / pressed` | 背景再加深 8%，轻微缩放 `scale(0.98)` |
| `focus-visible` | `--focus-ring` 焦点环，**不能 outline: none** |
| `disabled` | 50% 透明度或浅灰色，`cursor: not-allowed` |
| `loading` | spinner 替换图标或文字，禁止重复提交 |
| `error` | `--color-danger` 边框 + 红色 helper text |

**最小可触控区域 44×44px（WCAG AAA）**，小按钮可用透明 padding 扩展命中区。

---

### 使用 OKLCH
```
推荐 OKLCH 而非 HSL/Hex：
- oklch(0.6 0.2 250) — 更接近人眼感知
- 做色阶、深色模式、无障碍对比度时更稳定
```

### 调色盘（5 层）
| 层级 | 用途 | 数量 |
|------|------|:--:|
| **Primary** | 主按钮、品牌色 | 1 |
| **Secondary** | 次级按钮 | 1 |
| **Accent** | 促销标签、通知 | 1 |
| **Semantic** | success/danger/warning/info | 4 |
| **Neutral** | 50-950 灰阶 | 10 |

### 色阶（每个色 10 级）
- 50-100 → 浅色背景/提示底色
- 400-600 → 主体色
- 700-900 → 深色文字/按下状态

### Design Tokens
```
永远用语义令牌，不写死色值：
--color-primary: oklch(0.55 0.22 255);
--text-primary: var(--color-neutral-900);
--danger-bg: var(--color-red-100);
```

### 深色模式
⚠️ **不能简单反相浅色模式。** 主色和强调色需重新调明度/饱和度。
- 背景: neutral-900~950
- 文字: neutral-100~300
- 主色: 降饱和度 10-20%，提明度 5-10%

### WCAG 无障碍
| 级别 | 普通文本 | 大号文本 (18px+) |
|------|----------|-------------------|
| **AA**（最低）| ≥ 4.5:1 | ≥ 3:1 |
| **AAA**（推荐）| ≥ 7:1 | ≥ 4.5:1 |

- 色盲用户：信息不能只靠颜色，必须配合图标/文字/形状
- 所有交互元素需要 focus visible 样式

---

## Prompt 模板

### 布局
```
Create a [dashboard/admin/shopping/landing] page:
- 12-column CSS Grid, 24px gutter
- [key sections and their grid spans]
- Responsive: [breakpoint behavior]
- All interactive elements have focus visible states
```

### 文字
```
Typography system:
- Headings: Inter, tracking -0.02em, line-height 1.2
- Body: system sans-serif, 16px, line-height 1.6
- Code: JetBrains Mono, 14px
- Scale: 12/14/16/18/24/32/48px
```

### 色彩
```
Color system (OKLCH):
- Primary: vibrant blue, use for main CTAs
- Neutral: 50-950 gray scale
- Semantic: green success, red danger, amber warning
- WCAG AA: body text ≥ 4.5:1 contrast
- Light + dark mode via CSS custom properties
```

---

## 检查清单

提交前确认：

- [ ] 所有色值通过 Design Tokens 引用（不写死 Hex）
- [ ] 正文对比度 ≥ 4.5:1（AA 级）
- [ ] 深色模式不是简单反相
- [ ] 移动端 Safe Area 未被遮挡
- [ ] 交互元素有 `focus-visible`（**不能 `outline: none`**）
- [ ] 色盲测试：信息不完全依赖颜色区分
- [ ] 字号阶梯使用 `REM`，边框/阴影使用 `PX`
- [ ] 代码中禁用 Ligature
- [ ] 字体加载使用 `font-display: swap`
- [ ] 间距全部来自 `--space-*` token，无裸数值
- [ ] Border radius、shadow、z-index 全部来自 token
- [ ] 组件状态完备：default / hover / active / focus / disabled / loading / error
- [ ] 最小触控区域 ≥ 44×44px
- [ ] 动效时长不超过 400ms，使用规范 easing
- [ ] `z-index` 无裸数字，从 `--z-*` token 取值
