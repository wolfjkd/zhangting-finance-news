# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/lang/zh-CN/).

## [v4.4.0] - 2026-10-15

重构收尾批次。延续 v4.3.0 的结构性重构路线，继续把 `data_source_manager.py` 中的
独立职责抽为独立模块，并清理上一批次遗留的死代码。**对外功能与接口零变化**。

### Changed（重构）
- **TranslationService 抽离（任务 4）**：`data_source_manager.py` 的翻译体系
  （9 个方法：google/mymemory/libretranslate 多源降级 + 限流冷却 + 结果缓存，约 122 行）
  抽为 `translation_service.py` 的 `TranslationService` 类，HTTP 取数构造注入
- **DelayedPushQueue 独立（任务 5）**：外网资讯延时推送队列（4 个方法，约 56 行）
  抽为 `delayed_push_queue.py` 的 `DelayedPushQueue` 类，推送出口/运行标志构造注入；
  `_DELAY_PUSH_SOURCES` / `_should_delay_push` 业务规则保留在 data_source_manager
- `data_source_manager.py`：1946 → 1760 行；对外接口零变化

### Removed（清理）
- `app.py` 死接口 `get_stock_names` / `persist_stock_names`（27 行，
  随 v4.3.0 移除 stock-quote.js 后已无调用者）
- `efinance_source.py` / `source_failover.py`（158 行，业务代码零引用；
  spec `hiddenimports` 同步移除两项）

### 验证
- 新增翻译/延时推送行为冒烟测试 10 项全绿（不联网，注入假 HTTP）；
  38 项海外源行为对齐测试回归通过

## [v4.3.0] - 2026-10-15

结构性重构批次。目标：不改接口、只做内部结构调整，降低后续维护成本，同时不抬高资源占用。
开发基线 `v4.2.0-stable`（tag 为回滚点）。本版同时修复了 app 内置「检查更新」永久失效的问题，
也是**第一个自带可用更新检测器的版本**（此前各版本的更新检测均指向已改名的旧仓库、一直 404）。

### Changed（重构）
- **海外新闻抓取抽基类（P2/P3）**：`data_source_manager.py` 的 9 个海外源抓取方法
  （合计约 890 行、流程高度重复）抽为 `foreign_news_fetcher.py` 的 `ForeignNewsFetcher`
  基类 + 9 个子类。基类固化"抓取 → 时效过滤 → 词表过滤 → 去重 → 翻译（失败即丢弃）→ 组装"，
  各源仅声明 `FEEDS/PARSE_STYLE/KEY_PREFIX/LABEL/MAX_ITEMS_PER_FEED` 等类属性，
  必要时覆写 `_scrape()/_parse_feed()/_content()/_feed_label()`。依赖（HTTP 取数 / 翻译 /
  aid 生成 / 关键词表）以构造注入，避免循环 import。
  - `data_source_manager.py`：2789 → 1946 行（-843）；新增 `foreign_news_fetcher.py`（505 行）
  - 新增海外源从"复制 ~90 行方法"降为"写 ~10 行子类"
- **initSettings 拆分（P4）**：`app.js` 的 `initSettings` 单函数 409 行按功能域拆为
  8 个子函数（`bindVoiceSettings` / `bindKeywordSettings` / `bindDisplaySettings` /
  `bindWatchlistAlertSettings` / `bindFontSizeSettings` / `bindAiSettings` /
  `bindPanelAndWindowControls` / `bindThemeAndLifecycle`），均定义在 IIFE 顶层共享闭包；
  调用顺序与原同步执行顺序一致，初始化时序不变。
  - 主函数 409 → 13 行；各子函数 11~96 行

### Removed（清理）
- **零引用模块 `renderer/modules/stock-quote.js`**：`window.stockQuoteManager` 全仓库无
  调用点（仅文档提及），每次启动白白解析；连同其 `<script>` 引用与 3 条死样式
  （`.stock-quote` / `.stock-price` / `.stock-change`）一并移除；`.stock-name` 因
  `app.js` 的 `.stock-tag` 仍在用而保留
- **PyInstaller spec 中的死数据引用**：`涨停财经聚合播报.spec` 的 `datas` 此前仍引用已删除的
  `renderer/modules/stock-quote.js`，本批次一并移除（否则从重构分支打包会失败）

### Fixed
- **app 内置「检查更新」永久失效**：仓库改名后 `app.py`（`_VERSION_JSON_URL` /
  `_RELEASES_API_URL`）、`version.json`（`download_url`）、`renderer/index.html`（项目主页）、
  `renderer/app.js`（隐私/开源声明）、`PRIVACY.md` 里的仓库 URL 未同步，导致更新检测的
  两条路径（raw version.json + Releases API）都 404，用户端永远看不到更新提示。
  已全部改为 `wolfjkd/zhangting-finance-news`
- **更新下载未走代理**：`download_update` 原用裸 `requests.get`，国内直连 GitHub 会失败；
  改为复用 `_get_github_session()`，与 `_check_update` 保持一致

### 验证
- `node --check`（app.js 等）+ `python -m py_compile`（data_source_manager.py /
  foreign_news_fetcher.py）全部通过
- 新增 `test_foreign_news_fetcher.py` 合成 feed 行为对齐测试 38 项全绿
  （覆盖时效过滤/词表过滤/去重/翻译失败丢弃/seen 标记顺序/Atom 逐子版 comefrom/
  Google 动态搜索 URL/标题最短长度/Nitter 24h 时效·多实例·图片·逐账号标签·20 条上限·limit）
- 未改动任何对外接口（pywebview API 签名、消息 dict 结构均不变）

### 待确认（本批次未动）
- `app.py` 的 `get_stock_names` / `persist_stock_names`：随 `stock-quote.js` 移除后已无调用者（死接口，约 27 行）
- `efinance_source.py` / `source_failover.py`：未被业务代码 import（约 134 行），但被
  `涨停财经聚合播报.spec` 的 `hiddenimports` 显式打包 —— 疑为未接线特性，删前需老板拍板

> 注：本批次 P0 的两笔数据流修复（延迟消息丢弃 / 移除"消息来源"筛选闸）已随 **v4.2.1** 一并发布，
> 详见下方 v4.2.1 段。

## [v4.2.1] - 2026-10-15

数据流净化 + 累计修复。本版汇总了 v4.2.0 之后进入 main 的全部修复（含 11 个代码审查 Bug
与 1 个致命回归修复），并新增两笔数据流质量修复。

### Fixed
- **延迟旧消息直接丢弃**：上游聚合源（鼓掌财经等）因排队/积压/重试会把旧消息晚推过来，
  而 `app.js` 原实现无脑 `prepend`，导致 10:00 的旧消息排在 11:23 的最新消息之上。
  新增 `STALE_MSG_THRESHOLD=120`（秒），超阈值消息入口即丢弃（先入 `seenAids` 防重试）
- **移除设置页冗余的"消息来源"筛选闸**：数据源管理（齿轮）开关已精确表达用户意愿，
  前端再做显示过滤属冗余，反而造成"两套开关"的认知负担
- **右上角关闭按钮失效（致命回归）**：`exit_app` 从 `os._exit(0)` 改 `sys.exit(0)` 后
  `SystemExit` 被 pywebview RPC 异常层吞掉；改用 `window.destroy()` + 主线程清理 + `os._exit(0)`
- **代码审查累计 11 个 Bug**：自选股预警 SyntaxError 失效、localStorage 损坏崩溃、
  AI 异常泄露 Key、去重失效（set 无序）、WAL checkpoint 丢数据、wsConfig 嵌套解析截断、
  AudioContext 耗尽、前端直连外部 API 的 CORS 失败、U+2028/2029 转义缺失、深市代码前缀缺失等
- **未配置 API Key 时随机自动 AI 解读不再弹 toast 打扰**

### Changed
- 质量重构：`apiHas`/`unwrapResult` helper 替换 30+ 处防御模板、DEBUG 日志守卫、
  `playAlertSound` 同名死代码去重

### Removed
- 设置页"消息来源"筛选闸（HTML 区块 + `ALL_SOURCES`/`$sourceList`/过滤判断/chip 循环/
  `updateSourceSettings()` + 相关 CSS）；保留 `settings.sources` 默认值兼容旧 localStorage
  （不再被读取），保留 `source` 变量供相似消息去重徽章使用

### 验收数据
- 延迟消息：自带时间超过 120 秒即丢弃，控制台可见 `[stale] 丢弃延迟消息` 日志
- "消息来源"筛选闸：整道下线
- 关闭按钮：恢复正常

## [v4.2.0] - 2026-10-14

本次版本包含两批改动：**方案 B 资源优化**（性能）+ **用户体验增强批次**（功能）。

### Added（新功能）
- **首次启动引导**：新用户首次打开自动弹出 6 步分步式引导卡片（欢迎→新闻来源→自选股→AI/TTS→其他功能→完成），带 emoji 图标和"去配置/查看/打开"等一键跳转动作按钮，支持上一步/下一步/跳过，完成后通过 `localStorage.onboarding_completed` 标记避免重复弹出
- **AI 解读配置引导**：未配置 API 密钥时点击"AI 解读"按钮不再静默失败，改为弹出 toast 带"去配置"按钮一键跳转到设置面板 AI 区；按钮半透明灰显 + tooltip 提示"未配置"
- **数据源开启前置检测**：开启 Tushare/Wind 数据源时检测 Token/API Key 是否已配置，未配置则弹引导 toast + 自动回滚开关状态，避免用户开了源却收不到消息的困惑
- **toast 系统扩展**：showToast 支持 4 种类型（success 绿/error 红/warning 橙/info 黑）和可选动作按钮（`{label, callback}`），带动作时自动延长显示时间到 6 秒
- **设置面板区域直达**：新增 `openSettingsAtSection(section)` 辅助函数，支持 ai/tushare/wind/datasource 四区一键直达，暴露到 `window` 供 toast action 使用

### Changed
- **默认数据源精简**：默认启用源从 3 个（akshare_beta、foreign_news、ztfi）精简为仅 1 个（传统聚合 ztfi，基于鼓掌财经 WebSocket），其他源用户可在设置面板按需开启，新用户首次启动不再自动启动多个后台轮询线程
- **DEBUG_MODE 关闭**：生产环境 `DEBUG_MODE = true → false`，关闭所有 `if (DEBUG_MODE) console.log(...)` 分支
- **定时器频率降低**：自选股提醒检查频率从每 60 秒调整为每 120 秒（`checkWatchlistAlerts` 内已有交易时间判断，非盘中直接 return，降频不影响体验）；历史清理定时器改为延迟 5 分钟首次启动避开启动高峰
- **SQLite 启用 WAL 模式**：`_init_seen_db()` 增加 `PRAGMA journal_mode=WAL` + `PRAGMA synchronous=NORMAL`，写入去重 aid 不再阻塞 UI 读取
- **pywebview 依赖下限升级**：requirements.txt `pywebview>=4.0` → `>=5.0`（当前实测已装 6.2.1，本次只提升声明下限反映实际依赖）
- **数据源配置入口优化**：数据源管理面板 Tushare/Wind 的"配置"文字按钮替换为齿轮 SVG 图标，悬停 tooltip 提示"配置 XXX 的 Token/API Key"，视觉更直观

### Performance
- **alert 全清零**：项目内 39 处浏览器原生 `alert()` 全部替换为非阻塞的主题统一 toast，告别阻塞主线程的系统弹窗；保留 `confirm()` 用于删除分组/移除自选股等危险操作（按约定）
- **资源优化目标**：RAM 目标 120MB→90MB，CPU 目标 5-8%→2-4%（WebView2 本身 ~80MB 占用是 pywebview 架构固有开销，方案 B 不动）

### Fixed
- **AI 解读静默失败**：修复新用户没配 API 密钥点击"AI 解读"按钮无任何反应的 UX bug（老板点名问题）
- **数据源开关无前置引导**：修复开启需要 Token/模块的源后静默失败的问题

### 验收数据
- alert: 39 → 0
- confirm: 保留 2 处（危险操作）
- showToast: 5 → 51 处
- 默认启用数据源: 3 → 1

## [v4.1.0] - 2026-08-28

### Added
- 自绘标题栏（frameless）：切换到无边框自绘标题栏，标题栏由 HTML/CSS 渲染，背景/文字/按钮随 6 套主题语义 token 100% 实时变色（原生 DWM 栏只能翻文字色、背景锁定应用模式的问题彻底解决）；含最小化/最大化/关闭三个窗口按钮与边缘尺寸调节交互
- 品牌 Logo「涨停声波」：标题栏左侧新增品牌标识（蓝底上升 K 线 + 红涨停圆点 + 声波弧线，14px SVG）
- 边缘缩放（frameless 自绘 resize）：窗口四边/四角 8px 热区检测，按住拖动实时调用后端 `resize_window` 缩放（最小 320×400）
- 设计规范（DESIGN_SYSTEM.md）：补齐 A.6 自绘标题栏组件规范（窗口参数/拖拽机制/缩放对策/结构与行为规格，含 pywebview 6.2.1 + WebView2 三项关键机制记录）

### Changed
- 默认窗口尺寸：`500×800` → `450×900`（更贴合长窄新闻流布局）
- 拖拽机制适配：WebView2 下 `-webkit-app-region` 无效，改用 pywebview 官方 `.pywebview-drag-region` 类实现拖拽，拖拽区扩展至标题栏左半区 + 中间填充区、避让右侧三个窗口按钮

### Fixed
- 修复「最大化/还原失效」：后端 `Window` 无 `is_maximized` 属性（抛 AttributeError），改用自维护 `_is_maximized` 标志记录状态
- 修复「标题栏窗口按钮（最小化/最大化/关闭）」：后端 `Api._window` 为 lambda，方法误用 `self._window.minimize()` 抛 AttributeError，统一改为 `self._window().minimize()` 等
- 修复「frameless 不可边缩放、拖拽区与按钮冲突」：JS 边缘热区 `getEdge` 顶部排除标题栏区避免与拖拽冲突
- 修复「设置/对话框/数据源面板头部滚动被容器裁剪」：`.settings-header/.dialog-header/.datasource-header` 改为 `position: sticky` 顶部吸附，`.datasource-panel` 加 `max-height:80vh; overflow-y:auto`
- 修复「6 套预设主题全部不可用」：定位到 `window.ThemeSystem` 为 `undefined` 导致 `attachUI()` 从未执行（事件未绑定），已显式全局暴露修复

### Changed（主题系统）
- 主题系统全量重建：`themes.js` 顶层 `const ThemeSystem` 在经典 `<script>` 下不挂到 `window`，显式 `window.ThemeSystem = ThemeSystem` 全局暴露
- `app.js`：`initThemeUI()` 兼容 `window.ThemeSystem` 与词法 `ThemeSystem` 双通道；`waitForApi` 重赋值 `settings` 后同步 `window._settings` 引用
- `style.css`：补齐 `--bg-secondary`、新增 `.theme-grid/.theme-card/*` 组件样式
- 主题皮肤设置 UI：settings 面板新增「主题皮肤」区块（5 预设 + 亮/暗共 6 张网格卡），并新增 `ThemeSystem.attachUI()` 幂等绑定
- 设计规范（DESIGN_SYSTEM.md）：新增 Design Token 单一事实来源文档，与 Ardot 设计规范板对齐

## [v4.0.0] - 2026-07-28

### Added
- 涨停聚合（Beta）数据源：基于AKShare聚合财联社、华尔街见闻、东方财富、同花顺、央视新闻
- Tushare备用数据源：支持用户自定义Token，作为AKShare的第一降级源
- efinance备用数据源：专注东财数据，作为第二降级源
- 多源降级策略：自动检测数据源可用性，失败自动切换
- 媒体RSS订阅源：支持财联社、华尔街见闻等RSS直连
- Wind MCP自定义API Key：用户可填入个人Key使用Wind数据
- Edge TTS语音引擎：高质量免费TTS，支持7种中文音色
- 语音关键词屏蔽：命中关键词的消息跳过播报
- 定时静音：支持自定义静音时段（午休/盘后/自定义）
- 自选股当日分时图：Canvas绘制价格走势+均价线+成交量
- 多条件提醒：涨跌幅+成交量+振幅组合触发，支持任一/全部模式
- 智能阈值：基于ATR动态调整提醒阈值
- 盘口异动监控：大单压单/托单/封涨跌停/快速拉升
- 5套预设皮肤：科技蓝/护眼绿/经典黑/活力橙/少女粉
- 主题编辑器：自定义颜色+背景图+透明度
- 窗口透明度调节：0-100%可调

### Changed
- AKShare升级至v1.18.80
- 版本号升级至v4.0.0（主版本号升级，重大重构）
- PyInstaller spec文件更新：新增模块和资源文件

## [v3.11.1] - 2026-07-27

### Added
- 外网资讯延时推送模块：谷歌新闻、Reddit、X、TechCrunch集中推送消息先缓存到本地队列，再按10-20秒间隔推送
- 延时推送线程：独立后台线程处理延时队列，确保消息按间隔推送

### Fixed
- 集中推送导致语音播报连续跳过多条新闻的问题

## [v3.11.0] - 2026-07-22

### Added
- X平台独立优先轮询线程：30秒间隔轮询，提升实时性
- 前端优先级队列：X平台消息置顶展示（`.x-priority` 类标记）
- 翻译限流保护：令牌桶限流+异步翻译队列，防止翻译服务被限流
- 评估指标收集：各源消息数、平均延迟、点击率统计，Ctrl+S查看报告

### Changed
- 推送频率优化：并行抓取+即时推送，消除"长时间无消息后突发推送"现象
- 外网资讯抓取架构重构：6个源线程池并行 + 2个源独立线程

## [v3.10.1] - 2026-07-19

### Fixed
- 外网资讯推送问题：修复Reddit 403被拒绝、TechCrunch brotli解压失败、时间过滤太严格导致无消息推送的问题
- 添加broti依赖以支持TechCrunch压缩数据解析

### Changed
- 时间过滤窗口从24小时调整为48小时，平衡时效性和资讯量
- 扩展TechCrunch关键词匹配规则，增加更多通用科技关键词
- 增强代理Session头部，添加完整浏览器模拟信息
- 增加详细日志输出，便于调试外网资讯抓取过程

## [v3.10.0] - 2026-07-19

### Added
- 外网资讯24小时时间过滤：Reddit、Google News、TechCrunch 只推送最近24小时内发布的消息
- Google News时间限定：添加 `&tbs=qdr:d` 参数，强制搜索最近24小时新闻

### Changed
- 外网资讯推送逻辑：从"实时性优先"改为"热门优先+时效性过滤"，既保留热门价值又避免日期错乱

## [v3.9.9] - 2026-07-17

### Added
- 外网资讯数据源：集成 Reddit、Google News、TechCrunch 三大外网资讯源
- 多翻译源自动降级：MyMemory + LibreTranslate + Yandex + DeepL Free，防止限流失效
- 代理检测升级：支持 Clash/Mihomo/v2rayN/Surge 等主流代理工具，自动检测环境变量、系统代理、常见端口
- 外网资讯测试按钮：数据源管理中支持测试连接

### Changed
- 语音播报规则：关键词高亮和自选股相关消息强制播报，东方财富公告/公告解读/券商研报不播报
- 警报弹窗位置：关键词警报和自选股异动弹窗统一居中显示，避免遮挡最新消息
- 关键词高亮修复：解决 flex 布局导致的换行问题
- 消息推送间隔控制：外网资讯逐条推送，间隔1.5秒

### Fixed
- 外网资讯不播报问题：修复 ctime 使用原始发布时间导致时间阈值过滤的bug
- 翻译限流问题：增加多个备用翻译源
- 消息批量弹窗问题：修复语音队列被覆盖导致只播报最后一条的bug

## [v3.9.7] - 2026-07-03

### Added
- 消息卡片右键复制功能：右键菜单一键复制完整消息内容
- AI深度分析功能：后端ai_analyze方法，连接AI分析器模块
- 配置版本管理机制：版本升级自动兼容配置文件
- UI设计规范文档：字体、颜色、间距等完整规范

### Fixed
- 窗口置顶功能：改用pywebview原生on_top属性，可靠生效
- AI分析功能：修复后端ai_analyze方法缺失导致功能失效
- 自选股弹窗：修复弹窗高度不足、分组不持久化等问题
- 数据源管理：开关状态持久化到本地文件
- 设置页面排版：统一字体层级（标题/功能项/开关项/描述）

## [v3.8.1] - 2026-06-29

### Added
- 隐私政策强制弹窗：首次启动必须阅读并同意才能使用
- 6大块完整免责声明：隐私政策、金融投资重大风险免责、数据抓取合规声明、软件使用与自愿赞助说明、开源组件版权说明、通用软件免责条款
- 金融风险提示条：首页底部常驻显示"本工具仅数据展示，不构成任何投资建议"
- 赞赏支持功能：状态栏红心按钮+弹窗收款码
- 第三方开源组件声明文件：THIRD_PARTY.md
- 隐私政策文件：PRIVACY.md（含完整7章声明）
- 投资风险提示文件：RISK_DISCLOSURE.md

### Changed
- 移除授权系统：删除所有激活码、机器指纹、授权验证相关代码
- 删除导出消息功能和历史消息搜索功能
- 清理授权相关CSS样式（.auth-status、.auth-overlay、.auth-panel等）
- 删除授权系统测试用例
- 删除激活码生成工具
- 项目完全开源：MIT License
- 所有功能永久免费开放

### Fixed
- 赞赏码图片加载问题
- 隐私政策弹窗样式优化

## [v3.7.0] - 2026-06-28

### Added
- 项目重命名：鼓掌财经 → 涨停财经（ZTFI-News）
- 全局名称替换：代码、文档、配置文件中的所有旧名称

### Changed
- 版本号升级至v3.7.0（项目重命名）

## [v3.6.0] - 2026-06-28

### Changed
- 自选股对话框布局优化：关闭按钮右上角，添加分组/自选按钮左上角一行排列
- "+添加"按钮改名为"+自选"，与"+分组"按钮大小一致、颜色区分
- 消息流改为卡片式呈现：圆角矩形、小间隔、背景色区分
- 消息来源标签移到内容左下方
- 删除"我的收藏"和"复盘报告"功能（清理残留代码和CSS）
- Windows标题栏暗色模式支持（DWM API + GetAncestor方案）

### Fixed
- 主题切换一致性：所有硬编码颜色改为CSS变量

## [v3.5.1] - 2026-06-28

### Added
- 自选股异动提醒：价格涨跌幅超阈值时弹窗+声音提醒
  - 定时轮询自选股行情（每分钟检查）
  - 可设置阈值和检查间隔
  - 支持声音提醒（Web Audio API）
  - 冷却机制防止重复提醒

### Added
- 自选股分组管理：支持创建/删除/重命名分组
  - 添加分组按钮
  - 分组菜单（⋮按钮）重命名/删除
  - 移动股票到指定分组

### Fixed
- 分组管理CSS样式缺失问题

### Changed
- IndexedDB批量写入优化
  - 新增 `storeMessagesBatch` 方法
  - 消息缓冲机制（10条批量 + 2秒延迟刷新）
  - 减少数据库事务次数，提升性能

## [v3.5.0] - 2026-06-28

### Added
- 自选股管理功能
  - 自选股添加/删除（输入股票代码自动获取名称）
  - 自选股列表管理对话框
  - 自选股数据 IndexedDB 持久化
  - 新闻自动匹配关联自选股（标题+内容扫描）
  - 匹配自选股的新闻高亮标记（左侧橙条 + ⭐自选徽章）
  - 自选股行情快速查看（点击徽章或行情按钮）
  - 工具栏新增"自选股"按钮

## [v3.4.0] - 2026-06-28

### Added
- 复盘报告功能：一天新闻汇总+关键词统计
  - 高频关键词Top 20统计
  - 分类分布、优先级分布、来源分布
  - 时间分布（按小时统计）
  - 支持导出Markdown格式报告
  - Toolbar新增"复盘报告"按钮
  - 支持自定义日期范围查询

## [v3.3.0] - 2026-06-28

### Added
- 消息收藏功能：用户可收藏重要消息，快速回顾
  - 每条消息旁边添加收藏按钮（星标图标）
  - 收藏列表对话框，支持查看和移除收藏
  - 收藏数据持久化存储到IndexedDB
  - Toolbar新增"我的收藏"按钮

### Changed
- 版本号升级至v3.3.0（第三阶段功能增加）

## [v3.2.1] - 2026-06-28

### Added
- 配置持久化增强：自动滚动、窗口置顶状态保存到 localStorage

### Changed
- 第二阶段架构优化完成

## [v3.2.0] - 2026-06-28

### Added
- 新闻分类系统：6个分类标签 + 4个优先级标识
- 股票行情查询：集成腾讯财经API实时行情
- 历史消息搜索：支持分类/优先级/日期筛选
- 消息导出功能：支持Markdown/JSON/CSV格式导出
- 数据源管理：后端驱动的数据源开关控制

### Changed
- 代码架构优化：合并 ui-enhancements.js 功能到 app.js
- CSS样式整合：将动态注入样式迁移到 style.css 统一管理
- 移除未使用模块：删除 data-sources.js、app_trial.py、README_新功能说明.md

### Fixed
- 修复公告/研报详情加载失败问题

### Technical Debt Cleanup
- 删除死代码 ui-enhancements.js
- 统一样式管理，消除动态style注入

## [v3.1] - 2026-06-25

### Added
- 多数据源接入：东财公告、券商研报、北向资金
- 腾讯行情API：实时股票行情查询
- AGENTS.md：项目开发规则文档

### Changed
- exe命名格式：`涨停财经聚合播报_V{版本号}.exe`
- 版本管理规范化

### Fixed
- 修复CSS语法错误（末尾多余`}`）
- 修复Api类方法self._http未定义问题

## [v3.0] - 2026-06-25

### Added
- 多数据源接入：东财公告、券商研报、北向资金
- 腾讯行情API：实时股票行情查询
- 新闻分类系统：6个分类标签 + 4个优先级标识
- 24个集成测试：test_new_features.py全部通过
- PyInstaller打包：单文件exe，无需Python环境

## [v2.1] - 2026-06-24

### Added
- WebSocket实时推送：秒级延迟接收聚合消息
- 历史消息加载：启动时自动加载，支持手动加载更多
- SQLite去重：持久化已读消息
- 关键词高亮+警报：自定义关键词，命中时高亮+声音+弹窗
- 语音播报：TTS合成语音播报新消息
- 授权系统：机器指纹绑定+试用3天+激活码

## [v2.0] - 2026-06-24

### Added
- 初始版本重构：基于pywebview的桌面应用

## [v1.0] - 2026-06-23

### Added
- 初始版本：Web版财经新闻聚合
