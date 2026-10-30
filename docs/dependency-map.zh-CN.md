# RTL 资产依赖映射

[English](./dependency-map.md) | **中文**

从源工程剥离出去的每一项 RTL 资产：原来在哪、现在在哪、依赖什么、怎么验证它真实存在。本文档是
"RTL 能力离开 MPD 仓库" 这次拆分的可审计记录，请与 [`sync-policy.md`](./sync-policy.md) 一起读——
后者规定两仓库之间的权威归属与变更规则。

> **2026-10-22 更新**：完整 `/opt/openictool` 实测（oss-cad-suite 20261021、Verible `v0.0-4296`、
> slang-server `0.3.1+`、LibreLane devshell 3.0.16、cocotb 2.1.0），适配基线为 DeepSeek Harness
> `0.2.1-rc.2` + `@mpd-dsh/mpd` `0.15.1`。本文件的每个状态、计数与命令都在该基线上重新实测；
> §5 可在干净检出中复现每个数字。较早实测保留的计数会就地标注其测量日期。
>
> **文档生成包**（§1 S5）与语料增长到 **36 个文件** 是同一基线上的后续改动；这两行各自标注其
> 测量日期与验证命令。
>
> **打包 + 一条命令安装**（§1 S6）也是同一基线上的后续改动；该行自带测量日期与验证命令。

## 阅读约定

- **本仓库** = silicon bundle 检出目录。所有"新仓库位置"均为相对本仓库根目录的路径。
- **`<SRC_ROOT>`** = 被剥离的源工程检出目录。解析方式：本仓库的兄弟目录 `../my-power-dsh`；两个
  检出目录不是兄弟关系时，用环境变量 `MPD_SOURCE_ROOT` 覆盖。
  本文件**故意不硬编码任何绝对路径**：任一检出目录移动后文档依然成立，也不会带上与机器绑定的家目录路径。
- **新仓库位置**的每条路径都用 `test -e` 核对过，"验证方式"列里的每条命令都**真跑过**。§3 台账记录
  命令、退出码与实测输出。
- **源工程侧路径均属历史位置。** RTL 面已被剥离提交 `12291a7`（父修订 `3d99718`）从源工程物理移除，这些路径
  在磁盘上**已不存在**；表中保留它们只为溯源，可用
  `git -C <SRC_ROOT> show 3d99718:<path>` 取回。源侧已移除的行会在行内注明；语料本身的守护者是随包
  提交的基线清单（`evidence/verification/corpus-baseline.json`），不再依赖源检出。
- **尚未落地**的资产一律标注 `pending` 并写明由哪个任务落地，绝不写成"已存在"。
- 形如 `t<n>` 的编号是本次迁移台账中的任务号；每条的证据记录在共享任务清单与落地该变更的提交信息中。

## 1. 资产映射表

每行 = 一类被剥离资产。

| # | 资产类别 | 源工程位置（`<SRC_ROOT>/…`） | 新仓库位置（本仓库） | 状态 | 依赖 / 耦合点 | 验证方式 |
|---|---|---|---|---|---|---|
| **A1** | `mpd-verif` 插件及其 **10** 个 `mpd_verif_*` 工具 | `packages/mpd-verif-plugin/` —— `src/`（13 个 `.ts`）、`test/`（16 个套件 + fixtures）、`README.md`、`README.zh-CN.md`、`package.json`、`evidence/smoke/smoke.mjs` —— **已由 t5 移除；用 `git show 3d99718:<path>` 取回** | `packages/mpd-verif-plugin/` —— 同名 `src/`、`test/`、两份 README，加 `package.json`（`@mpd-dsh/verif`）与构建产物 `dist/index.js` | 已落地 | **对 `@mpd-dsh/mpd` 0.15.1 的硬依赖**：`src/index.ts` 通过包说明符（`@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js`）导入 adapter，并声明 `inject: [...dshSeamInject(DSH_SEAM_TOOLS), "mpdDsh"]`，从 `ctx.mpdDsh` 读取活适配器。无回退、无本地副本；10 个工具都经该 adapter 的 `ctx.tools` 面注册。构建产物保持说明符为外部依赖（160,209 B；外部化前为 226,463 B） | `bun test packages`（220 个测试 / 21 个文件：219 pass / 1 skip；verif 169 / 16）；`grep -c '@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin' packages/mpd-verif-plugin/dist/index.js` 非零；10 个工具名在 `src/` 与 `dist/` 中一致 |
| **A2** | RTL skill 语料 —— 3 棵树、36 个文件 | `skills/rtl-ip-flow/`（10）、`skills/rtl-codestyle/`（6）、`skills/rtl-verif/`（20）—— **已由 t5 移除；用 `git show 3d99718:<path>` 取回** | `skills/rtl-ip-flow/`、`skills/rtl-codestyle/`、`skills/rtl-verif/` | 已落地 | 由 `silicon-bootstrap` 行通过 `ctx.skills` provider 提供服务（provider 名 `silicon-bundle`，rank 600）；语料运行时从 `<bundle-root>/skills` 读取，**不**复制进 `DSH_HOME`。每个 `SKILL.md` 的 frontmatter 必须落在 provider 的 YAML 子集内 | `node scripts/verify-corpus.mjs`（10 项检查通过、36 个文件、provider 恰好加载 3 个 skill；源交叉校验在源树消失后显示为可见的 SKIP） |
| **A3** | `rtl-ip` 团队 profile | `packages/mpd-bundle/cordis.patch.yml` —— 第 320 行的 `rtl-ip:` 块，内联在 `agent-teams` 行的 `config.profiles` 里 | **无 —— 已退役（RETIRED）**（本 bundle 没有 `presets/` 目录，也没有 `./presets/*` 导出） | **已退役（RETIRED）** —— 团队 profile 平面已由 mpd v0.10.0 移除，harness 侧没有任何替代 | mpd v0.10.0 删除了团队 profile 平面（旧 `agent-teams` 行上的 `config.profiles`），而 `@deepseek-ai/dsh-experimental-agent-team` `0.2.1-rc.2` 只暴露 `maxMembers` / `maxTasks` / `maxMessageBytes` / `disposalTimeoutMs` —— 已无 profile 槽位，因此不可能存在载体钩子，也没有 `MAX_TEAM_PROFILES` 预算。替代路径：mpd roster（`mpd_role_spawn` / `mpd_role_persona`）+ `teamModels.slot1..4` + workmate 库；`rtl-ip-flow` skill 仍作为领域流程保留 | `node scripts/verify-rows-disjoint.mjs`（exit 0：silicon 5 个 id、mpd 35 个 id 跨 2 层、零交集）；`test ! -d presets`（没有 profile 数据需要承载） |
| **A4** | HDL 语言服务（Verible / slang-server） | `packages/mpd-mcp-lsp/` —— `overlay/lsp/server-definitions.ts`、`overlay/lsp/language-mappings.ts`、`templates/rtl-lsp-client.json`、`dist/cli.js`、`dist/BUILD.lock`；以及 HDL 知识层 `skills/lsp-setup/references/verilog/README.md`、`skills/lsp-setup/references/systemverilog/README.md` | `packages/mpd-mcp-lsp/` —— `overlay/`、`templates/`、`dist/`，加 `references/verilog/README.md`、`references/systemverilog/README.md` | **已落地（t16）；行 `silicon-mcp-lsp` 已启用** | 离线构建把 overlay 应用到新拷贝的上游 `lsp-core`/`lsp-daemon` 之上，并在漂移时**大声失败**（锚点 `mpd-rtl-overlay-v1`）；两个 HDL 服务都在构建出的 `dist/cli.js` 内。本包现为 **HDL 的权威归属地**：`@mpd-dsh/mpd` v0.15.1 已把其同名包重定位为 cclsp 启动器，不再携带 HDL 注册表条目。源侧 `skills/lsp-setup/SKILL.md:46-47` 把 `.v/.vh` 与 `.sv/.svh` 路由到那两份 README（源侧任务 t17） | `node scripts/build-lsp.mjs --check`（exit 0：`dist/cli.js` 的 sha256 **与字节数**均与 `BUILD.lock` 一致、两个 HDL 注册条目在场、2 份参考文档 + 4 个 golden fixture 就位）；真实启动协商 MCP 协议 `2025-06-18` 并公布 8 个工具；真实 `mcp__silicon_lsp__status` 调用报告 44 个已配置服务器；2026-10-22 的 `/opt/openictool` 测试行使了两个真实 HDL 服务 —— Verible `.v/.vh`（干净文件 `No diagnostics found`，损坏文件 `error[verible]` 位于 3:2/4:0，`verible-verilog-lint` 退出 1）与 slang-server `.sv/.svh`（干净文件 `No diagnostics found`，损坏文件 `error` 位于 2:22/3:12 并附 `warning (unused-port)`）—— 因此 `status` 报告 44 个已配置 / **2 个已安装**，而 `slangServer.bin` 正是给启动器拼 `PATH` 的配置键 |
| **A5** | 波形读取 MCP 行（`wave-mcp` / `TraceWeave`）及其安装路径 | `packages/mpd-bundle/cordis.patch.yml:92-118`（注释态的 `mcp-wave-mcp` / `mcp-traceweave` 行）；安装脚本 `scripts/install-mcp.mjs`（`--with-wave`、`--activate-wave`、`pipx`） | `packages/mpd-bundle/cordis.patch.yml:89-114` —— 同样两行注释态、默认关闭的 `silicon-mcp-wave-mcp` / `silicon-mcp-traceweave` | 行**已落地（默认关闭）**；等价安装脚本**尚无、未指派** | 两行都包装**外部** Python MCP 服务，从 `MPD_DSH_WAVE_MCP_BIN` / `MPD_DSH_TRACEWEAVE_BIN` 解析（先环境变量、后 `PATH`）。保持注释态是因为 `mcp` SDK 缺失/版本不匹配会在启动时崩掉客户端。两个包对 SDK 的要求互斥（`wave-mcp` 需 `mcp>=2`，`TraceWeave` 需 `mcp==1.27.0`），必须装进**彼此隔离**的环境。未接入时 `mpd_verif_*` 的波形转交优雅降级 | `grep -n 'silicon-mcp-wave-mcp\|silicon-mcp-traceweave' packages/mpd-bundle/cordis.patch.yml` → 第 99 / 109 行；`packages/mpd-verif-plugin/evidence/smoke/smoke.mjs` 断言降级钩子 |
| **A6** | 6 份 RTL 文档 | `docs/rtl-gap-assessment.md`、`docs/rtl-gap-assessment.zh-CN.md`、`docs/rtl-ip-flow-guide.md`、`docs/rtl-ip-flow-guide.zh-CN.md`、`docs/rtl-verif-guide.md`、`docs/rtl-verif-guide.zh-CN.md` —— **已由 t5 移除；用 `git show 3d99718:<path>` 取回** | `docs/`（同名 6 个文件）+ `docs/rtl-docs-port-record.md`（溯源记录） | 已落地（另一任务） | `rtl-verif-guide.md` 是波形安装策略的文档落点；`packages/mpd-bundle/cordis.patch.yml` 中被注释的 `silicon-mcp-wave-mcp` / `silicon-mcp-traceweave` 行携带启用方法，因此指南与这些行已在拆分同一侧。溯源记录逐条列出所做修正与已落地的引用 | `ls docs/rtl-*.md`（6 份 + 记录文件）；`test -e docs/rtl-verif-guide.md` |
| **A7** | 覆盖 RTL 面的 QA 用例 | `skills/dsh-qa/SKILL.md`（用例行 59 `rtl-verif`、63 `rtl-ip-profile`）、`skills/dsh-qa/scripts/rtl-verif.mjs`、`skills/dsh-qa/scripts/rtl-ip-profile.mjs`、`skills/dsh-qa/scripts/dual-track-smoke.mjs` | 留在 mpd 仓库（`skills/dsh-qa/` 不属于本 bundle 的三棵 RTL 语料树），但两个 RTL 用例必须**改指向 silicon bundle** | **已落地（t19：两个用例已改指向 silicon bundle）** | 用例在隔离的临时 `DSH_HOME` 中启动真实 `dsh` CLI 并断言已挂载的行；`rtl-verif` 还会在 golden fixture 上驱动真实开源后端。**t19 已把两者改指向 silicon bundle**：仓库根 = 兄弟目录 `../my-power-dsh-silicon`（或 `MPD_SILICON_ROOT`），patch/语料断言改读 silicon 的 `packages/mpd-bundle/cordis.patch.yml`（5 个 additive row、零 id-target）与三棵 RTL 语料树；`rtl-ip-profile` 把 rtl-ip 载体报告为**已退役**（有证据的跳过）。HDL LSP 资产已随本 bundle 交付且该行已启用（A4）。真实用例在 silicon 或 `dsh` 缺席时打印 SKIP 原因并 exit 0 | `node <SRC_ROOT>/skills/dsh-qa/scripts/rtl-ip-profile.mjs --self-test`（exit 0）；`node <SRC_ROOT>/skills/dsh-qa/scripts/rtl-verif.mjs --self-test`（exit 0）——真实用例：`rtl-verif.mjs` → `ok=true`（该次运行组装 4 row，`silicon-docgen` 行尚未落地；lint+sim+regress），`rtl-ip-profile.mjs` → `skipped-rtl-ip-carrier`（exit 0） |

### 支撑资产（不是独立能力类别，但承载本映射）

| # | 资产 | 源工程位置（`<SRC_ROOT>/…`） | 新仓库位置（本仓库） | 状态 | 耦合点 | 验证方式 |
|---|---|---|---|---|---|---|
| S1 | `@mpd-dsh/mpd` —— 外部运行时依赖 | `@mpd-dsh/mpd` v0.15.1 的 `packages/mpd-dsh-adapter-plugin/`（adapter 与 `mpdDsh` 服务） | **无 —— 不在此复制。** 根 `package.json` 钉 `"@mpd-dsh/mpd": "0.15.1"`；`bun install` 提供它，仓库内 adapter 包已删除（移除 646,769 B） | **已外部化** —— 导入使用包说明符，绝不用相对路径 | adapter 是唯一允许直接触碰 harness 接缝的代码；本 bundle 消费它，且绝不自行注册 `mpdDsh`（单提供者服务，归 mpd 的 `mpd-dsh-adapter` 行所有）。消费方从 `ctx.mpdDsh` 读取且无回退；缺席即启动拒绝，而不是降级模式 | `grep -rn '@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin' packages/*/src packages/*/dist/index.js` → verif + bootstrap；`stat -c '%s' packages/{mpd-verif,mpd-silicon-bootstrap,mpd-silicon-guard}-plugin/dist/index.js`；`bun test packages`（220 / 21） |
| S2 | Golden Verilog fixture | `tests/golden/fixtures/verilog/modules/adder4.v`、`tests/golden/fixtures/verilog/modules/cnt8.v`、`tests/golden/fixtures/verilog/tb/tb_adder4.v`、`tests/golden/fixtures/verilog/README.md` | `tests/golden/fixtures/verilog/…`（同构） | **随 t16 落地**（提交 `da3693c`）—— 早先"待落地 / 未指派"的跟踪已关闭 | `skills/rtl-verif/fixtures/adder4/Makefile:25` 与 `skills/rtl-verif/fixtures/cnt8/Makefile:25`（以及 `skills/rtl-verif/templates/cocotb/Makefile:47`）写的是 `RTL_DIR ?= ../../../../tests/golden/fixtures/verilog/modules`，即解析到本仓库根；四个文件均在位 | `node scripts/build-lsp.mjs --check` 断言四个 fixture 路径（exit 0）；`find tests/golden/fixtures/verilog -type f` → 4 个文件 |
| S3 | 构建与门禁脚本 | `scripts/build-mcp.mjs`、`scripts/pack-mpd.mjs`、`scripts/install-profile.mjs`、`scripts/verify-rows-parity.mjs`；`VENDOR_LOCK.json`（`assets.skills`） | `scripts/build.mjs`（插件 dist）、`scripts/verify-corpus.mjs`（语料门禁）、`scripts/verify-rows-disjoint.mjs`（行 id 门禁）、`scripts/pack-silicon.mjs`（包集与模式门禁）、`evidence/verification/corpus-baseline.json`（语料保真基线） | 已落地 | 源工程 `VENDOR_LOCK.json` 已在**剥离提交里重钉**：`assets.skills` = `fileCount 331` / `treeSha 23e18d7c…e1597`，与 `git ls-tree -r HEAD -- skills` = 331 一致。`scripts/pack-mpd.mjs` 已把 `mpd-verif-plugin` 从 `PLUGIN_PKGS` 移除。本仓库侧语料基线已随包提交，故 `verify-corpus.mjs` 自持可跑、源交叉校验为可选 | `node scripts/build.mjs`；`node scripts/verify-corpus.mjs`；`node scripts/verify-rows-disjoint.mjs`；`node scripts/pack-silicon.mjs --check` |
| S4 | `silicon-require-mpd` 启动守卫 | 新增包（源工程无对应物） | `packages/mpd-silicon-guard-plugin/` —— `src/index.ts`、`test/`（2 个套件、11 个用例）、`dist/index.js`（1,420 B）、`README.md`、`README.zh-CN.md`、`package.json` | **已落地（0.4.0）** | inject-free；每 100 ms 轮询 `ctx.get("mpdDsh", true)`，最多 `timeoutMs`（默认 15 s），超时即 throw，使 CLI 以退出码 1 打印 `silicon requires @mpd-dsh/mpd: …`。它不导入 adapter，因此在任何组合里都会 apply | `bun test packages/mpd-silicon-guard-plugin`（11 个测试 / 2 个文件）；仅 silicon 启动 → 约 18 s 后退出码 1，两个消费行均 `pending (waiting for service: mpdDsh)` |
| S5 | `mpd-docgen` 文档生成包（规格阶段） | 新包（无源工程对应物）；产物格式移植自 eCap 的 `tools/reg2excel.py` + `tools/xlsx2docx.py`，代码未复制 | `packages/mpd-docgen-plugin/` —— `src/`（15 个 `.ts`）、`test/`（4 个套件 + 3 个 fixture）、`README.md`、`README.zh-CN.md`、`package.json`（`@mpd-dsh/docgen`） | **已落地；行 `silicon-docgen` 已启用** | **零第三方运行时依赖**：只有 `node:` 内建模块与 mpd adapter，硬依赖与 A1 相同（`mpdDsh`）。把三个规格阶段产物写进目标项目的 `docs/`（`<ip>_regExcel_full.xlsx`、`<ip>_reg_user_manual.zh-CN.docx`、`<ip>_reg_user_manual.en.docx`），且输出确定：固定 DOS 时间戳 1980-01-01、ZIP 条目排序、不读时钟、不用随机 id | `bun test packages/mpd-docgen-plugin`（106 个测试 / 4 个文件，0 失败）；`find packages/mpd-docgen-plugin/src -name '*.ts'` → 15；`grep -c '@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin' packages/mpd-docgen-plugin/src/index.ts` → 非零 |
| S6 | 包 manifest 与一条命令安装路径 | 新增（源工程无对应物；源工程有 `scripts/install-profile.mjs`） | 根 `package.json` —— `files`（四个插件 dist、`packages/mpd-bundle/cordis.patch.yml`、`packages/mpd-mcp-lsp/{package.json,launch.mjs,dist,references,templates}`、`skills`、`tests`、`docs`、两份 README、`LICENSE`、`LICENSE-NOTICES.md`、`CHANGELOG.md`，以及守卫脚本 `scripts/verify-package-files.mjs`）、`engines.node >= 22.18`、`license`、`repository`、`publishConfig.access: public`、`prepack` | **已落地（0.7.0，2026-10-23）** | `dsh.bundle.patch` 指向 `packages/mpd-bundle/cordis.patch.yml`，正是它让 `dsh plugin add` 能登记该 bundle；`tests/` 必须随包，因为 `rtl-verif` 的 Makefile 默认 `RTL_DIR ?= ../../../../tests/golden/fixtures/verilog/modules`（即 `<package>/tests`）；LSP 资产必须随包，因为 `silicon-mcp-lsp` 行按包内相对路径寻址它们（含 `package.json`，使 `resolveDaemonVersion()` 读到真实版本而不是回退到 `"0"`） | `node scripts/verify-package-files.mjs` → 退出码 0（PASS；完整输出与两个 self-test 退出码见证据目录）；`npm pack --dry-run --json` → 文件列表含 `tests/golden/fixtures/verilog/modules/adder4.v`、`packages/mpd-mcp-lsp/package.json` 与 LSP 资产路径，且无 `src`/`test`/`evidence` 条目；tarball 的文件数、字节大小与 sha256 记录在 `evidence/verification/plugin-install/20261023T022635Z/`；安装/启动与 add/remove 的实测见台账第 15–16 项 |

## 2. 映射资产之间的依赖边

- **A1 → S1（硬依赖）** —— verif 插件通过
  `@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js` 包说明符导入 adapter，在 `inject` 中
  声明 `mpdDsh`，并从 `ctx.mpdDsh` 读取。没有相对导入、没有本地移植、没有回退：该 bundle
  **不能**独立安装。
- **A2 → S1（硬依赖）** —— bootstrap 行经同一 adapter 解析 harness 的 `skills` 服务，读取
  `ctx.mpdDsh`，以引用方式提供语料。
- **S4 → S1（守卫）** —— `silicon-require-mpd` 不导入 adapter；它监视 `mpdDsh` 服务，把其缺席转成
  启动失败，使两个消费行保持 PENDING-safe，而不是提供空面。
- **S5 → S1（硬依赖）** —— docgen 插件经同一包说明符导入 adapter，并声明
  `inject: [...dshSeamInject(DSH_SEAM_TOOLS), "mpdDsh"]`。它读取项目里的两份手册，把三个规格阶段
  产物写进项目的 `docs/`；`rtl-ip-flow` Stage 2 / 规格评审门禁是让这些产物成为必选项的地方。
- **A3 → 已退役，无接缝** —— 团队 profile 平面已消失（mpd v0.10.0 移除；harness `0.2.1-rc.2` 的实验性
  agent-team 只暴露四个限额），因此不再有需要同步的跨仓库载体。替代路径是 mpd roster + `teamModels` +
  workmate 库；`rtl-ip-flow` skill 仍是流程本身。
- **A4 → 离线 LSP 构建 + skill 路由** —— overlay 只有应用在上游 `lsp-core` 源码之上才有意义；skill
  里的路由行指向现已随本仓库交付的两份 README，因此本包是 HDL 的权威归属地。
- **A5 → A1** —— 波形 MCP 接入时 `mpd_verif_*` 把波形转交给 `mcp-wave-mcp` / `mcp-traceweave`，
  未接入时优雅降级。
- **A7 → 以上全部** —— QA 用例是"行能挂载、工具能应答"的端到端证据，因此任何行 id 或 bundle 路径
  变化都必须同步改指向。

## 3. 验证台账

执行时间 2026-09-13，地点本仓库根目录；以下命令全部真跑过，结果原样摘录。2026-10-21 在 DeepSeek
Harness `0.2.1-rc.2` + `@mpd-dsh/mpd` `0.15.1` 上重新实测，2026-10-22 为 0.4.0 依赖 profile
（adapter 移植移除、mpd 外部化）再次实测，随后又做了一次完整 `/opt/openictool` 验证
（sim/regress/coverage、两个 HDL 服务、整套门禁）；数值有变化的行就地标注测量日期。打包与一条命令
安装于 2026-10-23 实测（第 15–16 项）。

| # | 命令 | 退出码 | 实测结果 |
|---|---|---|---|
| 1 | 对全部映射路径做 `test -e` 扫描（33 条源工程路径 + 19 条本仓库路径；docgen 源在本行写成之后加入），撰写本台账时执行 | 0 | **当时**每条路径都存在，仅显式标注 pending 的落点（`packages/mpd-mcp-lsp/`、`tests/golden/fixtures/verilog/`、6 份 `docs/rtl-*.md`）除外。33 条源工程路径此后已被**剥离提交 `12291a7` 移除**——现属历史位置（见"阅读约定"），可用 `git show 3d99718:<path>` 取回；19 条新仓库路径仍然存在 |
| 2 | `node scripts/verify-rows-disjoint.mjs` | 0 | 当时：`silicon: 4 row id(s) — insert 4, id-target 0`；`mpd: 23 row id(s) — insert 22, id-target 1`；`PASS: silicon ∩ mpd = ∅`。**2026-10-21**（门禁现已发现 manifest 声明的每一层 mpd patch）：`silicon total: 4 row id(s) — insert 4, id-target 0, across 1 layer(s)`；`mpd total: 35 row id(s) — insert 35, id-target 0, across 2 layer(s)`（根 `cordis.patch.yml` 34 + `presets/mpd.patch.yml` 1）；`PASS: silicon ∩ mpd = ∅`。**2026-10-22**（`silicon-docgen` 行落地）：`silicon total: 5 row id(s) — insert 5, id-target 0, across 1 layer(s)`；`mpd total: 35 row id(s) — insert 35, id-target 0, across 2 layer(s)`；`PASS: silicon ∩ mpd = ∅` |
| 3 | `node scripts/verify-corpus.mjs` | 0 | `PASS — 10 check(s) passed, 0 skipped`；35 个文件；`provider "silicon-bundle" loads all 3 skills`。**2026-10-22**：语料现为 **36 个文件** —— 新增 `templates/user-manual.en.md`（rtl-ip-flow 9 → 10），门禁下限为 `MIN_FILES = 36`；该门禁运行由语料泳道负责 |
| 4 | `node -e "import('./packages/mpd-verif-plugin/dist/index.js').then(m=>console.log('plugin ok', m.name))"` | 0 | `plugin ok mpd-verif` |
| 5 | `bun test packages` | 0 | 当时：`106 pass / 0 fail / 742 expect() calls / Ran 106 tests across 11 files`。t20 修复后：`130 pass / 1 个可见 skip / 0 fail / 845 expect() calls / Ran 131 tests across 12 files`。**2026-10-21**（adapter 按 mpd v0.15.1 重新移植）：`282 pass / 1 skip / 0 fail / 1620 expect() calls / Ran 283 tests across 23 files` —— 其中 adapter 套件 174 个。**2026-10-22**（adapter 移植移除、mpd 外部化；在完整 `/opt/openictool` 修复后重测）：`Ran 220 tests across 21 files` —— 219 pass / 1 skip / 0 fail；verif 169 / 16、bootstrap 30 / 2、guard 11 / 2、LSP 10 / 1。**2026-10-22**（V11 zh/en 偏移+位宽修复；新增 3 个回归测试）：`Ran 326 tests across 25 files` —— 325 pass / 1 skip / 0 fail；docgen 106 / 4、verif 169 / 16、bootstrap 30 / 2、guard 11 / 2、LSP 10 / 1 |
| 6 | `grep -oh '"mpd_verif_[a-z_]*"' packages/mpd-verif-plugin/src/*.ts \| sort -u` | 0 | **10** 个工具名：`backends, compile, coverage, librelane, lint, regress, sim, toolchain, uvm, venv`；`dist/index.js` 给出完全相同的清单 |
| 7 | `grep -o 'verible-verilog-ls\|slang-server' <SRC_ROOT>/packages/mpd-mcp-lsp/dist/cli.js \| sort \| uniq -c` | 0 | `1 verible-verilog-ls`、`4 slang-server` —— 随包 LSP dist 确实带两个 HDL 服务 |
| 8 | `grep -n 'silicon-mcp-wave-mcp\|silicon-mcp-traceweave' packages/mpd-bundle/cordis.patch.yml` | 0 | 第 99、109 行，均为注释态（有意默认关闭） |
| 9 | `node <SRC_ROOT>/skills/dsh-qa/scripts/rtl-ip-profile.mjs --self-test` | 当时 0，剥离后 1，**t19 改指向后再次 0** | 当时：`ok: profile + 7 members + swimlane/flow markers + skill + 8 templates + bilingual guide verified`。剥离后按设计失败（`FAIL: rtl-ip profile missing in bundle patch`），源 `test:qa` 标为 known-stale 跳过。t19 改指向 silicon 后：`ok: silicon preset (7 members + taskPlanning + STAGE 0/IP01/STAGE 4) + 4 additive rows / id-target-free patch + skill + 8 templates + bilingual guide`，`test:qa` 已恢复实跑。**2026-10-21**：团队 profile 平面移除后，该用例把 rtl-ip 载体报告为**已退役**（有证据的跳过），而非待落地 |
| 10 | `node <SRC_ROOT>/skills/dsh-qa/scripts/rtl-verif.mjs --self-test` | 当时 0，剥离后 1，**t19 改指向后再次 0** | 当时：`ok: bundle wiring (mpd-verif active + wave rows commented) + golden fixture + eight-tool dist surface + iron-rule strings + devPatch operand guard`。剥离后按设计失败（`FAIL: cordis.patch.yml must ship exactly one ACTIVE mpd-verif row`），源 `test:qa` 已跳过。t19 改指向 silicon 后：`ok: golden fixture + silicon patch (4 additive rows, no id-target, no absolute path) + eight-tool dist surface + iron-rule strings + three corpus trees + preset profile`，HDL LSP 注册表组在 t16 前记为跳过。**2026-10-21**：它过去跳过的 HDL LSP 资产现已随本 bundle 交付，`silicon-mcp-lsp` 行已启用（A4）。**0.3.0**：dist 工具面现为**十个**工具 —— 上面的探测字符串是当时的八工具记录；新增的是 `mpd_verif_toolchain` 与 `mpd_verif_librelane` |
| 11 | `grep -rn '@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin' packages/*/src packages/*/dist/index.js` | 0 | **2026-10-22**：verif（`src/index.ts`、`src/env.ts`、`src/silicon/*`、`dist/index.js`）与 bootstrap（`src/index.ts`、`dist/index.js`）—— 依赖经包说明符导入，已无相对 adapter 导入 |
| 12 | `stat -c '%s' packages/{mpd-verif,mpd-silicon-bootstrap,mpd-silicon-guard}-plugin/dist/index.js` | 0 | **2026-10-22**：`160209`、`11734`、`1420` —— 提交的 JS dist 合计 **173,363 B**，低于此前的 384,819 B（−54.9 %）；仅被删除的 adapter dist 就有 77,563 B。打包产物 700,120 B，低于此前的 919,281 B（−23.8 %）；被移除的仓库内 adapter 包占 646,769 B |
| 13 | 真实启动（dsh `0.2.1-rc.2`，隔离 `DSH_HOME`） | 124 / 124 / 1 | **2026-10-22**：共存 repo profile 存活到 50 s（退出码 124），日志 `[mpd-silicon-bootstrap] skill corpus served`；打包产物存活到 45 s（退出码 124）；仅 silicon profile 在 18 s 后以退出码 1 打印守卫信息，两个消费行均 `pending (waiting for service: mpdDsh)` |
| 14 | 真实 `/opt/openictool` 端到端测试 | 0 | **2026-10-22**：完整开源通道 —— 配置 `set`/`show`（含 `slangServer.bin`）→ `show`/`backends`（iverilog 14.0、verilator 5.053、`verilator_coverage`；`source: "config"`）、两者各自的 compile + lint、两个后端 `sim` PASS（1 个用例）、`regress` 1/1 PASS、覆盖率合并（4 个文件 → `merged.dat` 4,260 B）与 `--annotate-all` 报告、UVM 预期 `VERIF_E_NO_BACKEND`（无 VCS）、LibreLane devshell `status`/`run`（mode devshell、extract true、3.0.16、5429 ms、stderr 为空），以及两个 HDL 服务（Verible `.v/.vh` 干净 / 损坏 3:2/4:0；slang-server `.sv/.svh` 干净 / 损坏 2:22/3:12 并附 `warning (unused-port)`）。证据：`evidence/verification/openictool/20261022T145500Z/` |
| 15 | `dsh plugin --profile <p> add -w @mpd-dsh/mpd@0.15.1 <tarball>`（隔离 `DSH_HOME`；pnpm 9.15.9、dsh `0.2.1-rc.2`） | 0 | **2026-10-23**：两个 bundle 均装上并自动登记 —— profile 的 `dependencies` = `@mpd-dsh/mpd` + `@mpd-dsh/silicon`，`dsh.profile.bundles` = `… @mpd-dsh/mpd, @mpd-dsh/silicon`；启动退出码 **124**（超时被杀）并打印 `[mpd-silicon-bootstrap] skill corpus served`。只装 silicon 的 profile 安装成功（退出码 0），但启动以退出码 **1** 打印 `silicon requires @mpd-dsh/mpd: the mpdDsh service is absent`。证据：`evidence/verification/plugin-install/20261023T022635Z/` |
| 16 | `dsh plugin --profile rmtest add -w file:<fake-bundle>`，再 `dsh plugin --profile rmtest remove <name>`；另测不带 `-w` 的同一条 `add`（隔离 `DSH_HOME`、临时 `HOME`、pnpm 9.15.9） | 0 / 0；不带 `-w` 时非 0 | **2026-10-23**：把 reconcile 步骤与 silicon 自身行为隔离的对照。`add` → `dsh.profile.bundles` = `["fake-bundle"]`，未手改 manifest；`remove`（不带 `-w`）→ 依赖与 bundle 条目同时消失（`bundles` = `[]`），即 reconcile 并非只在 add 时发生；不带 `-w` 的 `add` 以非 0 退出并报 `ERR_PNPM_ADDING_TO_ROOT`。记录在 `evidence/verification/plugin-install/20261023T022635Z/` |

第 4–6、9、10 项需要真实工具链（Bun、Node、Verilator fixture）；第 1–3、7、8、11 项离线即可复跑；
第 12–13 项分别需要已构建的 dist 与真实 `dsh` 二进制；第 14 项需要真实的 `/opt/openictool` 安装；
第 15–16 项需要 `PATH` 上的 pnpm 9.15.9 与隔离 `DSH_HOME`。

## 4. 未落地项

| 项目 | 阻塞于 | 当前已成立的事实 | 尚缺什么 |
|---|---|---|---|
| A5 安装脚本对等性 | 尚未指派任务 | 两行已在本仓库存在（注释态），启用步骤内联在 patch 注释里 | 源工程安装脚本（`scripts/install-mcp.mjs --with-wave/--activate-wave`）在本仓库没有对应物 |
| A7 QA 改指向 | **已关闭 —— t19 已把两个用例改指向 silicon bundle** | 两个用例在隔离的临时 `DSH_HOME` 中启动真实 `dsh` CLI 并断言已挂载的行：`rtl-verif` 断言 silicon 的 patch（4 个 additive row、零 id-target）与三棵语料树；`rtl-ip-profile` 把 rtl-ip 载体报告为**已退役**（有证据的跳过，而非待落地）；真实用例在 silicon 或 `dsh` 缺席时打印 SKIP 原因并 exit 0 | 改指向本身无遗留；HDL LSP 注册表组不再跳过，因为 A4 已落地 |
| **源侧门禁冲突（F4）** | **已解决**——采用选项 (1)，在剥离提交内执行；后续 owner **t19** | 剥离提交 `12291a7` 重钉了 `VENDOR_LOCK.assets.skills`（`331` / `23e18d7c…e1597`），并在 `test:qa` 内把两个 RTL QA 用例标为 known-stale。源工程实测：`node scripts/verify-vendor.mjs` → exit 0、`node scripts/verify-rows-parity.mjs` → exit 0、`bun run test:qa` → exit 0（`2 RTL cases skipped: known-stale until t19`） | 剥离提交本身无遗留；剩余工作是把两个用例改指向 silicon bundle，由 **t19** 承担（跳过信息与 `.silicon-extraction/removal.log` 均有记录） |

两项已随 t16（提交 `da3693c`）离开本表：HDL 语言服务（**A4**）与四个 golden Verilog fixture
（**S2**）均已在树内，§1 记录其已落地状态。

## 5. 如何复核本映射

```bash
# 0) 解析源工程检出目录（无需绝对路径）
SRC_ROOT="${MPD_SOURCE_ROOT:-$(cd .. && pwd)/my-power-dsh}"   # 在本仓库根目录执行

# 1) §1 中每条**新仓库**路径都必须存在（源工程侧路径按设计已属历史位置）
for p in packages/mpd-verif-plugin/src packages/mpd-docgen-plugin/src \
         skills/rtl-ip-flow skills/rtl-codestyle skills/rtl-verif \
         packages/mpd-mcp-lsp/dist/cli.js packages/mpd-bundle/cordis.patch.yml \
         tests/golden/fixtures/verilog/modules/adder4.v; do test -e "$p" || echo "MISSING $p"; done

# 2) 离线门禁：类型、语料、行 id、LSP 资产、文件模式、包内容
node scripts/typecheck.mjs --require      # 只有 `bun install` 之后才真正生效，否则大声跳过
node scripts/verify-corpus.mjs
node scripts/verify-rows-disjoint.mjs     # 发现 manifest 声明的每一层 mpd patch
node scripts/build-lsp.mjs --check
node scripts/pack-silicon.mjs --check
node scripts/verify-package-files.mjs     # prepack 守卫：白名单、必需文件、patch 行

# 3) 移植后的插件仍可加载、整套测试仍通过
bun test packages
node -e "import('./packages/mpd-verif-plugin/dist/index.js').then(m=>console.log('plugin ok',m.name))"
```

一旦上面任何**新仓库**路径无法解析，说明本映射已过期：请在搬动该资产的同一次变更里更新本文件。
源工程侧路径此后本就不该再解析——那是剥离的结果，不是过期（见"阅读约定"）。谁有权搬动什么，见
[`sync-policy.md`](./sync-policy.md)。
