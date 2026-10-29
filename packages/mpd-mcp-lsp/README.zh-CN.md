# mpd-mcp-lsp —— HDL 语言服务（silicon 所有）

[English](./README.md) | **中文**

RTL 剥离后（任务 t16）由 `@mpd-dsh/silicon` bundle 持有的**语言服务 HDL 半边**。通用语言服务
—— 守护进程与其约 42 个内置服务器定义 —— 留在上游 / `@mpd-dsh/mpd`；只有 RTL 面需要的部分
随迁到这里。本产物现为 **HDL 的权威归属地**：`@mpd-dsh/mpd` v0.15.1 已把自己的同名包重定位为
cclsp 启动器，不再携带 HDL 注册表条目。

## 随包内容

| 路径 | 说明 |
| --- | --- |
| `overlay/lsp/server-definitions.ts` | 上游注册表的完整补丁副本，带两个 HDL 服务器（`verible` → `verible-verilog-ls`，`.v/.vh`；`slang-server` → `.sv/.svh`）。构建期源码，含漂移守卫锚点 `mpd-rtl-overlay-v1` |
| `overlay/lsp/language-mappings.ts` | 对应的 `EXT_TO_LANG` 叠加（`.v` → `verilog`，`.sv` → `systemverilog`） |
| `templates/rtl-lsp-client.json` | 当两个可执行文件不在 `PATH` 上时，供**用户级** LSP 配置使用的现成模板（项目级配置会忽略非内置 id） |
| `references/verilog/README.md`、`references/systemverilog/README.md` | Verible 与 slang-server 的安装/验证指南 —— 即 `lsp-setup` 技能的 HDL 页面，移到 RTL 知识所属的仓库 |
| `dist/cli.js` + `dist/BUILD.lock` | 行所启动的 MCP 服务端二进制，附来源与 sha256。**不在本仓库重建**：`BUILD.lock` 记录的是从 `@mpd-dsh/mpd` 逐字节复制的产物 —— sha256 `04b49f8c…e0a973a9`、235 271 字节 |
| `launch.mjs` | 行的入口：读取两层 silicon 工具链配置，把已配置的 oss-cad-suite / Verible / slang-server bin 目录前插到 `PATH`，再以 `stdio: "inherit"` 启动已固定的 `dist/cli.js`。手写文件，提交在 `dist/` **旁边**（绝不放进 `dist/`），产物因此与 `BUILD.lock` 保持逐字节一致 |

overlay 是构建期源码，**不随打包产物发布**；`dist/`、`references/` 与 `templates/` 会随包。

## Bundle 行

```yaml
- id: silicon-mcp-lsp
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: silicon_lsp          # 进程内唯一 —— mpd 自己的行占用 `lsp`
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-lsp/launch.mjs,
           <bundle>/packages/mpd-mcp-lsp/dist/cli.js, mcp]
    toolCallTimeoutMs: 60000
```

该行**已启用** —— t16 落地资产并打开了它。资产缺席期间它曾声明为 `disabled: true`：stdio 命令无法
解析的 `dsh-mcp-client` 行**不会**优雅降级，而是反复重试 `Cannot find module`，启动永远到不了 app。
**启用判定必须来自真实 app boot**，绝不能凭配置 dump 里存在该行下结论。在 harness `0.2.1-rc.2` 上
挂载该行实测：服务端协商 MCP 协议 `2025-06-18`、公布 **8 个工具**，真实
`mcp__silicon_lsp__status` 调用返回已配置服务器列表（44 个）。2026-10-22 的 `/opt/openictool`
主机两个 HDL 服务都已安装：同一探测报告 44 个已配置服务器、**2 个已安装** —— Verible
`v0.0-4296`（`.v/.vh`）与 slang-server `0.3.1+`（`.sv/.svh`）。Verible：干净加法器返回
`No diagnostics found`，损坏文件返回 `error[verible]`（3:2 / 4:0），`verible-verilog-lint` 以 1
退出。slang-server：干净文件返回 `No diagnostics found`，损坏文件返回 `error`（2:22 / 3:12）并附
`warning (unused-port)`。陈旧的 daemon 租约可能让启动延迟
（`DaemonStartupDeferredError: owner_pid_live_unreachable`）—— 清理 `~/.mpd/lsp-daemon` 与
`/tmp/mpd-lsp-*`。证据：`evidence/verification/openictool/20261022T145500Z/`（仓库相对路径）。

## 启动器与工具链配置

行的 args 为 `[launch.mjs, dist/cli.js, mcp]`。`launch.mjs` 是普通 Node 脚本，没有构建步骤；每次启动它会：

1. 读取与 verif 工具相同的两份 JSONC 层 —— user `$MPD_SILICON_CONFIG`，否则 `${DSH_HOME:-~/.dsh}/silicon.jsonc`，以及 project `<cwd>/.mpd/silicon.jsonc` —— 深合并时 project 覆盖 user；
2. 把**存在的** oss-cad-suite、Verible 与 slang-server bin 目录前插到 `PATH`（oss-cad-suite 在前，Verible 其次，slang-server 第三，继承的 `PATH` 最后；不存在的目录跳过）；
3. 用该环境与 `stdio: "inherit"` 启动 `dist/cli.js`，转发 `SIGINT`/`SIGTERM` 与子进程退出码。

`slangServer.bin` 是 SystemVerilog 服务端（`.sv/.svh`）的配置键。只设置 `verible.bin` 的主机得到 `.v/.vh` 诊断；除非 slang-server 已在继承的 `PATH` 上，否则没有 `.sv/.svh`。

配置文件缺失是正常的。格式错误或不可读时在 stderr 打印**一条**警告并保持 `PATH` 不变。启动器绝不写 stdout —— 那条流属于 MCP JSON-RPC。

**cwd 注意事项。** project 层从 **dsh 进程 cwd** 解析，因此只有当该 cwd **就是**工作区时，`<workspace>/.mpd/silicon.jsonc` 才能到达启动器。从别处启动的 dsh 进程（常见的 GUI 场景）读不到它 —— **user 级文件才是可靠的层**。注意 `mpd_verif_toolchain` 每次调用都解析工作区，所以 `show`/`path` 可能报告出本启动器并不读取的 project 层。

已固定的产物保持不动：`launch.mjs` 位于 `dist/` 旁边，`build-lsp.mjs --check` 仍按 `BUILD.lock`（sha256 + 大小）校验 `dist/cli.js`。`launch.mjs` 自身没有构建期状态 —— 直接编辑即可。

## 验证（离线，不需要上游）

```bash
node scripts/build-lsp.mjs --check       # 默认：校验已交付产物
node scripts/build-lsp.mjs --self-test   # 注册表控制组 + 实时校验
```

`--check` 断言：`dist/cli.js` 与 `BUILD.lock` 的 sha256 **与字节数**一致；二进制内含两个 HDL
注册条目（命令、扩展名、`EXT_TO_LANG` 映射）；overlay 存在且带锚点；两份参考文档存在且非空
（这是 t17 删除操作的前置条件）；四个 golden fixture 就位。

## 构建（需要上游检出）

```bash
node scripts/build-lsp.mjs --build --upstream <含 packages/lsp-daemon 的检出>
```

它把上游守护进程源码复制进临时工作区，将本包的 overlay 应用到 `lsp-core`，锚点缺失时**立即
失败**（上游漂移绝不能产出静默错误的 dist），执行 `bun build`，检查新产物是否含两个 HDL 条目，
并刷新 `BUILD.lock`。

**状态**：该路径已实现，但**在本仓库环境中未被行使**（此处没有上游检出）。随包发布的
`dist/cli.js` 是记录在案的复制产物，由 `--check` 校验。

## 关于两份参考文档

两份 HDL 参考页是 `lsp-setup` 技能页面的**逐字节副本**，因此里面的技能相对调用行原样保留：

```bash
bun ../../scripts/verify-lsp.ts path/to/file.v
```

该路径相对于 **mpd** 的 skills 树（`<mpd>/skills/lsp-setup/scripts/verify-lsp.ts`）。在本仓库请用
解析后的等价写法：

```bash
bun "${MPD_SOURCE_ROOT:-../my-power-dsh}/skills/lsp-setup/scripts/verify-lsp.ts" path/to/file.v
```

## 范围

本包**不是**一棵 skill 树：`skills/` 始终恰好是三棵 RTL 语料（`verify-corpus.mjs` 会断言），
HDL 知识文档放在这里的 `references/` 下。
