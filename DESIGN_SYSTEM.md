# ZTFI-News 设计系统 / Design System v1.0

> 面向「涨停财经聚合播报」深色金融主题的规范化 UI 重构。
> 本文档为单一事实来源，对应 Ardot 设计稿：fileId `719453093533269`。

> ⚠️ **范围勘误**：本项目包含两个界面表面。
> - **宣传展示页 `ztfi-news-landing.html`**：使用下方深蓝 `#1A237E` + 金 `#FFC107` 的深色金融主题。
> - **桌面客户端 `renderer/index.html`**：使用 `UI_DESIGN_SPEC.md` 中定义的 GitHub 蓝 `#0366D6` / `#58A6FF` 浅色/深色双主题，窗口默认 **500×800**。
> 下文令牌主要针对宣传展示页；桌面客户端真实形态与令牌见附录 A。

---

## 0. 设计规范已融入代码（Renderer Design Tokens）

桌面客户端的设计规范已落地为前端代码里的 **Design Token 单一事实来源**，所有组件统一用 `var(--token)` 引用，**禁止在业务代码里写死 hex / px**（颜色、圆角、间距、字号）。

- **Token 定义位置**：`renderer/style.css` 的 `:root`（亮色常量与全局固定语义色）+ `body.dark-mode`（暗色覆盖）。
- **随主题切换的颜色**：`--bg/--bg-card/--text/--accent/--stock-up/--stock-down/--green/--red` 等由 `renderer/themes.js` 的 5 个预设主题与 `ALL_THEME_VARS` 控制；圆角/间距/字阶/阴影为全局常量，**不随皮肤切换**。
- **本次新增的 Token（对应 Ardot 规范板 719463203883100）**：

  | 类别 | 变量 | 值 |
  |------|------|-----|
  | 圆角 | `--radius-dialog` / `--radius-card` / `--radius-btn` / `--radius-tag` / `--radius-pill` | 10 / 8 / 6 / 4 / 16px |
  | 间距 | `--space-xs` / `--space-sm` / `--space-md` / `--space-lg` / `--space-xl` / `--space-2xl` | 4 / 6 / 8 / 10 / 12 / 16px |
  | 字阶 | `--fs-h0` / `--fs-h1` / `--fs-h2` / `--fs-h3` / `--fs-body` / `--fs-body-sm` / `--fs-caption` / `--fs-label` / `--fs-micro` | 36 / 18 / 16 / 15 / 14 / 13 / 12 / 11 / 10px |
  | 阴影 | `--shadow-sm` / `--shadow-md` / `--shadow-lg` | 见 style.css（暗色下自动覆盖）|
  | 语义色 | `--risk-text` / `--risk-bg` / `--danger-icon` / `--warn-bar-text` / `--warn-bar-bg` | 收口 index.html 硬编码 |

- **已收口的硬编码**：`index.html` 风险条文字、`赞赏心/关闭叉 SVG`（`fill` → `var(--danger-icon)`）、设置面板投资提示框背景/边框/文字，均已改为 Token 引用。
- **使用约定**：新增组件一律 `var(--xxx)`；若需新语义色，先加进 `:root`（暗色语义同时加 `body.dark-mode`），不要在 HTML / JS 里直接写色值。

### 主题系统实现（5 预设皮肤 + 亮/暗切换）

桌面客户端的「主题」已恢复并接入，语义色按皮肤切换、结构令牌全局固定：

- **入口**：设置面板 →「主题皮肤」，5 个预设（科技蓝 / 护眼绿 / 经典黑 / 活力橙 / 少女粉）+ 1 张「亮/暗」卡，网格卡片一键切换。
- **代码位置**：`renderer/themes.js` 的 `ThemeSystem` 对象；`index.html` 已引入该文件并在设置面板渲染网格；`app.js` 的 `initThemeGrid()` 绑定点击与激活高亮。
- **每个预设覆盖完整 40 项语义色令牌**（含 `--stock-up/--stock-down` 涨红跌绿、`--bg-secondary`、`--priority-*-bg`、`--trial-*`、`--alert-*`、`--risk-*`、`--success/danger-*`、`--star-color` 等），切换通过往 `:root` 写行内变量实现，优先级高于任何类。
- **与暗色开关互斥**：`applyTheme` 会摘除 `body.dark-mode` 类，并用感知亮度 `_detectDarkTone` 联动原生标题栏（`set_theme`）明暗；右下角亮/暗开关与预设双通道并存、不打架。
- **修复的隐藏 bug**：`--bg-secondary` 此前被 style.css L633 / app.js 隐私表格引用却一直未定义（全局唯一「使用但未定义」变量），已补齐。

---

## 1. 设计原则

1. **品牌基因延续**：保留深蓝 `#1A237E`、金色 `#FFC107`、涨停红，但收敛为可调用的 Token。
2. **A股语义优先**：补全「涨红跌绿」语义色；`up` 用于涨停/盈利/正向异动，`down` 用于下跌/亏损/负向异动。
3. **深色金融氛围**：背景以 `#0D1421` 为底，表面色按层级上浮（sunken → surface → elevated）。
4. **Token 驱动**：颜色、间距、圆角、字阶全部命名化，禁止在业务代码里直接写死 px 与 hex。

---

## 2. 颜色体系 / Color System

### 2.1 CSS 变量

```css
:root {
  /* Brand Primary */
  --color-primary-50:  #EEF0FB;
  --color-primary-100: #D6DAF5;
  --color-primary-300: #7E8FDB;
  --color-primary-500: #1A237E;  /* 品牌主色 */
  --color-primary-600: #161E68;
  --color-primary-700: #0D123F;

  /* Accent */
  --color-accent-400: #FFD54F;
  --color-accent-500: #FFC107;    /* 财富/价值点缀 */
  --color-accent-600: #FFB300;
  --color-accent-700: #FFA000;

  /* Semantic：涨红跌绿 */
  --color-up-500: #F6465D;        /* 涨停 / 上涨 / 盈利 */
  --color-up-600: #D63147;        /* 深红：hover / 强调 */
  --color-down-500: #0ECB81;      /* 下跌 / 亏损 */
  --color-down-600: #0AA968;      /* 深绿：hover / 强调 */
  --color-info-500: #3D5AFE;      /* 提示 / 链接 */

  /* Neutral Surfaces */
  --color-bg-base:            #0D1421;
  --color-bg-sunken:          #0A0F1A;
  --color-bg-surface:         #1E2A3A;
  --color-bg-surface-hover:   #263545;
  --color-bg-elevated:        #243349;

  /* Borders */
  --color-border-subtle:      #2A3F5F;
  --color-border-strong:      #3A557F;

  /* Text */
  --color-text-primary:       #FFFFFF;
  --color-text-secondary:     #C5CEE0;
  --color-text-muted:         #8B9DC3;
  --color-text-disabled:      #5A6B85;
}
```

### 2.2 使用规则

| 场景 | Token |
|------|-------|
| 页面底色 | `--color-bg-base` |
| 卡片/浮层背景 | `--color-bg-surface` |
| 卡片 hover | `--color-bg-surface-hover` |
| 弹窗/抽屉 | `--color-bg-elevated` |
| 主要按钮 | `--color-primary-500` → hover `--color-primary-600` |
| 强调 CTA | `--color-accent-500` |
| 涨停/涨幅/盈利 | `--color-up-500` |
| 下跌/跌幅/亏损 | `--color-down-500` |
| 提示/链接 | `--color-info-500` |
| 默认边框 | `--color-border-subtle` |
| 聚焦/激活边框 | `--color-primary-300` |

---

## 3. 字体层级 / Typography

### 3.1 字体族

```css
:root {
  --font-ui:  "Noto Sans SC", "PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, sans-serif;
  --font-data: "JetBrains Mono", "Roboto Mono", "SF Mono", Menlo, Consolas, monospace;
}
```

- **UI 与正文**：Noto Sans SC，保证中文清晰。
- **行情/数字/时间**：JetBrains Mono 等宽，保证列对齐。

### 3.2 字阶

| Token | 字号 | 字重 | 行高 | 用途 |
|-------|------|------|------|------|
| `--font-display` | 40px | 700 | 1.2 | Hero 大标题 |
| `--font-h1` | 32px | 700 | 1.25 | 页面/区块标题 |
| `--font-h2` | 24px | 600 | 1.3 | 功能区块标题 |
| `--font-h3` | 20px | 600 | 1.4 | 卡片标题 |
| `--font-h4` | 18px | 600 | 1.4 | 列表标题 |
| `--font-body-lg` | 16px | 400 | 1.6 | 重点正文 |
| `--font-body` | 14px | 400 | 1.6 | 默认正文 |
| `--font-caption` | 13px | 400 | 1.5 | 辅助说明 / 时间戳 |
| `--font-label` | 12px | 500 | 1.4 | 标签 / 小字 |
| `--font-data` | 14px | 500 | 1.5 | 股票代码 / 涨跌幅 |

```css
:root {
  --font-display:  700 40px/1.2 var(--font-ui);
  --font-h1:       700 32px/1.25 var(--font-ui);
  --font-h2:       600 24px/1.3 var(--font-ui);
  --font-h3:       600 20px/1.4 var(--font-ui);
  --font-h4:       600 18px/1.4 var(--font-ui);
  --font-body-lg:  400 16px/1.6 var(--font-ui);
  --font-body:     400 14px/1.6 var(--font-ui);
  --font-caption:  400 13px/1.5 var(--font-ui);
  --font-label:    500 12px/1.4 var(--font-ui);
  --font-data:     500 14px/1.5 var(--font-data);
}
```

---

## 4. 间距规则 / Spacing

以 `4px` 为基准单位，全部使用 Token，禁止硬编码。

```css
:root {
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
}
```

### 4.1 推荐用法

| 场景 | Token |
|------|-------|
| 行内 / 图标与文字间隙 | `--space-1` |
| 小间隙 / 按钮组间距 | `--space-2` |
| 标签与字段之间 | `--space-3` |
| 卡片内部 padding 默认 | `--space-4` |
| 按钮高度 44px 内部留白 | `--space-5` |
| 卡片外部间距 / 表单组 | `--space-6` |
| 区块标题到内容 | `--space-6` |
| 大模块间距 | `--space-8` / `--space-10` |
| 页面级 section 间距 | `--space-12` / `--space-16` |

---

## 5. 圆角与阴影 / Radius & Elevation

```css
:root {
  --radius-sm:   6px;
  --radius-md:  10px;
  --radius-lg:  14px;
  --radius-xl:  20px;
  --radius-pill: 999px;

  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 12px 0 rgba(0, 0, 0, 0.45);
  --shadow-lg: 0 12px 32px 0 rgba(0, 0, 0, 0.5);
}
```

### 5.1 圆角使用规则

| Token | 用途 |
|-------|------|
| `--radius-sm` | 小标签、内部气泡 |
| `--radius-md` | 按钮、输入框、列表项 |
| `--radius-lg` | 卡片、资讯项 |
| `--radius-xl` | 大浮层、Hero 卡片 |
| `--radius-pill` | 标签 / Badge |

### 5.2 阴影使用规则

- `--shadow-sm`：hover 微升、输入框聚焦环投影。
- `--shadow-md`：主要按钮 hover、下拉菜单。
- `--shadow-lg`：抽屉、弹窗、新闻详情浮层。

---

## 6. 基础组件规范 / Components

### 6.1 Button 按钮

```css
.btn {
  height: 44px;
  padding: 0 var(--space-6);
  border-radius: var(--radius-md);
  font: var(--font-body);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  transition: all 150ms ease;
}

/* Primary */
.btn-primary {
  background: var(--color-primary-500);
  color: var(--color-text-primary);
}
.btn-primary:hover {
  background: var(--color-primary-600);
  box-shadow: var(--shadow-md);
}
.btn-primary:disabled {
  background: var(--color-bg-surface);
  color: var(--color-text-disabled);
  cursor: not-allowed;
}

/* Secondary */
.btn-secondary {
  background: transparent;
  color: var(--color-primary-300);
  border: 1px solid var(--color-primary-300);
}

/* Ghost */
.btn-ghost {
  background: transparent;
  color: var(--color-primary-300);
}

/* Accent */
.btn-accent {
  background: var(--color-accent-500);
  color: var(--color-bg-base);
  font-weight: 700;
}
```

### 6.2 Input 输入框

```css
.input {
  height: 44px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
  font: var(--font-body);
}
.input::placeholder {
  color: var(--color-text-muted);
}
.input:focus {
  outline: none;
  border-color: var(--color-primary-300);
}
```

### 6.3 Tag / Badge 标签

```css
.tag {
  height: 28px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-pill);
  font: var(--font-caption);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
}
.tag-up    { background: var(--color-up-500);   color: #FFFFFF; }
.tag-down  { background: var(--color-down-500); color: var(--color-bg-base); }
.tag-info  { background: var(--color-info-500); color: #FFFFFF; }
.tag-neutral {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-muted);
}
```

### 6.4 Card 资讯卡片

```css
.card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  box-shadow: var(--shadow-sm);
}
.card-title {
  font: var(--font-h3);
  color: var(--color-text-primary);
}
.card-summary {
  font: var(--font-body);
  color: var(--color-text-secondary);
}
.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: var(--space-4);
}
```

---

## 7. 落地检查清单

重构 UI 时逐条核对：

- [ ] `app.py` 与 `ztfi-news-landing.html` 中所有颜色替换为 `--color-*` Token。
- [ ] 所有字号替换为 `--font-*` Token。
- [ ] 所有 `px` 间距替换为 `--space-*` Token。
- [ ] 所有 `border-radius` 替换为 `--radius-*` Token。
- [ ] 涨跌展示统一使用 `tag-up` / `tag-down`，禁止混用 danger/success 反语义。
- [ ] 行情数字统一使用 `--font-data` 等宽字体。
- [ ] 卡片/按钮 hover 统一使用 `--color-bg-surface-hover` / `--shadow-md`。
- [ ] 深色模式下文本优先使用 `text-primary / secondary / muted / disabled` 四档。

---

## 8. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.1 | 2026-08-27 | 补充桌面客户端专属设计规范板（Ardot 719463203883100）；统一 A 股涨红跌绿语义（新增 --stock-up/--stock-down） |
| v1.0 | 2026-08-27 | 基于现有品牌色重构，补全涨/跌语义、间距、圆角、阴影、组件规范 |

---

## 附录 A：桌面客户端 UI 设计令牌

> 对应真实运行界面 `renderer/index.html` + `UI_DESIGN_SPEC.md`。
> - Ardot 真实界面预览：`719458984198705`
> - Ardot 桌面客户端设计规范板：`719463203883100`（本附录的色/字/间距/圆角/组件可视化）

### A.1 窗口与布局

| 项目 | 值 | 说明 |
|------|-----|------|
| 默认窗口尺寸 | 500×800 px | `app.py` 默认尺寸，最小 320×400，可拉伸 |
| 标题栏高度 | 32 px | 原生 Windows 标题栏（DWM 跟随深/浅主题） |
| 工具栏高度 | 40 px | 连接状态 + 8 个图标按钮 |
| 状态栏高度 | 28 px | 消息计数 / 赞赏 / 更新时间 / 主题切换 |
| 风险提示条 | 22 px | 橙色文字，底部状态栏上方 |
| 新闻卡片内边距 | 10 px 14 px | 上下 10，左右 14 |
| 新闻卡片间距 | 4 px | 卡片之间 |

### A.2 颜色系统（浅色模式默认）

```css
:root {
  --bg:            #ffffff;  /* 页面背景 */
  --bg-card:       #f8f9fa;  /* 卡片背景 */
  --bg-card-hover: #f0f1f3;
  --hover:         #f0f1f3;
  --border:        #e1e4e8;
  --text:          #1a1a1a;
  --text-secondary:#586069;
  --text-time:     #0366d6;  /* 时间戳 */
  --accent:        #0366d6;  /* 激活按钮 / 主要操作 */
  --green:         #28a745;  /* 成功 / 已连接 */
  --red:           #d73a49;  /* 错误 / 危险 / 关闭 */
  --orange:        #e36209;  /* 风险提示 / 未连接 */
  --stock-up:      #d73a49;  /* A股：上涨 → 红色 */
  --stock-down:    #28a745;  /* A股：下跌 → 绿色 */
  --tag-bg:        #f0f1f3;  /* 来源标签 */
  --keyword-tag-bg:#fff3cd;
  --keyword-tag-text:#856404;
}
```

### A.3 颜色系统（深色模式）

```css
[data-theme="dark"] {
  --bg:            #242526;
  --bg-card:       #3a3b3c;
  --bg-card-hover: #4e4f50;
  --hover:         #4e4f50;
  --border:        #4e4f50;
  --text:          #e4e6eb;
  --text-secondary:#a0a0a0;
  --text-time:     #58a6ff;
  --accent:        #58a6ff;
  --green:         #3fb950;  /* 成功 / 已连接 */
  --red:           #f85149;  /* 错误 / 危险 / 关闭 */
  --orange:        #e3b341;
  --stock-up:      #f85149;  /* A股：上涨 → 红色 */
  --stock-down:    #3fb950;  /* A股：下跌 → 绿色 */
  --tag-bg:        #3a3b3c;
  --keyword-tag-bg:#3a331a;
  --keyword-tag-text:#e3b341;
}
```

### A.4 字体层级

| 层级 | 字号 | 字重 | 用途 |
|------|------|------|------|
| H0 | 36px | 700 | 行情弹窗大数字 |
| H1 | 18px | Bold | 设置/对话框标题 |
| H2 | 16px | 600 | 行情弹窗标题 |
| H3 | 15px | Bold | 功能项标题（消息来源等） |
| Body | 14px | Regular | 开关项标签 |
| Body-Small | 13px | 600/Regular | **新闻标题**、正文默认 |
| Caption | 12px | Regular | **新闻摘要**、时间、状态 |
| Label | 11px | Medium | 来源标签、分类标签 |
| Micro | 10px | Medium | 徽章数字 |

字体：`font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;`

### A.5 圆角规范

| 组件 | 圆角 |
|------|------|
| 对话框 | 10px |
| 新闻卡片 | 8px |
| 按钮 | 6px |
| 来源标签 | 4px |
| 关键词/股票标签 | 12px（药丸） |
| Toggle | 11px |

### A.6 关键组件

**工具栏按钮**
```css
.btn-icon {
  width: 28px; height: 28px;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
}
.btn-icon.active {
  background: var(--accent);
  color: #fff;
}
```

**新闻卡片**
```css
.news-item {
  padding: 10px 14px;
  margin: 4px 8px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.news-title   { font-size: 13px; font-weight: bold; color: var(--text); }
.news-content { font-size: 12px; color: var(--text-secondary); }
.news-time    { font-size: 12px; color: var(--text-time); }
.news-tag     { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--tag-bg); }
```

**风险提示条**
```css
.risk-bar {
  height: 22px;
  background: #fff3e0;
  color: #e65100;
  font-size: 11px;
}
```

**状态栏**
```css
.statusbar {
  height: 28px;
  background: var(--bg-card);
  font-size: 11px;
  color: var(--text-secondary);
}
```

### A.7 待修正：涨跌幅颜色语义

当前 `UI_DESIGN_SPEC.md` 将 `--green` 用于上涨、`--red` 用于下跌（美股惯例）。
但本项目面向 A 股用户，**应采用「涨红跌绿」**：
- 上涨 / 涨停 / 正收益 → **红色** `#d73a49` / `#f85149`
- 下跌 / 跌停 / 负收益 → **绿色** `#28a745` / `#3fb950`

建议在后续迭代中将股票涨跌幅标签统一调整为 A 股语义，避免与内地用户习惯冲突。
