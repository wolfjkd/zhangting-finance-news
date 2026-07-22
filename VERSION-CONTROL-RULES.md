# VERSION-CONTROL-RULES.md - 版本管理规则

> **版本**：v2.0
> **适用项目**：涨停财经聚合播报 v3.6.0+
> **制定日期**：2026-07-22
> **维护人**：wolfjkd

---

## 目录

- [1. 版本号规范](#1-版本号规范)
- [2. 版本号同步位置](#2-版本号同步位置)
- [3. 打包规则](#3-打包规则)
- [4. Git 提交规范](#4-git-提交规范)
- [5. 完整发布流程](#5-完整发布流程)
- [6. 版本保留策略](#6-版本保留策略)

---

## 1. 版本号规范

### 格式
- **格式**：`v{主版本}.{次版本}.{补丁版本}`
- **示例**：`v3.2.0`、`v3.2.1`、`v4.0.0`

### 版本号含义
| 部分 | 含义 | 触发条件 |
|------|------|----------|
| 主版本号 | 重大功能更新、架构变更 | 全新架构、破坏性变更 |
| 次版本号 | 新功能添加、功能增强 | 新增功能模块、显著优化 |
| 补丁版本 | Bug修复、小优化 | 修复问题、轻微改进 |

---

## 2. 版本号同步位置

更新版本时，必须同时修改以下 **5 处**，保持一致：

| 序号 | 文件 | 位置/内容 |
|------|------|-----------|
| 1 | `app.py` | 窗口标题：`'涨停财经聚合播报 vX.X.X版'` |
| 2 | `app.py` | 日志输出：`'=== 涨停财经聚合播报 vX.X.X版（开源版）启动 ==='` |
| 3 | `renderer/index.html` | 页面标题：`<title>涨停财经聚合播报 vX.X.X版（开源版）</title>` |
| 4 | `renderer/index.html` | 版本显示：`vX.X.X（开源版）` |
| 5 | `涨停财经聚合播报.spec` | exe文件名：`name='涨停财经聚合播报_vX.X.X'` |

---

## 3. 打包规则

### exe 命名规范
- **格式**：`涨停财经聚合播报_v{版本号}.exe`
- **示例**：`涨停财经聚合播报_v3.6.0.exe`、`涨停财经聚合播报_v3.11.0.exe`
- **位置**：统一放在 `dist/` 目录下

### 打包命令
两种方式：
1. **双击运行**：`build.bat`（推荐，一键构建）
2. **命令行**：
```bash
cd 项目根目录
pyinstaller 涨停财经聚合播报.spec --noconfirm
```

生成的 exe 文件位于 `dist/涨停财经聚合播报_vX.X.X.exe`

---

## 4. Git 提交规范

### 提交类型
| 类型 | 前缀 | 适用场景 |
|------|------|----------|
| 功能新增 | `feat:` | 新增功能、功能增强 |
| Bug修复 | `fix:` | 修复问题、解决 bug |
| 文档更新 | `docs:` | 更新文档、注释 |
| 打包发布 | `chore:` | 打包 exe、版本发布 |

### 提交顺序
1. **代码变更**：`feat:` 或 `fix:`
2. **打包 exe**：`chore: 打包 vX.X.X`
3. **文档更新**：`docs: 更新 README/CHANGELOG/AGENTS 版本同步`

### exe 文件提交
每次打包后，强制添加 exe 到 git：
```bash
git add -f dist/涨停财经聚合播报_v{版本号}.exe
git commit -m "chore: 打包 v{版本号}"
```

---

## 5. 完整发布流程

### 步骤总览
```
1. 更新版本号 → 2. 打包 exe → 3. 提交代码 → 4. 提交 exe → 5. 更新文档
    ↓
6. 创建 Git Tag → 7. Push 代码和 Tag → 8. 创建 GitHub Release → 9. 上传 exe
```

### 详细步骤

| 步骤 | 操作 | 命令/说明 |
|------|------|-----------|
| 1 | 更新代码版本号 | 修改 app.py、index.html、spec 文件中的版本号 |
| 2 | 打包 exe | `pyinstaller 涨停财经聚合播报.spec --noconfirm` |
| 3 | 提交代码变更 | `git add app.py data_source_manager.py renderer/* spec` + `git commit -m "feat: ..."` |
| 4 | 提交 exe | `git add -f dist/涨停财经聚合播报_vX.X.X.exe` + `git commit -m "chore: 打包 vX.X.X"` |
| 5 | 更新文档 | 修改 README.md、CHANGELOG.md |
| 6 | 创建 Git Tag | `git tag vX.X.X` |
| 7 | Push 代码和 Tag | `git push origin main vX.X.X` |
| 8 | 创建 GitHub Release | `gh release create vX.X.X --title "vX.X.X" --notes "更新内容..."` |
| 9 | 上传 exe 文件 | `gh release upload vX.X.X dist/涨停财经聚合播报_vX.X.X.exe` |

### 文档更新要求

**README.md**：
- 更新标题版本号：`# 涨停财经聚合播报 vX.X.X（开源版）`
- 添加更新日志条目
- 更新启动方式中的 exe 文件名

**CHANGELOG.md**：
- 按 Keep a Changelog 格式添加新版本条目
- 分类：Added / Changed / Fixed / Security

---

## 6. 版本保留策略

### exe 文件保留
- **所有历史版本都保留**，不删除旧版本 exe
- `dist/` 目录应保留所有历史打包文件

### 示例目录结构
```
dist/
├── 涨停财经聚合播报_v3.6.0.exe
├── 涨停财经聚合播报_v3.8.0.exe
├── 涨停财经聚合播报_v3.9.9.exe
├── 涨停财经聚合播报_v3.10.1.exe
├── 涨停财经聚合播报_v3.11.0.exe
└── 永久激活码生成.exe
```

---

## 附录：GitHub Release 命令速查

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

---

*本文档由 wolfjkd 维护，最后更新：2026-07-22*
