# mpd-docgen-plugin

[English](./README.md)

`rtl-ip-flow` 规格阶段的文档生成包：一份 markdown 用户手册就是机器可读来源，本包据此在
**规格设计 IP01** 阶段生成寄存器 Excel 工作簿与中英双语 Word 用户手册。

```
docs/user-manual.md ──┬─→ <ip>_regExcel_full.xlsx
                      └─→ <ip>_reg_user_manual.zh-CN.docx
docs/user-manual.en.md ──→ <ip>_reg_user_manual.en.docx
```

写出器**零第三方依赖**：直接生成 SpreadsheetML 与 WordprocessingML，不引入任何 OOXML 库、不使用模板
资产、不依赖办公套件。归档的每个输入都是固定的（条目排序、DOS 时间戳 1980-01-01、不读时钟、不用随机
id），因此同一份手册重跑得到的文件**逐字节一致**。

## 对 @mpd-dsh/mpd 的硬依赖

本包不是独立插件。`src/index.ts` 通过包说明符
`@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js` 导入 adapter，并声明硬 inject 依赖：

```ts
export const inject = [...dshSeamInject(DSH_SEAM_TOOLS), "mpdDsh"]
```

四个工具都经 `ctx.mpdDsh` 注册；**没有兜底**，也没有本地副本。缺少该 provider 的组装会让本行停留在
PENDING，而 bundle 的 `silicon-require-mpd` 守卫会在 15 s 内把它变成 exit 1。

## 工具

四个工具都使用对象根 `parameters`、`output.schema` 与 `output.render`；失败是结构化的
`{ ok: false, error: { code, message, hint } }` 结果，绝不是未处理的异常。

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| `mpd_docgen_register_xlsx` | `input`（必填）、`output?`、`ip?` | `output`、`registers`、`fields`、`bytes`、`sha256` |
| `mpd_docgen_user_manual_docx` | `input`（必填）、`lang`（`zh-CN`\|`en`，必填）、`output?`、`ip?` | `output`、`lang`、`registers`、`tables`、`headings`、`bytes`、`sha256` |
| `mpd_docgen_run` | `manual`（必填）、`manualEn?`、`outputDir?`（默认 `docs`）、`ip?` | `ok: true`、`files[]`（`path`、`lang?`、`bytes`、`sha256`）、`registers`、`fields`、`warnings` |
| `mpd_docgen_verify` | `xlsx?`、`docxZh?`、`docxEn?` | `ok`、`checks[]`（`id`、`ok`、`detail`）、`failed[]` |

- `mpd_docgen_run` 解析中文手册与可选的英文对照版，**在写入任何字节之前**比较两者的寄存器骨架，随后
  用同一个 `<ip>` 写出工作簿和每种语言一份 docx。缺少 `manualEn` 仍算成功，只附带一条 warning。
- `mpd_docgen_verify` 是门禁校验器：只读产物，断言 V1–V9、V11、V12；V10（重跑逐字节一致）留在
  `bun:test` 里。文件缺失或损坏会让对应检查失败并附原因，而不是抛异常。

产物默认写到 `<workspace>/docs/`：

| 交付物 | 文件名 |
| --- | --- |
| 寄存器工作簿 | `<ip>_regExcel_full.xlsx` |
| 中文手册 | `<ip>_reg_user_manual.zh-CN.docx` |
| 英文手册 | `<ip>_reg_user_manual.en.docx` |

`<ip>` 取显式 `ip` 参数；否则取手册 H1 的第一个 ASCII 单词（保留大小写）；再否则为字面量 `ip`。写入
是原子的（同目录临时文件 + rename，权限 `0644`），相对路径按会话工作区根解析，绝不写 `DSH_HOME`。

## 错误码

| 代码 | 触发场景 |
| --- | --- |
| `DOCGEN_E_INPUT` | 必填参数缺失/为空、不支持的 `lang`、`verify` 未给任何产物 |
| `DOCGEN_E_IO` | 输入不可读或输出写入失败 |
| `DOCGEN_E_PARSE` | 没有寄存器章节/寄存器、缺少偏移或复位、缺少位域表、位域行或位域范围格式错误、寄存器名为空或重复、复位值位宽非法 |
| `DOCGEN_E_FIELDS` | 位域范围高低于低、越界或重叠；位域名称为空 |
| `DOCGEN_E_ACCESS` | 非 RESERVED 位域缺少访问码或访问码未知 |
| `DOCGEN_E_LANG_MISMATCH` | 中英文寄存器骨架不一致（仅 run） |
| `DOCGEN_E_ZIP` | `verify` 读到非 ZIP/截断/CRC 错误的产物 |
| `DOCGEN_E_INTERNAL` | 意外内部错误的兜底码 |

## 代码结构

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | 插件入口：`name`、`inject`、`apply` —— 注册四个工具定义 |
| `src/types.ts` | 规范模型（`Field`、`Register`、`Manual`、`Block`）、结果形状、`DocgenError` |
| `src/markdown.ts` | 块分词器 + 寄存器章节提取（两种标题形式、偏移/复位行、位域表、总览交叉校验） |
| `src/registers.ts` | 规范化：位宽规则、范围校验、访问码校验、空洞填充、相邻 RESERVED 合并 |
| `src/labels.ts` | zh-CN / en 输出字符串（章节标题、偏移/复位前缀、表头、保留位描述） |
| `src/xlsx.ts` | SpreadsheetML 写出器：`Sheet1`、九列、Reg/位域行模型、样式、列宽 |
| `src/docx.ts` | WordprocessingML 写出器：正文块、总览表、每寄存器位域/明细表、样式、`sectPr` |
| `src/zip.ts` | 确定性 ZIP 读写（条目排序、固定 DOS 时间戳、CRC32） |
| `src/xml.ts` | XML 声明与转义辅助 |
| `src/paths.ts` | 工作区根路径解析、产物命名、IP slug、原子写入 |
| `src/consistency.ts` | 中英文寄存器骨架比较 |
| `src/tool-xlsx.ts`、`src/tool-docx.ts`、`src/tool-run.ts`、`src/tool-verify.ts` | 四个工具定义 |

本包固定的公开 API：

```ts
parseManual(text: string, lang: Lang): Manual
canonicaliseRegisters(registers, lang?): Register[]
buildXlsx(registers, { ip }): Uint8Array
buildDocx(manual, registers, lang, { ip }): Uint8Array
compareSkeletons(a, b): string[]
buildZip(entries): Uint8Array            readZip(data): Map<string, Uint8Array>
workspaceRoot(exec) / resolveInputPath / resolveOutputPath / resolveOutputDir
regExcelFileName / docxFileName / ipSlug / atomicWriteFile
registerXlsxToolDefinition / userManualDocxToolDefinition
docgenRunToolDefinition / docgenVerifyToolDefinition
```

## 构建与测试

`package.json` 声明 `main: dist/index.js`。本 bundle 的每个插件都把构建出的 dist 与 `src` 一起提交，
由 `bun run build`（`scripts/build.mjs`）产出并保持 `@mpd-dsh/mpd/*` 为外部依赖；docgen 包由 bundle
集成步骤加入该构建清单。测试前需要先安装依赖（`bun install`），因为 adapter 是包依赖，不会被内联。

```bash
PATH="$PWD/.toolchain/bin:$PATH" bun test packages/mpd-docgen-plugin
```

在当前源码树上的实测结果：**4 个文件共 106 个测试，0 失败**（解析/规范化、xlsx、docx、run/verify）。
套件包含 V10 的逐字节重跑——工具本身无法断言它，因为那需要重新构建。

## 保真度与限制

- **xlsx**：一个 `Sheet1` 工作表、A..I 九列、表头行高 43.2、九列（含空白列）细边框、eCap 列宽、
  加粗黄色 Reg 行且 D 列为 `Mixed`、位域行带 `[hi:lo]` / `[N]` 偏移与 `{width}'h{HEX}` 复位字面量、
  字号 11 的宋体/Calibri 字体、描述列自动换行。
- **docx**：eCap 寄存器章节版式——每寄存器两行的总览表（902/278 twips、灰色 RESERVED 色带）、
  6 × 16 位域表（位域名行 420 twips）、830/1659/5807 网格的明细表、末尾恰好一个 `sectPr`。访问码
  文本经 eCap 的八组映射（`rw`→`rw`、`ro`→`r`、`wo`→`w`、`w1c`→`rc_w1`、`w0c`→`rc_w0`、
  `rc`→`rc_r`、`w1s`→`rs`、`w1t`→`t`）；未映射的代码原样输出。
- **docx 没有目录、封面、页眉或页脚**（设计决定）；**没有 PDF** 输出。
- **寄存器章节总是渲染在最后。** 中英文寄存器骨架不一致会在写入前硬拒绝。不支持的访问码到不了
  写出器（解析器已拒绝），但合法却没有 Word 映射对的代码会原样打印。
- **结构对齐，不是逐字节复制**：eCap 的 docx 有 64 张表，其中一张版本历史表来自本包有意不克隆的
  Word 模板。

输入文法、流程绑定与完整校验表见 [`docs/docgen-guide.zh-CN.md`](../../docs/docgen-guide.zh-CN.md)。
