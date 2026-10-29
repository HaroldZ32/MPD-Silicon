# 规格阶段的文档生成

[English](./docgen-guide.md)

在 **规格设计 IP01** 阶段，`rtl-ip-flow` 流程要产出两份给人读的文档——内部用户手册及其英文对照版；
在此之前，寄存器工作簿和 Word 手册都靠手工整理。`mpd-docgen` 补上了这一环：**内部用户手册就是唯一的
机器可读来源**，一次工具调用即可生成 eCap 格式的寄存器工作簿与中英双语 Word 用户手册，并写入目标
项目的 `docs/`。

生成器是一个**零第三方依赖**的文档写出器：直接生成 SpreadsheetML 与 WordprocessingML（不引入任何
OOXML 库、不使用模板资产、不依赖办公套件），这也是它输出**确定性**的原因——同一份手册每次重跑都得到
逐字节相同的文件。

## 三个交付物

| 交付物 | 默认路径 | 来源 |
| --- | --- | --- |
| 寄存器工作簿 | `docs/<ip>_regExcel_full.xlsx` | 中文手册的寄存器章节 |
| 中文用户手册 | `docs/<ip>_reg_user_manual.zh-CN.docx` | `docs/user-manual.md` |
| 英文用户手册 | `docs/<ip>_reg_user_manual.en.docx` | `docs/user-manual.en.md` |

只有一份工作簿，不是两份：标识符（寄存器名与位域名）保持英文，描述保持中文，与 eCap 工作簿一致。
两份 docx 则是分别由两份 markdown 源生成的独立文档。

`<ip>` 是 **IP 标识（slug）**：显式传入的 `ip` 优先（整体使用、保留大小写，非安全字符替换为 `_`）。
未传入时取 H1 标题的**第一个 ASCII 单词**并保留大小写（`# eCap 用户手册` → `eCap`，`# TIMER top` →
`TIMER`）；标题里没有 ASCII 单词时回退为字面量 `ip`。`mpd_docgen_run` **只从中文手册推导一次** slug，
再把同一个值用于所有输出名，因此即使两份 H1 标题不同，三个文件名也不会彼此漂移。

## 快速开始

写好两份手册后，调用一次即可：

```json
{
  "manual": "docs/user-manual.md",
  "manualEn": "docs/user-manual.en.md",
  "outputDir": "docs",
  "ip": "eCap"
}
```

这就是 `mpd_docgen_run`。它返回三个已写入文件的路径、字节数与 sha256，以及寄存器/位域计数和全部
warning。随后对产物运行门禁校验器：

```json
{
  "xlsx": "docs/eCap_regExcel_full.xlsx",
  "docxZh": "docs/eCap_reg_user_manual.zh-CN.docx",
  "docxEn": "docs/eCap_reg_user_manual.en.docx"
}
```

这就是 `mpd_docgen_verify`；`ok: true` 表示所有被请求的结构检查全部通过（三份产物齐全时为 11 项）。

## 四个工具

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| `mpd_docgen_register_xlsx` | `input`（必填）、`output?`、`ip?` | `output`、`registers`、`fields`、`bytes`、`sha256` |
| `mpd_docgen_user_manual_docx` | `input`（必填）、`lang`（必填：`zh-CN` 或 `en`）、`output?`、`ip?` | `output`、`lang`、`registers`、`tables`、`headings`、`bytes`、`sha256` |
| `mpd_docgen_run` | `manual`（必填）、`manualEn?`、`outputDir?`（默认 `docs`）、`ip?` | `ok: true`、`files[]`（`path`、`lang?`、`bytes`、`sha256`）、`registers`、`fields`、`warnings` |
| `mpd_docgen_verify` | `xlsx?`、`docxZh?`、`docxEn?` | `ok`、`checks[]`（`id`、`ok`、`detail`）、`failed[]` |

路径按会话工作区根解析，绝对路径原样保留。所有写入都是原子的（同目录临时文件后 rename，权限 `0644`），
且不向 `DSH_HOME` 写任何东西。

- **`mpd_docgen_register_xlsx`** 始终按 zh-CN 标签集解析，因此应喂给它中文手册——工作簿的描述列就是
  中文描述。`output` 指定精确文件；否则目标为 `<workspace>/docs/<ip>_regExcel_full.xlsx`。
- **`mpd_docgen_user_manual_docx`** 读取一份手册、一种语言。`tables` 统计总览表 + 每个寄存器的位域表/
  明细表对 + 正文中的每张普通 markdown 表；`headings` 统计 H1 + 正文标题 + 寄存器 H2 + 每个寄存器
  一个 H3。
- **`mpd_docgen_run`** 是流程入口。它解析中文手册，并在给出时解析英文对照版；**在构建或写入任何字节
  之前**先比较两者的寄存器骨架，因此骨架不一致不会污染输出目录。未给 `manualEn` 时它仍然成功，写出
  工作簿与中文 docx，并报告一条 warning，说明流程要求英文对照版。
- **`mpd_docgen_verify`** 只读产物（从不读源手册），因此可以由另一个 agent 独立运行。文件缺失或损坏
  不会从工具里抛出：绑定到它的检查会被记录为失败并附原因。

### 拒绝码

拒绝是结构化结果（`{ ok: false, error: { code, message, hint } }`），绝不是未处理的异常。`hint`
给出修复动作。

| 代码 | 含义 |
| --- | --- |
| `DOCGEN_E_INPUT` | 必填参数缺失/为空、`lang` 不是 `zh-CN`/`en`，或 `mpd_docgen_verify` 未给任何产物 |
| `DOCGEN_E_IO` | 读取输入或写入输出失败 |
| `DOCGEN_E_PARSE` | 手册无法解析：没有寄存器章节或没有解析出寄存器、寄存器缺少偏移/复位、缺少位域表、位域行少于四列、位域范围/偏移/复位无法解析、寄存器名为空或重复、复位值超过 8 个十六进制位或放不进 16 位 |
| `DOCGEN_E_FIELDS` | 位域范围高低于低、超出 `[31:0]`、或与其他位域重叠；位域名称为空 |
| `DOCGEN_E_ACCESS` | 非 RESERVED 位域缺少访问码，或访问码不在 25 码集合内 |
| `DOCGEN_E_LANG_MISMATCH` | 仅 `mpd_docgen_run`：中英文寄存器骨架不一致 |
| `DOCGEN_E_ZIP` | `mpd_docgen_verify` 读到的产物不是合法 ZIP 容器（截断或 CRC 错误） |
| `DOCGEN_E_INTERNAL` | 意外内部错误的兜底码 |

## 输入文法

只有寄存器章节是机器可读的；其余部分都是普通 markdown，作为 docx 正文渲染。

1. **H1 标题**：`# <IP 名称>` —— 提供默认的 `<ip>` slug（见上）。
2. **寄存器章节**：`## 寄存器` 或 `## Registers`（任一语言的标题在两份手册里都被接受）。写出器总是把
   它渲染为**最后一章**。
3. **单寄存器标题**，两种形式：
   - 规范形式：`### 时间戳计数器(TSCTR)` —— ASCII 圆括号；
   - 旧版形式（eCap 自己的手册）：`### 寄存器1（TSCTR）——时间戳计数器` —— 全角圆括号与破折号。

   `### 寄存器总览` / `### Registers overview` 不是寄存器标题。
4. **偏移行**：`偏移地址：0x00` 或 `Offset: 0x00`。`0x` 前缀必需。
5. **复位行**：`复位值：0x0000 1020` 或 `Reset value: 0x0000 1020`。十六进制位允许空格分组；
   **8 个十六进制位表示 32 位寄存器，更短则是 16 位**。
6. **位域表**：表头行以 `| 位域 |` 或 `| Bits |` 开头，列为 `位域 | 名称 | 读写属性 | 描述`（中文）
   或 `Bits | Name | Access | Description`（英文）。数据行为 `| N 或 N:M | NAME | access | desc |`。
   `<br>` 变成换行；第四个单元格之后的字面 `|` 会被并回描述，因此描述可以包含竖线。

构建模型的规则：

- **访问码对非 RESERVED 位域是严格的**：`rw`、`ro`、`wo`、`w1`、`w1c`、`rc`、`rs`、`wrc`、`wrs`、
  `wc`、`ws`、`wsrc`、`wcrs`、`w1s`、`w1t`、`w0c`、`w0s`、`w0t`、`w1src`、`w1crs`、`w0src`、
  `w0crs`、`woc`、`wos`、`wo1`。RESERVED 行的访问格可以留空。
- **空洞填充**：未被声明位域覆盖的每一位都会成为一行 `RESERVED`——中文 `保留，必须保持复位值`，英文
  `Reserved; keep the reset value`；位相邻的 RESERVED 段合并为一行，行按高位在前排序，并集恰好为
  `[31:0]`。16 位寄存器同样会补齐到 `[31:0]`；当其声明位域止于 bit 15 时，`[31:16]` 会补成一行
  RESERVED，与 eCap 工作簿一致。
- **位域范围按 `[31:0]` 校验，而不是按推导出的位宽。** eCap 自己的手册就在 4 位复位值（即 16 位宽）的
  寄存器上声明到 bit 31 的位域；按位宽校验会拒绝真实手册。
- **总览表只是交叉校验，不是事实来源。** `### 寄存器总览` 中的偏移按数值比较（`0NNNh` 与 `0xNN`
  两种写法都会归一化）；不一致会记入 `warnings[]`，解析仍然成功。模板自带的占位行（空名称、
  `IP_REG0`、没有对应寄存器章节的全零偏移）会被静默跳过。

## 输出保真度

### 工作簿（`<ip>_regExcel_full.xlsx`）

从 eCap 的 `reg2excel.py` 移植并做结构校验，而非逐字节复制：

- 一个名为 `Sheet1` 的工作表，恰好九列 A..I；表头行高 43.2；九列（包括空的 G/H/I）全部带细边框；
- A..I 表头：`register name`、`field offset`、`field name`、`access type`、`reset value`、
  `description（中文描述，请填此列）`、`skip field test`、`remarks`，I 列是结构图例；
- 每个寄存器一行 **Reg 行**（加粗、填充 `FFFFFF00`，A=名称、B=偏移、D=字面量 `Mixed`、E=复位值
  的 8/4 位大写十六进制、F=寄存器标题），随后是它的**位域行**（无填充、不加粗，B=`[hi:lo]` 或
  `[N]`，C=名称，D=大写访问码（RESERVED 留空），E=`{width}'h{HEX}`，F=描述）；
- 字号 11——中文用宋体（charset 134），ASCII 用 Calibri——描述列自动换行，列宽取 eCap 的数值；
- 字符串为内联写法（没有共享字符串部件），文档属性带固定的 `1980-01-01T00:00:00Z` 时间戳（不读
  时钟），因此重跑逐字节一致。

### Word 手册（`<ip>_reg_user_manual.<lang>.docx`）

与 eCap `reg_user_manual.docx` 的寄存器章节风格对齐：

- 正文：手册 H1，随后是非寄存器章节的普通 Word 内容（标题、段落、列表、围栏代码、普通表格），最后是
  **寄存器章节**；
- **总览表**（`Offset | Register | 31..0`，两种语言都用英文表头），每个寄存器恰好**两行**：名称行
  （行高 902；偏移格、寄存器名、每个位域一格且 `gridSpan` 等于其宽度，1 位或 32 位字段的标签是
  `NAME`，否则是 `NAME[hi:lsb]`；RESERVED 是灰色 `D9D9D9` 色带并标注 `RESERVED`；单比特字段为
  竖排 `btLr` 文本）与复位行（行高 278；标签 `Reset value`，每比特一格填 `1`/`0`，RESERVED 段清空）；
- **单寄存器章节**：中文 H3 为 `{标题}（{名称}）`，英文为 `{title} ({name})`；偏移行
  （`地址偏移：` / `Offset: `）与复位行（`复位值：` / `Reset value: `）；一张 **6 × 16 位域表**
  （行依次为：`31..16` 数字、位域名、访问码、`15..0` 数字、位域名、访问码；位域名行高恰好 420
  twips；固定布局、100 % 宽、按位域 `gridSpan`，RESERVED 格留空）；一个空段落；一张**明细表**
  （`位域 | 名称 | 描述` / `Bit field | Name | Description`，网格 830/1659/5807 twips，每个位域一行，
  描述按换行拆成每行一个段落）；一个空段落；
- 位域表中的**访问码文本**经 eCap 的八组映射（`rw`→`rw`、`ro`→`r`、`wo`→`w`、`w1c`→`rc_w1`、
  `w0c`→`rc_w0`、`rc`→`rc_r`、`w1s`→`rs`、`w1t`→`t`）；映射表之外的代码原样输出；RESERVED 格清空；
- 所有 run 都带 `rFonts` 与 `hint="eastAsia"`（正文 Calibri / 宋体，代码 Courier New / 宋体）；
- 正文末尾恰好一个 `sectPr`（A4 纵向）。**没有目录、封面、页眉或页脚**——eCap 文档本身就没有，本写出器
  也不凭空添加；
- ZIP 容器使用固定的 DOS 时间戳 1980-01-01 并排序条目，因此重跑逐字节一致。该保证**按运行时成立**：
  未压缩的 OOXML 成员在各运行时完全相同，但 zlib deflate 流在 Node 与 bun 之间可能不同，因此文件哈希
  在其生成的运行时上可复现，跨运行时不一定一致。

## 门禁校验器

`mpd_docgen_verify` 就是规格评审的门禁校验器：它读取产物并断言计划中的结构契约。它只检查被传入的
东西——传 `xlsx` 检查 V1–V5，传 `docxZh`/`docxEn` 检查 V6–V9，两份 docx 都传才检查 V11；V12 始终
覆盖每一份被传入的产物。

| 检查 | 断言 |
| --- | --- |
| V1 | 一个名为 `Sheet1` 的工作表，且恰好九个表头 |
| V2 | 行模型：1 行表头 + R 行 Reg + F 行位域，每行九列齐全 |
| V3 | 每个 Reg 行都加粗、黄色填充并带 `Mixed` |
| V4 | 位域偏移带方括号且降序，并集覆盖 `[31:0]`，RESERVED 访问码为空且描述为规范文本，复位字面量大写且长度正确 |
| V5 | A..I 细边框、eCap 列宽、43.2 表头行高、字号 11 的字体对 |
| V6 | 九个 OOXML 部件、内容类型、`document.xml`，且恰好一个末尾 `sectPr` |
| V7 | 寄存器 H2 章节、每个寄存器一个 H3，以及每章的偏移/复位行 |
| V8 | 总览表：表头、每寄存器两行、902/278 行高、灰色 RESERVED 段 |
| V9 | 每个寄存器的 6 × 16 位域表与 830/1659/5807 明细表 |
| V11 | 中英两份文档描述同一寄存器骨架（从文档本身推导） |
| V12 | 没有模板占位符（`<寄存器名>`、`<REG_NAME>`、`<IP名称>`）残留到产物中 |

**V10**——重跑逐字节一致——需要重新构建，因此留在 `bun:test` 里，而不是放进工具。包内测试套件覆盖
了它（`bun test packages/mpd-docgen-plugin`）。

## 流程绑定

在 `rtl-ip-flow` skill 中，这是 **Stage 2 — 规格设计 IP01**：

1. 规格设计师把内部用户手册写到 `docs/user-manual.md`，并写英文对照版到 `docs/user-manual.en.md`
   （章节顺序一致，按 `templates/user-manual.en.md`）；
2. 规格设计师用 `manual` 与 `manualEn` 调用 `mpd_docgen_run`，在 `docs/` 下产出三个交付物；
3. 🔴 **规格评审** 门禁在三份产物都存在于 `docs/` **且** `mpd_docgen_verify` 返回 `ok` 之前不算通过。
   它们是门禁项，不是可选项。

流程的文档矩阵把生成的这一对列为独立一行，一致性检查清单则要求 xlsx/docx 的寄存器与用户手册一致、
且中英文寄存器骨架完全相同。

## 限制

- **零第三方运行时依赖。** 本包只导入 `node:` 内建模块与 `@mpd-dsh/mpd` 的 adapter——没有 OOXML 库、
  没有模板资产、不依赖办公套件。
- **没有 PDF。** 交付物是 xlsx 与 docx；格式转换不在范围内。
- **docx 没有目录、封面、页眉或页脚**，这是设计决定。
- **寄存器章节必须在最后。** 写出器把它追加在所有其他章节之后；在 markdown 里把它放在中间，并不会
  改变它在 docx 中的位置。
- **不支持的访问码在 docx 中原样输出。** 解析器会拒绝 25 码集合之外的代码；但对于*合法*却没有映射对
  的代码，Word 位域表会原样打印，而不是臆造一个译法。
- **中英文寄存器骨架不一致是硬拒绝**（`DOCGEN_E_LANG_MISMATCH`），发生在写入任何字节之前。标题、
  描述与访问码文本可以不同；寄存器数量与顺序、名称、数值偏移、位宽、以及有序的位域范围（含是否
  RESERVED）必须一致。
- **总览表只是交叉校验。** 不一致只产生 warning；它既不会修正工作簿，也不会拒绝手册。
- **只有一份工作簿。** 它由中文手册生成；没有英文工作簿。
- **docx 是结构对齐，不是逐字节复制。** eCap 文档的 64 张表里包含一张由 Word 模板带来的版本历史表，
  本写出器有意不克隆它。

## 验证一次改动

包内测试套件是最内层循环：

```bash
PATH="$PWD/.toolchain/bin:$PATH" bun test packages/mpd-docgen-plugin
```

它覆盖解析器、规范化、xlsx 与 docx 写出器（含逐字节重跑）、run 工具的拒绝路径以及门禁校验器。仓库
门禁（`node scripts/typecheck.mjs --require`、`node scripts/pack-silicon.mjs --check`、语料与
row-id 门禁）列在 [`AGENTS.md`](../AGENTS.md) §4。
