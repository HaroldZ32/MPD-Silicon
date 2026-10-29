# RTL 能力差距评估 — my-power-dsh 面向数字逻辑（Verilog/SystemVerilog）开发

**中文** | [English](./rtl-gap-assessment.md)

评估当前 my-power-dsh bundle 在数字逻辑 RTL 开发方面还缺少什么，面向对 AI 辅助 HDL 工作
（硬件方向的 "vibe coding"，配合自动化验证）感兴趣的 IC 工程师。证据基础：(a) bundle 能力
盘点，(b) 覆盖开源（OS）与商业（CX）工具链的 36 项 RTL 工作流参考面（W-1..W-36），
(c) 含三种 AI 使用模式反馈闭环的差距框架。本文仅为评估，不涉及任何代码改动。

---

## 1. 执行摘要（TL;DR）

**结论：my-power-dsh 目前能*写出* RTL 文本，但无法*验证*它。最小可行的 AI-RTL 闭环 —
生成 → 检查 → 仿真 → 证据 → 改进 — 在第二步（lint/elaboration）就断了。** bundle 的语言
支持面中没有任何 Verilog/SystemVerilog 意识：

- **ast-grep MCP**：恰好 25 种语言，没有 Verilog/SystemVerilog。
- **LSP MCP**：42 个内置服务器，无 HDL 服务器（无 verible/svls/slang/hdl_checker），
  `lsp-setup` 也没有 HDL 路由；不过 Verilog/SV LSP **今天就可以**通过 LSP MCP 的项目/用户
  JSON 配置接缝（带 `command` + `extensions` 的 `lsp-client.json`）接入，无需任何插件改动。
- **codegraph MCP**：29 个 tree-sitter 语法，没有 Verilog 语法 — 无法索引 `.v`/`.sv`。
- **Skill 语料库**：19 个技能，无一针对 RTL；`programming` 只覆盖 `.py/.rs/.ts/.go`；
  `lsp-setup` 没有 HDL 路由。
- **Golden 夹具**：`tests/golden/fixtures/verilog/`（adder4.v、cnt8.v、tb_adder4.v）存在，
  但其 README 写明 "No simulator needed" — bundle 从未对自己的 Verilog 做过 lint、
  编译或仿真。

**确实存在且真正有用的**是一个通用的 agent 基座：bash（可调用用户的任意工具链）、文件工具、
teams/workflow 编排、ulw/boulder/memory 纪律、git-master + svn-master 技能、dsh-qa 证据纪律，
以及 grep.app 代码搜索（当前唯一的 RTL 代码发现渠道）。这些全部与语言无关。

修复成本低且符合 bundle 形态。P0 用 `skills/rtl-dev` 技能 + 两个 MCP 行包装器（lint/elaboration
门禁、带通过/失败证据的仿真+testbench 运行门禁）闭合阻断性闭环。P1 接入 Verilog/SV LSP、
波形/覆盖率回归证据和 cocotb 测试平台模式。P2 增加 EDA 流程脚手架与 UVM 验证助手技能。
双工具链立场：开源栈（iverilog/verilator/yosys/cocotb/verible）可通过 PATH/env 解析的包装器
完整纳入 bundle；商业 EDA（VCS/Xcelium/Questa、Verdi、SpyGlass、Design Compiler、PrimeTime）
仅停留在用户环境侧，受商业 EDA 授权现实约束（本仓库自身代码为 MIT，不再捆绑或暗示任何商业 EDA 工具）。

---

## 2. 当前状态（按层）—— 今天已有什么

判定：**PRESENT** = 有 bundle 证据、今天可用 · **PARTIAL** = 需手工配置或主机侧协助 ·
**ABSENT** = 完全没有 bundle 表面。证据来自能力盘点（文件路径见附录 A2）。

| 层 | bundle 当前能力 | 判定 | 证据（盘点） |
|---|---|---|---|
| **A — 编码辅助** | 模型生成 RTL 代码 | **PRESENT** | LLM 原生；DeepSeek 双轨模型；Verilog 是模型能力，非 bundle 特性 |
| A | 通用编写工具（bash、read/write/edit、glob/grep、hashline 锚定编辑） | **PRESENT** | `mpd` 预设主机工具；`mpd-hashline-plugin` |
| A | HDL 语法/lint 门禁（verible / verilator `--lint-only` / iverilog `-tnull`） | **ABSENT** | ast-grep 无 Verilog/SV 语言；无包装 MCP 行；golden 夹具从未做语法检查 |
| A | 自动格式化（verible-verilog-format） | **ABSENT** | 无格式化包装器；ast-grep rewrite 无法处理 `.v/.sv` |
| A | Verilog/SV 语言服务器（verible-verilog-ls、svls、slang、hdl_checker） | **ABSENT** | `mcp-lsp` 内置服务器列表无 HDL 服务器；`skills/lsp-setup/references/` 无 verilog/systemverilog 条目 |
| A | HDL 感知的结构化代码搜索/改写 | **ABSENT** | ast-grep 25 语言枚举止于 `yaml`；codegraph 无 `.v/.sv` 语法 |
| A | RTL 模板/样板知识（FIFO/FSM/ALU 模式、风格指南） | **ABSENT** | 随包技能语料中无 RTL 技能 |
| **B — 功能验证** | 带通过/失败证据的仿真 + testbench 运行门禁 | **ABSENT** | 无仿真器 MCP 行；bash 可调用用户工具链，但无结构化包装器、无 `.mpd` 证据采集 |
| B | lint/仿真反馈 → 提示改进通道 | **PARTIAL** | `mpd-memory`（git 支持、反射）可通用存储经验，但没有任何东西*产出* RTL lint/仿真失败信号 |
| B | 覆盖率采集（行/翻转/功能） | **ABSENT** | 无 verilator_coverage / urg 包装器；无任何东西读取 `.dat`/`.vdb` |
| B | 波形证据（VCD/FST 生产 + 分析） | **ABSENT** | 无仿真器标志包装器、无 VCD 解析；GTKWave 查看本身属主机层（非 bundle 范围） |
| B | 断言（SVA）— *编写* | **PARTIAL** | 模型能写 SVA 文本，但没有运行门禁检查过它们 |
| B | UVM / 约束随机 — *编写* | **PARTIAL** | 仅代码生成；无 `+UVM_TESTNAME` 运行、无报告解析 |
| B | Python 测试平台（cocotb）/ 单元测试（SVUnit） | **ABSENT** | 无 harness 包装器；`programming` 技能通用覆盖 Python，但无 cocotb 路由 |
| B | RTL 回归自动化 | **PARTIAL** | 通用 jobs/subagents/workflow 可编排，但没有 RTL 感知的 runner（文件列表、JUnit 映射、覆盖率合并） |
| B | 形式验证（SymbiYosys `sby`、equiv） | **ABSENT** | 无包装器；用户只能手动 shell 调用 |
| **C — 前端流程** | 综合（Yosys `.ys`、商业 `dc_shell`） | **ABSENT** | 无 Yosys MCP/技能；商业工具受授权限制（仅用户环境） |
| C | SDC 约束 + STA（OpenSTA、PrimeTime） | **ABSENT** | 无约束 lint 或时序报告工具 |
| C | CDC 验证（SpyGlass CDC 等） | **ABSENT** | 开源路线根本没有成熟的 CDC lint（参考面自身即缺口，不只是 bundle 缺口）；商业路线受授权限制 |
| C | 电源意图（UPF IEEE 1801） | **ABSENT** | 不存在开源 UPF 流程；仅商业 |
| C | DFT/ATPG | **ABSENT** | 无成熟开源工具；仅商业 |
| **D — 工程流程** | 编排基座（agent-teams、workflow、ulw/boulder、memory） | **PRESENT** | 采纳的 agent-teams 插件；`mpd-ulw` / `mpd-boulder` / `mpd-memory` 工具 |
| D | RTL 感知的流程门禁（lint/sim 作为完成标准） | **ABSENT** | ulw 标准是通用的；无 lint/sim 门禁可接入 |
| D | 流程脚手架（filelist/make、FuseSoC/Edalize、厂商 Tcl 包装器） | **ABSENT** | bash 能手工运行任何东西，但不随包提供脚手架知识或辅助 |
| D | VCS 集成（Git、SVN） | **PRESENT** | git-master + svn-master 技能（SVN 在 EDA 流程中仍常见） |
| D | 可复用于 RTL 的 QA 证据纪律 | **PARTIAL** | dsh-qa 技能严谨但 RTL 用例为零；无 RTL 证据域 |
| D | RTL 代码发现 | **PARTIAL** | grep.app 远程搜索可取回真实 Verilog/SV；context7 文档为通用；codegraph 无法索引 `.v/.sv` |

---

## 3. 差距矩阵（层 × 能力，含 OS + CX 参考，及其为何重要）

每行把一个能力映射到其开源参考（W-n）与商业参考，给出 bundle 判定，并说明它为何对
AI-RTL 反馈闭环重要。W-1..W-36 编号来自工作流参考面（附录 A1）。

| 层 / 能力 | OS 参考 | CX 参考 | bundle 判定 | 对 AI-RTL 闭环为何重要 |
|---|---|---|---|---|
| A1 语法 + lint 门禁 | W-1（verible-verilog-lint、svlint、verilator `--lint-only`） | W-2（SpyGlass Lint、Ascent Lint、HDL Checker） | **ABSENT** | 闭环第 2 步。没有带退出码、按行定位的 lint 通过，生成的 RTL 就被盲信接受 — "vibe coding" 零反馈。阻断性。 |
| A2 Elaboration/解析反馈 | W-6（slang `--ast-json`、Surelog/UHDM、sv2v） | —（内嵌于 CX IDE） | **ABSENT** | AST JSON 是机器可解析的信号，让 agent *理解*失败而非靠 grep 猜测。 |
| A3 语言服务器（诊断/导航） | W-4（verible-verilog-ls、svls、svlangserver、slang LSP） | W-5（无成熟的 CX 标准） | **ABSENT** | 基于 stdio 的 LSP 提供编辑器级的修复闭环反馈（诊断 → 定点编辑）。仅配置即可闭合。 |
| A4 自动格式化 | W-3（verible-verilog-format、svformat） | —（厂商提供风格检查器而非格式化器） | **ABSENT** | 确定性格式化让 diff 可审阅、幂等重跑稳定。 |
| A5 模板/风格知识 | W-7（片段、TerosHDL 模板；W-1 中的风格指南） | — | **ABSENT** | 技能层知识提升 FIFO/FSM/ALU 样板的首遍质量。 |
| B1 仿真运行门禁 | W-9（Verilator、Icarus） | W-10（VCS、Xcelium、Questa） | **ABSENT** | 闭环第 3 步。没有通过/失败采集意味着生成的 RTL 从未被执行。阻断性。 |
| B2 波形证据 | W-11/W-12（VCD/FST、GTKWave） | FSDB/VPD/WLF、Verdi/SimVision | **ABSENT**（主机查看非 bundle 范围） | VCD→文本/JSON 差异闭合闭环：agent 看到仿真*在哪里*分叉。 |
| B3 覆盖率证据 | W-13/W-15（verilator_coverage、covergroup） | W-14（VCS `urg`、IMC、vcover） | **ABSENT** | 覆盖率缺口反馈（"哪些状态从未被覆盖"）驱动 testbench 改进。 |
| B4 断言（SVA）执行 | W-16（Verilator `--assert`、SymbiYosys 形式验证） | 完整 SVA/PSL + 断言调试 | **PARTIAL**（仅编写） | 断言的价值取决于运行门禁是否检查它；今天它们是死文本。 |
| B5 UVM 执行 | W-17（uvm-core、uvm-verilator、pyuvm） | 完整 UVM + VIP | **PARTIAL**（仅编写） | 验证助手模式需要 `+UVM_TESTNAME` 运行 + 报告（HTML/XML）解析，不只是代码生成。 |
| B6 Python 测试平台（cocotb） | W-18（cocotb；最强的 OS 自动化面） | — | **ABSENT** | cocotb+pytest 是走向自动化、agent 友好的测试平台闭环最便宜的高价值路径。 |
| B7 回归自动化 | W-19/W-20（SVUnit、VUnit、rtl_buddy） | vManager、Questa verify | **PARTIAL** | 通用编排已有；缺的是 RTL 感知的 runner（测试列表 → 日志 → JUnit/覆盖率）。 |
| B8 形式验证 | W-21（SymbiYosys `sby`、yosys `equiv_*`） | W-22（JasperGold、VC Formal、Conformal/Formality） | **ABSENT** | `sby` 可端到端证明小型属性并输出反例 VCD — 后期放大器。 |
| C1 综合 | W-23（Yosys + ABC、slang 前端） | W-24（DC、Genus、Vivado/Quartus） | **ABSENT** | 闭合 RTL→网表链路；支撑 `equiv_*` LEC 与"能否综合"门禁。 |
| C2 SDC + STA | W-25/W-26（OpenSTA、OpenTimer） | PrimeTime、（DC/Genus STA） | **ABSENT** | 时序反馈（slack 报告）把综合运行变成可执行的修复。 |
| C3 CDC 验证 | —（无成熟开源 CDC lint；W-28） | W-28（SpyGlass CDC、Questa CDC、JasperGold CDC） | **ABSENT** | 跨时钟域缺陷是 SoC 工作中价值最高的 lint 类别；开源路线无法闭合 — 仅商业、用户环境侧。 |
| C4 电源意图（UPF） | —（无成熟开源流程；W-27） | W-27（DC/Genus 功耗感知、SpyGlass Power） | **ABSENT** | 同 CDC：开源生态的真实缺口；bundle 只能包装用户已授权的工具。 |
| C5 DFT/ATPG | —（W-29：无成熟开源 DFT） | W-29（DFT Compiler、Tessent、Modus） | **ABSENT** | 无法以开源方式闭合；从一开始就记录为仅用户环境。 |
| D1 流程自动化 | W-31（Make/CMake、Edalize、FuseSoC） | Tcl 脚本（dc_shell/xrun/vsim） | **ABSENT** | 文件列表/make 脚手架 + 工具调用是把单次仿真变成可重复流程的关键。 |
| D2 CI/回归门禁 | W-32（GH Actions/GitLab CI + 开源工具） | Jenkins + vManager/Questa verify | **PARTIAL** | dsh-qa 证明了证据纪律；只是还没有可门禁的 RTL 用例。 |
| D3 IP/设计库管理 | W-33（FuseSoC 目录、IP-XACT） | Methodics IPLM、Cliosoft SOS | **ABSENT** | 仅在多 IP SoC 规模才重要；P2+。 |
| D4 版本控制 | W-34（Git/LFS、SVN、预提交 lint） | SOS 桥接 | **PRESENT** | git-master + svn-master 技能覆盖两种常见 EDA VCS 后端。 |
| D5 全流程 agent 编排 | W-36（MCP 包装器、pyvcd/vcdvcd、pyverilog） | — | **PARTIAL** | 这正是 my-power-dsh 要消费的集成面；基座已有，RTL 门禁缺席。 |

---

## 4. 三个反馈闭环（AI 使用模式）

### 4.1 闭环 1 — AI 生成 RTL（codegen → lint → sim → coverage → improve）

针对 bundle 的分步状态：

| 闭环步骤 | 状态 | 缺失环节 |
|---|---|---|
| 1. 代码生成 | **PRESENT** | 模型原生；非 bundle 差距。 |
| 2. 语法/lint 门禁 | **ABSENT — 阻断** | 任何地方都没有 Verilog/SV 语法（ast-grep 25 语言；LSP 列表无 HDL 服务器；codegraph 29 语法无 verilog）。没有 verilator `--lint-only` / iverilog `-tnull` / verible 包装器。bundle 自己的 golden 夹具从未做语法检查 — README 承认 "No simulator needed"。 |
| 3. Elaboration/仿真门禁 | **ABSENT — 阻断** | 无仿真器 MCP 行、无 testbench 运行包装器、无通过/失败采集写入 `.mpd` 证据。 |
| 4. 覆盖率/波形证据 | **ABSENT**（非阻断：P0-4 建立通过/失败基线；完整覆盖率/波形回归证据在 P1-2 闭合） | 无 VCD/FST 生产标志、无覆盖率采集；`mpd-memory` 能存证据，但没有东西产出 RTL 证据。 |
| 5. 提示改进 | **PARTIAL** | `mpd-memory` + 反射通用地存储经验；缺的是把 lint/仿真失败文本回灌到下一轮生成的结构化通道（技能闭合此点：失败日志 → 笔记 → 重跑）。 |

具体后果：今天一个 AI 写的计数器或 FIFO 是被凭信仰接受的。对 IC 工程师而言，这不是
"辅助设计"，而是不安全的文本生成。

### 4.2 闭环 2 — 验证助手

今天 bundle 是**写手，不是助手**：它能以文本形式产出 testbench、SVA 断言和 UVM 脚手架
（参考 W-16/W-17），但既不能运行它们，也不能定位失败。有据可依的闭合步骤：

- **运行**：包装 iverilog/verilator（W-9）或 cocotb（W-18）— cocotb+pytest 是最强的开源
  自动化面，且能干净地映射到现有 `programming` 技能的 Python 纪律上。
- **度量**：verilator `--coverage-line/--coverage-toggle` + `verilator_coverage`（W-13），
  或对 UVM 用户而言 `+UVM_TESTNAME` + UVM 报告服务器 XML（W-17）解析。
- **定位**：VCD→JSON/文本转换（pyvcd/vcdvcd，W-36），让 agent 能对比 golden 与实测波形、
  定位失败周期，而不是重读原始 dump。

### 4.3 闭环 3 — 流程自动化

编排基座**存在且强**（agent-teams、workflow、subagents、ulw 计划/执行、boulder 台账、
memory + 反射）。缺的是 RTL 形态的**门禁内容**：lint/sim 通过作为 ulw 或 workmate 完成标准、
file-list/make 脚手架（W-31）、把测试列表映射到 JUnit/覆盖率的回归 runner（W-20/W-32）、
预提交格式化+lint 钩子（W-34）。主机 bash 今天能手工运行任何工具 — 差距在于*结构化门禁
与脚手架*，而非原始能力。

**双工具链说明（两种角度均已覆盖）**：开源栈（iverilog、verilator、yosys、cocotb、verible、
gtkwave、symbiyosys）完全可以包装为 PATH/env 解析的 MCP 行，二进制缺失时优雅降级 — 与
ast-grep 的约定完全一致。商业栈（VCS/Xcelium/Questa、Verdi、SpyGlass/JasperGold、DC/Genus、
PrimeTime、Tessent）受各自厂商授权限制：bundle 只能提供*从用户环境解析的通用命令
包装器*，绝不捆绑或内置工具。

---

## 5. 优先级路线图

按风险层级排序（t3 框架）：**P0** = 最小可行 AI-RTL 闭环的阻断项 · **P1** = 高价值，没有它
闭环仍可运行 · **P2** = 锦上添花。工作量：S / M / L。集成形态：**MCP 行**（围绕 CLI 的包装器，
PATH/`MPD_DSH_*` 解析）、**skill**（SKILL.md + references + golden 夹具 + dsh-qa 用例）、
**LSP 接线**（仅配置）、**plugin**（仅在必须强制执行有状态门禁时 — 最小差异原则）。

| P | 项目 | 工作量 | 形态 | 闭合对象 |
|---|---|---|---|---|
| P0-1 | `skills/rtl-dev`：固化闭环纪律（lint → sim → 证据 → 修复）、风格指南、FIFO/FSM/ALU 模式、复用现有 `tests/golden/fixtures/verilog/` 的 golden 夹具回归 | S | **skill**（+ dsh-qa 用例脚本） | 闭环 1 第 5 步；让 A5、B4/B5 的*编写*质量真正落地 |
| P0-2 | Verilog/SV 语法+lint 门禁：包装 verilator `--lint-only` / iverilog `-tnull` / verible-verilog-lint，带退出码 + 行级诊断 | S–M | **MCP 行**（模式 A） | 闭环 1 第 2 步（解除阻断） |
| P0-3 | 仿真 + testbench 运行门禁：iverilog/verilator 运行，通过/失败 + 日志采集写入 `.mpd` 证据 + memory | M | **MCP 行**（模式 A） | 闭环 1 第 3 步（解除阻断） |
| P0-4 | 把 P0-1..3 接入 golden 夹具，做成可执行的 dsh-qa RTL 用例（adder4.v/cnt8.v 的第一个真实门禁） | S | skill + dsh-qa 用例 | 闭环 1 第 4 步基线；D2 |
| P1-1 | Verilog/SV LSP 参考：向 `skills/lsp-setup/references/` 添加 verible-verilog-ls / svls / hdl_checker 条目 | S | **LSP 接线**（仅配置；daemon 通用） | A3 |
| P1-2 | 波形/覆盖率证据：VCD→JSON/文本回归差异 + 技能内 verilator 覆盖率采集 | M | skill + 小型 MCP 辅助 | 闭环 1 第 4 步；B2/B3 |
| P1-3 | cocotb harness 模式：`skills/rtl-dev` 内 Python TB 模板 + pytest 映射 | M | skill | 闭环 2 运行腿；B6 |
| P1-4 | codegraph `.v/.sv` 支持：验证语法覆盖并记录（或闭合） | S | 验证 + 文档（模式 D） | D5 横切 |
| P2-1 | EDA 流程脚手架：filelist/make、FuseSoC/Edalize 调用说明、从用户环境解析的厂商 Tcl 包装器示例 | M–L | skill（仅用户环境） | D1；C1/C2 入口 |
| P2-2 | UVM/SV 验证助手技能：UVM 测试模板、`+UVM_TESTNAME` 运行 + 报告解析、VIP 使用说明 | M | skill | 闭环 2 UVM 腿；B5/B7 |
| P2-3 | RTL workmate 模板：带 lint+sim 门禁纪律的人格，用于重复性 RTL 会话 | S | workmate init（roster 基底） | 闭环 3 重复执行 |
| P2-4 | SymbiYosys/Yosys 包装器：`sby` 属性检查 + yosys 综合/`equiv_*` | M | MCP 行 | B8；C1 腿 |
| P2-5 | 有状态门禁强制：lint+sim 必须先通过才允许 ulw/workmate 完成 | M | **plugin**（仅当 P0 包装器不够时 — 按最小差异原则的最后手段） | 闭环 3 硬门禁 |

头号建议：**先闭合 P0 链条 — `skills/rtl-dev`（P0-1）+ 两个 MCP 门禁行（P0-2/P0-3）+ 第一个
可执行的 golden 回归（P0-4）**。其后一切皆为放大器，而非前提。

---

## 6. 约束与合规

- **许可证（MIT）**：本仓库自身代码为 MIT（见 `LICENSE`）；商业 EDA 包装器的约束来自各厂商许可，
  不是本仓库的许可。后果：商业 EDA 包装器
  （VCS/DC/SpyGlass/PrimeTime…）只能是*用户环境命令包装器* — 绝不捆绑、绝不内置、bundle 不
  假设任何授权。
- **不内置二进制**：copyleft/开源工具链（iverilog GPL-2.0、verilator LGPL-3.0/Artistic-2.0、
  yosys ISC）与 EDA 工具在运行时从系统 PATH 或 `MPD_DSH_*` 风格环境变量解析，缺失时优雅降级 —
  沿用现有 ast-grep/codegraph 解析约定。这也使可安装 bundle 保持可重定位。
- **上游对等 / 不扩大范围**：能力基线锁定在上游 `8c57e46`（v5.0.0-beta.20）且不追新。本文
  推荐的 RTL 面是本评估明确目标所要求的*净新增*能力；不改变任何上游对等项目。
- **最小差异（原则 6）**：推荐变更默认为技能与 MCP 行包装器；新 `mpd-*` 插件仅批准用于
  P2-5（有状态门禁强制），且仅在包装器级门禁被证明不足时。
- **bundle 形态而非脚本形态**：每项推荐都采用 bundle 已理解的形式（技能经 mpd-bootstrap、
  MCP 行经 bundle patch、LSP 参考经 `lsp-setup`、workmate 经 `mpd_workmate_*`）。
- **双语文档政策**：本报告以 EN + 简体中文成对发布，标题下方带切换链接；agent 面向文本
  仅限英文。
- **明确非 bundle 范围**：商业 EDA 授权管理、仿真集群算力、桌面 GUI 波形查看器
  （GTKWave/Verdi）、专有 PDK/IP 访问。

---

## 7. 附录 — 证据链接

- **A1 — 工作流参考面（W-1..W-36）**：团队任务 t1 输出（Researcher）— 四层（A 编码辅助、
  B 功能验证、C 前端流程、D 工程流程），每项 OS+CX 并附引用来源（verible、svlint、slang、
  svls、verilator、iverilog、GTKWave、cocotb、VUnit、SymbiYosys、Yosys、OpenSTA、FuseSoC、
  Edalize；SpyGlass、VCS/Xcelium/Questa、Verdi、JasperGold、DC/Genus、PrimeTime、Tessent、
  Methodics/SOS）。
- **A2 — 能力盘点**：团队任务 t2 输出（Explorer）。关键文件证据：
  本 bundle 的 `packages/mpd-bundle/cordis.patch.yml`（MCP 行 mcp-astgrep/
mcp-lsp/mcp-codegraph、context7、
  grep_app、13 个 mpd 插件、采纳的 agent-teams）；ast-grep 语言列表
  （`skills/ast-grep/scripts/ast_grep_helper.py`，25 种语言，无 Verilog/SV）；
  `packages/mpd-mcp-lsp/dist/cli.js`（归 silicon 所有，已随本 bundle 交付）内置服务器列表
（42 个，无 HDL 服务器）；codegraph
  wasm 语法目录（29 个语法，无 verilog）；随包技能列表（19 个技能，无 RTL）；
  `tests/golden/fixtures/verilog/` + `docs/adder4.md` + `docs/cnt8.md`（"No simulator
  needed"）；`evidence/p5/` golden 批次（Verilog 已写出但从未编译/仿真/lint）。
- **A3 — 差距框架与闭环**：团队任务 t3 输出（Architect）— 维度 D1（闭环阶段）、D2（能力阶梯）、
  D3（证据契约）；BLOCKING/HIGHLY VALUABLE/NOT-bundle-relevant 分级；集成模式 A–E；第 5 节
  采用的优先级骨架。
- **团队输出**：t1/t2/t3 全文保存在团队状态中
  （`.mpd/team/rtl-gap-assessment/team.json` 任务输出），供评审者抽查。
