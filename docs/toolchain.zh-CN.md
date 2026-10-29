# 工具链配置

[English](./toolchain.md)

## 为什么需要它

工具链路径是**机器相关**的：一台机器把 oss-cad-suite 装在 `/opt`，另一台装在 `~/.local`，第三台只有 Verible 压缩包和 LibreLane AppImage。把这些路径写死进 skill、patch 或 Makefile，除了写它的那台机器以外，在任何地方都是错的。因此本 bundle 从一份小型 **JSONC 配置** 读取外部工具，并用两个工具暴露它：`mpd_verif_toolchain`（查看与编辑配置）和 `mpd_verif_librelane`（解析并运行 LibreLane）。

不捆绑任何东西。配置记录工具**在哪里**，从不复制工具本身；验证工具、LSP 启动器与 LibreLane 运行器读取的是同两份文件。

## 两份文件

| 层 | 路径 | 作用 |
| --- | --- | --- |
| user | 设置了 `$MPD_SILICON_CONFIG` 时用它，否则 `${DSH_HOME:-~/.dsh}/silicon.jsonc` | 机器级层；可靠的那一层 |
| project | `<workspace>/.mpd/silicon.jsonc` | 按仓库覆盖；**深合并**在 user 层之上 |

- `DSH_HOME` 未设置时回退到 `~/.dsh`；`MPD_SILICON_CONFIG` 会整体替换 user 文件路径（会被解析，前导 `~` 会展开）。
- project 层在**每次调用时**按会话工作区解析，因此一个 dsh 进程可以服务多个不同项目的工作区。
- 文件**缺失**是正常状态 —— 该层不贡献任何值。文件**格式错误**会被*报告*，绝不崩溃：`show` 展示解析错误，`set`/`unset` 拒绝，LSP 启动器打印一条警告并保留继承的 `PATH`。

示例（路径取自 `/opt/openictool` 实测主机；允许注释与尾随逗号）：

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

在该主机上这四个键写在 **project** 作用域（`<workspace>/.mpd/silicon.jsonc`），通过 `set` 写入；原注释保留，被删掉的叶子留下空行（仅影响观感）。project 作用域只对 LSP 启动器有一个注意事项：它从 dsh 进程 cwd 解析 project 层，从别处启动的进程读不到 —— 请用 `scope: "user"` 设置 `verible.bin` 与 `slangServer.bin`（见 LSP 启动器下的 cwd 说明）。

### 优先级

1. **project 覆盖 user**，逐键深合并；project 层里的标量或数组会整体替换 user 值。`show` 会报告每个已知键最终来自哪一层。
2. **运行期环境变量仍然优先**（针对验证后端）：先查 `MPD_DSH_VERIF_IVERILOG`、`MPD_DSH_VERIF_VERILATOR`、`MPD_DSH_VERIF_VERILATOR_COVERAGE`，再查配置，`PATH` 是最后一档。
3. LibreLane 在配置之后还有自己的环境变量回退：`MPD_SILICON_LIBRELANE`（binary）与 `MPD_SILICON_LIBRELANE_APPIMAGE`（AppImage）。

因此，一次 shell export 总能覆盖某个进程的文件值；而文件才是持久化的那一份。

## Schema

| 键 | 类型 | 含义 |
| --- | --- | --- |
| `ossCadSuite.home` | string（路径） | oss-cad-suite 安装根；`bin/` 自动推断 |
| `ossCadSuite.bin` | string（路径） | bin 目录，**或**单个可执行文件 |
| `verible.home` | string（路径） | Verible 安装根 |
| `verible.bin` | string（路径） | bin 目录，**或**单个可执行文件 |
| `slangServer.bin` | string（路径） | slang-server 的 bin 目录，**或**单个可执行文件；只供 HDL LSP 启动器拼 `PATH`（不是验证后端） |
| `librelane.appimage` | string（路径） | LibreLane AppImage |
| `librelane.mode` | `"auto"` \| `"appimage"` \| `"devshell"` \| `"binary"` | 执行层级；默认 `auto` |
| `librelane.appimageExtract` | boolean | 解包 AppImage 而非挂载；未设置 = auto（见下文） |
| `librelane.bin` | string（路径） | `librelane` 可执行文件，**或** bin 目录 |
| `librelane.home` | string（路径） | LibreLane 安装根 |

拼写沿用 `@mpd-dsh/mpd`：`.bin` 是**可执行文件或 bin 目录**，`.home` 是**安装根**。路径会做 `~` 展开；user 作用域的值必须是绝对路径，workspace 作用域的相对值按工作区根解析。

未知键会被保留（手写的段落绝不会被毁掉）；已知键类型错误会作为 invalid key 报告，而不是被静默使用。

## 对话式流程

这个工具的意义在于：用户用自己的话说明工具装在哪里，agent 把它持久化。以下是 agent 实际发起的调用：

| 用户说 | agent 调用 | 发生什么 |
| --- | --- | --- |
| “oss-cad-suite 在哪？” | `mpd_verif_toolchain {"action":"detect"}` | 探测环境变量、`PATH` 与常见根目录；只返回建议，不写任何东西 |
| “我把 oss-cad-suite 装在 `/opt/oss-cad-suite`” | `mpd_verif_toolchain {"action":"set","key":"ossCadSuite.home","value":"/opt/oss-cad-suite"}` | 校验键、写入单个叶子节点，返回旧值/新值与文件 |
| “用这个 Verible” | `mpd_verif_toolchain {"action":"set","key":"verible.bin","value":"/opt/verible/bin"}` | 同上，作用于 HDL 语言服务端 |
| “帮我建配置文件” | `mpd_verif_toolchain {"action":"init","scope":"workspace"}` | 写入带注释的模板；文件已存在时拒绝，除非 `force: true` |
| “为什么找不到 verilator？” | 先 `mpd_verif_toolchain {"action":"show"}`，再 `mpd_verif_backends` | `show` 列出已解析的二进制及其来源；后端探测确认运行期答案 |
| “用 `~/librelane-devshell.AppImage` 这个 devshell AppImage” | 先 `set librelane.appimage`，再 `mpd_verif_librelane {"action":"status"}` | status 报告 `mode: "devshell"`（basename 含 `devshell`）与精确命令 |
| “在 `config.yaml` 上跑 LibreLane” | `mpd_verif_librelane {"action":"run","args":["config.yaml"]}` | 在工作区内执行，日志写到 `.mpd/librelane/` |

正常请求下 agent **不会**手动编辑文件：`set` 就是那把手术刀。手改只用于写注释、批量修改，或修复编辑器拒绝处理的文件。

## 六个 action

`mpd_verif_toolchain` 接受 `action`（默认 `show`）、`key`、`value`、`scope`（`"user"` \| `"workspace"`）与 `force`。

### `show` —— 有效视图

```json
{ "action": "show", "key": "ossCadSuite.bin" }
```

报告两份文件路径及其 `exists`/`parseError`、合并后的配置、**逐键来源层**、已解析的二进制（`iverilog`、`verilator`、`verilator_coverage`）及其存在性/可执行位/版本、已配置路径及其类型，以及所有解析错误、未知键、无效键。带 `key` 时聚焦单个叶子及其生效层。`show` 永不写入。

### `set` —— 一个叶子，一次手术式编辑

```json
{ "action": "set", "key": "librelane.mode", "value": "devshell" }
{ "action": "set", "key": "ossCadSuite.bin", "value": "../oss-cad-suite/bin", "scope": "workspace" }
```

只写一个值，其余每个字节都保留 —— 注释、键顺序、空白、引号、尾随逗号、行尾 —— 做法是定位该值的字符区间并只拼接这一段。目标层是显式 `scope`，否则是**已经定义该键的那一层**，再否则是 user 层。写入是原子的：`mkdir -p`、同目录临时文件、`rename`、模式 `0644`。文档有歧义或格式错误时，**逐字节原样**拒绝。

编辑引擎移植自 `@mpd-dsh/mpd` 的 `mpd-config-plugin`（上游为 SUL-1.0；移植到本仓库的代码为 MIT）—— 见 `LICENSE-NOTICES.md`。

### `unset` —— 删除一个叶子

```json
{ "action": "unset", "key": "verible.bin" }
```

从定义该键的层（或显式 scope）删除，其他字节不动。返回旧值以及文件是否变化。

### `init` —— 带注释的模板

```json
{ "action": "init", "scope": "user", "force": false }
```

写入带注释的模板，包含两份路径、四个工具组（oss-cad-suite、Verible、slang-server、LibreLane），每组一个示例。**文件已存在时拒绝**，除非 `force: true`；不存在静默覆盖。

### `path` —— 解析出的位置

```json
{ "action": "path" }
```

返回 `dshHome`、`workspaceRoot`，以及两份文件及其存在性。用户问“到底用的是哪份文件”时调用它。

### `detect` —— 只给建议，永不写入

```json
{ "action": "detect" }
```

扫描相关环境变量（`MPD_SILICON_CONFIG`、`OSS_CAD_SUITE*`、`VERIBLE_*`、`LIBRELANE_*`、`MPD_DSH_VERIF_*`）、`PATH` 命中、常见安装根（`/opt/oss-cad-suite`、`~/oss-cad-suite`、`/opt/verible`、`~/verible`、`~/librelane`、`~/.local/bin`）、home 下的 AppImage，以及 `~/.local/lib/python*/site-packages/librelane`。每个命中以 `{key, value, evidence}` 建议返回；采纳是另一次 `set`。

## 后端解析

验证工具按以下顺序解析 `iverilog`、`verilator` 与 `verilator_coverage`：

1. `MPD_DSH_VERIF_<BACKEND>`（**仍然优先** —— 显式的单 shell 覆盖），
2. 配置：`ossCadSuite.bin`，或 `ossCadSuite.home` + `/bin`，
3. `PATH`。

`mpd_verif_backends` 会把实际使用的档位报告为 `source: "env" | "config" | "path"`。VCS 与 `urg` 不受这份配置影响：它们仍通过 `VCS_HOME`/`VERDI_HOME`/`NOVAS_HOME` 与 `PATH` 解析，因为其布局受许可约束、由站点管理。`slangServer.bin` **不**参与这套解析：它只把目录交给 HDL LSP 启动器拼 `PATH`（见下文）。

## LibreLane

`mpd_verif_librelane` 是 RTL-to-GDS 流程驱动通道。

```json
{ "action": "status" }
{ "action": "run", "args": ["config.yaml"], "cwd": "designs/foo", "timeoutMs": 600000 }
```

### 解析与模式

`librelane.mode`（默认 `auto`）选择档位，然后是环境变量，最后是 `PATH`：

| 模式 | 解析 | 运行 |
| --- | --- | --- |
| `binary` | `librelane.bin`（文件，或目录 → `<dir>/librelane`），否则 `librelane.home` → `<home>/librelane`、`<home>/bin/librelane`、`<home>/.venv/bin/librelane`；环境变量 `MPD_SILICON_LIBRELANE`；`PATH` | 直接执行 argv，无 shell |
| `appimage` | `librelane.appimage`；环境变量 `MPD_SILICON_LIBRELANE_APPIMAGE` | `[appimage, ...args]` —— **无 shell** |
| `devshell` | 该 AppImage | `[appimage, "librelane", ...args]` —— argv 直接交给包装器，其真实接口是 `devshell [--pure] <cmd> [...]`；无 shell、无引号转义 |
| `auto` | 设置了 `librelane.appimage` 时用它，basename 含 `devshell` 则为 devshell；否则走 binary 档 | 按选中的档位 |

`status` 报告解析后的 `mode`、`configuredMode`、`path`、`source`（`config`/`env`/`path`）、`reason`、`exists`、`executable`、AppImage 解包决策、命令及预览、解析出的版本，以及 hints。找不到 LibreLane 时是结构化拒绝（`VERIF_E_NO_BACKEND`），不是空 status。

0.4.0 发布的 devshell 形状 `[appimage, "--run", "librelane <posix-quoted args>"]` 是错的：包装器没有 `--run` 参数，实测真实 3.0.16 AppImage 时会以 **127** 退出（`exec: --run: not found`）。运行器现在传 `[appimage, "librelane", ...args]`，`status` 探测 `[appimage, "librelane", "--version"]`。

### AppImage 解包与 `/dev/fuse`

`librelane.appimageExtract` **未设置**时，解包为 `auto`：当 `/dev/fuse` 不可读+可写时（容器，或无 FUSE 的主机）**自动开启**，子进程获得 `APPIMAGE_EXTRACT_AND_RUN=1` —— 标准的 AppImage 运行时开关。显式 `true` 强制解包，显式 `false` 强制挂载。`status` 同时报告决策与原因（`extractReason`），这是解释“AppImage 挂不上”的最快路径。

### `run` 语义

- `args` 在任何模式下都按 argv **原样**传入。devshell 模式会在前面补上命令：
  `[appimage, "librelane", ...args]` —— 包装器的真实接口是 `devshell [--pure] <cmd> [...]`，
  它直接 exec 自己的 argv，因此没有 shell、也没有引号转义。
- `cwd` 默认工作区根，且**限定在工作区内**；越界即拒绝。相对路径按工作区解析。
- `timeoutMs` 默认 **3600000**（1 小时）。
- 日志**总是**写到 `<workspace>/.mpd/librelane/<UTC>-<slug>.log`，只记录命令、cwd 与环境**覆盖项** —— 绝不记录完整环境。
- 结果携带 `exitCode`、`duration`、`logPath`、`stdoutTail` 与 `stderrTail`。

限制：超时只杀**直接子进程**（流程再派生的孙进程不会被回收），cwd 守卫是**词法**的（不会解析符号链接逃出工作区），且完整的 RTL-to-GDS 流程尚未在此运行 —— 见「实测边界」。

## HDL 语言服务（LSP）启动器

`silicon-mcp-lsp` 行启动的是一个手写启动器，不是构建产物：

```
args: [<bundle>/packages/mpd-mcp-lsp/launch.mjs, <bundle>/packages/mpd-mcp-lsp/dist/cli.js, mcp]
```

- `launch.mjs` 读取**同样的两层**（project 覆盖 user），把存在的 oss-cad-suite、Verible 与 slang-server bin 目录前插到 `PATH`（ossCadSuite 在前，verible 其次，slangServer 第三，再是继承的 `PATH`；不存在的目录跳过），随后以 `stdio: "inherit"` 启动已固定的 `dist/cli.js`。
- `slangServer.bin` 是 SystemVerilog 服务端（`.sv/.svh`）的配置键。没有它时启动器不会为 slang-server 添加任何目录，只依赖继承的 `PATH`。
- 已固定的 `dist/cli.js` 与 `BUILD.lock` **保持不动**：启动器放在 `dist/` 旁边，受校验的产物因此逐字节不变，`build-lsp.mjs --check` 仍然守它。
- 配置文件缺失是正常的。格式错误或不可读时在 stderr 打印**一条**警告并保持 `PATH` 不变。启动器绝不写 stdout —— 那条流属于 MCP JSON-RPC。

**cwd 注意事项。** 启动器从 **dsh 进程 cwd** 解析 project 层，因此只有当 dsh 进程**在工作区内**启动时，`<workspace>/.mpd/silicon.jsonc` 才能到达它。常见的 GUI 场景从别处启动 dsh，读不到该层。对 LSP 这条路径，**user 级文件才是可靠的层**：请用 `scope: "user"` 设置 `verible.bin` 与 `slangServer.bin`（工具链工具本身每次调用都会解析工作区，所以 `show`/`path` 可能合理地报告出启动器并不读取的 project 层）。

## 安全与权限

- **“对 harness home 零写入”的唯一记录在案的例外。** 插件状态留在 `<workspace>/.mpd/`。工作区之外唯一的写入是显式的 `mpd_verif_toolchain` **user 作用域** `set`/`unset`/`init`：那是*用户的*配置，不是插件状态；只在显式 action 下写入 —— 绝不在启动时，绝不隐式。
- **原子且手术式。** 每次写入都是 `mkdir -p` + 同目录临时文件 + `rename` + `chmod 0644`，且只改一个值的区间。歧义或格式错误即拒绝，逐字节原样。
- **无密钥。** 文件只保存路径与枚举。绝不要把 token、许可证密钥或凭据放进去；VCS 许可留在启动 shell（`VCS_HOME`/`VERDI_HOME`/`NOVAS_HOME`）。
- **不执行配置内容。** 值是路径、一个枚举和一个布尔；文件里没有任何内容会被当作命令求值。
- **命令执行。** `mpd_verif_librelane run` 用调用方的 argv 执行*解析出的工具*，cwd 限定在工作区内，且从不经过 shell：binary 模式直接运行二进制，普通 AppImage 模式运行 `[appimage, ...args]`，devshell 模式运行 `[appimage, "librelane", ...args]`（包装器 exec 其 argv）。日志只记录命令、cwd 与环境覆盖项。

## 故障排查

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `show` 报告解析错误 / `set` 拒绝 | 文件不是合法 JSONC（或根不是对象） | 手工修复；`set`/`unset` 拒绝覆盖损坏文档。`init` 配 `force: true` 重写模板 |
| `status` 报告的模式不是预期 | `librelane.mode` 设置，或 `auto` 选中了 AppImage / `devshell` basename | `set librelane.mode` 指定目标档位，或 `unset librelane.mode` 回到 `auto`；`status` 会回显 `reason` |
| 解析出的二进制缺失 / 不可执行 | 配置值不对，或工具被移动 | `show` 打印 `exists`/`executable`，`status` 打印 hints；`detect` 给出候选值；`set` 正确值 |
| project 层没被读取 | 仅限 LSP 启动器：dsh 进程 cwd 不是工作区 | 用 `scope: "user"` 写该键，或在启动 dsh 前先进入工作区 |
| AppImage 挂载失败 | 无 FUSE，或 `/dev/fuse` 不可访问 | 保持 `appimageExtract` 未设置（auto → 解包，`APPIMAGE_EXTRACT_AND_RUN=1`）或设为 `true` |

## 实测边界

2026-10-22 针对真实 `/opt/openictool` 安装实测（证据：`evidence/verification/openictool/20261022T145500Z/`）：

- **完整开源通道。** 配置 `set`/`show`（含 `slangServer.bin`）→ `show`/`backends` 以 `source: "config"` 从 project 配置解析出 iverilog 14.0、verilator 5.053 与 `verilator_coverage`；两个后端的 `compile` 与 `lint` 都通过，两个编译产物直接运行均退出 0。
- **`sim` 与 `regress` 已实测。** project venv 内是 cocotb 2.1.0；`mpd_verif_sim` 在 iverilog 与 verilator 上均 **PASS（1 个用例）**；`mpd_verif_regress` 在两个后端上均 **1/1 PASS**。cocotb 的 `SIM` 变量是 `icarus`（不是 `iverilog`），make 的 `PATH` 顺序是 `venv/bin` → 解析出的工具目录 → 继承的 `PATH`。oss-cad-suite 的 `vvp` 包装器会重新注入 `PYTHONHOME`，因此 iverilog 通道把 `ICARUS_BIN_DIR` 指向一个 shim，用 `env -u PYTHONHOME` 运行自带的 loader。
- **覆盖率合并与报告。** 4 个 `.dat` 合并为 `merged.dat`（4,260 B）；报告命令是 `[verilator_coverage, "--annotate", <dir>, "--annotate-all", <merged.dat>]`。`--all` 在 verilator_coverage 5.053 中非法，正确参数是 `--annotate-all`。`collectDatFiles` 排除 `<top>__verFiles.dat` —— 那是构建元数据，不是覆盖率。
- **LibreLane devshell AppImage 3.0.16。** `status` → `mode: "devshell"`、版本 `3.0.16`、`extract: true`（auto：`/dev/fuse` 不可访问 → `APPIMAGE_EXTRACT_AND_RUN=1`），命令 `[appimage, "librelane", "--version"]`。`run` 以 **5429 ms** 退出 0，stderr 为空，日志写在 `.mpd/librelane/` 下。
- **devshell 的接口是 `devshell [--pure] <cmd> [...]`。** 0.4.0 发布的 `--run` 形状以 127 退出（`exec: --run: not found`）；修复后的 argv 是 `[appimage, "librelane", ...args]`。
- **两个 HDL 服务都已安装。** `status` → 44 个已配置 server、**2 个已安装**：Verible `v0.0-4296`（`.v/.vh`）与 slang-server `0.3.1+`（`.sv/.svh`）。干净的 `.v` 与干净的 `.sv` 都返回 `No diagnostics found`；损坏的 `.v` 返回 `error[verible]`（3:2 / 4:0，`verible-verilog-lint` 以 1 退出）；损坏的 `.sv` 返回 `error`（2:22 / 3:12）并附 `warning (unused-port)`。启动器的 `PATH` 顺序是 ossCadSuite → verible → slangServer → 继承的 `PATH`。
- 测试套件：**21 个文件共 220 个测试 —— 219 pass / 1 个 skip / 0 个 fail**（其中 `mpd-verif-plugin` 贡献 169 个，bootstrap 30 个，guard 11 个，LSP 启动器 10 个）。唯一的 skip 是对缺席源 checkout 的语料交叉检查。
- Row：4 个 silicon row id ∩ 35 个 mpd row id = ∅。

此处**未实测** —— 作为限制列出而不是隐藏：

- **没有 FUSE**：AppImage 走解包（`APPIMAGE_EXTRACT_AND_RUN=1`），而不是挂载。
- **没有 VCS 许可。** `mpd_verif_uvm` 返回预期的 `VERIF_E_NO_BACKEND`，VCS 覆盖率通道未运行；yosys 0.70、gtkwave 与 slang 12.0.0 编译器存在，但本 bundle 未使用。
- **超时只杀直接子进程**，且 **cwd 守卫是词法的**（不解析符号链接）。
- **没有 PDK，也没有完整的 LibreLane RTL-to-GDS 流程**；已实测的 LibreLane 调用只有上面的版本探测与 `--version` 运行。
