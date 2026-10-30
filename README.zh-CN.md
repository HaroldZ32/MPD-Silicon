# @mpd-dsh/silicon

[![CI — static gates](https://github.com/HaroldZ32/MPD-Silicon/actions/workflows/ci.yml/badge.svg)](https://github.com/HaroldZ32/MPD-Silicon/actions/workflows/ci.yml)
[![CI — docker 真机验证](https://github.com/HaroldZ32/MPD-Silicon/actions/workflows/docker-verify.yml/badge.svg)](https://github.com/HaroldZ32/MPD-Silicon/actions/workflows/docker-verify.yml)
[![npm version](https://img.shields.io/npm/v/@mpd-dsh/silicon)](https://www.npmjs.com/package/@mpd-dsh/silicon)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[English](./README.md)

DeepSeek Harness 的 **RTL 能力 bundle** —— 即 `@mpd-dsh/mpd` 的「RTL 面」：RTL 验证工具链、RTL skill 语料，以及 HDL 语言服务行。它是一个**伴生 bundle，不是独立 bundle**：运行期要求 `@mpd-dsh/mpd` `0.15.1`（钉在 `package.json`），且在该 bundle 的 `mpdDsh` 服务缺席时拒绝启动。

**bundle 版本 0.7.2** · 面向 **DeepSeek Harness `0.2.1-rc.2`**，要求 **`@mpd-dsh/mpd` `0.15.1`**。依赖 profile 的证据在 `evidence/verification/mpd-dependency/`；更早的适配证据在 `evidence/verification/harness-0.2.1-rc.2/`。

## 随附内容

| Row id | 作用 |
| --- | --- |
| `silicon-require-mpd` | 启动守卫：inject-free，每 100 ms 轮询 `ctx.get("mpdDsh", true)`，最多 15 s，超时即 throw；没有 `@mpd-dsh/mpd` 的 profile 因此以退出码 1 和可操作的错误信息停下，而不是带着空工具面启动（见 `packages/mpd-silicon-guard-plugin/`） |
| `silicon-bootstrap` | 通过 `ctx.skills` provider 提供 `<bundle>/skills`（rank 600，provider 名 `silicon-bundle`）。不向 `$DSH_HOME` 复制任何东西。注入 `["skills", "mpdDsh"]` |
| `silicon-verif` | 十个 `mpd_verif_*` 工具：iverilog/verilator/VCS 解析（env → 工具链配置 → `PATH`）、cocotb 通道（项目本地 venv）、仅 VCS 的 UVM 通道、覆盖率合并/报告、波形回传、工具链配置（`mpd_verif_toolchain`）与 LibreLane 运行器（`mpd_verif_librelane`）。注入 `dshSeamInject(DSH_SEAM_TOOLS)` 加 `mpdDsh` |
| `silicon-docgen` | 四个 `mpd_docgen_*` 工具（`register_xlsx`、`user_manual_docx`、`run`、`verify`）：规格设计阶段的寄存器 Excel 工作簿与中英双语 Word 用户手册，直接写出 OOXML，零第三方运行期依赖。`mpd_verif_*` 仍为十个，两个工具命名空间永不重名。注入 `dshSeamInject(DSH_SEAM_TOOLS)` 加 `mpdDsh` |
| `silicon-mcp-lsp` | HDL 语言服务行（Verible / slang-server）。**已启用**；`serverName` 为 `silicon_lsp`；8 个 MCP 工具（`status`、`diagnostics`、`goto_definition`、`find_references`、`symbols`、`prepare_rename`、`rename`、`install_decision`） |

patch 共 5 行，**没有 adapter 行**：`mpdDsh` 服务由 `@mpd-dsh/mpd` 自己的 `mpd-dsh-adapter` 行提供，本 bundle 绝不注册它。

随附数据：

- `skills/rtl-ip-flow`（10 个文件）—— 四泳道 RTL IP 流程：阶段闸门 + 文档模板（req-spec、user-manual 及其 `.en` 孪生模板、dfmea、verification-plan、detail-design、validation-report、defect-report）
- `skills/rtl-codestyle`（6 个文件）—— 可综合 Verilog/SV 的 Erie/verilog-generator 风格契约
- `skills/rtl-verif`（20 个文件）—— cocotb 与 VCS-UVM 测试平台模板、Makefile 流程、回归示例、fixtures

**没有 `presets/` 目录**：`rtl-ip` 团队 profile 已退役 —— 见下文「rtl-ip 退役」。

## 对 @mpd-dsh/mpd 的硬依赖

`@mpd-dsh/mpd` 是**运行期依赖**，不是可选伴生：

- `package.json` 把它**精确**钉在 `0.15.1`（无 caret、无范围）。
- 插件源码通过包说明符 `@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js` 导入 adapter；本仓库不复制任何 adapter，也不存在本地移植。
- 消费行使用 `inject: [...dshSeamInject(...), "mpdDsh"]`，并从 `ctx.mpdDsh` 读取 adapter。**没有回退** —— 提供者缺席时该行按设计保持 PENDING，这正是守卫行存在的原因。
- `silicon-require-mpd` 是 inject-free，因此在任何组合里都会 apply。当 `mpdDsh` 始终未 ACTIVE 时它 throw，CLI 将其转成退出码 1，并打印：

  ```
  silicon requires @mpd-dsh/mpd: the mpdDsh service is absent; install @mpd-dsh/mpd@0.15.1 and enable the mpd-dsh-adapter row
  ```

为什么这里不提供 `mpdDsh`：Cordis 服务只有一个提供者。`mpdDsh` 归 mpd 的 `mpd-dsh-adapter` 行所有；在本 bundle 重复注册会让任何同时挂载两个 bundle 的 profile 整棵插件树 abort。

## 与 @mpd-dsh/mpd 的关系

本 bundle 正是 mpd 剥离出去的 RTL 面：能力相同，归本仓库所有，使 MPD 仓库不再承载 RTL 内容。具体而言：

- **row id 归 silicon 所有，与 mpd 零交集。** 每个 row id 都带 `silicon-` 前缀，且本 bundle 的 patch **不含任何 id-target** —— 非 insert patch 是顶层整值替换，而非深合并。
- **一个 adapter，一个服务。** 两个 bundle 共用 mpd 的 adapter 契约；mpd 提供 `mpdDsh`，silicon 消费它。正因如此，两个 bundle 能装进同一个 profile 并存。
- **两个 bundle 装进同一 profile 可用 —— 已在 0.2.1-rc.2 上实测。** 以 `dsh 0.2.1-rc.2` + `@mpd-dsh/mpd 0.15.1` + 本 bundle 真实启动，进程存活到 50 s（超时被杀，退出码 124），并打印 `[mpd-silicon-bootstrap] skill corpus served`。打包产物同样启动到 45 s（退出码 124）。三类碰撞保持闭环：服务单例（`mpdDsh` 归 mpd）、工具命名空间（本包 `mpd_verif_*`，mpd 为 `mpd_verify_*`）、MCP `serverName`（`silicon_lsp`，mpd 自己的行用自己的名字）。
- **只有 silicon 的 profile 会大声失败 —— 已实测。** 磁盘上没有 mpd 时，启动在 18 s 后以退出码 1 停下并打印上面的守卫信息，两个消费行都报 `pending (waiting for service: mpdDsh)`。
- **row-id 门禁已适配当前 mpd 布局。** mpd v0.15.1 把 patch 移到仓库根，并增加第二层（`cordis.patch.yml` + `presets/mpd.patch.yml`，由 `dsh.bundle.patch` 声明）。`verify-rows-disjoint.mjs` 会发现每个声明的层、逐层报告数量，实测 5 个 silicon id ∩ 35 个 mpd id = ∅。

## 安装

前提：

- **DeepSeek Harness `>= 0.2.1-rc.2`**（`dsh --version`）。
- **`@mpd-dsh/mpd` `0.15.1`** —— silicon 的硬性运行期要求；下面的命令会在同一次安装中装上它。
- **Node `>= 22.18`**（manifest 的 `engines` 声明）。
- **`PATH` 中有 pnpm** —— `dsh plugin …` 把参数原样转交给 profile 目录里的 pnpm。实测使用
  **pnpm 9.15.9**；另见下方 pnpm 注记。

### 一条命令（推荐）

只装 silicon 不够：它的行需要 `mpdDsh` 服务，而**传递安装**的 mpd 不会被自动激活。请用**一条命令
同时安装两个 bundle**。

从注册表安装 —— `@mpd-dsh/silicon@0.7.2` **已发布**（2026-10-30 实测：`npm view
@mpd-dsh/silicon@0.7.2` 返回 `0.7.2`，dist shasum `36d96f048bd5d0c49d8eaaac461b67d65ce1482e`，
86 个文件，附带已签名的 SLSA provenance 证明）：

```bash
dsh plugin --profile <your-profile> add -w @mpd-dsh/mpd@0.15.1 @mpd-dsh/silicon@0.7.2
```

上面的注册表**安装**命令尚未在本机复测；已实测的是下面的 tarball 形式。`0.7.0` 是首次发布；
`0.7.1` 从未发布（其 tag 上的直接 `npm publish` 尝试被拒绝），此后每个新版本都由 `release.yml`
在 `v*` 标签上通过 npm Trusted Publishing（GitHub OIDC、provenance、无 token）**暂存发布**，
再由维护者用 2FA 批准，才会正式上线。

用本仓库打出的 tarball 安装（无需先发布）：

```bash
npm pack
dsh plugin --profile <your-profile> add -w @mpd-dsh/mpd@0.15.1 ./mpd-dsh-silicon-0.7.2.tgz
```

把 `<your-profile>` 换成你启动的 profile（例如 `dsh-tui`）。`dsh plugin` 把 `--profile <name>` 之后的
参数原样转交给 pnpm，因此 `-w` 就是 pnpm 的 `--workspace-root`：profile 目录是 pnpm workspace 根，
pnpm 9 不接受不带它的根安装。

安装会自行登记：`dsh plugin add` 把每个**新装的直接依赖**中声明了 `dsh.bundle.patch` 的包追加到
`dsh.profile.bundles`，无需手改 manifest。它写入 profile 的 `package.json`、`pnpm-lock.yaml` 与
`node_modules`，不碰 `$DSH_HOME` 的其他内容。

**本机实测（2026-10-23，上面的 tarball 形式）**：pnpm 9.15.9、dsh 0.2.1-rc.2、隔离 `DSH_HOME`。
安装退出码 0；profile manifest 的 `dependencies` 最终同时含 `@mpd-dsh/mpd` 与 `@mpd-dsh/silicon`，
`dsh.profile.bundles` 同时含两者；真实启动打印 `[mpd-silicon-bootstrap] skill corpus served`。**只装
silicon** 的 profile 安装同样成功，但启动时以退出码 1 停在 `silicon-require-mpd` 守卫信息上 —— 这是
诚实的下限，不是 bug。记录（仅仓库）：`evidence/verification/plugin-install/20261023T022635Z/`。

> **pnpm 注记。** 上面的安装由 pnpm 9.15.9 完成；同一主机上 corepack 解析出的 pnpm 12.15.0 以
> `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` 失败（store 锁路径落在只读文件系统上）。遇到该错误时，
> 把 pnpm 9.x 的二进制放到 `PATH` 最前面再跑一次。

### 更新

用新的版本重跑同一条 tarball `add`（已实测的形式）：

```bash
npm pack
dsh plugin --profile <your-profile> add -w @mpd-dsh/mpd@0.15.1 ./mpd-dsh-silicon-<new-version>.tgz
```

注册表形式 `dsh plugin … add -w @mpd-dsh/mpd@0.15.1 @mpd-dsh/silicon@<new-version>` 的 **`0.7.2`
已发布**；后续版本先暂存，经维护者批准后才会上线。注册表**安装**路径未在本机复测 —— 上面那条
tarball 路径才是已实测的形式。

除非本 bundle 的钉子随之移动，mpd 保持在 `0.15.1` —— 两者配套发布。

### 卸载

```bash
dsh plugin --profile <your-profile> remove @mpd-dsh/silicon
```

该命令从 profile 移除包，并把它从 `dsh.profile.bundles` 中去掉（harness 在一次成功运行后核对
该列表）。bundle 的行与 skill 语料随之消失；从未向 `$DSH_HOME` 复制任何内容。若把 `@mpd-dsh/mpd`
也移除，只含 silicon 的 profile 会停在守卫处。

### 手动路径：直接编辑 profile 的 package.json

需要自己掌控文件时，profile 目录路径仍然可用：

1. 在 `$DSH_HOME/profiles/<your-profile>/package.json` 的 `dependencies` 中加入两个 bundle：
   `"@mpd-dsh/mpd": "0.15.1"` 与 `"@mpd-dsh/silicon": "0.7.2"`（或 `file:`/tarball 说明符）。
2. 在同一文件的 `dsh.profile.bundles` 中加入这两个名字 —— 该路径不会核对这个列表，不在列表里的
   bundle 不会贡献任何 patch 层。
3. 在该 profile 目录执行 `bun install`（该路径需要 **bun**）。

这条是备用的手动路径；已实测的是上面那条一条命令的路径。

本 bundle 面向 `dsh >= 0.2.1-rc.2` 与精确的 `@mpd-dsh/mpd 0.15.1`；不声称兼容更早的 harness 代际或其他 mpd 版本。

## 构建与测试

前提：Node `>= 22.18`、**bun**（构建与测试运行器；实测 1.4.3）、git。`bun install` 安装 `@mpd-dsh/mpd` `0.15.1` 以及类型门禁需要的类型根（`bun-types`、`@types/node`）。

```bash
node scripts/build.mjs                      # 逐插件 bun build -> dist/index.js（bun 需在 PATH 中）
bun test packages/                          # 325 pass / 1 skip / 0 fail（326 个测试，25 个文件）
node scripts/typecheck.mjs --require        # 类型根缺失时失败而不是跳过
```

套件分布：`mpd-verif-plugin` 169 个测试 / 16 个文件，`mpd-silicon-bootstrap-plugin` 30 / 2，`mpd-silicon-guard-plugin` 11 / 2，`mpd-mcp-lsp` 10 / 1，`mpd-docgen-plugin` 106 / 4。唯一的 skip 是语料对照源工程 checkout 的交叉检查：RTL 剥离后这是预期状态（三棵树已不在源工程，语料仍由提交的基线校验）。

## 门禁

| 命令 | 含义 |
| --- | --- |
| `node scripts/typecheck.mjs --require` | 本地 tsgo 零诊断；`--require` 把「缺类型根就跳过」变成失败 |
| `bun test packages/` | 插件单元套件（326 个测试：325 pass / 1 个显式声明的 skip，25 个文件） |
| `node scripts/verify-corpus.mjs` | 3 棵 RTL 树逐字节匹配提交基线（sha256 + 大小）、LF-only UTF-8，且 provider 能加载全部 3 个 skill |
| `node scripts/verify-rows-disjoint.mjs` | 本 bundle 的 row id ∩ **mpd 声明的每一层 patch** = ∅；从各 manifest 的 `dsh.bundle.patch`（字符串或数组）发现层，缺省回退仓库根 patch |
| `node scripts/verify-rows-disjoint.mjs --self-test` | 同一门禁 + 6 个解析、2 个门禁与 6 个发现夹具；退出 1 = 夹具失败，2 = 输入不可读 |
| `node scripts/build-lsp.mjs --check` | `dist/cli.js` 匹配 `BUILD.lock`（sha256 + 大小）、两个 HDL server 都在、overlay 锚点与参考文档齐全 |
| `node scripts/pack-silicon.mjs --self-test` | 证明包集门禁可证伪（未列出的包必须失败；伪造源树必须触发泄漏门禁） |
| `node scripts/pack-silicon.mjs --check` | 任何提交文件非 root 用户不可读时退出 1 |
| `node scripts/pack-silicon.mjs --fix` | 就地修复这些模式（幂等）；工具写过文件后、提交前运行 |
| Boot 检查 | 两个隔离 `DSH_HOME` 下真正挂载各行的启动：**共存**（mpd + silicon，须存活并服务语料）与 **无 mpd 拒绝**（仅 silicon，须以退出码 1 打印守卫信息） |
| `bun packages/mpd-verif-plugin/evidence/smoke/smoke.mjs` | 包内工具面冒烟；无法运行的 HDL/VCS 检查会打印 SKIP 与原因 |

`--dump-config` 只证明组合，不证明插件代码真的 apply；`--help` 在插件树稳定前产生，两个方向都不算证据。挂载结论看真实启动的退出码与 stderr，工具结论看真实 `tool/result`。

## 体积（0.3.0 → 0.5.0）

adapter 移植及其测试已离开仓库；构建产物不再内联 `@mpd-dsh/mpd`，而是将其外部化。当前 dev 树在 0.5.0 依赖 profile 之上，还带着 devshell、sim/regress 与 slang-server 的修复。

| 产物 | 0.3.0 | 0.5.0 | 说明 |
| --- | --- | --- | --- |
| `mpd-verif-plugin/dist/index.js` | 226,463 B | 160,209 B | 改为导入 mpd adapter，不再内嵌 |
| `mpd-silicon-bootstrap-plugin/dist/index.js` | 80,793 B | 11,734 B | 同样外部化 |
| `mpd-dsh-adapter-plugin/dist/index.js` | 77,563 B | — | 包已删除 |
| `mpd-silicon-guard-plugin/dist/index.js` | — | 1,420 B | 新增守卫 |
| **提交的 JS dist 合计** | **384,819 B** | **173,363 B** | **−54.9 %** |
| **打包产物** | **919,281 B** | **700,120 B** | **−23.8 %** |

被移除的仓库内 adapter 包占 646,769 B；`bun.lock` 现在约 57 KB；新守卫包文件合计约 18 KB，随包分发的 dist 为 1,420 B。

**docgen 增量（2026-10-22 测量）。** `mpd-docgen` 特性新增 `packages/mpd-docgen-plugin/dist/index.js` = **119,911 B**，提交的 JS dist 合计因此变为 160,209 + 11,734 + 1,420 + 119,911 = **293,274 B**。`du -sb dist/silicon-package` 的 **843,280 B** 是 0.6.0 时代的打包暂存产物（整树表观大小，在打包改动之前测量）；0.7.0 还随包分发 LSP 资产、文档、测试 fixtures 与 prepack 守卫，因此当前打包暂存产物**更大**。其精确大小、sha256 与文件数记录在 `evidence/verification/plugin-install/20261023T022635Z/`，不写在本页，因此这里的数字不会过期。上表中 0.3.0 → 0.5.0 的百分比保持历史原值、不再改写。

## EDA 后端与前提

verif 工具在调用时解析后端：先查 `MPD_DSH_VERIF_IVERILOG` / `MPD_DSH_VERIF_VERILATOR` / `MPD_DSH_VERIF_VCS`，再查 silicon 工具链配置（`ossCadSuite.bin`，或 `ossCadSuite.home` + `/bin`），最后查 `PATH`。**不随包分发任何仿真器。**

- **开源通道**（iverilog 和/或 verilator + cocotb）：cocotb 严格遵循项目本地 venv 铁律 —— 用 `python3 -m venv` 创建，所有安装走该 venv 自己的 pip，绝不使用系统 python/pip。`mpd_verif_venv`（action `create`）负责初始化。
- **VCS 通道**（VCS + UVM 1.2）：需要商业 VCS 许可，并在启动 shell 中导出 `VCS_HOME` / `VERDI_HOME` / `NOVAS_HOME`。本 bundle 不提供、不激活、不代签许可。
- **没有任何后端的机器得到的是诚实拒绝，不是崩溃。** `mpd_verif_backends` 返回 `ok: false`，附每个后端提示与顶层 note；测试套件会探测宿主，有后端时断言成功，无后端时断言该拒绝，并打印 `ENV-GATED: no HDL backend (iverilog/verilator) — install with apt install iverilog verilator`。
- **开源通道已在 `/opt/openictool` 上真实验证（2026-10-22）。** oss-cad-suite 20261021 提供 iverilog 14.0 与 verilator 5.053（另有 `verilator_coverage`）；`mpd_verif_backends` 以 `source: "config"` 解析出两者，compile 与 lint 各自返回 `OK`，两个编译产物直接运行均以退出码 0 结束。`mpd_verif_sim` 在每个后端上各通过 1 个用例，`mpd_verif_regress` 在每个后端上均 1/1 通过；覆盖率把 4 个文件合并成 `merged.dat`（4,260 B）并产出标注报告。VCS 缺席（无许可；`mpd_verif_uvm` 返回预期的 `VERIF_E_NO_BACKEND`）。证据见 `evidence/verification/openictool/20261022T145500Z/`。
- **波形读取**：`silicon-mcp-wave-mcp` / `silicon-mcp-traceweave` 行仅以注释示例存在，**默认不启用**。它们封装外部 Python MCP 服务（`pipx install wave-mcp`、`pipx install traceweave-mcp`）；默认关闭的原因是启动 python 上缺失或版本不匹配的 `mcp` SDK 会让 MCP 客户端在启动阶段崩溃并拖垮宿主。需要时取消注释并固定 `MPD_DSH_WAVE_MCP_BIN` / `MPD_DSH_TRACEWEAVE_BIN`。关闭期间 verif 工具优雅降级。

## 工具链配置

外部工具装在哪里是机器相关的，因此从一份两层 JSONC 配置读取，而不是写死：

| 层 | 路径 |
| --- | --- |
| user | 设置了 `$MPD_SILICON_CONFIG` 时用它，否则 `${DSH_HOME:-~/.dsh}/silicon.jsonc` |
| project | `<workspace>/.mpd/silicon.jsonc`（深合并覆盖 user 层） |

以下示例使用在 `/opt/openictool` 主机上实测的路径（允许注释与尾随逗号）：

```jsonc
{
  // oss-cad-suite provides iverilog, verilator and verilator_coverage.
  "ossCadSuite": { "home": "/opt/openictool/oss-cad-suite" },
  // verible provides verible-verilog-ls (the HDL language server).
  "verible": { "bin": "/opt/openictool/verible" },
  // slang-server provides the SystemVerilog language server (.sv/.svh).
  "slangServer": { "bin": "/opt/openictool/slang-server" },
  // librelane is the RTL-to-GDS flow driver.
  "librelane": {
    "mode": "auto",
    "appimage": "/opt/openictool/librelane/librelane-devshell-x86_64.AppImage"
  }
}
```

在该主机上这四个键写在 **project** 作用域（`set`），原注释都保留了下来；被删掉的叶子会留下空行（仅影响观感）。`mpd_verif_toolchain` 每次调用都会解析 project 层，但 LSP 启动器只有在 dsh 进程 cwd 就是工作区时才读取它 —— 见 [`docs/toolchain.zh-CN.md`](./docs/toolchain.zh-CN.md) 的 cwd 注意事项。

`mpd_verif_toolchain` 展示有效配置与已解析的后端，并通过保留注释的手术式编辑持久化路径（`show` / `set` / `unset` / `init` / `path` / `detect`）。运行期仍是 `MPD_DSH_VERIF_*` 优先，然后是配置，最后是 `PATH`。同一份文件也驱动 HDL 语言服务启动器，因此在这里设置的 `verible.bin` 与 `slangServer.bin` 都能被 LSP 行读到。

`mpd_verif_librelane` 以 `binary`、`appimage` 或 `devshell` 模式解析并运行 LibreLane（`auto` 会使用已配置的 AppImage，basename 含 `devshell` 时走 devshell）。devshell 包装器的真实接口是 `devshell [--pure] <cmd> [...]`，因此运行器直接执行 `[appimage, "librelane", ...args]`（无 shell、无引号转义），`status` 探测 `[appimage, "librelane", "--version"]`。0.4.0 的 `[appimage, "--run", "librelane <posix-quoted args>"]` 形状是错的：`--run` 并不存在，会以 127 退出（`exec: --run: not found`）。在没有 FUSE 的主机上运行器自动设置 `APPIMAGE_EXTRACT_AND_RUN=1`；`status` 报告解析出的路径、来源、版本与命令预览，`run` 把日志留在 `.mpd/librelane/`。

完整参考：[`docs/toolchain.zh-CN.md`](./docs/toolchain.zh-CN.md)。

## HDL 语言服务

HDL server 以本仓库为唯一归属：`packages/mpd-mcp-lsp/dist/cli.js` 由 `dist/BUILD.lock` 固定（sha256 `04b49f8c…`，235271 字节；overlay 锚点 `mpd-rtl-overlay-v1`），构建方式是在上游 `lsp-core`/`lsp-daemon` 源码上叠加 Verible/slang-server overlay。在 mpd v0.15.1 中该包已被重新定位为 cclsp 启动器，因此 HDL 半边只存在于本 bundle。

在适配基线上实测：该行启用后挂载成功，MCP server 协商协议 `2025-06-18`，广告上述 8 个工具，且一次真实 harness 工具调用返回了已配置 server 状态。该测量早于 0.4.0 依赖 profile；新的 profile 启动未被用来声称真实工具调用。`serverName` 为 `silicon_lsp`，因为 `serverName` 是进程级全局命名空间，mpd 自己的 MCP 行使用自己的名字。

2026-10-22 的 `/opt/openictool` 测试用两个真实 server 行使了该行：**44 个已配置 server、2 个已安装** —— Verible `v0.0-4296`（`.v/.vh`）与 slang-server `0.3.1+`（`.sv/.svh`）。Verible：干净的加法器返回 `No diagnostics found`，损坏文件返回 `error[verible]`（`3:2` 与 `4:0`），`verible-verilog-lint` 以 1 退出。slang-server：干净文件返回 `No diagnostics found`，损坏文件返回 `error`（`2:22` 与 `3:12`）并附 `warning (unused-port)`。陈旧的 daemon 租约可能让启动延迟（`DaemonStartupDeferredError: owner_pid_live_unreachable`）；清理 `~/.mpd/lsp-daemon` 与 `/tmp/mpd-lsp-*` 即可恢复。证据见 `evidence/verification/openictool/20261022T145500Z/`。

## rtl-ip 退役

`rtl-ip` 团队 profile 数据（`presets/rtl-ip.profile.json` 及其载体契约）是**退役**，不是搬迁：

- 它依赖的团队 profile 平面已消失。`@deepseek-ai/dsh-experimental-agent-team` `0.2.1-rc.2` 只暴露四个限制项（`maxMembers`、`maxTasks`、`maxMessageBytes`、`disposalTimeoutMs`）；没有 `config.profiles`，也没有 `resolveTeamProfile` 可供合并。旧 hook 契约指向的行已不存在。
- 替代方案是 mpd 的 **roster**（11 个专家，`mpd_role_spawn` / `mpd_role_persona`）、`mpd.jsonc` 里的 **`teamModels.slot1..4`** 路由，以及 **workmate 库**（`~/.mpd/workmate`）。它们能表达 persona、provider/model 与持久身份，而旧的 7 成员文件在当前 harness 上做不到。
- `rtl-ip-flow` **skill 仍然保留**：它是领域流程（四阶段、闸门、文档模板）。消失的只是 `--profile rtl-ip` 这种团队 profile 调用方式。用官方 Agent Teams 工具组队，并把 skill 里的 RTL 角色交给成员。

不随包提供替代数据文件，本 bundle 仍绝不 id-target mpd 的任何行。

## 与源仓库的同步策略

RTL 资产从源工程 —— 兄弟目录 `../my-power-dsh`，可用 `MPD_SOURCE_ROOT` 覆盖（口径见 `docs/sync-policy.md`）—— 迁入，随后在源工程中**物理移除**（源侧任务 t5），之后本仓库是该能力的唯一归属。`skills/**` 由提交的 `evidence/verification/corpus-baseline.json` 校验；源 checkout 只是可选的交叉检查。`@mpd-dsh/mpd` 作为钉死的外部依赖消费；钉子与升级流程记录在 [`docs/sync-policy.md`](./docs/sync-policy.md)。

## CI 与发布

CI 跑在 **GitHub Actions**（`.github/workflows/`），共四个工作流：

- `ci.yml` —— 在 `main` 上（push 与 pull request）跑**静态门禁**：类型、测试、语料、行 id、LSP 资产、打包器自检、workflow 检查、`--self-test`/`--check`（`--fix` 只在本地）、pack、包自检与包校验；并把 `dist/silicon-package` 作为 `silicon-package` 产物上传。
- `docker-verify.yml` —— **docker 真机验证**：构建仓库 `Dockerfile`（Node 24 + bun `1.4.3` 上的真实 iverilog、verilator 与 yosys），跑完整门禁与 EDA 冒烟，期望 `DOCKER-VERIFY: PASS`，并把 `docker-verify.log` 运行日志作为 `docker-verify-log` 产物上传。
- `boot-e2e.yml` —— 在命中路径的 `main` push 与手动触发上跑两个真实启动（共存与无 mpd 拒绝）。
- `release.yml` —— `v*` 标签先断言标签版本等于 `package.json.version`，跑门禁，产出 `npm pack` tarball 与 `dist/silicon-package.tar.gz`，用 `npm stage publish --access public --provenance` 通过 **npm Trusted Publishing** 把 `@mpd-dsh/silicon` **暂存到 npm**，发布 **GitHub Release**，并把验证镜像推送到 **GHCR**（`ghcr.io/haroldz32/mpd-silicon:vX.Y.Z` 与 `:latest`）——这些都在同一次运行中完成；维护者**随后**用 2FA 批准暂存版本，只有批准后才正式上线。

npm Trusted Publishing 使用 **GitHub OIDC token**：工作流授予 `id-token: write`，npm 自己用这枚短时 token 与注册表交换凭据，可信发布者绑定到本仓库加 `release.yml` 这个文件名 —— 因此**没有 `NPM_TOKEN` secret，也没有 `.npmrc`**。对可信发布者而言暂存发布始终被允许，而直接的 `npm publish` 需要 `--allow-publish`，在 `v0.7.1` 尝试中因 `E403` 失败（run `41019623710`）。暂存步骤排在版本断言与整条门禁链之后，所以与 `package.json.version` 不匹配的标签永远到不了注册表，`--provenance` 还会附上签名的构建证明；随后维护者用 2FA 批准暂存版本，才会正式上线。`v0.7.1` 标签是保留为历史的失败尝试。manifest 本身可发布（`files`、`engines`、`license`、`repository`、`publishConfig.access: public` 与 `prepack` 守卫）。`0.7.2` 已在注册表上（2026-10-30 暂存批准后实测：`npm view @mpd-dsh/silicon@0.7.2` 返回 `0.7.2`，dist shasum `36d96f048bd5d0c49d8eaaac461b67d65ce1482e`，86 个文件，附带已签名的 SLSA provenance 证明）；`0.7.0` 是首次发布，发生在 OIDC 步骤落地之前；`0.7.1` 从未发布。分支模型：`main` 是主干，也是唯一的 PR 目标；`feature/*` / `fix/*` 为短分支；`release/vX.Y.Z` 承载发布版本递增（annotated `vX.Y.Z` 标签打在 `main` 上）。参见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)、PR 模板 `.github/PULL_REQUEST_TEMPLATE.md`、[`CHANGELOG.md`](./CHANGELOG.md) 与 [`docs/toolchain.md`](./docs/toolchain.md)。其中 `CONTRIBUTING.md`、`.github/`、`AGENTS.md` 与 `evidence/` 记录**仅仓库**——不在 npm tarball 中。

## 许可

MIT —— 见 [`LICENSE`](./LICENSE)。第三方组件保留各自原始许可；见 [`LICENSE-NOTICES.md`](./LICENSE-NOTICES.md)。`@mpd-dsh/mpd` 0.15.1 是外部 SUL-1.0 依赖，**不随本仓库再分发**。

## 状态

`evidence/verification/mpd-dependency/` 记录 0.4.0 依赖 profile（启动、守卫拒绝、体积与测试测量）。0.3.0 的证据（`evidence/verification/harness-0.2.1-rc.2/`、`t7-install-boot.md`、`t3-*`）属于**历史**，未被编辑：它测量的是 0.4.0 已移除的独立安装。限制写在证据里而不是藏起来。2026-10-22 的完整 `/opt/openictool` 测试补上了真实开源通道的端到端测量：配置 `set`/`show`（含 `slangServer.bin`）→ `show`/`backends`、iverilog 与 verilator 的 compile + lint、两个后端 `sim` PASS（1 个用例）与 `regress` 1/1 PASS、覆盖率合并/报告、预期的 UVM 拒绝、LibreLane devshell 的 `status` + `run`，以及两个 HDL 服务；整套门禁同时为绿（当前套件为 326 个测试 / 25 个文件；typecheck `--require`、语料、行 id 5 ∩ 35 = ∅、LSP 资产、GitHub workflows、`ci-boot --require`）。记录在 `evidence/verification/openictool/20261022T145500Z/`。仍未覆盖：任何 VCS 通道（无许可 —— `mpd_verif_uvm` 是预期拒绝）与完整的 PDK/RTL-to-GDS 流程（`yosys`、`gtkwave` 与 slang 编译器存在但本 bundle 未使用；AppImage 因 `/dev/fuse` 缺席而以 `APPIMAGE_EXTRACT_AND_RUN=1` 运行）。
