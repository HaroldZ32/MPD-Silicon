# t8 — 移植契约独立评审（t1 / t2 / t4 判定 + t6 报告抽检 + 盲区排查）

**Task:** t8 · **Attempt:** d80541dc-4268-4055-bb3e-6d2dce52ca7e · **Reviewer:** Reviewer（未参与 t1/t2/t4/t6 任何一件产物的编写）
**Verdict: `needs_revision`** — 8 findings（1 blocker / 3 high / 3 medium / 1 low）；t1 与 t4 的验收项未全数成立，t6 报告有 1 条子结论不可复现。
**只读纪律：**本报告是本任务唯一写入（`evidence/review/t8-port-review.md`）。源工程 `/root/dshProj/my-power-dsh/` 未被本审查者改动（只读命令 + `/tmp` 沙箱）。

---

## 0. 审查时的仓库状态（重要前提）

评审期间 **t5 正在执行**，源工程的 RTL 面已被 `git rm --cached`/删除到工作树（`git status --porcelain` = 73 行，全部为 `D`，**尚未提交**）：

- `packages/mpd-verif-plugin/` 已从源工程工作树消失；
- `skills/{rtl-ip-flow,rtl-codestyle,rtl-verif}` 已从源工程工作树消失；
- 源工程 HEAD 仍是 `3d99718`（含全部 RTL 面），`git ls-tree -r HEAD -- skills | wc -l` = **366**。

因此本评审对"移植保真"类判据一律**双通道取证**：① 工作树 diff（在删除发生前完成）；② `git show/archive HEAD:<path>` 历史取证（删除后仍可复现）。两者结论一致。

---

## 1. 判定台账：t1 / t2 / t4 契约验收项逐条判定

判据只认命令输出；"实现者说做了"不作为通过依据。

### t1 — 移植核心（adapter 副本 + mpd-verif 插件 + skill provider 插件）

| # | 契约验收项 | 判定 | 证据（本审查者复跑） |
|---|---|---|---|
| 1.1 | verif `src` 逐字一致（diff 为空）、两处 adapter import 可解析 | **pass** | `for f in packages/mpd-verif-plugin/src/*.ts; do diff -q <SRC>/…/$f $f; done` → 13 文件 / differing 0；`git show HEAD:… \| diff -` → **14/14** 与提交版本一致。契约写"12 个"实际 13 个（多 `wave.ts`），目录整体复制、无缺件 → 非缺陷（t6 N1 已裁定，本审查者同意） |
| 1.2 | adapter `src/index.ts` 逐字一致 | **pass** | `diff -q` 无输出；sha256 双侧 `7045c6527dfd8dfb…` |
| 1.3 | bootstrap 注册 `silicon-bundle` / rank 600 / `<pkg-root>/skills`，无 preset/legacy 逻辑 | **pass** | 独立探针（驱动**被交付的** `src/index.ts` + 真实语料）：`provider.name=silicon-bundle`、`BUNDLED_SKILL_RANK=600`、root 存在、3 个 skill 均 `rank=600/source=bundled/description 非空`、`warns=0`；`grep -E 'preset\|homedir\|DSH_HOME\|rmSync\|cleanLegacy\|mpd-bundle'` 仅命中注释行（第 10-11 行），有效代码无命中 |
| 1.4 | `bun test packages/` 全绿且 ≥78 用例、无新增 skip | **pass** | `106 pass / 0 fail / 742 expect() calls / Ran 106 tests across 11 files`；skip/only/todo 全仓 0 命中；verif 侧 78 test(/326 expect( 与源工程逐字相同 |
| 1.5 | `bun build` 产出 dist，可 `import()` 并导出 name/apply | **pass** | 在 `/tmp/t8-build` 副本执行仓库自身 `node scripts/build.mjs` → 三份 dist 与随包 dist **逐字节相同**（adapter `2d84f75c…` / verif `1766b604…` / bootstrap `44268603…`）；`node --input-type=module -e import()` → `mpd-verif` / `mpd-silicon-bootstrap`，`apply` 均为 function |
| 1.6 | 8 个 `mpd_verif_*` 工具名不变 | **pass** | 四处（silicon src/dist、源 src/dist）名称集合完全一致：backends/compile/coverage/lint/regress/sim/uvm/venv |

> t1 的 6 项验收全部成立。**但**其交付目录 `packages/mpd-dsh-adapter-plugin/` 少带了源包的 `test/adapter.test.ts` + 两份 README（见 F5）——验收项未要求，故记在盲区而非判 fail。

### t2 — RTL 语料移植 + skill 可加载性 + 语料自检脚本

| # | 契约验收项 | 判定 | 证据 |
|---|---|---|---|
| 2.1 | 三棵目录与源工程逐字节一致（含全部模板/参考/fixtures/README） | **pass** | 源工作树已删 → 用 `git -C <SRC> archive HEAD skills/rtl-* \| tar -x` 复原后比对：`rtl-ip-flow MATCH 9 files 5b706507…`、`rtl-codestyle MATCH 6 files a8fdcc59…`、`rtl-verif MATCH 20 files bd1247a4…`；字节数 32869/23851/35257 双侧相同，合计 35 文件 |
| 2.2 | `skills.test.ts` 逐个解析 3 个 SKILL.md，断言 name 正则 + description 非空 | **pass（但已静默降级，见 F2）** | 文件存在且 10 tests 全绿；**不过**第 100 行 `if (!existsSync(SOURCE_SKILLS/tree)) continue` 使"与源逐字节"分支在源语料删除后整体跳过 |
| 2.3 | `verify-corpus.mjs --self-test`（离线）断言语料齐备、≥35 文件、无 mpd 通用语料 | **fail** | `cd <SILICON> && node scripts/verify-corpus.mjs` → **exit 1**，3 条 FAIL（三棵树 "file list differs from source"），且 `--self-test` 额外报 `tampered-byte control was NOT caught`、`exit 1`。原因与修法见 **F1** |
| 2.4 | 落在 provider 子集外的 SKILL.md 必须修正且逐条列出 | **pass** | 三条 SKILL.md 均在子集内；语料与源逐字节一致 → 修正 0 条属实（t6 与我的 diff 均支持） |
| 2.5 | `bun test packages/` 全绿（含新增测试） | **pass** | 106 pass / 0 fail（见 1.4） |

### t4 — 剥离资产映射与同步策略文档

| # | 契约验收项 | 判定 | 证据 |
|---|---|---|---|
| 4.1 | 两份 dependency-map 逐项列出 7 类资产（源位置→新位置→依赖耦合→验证方式） | **pass** | A1…A7 + S1…S3 表齐备；A6/A7/A5 明确标 `pending (unassigned)`，未把未落地写成已落地 |
| 4.2 | `sync-policy.md` 写明权威归属（Gitee 唯一权威源、mpd 不再承载 RTL）与同步原则 | **pass** | §1 权威归属、§2 五条变更规则、§3 行 id 硬约束（明确"row 离散 ≠ 可共存"）、§4 VENDOR_LOCK 同提交重钉、§5/§6 保留与不可协商项 |
| 4.3 | 文档中所有路径引用指向真实存在的文件，无悬挂引用 | **fail（t5 落地后）** | 导出依赖：`<SRC>/packages/mpd-verif-plugin/`、`<SRC>/skills/rtl-*` 在工作树**已不存在**（t5 staged）；文档第 18 行"Every path below was checked to exist (`test -e`)"与 §3 台账第 1 条（第 72 行）"every path in §1 exists" 在评审当时已不成立；A1/A2 行未标注源侧已删除 → **F3** |
| 4.4 | 文档不出现 token/凭据/绝对 home 路径 | **pass** | `grep -n '/root\|/home/\|~/\|password\|Bearer \|api[_-]key\|secret[=:]' docs/*.md` → CLEAN（三份文档用 `<SRC_ROOT>` + 环境变量间接引用） |

### 汇总

- **t1：6/6 pass**（另见 F5 的目录完整性缺口）
- **t2：4/5 pass，1 fail**（2.3 语料门禁在剥离后 exit 1）
- **t4：3/4 pass，1 fail**（4.3 源侧引用在 t5 落地后失效 + S1 行事实错误，见 F3）

---

## 2. t6 报告抽检（复跑 ≥3 条关键命令）

抽检对象：`evidence/verification/t6-port-fidelity.md`（sha256 前缀 `c96dd5f3…`，本次未改动）。

| 抽检项 | t6 结论 | 本审查者复跑 | 一致性 |
|---|---|---|---|
| §1 逐文件保真 | 13 verif + 1 adapter differing=0；对 `HEAD` 复检 14/14 | 工作树 diff：`differing: 0`；`git show HEAD` 通道：`files matching committed content: 14 / 14`（rev 3d99718） | **一致** |
| §2 `bun test packages/` | 106 pass / 0 fail / 742 expect / 11 files | 同上，逐字一致 | **一致** |
| §2 "独立源基线（拷两个包）" | **78 pass / 414 expect / 9 files** | 照抄其命令（`cp -a` 两个包 → `bun test`）得 **100 pass / 474 expect / 10 files** | **不一致 → F6** |
| §3 8 个工具名 | 四处集合一致、每名 1 次 | 四处集合一致；silicon src+dist 合计每名 2 次（各 1 次） | **一致** |
| §4 provider | silicon-bundle / 600 / bundled / 0 warns / 3 skills | 独立探针复现，逐项一致 | **一致** |
| §5 语料 | 3 树 35 文件 91977 B，聚合 sha256 匹配 | 用 git archive 复原后三树 MATCH，字节数一致 | **一致** |
| §6 dist/src 同步 | 3/3 重建逐字节相同 | `/tmp/t8-build` 内 `node scripts/build.mjs` → 3/3 与随包 dist 相同（`2d84f75c…`/`1766b604…`/`44268603…`） | **一致** |
| §9 `siliconDsh` 未落地 | grep 0 命中，三个锚点仍是 `mpdDsh` | `grep -rn siliconDsh packages/*/src packages/*/dist` → **0**；`SERVICE_NAME = "mpdDsh"`（adapter src:446）、两处 `ctx.get("mpdDsh")`（verif src:35、bootstrap src:348） | **一致** |

**t6 抽检结论：** 6/8 项完全复现；1 项（§2 基线）命令与数字不匹配（F6）；§2 的"测试面无损失"结论因未计入 adapter 测试而不完整（F5）。§9 的诚实披露（批准的偏离尚未落地）与事实相符，值得肯定。

---

## 3. Findings（按严重度排序）

### F1 — blocker｜语料门禁 `verify-corpus.mjs` 在剥离完成后必然 exit 1（含 self-test 假失败）

- **问题：** `scripts/verify-corpus.mjs` 的 fidelity 检查以**源工程工作树**为基线；其对"源不存在"的优雅降级判定过粗（只在 `<SRC_ROOT>/skills` 整个目录消失时跳过），而迁移的终点恰恰是"三棵 RTL 子树消失、`skills/` 仍在（331 文件）"。于是新仓库自己的门禁在迁移终点 **exit 1**：
  ```
  cd /root/dshProj/my-power-dsh-silicon && node scripts/verify-corpus.mjs ; echo $?
  → FAIL rtl-ip-flow: file list differs from source (only here: [全部 9 文件]; only there: [])
  → FAIL rtl-codestyle / FAIL rtl-verif
  → [verify-corpus] FAIL — 3 problem(s)   exit=1
  ```
  `--self-test` 同时报 `tampered-byte control was NOT caught`（控制组 4 依赖同一源基线，见 `scripts/verify-corpus.mjs:279-284`）→ **负向控制失效**，self-test 也 exit 1。
  影响面：① t2 契约 verify 命令 3 与验收项 2.3 现在不成立；② `docs/dependency-map.md` §3 台账第 3 条（第 74 行）与 `docs/sync-policy.md:49` 把该命令当作门禁背书；③ t10 集成收尾在克隆检出上跑门禁会失败。
- **文件/行：** `scripts/verify-corpus.mjs:34`（`SOURCE_ROOT`）、`:144-159`（`checkFidelity`）、`:279-284`（self-test 控制组）
- **requiredFix：** 把"源基线与新仓库同列"改为**自持基线**：在仓库内提交语料清单（相对路径 + 每文件 sha256）作为 fidelity 基线；源检出可选（`MPD_SOURCE_SKILLS` 存在时做额外交叉校验）。至少把"**逐棵树**不存在"当作 `skip`（并把 skip 计数打印出来，不得静默），同时让 tampered-byte 控制组跑在自持基线上。

### F2 — high｜新增的语料测试在源语料消失后**静默自废** 38 条断言（仍报绿）

- **问题：** `packages/mpd-silicon-bootstrap-plugin/test/skills.test.ts:8` 硬编码机器路径 `/root/dshProj/my-power-dsh/skills`；`:100` 在源树缺席时 `continue`。A/B 实测（把测试指向 git 归档的源语料 vs 指向不存在的路径，其余完全相同）：
  ```
  A) 源语料在场: 0 fail | 234 expect() calls | Ran 10 tests
  B) 源语料缺席: 0 fail | 196 expect() calls | Ran 10 tests    ← 当前仓库的真实状态
  ```
  → 当前 `bun test packages/` 的 742 expect 中，已有 **38 条保真断言被静默跳过**，套件仍然全绿。这既是"测试被削弱"的实证，也让"35 文件逐字节保真"在新仓库里失去持续守护。
- **文件/行：** `packages/mpd-silicon-bootstrap-plugin/test/skills.test.ts:8`、`:96-107`（`:100` 的 continue）
- **requiredFix：** 与 F1 共用自持基线（清单+sha256）来断言保真，彻底移除对源检出的依赖；若保留源交叉校验，则缺席时必须显式 `test.skip`（可见计数）或在报告里打印 skip，不得 `continue` 静默通过。

### F3 — high｜文档 S1 行把"尚未落地的 SERVICE_NAME 改名"写成已落地；A1/A2 源侧引用已失效

- **问题（a）事实错误：** `docs/dependency-map.md:44`（S1 行）状态写 `landed (one approved divergence)`，耦合列写 "Copied byte-for-byte **except** the captain-approved `SERVICE_NAME` rename (`mpdDsh` → `siliconDsh`) and the matching resolver chains"。但实测改名**不存在**：`grep -rn siliconDsh packages/*/src packages/*/dist` → 0 命中；`SERVICE_NAME = "mpdDsh"`（`packages/mpd-dsh-adapter-plugin/src/index.ts:446`），两处解析缝仍是 `ctx.get("mpdDsh") ?? createDshAdapter(ctx)`（verif `src/index.ts:35`、bootstrap `src/index.ts:348`）。t7 的在飞台账 §4.3 变体 V2 独立证明：即使 t5 之后（mpd-verif 行移除），双 bundle 挂载仍因 `service "mpdDsh" has been registered` 致命。**文档目前会让读者以为共存问题已解决。**
- **问题（b）悬挂：** `docs/dependency-map.md:18` 与 §3 台账 `:72` 声称 §1 全部路径存在；但 A1（`<SRC>/packages/mpd-verif-plugin/`）、A2（`<SRC>/skills/rtl-*`）的源侧路径在 t5 staged 之后已消失，行内未标注"已移出/历史位置"，与文档自己的规则（`:116-117`"路径失效即视为文档过期，须在同一次变更中更新"）冲突。
- **文件/行：** `docs/dependency-map.md:18, 32-33, 44, 72, 116-117`
- **requiredFix：** ① S1 行改为"rename **pending**（S1 方案已批准、尚未落地）"，并把 `mpdDsh` 值/两处锚点行号写清；② A1/A2 源位置列标注 `removed by t5 @ rev 3d99718`（或"历史位置，用 `git show 3d99718:<path>` 取证"），台账第 1 条同步改写；③ 由 t5 落地后的下一次文档提交统一刷新（需要 captain 指派 owner，见 §6 行动项 4）。

### F4 — high｜源工程门禁在 t5 当前改动下无法"全绿"（VENDOR_LOCK 漂移 + 两个 RTL QA 用例失败）

- **实测（只读，未改源工程）：**
  ```
  node scripts/verify-vendor.mjs
   → FAIL - asset skills count drifted: 331 vs 366
   → FAIL - asset skills treeSha mismatch            exit=1
  node scripts/verify-rows-parity.mjs → ok: 21 row ids … exit=0
  node skills/dsh-qa/scripts/rtl-ip-profile.mjs --self-test → FAIL: rtl-ip profile missing in bundle patch  exit=1
  node skills/dsh-qa/scripts/rtl-verif.mjs   --self-test → FAIL: cordis.patch.yml must ship exactly one ACTIVE mpd-verif row  exit=1
  ```
  `package.json` 的 `test:qa` 是 `for f in skills/dsh-qa/scripts/*.mjs … || exit 1`，因此这两个用例保留即等于 `npm run test:qa` 失败。
  VENDOR_LOCK 数字：`assets.skills = {fileCount: 366, treeSha: 3259d07a…c00621}`，`git ls-tree -r HEAD -- skills | wc -l = 366`（锁定值对应 HEAD）；工作树删掉 35 个 RTL 文件后 = 331 / `6065ccbd…`。
- **与既有契约/文档的冲突：** t5 原验收要求 `verify-vendor`、`test:qa` exit 0；`docs/sync-policy.md:76-79` 与 `dependency-map.md:46` 都写明"删除 RTL 三棵树时必须在**同一次提交**里重钉 `assets.skills` 指纹"，而 t5 的重派说明为"不碰 VENDOR_LOCK、保留三个 QA 脚本"。三条无法同时成立。
- **requiredFix（二选一，需 captain 裁决）：** ① 在同一次提交内重钉 `VENDOR_LOCK.assets.skills`（用 `verify-vendor` 实际输出回填）并把两个 RTL QA 用例改为指向 silicon bundle 或迁移期内标记为 known-stale；② 显式修改 t5 的验收（豁免 `verify-vendor` / `test:qa`），并记录豁免理由与后续 owner。**当前状态下 t5 无法按其契约验收。**

### F5 — medium｜adapter 包移植不完整：源包 22 个测试 + 2 份 README 未随移植

- **问题：** 源 `packages/mpd-dsh-adapter-plugin/` 含 `test/adapter.test.ts`（22 tests / 60 expect，仅 `import { … } from "../src/index"`）、`README.md`、`README.zh-CN.md`；新仓库同目录只有 `src/`、`dist/`、`package.json`。把源测试原样拷到新仓库 adapter 副本的 `/tmp` 沙箱里运行：**22 pass / 0 fail / 60 expect** → 测试可原样通过，属"可带而未带"。adapter 是 bundle 与 harness 的唯一接触面（`registerProvider` 唯一调用点 `src/index.ts:411`），在新仓库里目前**零测试**。
- **文件/行：** `packages/mpd-dsh-adapter-plugin/`（缺 `test/adapter.test.ts`、`README.md`、`README.zh-CN.md`）；对照源 `<SRC>/packages/mpd-dsh-adapter-plugin/`
- **requiredFix：** 在 t1 范围内补移该测试与两份 README（并纳入 `bun test packages/`，用例数将从 106 → 128）；或由 captain 显式记录"adapter 测试不随迁"的取舍与替代守护。

### F6 — medium｜t6 §2"独立源基线"命令与数字不匹配，且掩盖了 F5 的测试面损失

- **问题：** t6 报告命令列写 "copy `<SRC_ROOT>/packages/{mpd-verif-plugin,mpd-dsh-adapter-plugin}` to a scratch dir, `bun test` there"，观察值写 `78 pass / 414 expect / 9 files`。照抄执行得 **100 pass / 474 expect / 10 files**（verif 78/414/9 + adapter 22/60/1）。即：报告里的 78 是**仅 verif 包**的数字；"移植后测试面无损失"的结论因此没有覆盖 adapter 套件（F5）。
- **文件/行：** `evidence/verification/t6-port-fidelity.md:78`（§2 第二行）
- **requiredFix：** 更正为"verif 包基线 78/414/9"，并补记 adapter 源包另有 22/60 未随迁（引用 F5），或把该命令与输出改写成真实可复现的形式。

### F7 — medium｜新仓库自身违反 sync-policy §6：交付脚本/测试/文档硬编码机器绝对路径

- **问题：** `docs/sync-policy.md` §6（中文半 §6，第 184-185 行）明令"两个仓库都不得提交…与机器绑定的绝对家目录路径…不要硬编码位置"，但本仓库多处硬编码 `/root/dshProj/my-power-dsh`：
  - `scripts/verify-rows-disjoint.mjs:40` — `join("/root/dshProj", "my-power-dsh", …)`，**无任何环境变量覆盖**；换机器/换检出位置即 `exit 2`（门禁不可跑）；
  - `scripts/verify-corpus.mjs:34` — 默认值硬编码（有 `MPD_SOURCE_SKILLS` 覆盖，可接受但不符政策）；
  - `packages/mpd-silicon-bootstrap-plugin/test/skills.test.ts:8` — 硬编码（见 F2）；
  - `README.md:142`、`README.zh-CN.md:102`、`presets/README.md:33`、`presets/README.zh-CN.md:29`。
  （`docs/*.md` 三份由 t4 产出的文档本身是干净的，用 `<SRC_ROOT>`；这一点应予肯定。）
- **requiredFix：** 统一改为 `MPD_SOURCE_ROOT` 优先、兄弟目录 `../my-power-dsh` 兜底的解析（与 `docs/dependency-map.md:13-15` 的既有约定一致），README 类文案改用 `<SRC_ROOT>`；`verify-rows-disjoint.mjs` 至少要有 env 覆盖与 exit 2 的清晰提示。

### F8 — low｜LICENSE-NOTICES 未列 Erie/verilog-generator 风格出处

- **问题：** `LICENSE-NOTICES.md` 覆盖了语料、verif 插件（gen-tb-skill 结构 / raysalemi-uvmprimer 模式声明）、adapter、外部工具；但 `skills/rtl-codestyle/SKILL.md:9-10` 明确以 `github.com/Eriemon/verilog-generator`（Erie 规则集）为风格依据，notices 未提。LICENSE.md 与源工程逐字节相同，仍保留祖先项目 "oh-my-opencode" 措辞（沿袭源仓库，非本次引入）。
- **requiredFix：** 在 LICENSE-NOTICES.md 的语料段补一行 Erie/verilog-generator 风格出处（声明仅风格参考、未复用代码），保持与 SKILL.md 自述一致。

---

## 4. 已独立确认的正面结论（判定依据的一部分）

1. **保真：** verif `src` 13/13、`test` 整目录、两份 README、adapter `src/index.ts` 全部逐字节一致（工作树 + `HEAD 3d99718` 双通道）；新仓库无任何 `mpd-verif-plugin` 源码改写。
2. **工具面：** 8 个 `mpd_verif_*` 工具名在 silicon src/dist 与源 src/dist 四处集合一致、各出现 1 次；`import()` 装载 `mpd-verif` / `mpd-silicon-bootstrap` 成功（`apply` 为 function、14 个导出）。
3. **语料面：** 35 文件 / 91977 B 与源（git 归档）逐树聚合 sha256 相等；`skills/` 下恰为三棵 RTL 树，无 mpd 通用语料混入（`verify-corpus` 的形状/清单/卫生/可加载性检查仍全部 PASS——只有源基线项失败，见 F1）。
4. **构建一致性：** 仓库自带 `scripts/build.mjs` 在 `/tmp` 副本重建，三份 dist 与随包 dist **逐字节相同**；dist 内无 `/root/...` 绝对路径、无 `my-power-dsh` 字符串。
5. **bootstrap 语义：** provider 名 `silicon-bundle`、rank 600、source `bundled`、语料根 `<bundle-root>/skills`；不含 preset / legacy home 清理逻辑（仅注释提及）；与 mpd 的 `mpd-bundle` 不重名。
6. **打包载荷：** `dist/silicon-package/` 的三份 dist 与 `skills/` 与当前仓库源码逐字节一致（t3 生成物未漂移）。
7. **文档卫生：** `docs/*.md` 无绝对家目录/凭据/token（t4 的 4.4 成立）。
8. **t6 诚实披露：** §9 明确记录"批准的偏离尚未落地"并给出复检判据——本次实测与之相符，未发现"报告说 pass 但实际 fail"的伪造项。

---

## 5. 复现命令（全部只读，除 /tmp 沙箱）

```bash
SIL=/root/dshProj/my-power-dsh-silicon; SRC=/root/dshProj/my-power-dsh

# F1/F2 —— 门禁现状（这是 blocker 的直接复现）
cd $SIL && node scripts/verify-corpus.mjs; echo "exit=$?"            # → 3 FAIL / exit 1
cd $SIL && node scripts/verify-corpus.mjs --self-test; echo "exit=$?" # → 另加 tampered-byte 控制失败

# 1.1/1.2 —— 保真（源工作树 + git 历史双通道）
for f in $SIL/packages/mpd-verif-plugin/src/*.ts; do diff -q $SRC/packages/mpd-verif-plugin/src/$(basename $f) $f; done
diff -q $SRC/packages/mpd-dsh-adapter-plugin/src/index.ts $SIL/packages/mpd-dsh-adapter-plugin/src/index.ts
git -C $SRC show HEAD:packages/mpd-verif-plugin/src/index.ts | diff -q - $SIL/packages/mpd-verif-plugin/src/index.ts

# 1.4 —— 测试与断言密度
cd $SIL && bun test packages/                                       # 106 pass / 742 expect / 11 files
cd /tmp/t8-srcbase && bun test                                      # 源两包基线：100 pass / 474 expect / 10 files（t6 写 78 → F6）

# 2.1/2.4 —— 语料保真（源已删除 → git 归档）
mkdir -p /tmp/t8-gitskills && cd /tmp/t8-gitskills && git -C $SRC archive HEAD skills/rtl-ip-flow skills/rtl-codestyle skills/rtl-verif | tar -x
for t in rtl-ip-flow rtl-codestyle rtl-verif; do (cd skills/$t && find . -type f | sort | xargs sha256sum | sha256sum); (cd $SIL/skills/$t && find . -type f | sort | xargs sha256sum | sha256sum); done

# 1.3/1.5 —— provider 探针与 dist 同步
cd $SIL && bun -e 'import * as m from "./packages/mpd-silicon-bootstrap-plugin/src/index.ts"; const p=m.createProvider(m.bundleRoot()+"/skills",{skills:{},logger:{warn(){},info(){},debug(){}},on(){return()=>{}}},()=>{}); console.log(p.name, m.BUNDLED_SKILL_RANK, (await p.list()).map(s=>s.name+":"+s.rank+":"+s.source).join("|"))'
cp -a $SIL/package.json $SIL/tsconfig.json $SIL/scripts /tmp/t8-build/ && mkdir -p /tmp/t8-build/packages && for p in mpd-dsh-adapter-plugin mpd-verif-plugin mpd-silicon-bootstrap-plugin; do cp -a $SIL/packages/$p /tmp/t8-build/packages/; done
cd /tmp/t8-build && rm -rf packages/*/dist && node scripts/build.mjs && for p in mpd-dsh-adapter-plugin mpd-verif-plugin mpd-silicon-bootstrap-plugin; do sha256sum packages/$p/dist/index.js $SIL/packages/$p/dist/index.js; done

# F3 —— 改名是否落地
grep -rn siliconDsh $SIL/packages/*/src $SIL/packages/*/dist | wc -l                 # → 0
grep -n 'export const SERVICE_NAME' $SIL/packages/mpd-dsh-adapter-plugin/src/index.ts # → :446 "mpdDsh"

# F4 —— 源工程门禁现状
cd $SRC && node scripts/verify-vendor.mjs; echo "exit=$?"            # → skills 331 vs 366 / treeSha mismatch / exit 1
cd $SRC && node scripts/verify-rows-parity.mjs; echo "exit=$?"       # → ok / exit 0
cd $SRC && node skills/dsh-qa/scripts/rtl-verif.mjs --self-test; echo "exit=$?"       # → FAIL / exit 1
cd $SRC && node skills/dsh-qa/scripts/rtl-ip-profile.mjs --self-test; echo "exit=$?"  # → FAIL / exit 1

# F5 —— adapter 源测试对新副本可用
mkdir -p /tmp/t8-adapter-probe && cp -a $SIL/packages/mpd-dsh-adapter-plugin /tmp/t8-adapter-probe/ && mkdir -p /tmp/t8-adapter-probe/mpd-dsh-adapter-plugin/test
cp $SRC/packages/mpd-dsh-adapter-plugin/test/adapter.test.ts /tmp/t8-adapter-probe/mpd-dsh-adapter-plugin/test/ && cd /tmp/t8-adapter-probe && bun test   # → 22 pass / 60 expect

# F7 —— 硬编码绝对路径
grep -rn '/root/dshProj/my-power-dsh' $SIL/scripts $SIL/packages/*/test $SIL/README*.md $SIL/presets/*.md
```

---

## 6. 独立性、局限与建议给 captain 的行动项

**独立性：** 本审查者未参与 t1/t2/t3/t4/t6 任一交付；除本报告外未写任何文件；源工程只读（未执行任何写/git 写命令）。

**局限：**
- 讨论保真时，源工程处于 t5 的半途状态（删除已 staged、未提交）。所有"源侧"结论都用 `HEAD 3d99718` 归档复核，未依赖半途工作树。
- t7 的 `evidence/verification/t7-install-boot.md` 评审时仍在飞（Lead 在写），我仅把它当作 F3(a) 的旁证，未作为判定依据。
- t3 的共存结论（`evidence/t3-loader-semantics/`）中"B1 仍致命"与 F3(a)/t7 §4.3 一致；其修复方案（S1）尚未落地，且**当前 DAG 中没有承担该改名落地的任务**。

**建议 captain 的行动项（按优先级）：**
1. **裁决 F4**（VENDOR_LOCK / test:qa 与 t5 契约的冲突）——t5 正在跑，这是当前最紧的阻塞。
2. **派发 S1 改名落地任务**（adapter `SERVICE_NAME` → `siliconDsh` + verif/bootstrap 两处解析缝），否则"与 mpd 共存"这一覆盖项永远达不到；落地后跑 t6 §9 的 5 条复检判据。
3. **派发 F1/F2 修复**（自持语料基线，去除对源检出的依赖）——否则新仓库的自证门禁在剥离后即失效。
4. **派发 F3 文档刷新 + F5 adapter 测试/README 补移 + F6/F7 更正**（可合并为一个小修复任务）。
5. 记录 F8（low）为可选文档补充。
