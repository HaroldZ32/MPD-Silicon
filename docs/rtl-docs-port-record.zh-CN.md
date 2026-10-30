# RTL 文档移植记录

[English](./rtl-docs-port-record.md)

六份 RTL 文档已从源工程复制进 `docs/`。本文件记录来源、所作的修正，以及**仍然前向引用**的位置
—— 以免有人把前向引用误当成坏引用。

源工程检出 = 兄弟目录 `../my-power-dsh`，可用 `MPD_SOURCE_ROOT` 覆盖（口径定义在
`docs/sync-policy.md`；任何地方都不硬编码绝对路径）。

> **2026-10-21 状态。** 本文件是移植当时的历史记录。下文所有点名 **t16** 的前向引用均已落地：
> HDL 语言服务资产在 `packages/mpd-mcp-lsp/` 内，其 `silicon-mcp-lsp` 行已启用，四个 golden
> Verilog fixture 在 `tests/golden/fixtures/verilog/` 内（提交 `da3693c`）。见
> [`packages/mpd-mcp-lsp/README.zh-CN.md`](../packages/mpd-mcp-lsp/README.zh-CN.md)。字节数与修正
> 台账保留移植当时的实测值。

## 逐字节复制（任何修正之前已验证）

| 文件 | 字节数（源 = 副本） |
| --- | --- |
| `rtl-verif-guide.md` | 14311 |
| `rtl-verif-guide.zh-CN.md` | 14401 |
| `rtl-ip-flow-guide.md` | 5166 |
| `rtl-ip-flow-guide.zh-CN.md` | 4806 |
| `rtl-gap-assessment.md` | 22347 |
| `rtl-gap-assessment.zh-CN.md` | 21974 |

复制完成后 `cmp` 对六份全部报 IDENTICAL，因此下面列出的每一处字节差异都是本仓库**刻意**做的。

## 已应用的修正（源归属规则）

源文档把资产描述为位于 mpd bundle；移植后它们在本仓库，因此指向 mpd 所属位置的路径引用被改为
指向本 bundle。其余一律未动 —— 尤其是叙述中的工程名保持不变。

| 文件 | 原表述 | 现表述 |
| --- | --- | --- |
| `rtl-verif-guide.md`、`rtl-verif-guide.zh-CN.md` | `` `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` `` | 同路径，并标注为 silicon 所有、资产随 **t16** 落地 |
| `rtl-verif-guide.md` | `` COMMENTED examples in `packages/mpd-bundle/cordis.patch.yml` `` | "this bundle's `packages/mpd-bundle/cordis.patch.yml`" |
| `rtl-gap-assessment.md`、`.zh-CN.md` | `` `packages/mpd-bundle/cordis.patch.yml` `` | "this bundle's …" / 本 bundle 的 … |
| `rtl-gap-assessment.md`、`.zh-CN.md` | `` `packages/mpd-mcp-lsp/dist/cli.js` `` | 同路径，标注为 silicon 所有、随 **t16** 落地 |
| `rtl-verif-guide.md`、`rtl-verif-guide.zh-CN.md` | `` `packages/mpd-verif-plugin/evidence/smoke/` `` | 同路径 + "(this repository)" / （本仓库） |

六份源文档中**都不存在绝对路径**，因此没有因该原因需要重写的路径 —— 该规则实际只落在两个
README 上（见下）。

## 前向引用 —— 移植期记录（现已落地）

移植时有两处被引用的位置在本仓库尚不存在。它们作为前向引用保留，以免丢掉指令；
**如今两处均已交付**：

- `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` 与 `packages/mpd-mcp-lsp/dist/cli.js`
  现已随本仓库交付（`cli.js` 235271 字节，由 `BUILD.lock` 固定）；t16 落地资产后，
  `silicon-mcp-lsp` 行已**启用**。
- `skills/lsp-setup/references/{verilog,systemverilog}/README.md` 是移植期 mpd 侧的副本。
  HDL 页面现随本仓库交付于
  `packages/mpd-mcp-lsp/references/{verilog,systemverilog}/README.md`；源仓库只保留路由行。

原调用点仍带 task id 标注，作为移植期记录。本节今天没有任何待落地项。

## 本仓库自身文档的绝对路径清理

`docs/sync-policy.md` 禁止硬编码机器相关位置。本仓库自身有三个文件违反了它；现全部改用兄弟目录
口径。（原先的绝对拼写**刻意不在本文件复述** —— 复述它等于在"记录其移除"的文档里留下机器相关
路径。）

| 文件 | 行 | 变更 | 现为 |
| --- | --- | --- | --- |
| `README.md` | 142 | 源工程曾以一条硬编码的绝对检出路径指称 | 兄弟目录 `../my-power-dsh`、`MPD_SOURCE_ROOT` 覆盖，并链接 `docs/sync-policy.md` |
| `README.zh-CN.md` | 102 | 同一个绝对拼写 | 兄弟目录 `../my-power-dsh` + `MPD_SOURCE_ROOT` |
| `presets/README.md` | 33 | 指向源 patch 文件的绝对路径 | "the source project's `packages/mpd-bundle/cordis.patch.yml`" + 该口径 |
| `presets/README.zh-CN.md` | 29 | 同上 | 源工程 `packages/…` + 兄弟目录口径 |

验证（本文件排除在外，因为它记录的是该缺陷而不是展现它）：在文档树中检索源检出路径前缀，确认
唯一命中就在本记录文件内部：

```
$ grep -rln "$SRC_PATH_PREFIX" README.md README.zh-CN.md presets/ docs/ | grep -v rtl-docs-port-record
(no matches)
```

## 本任务自有增量对仓库手册（AGENTS.md）的合规性

`AGENTS.md`（由仓库手册任务落地）把双语政策定为强制：每份面向人的文档都同时提供英文文件与
**简体中文**副本，且两者都在标题正下方带语言切换链接。对本任务拥有的每份文档做了审计 —— 在补上
两处缺失的切换链接后**全部合规**：

| 配对 | en → zh | zh → en |
| --- | --- | --- |
| `README.md` / `README.zh-CN.md` | ✔（新增链接） | ✔（新增链接） |
| `presets/README.md` / `presets/README.zh-CN.md` | ✔（新增链接） | ✔（新增链接） |
| `docs/rtl-docs-port-record.md` / `.zh-CN.md` | ✔（新建副本） | ✔ |
| 移植的六份 RTL 文档 | ✔（随源带来） | ✔ |
| `docs/dependency-map*`（t4 的） | ✔ | ✔ |
| `docs/sync-policy.md`（t4 的） | ✔ | ✔ —— 双语**同文件**（`# 中文版` 章节），满足政策而无需独立副本 |

上述编辑后运行 `AGENTS.md` §4 门禁套件：tests `130 pass / 0 fail / 1 已知 skip` ·
`verify-corpus` 0 · `verify-rows-disjoint` 0 · `pack-silicon --fix` 0 · `--check` 0 ·
`--self-test` 0 · `pack` 0 · `find . -type f -perm 600` = 0。

## 与 t4 策略文档的归属边界

`docs/dependency-map.md`、`docs/dependency-map.zh-CN.md` 与 `docs/sync-policy.md` 是 **t4 的**
交付物，本次移植未改动它们。两者重叠处：权威归属/变更规则以 t4 的 `sync-policy.md` 为准，逐资产
映射以 `dependency-map.md` 为准；本文件只补充 RTL 文档的来源记录，不引入第二套策略陈述。

一处命名说明：`sync-policy.md` 把源仓库写作 `../my-power-dsh`（带连接符）。实测本机上
`my-power-dsh-silicon` 的兄弟目录确实就是 `my-power-dsh`（带连接符），因此**该写法正确、无需修正**。
（此前有一条"可能是笔误"的怀疑，经复核为误报并已撤回。）
