# 版本管理开发规则

> **版本**：V3.1
> **修改时间**：2026-07-22
> **适用范围**：所有自建项目和量化交易相关工具
> **制定日期**：2026-06-22
> **制定人**：郭良勇（老板）
> **目的**：让每个项目的版本生命周期清晰可追溯，AI 助手在开发和发布时严格遵守，杜绝版本号混乱、文档遗漏、Release 缺失

---

## 目录

- [一、版本号规则（SemVer）](#一版本号规则semver)
- [二、Changelog（变更日志）](#二changelog变更日志)
- [三、Release Notes（发布说明）](#三release-notes发布说明)
- [四、Git Tag（版本标签）](#四git-tag版本标签)
- [五、打包与产物管理](#五打包与产物管理)
- [六、GitHub Release（发布页）](#六github-release发布页)
- [七、README.md 文档更新](#七readmemd文档更新)
- [八、完整发布流程（标准 SOP）](#八完整发布流程标准-sop)
- [九、特殊情况处理](#九特殊情况处理)
- [十、当前项目版本基线](#十当前项目版本基线)
- [十一、AI 助手执行规则](#十一ai-助手执行规则)

---

## 一、版本号规则（SemVer）

### 1.1 格式

```
vMAJOR.MINOR.PATCH
```

| 位 | 名称 | 何时递增 | 示例 |
|----|------|----------|------|
| MAJOR | 大版本 | 架构重构、不兼容变更、全新功能模块 | v3.0 → v4.0 |
| MINOR | 小版本 | 新增功能、新增命令/接口、功能增强 | v3.4 → v3.5 |
| PATCH | 补丁 | 修 bug、小优化、文档修正 | v3.4.0 → v3.4.1 |

### 1.2 递增规则

- **MAJOR 递增时**，MINOR 和 PATCH 归零：v3.9.2 → v4.0.0
- **MINOR 递增时**，PATCH 归零：v3.4.1 → v3.5.0
- **PATCH 递增时**，只动最后一位：v3.4.0 → v3.4.1
- **绝不允许版本号降级**。v2.0.0 之后绝不能出现 v0.5.0

### 1.3 版本号必须同步的位置（N 处同步铁律）

每次改版本号时，以下位置必须全部更新，缺一不可：

| # | 位置 | 说明 | 典型文件 |
|---|------|------|----------|
| 1 | README.md | 版本历史表 + 文中所有版本号引用 | `README.md` |
| 2 | 代码中的硬编码版本号 | 用户运行时看到的版本标识 | `app.py` 窗口标题、`app.py` 日志输出、`config.py` 的 `APP_VERSION`、`__init__.py` 的 `__version__`、`pyproject.toml` 的 `version` |
| 3 | 前端页面版本号 | 用户在浏览器/WebView中看到的版本 | `renderer/index.html` 标题和页面显示 |
| 4 | 构建脚本版本号 | 打包脚本中的版本引用 | `build.bat`、`.spec` 文件 |
| 5 | 项目规则文档 | 规则文档中的版本示例 | `~/.workbuddy/MEMORY.md` |
| 6 | Git Tag + GitHub Release | 代码仓库的版本锚点 | 通过 `git tag` 和 `gh release create` 创建 |

**常见漏点**：
- 只改 README 不改代码里的版本号 → 打包产物仍显示旧版本号
- 只改代码不改前端页面 → 用户在界面上看到旧版本号
- 只改代码不改构建脚本 → 打包产物文件名还是旧版本

---

## 二、Changelog（变更日志）

### 2.1 文件和格式

- 文件名固定为 `CHANGELOG.md`，放在项目根目录
- 格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)
- 版本条目按**时间倒序**排列（最新在上）

### 2.2 每个版本条目结构

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- 新增的功能（做了什么，不是怎么做的）

### Changed
- 变更的行为（改了什么，原来怎样现在怎样）

### Deprecated
- 即将移除的功能（提前通知）

### Removed
- 已移除的功能（这个版本删了什么）

### Fixed
- 修复的 bug（问题现象 + 修复方式）

### Security
- 安全相关修复
```

### 2.3 写入规则

1. **每次 commit 前必须更新 CHANGELOG.md**
   - 不允许"先 commit 再补"
   - 不允许只写"fix bug"，要写清楚修了什么
2. **多条改动分行列出**，不要把多个独立改动合并成一条
3. **用"做了什么"而非"怎么做的"**
   - ✅ `新增 auction 命令，支持集合竞价数据查询`
   - ❌ `添加了 eltdx_integration.py 文件，实现了 auction 函数`
4. **没有的分类可以省略**（如果这个版本没有 Fixed，就不写 Fixed 段）

### 2.4 示例

```markdown
## [3.5.0] - 2026-06-23

### Added
- 新增 `moneyflow` 命令，支持个股/板块资金流查询
- 新增 `hotmoney` 命令，支持龙虎榜/游资追踪
- health 命令加入 Hub 数据源检测

### Fixed
- 修复 tick 命令日期参数不传时默认取昨天的 bug，改为默认取今天
```

---

## 三、Release Notes（发布说明）

### 3.1 与 Changelog 的区别

| | Changelog | Release Notes |
|--|--|--|
| 面向 | 开发者（自己） | 用户（别人） |
| 语言 | 技术描述 | 白话文 + 核心亮点 |
| 粒度 | 每条改动都列 | 只列用户关心的 |
| 位置 | `CHANGELOG.md` 文件 | GitHub Release 页面 |

### 3.2 Release Notes 内容结构

```markdown
## v3.5.0 新功能

### 新增命令
- `moneyflow` — 查个股/板块资金流向，支持 --json 输出
- `hotmoney` — 龙虎榜游资追踪，支持 --days 7

### Bug 修复
- tick 命令日期默认值修正

### 升级指引
- 无破坏性变更，直接 `git pull` 即可
- 新增命令需要 tradex-hub v2.2.0+
```

### 3.3 写入规则

1. **每个 GitHub Release 必须附带 Release Notes**
2. **标题用 `vX.Y.Z` + 一句话概括**，如：`v3.5.0: 资金流与游资追踪`
3. **必须包含"升级指引"段**：告诉用户这次升级有没有破坏性、需要什么前置条件
4. **有可下载产物时**（如 exe、whl），在 Release 中上传附件

---

## 四、Git Tag（版本标签）

### 4.1 打 Tag 规则

1. **Tag 名格式**：`vX.Y.Z`（v 小写 + 三位版本号）
   - ✅ `v3.5.0`
   - ❌ `3.5.0`、`V3.5`、`v3.5`
2. **打 Tag 时机**：代码已推送（push）且确认无问题后
3. **Tag 打在哪个 commit 上**：当前分支最新 commit
4. **禁止修改已推送的 Tag**（如果打错了，删旧打新并说明）

### 4.2 操作命令

```bash
# 打 Tag
git tag v3.5.0

# 推送 Tag 到 GitHub
git push origin v3.5.0

# 查看所有 Tag
git tag -l

# 删除错误 Tag（本地 + 远程）
git tag -d v3.5.0
git push origin :refs/tags/v3.5.0
```

---

## 五、打包与产物管理

### 5.1 打包规则

1. **打包时机**：代码修改完成、版本号已同步、语法检查通过后
2. **打包工具**：PyInstaller（通过 `pyinstaller .spec --noconfirm` 或 `build.bat`）
3. **产物命名**：`项目名_vX.Y.Z.exe`，放在 `dist/` 目录下
4. **历史版本保留**：`dist/` 目录保留所有历史打包文件，不删除旧版本
5. **spec 文件**：`.spec` 文件通常在 `.gitignore` 中，但打包后需要强制提交时用 `git add -f`

### 5.2 产物提交规则

1. **打包完成后**，必须将 exe 文件强制添加到 git：`git add -f dist/项目名_vX.Y.Z.exe`
2. **commit message**：`chore: 打包 vX.Y.Z`
3. **提交顺序**：先提交代码变更（`feat:` / `fix:`）→ 再提交 exe（`chore:`）→ 最后提交文档更新（`docs:`）

---

## 六、GitHub Release（发布页）

### 6.1 创建时机

- **每个 Tag 推送后，都应该创建对应的 GitHub Release**
- 小版本（PATCH）也发 Release，不跳过

### 6.2 创建方式

```bash
# 创建 Release（推荐）
gh release create v3.5.0 \
  --title "v3.5.0: 资金流与游资追踪" \
  --notes "Release Notes 内容..." \
  dist/项目名_v3.5.0.exe

# 单独上传附件
gh release upload v3.5.0 dist/项目名_v3.5.0.exe
```

---

## 七、README.md 文档更新

### 7.1 README 必含的段

每个项目的 README.md 必须包含以下段（缺一不可）：

| 段 | 内容 | 更新时机 |
|----|------|----------|
| 项目介绍 | 一句话说清这个项目是什么 | 定位变更时 |
| 快速开始 | clone → 安装 → 运行 的 3 步指引 | 安装方式/依赖变更时 |
| 命令/功能列表 | 所有可用命令 + 参数 + 示例 | 新增/删除/改命令时 |
| 配置说明 | 自选股、API Key、环境变量等 | 配置项变更时 |
| 版本历史 | 版本号 + 日期 + 变更摘要 的表格 | **每次发版时** |
| License | 开源协议 | 不变 |

### 7.2 更新规则

1. **新增功能/命令** → 必须在 README 中补充用法示例和参数说明
2. **删除功能/命令** → 必须从 README 中移除对应内容
3. **改了默认行为** → 必须更新 README 中对应的描述
4. **版本历史表** → 每次发版时添加一行，格式：

```markdown
| 版本 | 日期 | 变更 |
|------|------|------|
| v3.5.0 | 2026-06-23 | 新增 moneyflow/hotmoney 命令；修复 tick 日期默认值 |
| v3.4.0 | 2026-06-17 | 集成 eltdx；新增 kline/minute/auction/tick/f10 命令 |
```

5. **实事求是**，禁止夸大表述（不说"毫秒级"如果实测 100ms+，不说"零依赖"如果用了 eltdx）
6. **统计数字必须同步**：README 中所有计数类数据（工具总数、数据源数量、分类计数、badge 数字等）必须与实际代码保持一致
7. **本地与云端必须同步（铁律）**：任何对 README、CHANGELOG、LICENSE 等文档文件的修改，必须在修改完成后立即 `git add + git commit + git push` 到 GitHub。**绝不允许本地和云端版本不一致**。
8. **About 页（设置 → 项目介绍）同步**：每次发版，About 页的「关于叨叨记账」产品介绍与隐私声明，须与 README 的「核心优势 / 两大亮点 / 隐私与安全」表述保持一致，不得出现与 README 冲突或泄露内部代号的措辞。

---

## 八、完整发布流程（标准 SOP）

### 8.1 流程总览

每次完成一个版本的开发后，按以下顺序执行：

```
┌─────────────────────────────────────────────────────┐
│  1. 更新版本号（N处同步）                              │
│     ↓                                               │
│  2. 更新文档（README + CHANGELOG）                    │
│     ↓                                               │
│  3. 打包 exe（如需要）                                │
│     ↓                                               │
│  4. git commit + git push                            │
│     ↓                                               │
│  5. git tag + git push tag                           │
│     ↓                                               │
│  6. gh release create（创建发布页）                    │
│     ↓                                               │
│  7. gh release upload（上传产物，如需要）               │
│     ↓                                               │
│  8. 更新本规则的版本基线表                             │
└─────────────────────────────────────────────────────┘
```

### 8.2 详细步骤说明

| 步骤 | 操作 | 命令/说明 | 参考章节 |
|------|------|-----------|----------|
| 1 | 更新代码版本号 | 修改 app.py、index.html、spec 文件中的版本号 | 一、版本号规则 |
| 2 | 更新 CHANGELOG.md | 按 Keep a Changelog 格式添加新版本条目（Added/Changed/Fixed） | 二、Changelog |
| 3 | 更新 README.md | 更新版本历史表、新功能说明、启动方式中的 exe 文件名 | 七、README.md 文档更新 |
| 4 | 打包 exe（如需要） | `pyinstaller 项目名.spec --noconfirm` | 五、打包与产物管理 |
| 5 | 提交代码变更 | `git add app.py ...` + `git commit -m "feat: ..."` | 五、产物提交规则 |
| 6 | 提交 exe（如需要） | `git add -f dist/项目名_vX.X.X.exe` + `git commit -m "chore: 打包 vX.X.X"` | 五、产物提交规则 |
| 7 | Push 代码 | `git push origin main` | — |
| 8 | 创建 Git Tag | `git tag vX.X.X` | 四、Git Tag |
| 9 | Push Tag | `git push origin vX.X.X` | 四、Git Tag |
| 10 | 创建 GitHub Release | `gh release create vX.X.X --title "vX.X.X: 概括" --notes "Release Notes..."` | 六、GitHub Release |
| 11 | 上传 exe 文件（如需要） | `gh release upload vX.X.X dist/项目名_vX.X.X.exe` | 六、GitHub Release |
| 12 | 更新版本基线表 | 更新本规则第十节的项目版本基线 | 十、当前项目版本基线 |

### 8.3 Push 前自检清单

| # | 检查项 | 不通过的后果 |
|---|--------|-------------|
| 1 | README.md 版本历史已更新 | 用户看到旧版本号 |
| 2 | 代码中硬编码版本号已同步（6处） | exe/运行产物显示旧版本号 |
| 3 | CHANGELOG.md 已更新 | 无法追溯变更历史 |
| 4 | 新命令/功能的 README 示例已补充 | 用户不知道怎么用 |
| 5 | Python + JavaScript 语法检查通过 | 打包失败或运行时崩溃 |
| 6 | `.spec` 文件版本号已更新 | 产物文件名错误 |
| 7 | `.gitignore` 已更新（如有新增临时文件） | 误提交 `__pycache__` 等 |

### 8.4 发布后自检清单

| # | 检查项 | 验证方式 |
|---|--------|---------|
| 1 | Tag 已在 GitHub 上 | `gh api repos/wolfjkd/<仓>/tags` |
| 2 | Release 页面正常显示 | GitHub 页面查看 |
| 3 | Release Notes 内容完整（亮点 + 升级指引） | 检查发布页内容 |
| 4 | 产物可下载（如有） | 点击下载链接测试 |
| 5 | 版本基线表已更新 | 检查本规则第十节 |

---

## 九、特殊情况处理

### 9.1 紧急热修（hotfix）

发现线上 bug 需要紧急修复时：
1. 在当前版本基础上递增 PATCH：v3.4.0 → v3.4.1
2. 只改 bug，不加新功能
3. 走完整发布流程（commit → push → tag → release）

### 9.2 版本号打错了

1. 立即删除错误 Tag（本地 + 远程）
2. 修正所有版本号位置
3. 打正确 Tag 并推送
4. 删除错误 Release（如有）
5. 创建正确 Release

```bash
# 删除错误 Tag
git tag -d v3.5.0
git push origin :refs/tags/v3.5.0

# 删除错误 Release
gh release delete v3.5.0 --yes

# 修正后重新打
git tag v3.5.1
git push origin v3.5.1
gh release create v3.5.1 ...
```

### 9.3 还没开发完，想先保存进度

- 正常 commit + push，**不打 Tag 也不发 Release**
- Tag 和 Release 只在"这个版本可以用了"的时候才打
- 开发中的 commit 不需要更新版本号

### 9.4 多项目联动更新

当多个项目联动更新时：
- 各项目版本号**独立递增**（不要求同步）
- Release Notes 中**注明依赖版本**：如"需要 tradex-hub v2.2.0+"
- 先发布被依赖的项目，再发布依赖方

---

## 十、当前项目版本基线（2026-07-22）

| 项目 | 当前版本 | 最新 Tag | 最新 Release | 仓库 |
|------|---------|---------|-------------|------|
| zhangting-finance-news | v3.11.0 | v3.11.0 | v3.11.0 | wolfjkd/zhangting-finance-news |
| trader-data-router | v3.5.0 | v3.5.0 | v3.5.0 | wolfjkd/trader-data-router |
| tradex-hub | v3.3.1 | v3.3.1 | v3.3.1 | wolfjkd/tradex-hub |
| auction-hunter | v1.0.0 | v1.0.0 | v1.0.0 | wolfjkd/auction-hunter |
| stock-monitor-app | v4.6 | v4.6 | v4.6 | wolfjkd/stock-monitor-app |
| TradeX 看板 | v0.2.0 | v0.2.0 | v0.2.0 | wolfjkd/TradeX |
| daodaobooks（叨叨记账） | v1.1.1 | v1.1.1 | v1.1.1 | wolfjkd/daodaobooks |

**待处理**：无

---

## 十一、AI 助手执行规则

以下规则约束 AI 助手在开发过程中的行为：

1. **执行 `git push` 前**，必须自检第 8.3 节清单的所有项目
2. **改了代码必须同步改文档**（README + CHANGELOG），不允许"先推再补"
3. **版本号必须 6 处同步**，漏一处都不允许 push
4. **不确定当前版本号时**，先查 `git log --oneline -5` 和 `git tag -l`，不允许凭记忆猜
5. **发布前必查版本谱系**：`gh api repos/wolfjkd/<仓>/tags` 确认现有所有 Tag
6. **每次完成版本发布后**，更新本规则第十节的版本基线表
7. **违反以上规则的 push**，应立即修正（补 Tag、补 Release、补 CHANGELOG）
8. **文档修改必须立即推送（铁律）**：任何对 README.md、CHANGELOG.md、LICENSE、PRIVACY.md 等文档文件的修改，**必须在修改完成后立即 commit 并 push**，绝不允许只改本地不推云端
9. **任务结束前自检**：每次完成用户请求的任务后，必须检查：
   - [ ] 所有修改的文件都已 commit
   - [ ] 所有 commit 都已 push 到 GitHub
   - [ ] `git status` 显示 working tree clean
   - [ ] README 等文档与代码变更同步

---

*本规则由老板制定，AI 助手必须严格遵守。如有疑问或需调整，由老板决定。*