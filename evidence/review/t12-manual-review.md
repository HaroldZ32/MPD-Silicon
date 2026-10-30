# t12 — 新仓库 `AGENTS.md` 准则等价性评审（基准：mpd 的 `AGENTS.md`）

**Task:** t12（系统外执行，captain 直接派发）· **Reviewer:** Reviewer · **只写入本文件**
**评审对象:** `/root/dshProj/my-power-dsh-silicon/AGENTS.md`（194 行，sha256 `ba459f5b…7b0c5`）
**基准:** `/root/dshProj/my-power-dsh/AGENTS.md`（534 行 / 13 章，sha256 `0c7e543e…a1a37f`）
**Verdict: `needs_revision`** — 10 findings（6 medium / 4 low，无 blocker、无 high）。

判定口径（captain 指定）：每条准则判 **保留 / 改写 / 不适用**；**改写若弱化了要求即 failed**。所有结论只认磁盘证据与实跑输出。

---

## 0. 总体判定（三段式）

| 判定项 | 结论 | 依据 |
|---|---|---|
| ① 准则等价性 | **部分不达标** | 语言政策、§2 六条原则、`--dump-config` 铁律、QA 三重隔离、安全隐私 = 等价或更强；**§4 门禁表、git 模型、§6 插件规范 = 收窄**（见 F1–F7） |
| ② 「不整体拷贝」前提审 | **PASS** | 结构、章节数、语言、内容均为本仓库重写；mpd 专属事实零残留（见 §2） |
| ③ 本仓库两条实测陷阱 | **PASS** | 两条都写了，且都有实测证据（见 §3） |
| ④ 事实真实性 | **PASS（有 2 处表述瑕疵）** | 抽查 18 条路径/包名/row id 全部存在；`skills/` 恰三棵树、单包相对 import 约束均与仓库一致；见 §4 与 F8/F9/F10 |

章节映射（基线 13 章 → 新手册 9 章）：
§1→§1 · §2→§2 · §3→§3 · §4→§4 · §5→§5 · §6→§6 · §7→§7 · §8 Installer&Profiles→（并入 §4 Modes/Pack）· §9 Vendor&Baseline→§9 Known Limitations（改写为语料基线）· §10 Security&Privacy→§8 · §11 Release→（并入 §4 Pack + §5）· §12 Troubleshooting→§9 · §13 Glossary→（省略，非规范条款）。

---

## 1. 逐条准则等价性判定

### 1.1 语言政策（基线 :7-23 / 新手册 :6-12）

| 要素 | 基线 | 新手册 | 判定 |
|---|---|---|---|
| agent 面英文 | 手册/注释/QA 脚本日志英文 | 手册/代码注释/gate 脚本与日志英文 | **保留** |
| 人读文档双语 | `README.md` + `docs/*.md` + **每个 `packages/*/README.md`** | `README.md` + `docs/*.md`（**漏 packages/\***） | **改写→弱化（F6）** |
| 同提交同步 | 明确写"同一提交内更新两份" | 明确写"same commit" | **保留** |
| 标题下切换链接 | 有 | 有（格式一致） | **保留** |
| 豁免条款 | 明确豁免 adopted 第三方文档与 process records / 内部 QA 文档 | **无豁免条款**，但 `docs/adder4.md`/`cnt8.md` 自我声明 "exempt from the bilingual policy (**see AGENTS.md Language Policy + §3**)"——而手册里并没有这条规则（引用悬空）；`docs/sync-policy.md` 为单文件双语 | **改写→与现状不自洽（F6）** |

### 1.2 §2 六条原则（基线 :87-94 / 新手册 :39-50）

| # | 基线 | 新手册 | 判定 |
|---|---|---|---|
| 1 | The agent is the worker | the same | **保留** |
| 2 | Plugin form（DSH cordis plugin / 官方实例 / 逻辑不进 profile·script·home） | 同（去掉 "DSH" 限定） | **保留** |
| 3 | Evidence without evidence is incomplete（无 QA 证据不算完成） | 同（"gate evidence"） | **保留** |
| 4 | Isolation（QA 不碰真 `~/.dsh`，temp DSH_HOME） | 同 + 沙箱 `HOME` + **沙箱 workspace** | **保留（更严）** |
| 5 | **Baseline discipline**（upstream 资产被 pin 且验证；不追 upstream） | **Fidelity over convenience**（移植物逐字节一致，偏离须登记） | **改写（等价）**：本仓库无 upstream 资产基线，"逐字节一致 + 偏离登记"即其 pin/不漂移要求的等价物，且更贴近本仓库 |
| 6 | Minimal diffs | Minimal diffs（含"刻意偏离须逐行登记"） | **保留** |

条数 6 = 6，无"少一条"。

### 1.3 §4 门禁表（基线 :152-159 / 新手册 :83-91）

| 基线行 | 新手册对应 | 判定 |
|---|---|---|
| Vendor `verify-vendor.mjs`（baseline/asset 变更 + 发布前） | **无对应**（本仓库无 VENDOR_LOCK；**但 `build-lsp.mjs --check` 是其等价物且未被写入**） | **不适用→缺口（F1）** |
| Tests `bun test` + **`bun run typecheck`** | Tests `bun test packages/`（**无 typecheck**） | **改写→弱化（F2）** |
| QA self-tests `test:qa`（**all** `--self-test`） | Guard self-test（**仅 packer** `--self-test`） | **改写→弱化（F3）** |
| QA real cases `<case>.mjs`（运行时行为） | **无对应、无指针**（t19 已把两个 RTL 用例重定向到本 bundle） | **改写→弱化（F4）** |
| Installer `install-profile.mjs --dry-run` | 无（本仓库 `dsh plugin add .` 安装；Pack = 发布步骤） | **不适用** |
| Boot check（隔离 DSH_HOME + 沙箱 HOME，patch/preset/row 变更 + 工具 schema 变更必跑） | Boot check（隔离 `DSH_HOME`；同样条件） | **保留**（沙箱 HOME/workspace 见 §2.4 与 §7） |

新手册多出 3 行本仓库专属门禁（Corpus / Row ids / Modes + Pack）——这是正确适配，**不抵消**上述 4 处收窄。

### 1.4 `--dump-config` 铁律

基线 :161-170 + :350-354；新手册 :93-97（独立小节）+ :161-162（§7 provability）。**判定：保留**（且新手册把它与 `--help` 假绿并列成两条独立小节，更醒目）。

### 1.5 git 模型（基线 :179-189 / 新手册 :131-138）

| 要素 | 基线 | 新手册 | 判定 |
|---|---|---|---|
| 分支表 | master/dev/feature/fix/**release** | master/dev/feature/fix（**无 release 行**） | **改写→弱化（F5）** |
| commit 格式 | `<type>(<scope>): <summary>` | 无 | **改写→弱化（F5）** |
| 合并纪律 | never rebase published；`--no-ff` | 无 | **改写→弱化（F5）** |
| 提交粒度 | atomic + 证据 | atomic + 禁止把无关 chmod 扫入删除提交 | **保留（更具体）** |

### 1.6 QA 三重隔离（基线 :336-346 / 新手册 :44-45, :159-160）

基线要求 `DSH_HOME` + `HOME` **+ workspace** 三层隔离，并给出机制（`sandboxWorkspace()`、`assertSessionsSandboxed`）；新手册 §2.4 与 §7 第一条**逐字保留了三层隔离及其理由**（"DSH_HOME/HOME do not isolate workspace-scoped state, so every spawned command carries an explicit sandbox cwd"）。**判定：保留**（具体断言工具是 mpd 侧 QA 脚本的机制，本仓库无 QA 脚本，属 N/A）。

### 1.7 安全与隐私（基线 :432-436 / 新手册 :171-177）

基线：凭据只进临时 QA 沙箱、不得提交/记录/回显；证据日志不得含密钥；SUL-1.0 许可。新手册：仓库内不得出现 token/key/`.credentials*`（含 git config、日志、evidence）；推远端运行时取凭据、token 不得写入 URL 或文件；测试/门禁/QA 不写真实 `~/.dsh`。**判定：保留（等价且更具体）**；SUL-1.0 陈述移至 §1 License 行，未丢失。

### 1.8 插件编写通用规范（基线 :193-327 / 新手册 :142-153）

| 基线条款 | 新手册 | 判定 |
|---|---|---|
| 经 adapter 访问 harness seam（binding） | 有（bullet 3） | **保留** |
| 插件形状 `name`/`inject`/`apply` | 有 | **保留** |
| 不写 harness home、状态在 workspace `.mpd/` | 有 | **保留** |
| 补丁 additive、无 id-target、不 patch mpd 行（无深合并） | 有（且说明后果） | **保留** |
| provider 名全局唯一 | 有 | **保留** |
| 工具注册契约（object-rooted `parameters`、默认 `output.render` 文本块、`(args, exec)`、`exec.signal`） | **无** | **缺失（F7）** |
| guard / waterfall / subagent / 内部工具调用（禁 `ctx.tools.get|execute`） | **无** | **缺失（F7）** |
| 能力探测（缺 seam 降级告警，不得 abort 插件树） | **无** | **缺失（F7）** |
| 状态根 `dsh.workspaceRoot(exec)` 优先级与"按调用解析、禁模块级缓存/chdir" | **无** | **缺失（F7）** |
| build 命令 + 零运行期依赖 | **无** | **缺失（F7）** |
| 注释/docstring 英文 | 已由语言政策覆盖 | **保留** |
| mpd 专属大段（agent-teams 采用与 A1-A6/D1-D8 清单） | 不出现 | **不适用（不得拷贝，未拷贝）** |

---

## 2. 「不整体拷贝」前提审（item 2）→ PASS

检查方法：对 mpd 专属事实做全文扫描 + 人工逐段比对。

```bash
grep -n -i -E 'agent_teams|agent-teams|codegraph|workmate|ulw|hashline|boulder|modelchain|roster|install-profile|installer|VENDOR_LOCK|vendor|upstream|mpd-roles|dsh-qa|\.mpd/|mpd-bundle-plugin|client\.js' <silicon>/AGENTS.md
```

命中仅 3 处，全部为**合法内容**而非残留：

| 行 | 命中 | 判定 |
|---|---|---|
| :29 | 状态根 `.mpd/` 属命名契约 | 合法（本仓库同样使用 `.mpd/`） |
| :31-32 | "derived from the upstream project through `@mpd-dsh/mpd`" | 合法：provenance 归属声明（与 `README.md`/`LICENSE-NOTICES.md` 一致） |
| :145 | §6 "State belongs under the session workspace's `.mpd/`" | 合法：本仓库规则 |

**未出现**：agent_teams/codegraph/memory/workmate/ulw/hashline 行清单、25 包布局、VENDOR_LOCK/upstream 基线流程、mpd roster/installer 架构、`mpd-bundle-plugin`/`client.js`、`skills/dsh-qa`。结构上 9 章 ≠ 基线 13 章，段落顺序、措辞、示例均为本仓库重写（§1 讲 @mpd-dsh/silicon 的资产与关系、§3 的目录树是本仓库实际布局、§4 门禁全部是本仓库脚本、§9 是本仓库的三条已知限制）。**结论：适配版，不是复制件。**

---

## 3. 本仓库两条实测陷阱（item 3）→ PASS

| 陷阱 | 手册位置 | 手册写法 | 磁盘上的实测证据 |
|---|---|---|---|
| ① `dsh --profile X --help` **假绿** | §4 :99-104（独立小节 "`--help` is a FALSE GREEN"） | "exits **0** while printing nothing fatal, because its output happens *before* the plugin tree settles… 必须来自真实 app boot 的 exit code + stderr — measured, not inferred" | `evidence/verification/t7-install-boot.md:96`（"同一 profile 用 `dsh --profile coexist --help` 会 exit 0 且只打印 app help，两条致命错误完全不出现 → 判共存必须跑真实 app boot"）、`evidence/final-acceptance.md:20,75` |
| ② **row-id 零交集 ≠ 可共存** | §4 :106-119（独立小节 + 三类表） | 明确 `verify-rows-disjoint.mjs` 只比 loader row id，看不见 **service / tool / MCP serverName** 三类碰撞，并给出 three-class 症状表；"cheap offline pre-gate, not proof of coexistence" | 三条症状在真实启动日志中逐字存在：`service "mpdDsh" has been registered at <mpd-dsh-adapter>`（`boot-A-adapter-collision.log`）、`tool "mpd_verif_venv" is already registered`（`boot-G-verif-toolname-collision.log`）、`serverName "lsp" is already in use by another mcp-client instance`（`boot-B2-lsp-serverName-collision.log`）；门禁脚本本身只解析 `- id:`/`- insert:` |

**结论：两条都写到了，且不是"听说"——都有本仓库的实测出处。**

---

## 4. 事实真实性抽查（item 4）

### 4.1 路径/包名/row id 存在性（≥5 条，逐条给命令）

| # | 手册声明 | 命令 | 结果 |
|---|---|---|---|
| 1 | `packages/mpd-verif-plugin/`、`packages/mpd-silicon-bootstrap-plugin/`、`packages/mpd-dsh-adapter-plugin/`、`packages/mpd-bundle/cordis.patch.yml` | `test -e <p>` ×4 | 全部 EXISTS |
| 2 | `packages/mpd-mcp-lsp/references/…` | `test -e packages/mpd-mcp-lsp/references` | EXISTS |
| 3 | `presets/rtl-ip.profile.json` + README 契约 | `ls presets/` | `README.md`、`README.zh-CN.md`、`rtl-ip.profile.json` |
| 4 | `scripts/{build,pack-silicon,verify-corpus,verify-rows-disjoint}.mjs` | `ls scripts/` | 4 个均存在；**另有 `build-lsp.mjs`（手册未列，见 F10）** |
| 5 | `evidence/verification/corpus-baseline.json` | `python3` 解析 | `trees` 三棵 = 9+6+20 = **35 文件**（相对路径 → sha256），`generatedFrom.rev = 3d99718` |
| 6 | 三条 `silicon-*` row id（§6 声称 additive/zero id-target） | `grep -n 'id:' packages/mpd-bundle/cordis.patch.yml` | `silicon-dsh-adapter` / `silicon-bootstrap` / `silicon-verif`（`- insert:` 块）+ `silicon-mcp-lsp`；无 id-target |
| 7 | `mpd_verif_*` 8 工具名 | `grep -oh '"mpd_verif_[a-z_]*"' packages/mpd-verif-plugin/src/*.ts \| sort -u` | backends/compile/coverage/lint/regress/sim/uvm/venv（8/8，与手册 §1 一致） |
| 8 | §9 的冷校验 oracle `git archive 3d99718 skills/rtl-*` | `git -C <mpd> cat-file -t 3d99718`；`git archive … \| tar -t \| grep -v '/$' \| wc -l` | `commit`；**35** 文件（与手册"reconstructs all 35 files"一致） |

### 4.2 两条特别核对项

- **`skills/` 恰好三棵树**：`ls skills/` → `rtl-codestyle rtl-ip-flow rtl-verif`；门禁实跑 `node scripts/verify-corpus.mjs` → **exit 0**，`PASS — 10 check(s) passed, 3 skipped`，其中 3 个 skip 明确打印为「source checkout 中该树不存在（expected after the RTL strip）」。手册 :75-77 的说法与门禁行为一致（含"若要放 HDL 文档请去 `packages/mpd-mcp-lsp/references/`"的约束）。
- **单包布局相对 import 约束**：`grep -rn 'mpd-dsh-adapter-plugin/src/index' packages/*/src/*.ts` → 正好 3 处，全部是手册写的 `../../mpd-dsh-adapter-plugin/src/index`（bootstrap :18、verif :7、verif :20）。约束与代码一致。

### 4.3 手册 §4 门禁实跑（只读）

| 门禁（手册 :83-91） | 实跑 | 结果 |
|---|---|---|
| `bun test packages/` | ✅ | `131 pass / 0 fail / 845 expect / 12 files`，**1 skip 且可见**：`(skip) shipped RTL corpus > cross-check: byte-identical to the source checkout … (0/3 trees present)` |
| `node scripts/verify-corpus.mjs` | ✅ | exit 0，10 pass / 3 skip |
| `node scripts/verify-rows-disjoint.mjs` | ✅ | exit 0，`silicon ∩ mpd = ∅`（silicon 4 insert / 0 id-target；mpd 22） |
| `node scripts/pack-silicon.mjs --check` | ✅ | exit 0，`every committed file is readable by a non-root consumer` |
| `node scripts/pack-silicon.mjs --self-test` | ✅ | exit 0，负控（600→644、破坏包集合被抓）全部生效 |
| `node scripts/build-lsp.mjs --check`（**手册未列**） | ✅ | exit 0，`dist/cli.js sha256 04b49f8c… (235271 bytes) matches BUILD.lock, both HDL registry entries present, overlay anchor present` |

`--fix` / `Patch(Pack)` 会写文件，本评审未跑（只写本报告纪律）；两者脚本存在且 `--check` 可证当前树已合规。

---

## 5. Findings

| id | severity | problem（要点） | requiredFix |
|---|---|---|---|
| **T12-F1** | medium | **§4 门禁表缺 LSP 资产漂移门禁**：`scripts/build-lsp.mjs --check`（BUILD.lock 的 sha256+字节数、overlay 漂移锚点、两个 HDL 注册项、参考文档/fixtures 齐备）是基线 §4 "Vendor" 行在本仓库的等价物，却完全不在表内；`packages/mpd-mcp-lsp/dist/cli.js`（235 KB 离线构建物）是本仓库最易静默漂移的资产。§3 的 `scripts/` 行也漏列该脚本（磁盘存在）。 | §4 增行：`LSP assets \| node scripts/build-lsp.mjs --check \| any packages/mpd-mcp-lsp or overlay change; before release`；§3 补 `build-lsp.mjs`；建议在 package.json 加 `verify:lsp` 别名并纳入门禁表命令。 |
| **T12-F2** | medium | **Tests 门禁少了 typecheck**：基线 Tests = `bun test`（每包）+ `bun run typecheck`（根）；新手册只有 `bun test packages/`。本仓库带 `tsconfig.json`（`strict: true`，include `packages/*/src` + `packages/*/test`）但无 typecheck 脚本、无任何类型门禁——`bun test` 只转译不检查类型，类型错误可静默进入 `dist/`（`dist/` 随包提交）。 | 二选一：① 加类型门禁（引入 `typescript` devDependency + `verify:types` script，或 `bunx tsc --noEmit -p tsconfig.json`），并写入 §4 Tests 行；② 若刻意不设类型门禁，必须在 §4/§9 显式记录该取舍与理由。 |
| **T12-F3** | medium | **自检门禁范围被收窄为仅 packer**：基线有独立一行 `QA self-tests \| bun run test:qa (all --self-test) \| every plugin/QA-script change`；新手册只有 `Guard self-test \| node scripts/pack-silicon.mjs --self-test`。本仓库实际有 4 个带负控的 guard（pack-silicon、verify-corpus、verify-rows-disjoint、build-lsp），后三者的自检在手册中无要求（`package.json` 已暴露 `verify:rows:self`）。 | 该行改为「每个 guard 的 `--self-test` 在其脚本改动时必须跑」，或新增 `All guard self-tests` 行并列出 4 条命令（可为 corpus/LSP 补 script 别名）。 |
| **T12-F4** | low | **门禁表无 "QA real cases" 行、也无跨仓指针**：基线的运行时行为用例行（`skills/dsh-qa/scripts/<case>.mjs`）在硅侧落空；两个 RTL 用例按 t19 已重定向到本 bundle（`evidence/verification/t19-qa-repoint.md`），但手册完全没提，运行时行为只剩 Boot check 一句。 | §4 增一行/一句指向跨仓用例（`<mpd>/skills/dsh-qa/scripts/rtl-verif.mjs`、`rtl-ip-profile.mjs`，注明隔离 `DSH_HOME` 运行），或显式声明该职责仍属 mpd 仓并给出入口。 |
| **T12-F5** | medium | **git 模型收窄**：基线 §5 有 5 行分支表（含 `release/vX.Y.Z`）、commit 格式 `<type>(<scope>): <summary>`、"Never rebase published branches; merge with `--no-ff`"；新手册只剩 4 行 + atomic 规则。而本仓库实际提交已经遵循该格式（`feat(lsp): …`、`docs(evidence): …`、`evidence(review): …`），且首次推 Gitee 在即。 | §5 补 commit 格式行与 "never rebase published branches / merge `--no-ff`"；`release/*` 要么补行，要么写明当前不采用及启用条件。 |
| **T12-F6** | medium | **语言政策范围窄于基线且缺豁免条款，与本仓库现状不自洽**：(a) 基线覆盖 `README.md` + `docs/*.md` + **每个 `packages/*/README.md`**，新手册漏掉后者——而仓库里 4 个包已各有 `README.md` + `README.zh-CN.md`（含切换链接），实践比政策更严；(b) 基线显式豁免 process records / 内部 QA 参考文档（`docs/adder4.md`、`docs/cnt8.md`），新手册无豁免条款，而这两份正是英文单语（CJK 行数 = 0）、且 `docs/adder4.md:3-4` **自我声明** "exempt from the bilingual policy (see AGENTS.md Language Policy + §3)" ——引用的规则在手册中不存在（悬空引用）；`docs/sync-policy.md` 是"单文件双语"（无 `*.zh-CN.md` 对文件，只有页内 `[中文](#中文版)` 锚点）。按手册字面这三份文档均违反政策。 | 语言政策改为与基线等价：把 `packages/*/README.md` 纳入双语范围；补豁免句（process records 与内部 QA/golden 参考文档豁免；单文件双语等价于双语对但需标题下语言锚点），使政策、文档自述与仓库现状三者一致。 |
| **T12-F7** | medium | **§6 插件编写规范相对基线大面积收窄，且未指向任何在仓的权威细节来源**：新手册 5 条保留了「经 adapter／插件形状／不写 harness home／补丁 additive 无 id-target／provider 名唯一」，但基线 §6 中仍适用于本仓库的**工具注册契约**（object-rooted `parameters`、默认 `output.render` 文本块、`(args, exec)`、`exec.signal`）、**guard / waterfall / subagent / 内部工具调用**（禁直连 `ctx.tools.*`）、**能力探测**（缺 seam 降级告警而非 abort）、**状态根优先级**（`dsh.workspaceRoot(exec)`：session cwd → `DSH_WORKSPACE_ROOT` → `process.cwd()`，按调用解析、禁模块级缓存/`chdir`/由 row 设 env）、**build 命令与零运行期依赖**全部缺失——而 `mpd-verif-plugin` 正注册 8 个工具并写工作目录。手册也未指向 `packages/mpd-dsh-adapter-plugin/README.md`。 | §6 增补上述适用条款（最省的做法是指向 adapter README 并同时修好其陈旧引用），至少写入「状态根按调用解析、禁模块级缓存」与「工具 schema/render 契约」两条。 |
| **T12-F8** | medium | **§1 把本 bundle 说成 "sub-plugin of `@mpd-dsh/mpd` — installed alongside it"**，与 `README.md:8`「usable **on its own**, with no `@mpd-dsh/mpd` on disk」、`package.json` description「installable on its own」以及 t7 §1 的隔离安装 PASS 冲突；手册是 binding（"where this document and habit disagree, this document wins"），且 t3 已明确否决「硬依赖 mpd 服务」方案（S2）。 | 改为与 README 一致：本仓库是可独立安装的 RTL **sub-bundle**，设计上与 `@mpd-dsh/mpd` 共存但**不依赖**它；把共存脆弱点指向 §4/§9。 |
| **T12-F9** | low | **§9 交叉引用不成立 + 术语混用**：§9 第三条写 "require the `silicon-bundle`/`mpdDsh` **service-name** split **described in §4**"——① §4 并未描述该 split（只有 collision 类别表）；② split 的真实形态是 service 名 `siliconDsh`（`packages/mpd-dsh-adapter-plugin/src/index.ts:446`）与两处回退解析 `ctx.get("siliconDsh") ?? ctx.get("mpdDsh")`（verif `src/index.ts:35`、bootstrap `src/index.ts:348`），而 `silicon-bundle` 是 **skill provider 名**，不是 service 名；③ §4 的 `service "mpdDsh" has been registered` 症状是 split 之前的实测（t3 日志），今日两 bundle 已不在该名上相撞。 | §9 改写为「service 名 split：silicon 侧提供 `siliconDsh`，缺失时回退 `mpdDsh`」；§4 增一句区分「service 名单例（siliconDsh/mpdDsh）」与「provider 名全局唯一（`silicon-bundle`）」，并把症状表标注为 split 前的历史测量。 |
| **T12-F10** | low | **§3 布局清单漏列 `tests/` 与 `scripts/build-lsp.mjs`**：磁盘上存在顶层 `tests/golden/fixtures/verilog/*`（被 `skills/rtl-verif/fixtures/*/Makefile` 的 `RTL_DIR ?= ../../../../tests/golden/fixtures/verilog/modules` 引用），`scripts/` 下有 5 个脚本而手册只列 4 个。 | §3 补 `tests/`（golden fixtures，说明被 rtl-verif fixtures 引用）与 `build-lsp.mjs`；若有意精简，请注明该清单非穷尽。 |

**相关观察（不在评审对象内，但会削弱 F7 的修复方案）**：`packages/mpd-dsh-adapter-plugin/README.md` 仍是 mpd 版逐字副本——:30 指向本仓库不存在的 `packages/mpd-agent-teams-plugin`、:44 import `@mpd-dsh/mpd/packages/...`、:47/:56 仍写 `ctx.get("mpdDsh")`（现为 `siliconDsh`，row id 已改 `silicon-dsh-adapter`）。因此"细节看 adapter README"目前不成立，建议随 F7 一并修复（另一任务亦可）。

---

## 6. 复现命令

```bash
SIL=/root/dshProj/my-power-dsh-silicon; MPD=/root/dshProj/my-power-dsh
sha256sum $SIL/AGENTS.md $MPD/AGENTS.md                    # ba459f5b… / 0c7e543e…
grep -n '^## ' $MPD/AGENTS.md $SIL/AGENTS.md               # 13 章 vs 9 章

# item 2 残留扫描
grep -n -i -E 'agent_teams|codegraph|workmate|ulw|hashline|VENDOR_LOCK|roster|installer|mpd-bundle-plugin' $SIL/AGENTS.md

# item 3 两条陷阱（手册位置 + 实测证据）
sed -n '93,125p' $SIL/AGENTS.md
grep -rn -- '--help' $SIL/evidence/verification/t7-install-boot.md $SIL/evidence/final-acceptance.md
grep -rho 'service "mpdDsh" has been registered[^"]*\|tool "mpd_verif_venv" is already registered\|serverName "lsp" is already in use[^"]*' $SIL/evidence/t3-loader-semantics/coexistence-raw/*.log

# item 4 事实核对
ls $SIL/skills/ && ls $SIL/packages/ && ls $SIL/scripts/ && ls $SIL/presets/
grep -rn 'mpd-dsh-adapter-plugin/src/index' $SIL/packages/*/src/*.ts
grep -n 'id:\|insert:' $SIL/packages/mpd-bundle/cordis.patch.yml
git -C $MPD archive 3d99718 skills/rtl-ip-flow skills/rtl-codestyle skills/rtl-verif | tar -t | grep -v '/$' | wc -l   # 35

# 门禁实跑（全部只读）
cd $SIL && bun test packages/
cd $SIL && node scripts/verify-corpus.mjs ; echo $?
cd $SIL && node scripts/verify-rows-disjoint.mjs ; echo $?
cd $SIL && node scripts/pack-silicon.mjs --check ; echo $?
cd $SIL && node scripts/pack-silicon.mjs --self-test ; echo $?
cd $SIL && node scripts/build-lsp.mjs --check ; echo $?     # 手册未列，F1
grep -n 'workspaceRoot' $SIL/packages/mpd-dsh-adapter-plugin/README.md   # F7 相关
```

---

## 7. 局限

- 评审未重新测量 `--help` 假绿（重测需在隔离 `DSH_HOME`/`HOME`/workspace 里装配 profile 并触发真实插件树失败）；本报告引用 t7 的实测记录与其日志。
- `pack-silicon.mjs --fix` 与 `Pack`（默认模式）会写文件，未执行；只跑 `--check`/`--self-test`。本评审唯一写入是 `evidence/review/t12-manual-review.md`。
- 基线 §6 的 mpd 专属大段（adopted agent-teams 的 A1-A6/D1-D8 清单）按"不得整体拷贝"原则**不建议**搬入本仓库，本报告只把其中对本仓库适用的通用条款计为缺失项。
