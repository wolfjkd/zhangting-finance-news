# 涨停财经聚合播报 - UI设计规范

> **版本**：v1.0  
> **生效日期**：2026-07-01  
> **适用范围**：涨停财经聚合播报前端界面开发  
> **制定人**：AI助手  

---

## 目录

- [一、字体规范](#一字体规范)
  - [1.1 字体家族](#11-字体家族)
  - [1.2 字体层级体系](#12-字体层级体系)
  - [1.3 字体缩放机制](#13-字体缩放机制)
- [二、颜色系统](#二颜色系统)
  - [2.1 中性色系（亮色模式）](#21-中性色系亮色模式)
  - [2.2 中性色系（暗色模式）](#22-中性色系暗色模式)
  - [2.3 功能色系](#23-功能色系)
  - [2.4 语义色系](#24-语义色系)
- [三、间距规范](#三间距规范)
- [四、组件样式统一性](#四组件样式统一性)
  - [4.1 对话框规范](#41-对话框规范)
  - [4.2 按钮规范](#42-按钮规范)
  - [4.3 Toggle 开关规范](#43-toggle-开关规范)
  - [4.4 标签规范](#44-标签规范)
- [五、响应式设计规则](#五响应式设计规则)
- [六、其他重要UI元素](#六其他重要ui元素)
  - [6.1 圆角规范](#61-圆角规范)
  - [6.2 动画规范](#62-动画规范)
  - [6.3 状态指示器](#63-状态指示器)
- [七、设计原则](#七设计原则)

---

## 一、字体规范

### 1.1 字体家族

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
```

**设计原则**：
- 优先使用系统原生字体，保证跨平台一致性
- 中文使用 Microsoft YaHei，确保良好的中文显示效果
- 回退到 sans-serif，保证兼容性

### 1.2 字体层级体系

| 层级 | 字号 | 字重 | 用途示例 |
|------|------|------|----------|
| **H0** | 36px | 700 | 行情弹窗中股票价格的大字体显示 |
| **H1** | 18px | bold | 设置页面标题、对话框主标题 |
| **H2** | 16px | 600 | 行情弹窗标题、对话框子标题 |
| **H3** | 15px | bold | 设置功能项标题（如"消息来源"）、自选股名称 |
| **Body** | 14px | normal | 设置开关项标签（如"开启语音播报"） |
| **Body-Small** | 13px | 600/normal | 新闻标题、正文默认、自选股代码 |
| **Caption** | 12px | normal | 新闻内容、时间、状态文字、描述文字 |
| **Label** | 11px | 500 | 新闻来源标签、分类标签 |
| **Micro** | 10px | 500 | 优先级徽章、小红点数字 |

**层级关系图**：

```
H0 (36px) ──────────────── 股票价格显示
    ↓
H1 (18px, bold) ────────── 设置、对话框标题
    ↓
H2 (16px, 600) ─────────── 行情弹窗标题
    ↓
H3 (15px, bold) ────────── 功能项标题（消息来源、语音播报...）
    ↓
Body (14px, normal) ────── 开关项标签（开启语音播报...）
    ↓
Caption (12px, normal) ─── 描述文字（灰色小字说明）
    ↓
Label (11px, 500) ──────── 来源标签
    ↓
Micro (10px, 500) ──────── 小红点数字
```

### 1.3 字体缩放机制

所有字号均使用 `calc(px * var(--font-scale))` 进行缩放：

```css
:root {
  --font-scale: 1.0;  /* 默认正常大小 */
}
```

**使用示例**：
```css
.settings-header h3 {
  font-size: calc(18px * var(--font-scale));  /* 标题 */
}
.setting-label {
  font-size: calc(14px * var(--font-scale));  /* 开关标签 */
}
.setting-hint {
  font-size: calc(12px * var(--font-scale));  /* 描述文字 */
}
```

**好处**：只需修改 `--font-scale` 一个变量，就能全局调整字体大小。

---

## 二、颜色系统

### 2.1 中性色系（亮色模式）

| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--bg` | #ffffff | 页面背景（白色） |
| `--bg-card` | #f8f9fa | 卡片背景（浅灰白） |
| `--bg-card-hover` | #f0f1f3 | 鼠标悬停时的背景色 |
| `--hover` | #f0f1f3 | 通用悬停背景色 |
| `--border` | #e1e4e8 | 边框颜色（浅灰） |
| `--text` | #1a1a1a | 主文字颜色（深黑） |
| `--text-secondary` | #586069 | 次要文字颜色（中灰） |
| `--text-time` | #0366d6 | 时间文字颜色（蓝色） |
| `--tag-bg` | #f0f1f3 | 标签背景色 |

### 2.2 中性色系（暗色模式）

| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--bg` | #242526 | 页面背景（深灰黑） |
| `--bg-card` | #3a3b3c | 卡片背景（中灰） |
| `--bg-card-hover` | #4e4f50 | 鼠标悬停时的背景色 |
| `--hover` | #4e4f50 | 通用悬停背景色 |
| `--border` | #4e4f50 | 边框颜色（深灰） |
| `--text` | #e4e6eb | 主文字颜色（浅灰白） |
| `--text-secondary` | #a0a0a0 | 次要文字颜色（中灰） |
| `--text-time` | #58a6ff | 时间文字颜色（亮蓝） |
| `--tag-bg` | #3a3b3c | 标签背景色 |

### 2.3 功能色系（亮色/暗色共用）

| 变量名 | 亮色模式 | 暗色模式 | 用途 |
|--------|----------|----------|------|
| `--accent` | #0366d6 | #58a6ff | **主色调（蓝色）**，用于强调、激活状态、按钮 |
| `--green` | #28a745 | #3fb950 | 上涨、成功、已连接状态 |
| `--red` | #d73a49 | #f85149 | 下跌、错误、危险、关闭按钮 |
| `--orange` | #e36209 | #e3b341 | 警告、未连接状态 |

**使用场景**：
- `--green`：股票上涨显示绿色数字
- `--red`：股票下跌显示红色数字，关闭按钮用红色叉号
- `--orange`：网络未连接时显示橙色圆点
- `--accent`：选中状态、主要按钮、链接颜色

### 2.4 语义色系

| 变量名 | 亮色模式 | 暗色模式 | 用途 |
|--------|----------|----------|------|
| `--priority-critical-bg` | #fff5f5 | #4a1a1a | 紧急优先级消息背景（红色调） |
| `--priority-high-bg` | #fff8f0 | #4a331a | 高优先级消息背景（橙色调） |
| `--priority-medium-bg` | #fffdf0 | #4a4a1a | 中优先级消息背景（黄色调） |
| `--keyword-tag-bg` | #fff3cd | #3a331a | 关键词标签背景 |
| `--keyword-tag-text` | #856404 | #e3b341 | 关键词标签文字颜色 |
| `--highlight-bg` | #fff176 | #4a4a1a | 关键词高亮背景（浅黄色） |
| `--highlight-text` | #333 | #e4e6eb | 关键词高亮文字颜色 |
| `--success-bg` | #d4edda | #1a3a1a | 成功提示背景 |
| `--success-text` | #155724 | #3fb950 | 成功提示文字 |
| `--danger-bg` | #f8d7da | #3a1a1a | 危险/错误提示背景 |
| `--danger-text` | #721c24 | #f85149 | 危险/错误提示文字 |

---

## 三、间距规范

### 3.1 基础间距体系

| 间距名称 | 像素值 | 用途 |
|----------|--------|------|
| 紧凑 | 4px | 标签间距、行内小元素 |
| 标准 | 6px | 按钮间距、小元素间距 |
| 中等 | 8px | 卡片内边距、元素间距 |
| 宽敞 | 10-12px | 区域间距、模块间距 |
| 宽松 | 14-16px | 对话框内边距、大区域 |

### 3.2 常用间距组合

**新闻列表项**：
```css
.news-item {
  padding: 10px 14px;  /* 上下10px，左右14px */
  margin: 4px 8px;     /* 上下4px，左右8px */
}
```

**设置面板**：
```css
.settings-section {
  padding: 12px 16px;  /* 每个功能区块的内边距 */
}
.setting-row {
  padding: 6px 0;      /* 每个开关行的上下间距 */
}
```

**对话框**：
```css
.dialog-content {
  padding: 14px 16px;  /* 内容区域内边距 */
}
```

---

## 四、组件样式统一性

### 4.1 对话框规范

**适用范围**：设置、收藏、复盘报告、历史消息搜索、导出消息、数据源管理等所有弹窗

**宽度规范**：
```css
width: 90%;
max-width: 420px;
```

**视觉风格**：
- 圆角：`border-radius: 10px`
- 边框：`1px solid var(--border)`
- 阴影：`0 8px 32px rgba(0,0,0,0.15)`
- 背景：`var(--bg)`
- 最大高度：`max-height: 80vh`（超出部分可滚动）

**头部规范**：
```css
.dialog-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
```

**关闭按钮规范**：
```css
.dialog-close-btn {
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
}
.dialog-close-btn:hover {
  background: rgba(229,57,53,0.1);  /* 红色半透明背景 */
}
.dialog-close-btn svg {
  width: 20px;
  height: 20px;
  fill: #e53935;  /* 红色叉号 */
}
```

**HTML结构规范**：
```html
<div class="xxx-dialog">
  <div class="xxx-header">
    <h3>标题</h3>
    <button class="dialog-close-btn" title="关闭">
      <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    </button>
  </div>
  <div class="xxx-content">...</div>
</div>
```

### 4.2 按钮规范

**通用按钮**：
```css
.btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius);  /* 6px */
  transition: all 0.15s;
}
.btn:hover {
  background: var(--bg-card-hover);
  color: var(--text);
}
.btn-icon {
  width: 28px;
  height: 28px;
}
```

**主要按钮**（如"添加自选"）：
```css
.primary-btn {
  padding: 10px 16px;
  background: var(--accent);  /* 蓝色背景 */
  color: #fff;               /* 白色文字 */
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
```

### 4.3 Toggle 开关规范

```css
.toggle {
  width: 40px;
  height: 22px;
}
.toggle-slider {
  background: var(--border);  /* 关闭状态：灰色 */
  border-radius: 11px;        /* 圆角等于高度一半 */
}
.toggle-slider::before {
  height: 16px;
  width: 16px;
  background: var(--toggle-knob);  /* 白色圆点 */
  border-radius: 50%;
}
/* 开启状态 */
.toggle input:checked + .toggle-slider {
  background: var(--accent);  /* 蓝色 */
}
.toggle input:checked + .toggle-slider::before {
  transform: translateX(18px);  /* 圆点右移 */
}
```

### 4.4 标签规范

**新闻来源标签**（如"财联社"）：
```css
.news-tag {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}
```

**关键词标签**（如"特朗普"）：
```css
.keyword-tag {
  padding: 3px 8px;
  font-size: 12px;
  background: var(--keyword-tag-bg);  /* 浅黄色 */
  color: var(--keyword-tag-text);    /* 深黄色文字 */
  border-radius: 12px;
}
```

**来源选择标签**（设置页面的多选标签）：
```css
.source-chip {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 16px;
  font-size: 12px;
}
.source-chip.active {
  background: var(--accent);  /* 选中时蓝色背景 */
  color: #fff;               /* 白色文字 */
}
```

---

## 五、响应式设计规则

### 5.1 字体缩放

所有字号均使用 `calc(px * var(--font-scale))`：
- `--font-scale: 1.0`：默认大小
- 修改此变量可全局调整字体大小

### 5.2 对话框响应式

```css
width: 90%;          /* 小屏幕占90%宽度 */
max-width: 420px;    /* 大屏幕最大420px */
max-height: 80vh;    /* 最大高度不超过屏幕80% */
overflow-y: auto;    /* 超出部分可滚动 */
```

### 5.3 窗口尺寸变量

```css
--toolbar-h: 40px;     /* 顶部工具栏高度 */
--statusbar-h: 28px;   /* 底部状态栏高度 */
```

### 5.4 滚动条样式

```css
::-webkit-scrollbar {
  width: 6px;           /* 滚动条宽度 */
}
::-webkit-scrollbar-track {
  background: transparent;  /* 轨道透明 */
}
::-webkit-scrollbar-thumb {
  background: var(--border);  /* 滚动条颜色 */
  border-radius: 3px;        /* 圆角 */
}
::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);  /* 悬停变深 */
}
```

---

## 六、其他重要UI元素

### 6.1 圆角规范

| 组件 | 圆角大小 | 说明 |
|------|----------|------|
| 对话框 | 10px | 较大圆角，视觉柔和 |
| 卡片 | 8px | 中等圆角 |
| 按钮 | 6px | `--radius` 变量 |
| 标签（小圆角） | 4px | 新闻来源标签 |
| 标签（药丸形） | 12px/16px | 关键词、来源选择标签 |
| Toggle 开关 | 11px | 圆角等于高度一半 |
| 头像 | 50% | 圆形 |

### 6.2 动画规范

**滑入动画**（新消息出现）：
```css
@keyframes slideIn {
  from { opacity: 0; transform: translateY(-8px); }  /* 从上方8px淡入 */
  to { opacity: 1; transform: translateY(0); }
}
```

**闪烁高亮**（新消息提示）：
```css
@keyframes flashHighlight {
  0% { background: rgba(3, 102, 214, 0.08); }  /* 蓝色淡背景 */
  100% { background: transparent; }
}
```

**优先级脉冲**（紧急消息）：
```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
```

### 6.3 状态指示器

```css
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;  /* 圆形 */
}
.status-dot.connected { background: var(--green); }    /* 绿色：已连接 */
.status-dot.error { background: var(--red); }          /* 红色：错误 */
.status-dot { background: var(--orange); }             /* 橙色：未连接 */
```

**使用场景**：左上角显示实时推送连接状态

### 6.4 徽章规范

```css
.btn-badge {
  min-width: 14px;
  height: 14px;
  font-size: 10px;
  line-height: 14px;
  color: white;
  background: var(--red);  /* 红色背景 */
  border-radius: 7px;      /* 半圆角 */
}
```

**使用场景**：自选股按钮右上角的小红点数字

---

## 七、设计原则

1. **清晰的视觉层级**：通过字体大小、粗细、颜色区分信息优先级
2. **一致性**：同类组件使用统一的样式规范，用户操作有预期
3. **响应式**：使用 CSS 变量和百分比实现灵活布局，适配不同窗口大小
4. **无障碍**：确保颜色对比度符合标准，视力不佳用户也能看清
5. **微动效**：适度的过渡动画提升用户体验，不花哨不干扰
6. **暗色模式**：完整的明暗主题支持，保护夜间使用时的眼睛

---

## 附录：设置页面排版规范

根据用户确认的最终规范：

| 区域 | 元素 | 字号 | 加粗 | 颜色 |
|------|------|------|------|------|
| 红框 | 设置标题 | 18px | ✅ | `--text` |
| 蓝框 | 功能项标题（消息来源等） | 15px | ✅ | `--text` |
| 绿框 | 开关项标签（开启语音播报等） | 14px | ❌ | `--text` |
| 黑框 | 描述文字 | 12px | ❌ | `--text-secondary` |

---

*本规范由 AI 助手维护，最后更新：2026-07-01*
