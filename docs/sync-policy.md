# Cross-repository sync policy

**English** below · [中文](#中文版) further down this same file — both languages are normative.

Companion to [`dependency-map.md`](./dependency-map.md): the map says *where each RTL asset is*,
this policy says *who owns it and where changes are allowed to happen*.

---

# English

## 1. Authority

- **The single authoritative source for every RTL capability is the GitHub repository
  `HaroldZ32/MPD-Silicon`** — this repository.
- "RTL capability" means: the `mpd_verif_*` tool surface, the three RTL skill trees
  (`rtl-ip-flow`, `rtl-codestyle`, `rtl-verif`), the HDL language-service assets (Verible /
  slang-server), the waveform-read rows, the RTL guides, and the golden Verilog fixtures.
- **After the strip, the source project (`@mpd-dsh/mpd`) carries no RTL capability at all.** It
  keeps exactly one thing: a short pointer naming this repository. No RTL content is duplicated
  there.
- **The `rtl-ip` team profile is retired.** mpd v0.10.0 removed the team-profile plane
  (`config.profiles` on the old agent-teams row), and
  `@deepseek-ai/dsh-experimental-agent-team` `0.2.1-rc.2` exposes only `maxMembers` / `maxTasks` /
  `maxMessageBytes` / `disposalTimeoutMs`. There is no profile data file, no carrier hook and no
  cross-repo read contract to keep in sync. The replacement is the mpd roster
  (`mpd_role_spawn` / `mpd_role_persona`) + `teamModels.slot1..4` + the workmate library; the
  `rtl-ip-flow` skill stays as the domain procedure.
- Status note: this checkout is the GitHub port of the source repository, and the repository at
  `HaroldZ32/MPD-Silicon` is the working authority for the rule below. The first push to that
  remote is part of the integration step.

## 2. Change rules

1. **Every RTL change happens here.** New tools, corpus edits, template changes, LSP overlay
   changes, fixture changes, guide changes: all of them are commits in this repository.
2. **The source repository must not receive RTL edits.** During the overlap window (before and
   shortly after the physical strip) its copies exist for comparison only; a bug found in the
   overlap must be fixed here, then mirrored by re-stripping — never patched in place.
3. **Changes allowed on the mpd side are narrow:** pointer documentation and the removal of the
   stripped assets. The retired profile plane adds no obligation: nothing on the mpd side reads a
   file from this repository any more.
4. **Cross-repo changes must land together.** If a change here alters a row id, an argv contract,
   a `serverName`, or the provider name, then the mpd-side pointer that names it must be updated
   in the same release — not in a follow-up.
5. **Every asset is verifiable from this repository alone.** Any change that makes a verification
   command in `dependency-map.md` stale must update that document in the same commit.

## 3. Row-id disjointness — hard constraint

- The set of row ids declared by this bundle and the set of row ids the mpd bundle *inserts* must
  have **zero intersection**. Gate (offline, no network, touches nothing):
  `node scripts/verify-rows-disjoint.mjs` → exit 0 disjoint / 1 collision / 2 unreadable input.
  Measured on 2026-10-21 (DeepSeek Harness `0.2.1-rc.2` + mpd `0.15.1`): this bundle 4 ids across
  1 layer (all inserts, 0 id-targets); mpd 35 ids across 2 layers — root `cordis.patch.yml` 34 plus
  `presets/mpd.patch.yml` 1, all inserts, 0 id-targets; intersection empty.
- **Never add an id-target to this bundle's patch.** A non-insert patch entry is a *whole-value
  top-level assignment*, not a deep merge: patching a row owned by mpd with our own config would
  silently delete that row's entire config object (for `agent-teams`, `sessionTeamPolicy` and the
  team limits). The same rule protects every other mpd-owned row.
- Row ids are prefixed `silicon-` on purpose; a duplicate row id in one composed profile is a
  fatal loader error.
- **The gate covers row ids only.** It does *not* cover tool names or Cordis service names. Two
  bundles providing the same Cordis service name abort the whole plugin tree, and two rows
  registering the same tool name fail at registration — both are *mount-time* failures that a
  clean `--dump-config` will not reveal. Treat "row ids are disjoint" as a necessary condition,
  never as proof of coexistence: prove coexistence by mounting.

## 4. Migration and upgrade notes

- **Both bundles in one profile is a post-strip configuration.** While mpd still carries the RTL
  face, mounting both collides (the shared service singleton, and duplicate `mpd_verif_*` tool
  registration). These collisions disappear only when the mpd-side rows and assets are removed.
- **Only one side may own the HDL language-service row.** This bundle's `silicon-mcp-lsp` row is
  **enabled** (the assets landed with t16) and its artifact is the **canonical HDL home** now that
  `@mpd-dsh/mpd` v0.15.1 re-scoped its own package to a cclsp launcher. Never enable it against an
  absent `dist/cli.js`: a stdio MCP row whose command cannot be resolved does not degrade, it
  retry-storms at boot.
- **Upstream plugin dists are built offline, not vendored from npm.** The LSP overlay is applied
  over a freshly copied upstream source and is drift-guarded by its anchor marker; when the
  upstream file changes shape the build fails loudly instead of producing a silently wrong dist.
- **The skill corpus is fingerprinted by the source repository's lock file**
  (`VENDOR_LOCK.json`, entry `assets.skills`). Removing the RTL trees there must re-pin that
  fingerprint and update the row-parity gate **in the same commit** as the deletion, otherwise
  the source repository's own gate fails.
- **Versioning:** this bundle's `version` and the mpd bundle's version move independently. The
  only coupling is the pointer text and the dependency pin below.

### Dependency pin and upgrade policy

- **`@mpd-dsh/mpd` is an external, pinned runtime dependency — not a port.** The root
  `package.json` declares `"@mpd-dsh/mpd": "0.15.1"` (exact, no range). The adapter is imported
  through the package specifier `@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js`;
  there is no local copy, no relative import, and no fallback chain.
- **Never provide `mpdDsh`.** The service has exactly one provider — mpd's `mpd-dsh-adapter` row.
  Registering it here aborts any profile that mounts both bundles. The inject-free
  `silicon-require-mpd` guard turns a missing provider into a startup refusal (exit 1), so a
  silicon-only profile can never boot silently with zero tools.
- **Upgrading the pin is a change with its own evidence.** Bump the exact version, run
  `bun install`, re-run every binding gate (`bun test packages`, typecheck, corpus, rows, LSP,
  packer, workflows — `AGENTS.md` §4), then boot both modes: coexist (must stay alive and serve the
  corpus) and no-mpd refusal (must exit 1 with the guard message). Record the new evidence under
  `evidence/verification/mpd-dependency/`.
- **The dists stay externalized.** `scripts/build.mjs` and `scripts/pack-silicon.mjs` must keep
  the package specifier in `dist/index.js`; a build that inlines `@mpd-dsh/mpd` is a defect, not a
  size optimization.

## 5. What the source repository keeps (pointer policy)

After the strip, the source repository keeps:

- a short "RTL capability moved" note in its README and, if useful, in its docs index, naming
  this repository and stating that RTL work happens here.

Nothing else. The `rtl-ip` carrier hook disappeared with the team-profile plane, and it must not be
reintroduced: there is no profile data in this repository for it to read.

It must **not** keep: any copy of the RTL skill trees, the verif plugin, the LSP overlay, the RTL
guides, or the golden fixtures.

## 6. Non-negotiables

- No RTL asset is edited only in the source repository after the strip.
- No id-target is added to this bundle's patch.
- No row id, tool name, or Cordis service name is shared between the two bundles.
- Divergence from the ported source is never silent: every deliberate difference is either
  byte-identical or recorded in `dependency-map.md`.
- Neither repository commits credentials, tokens, or machine-specific absolute home paths. Use
  environment-variable indirection (for the source checkout: the sibling directory
  `../my-power-dsh`, overridable with the `MPD_SOURCE_ROOT` environment variable) instead of
  hard-coded locations.

---

# 中文版

本文档与 [`dependency-map.md`](./dependency-map.zh-CN.md) 配套：映射文档回答"每项 RTL 资产在哪"，
本文档回答"谁拥有它、允许在哪里改"。两种语言均为正式约定。

## 1. 权威归属

- **所有 RTL 能力的唯一权威源 = GitHub 仓库 `HaroldZ32/MPD-Silicon`**，即本仓库。
- 所谓"RTL 能力"包括：`mpd_verif_*` 工具面、三棵 RTL skill 语料树（`rtl-ip-flow`、
  `rtl-codestyle`、`rtl-verif`）、HDL 语言服务资产（Verible / slang-server）、波形读取行、
  RTL 系列指南，以及 golden Verilog fixture。
- **剥离完成后，源工程（`@mpd-dsh/mpd`）不再承载任何 RTL 能力。** 它只保留一件东西：一段
  指向本仓库的**说明入口**。RTL 内容在源工程不做任何复制。
- **`rtl-ip` 团队 profile 已退役。** mpd v0.10.0 移除了团队 profile 平面（旧 agent-teams 行上的
  `config.profiles`），而 `@deepseek-ai/dsh-experimental-agent-team` `0.2.1-rc.2` 只暴露
  `maxMembers` / `maxTasks` / `maxMessageBytes` / `disposalTimeoutMs`。因此既没有 profile 数据
  文件，也没有载体钩子，更没有需要同步的跨仓库读取契约。替代路径是 mpd roster
  （`mpd_role_spawn` / `mpd_role_persona`）+ `teamModels.slot1..4` + workmate 库；`rtl-ip-flow`
  skill 仍作为领域流程保留。
- 状态说明：本检出目录是源工程的 GitHub 移植版，`HaroldZ32/MPD-Silicon` 仓库即下文规则的工作权威；
  首次推送到该远端属于集成收尾步骤。

## 2. 变更规则

1. **所有 RTL 变更都在本仓库进行。** 新工具、语料修改、模板修改、LSP overlay 修改、fixture
   修改、指南修改，都是本仓库的提交。
2. **源工程侧不得接收 RTL 修改。** 在重叠窗口（物理剥离前及剥离后短期内），源工程的副本只用于
   比对；在重叠期发现的缺陷必须在本仓库修复，再通过重新剥离同步过去，**不允许就地打补丁**。
3. **允许在 mpd 侧发生的变更范围很窄：** 指向本仓库的说明文档，以及被剥离资产的删除动作。已退役的
   profile 平面不再带来任何义务：mpd 侧已无任何代码读取本仓库的文件。
4. **跨仓库变更必须一起落地。** 若本仓库的改动涉及行 id、argv 契约、`serverName` 或 provider 名，
   则引用它的 mpd 侧说明必须**同一次发版**内更新，不得留作后续任务。
5. **每项资产都必须能仅凭本仓库自证。** 任何会让 `dependency-map.md` 中验证命令失效的改动，必须
   在同一次提交里更新该文档。

## 3. 行 id 离散约束（硬约束）

- 本 bundle 声明的行 id 集合，与 mpd bundle **insert** 的行 id 集合，交集必须为**空**。门禁（离线、
  不触网、不写任何文件）：`node scripts/verify-rows-disjoint.mjs` → exit 0 表示无交集 / 1 表示冲突 /
  2 表示输入不可读。2026-10-21 实测（DeepSeek Harness `0.2.1-rc.2` + mpd `0.15.1`）：本 bundle
  4 个 id 跨 1 层（全为 insert，0 个 id-target）；mpd 35 个 id 跨 2 层 —— 根 `cordis.patch.yml`
  34 个 + `presets/mpd.patch.yml` 1 个，全为 insert、0 个 id-target；交集为空。
- **绝不要给本 bundle 的 patch 增加 id-target。** 非 insert 的 patch 条目是**整值顶层赋值**而非深
  合并：用我们自己的 config 去 patch mpd 拥有的行，会静默删掉该行的整个 config 对象（`agent-teams`
  上就是 `sessionTeamPolicy` 与团队限额）。同一条规则保护每一个 mpd 拥有的行。
- 行 id 一律加 `silicon-` 前缀；在同一份合成 profile 里出现重复行 id 是 loader 致命错误。
- **该门禁只覆盖行 id**，不覆盖工具名与 Cordis 服务名。两个 bundle 提供同名 Cordis 服务会让整棵
  插件树 abort；两个行注册同名工具会在注册时报错——两者都是**挂载期**失败，`--dump-config` 干净也
  看不出来。请把"行 id 无交集"当作必要条件，**绝不**当作共存证明：共存要靠真实挂载来验证。

## 4. 迁移与升级注意事项

- **双 bundle 同装是剥离之后的配置。** 在 mpd 仍承载 RTL 面期间，两者同装会冲突（共享服务
  singleton，以及 `mpd_verif_*` 工具重复注册）。这些冲突会随 mpd 侧行与资产的移除而消失。
- **HDL 语言服务行只能由一侧拥有。** 本 bundle 的 `silicon-mcp-lsp` 行**已启用**（资产随 t16 落地），
  且 `@mpd-dsh/mpd` v0.15.1 已把自己的同名包重定位为 cclsp 启动器，因此本包的产物现为 **HDL 的权威
  归属地**。绝不要在 `dist/cli.js` 缺席时启用：stdio MCP 行在命令无法解析时不会优雅降级，而会在启动
  时反复重试。
- **上游插件 dist 走离线构建，不从 npm 直接搬运。** LSP overlay 应用在新拷贝的上游源码之上，并由锚点
  标记做漂移守卫；上游文件形状变化时构建会**大声失败**，而不是产出静默错误的 dist。
- **skill 语料由源工程的锁文件做指纹**（`VENDOR_LOCK.json` 的 `assets.skills` 条目）。在源工程删除
  RTL 三棵树时，必须在**同一次提交**里重钉该指纹并同步行奇偶门禁，否则源工程自身的门禁会失败。
- **版本：** 本 bundle 的 `version` 与 mpd bundle 的版本各自独立演进；唯一的耦合是说明文字与下面的
  依赖钉子。

### 依赖钉子与升级策略

- **`@mpd-dsh/mpd` 是外部钉死的运行时依赖，不是移植。** 根 `package.json` 声明
  `"@mpd-dsh/mpd": "0.15.1"`（精确、无范围）。adapter 通过包说明符
  `@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js` 导入；没有本地副本、没有相对导入、
  没有回退链。
- **绝不提供 `mpdDsh`。** 该服务只有一个提供者 —— mpd 的 `mpd-dsh-adapter` 行。在本仓库注册它会让
  任何同时挂载两个 bundle 的 profile abort。inject-free 的 `silicon-require-mpd` 守卫把提供者缺席
  转成启动拒绝（退出码 1），因此只有 silicon 的 profile 绝不可能带着空工具面静默启动。
- **升级钉子是一次带证据的变更。** 改精确版本、执行 `bun install`、重跑每一条约束门禁
  （`bun test packages`、类型、语料、行 id、LSP、打包器、workflow —— `AGENTS.md` §4），再启动两种
  模式：共存（须存活并服务语料）与无 mpd 拒绝（须以退出码 1 打印守卫信息）。新证据记录在
  `evidence/verification/mpd-dependency/`。
- **dist 保持外部化。** `scripts/build.mjs` 与 `scripts/pack-silicon.mjs` 必须把包说明符保留在
  `dist/index.js` 中；把 `@mpd-dsh/mpd` 内联进去的构建是缺陷，不是体积优化。

## 5. 源工程保留什么（说明入口策略）

剥离完成后，源工程保留：

- README（必要时加文档索引）中一段简短的"RTL 能力已迁出"说明，指明本仓库并声明 RTL 工作在本仓库
  进行。

再无其他。`rtl-ip` 载体钩子已随团队 profile 平面一起消失，且不得重新引入：本仓库已没有供它读取的
profile 数据。

**不得**保留：任何 RTL skill 语料树副本、verif 插件、LSP overlay、RTL 指南，或 golden fixture。

## 6. 不可协商项

- 剥离后，任何 RTL 资产都不得只在源工程侧修改。
- 不得给本 bundle 的 patch 增加 id-target。
- 两个 bundle 之间不得共享行 id、工具名或 Cordis 服务名。
- 与移植源的偏离绝不静默：每一处刻意差异要么逐字节一致，要么记录在 `dependency-map.md` 中。
- 两个仓库都不得提交凭据、token 或与机器绑定的绝对家目录路径。请用环境变量间接引用（源工程检出
  目录用兄弟目录 `../my-power-dsh`，可用环境变量 `MPD_SOURCE_ROOT` 覆盖），不要硬编码位置。
