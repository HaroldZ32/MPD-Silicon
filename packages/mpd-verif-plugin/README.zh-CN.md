# mpd-verif-plugin

[English](./README.md)

my-power-dsh 的统一 RTL 验证插件（Plan A 验证侧）。一个插件、三种后端 ——
**iverilog / verilator / vcs** —— 通过 `MPD_DSH_VERIF_*` 环境变量、两层 silicon
工具链配置或 `PATH` 解析（永不捆绑二进制产物）：开源后端走** cocotb 通道**并严格执行项目本地
虚拟环境隔离铁律；**UVM 方法学通道仅限 VCS**；**波形读取钩子**在检测到用户
已接入的 wave-mcp / TraceWeave MCP 工具时调用它们，未接入时优雅降级并给出
一键安装命令。

## 对 @mpd-dsh/mpd 的硬依赖

本插件不是独立插件。bundle 根 `package.json` 把 `@mpd-dsh/mpd` 精确钉在 `0.15.1`，adapter 通过包
说明符 `@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js` 导入（类型来自其
`src/index.ts`），且该行声明硬 inject 依赖：

```ts
export const inject = [...dshSeamInject(DSH_SEAM_TOOLS), "mpdDsh"]
```

adapter 从 `ctx.mpdDsh` 读取；**没有回退**。没有 mpd 的 profile 会让该行保持 PENDING，bundle 的
`silicon-require-mpd` 守卫会在 15 s 内把它变成退出码 1。测试或构建前必须执行 `bun install`，因为
dist 保持该依赖为外部依赖而不内联。

## 工具

| 工具 | 用途 |
| --- | --- |
| `mpd_verif_venv` | 管理项目本地 cocotb 虚拟环境：`status`（默认）/ `create` / `info` |
| `mpd_verif_backends` | 探测 iverilog/verilator/vcs 可用性（env → PATH）、版本、vcs 许可证提示 |
| `mpd_verif_compile` | 全量编译出仿真二进制，从日志中尽力解析诊断 `{file,line,severity,code,message}` |
| `mpd_verif_lint` | 独立 lint 检查：iverilog `-g2012 -tnull -Wall` / verilator `--lint-only -Wall` / vcs `-lca -sverilog +lint=all` |
| `mpd_verif_sim` | iverilog/verilator 上的 cocotb 仿真，走 **cocotb Makefile 流**：生成 `Makefile`，以 `$VENV/bin` 前置 PATH 调用 `make`（随后是解析出的工具目录、继承的 PATH），iverilog 后端的 `SIM=icarus`，解析 results.xml 得到逐用例状态、收集波形、可选转交 wave-mcp。在 oss-cad-suite 上，iverilog 通道把 `ICARUS_BIN_DIR` 指向一个用 `env -u PYTHONHOME` 运行自带 loader 的 shim（`vvp` 包装器会重新注入它） |
| `mpd_verif_coverage` | 独立覆盖率合并/报告：verilator `verilator_coverage --annotate <dir> --annotate-all <merged.dat>`（5.053 中 `--all` 非法）/ vcs `urg -dir … -report …`；`.dat` 收集排除 `<top>__verFiles.dat`（构建元数据）；iverilog 明确拒绝（`VERIF_E_UNSUPPORTED`，无原生覆盖率） |
| `mpd_verif_uvm` | **仅限 VCS** 的 UVM 通道：模板布局契约校验 + compile/run/regress/wave/merge-cov/clean |
| `mpd_verif_regress` | 多用例回归（两个通道通用），确定性种子，输出 `results.json` + markdown 报告 |
| `mpd_verif_toolchain` | 查看与编辑 silicon 工具链配置（`silicon.jsonc`）：`show`（默认）/ `set` / `unset` / `init` / `path` / `detect`。每次写入单个键，保留注释的手术式编辑；原子写入，歧义即拒绝 |
| `mpd_verif_librelane` | 解析并运行 LibreLane（开源 RTL-to-GDS 流程）：`status`（模式/路径/来源/版本/命令预览）/ `run`（原样 argv、限定工作区的 cwd、默认 1 小时超时、日志写入 `.mpd/librelane/`） |

## 铁律 —— cocotb 虚拟环境隔离

1. 虚拟环境位于 `<workspace>/.venv-rtl`（或 `MPD_DSH_VERIF_VENV`）—— **绝不**使用系统 Python。
2. **只能**通过 `python3 -m venv <path>` 创建（系统解释器唯一的合法用途）。
3. 每个 pip 安装都以 `<venv>/bin/pip install ...` 执行 —— **绝不**使用 `--user`、`--system`、pipx 或系统 pip。
4. 每次仿真都通过生成的 **Makefile** 以 `make` 执行，PATH 前置 `$VENV/bin`（DP-6），保证内部每个 cocotb python 都解析到虚拟环境内的解释器 —— 绝不裸调 `python`。
5. 虚拟环境不存在**或**其中无法 import cocotb 时，`mpd_verif_sim` 拒绝执行（`VERIF_E_NO_VENV` / `VERIF_E_COCOTB_ABSENT`），拒绝信息附带精确的初始化命令：

```sh
python3 -m venv .venv-rtl && .venv-rtl/bin/pip install "cocotb>=2.0"
```

或直接调用 `mpd_verif_venv` 并传 `action: "create"`。

## 后端解析

| 后端 | 环境变量覆盖 | 工具链配置 | PATH 回退 |
| --- | --- | --- | --- |
| iverilog | `MPD_DSH_VERIF_IVERILOG` | `ossCadSuite.bin`，或 `ossCadSuite.home` + `/bin` | `iverilog` |
| verilator | `MPD_DSH_VERIF_VERILATOR` | `ossCadSuite.bin`，或 `ossCadSuite.home` + `/bin` | `verilator` |
| vcs | `MPD_DSH_VERIF_VCS` | —（VCS 仍由环境变量/站点管理） | `vcs` |

解析分层：环境变量覆盖仍然优先，然后是工具链配置，最后是 `PATH`。`mpd_verif_backends`
会把实际使用的档位报告为 `source: "env" | "config" | "path"`。`slangServer.bin` 不参与这套解析：它只供 HDL LSP 启动器拼 `PATH`。

工作状态落在 `<workspace>/.mpd/verif/`（或 `MPD_DSH_VERIF_WORK`）。插件绝不写
`~/.dsh`，**唯一例外**是显式的 `mpd_verif_toolchain` user 作用域 `set`/`unset`/`init` ——
它写的是用户自己的 `silicon.jsonc`（见下文），属于配置而非插件状态，且绝不隐式发生。

## 工具链配置

两份 JSONC 层，深合并时 project 覆盖 user：

| 层 | 路径 |
| --- | --- |
| user | 设置了 `$MPD_SILICON_CONFIG` 时用它，否则 `${DSH_HOME:-~/.dsh}/silicon.jsonc` |
| project | `<workspace>/.mpd/silicon.jsonc` |

文件缺失是正常状态；文件格式错误会被报告（`show`）或拒绝（`set`/`unset`），绝不崩溃。
Schema：`ossCadSuite { home?, bin? }`、`verible { home?, bin? }`、`slangServer { bin? }`、`librelane { appimage?, mode?, appimageExtract?, bin?, home? }`。`.bin` 是可执行文件**或** bin 目录；`.home` 是安装根。路径会做 `~` 展开；user 作用域必须是绝对路径，workspace 作用域的相对值按工作区解析。`slangServer.bin` 只供 HDL LSP 启动器拼 `PATH`，不是验证后端。

`mpd_verif_toolchain` 是对话入口：`show`（有效配置、逐键来源层、已解析二进制及其存在性/可执行位/版本、两份文件路径）、`set`（单个键）、`unset`、`init`（带注释模板）、`path`（两份文件）、`detect`（探测环境变量/PATH/常见根，只返回建议，永不写入）。`set`/`unset` 作用于已经定义该键的层，否则 user 层；`scope: "user" | "workspace"` 可覆盖。写入是**手术式**的（保留注释、键顺序与空白 —— 编辑器移植自 `@mpd-dsh/mpd` 的 `mpd-config-plugin`，本移植为 MIT；上游许可见 [`LICENSE-NOTICES.md`](../../LICENSE-NOTICES.md)）且**原子**（同目录临时文件 + rename，模式 0644）。文档有歧义或格式错误时逐字节原样拒绝。`init` 在文件已存在时拒绝，除非 `force: true`。

完整参考：[`docs/toolchain.zh-CN.md`](../../docs/toolchain.zh-CN.md)。

### LibreLane

`mpd_verif_librelane status` 负责解析与探测，`run` 负责执行。`librelane.mode`（默认 `auto`）选择档位，然后是环境变量，最后是 `PATH`：

| 模式 | 解析 | 运行 |
| --- | --- | --- |
| `binary` | `librelane.bin`（文件或目录）、`librelane.home` 候选、环境变量 `MPD_SILICON_LIBRELANE`、`PATH` | 直接执行 argv，无 shell |
| `appimage` | `librelane.appimage`、环境变量 `MPD_SILICON_LIBRELANE_APPIMAGE` | `[appimage, ...args]`，无 shell |
| `devshell` | 该 AppImage（basename 含 `devshell` 时 auto 选中） | `[appimage, "librelane", ...args]` —— argv 直接交给包装器（`devshell [--pure] <cmd> [...]`）；无 shell、无引号转义 |

`status` 报告 mode/configuredMode/path/source/reason、存在性与可执行位、解包决策、命令预览、解析出的版本与 hints。`librelane.appimageExtract` 未设置时解包为 auto：当 `/dev/fuse` 不可读+可写时**开启**，子进程获得 `APPIMAGE_EXTRACT_AND_RUN=1`。`run` 接受 `args`（原样）、可选的限定工作区 `cwd` 与 `timeoutMs`（默认 3600000），总是写 `.mpd/librelane/<UTC>-<slug>.log`，并返回 exitCode/duration/logPath/tails。超时只杀直接子进程；cwd 守卫是词法的。

真实 devshell 包装器没有 `--run` 参数：0.4.0 发布的形状 `[appimage, "--run", "librelane <posix-quoted args>"]` 会以 127 退出（`exec: --run: not found`）。2026-10-22 针对真实 3.0.16 AppImage 修复后 —— `status` → `mode: "devshell"`、extract true（`/dev/fuse` 缺席）、命令 `[appimage, "librelane", "--version"]`；`run` 以 5429 ms 退出 0，stderr 为空。证据：`evidence/verification/openictool/20261022T145500Z/`（仓库相对路径）。

### Prompt section

插件注册一个 `silicon-toolchain` prompt section（order 30），告诉 agent 工具链是可配置的 —— user `$DSH_HOME/silicon.jsonc`、project `<workspace>/.mpd/silicon.jsonc`，project 覆盖 user —— 并说明用 `mpd_verif_toolchain` 持久化“oss-cad-suite 装在 X”，用 `mpd_verif_librelane` 运行流程。它包在 `try`/`catch` 里，因此没有 `systemPrompt` 接缝的组合不会拖垮启动。

## 错误分类

所有结构化拒绝都返回 `{ ok:false, error:{ code, message, hint } }`：
`VERIF_E_NO_BACKEND` · `VERIF_E_NO_VENV` · `VERIF_E_COCOTB_ABSENT` ·
`VERIF_E_UNSUPPORTED` · `VERIF_E_LICENSE` · `VERIF_E_ENV` · `VERIF_E_COMPILE` ·
`VERIF_E_RUN` · `VERIF_E_TIMEOUT` · `VERIF_E_TEMPLATE` · `VERIF_E_CONFIG`。编译失败附带解析出的
诊断；UVM 编译失败有重试上限（3 次），耗尽后如实写出 `work/unresolved.md`。

## 通道门禁（Owner 决策）

- `mpd_verif_sim` = cocotb 通道，**仅 iverilog | verilator**。传
  `backend: "vcs"` → `VERIF_E_UNSUPPORTED` 并指向 `mpd_verif_uvm`（双向硬门控，
  按 owner 决策）。
- `mpd_verif_uvm` = UVM 方法学通道，**仅 VCS**（无 backend 参数）。它校验模板
  布局契约（`<ip>/{rtl,script,tb,top,test,work}`、`tb/tb_api_primitives.svh`
  共享 BFM 单一事实源、`test/<case>_test.sv` 命名、必备 `sanity_test` +
  `reg_access_test`），并按 makefile 式契约编排：
  `-ntb_opts uvm-1.2`、逐用例 `work/work_<case>_/` 目录、
  覆盖率 `-cm line+cond+tgl` + `urg` 合并、fsdb 波形运行（受
  `VERDI_HOME`/`NOVAS_HOME` 门禁），并附 **fsdbreport 非 GUI 验证 hook**
  （波形运行后对 FSDB 做完整性/警告报告，经
  `MPD_DSH_VERIF_FSDBREPORT` / `VCS_HOME`/`VERDI_HOME`/`NOVAS_HOME` / PATH 解析）。
  插件本身**不携带任何模板内容** —— 丰富的 cocotb/UVM 骨架位于
  `skills/rtl-verif` 能力库。方法学仅参考 gen-tb-skill 的**结构**与
  raysalemi/uvmprimer 的**模式**；**不复用两者的任何代码**。

## 波形读取钩子

sim/regress/uvm 运行后，插件会把产出的波形交给已注册的用户 MCP 工具；
未注册则优雅降级并给出可执行的提示：

- OSS 通道（`.fst`/`.vcd`）→ `mcp__wave_mcp__prepare_session`（wave-mcp；
  传 `out_dir`、`wave_path`、`top`）。会话目录 = `$DSH_HOME/wave-mcp`
  （或 `MPD_DSH_WAVE_MCP_SESSION`），按团队决策 DP-8。
- VCS 通道（`.fsdb` + 日志）→ `mcp__traceweave__get_sim_paths`（TraceWeave；
  传 `verif_root`、`case_name`、`sim_log`、`wave_file`）。

建议接线（完整说明见团队文档；**不强制手工 venv** —— venv 铁律仅属 cocotb）。两个 MCP
的 `mcp` SDK 版本互相冲突（wave-mcp 需 mcp>=2 → `mcp.server.mcpserver`；TraceWeave
锁定 mcp==1.27.0），所以各自走 pipx 独立环境：

```sh
pipx install wave-mcp            # FST/VCD 通道；mcp>=2
pipx install traceweave-mcp      # VCS/FSDB 通道；mcp==1.27.0
# 或一键：node scripts/install-mcp.mjs --with-wave --activate-wave
export MPD_DSH_WAVE_MCP_BIN="$(command -v wave-mcp)"
export MPD_DSH_TRACEWEAVE_BIN="$(command -v traceweave-mcp)"
```

## 环境备注（源工程 2026-08 环境）

以下是移植来源环境的历史备注，不是对本 checkout 的测量。2026-10-22 的 `/opt/openictool`
测试**确实**运行了 `mpd_verif_sim`（project venv 内 cocotb 2.1.0）：iverilog 与 verilator 均 PASS
（1 个用例），`mpd_verif_regress` 在两个后端上均 1/1 PASS。它还把 4 个覆盖率文件合并为
`merged.dat`（4,260 B）并产出标注报告。oss-cad-suite 的 `vvp` 包装器会重新注入 `PYTHONHOME`；
iverilog 通道因此把 `ICARUS_BIN_DIR` 指向一个 shim（`env -u PYTHONHOME`），而不是用包装器。证据：
`evidence/verification/openictool/20261022T145500Z/`（仓库相对路径）。

- Verilator+cocotb 全链路实测通过（results.xml 解析成功，VCD 波形产出）。
- Verilator FST 是 owner 选定默认值（`traceFst` 默认 **true** →
  `--trace-fst --trace-structs`），但构建期需要 **liblz4 头文件**；没有的机器上
  请设 `traceFst: false` 改用 VCD（wave-mcp 读取时会自动转换 VCD）。缺 lz4 的
  FST 构建失败会以 `VERIF_E_COMPILE` 暴露并附日志路径。
- oss-cad-suite 自带的 Icarus 捆绑了较旧的 glibc；本机上 icarus+cocotb 的
  VPI 通道可能在 `vvp` 阶段因 `GLIBC_2.38` 链接错误失败（除非 python 与
  Icarus 来自同一 glibc 阵营，发行版 iverilog 可用）。在本机请使用 verilator
  通道或发行版 Icarus。
- `MPD_DSH_VERIF_PYTHON3_CMD` 可覆盖仅用于虚拟环境引导（`python3 -m venv`）的
  `python3`，例如默认 shim 指向某个 SDK python 时。
- 单元测试用**伪二进制（fake-vcs 参数捕获）**与伪项目虚拟环境覆盖全部通道；
  真实工具冒烟脚本位于包内 `evidence/smoke/`（用
  `bun packages/mpd-verif-plugin/evidence/smoke/smoke.mjs` 重跑）。

## 开发

```sh
bun test packages/mpd-verif-plugin   # 169 个测试 / 16 个文件（伪工具，无需真实 EDA）
bun run typecheck                    # 仓库门禁
bun build src/index.ts --target node --format esm --outfile dist/index.js
```

外部运行时依赖：`@mpd-dsh/mpd` 0.15.1（导入，绝不内联）；其余运行时导入均为 `node:` 内置模块。
面向 Agent 的代码按仓库语言政策保持纯英文。