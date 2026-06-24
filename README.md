# 鼓掌财经聚合消息 - 桌面端

轻量级桌面新闻推送客户端，基于 pywebview（WebView2 内核），无需浏览器即可实时接收鼓掌财经的聚合消息推送。

## 功能

- **实时新闻推送**：WebSocket 连接，秒级延迟
- **历史消息加载**：启动时自动加载，支持手动加载更多
- **窗口可调**：任意调整长宽高（最小 320×400）
- **窗口置顶**：一键切换置顶/取消置顶
- **自动滚动**：新消息自动滚到顶部，手动滚动后暂停
- **消息卡片**：显示时间、来源、标题、内容摘要、关联股票
- **暗色主题**：深色背景，护眼舒适

## 运行环境

- Windows 10/11（需要 WebView2 Runtime，Win10 21H2+ 自带）
- Python 3.13+

## 安装依赖

```bash
pip install pywebview requests websocket-client
```

## 启动

**方式一：直接运行 exe（推荐，无需 Python 环境）**
双击 `鼓掌财经聚合.exe`

**方式二：Python 脚本启动**
```bash
python app.py
```
或双击 `启动.bat`（已自动隐藏命令行窗口）

## 项目结构

```
guzhang-news-ticker/
├── app.py              # 主程序入口（Python 后端抓取 + WebSocket 代理）
├── 启动.bat            # 双击启动脚本
├── renderer/
│   ├── index.html      # 前端页面
│   ├── style.css       # 样式（暗色主题）
│   └── app.js          # 前端逻辑（通过 pywebview.api 与后端通信）
└── README.md
```

## 技术方案

- **后端**：Python (pywebview + requests + websocket-client)
  - `fetch_initial()` — 抓取 724.guzhang.com，提取 token + WS 配置 + 初始新闻 HTML
  - `start_ws()` — 启动 WebSocket 代理线程，实时推送新闻到前端
  - `load_more()` — 加载更早的历史消息
- **前端**：纯 HTML/CSS/JS，WebView2 渲染
  - 通过 `pywebview.api` 调用 Python 后端（无跨域问题）
  - 解析 HTML 渲染新闻卡片
  - WebSocket 事件通过 `window._onBackendEvent()` 回调
- **数据源**：724.guzhang.com（鼓掌财经聚合消息）
- **实时推送**：WebSocket（wss://swoole2.guzhang.com:443）

## 注意事项

- Token 有有效期，断线后会自动重新获取
- WebSocket 断线自动重连（指数退避，最长 30 秒间隔）
- 点击新闻内容可展开/收起全文
