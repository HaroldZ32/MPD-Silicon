# <IP名称> 验证手册

> 验证手册模板 —— [Verification Engineer] 在验证调试阶段交付（图中"验证调试 2. 验证手册"）。
> 读者是复跑/评审验证环境的人：照着它能搭环境、跑用例、查结果。

| 项目 | 内容 |
| --- | --- |
| IP 名称 |  |
| 版本 | v0.1 |
| 日期 |  |
| 环境根目录 | （验证工程位置） |

## 1. 环境结构与组成

- 目录树（DUT/TB/脚本/用例/回归工作区）。
- 依赖与约束（venv 仅 cocotb lane：`.venv-rtl`；后端二进制；VCS license 变量）。

## 2. 环境搭建步骤

- 每步命令/操作（参考 `rtl-verif` 技能与 `mpd_verif_*` 工具）与预期产物。

## 3. 用例清单与用法

- 用例表（ID/名称/描述/运行命令/预期结果）。
- 种子与随机性说明、用例过滤方式（cocotb testFilter / UVM testname）。

## 4. 结果查看

- 日志/结果文件位置与格式（results.xml / regress results.json / UVM 日志）。
- 覆盖率报告查看方式（verilator 合并报告 / urg + fsdbreport）。
- 波形打开方式（wave-mcp/TraceWeave 接线）。

## 5. 常见问题

- 典型失败与对策（venv 缺失、二进制缺失、license、seed 复现）。
