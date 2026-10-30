# 为 @mpd-dsh/silicon 做贡献

[English](./CONTRIBUTING.md)

## 概述

`@mpd-dsh/silicon` 是 DeepSeek Harness 的 RTL 能力 bundle：RTL 验证工具链、RTL skill 语料、HDL 语言服务行，以及把 `@mpd-dsh/mpd` 变为硬依赖的启动守卫。本仓库托管在 **GitHub**（`HaroldZ32/MPD-Silicon`），流水线使用 **GitHub Actions**；源仓库没有镜像，也不发布到 npm。

**兼容基线：** DeepSeek Harness `0.2.1-rc.2`、`@mpd-dsh/mpd` `0.15.1`、bun `1.4.3`、CI 中的 Node `24`。

## 1. 环境准备

```bash
git clone https://github.com/HaroldZ32/MPD-Silicon.git
cd MPD-Silicon
bun install
```

`bun install` 会安装 `@mpd-dsh/mpd@0.15.1`，它是**硬运行时依赖**，不是仅供开发使用的便利项。本 bundle 不再自带适配器：它消费 mpd 提供的 `mpdDsh` 服务。只挂载 silicon 而没有 mpd 的 profile 会在启动时被无注入的 `silicon-require-mpd` 行拒绝：

```text
silicon requires @mpd-dsh/mpd: the mpdDsh service is absent
```

不要为了简化 profile 而删除该依赖，也不要使用省略生产依赖的安装方式。固定工具链是 bun `1.4.3`；CI 还会运行 `bun install --frozen-lockfile`。

## 2. 本地闸门

每次提交前运行这些命令。`ci.yml` 运行下面的静态闸门；同一序列也在 docker 镜像里（`docker-verify.yml`）与 `release.yml` 中运行；启动 harness 在 `boot-e2e.yml` 中运行。

| 闸门 | 命令 |
| --- | --- |
| 类型 | `node scripts/typecheck.mjs --require` |
| 测试 | `bun test packages/` |
| 语料 | `node scripts/verify-corpus.mjs` |
| Row id | `node scripts/verify-rows-disjoint.mjs` |
| LSP 资产 | `node scripts/build-lsp.mjs --check` |
| 打包器守卫 | `node scripts/pack-silicon.mjs --self-test` |
| CI 工作流 | `node scripts/verify-github-workflows.mjs` |
| 文件模式 | `node scripts/pack-silicon.mjs --check` |
| 包暂存 | `node scripts/pack-silicon.mjs` |
| 启动测试 | `node scripts/ci-boot.mjs --require` |

守卫脚本都带有负向控制；修改守卫本身时运行它们：

```bash
node scripts/typecheck.mjs --self-test
node scripts/verify-corpus.mjs --self-test
node scripts/verify-rows-disjoint.mjs --self-test
node scripts/build-lsp.mjs --self-test
node scripts/pack-silicon.mjs --self-test
node scripts/verify-github-workflows.mjs --self-test
node scripts/ci-boot.mjs --self-test
```

`node scripts/pack-silicon.mjs` 将包暂存到 `dist/silicon-package/`；`/dist/` 被 gitignore。不要在 CI 中运行 `pack-silicon.mjs --fix`：CI 运行 `--check`，因此提交了错误文件模式必须让流水线失败，而不是被静默修复。

`scripts/typecheck.mjs` 在没有 `node_modules` 时刻意保持惰性（bundle 可以从 clone 直接安装运行，无需包安装）。`--require` 会把这种环境跳过变成失败，所以 CI 先安装依赖。

### 启动测试

```bash
node scripts/ci-boot.mjs --self-test          # 纯 classify() 控制，不启动
node scripts/ci-boot.mjs --require            # 两种模式；缺少 dsh/bun 时退出 3
node scripts/ci-boot.mjs --mode coexist --require
node scripts/ci-boot.mjs --mode no-mpd --require
```

harness **不**调用 `dsh plugin add`。它在全新的临时沙箱中写入 `$DSH_HOME/profiles/<name>/package.json`，在那里运行 `bun install`，然后启动 `dsh --profile <name> --no-open --port 0`：

- **coexist** —— base + mpd + silicon。预期：应用存活到 30 秒上限，`timeout` 返回 exit `124`，日志包含 `[mpd-silicon-bootstrap] skill corpus served`，且没有 `fatal`。该 bootstrap 行只有在 `mpdDsh` ACTIVE 后才可能出现，因此这是真实挂载检查。
- **no-mpd** —— 只有 base + silicon。预期：exit `1` 和上面的精确守卫行。profile manifest 没有 mpd 依赖，但 bun 可能通过 silicon 自身依赖传递安装 mpd；harness 在启动前删除该目录，使“没有 mpd”是字面事实，而不是隐含假设。

`HOME`、`DSH_HOME` 和工作区都是全新的临时目录。真实 `~/.dsh` 从不读写。日志落在 `dist/ci-boot-logs/`（`coexist.log`、`no-mpd.log`、`result.json`）；失败时保留，并把关键行复制到 PR。

`--require` 在缺少 `dsh` 或 `bun` 时退出 `3`。不带它时，harness 打印确切的安装命令并跳过，退出 `0`。`--keep` 保留临时沙箱用于调试。

## 3. GitHub Actions 流水线

`.github/workflows/` 中的 YAML 是事实来源；不需要在控制台里手工创建。随附四个工作流：

| 文件 | 触发 | 作用 | 产物 |
| --- | --- | --- | --- |
| `.github/workflows/ci.yml` | 推送到 `main`；到 `main` 的 PR；手动触发 | 安装 bun `1.4.3` 与 Node 24，按顺序运行下面的静态闸门，暂存 `dist/silicon-package` | `silicon-package` |
| `.github/workflows/docker-verify.yml` | 推送到 `main`；到 `main` 的 PR；手动触发 | 构建仓库 `Dockerfile`（真实 iverilog/verilator/yosys），跑完整闸门与 EDA 冒烟，期望 `DOCKER-VERIFY: PASS`；非 PR 运行推送 `ghcr.io/haroldz32/mpd-silicon:edge` | `docker-verify-log` |
| `.github/workflows/boot-e2e.yml` | 推送到 `main` 且命中 `packages/**`、`scripts/**`、`package.json`、`bun.lock` 或 `packages/mpd-bundle/cordis.patch.yml`；手动触发 | 安装 bun `1.4.3` 和 dsh `0.2.1-rc.2`，用 `--require` 运行两种启动模式 | `ci-boot-logs` |
| `.github/workflows/release.yml` | 匹配 `v*` 的标签推送 | 断言标签等于 `package.json.version`（接受 `vX.Y.Z` 和 `X.Y.Z`），运行相同闸门，产出 `npm pack` tarball 与 `dist/silicon-package.tar.gz`，发布 GitHub Release 并把镜像推送到 GHCR | GitHub Release 资产 + GHCR 镜像 |

`ci.yml` 与 `docker-verify.yml` 从不发布版本；发布属于 release 工作流。`release.yml` 用仓库级 `GITHUB_TOKEN` 同时完成 Release 与 GHCR 推送，并且**不**运行 `npm publish`。

release 工作流从 `GITHUB_REF_NAME` 读取标签，并断言 `${GITHUB_REF_NAME#v}` 等于 `node -p "require('./package.json').version"`。不匹配会在任何闸门运行前失败；标签为空时同样大声失败。不要在 `release.yml` 中硬编码版本。

`boot-e2e.yml` 刻意没有 PR 触发器：它要安装 harness 并执行两次真实启动，对每个 PR 来说太慢。需要时用 `workflow_dispatch` 手动运行；向 `main` 推送并命中列出的路径时会自动触发。

## 4. 分支模型与 PR 流程

| 分支 | 用途 | 规则 |
| --- | --- | --- |
| `main` | 主干 | 始终为绿；所有 pull request 的目标；附注 `vX.Y.Z` 标签在这里创建；不要直接提交发布递增或功能工作 |
| `feature/<slug>`、`fix/<slug>` | 短期工作分支 | 从 `main` 拉出；每个分支一个逻辑变更；用 `--no-ff` 合并 |
| `release/vX.Y.Z` | 发布准备 | 版本号 + CHANGELOG；用 `--no-ff` 合并到 `main`；附注 `vX.Y.Z` 标签在 `main` 上创建 |

这是相对源仓库的刻意差异：GitHub 移植版以 `main` 为主干，不引入 `dev`。

在 GitHub 中保护 `main`，要求 PR 和闸门。

**唯一 git 写入者。** 同一时间只有一个 agent 或人可以向 `main` 和标签推送；其他所有变更都通过分支和 pull request 进行。打标签是发布步骤的一部分。

流程：

1. 从 `main` 拉分支：`git switch -c feature/<slug> main`。
2. 修改、运行本地闸门、补充/刷新证据。
3. 按下面的格式提交，推送分支。
4. 在 GitHub 打开目标为 `main` 的 PR，填写 `.github/PULL_REQUEST_TEMPLATE.md`（摘要、变更类型、闸门表、证据路径、边界/回滚、检查清单）。
5. 评审后用合并提交（`--no-ff`）合并，让主题保持为一个单元。
6. `main` 准备发布时，从 `main` 创建 `release/vX.Y.Z` 做版本号和 CHANGELOG；打开 `release/vX.Y.Z` -> `main`，用 `--no-ff` 合并，然后在 `main` 上创建附注 `vX.Y.Z` 标签。

不要 rebase 或 force-push 共享分支。历史不被重写；作为单元保留的主题分支用 `--no-ff` 合并。

## 5. 提交格式

```text
<type>(<scope>): <summary>
```

类型：`feat | fix | docs | test | evidence | chore | refactor`。

示例：`feat(silicon): ...`、`docs(i18n): ...`、`evidence(review): ...`、`test(smoke): ...`、`fix(guard): ...`。提交是原子的：每个提交一个逻辑变更，并在磁盘上或 PR 中带有该变更的闸门证据。

## 6. 发布

1. 从 `main` 创建 `release/vX.Y.Z`，把 `package.json.version` 和 CHANGELOG 设为你要发布的版本。
2. 用 `--no-ff` 将 `release/vX.Y.Z` 合并到 `main`。
3. 在 `main` 上创建**附注标签**并推送：

   ```bash
   git tag -a vX.Y.Z -m "@mpd-dsh/silicon vX.Y.Z"
   git push origin vX.Y.Z
   ```

4. `.github/workflows/release.yml` 运行。它的首条实际断言把 `GITHUB_REF_NAME`（带或不带前导 `v`）与 `package.json.version` 比较；不匹配会在任何闸门运行前失败。
5. 工作流构建 `npm pack` tarball `mpd-dsh-silicon-<version>.tgz` 与 `dist/silicon-package.tar.gz`，以生成的发布说明把它们作为 **GitHub Release 资产**发布，并把验证镜像以 `ghcr.io/haroldz32/mpd-silicon:vX.Y.Z` 与 `:latest` 推送到 **GHCR**。
6. **没有 npm publish**。GitHub Release 资产与 GHCR 镜像就是分发渠道。

如果标签发布时版本错误，不要静默移动或删除共享标签；切一个新的补丁版本并重新打标签。流水线的版本断言是刻意大声的。

## 7. 依赖固定与升级（`@mpd-dsh/mpd`）

`@mpd-dsh/mpd` 固定到精确版本（`0.15.1`），从不使用范围。silicon 消费 mpd 的 `mpdDsh` 服务，并把 patch 与 mpd 的组合在一起；版本升级是兼容性变更，不是 lockfile 刷新。

步骤：

1. 阅读 mpd 的 release notes/diff，关注服务名、patch row id、工具名和 MCP `serverName` 变化。这三类单例是会让组合启动失败的部分。
2. 修改根 `package.json` 中的精确版本，运行 `bun install`，并将更新后的 `bun.lock` 与 manifest 一起提交。
3. 运行所有本地闸门，然后 `node scripts/ci-boot.mjs --require`（两种模式）。`verify-rows-disjoint.mjs` 必须仍然报告 row id 零交集，coexist 启动必须仍然提供语料。
4. 如果 mpd 重新加入某个 RTL 行（`mpd_verif_*` 或 silicon 拥有的服务/`serverName`），停下：同时挂载两个 bundle 会在注册时冲突。先解决归属。
5. 以 `chore(deps): bump @mpd-dsh/mpd to X.Y.Z` 提交，并附上闸门输出。

## 8. 证据

没有证据的变更不算完成。每个 PR 都要包含：

- 你运行的命令及其**实际观察到的**退出码（不是“测试通过”）；
- 受影响行的闸门输出（或它的路径）；
- 运行时变更的启动结果：模式、退出码、决定性的日志行；
- 工作流产出时的 CI 产物名（`silicon-package`、`docker-verify-log`、`ci-boot-logs`）。

`dist/` 被 gitignore，所以把关键日志行复制到 PR。变更需要持久记录时，在同一次变更中添加到 `evidence/<domain>/<slug>/` 下。不要声称你没有观察到的工具结果。

## 9. 安全

- 仓库、日志、证据中不得出现 token、密钥或 `.credentials*` 文件。
- 工作流使用仓库级 **`GITHUB_TOKEN`** 认证，由 GitHub 按次提供。仓库、工作流文件或证据产物中都不保存个人访问令牌。
- 启动测试只写入临时 `HOME`/`DSH_HOME`/工作区目录；它从不写真实 `~/.dsh`。不要添加把凭据复制进沙箱的步骤。
- `npm config set registry` 只改 CI 任务的 `~/.npmrc`，不改仓库文件。
- 不要把密钥放进 `variables:` 块或会进入日志的命令行。

## 10. 已知边界

- **这里不支持用 `dsh plugin add` 安装。** 在作者沙箱中，它被只读的 `$HOME/pnpm` store 阻塞。`ci-boot` 直接构造 profile manifest 并运行 `bun install`；CI 也这样做。不要通过添加 `dsh plugin add` 来“修复”harness。
- `ci-boot --require` 在缺少 `dsh`/`bun` 时退出 `3`；不带 `--require` 时跳过。CI 会显式安装两者。
- 在没有 GNU `timeout` 的系统上，harness 用 `SIGTERM` 杀掉启动并合成退出码 `124`；分类逻辑相同。
- coexist 日志可能包含 mpd 内部警告，例如 `preset-mpd ... pending (waiting for service: agentPresets)`。闸门拒绝 `fatal` 并要求 bootstrap 行；它不要求日志无警告。
- `scripts/typecheck.mjs` 在 `bun install` 提供类型根之前是惰性的；这就是为什么只在安装后用 `--require` 运行它。
- CI 闸门或启动测试不需要任何 EDA 后端（iverilog/verilator/vcs）。
