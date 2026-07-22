# VERSION-CONTROL-RULES.md - 版本管理规则

> **版本**：V3.0
> **修改时间**：2026-07-22
> **适用项目**：涨停财经聚合播报 v3.6.0+
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
- [十、AI 助手执行规则](#十ai-助手执行规则)

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
| 2 | 代码中的硬编码版本号 | 用户运行时看到的版本标识 | `app.py` 窗口标题、`app.py` 日志输出、`renderer/index.html` 标题和页面显示 |
| 3 | 构建脚本版本号 | 打包脚本中的版本引用 | `.spec` 文件 |
| 4 | Git Tag + GitHub Release | 代码仓库的版本锚点 | 通过 `git tag` 和 `gh release create` 创建 |

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
```

### 3.3 写入规则

1. **每个 GitHub Release 必须附带 Release Notes**
2. **标题用 `vX.Y.Z` + 一句话概括**，如：`v3.5.0: 资金流与游资追踪`
3. **必须包含"升级指引"段**：告诉用户这次升级有没有破坏性、需要什么前置条件
4. **有可下载产物时**（如 exe），在 Release 中上传附件

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
3. **产物命名**：`涨停财经聚合播报_vX.Y.Z.exe`，放在 `dist/` 目录下
4. **历史版本保留**：`dist/` 目录保留所有历史打包文件，不删除旧版本

### 5.2 产物提交规则

1. **打包完成后**，必须将 exe 文件强制添加到 git：`git add -f dist/涨停财经聚合播报_vX.Y.Z.exe`
2. **commit message**：`chore: 打包 vX.Y.Z`
3. **提交顺序**：
   - 先提交代码变更：`feat:` 或 `fix:`
   - 再提交 exe：`chore: 打包 vX.X.X`
   - 最后提交文档更新：`docs: 更新 README/CHANGELOG/AGENTS 版本同步`

---

## 六、GitHub Release（发布页）

### 6.1 创建时机

- **每个 Tag 推送后，都应该创建对应的 GitHub Release**
- 小版本（PATCH）也发 Release，不跳过

### 6.2 创建方式

```bash
# 创建 Release
gh release create vX.X.X --title "vX.X.X" --notes "更新内容..."

# 上传附件
gh release upload vX.X.X dist/涨停财经聚合播报_vX.X.X.exe
```

---

## 七、README.md 文档更新

### 7.1 更新规则

1. **新增功能/命令** → 必须在 README 中补充用法示例和参数说明
2. **删除功能/命令** → 必须从 README 中移除对应内容
3. **改了默认行为** → 必须更新 README 中对应的描述
4. **版本历史表** → 每次发版时添加一行
5. **本地与云端必须同步**：修改后立即 `git add + git commit + git push`

### 7.2 README 更新要求

- 更新标题版本号：`# 涨停财经聚合播报 vX.X.X（开源版）`
- 添加更新日志条目
- 更新启动方式中的 exe 文件名

---

## 八、完整发布流程（标准 SOP）

### 8.1 步骤总览

| 步骤 | 操作 | 命令/说明 |
|------|------|-----------|
| 1 | 更新代码版本号 | 修改 app.py、index.html、spec 文件中的版本号 |
| 2 | 打包 exe（如需要） | `pyinstaller 涨停财经聚合播报.spec --noconfirm` |
| 3 | 提交代码变更 | `git add app.py ...` + `git commit -m "feat: ..."` |
| 4 | 提交 exe（如需要） | `git add -f dist/涨停财经聚合播报_vX.X.X.exe` + `git commit -m "chore: 打包 vX.X.X"` |
| 5 | 更新文档 | 修改 README.md、CHANGELOG.md |
| 6 | 创建 Git Tag | `git tag vX.X.X` |
| 7 | Push 代码和 Tag | `git push origin main vX.X.X` |
| 8 | 创建 GitHub Release | `gh release create vX.X.X --title "vX.X.X" --notes "更新内容..."` |
| 9 | 上传 exe 文件（如需要） | `gh release upload vX.X.X dist/涨停财经聚合播报_vX.X.X.exe` |

### 8.2 GitHub Release 命令速查

```bash
# 创建 Release
gh release create vX.X.X --title "vX.X.X" --notes "更新内容..."

# 上传附件
gh release upload vX.X.X dist/涨停财经聚合播报_vX.X.X.exe

# 查看 Release
gh release view vX.X.X

# 删除 Release（慎用）
gh release delete vX.X.X
```

### 8.3 自检清单（push 前必须过）

| # | 检查项 |
|---|--------|
| 1 | README.md 版本历史已更新 |
| 2 | 代码中硬编码版本号已同步 |
| 3 | CHANGELOG.md 已更新 |
| 4 | 语法检查通过（Python + JavaScript） |
| 5 | `.spec` 文件版本号已更新 |

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

### 9.3 还没开发完，想先保存进度

- 正常 commit + push，**不打 Tag 也不发 Release**
- Tag 和 Release 只在"这个版本可以用了"的时候才打

---

## 十、AI 助手执行规则

1. **执行 `git push` 前**，必须自检第 8.3 节清单的所有项目
2. **改了代码必须同步改文档**（README + CHANGELOG），不允许"先推再补"
3. **版本号必须同步**，漏一处都不允许 push
4. **不确定当前版本号时**，先查 `git log --oneline -5` 和 `git tag -l`，不允许凭记忆猜
5. **每次完成版本发布后**，更新全局规则中的版本基线表
6. **文档修改必须立即推送**：任何对 README.md、CHANGELOG.md 等文档文件的修改，**必须在修改完成后立即 commit 并 push**

---

*本规则由老板制定，AI 助手必须严格遵守。如有疑问或需调整，由老板决定。*
