# <IP名称> 验证计划

> 验证计划模板 —— [Verification Engineer] 产出：**在规格设计 IP01 阶段随规格评审一并交付**
> （验证内容前置：用苏格拉底式验证提问向规格设计确认每个功能点/接口信号/寄存器位域/边界异常/
> 可测性/覆盖目标，并把结论回写内部用户手册与本计划）。
> 事实依据：用户手册（功能轨）与详细设计手册（覆盖轨）；两者冲突时以用户手册为准并上报。

| 项目 | 内容 |
| --- | --- |
| IP 名称 |  |
| 版本 | v0.1 |
| 日期 |  |
| 验证后端 | open-source (cocotb + verilator coverage) / VCS (UVM + urg / fsdbreport) / 自动适配（按 mpd_verif_backends 探测） |
| 功能轨依据 | 《用户手册》全部功能点 |
| 覆盖轨依据 | 《详细设计手册》关键电路/状态机/流水线 |

## 1. 验证目标与指标

- 功能轨：用户手册每条功能点至少 1 个正向用例（+边界/异常）；软件配置流程的每个场景 1 个用例。
- 覆盖轨：行覆盖 + 状态机状态/转换覆盖 + 条件覆盖（vcs 线+cond+tgl；verilator 代码覆盖合并报告），目标值（如行覆盖 ≥ 95%，FSM 全覆盖）与超限处理。
- 双轨口径：功能轨判定通过 = 仿真结果符合预期；覆盖轨判定通过 = 覆盖率指标达成；双轨均通过才进入收尾。

## 2. 验证环境

- DUT 顶层、TB 语言/框架（cocotb / UVM VCS）、时钟/复位模型、接口驱动（总线/自定义时序）、
  参考模型（若用）与统计量（scoreboard）说明。
- 环境搭建步骤：**cocotb lane** 需要项目本地 venv（`mpd_verif_venv` VENV-first
  铁律，仅此一处强制）；**UVM/VCS lane 与其余后端、MCP 工具都不需要 venv**。
  其余按工具流：Makefile 流；UVM 目录契约。

## 3. 用例列表（映射用户手册）

| 用例 ID | 用户手册章节/功能点 | 描述（激励/检查点） | 类型（功能/边界/异常/一致性） |
| --- | --- | --- | --- |

### 3.x 软件配置场景用例（每个配置场景独立小节）

场景描述、寄存器配置序列、期望行为、对应检查点。

## 4. 覆盖率计划（映射详细设计）

| 覆盖项 | 来源（设计手册章节） | 指标 | 用例覆盖 |
| --- | --- | --- | --- |

- 激励补充：为 FSM 转换/条件分支编写的定向激励（描述，不写代码）。
- 随机与定向比例（开源环境随机+定向；VCS weight 说明）。

## 5. 执行与报告

- 命令与先后顺序：cocotb lane 先 `mpd_verif_venv create/status`（venv 仅 cocotb 需要）→
  `mpd_verif_backends` → `mpd_verif_compile/lint` → `mpd_verif_sim`（功能轨）→
  `mpd_verif_regress`（回归）→ `mpd_verif_coverage merge/report`（覆盖轨）；
  VCS lane 走 `mpd_verif_uvm compile/run/regress/merge-cov`（无需 venv）。
- 产物路径：仿真日志、波形（fst/vcd/fsdb）、coverage 报告（`<work>/.mpd/verif/...` 或工程约定目录）。
- 回归标准：全部用例 PASS + 覆盖率达标；失败处理（修 DUT/TB 后回归；文档-代码不一致走回退流程）。

## 6. 交付清单

验证代码（TB + Makefile/UVM 工程）、验证计划（本文档）、回归结果摘要、覆盖率报告、已知限制与遗留项。
