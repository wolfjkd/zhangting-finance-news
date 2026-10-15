# SMOKE-CHECKLIST — 涨停财经聚合播报（前端手工冒烟回归网）

> 用途：本项目前端无自动化测试，P5（app.js 拆模块）每完成 2–3 个阶段，必须在实机上手工过一遍本清单。
> 通过标准：全部项「符合预期」。任一失败 → 停止下一步、回退到上一个原子 commit 定位。
> 记录方式：在每项后打 ✅ / ❌，附现象与截图（如需要）。
> 最近一次执行：2026-10-16（**P5 全量冒烟通过 ✅**）｜ 执行阶段：**S0–S7 全部完成**（ztfi 命名空间 / utils / dom / ui-utils / settings-store / voice-service / news-list / dialogs-* / watchlist-view / settings-panel / keyword-alert / watchlist-alert / ai-service / update-check / window-service / favorites-search / history-buffer / stats / news-detail），app.js 已从 5036 行收敛至 **766 行**（P5 目标 <1000 达成）

---

## A. 基础启动与新闻流（回归重点：S1 utils、S2 dom）

| # | 步骤 | 预期 |
|---|------|------|
| A1 | 启动 exe / `python app.py`，观察窗口标题与页面标题 | 标题含 `v4.4.1`；窗口正常渲染，无白屏 |
| A2 | 等待连接状态 | 状态点变绿，状态文案由「连接中...」变为正常态 |
| A3 | 等待收到 ≥3 条新闻 | 卡片正常渲染：时间 `HH:MM:SS`、标题、来源标签、关联股票标签（涨红跌绿） |
| A4 | 连续推送同事件多源新闻 | 「隐藏相似消息」生效：合并为一条并显示「已有 N 条相似消息 · M 个来源」 |
| A5 | 新闻卡片「相似/重复」徽章、成交量/额格式化展示 | 数字格式为「x.xx亿股 / x.xx万股」「x.xx亿 / x.xx万」，与旧版一致 |

## B. 语音播报（回归重点：S3 未动语音，但 settings 走新 store）

| # | 步骤 | 预期 |
|---|------|------|
| B1 | 开启语音播报，收到命中/普通新闻 | 正常朗读（Edge 或浏览器内置），无卡死 |
| B2 | 播报中点「停止」/切换静音时段 | 立即停止；静音时段内不再播报 |
| B3 | 关键词屏蔽配置后收到含该词新闻 | 该条不播报 |
| B4 | 修改播报语速/模式后重启 | 设定被记忆（`ztfi-settings` 持久化生效） |

## C. 设置面板与持久化（回归重点：S3 settings-store，最高杠杆）

| # | 步骤 | 预期 |
|---|------|------|
| C1 | 设置面板逐区打开：语音 / 去重 / 关键词 / 显示 / 自选股提醒 / 字体 / AI / 主题 / 关于 | 各区正常渲染，控件初值 = 当前设置 |
| C2 | 改「显示关联股票 / 关联新闻」→ 关闭再开 | 新闻卡片相应元素显隐，且**重启后仍保留** |
| C3 | 改字体大小 small→xlarge | 界面字号即时变化，且重启后保留 |
| C4 | 关键词高亮：加词 → 页面高亮；删词 → 高亮消失 | 生效且重启后保留 |
| C5 | `window._settings` 与后端同步 | 主题（暗色）重启后保持；后端能读到前端设置 |
| C6 | 重装/清空 localStorage 后重启 | 回落到出厂默认值，无报错 |

## D. 自选股与预警（回归重点：未被 S0–S3 触及，作对照）

| # | 步骤 | 预期 |
|---|------|------|
| D1 | 打开自选股对话框：增/删/分组 | UI 正常，数据落历史库（IndexedDB） |
| D2 | 开启异动提醒，触发阈值 | 弹窗 + 声音提醒，冷却时间生效 |

## E. 对话框群 / 主题 / 更新检测（回归重点：S2 dom 集中登记）

| # | 步骤 | 预期 |
|---|------|------|
| E1 | 搜索对话框 / 我的收藏对话框 | 打开、搜索、收藏切换正常 |
| E2 | 数据源管理对话框、Tushare / Wind 配置对话框 | 正常打开、开关与配置保存 |
| E3 | 隐私政策 / 用户协议对话框（markdown 渲染） | 正文排版正常（标题/加粗/表格/列表） |
| E4 | 主题切换（5 预设 + 亮/暗） | 即时生效，A股涨红跌绿保持 |
| E5 | 「检查更新」 | 能请求到 `version.json`（走代理），弹窗/紧急遮罩显示正常 |
| E6 | 引导流程（首次启动 / 重置后） | onboarding 正常弹出与关闭 |

---

## 附：失败时的定位顺序

1. 先 `git log --oneline -6` 确认当前停在哪个原子 commit。
2. 打开 F12 控制台（`renderer/app.js` 顶部 `DEBUG_MODE` 置 `true` 可开详细日志）。
3. 若报 `Cannot read properties of undefined (reading 'xxx')` 且指向 `window.ztfi.*` → 大概率是 `index.html` 的 `<script>` 顺序错（core → utils → dom → ui-utils → settings-store → voice-service → news-list → dialogs-legal → watchlist-view → keyword-alert → watchlist-alert → dialogs-datasource → … → ai-service → news-detail → news-classifier → history-storage → themes → app.js）。
4. 单阶段回退：`git revert <该阶段 commit>`（不删历史）。
