# AGENTS.md - 项目开发规则

> 本文档定义项目的开发规范、版本管理规则和打包策略。
> 所有参与开发的 AI 助手必须遵守。

---

## 版本管理规则

### 版本号格式
- 格式：`v{主版本}.{次版本}.{补丁版本}`（如 v3.2.0、v3.2.1、v4.0.0）
- 主版本号：重大功能更新、架构变更
- 次版本号：新功能添加、功能增强
- 补丁版本：Bug修复、小优化

### 版本号定义位置
- `app.py` 窗口标题：`'涨停财经聚合播报 v3.8.0版'`
- `renderer/index.html` 页面显示
- `app.py` 日志输出：`'=== 涨停财经聚合播报 v3.8.0版（开源版）启动 ==='`

### 版本号同步
更新版本时，必须同时修改以上 3 处，保持一致。

---

## 打包规则

### exe 命名规范
- **格式**：`涨停财经聚合播报_v{版本号}.exe`
- **示例**：`涨停财经聚合播报_v3.6.0.exe`、`涨停财经聚合播报_v3.6.1.exe`
- **位置**：统一放在 `dist/` 目录下

### 打包命令
两种方式：
1. **双击运行**：`build.bat`（推荐，一键构建）
2. **命令行**：
```bash
cd 项目根目录
pyinstaller 涨停财经聚合.spec --noconfirm

生成的 exe 文件位于 `dist/涨停财经聚合播报_v3.6.0.exe`

### 版本保留策略
- **所有历史版本都保留**，不删除旧版本 exe
- `dist/` 目录应保留所有历史打包文件
- 示例目录结构：
  ```
  dist/
  ├── 涨停财经聚合播报_v3.6.0.exe
  ├── 涨停财经聚合播报_v3.6.1.exe
  └── 永久激活码生成.exe
  ```

### Git 提交规范
- 每次打包后，强制添加 exe 到 git：
  ```bash
  git add -f dist/涨停财经聚合播报_v{版本号}.exe
  git commit -m "chore: 打包 v{版本号}"
  ```

---

## 开发流程

### Bug 修复流程
1. 定位问题（阅读代码、添加调试日志）
2. 修复代码
3. 验证（Python 语法检查、JS 语法检查）
4. 更新版本号（如需要）
5. 重新打包 exe
6. Git 提交（fix + chore）

### 新功能开发流程
1. 设计功能
2. 编写代码（前端 + 后端）
3. 测试验证
4. 更新版本号（主版本 or 次版本）
5. 更新 AGENTS.md（如规则变更）
6. 重新打包 exe
7. Git 提交（feat + chore）

---

## 项目结构规范

### 根目录
- 只放源代码、配置文件、文档
- **不放打包产物**（exe 放 dist/）

### dist/ 目录
- 存放所有打包好的 exe 文件
- 历史版本永久保留
- 永久激活码生成工具也放这里

### build/ 目录
- PyInstaller 打包临时文件
- 可随时删除重建
- .gitignore 已忽略

---

## 代码规范

### Python
- 使用 requests.Session 直连国内 API（`trust_env=False`）
- 日志使用 logging 模块，输出到文件 + 控制台
- 异常处理：捕获异常，记录日志，返回错误信息

### JavaScript
- 前端通过 `pywebview.api` 调用后端
- 异步操作使用 async/await
- DOM 操作使用原生 API

### CSS
- 使用 CSS 变量定义主题色
- 响应式设计，适配不同窗口大小

---

## 调试规范

### 前端调试
- `renderer/app.js` 顶部有 `DEBUG_MODE` 开关：
  - `false`（默认）：生产模式，所有 `if (DEBUG_MODE) console.log(...)` 不执行
  - `true`：调试模式，开启详细日志
- 调试日志格式：`[模块名] 描述: 数据`
- 示例：`[详情] 调用 get_announcement_detail, art_code: xxx`

### 后端调试
- 使用 `logger.info/warning/error` 记录日志
- 日志文件：`%APPDATA%/ZTFINews/app.log`
- 控制台同步输出

---

## 对话框样式统一规范

### 适用范围
所有功能对话框（设置、我的收藏、复盘报告、历史消息搜索、导出消息、数据源管理及未来新增功能）

### 宽度规范
```css
width: 90%;
max-width: 420px;
```

### 视觉风格规范
- 圆角：`border-radius: 10px`
- 边框：`1px solid var(--border)`
- 阴影：`0 8px 32px rgba(0,0,0,0.15)`
- 背景：`var(--bg)`
- 最大高度：`max-height: 80vh`
- 溢出：`overflow-y: auto`

### 头部规范
```css
padding: 14px 16px;
border-bottom: 1px solid var(--border);
display: flex;
align-items: center;
justify-content: space-between;
```

### 关闭按钮规范
- 类名：`.dialog-close-btn`
- 位置：右上角
- 图标：红色SVG叉号
- 样式：
```css
.dialog-close-btn {
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background 0.15s;
}
.dialog-close-btn:hover {
  background: rgba(229,57,53,0.1);
}
.dialog-close-btn svg {
  width: 20px;
  height: 20px;
  fill: #e53935;
}
```

### HTML结构规范
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

### 新增对话框开发指引
1. 创建CSS类时，宽度使用 `max-width: 420px`
2. 头部使用 `justify-content: space-between` 布局
3. 关闭按钮统一使用 `<button class="dialog-close-btn">` + 红叉SVG
4. 事件监听统一使用 `dialog.querySelector('.dialog-close-btn').addEventListener('click', () => dialog.remove())`

---

## 文档维护

### AGENTS.md（本文件）
- 记录项目开发规则
- 版本管理、打包策略、代码规范
- **AI 助手必须遵守**

### MEMORY.md（.workbuddy/memory/）
- 记录项目技术细节
- 已修复的 Bug、已实现的功能
- **AI 助手参考**

### README.md
- 用户文档
- 功能说明、使用方法

---

_最后更新：2026-06-28_
