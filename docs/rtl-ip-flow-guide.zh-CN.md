# RTL IP 设计流程指南

[English](./rtl-ip-flow-guide.md)

> **⚠️ `rtl-ip` 团队 profile 在 DeepSeek Harness `0.2.1-rc.2` 上已退役（RETIRED）。** mpd v0.10.0
> 移除了团队 profile 平面（旧 agent-teams 行上的 `config.profiles`），而
> `@deepseek-ai/dsh-experimental-agent-team` `0.2.1-rc.2` 只暴露 `maxMembers` / `maxTasks` /
> `maxMessageBytes` / `disposalTimeoutMs`。**不存在 `--profile rtl-ip`**，本仓库也没有 profile 数据
> 文件或载体。
>
> **替代路径：** 直接按 **`rtl-ip-flow` skill** 走这套流程（不组建团队，你自己扮演各泳道）；若装了
> `@mpd-dsh/mpd`，则用**官方 Agent Teams 工具 + mpd roster**（`mpd_role_spawn` / `mpd_role_persona`）
> 组建团队，用 `teamModels.slot1..4` 路由四个成员模型，本 skill 仍作为领域流程。
> 归属声明见 [`sync-policy.md`](./sync-policy.md) §1。

`rtl-ip-flow` skill 承载一套四阶段、带门禁的 RTL IP 设计流程。本文说明如何启动它以及每一步的产出。

## 流程图（四泳道 × 里程碑门禁）

对齐四泳道产品流程（产品市场 / 系统设计 / 数字设计 / 数字验证），里程碑编号
规格设计 IP01 → 代码设计 IP05 → 设计验证 IP08 → IP 发布 IP10。

| 里程碑 | 数字设计泳道 | 数字验证泳道 | 评审门禁（暂停） |
| --- | --- | --- | --- |
| 需求阶段（无编号） | 需求制定（用户）+ 需求分析（需求分析师）：需求说明书/应用场景/可行性报告/需求追踪表 | — | 🔶 需求评审（用户+评审） |
| 规格设计 IP01 | 内部用户手册 + DFMEA 初版（规格设计师） | 验证计划 + 验证方案（验证工程师） | 🔶 规格评审 + 🔶 验证评审 |
| 代码设计 IP05 | RTL 代码 + 详细设计（代码工程师，所选语言线） | 环境开发 → 用例开发 → 验证调试（验证报告 + 验证手册） | 🔶 设计评审 + 🔶 验证评审 |
| 设计验证 IP08 | 缺陷解决（修缺陷） | 回归验证（双轨：功能+覆盖） | — |
| IP 发布 IP10 | 设计发布（内部/外部用户手册）+ 缺陷分析（缺陷报告 + Buglist） | — | 🔶 发布评审 + 🔶 缺陷评审 |

所有菱形都先过 **Reviewer 评审（红绿一致）**；颜色只决定额外的步骤：🔴 **GATE** = Reviewer 结论先行，
再**暂停等用户**（需求评审 / 规格评审 / 发布评审 / 缺陷评审）；🟢 = 仅 Reviewer 评审，不暂停用户
（设计评审 / 验证评审）。
验证工程师在**规格设计 IP01 前置验证内容**：对规格设计做苏格拉底式验证提问（每个功能点、
接口信号、寄存器位域、边界/异常、可测性、覆盖目标都要明确），并把结论**回写**规格设计文档。

规格阶段还通过 `mpd_docgen_*` 工具产出寄存器 Excel（`<ip>_regExcel_full.xlsx`）与中英双语
Word 用户手册；详见 [`docgen-guide.zh-CN.md`](./docgen-guide.zh-CN.md)。

## 启动流程

已没有 `--profile rtl-ip` 开关。二选一：

```
# A) 只用 skill（不组建团队）—— 加载 rtl-ip-flow skill 并描述这个 IP
rtl-ip-flow: <用你手头已有的任意材料描述这个 IP：一句话、文档、规格片段…>

# B) 已装 @mpd-dsh/mpd —— 官方 Agent Teams + mpd roster
spawn_teammate(name:"<泳道角色>")      # 每个泳道一个成员，persona 取自 mpd_role_persona
mpd_role_spawn(role:"<角色>")          # 单次 roster 咨询（Architect / Reviewer …）
# .mpd/mpd.jsonc 中的 teamModels.slot1..4 路由四个成员的模型
```

本次运行的负责人（lead）会先向你提两个前置问题（一次问齐）：

1. **HDL 语言** — Verilog/SV（代码工程师执行 `rtl-codestyle` 风格契约）或 SpinalHDL/Chisel
   （代码工程师遵循你项目的 Scala 约定）。
2. **验证后端** — 开源链（cocotb + verilator 覆盖率）、VCS（UVM + urg/FSDB）
   或自动适配（探测可用通道）。

两个答案对整个流程生效；中途更换只能重开流程。

## 门禁与回退规则

- **所有菱形都先过 Reviewer 评审**（红绿一致）——结论清晰后才算完成。
- **🔴 GATE 菱形额外暂停等你**——需求评审 / 规格评审 / 发布评审 / 缺陷评审：
  Reviewer 结论先行，然后团队暂停等待你的确认。修订循环只改文档，不动代码。
- **🟢 菱形仅 Reviewer 评审**——设计评审 / 验证评审：Reviewer / Plan Reviewer 自动检查
  （代码+详细设计+验证调试结果 / 验证计划与手册一致性），不暂停用户。
- **一致性规则**：详细设计手册与代码相对**内部用户手册**不得有任何非必要差异。
  发现实质差异时，团队会暂存第 3 步文件、重跑规格阶段修正用户手册、确认后回来重做第 3 步
  ——绝不绕过差异打补丁。

## 双轨验证

- **轨道 1 —— 功能验证**（依据用户手册）：手册中每个功能点与每个软件配置场景都有用例，全部通过。
- **轨道 2 —— 覆盖率验证**（依据详细设计手册）：验证计划中的行/状态机/条件覆盖指标被收集并报告
  （开源链 verilator 覆盖合并/报告，VCS 链 `urg` + fsdbreport）。

## 模板包

九份文档模板随 `rtl-ip-flow` 技能交付：

- `templates/req-spec.md` —— 需求规格包（需求说明书/应用场景/可行性报告/需求追踪表）
- `templates/user-manual.md` —— 内部/外部用户手册（产品手册级详细度）
- `templates/user-manual.en.md` —— 用户手册英文版（章节顺序一致，寄存器章为 `## Registers`）
- `templates/dfmea.md` —— DFMEA 初版
- `templates/detail-design.md` —— 详细设计（与代码一一对应）
- `templates/verification-plan.md` —— 验证计划 + 验证方案
- `templates/validation-report.md` —— 验证报告（双轨结果）
- `templates/validation-manual.md` —— 验证手册（复跑指南）
- `templates/defect-report.md` —— 缺陷报告 + Buglist

## 说明

- 面向人的交付物为中文；agent 日志与提交保持英文。
- 流程复用现有 `rtl-codestyle`（Verilog 风格契约）、`rtl-verif`（cocotb/UVM 脚手架）技能与 `mpd_verif_*` 工具。
- 已确认的内部用户手册是唯一事实来源；决策变更 = 重跑规格阶段，然后重做代码阶段。
