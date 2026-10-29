# t7 — @mpd-dsh/silicon 隔离安装 / 启动 / 真实工具调用 / 与 mpd 共存 验证台账

- 任务: t7 (verification r1, Lead), attempt 1 / attempt_id `ccdae909-720d-418c-8014-f670b4b3caa3`
- 执行时间(UTC): 2026-09-12T16:45Z ~ 2026-09-12T16:56Z
- 被测对象: `/root/dshProj/my-power-dsh-silicon` (bundle `@mpd-dsh/silicon` 0.1.0) 与 `/root/dshProj/my-power-dsh` (`@mpd-dsh/mpd` 0.3.2, 源工程 checkout, **未剥离前**状态)
- 环境: `dsh 0.1.5-rc.1`, node v24.16.0, pnpm 11.23.0, iverilog 14.0 (`/opt/osscad/oss-cad-suite/bin`), verilator 5.051, **vcs 缺失**(前提)
- 沙箱: `QA=/tmp/t7-qa`; 每个命令都在 `HOME=$QA/home DSH_HOME=$QA/home` 下执行, cwd 一律 `/tmp/t7-qa/ws`
- **真实 `~/.dsh` 未触碰**: 事后 `ls /root/.dsh/profiles/` 只有 `headless node_modules web`, 无 `silicon-qa` / `silicon-web` / `coexist`; 本次所有 dsh 调用均带临时 `HOME`+`DSH_HOME`, 工作区层用 `/tmp/t7-qa/ws`(三层沙箱)
- **零仓库写入**: 本任务只在 `evidence/verification/` 下写文件; 未改 `packages/`、`skills/`、`cordis.patch.yml`、源工程

结论速览: 隔离安装 **PASS** · row 集 **PASS** · 真实工具调用 **PASS (16/16)** · 与 mpd 共存 **今天 FATAL(见 §4, B1 未修 + B2 预期)** · rtl-ip 可见性 **载体未就绪(blocked-by-t15)** · 卸载 **功能 PASS / 有 1 处惰性残留** · row-id 离散性门禁 **PASS**。

---

## 1. 隔离安装 — PASS

契约命令(未做任何前置 profile 创建):

```
$ cd /tmp/t7-qa/ws && HOME=$QA/home DSH_HOME=$QA/home dsh plugin --profile silicon-qa add /root/dshProj/my-power-dsh-silicon
EXIT=0
+ @mpd-dsh/silicon link:/root/dshProj/my-power-dsh-silicon
Done in 201ms using pnpm v11.23.0
```

实测: `dsh 0.1.5-rc.1` 的 `plugin add` **会自动创建 profile**(契约里担心的"先 create"步骤不需要, 记录为真实行为)。生成
`$DSH_HOME/profiles/silicon-qa/`:

```json
{ "name": "dsh-profile-silicon-qa",
  "dependencies": { "@mpd-dsh/silicon": "link:/root/dshProj/my-power-dsh-silicon" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@mpd-dsh/silicon"], "patchReload": "live" } } }
```

`node_modules/@mpd-dsh/silicon -> /root/dshProj/my-power-dsh-silicon` 符号链接就位。**结论: pass**。

## 2. 行集 (`--dump-config`) — PASS

```
$ dsh --profile silicon-qa --dump-config        # EXIT=0, 353 行, stderr 0 字节
333:# == @mpd-dsh/silicon
334:- id: silicon-dsh-adapter      name: '@mpd-dsh/silicon/packages/mpd-dsh-adapter-plugin/dist/index.js'
336:- id: silicon-bootstrap        name: '@mpd-dsh/silicon/packages/mpd-silicon-bootstrap-plugin/dist/index.js'
338:- id: silicon-verif            name: '@mpd-dsh/silicon/packages/mpd-verif-plugin/dist/index.js'
340:- id: silicon-mcp-lsp          name: '@deepseek-ai/dsh-mcp-client'  disabled: true  config.serverName: silicon_lsp
```

四类 row 全在(自研插件行 ×3 + MCP/HDL LSP 行), `disabled: true` 属 **pending-t16** 有意设计, 不判缺陷。**结论: pass**。

> 组装证据的边界: `--dump-config` 只证明**组装**, 不证明**加载**。加载/挂载判定见 §4.2(真实 app boot)。

## 3. 真实 `mpd_verif_*` 工具调用 — PASS (16/16)

**口径与限制(先声明)**: 隔离 home 内**不可能**做 LLM 驱动的真实会话 —— 唯一凭据文件 `/root/.dsh/.credentials.yaml` 只有 `client-connection/browser-session` 一条, 无 DeepSeek key, 进程 env 也无 `DEEPSEEK_API_KEY`; headless 实测报
`dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"`(`/tmp/t7-qa/...` 日志)。**没有**去 `/proc/*/environ` 提取密钥。因此按契约允许的"仓库既有 smoke 脚本"路径取证: 用**源工程既有的** `packages/mpd-verif-plugin/evidence/smoke/smoke.mjs`(silicon 未随包带该脚本, 见 F4)在 `/tmp` 镜像里指向**被交付的 silicon dist**:

```
$ cd /tmp/t7-qa/toolchain/repo && PYTHONDONTWRITEBYTECODE=1 bun packages/mpd-verif-plugin/evidence/smoke/smoke.mjs
EXIT=0   (SMOKE-EXIT=0)
PASS backends auto-detect via PATH — iverilog=Icarus Verilog version 14.0 (devel) (s20260301-300-g3c3f46099-dirty);
     verilator=Verilator 5.051 devel rev v5.050-79-gf7ce38dbc (mod); vcs=absent
PASS venv status: cocotb 2.x inside the project venv — verdict=ok cocotb=2.1.0
PASS cocotb sim (verilator, DP-6 Makefile flow) PASS with results.xml + cases parsed — cases=["adder_tb:pass"] exit=0
PASS verilator coverage: sim coverage run + verilator_coverage merge / annotate report generated
PASS regress (verilator/cocotb) 1 case PASS with results.json + report — total=1 passed=1 seed=20260831
… 共 16 PASS / 0 FAIL (results.json: 16 checks, all pass)
```

镜像布局 `packages/mpd-verif-plugin/{dist ← silicon, evidence/smoke ← 源脚本}` + 仓库根 `.venv-rtl` 符号链接, 运行态全部落在 `/tmp`, **未写源工程**。
`vcs` 缺失按口径记 **有证据跳过**(`command -v vcs` 空 + smoke 内 `vcs=absent`): UVM lane 与 vcs-coverage 未跑, 不是 pass。**结论: pass(开放后端)**。

## 4. 与 mpd 共存 — 今天 **FATAL**; 三类碰撞逐类判定

`coexist` profile = web 模板 + silicon + mpd(源 checkout)。**`--dump-config` 绿色, 真实挂载红色** —— 这正是必须真 boot 的原因。

### 4.1 组装层(组装 PASS)

```
$ dsh --profile coexist --dump-config      # EXIT=0, 996 行, stderr 0 字节
silicon rows = 4      mpd rows = 16      duplicate loader entry id = 0
```

两套 row 均在、row id 无重复。**组装 pass**。

### 4.2 真实挂载(启动) — FATAL

```
$ dsh --profile coexist --no-open --port 0        # 30s 后 kill(124)
Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): loader entries failed to apply
Error: failed to apply loader entry mpd-dsh-adapter (@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js):
       service "mpdDsh" has been registered at <mpd-dsh-adapter>
Error: failed to apply loader entry mpd-verif (@mpd-dsh/mpd/packages/mpd-verif-plugin/dist/index.js):
       tool "mpd_verif_venv" is already registered (for a per-agent variant, register through that agent's `agent.ctx` instead)
```

**方法论警告(必读, 已复现)**: 同一 profile 用 `dsh --profile coexist --help` 会 **exit 0 且只打印 app help**, 上面两条致命错误**完全不出现**(help 在插件树结算前就输出了)。→ **`--help` 引导不是挂载门禁, 会给出假绿**。判共存必须跑真实 app boot 并读 exit code + stderr。

### 4.3 最小复现与归属(变体矩阵, 用 `--patch` 覆盖层, 未改任何仓库文件)

| 变体 | 覆盖 | 结果 | 归属结论 |
|---|---|---|---|
| V1 | `- id: mpd-dsh-adapter, disabled: true` | 只剩 `tool "mpd_verif_venv" is already registered` | **B2** = mpd-verif ⇄ silicon-verif |
| V2 | `- id: mpd-verif, disabled: true`(= **t5 后的形态**) | 只剩 `service "mpdDsh" has been registered` | **B1 在 t5 之后依然致命** |
| V3 | 两行都禁用 | **干净启动**: 0 条错误, 两个 skill provider 都注册(`silicon-bundle` + `mpd-bundle`), 服务监听 `http://127.0.0.1:35351` | 除 B1/B2 外**无第三类碰撞** |

- **B1 service 名冲突 — 未修(F1, 高)**: silicon 的 adapter 副本仍是
  `packages/mpd-dsh-adapter-plugin/src/index.ts:445-450` → `export const SERVICE_NAME = "mpdDsh"` + `ctx.provide(SERVICE_NAME, adapter)`; dist 内 `mpdDsh` 出现 1 次。消费方仍是 `ctx.get("mpdDsh") ?? createDshAdapter(ctx)`(`mpd-silicon-bootstrap-plugin/src/index.ts:348`、`mpd-verif-plugin/src/index.ts:35`)。
  → 队长批准的 **S1 修法未落地**(silicon 侧服务名改 `siliconDsh` + 解析链 `siliconDsh ?? mpdDsh ?? createDshAdapter(ctx)`)。
- **B2 tool 名冲突 — 预期, owner t5**: 两 bundle 都有 verif 行并注册同名 `mpd_verif_*`; V2 证明**只禁用 mpd 的 verif 行即可消除**(即 t5 剥离后消失)。
- **B3 MCP serverName — 已解决**: silicon 行用 `serverName: silicon_lsp`(工具面 `mcp__silicon_lsp__*`), 与 mpd 的 `lsp` 不撞; 且该行 `disabled: true`(pending-t16), V3 启动无 retry-storm、无 `Cannot find module`。

### 4.4 单例 row 归属(队长点名要写清)

- `agent-teams` 行**唯一持有者 = `@mpd-dsh/mpd`**(composed dump 第 662 行起, `name: '@mpd-dsh/mpd/packages/mpd-agent-teams-plugin/lib/index.js'`), 其 `config.profiles` 当前为 `{mpd, rtl-ip}`。
- silicon 侧 patch **id-target 数量 = 0**(仅两个 `- insert:` 块, 4 个新 id); `agent-presets` 的 id-target 同样归 mpd。→ silicon 没有、也不会去 patch 这两行。
- 因此 rtl-ip 的定义权只能经 t15 的 mpd 侧钩子落地, silicon 只提供数据文件。

### 4.5 row-id 离散性 ≠ 可共存(方法论)

`scripts/verify-rows-disjoint.mjs` **只覆盖 loader row id**(§7 全绿), 覆盖不到 **service 名 / tool 名 / MCP serverName**; B1、B2、B3 全部是 row id 零交集却依然冲突的反例类别。**"row id 零交集" 不等于 "可共存"**, 后续报告不得用 §7 的绿色替代 §4.2 的红色。

## 5. rtl-ip profile 可见性 — 今天"可见", 但载体是 mpd(未剥离), silicon 侧 **blocked-by-t15**

- composed dump 第 808 行 `rtl-ip:` 在 mpd 的 `agent-teams` 行 `config.profiles` 内; 7 名成员齐:
  `Requirement Analyst | Spec Designer | RTL Code Engineer — Verilog/SV | RTL Code Engineer — SpinalHDL | Verification Engineer | Reviewer | Plan Reviewer`;
  四阶段标记齐: `STAGE 0`×1、`IP01`×2、`STAGE 4`×1, 门禁 `🔴`×5 / `🟢`×3; `taskPlanning: captain`。
- **归属**: 今天的可见性来自**未剥离的 mpd 行**(源工程 `packages/mpd-bundle/cordis.patch.yml:320` 内联 `rtl-ip:`), **不是** silicon 的贡献。silicon 只提供数据文件 `presets/rtl-ip.profile.json`, 经逐字段比对与 composed 块 **DEEP-EQUAL=true**(members/description/protocol/taskPlanning 全等; 比对脚本 `/tmp/t7-qa/cmp-rtl-ip.mjs`)。
- **结论**: silicon 自有载体的可见性 = **blocked-by-t15**(设计 (b'): 定义归 silicon 数据文件, mpd 侧仅一处 `{}` 回退钩子)。t5 剥掉 mpd 内联块后本项会**先消失**, t15 落地后应重新出现 —— 需在 t5+t15 后**追加复测**(见 §10)。

## 6. 卸载无残留 — 功能 PASS, 1 处惰性残留(F3)

```
$ dsh plugin --profile silicon-qa remove @mpd-dsh/silicon     # EXIT=0
before: dump silicon rows = 4      after: = 0        (dump 内 "silicon" 引用数 0)
profile package.json: bundles = ["@deepseek-ai/dsh-base"], dependencies = {} (已移除)
pnpm-lock.yaml: importer 空
残留: node_modules/@mpd-dsh/silicon 符号链接仍在(node_modules 下唯一条目)
```

功能面无残留(不再挂载任何 silicon row), 但**文件系统层面**留下一个失效依赖的符号链接 → **F3(low)**。惰性、不影响挂载, 但"卸载无残留"按字面未达成。**已由 t26 承接**(README 已写明该残留与手工删除方式); 不判 t1/t3 缺陷。

## 7. row-id 离散性门禁 — PASS

```
$ cd /root/dshProj/my-power-dsh-silicon && node scripts/verify-rows-disjoint.mjs        # EXIT=0
[rows-disjoint] silicon(.../packages/mpd-bundle/cordis.patch.yml): 4 row id(s) — insert 4, id-target 0
[rows-disjoint] mpd(/root/dshProj/my-power-dsh/packages/mpd-bundle/cordis.patch.yml): 22 row id(s) — insert 21, id-target 1
[rows-disjoint] mpd id-targets (must never be re-patched by silicon): agent-presets
[rows-disjoint] PASS: silicon ∩ mpd = ∅
$ node scripts/verify-rows-disjoint.mjs --self-test                                      # EXIT=0
```

t3 已交付该脚本且可重跑, 无需 B5 等价实现。**结论: pass**(范围限制见 §4.5)。

## 8. 判定汇总

| 契约判定项 | 结论 | 证据 | 未达标项归属 |
|---|---|---|---|
| 隔离 DSH_HOME 安装 + 全 row 可见 | pass | §1 §2 | — |
| 真实 `mpd_verif_*` 可用性(结构化结果) | pass(开放后端 16/16) | §3 | vcs lane = 有证据跳过(无 vcs) |
| rtl-ip 7 成员 + 四阶段标记 | 今天可见, **silicon 载体 blocked-by-t15** | §5 | t15(设计 (b')) |
| 与 mpd 共存 | **FATAL(今天)** | §4.2 §4.3 | **B1 → S1 未落地(F1, 高)**; B2 → t5; B3 已解决 |
| row-id 离散性脚本可重跑 | pass | §7 | — |
| 卸载无残留 | 功能 pass / 惰性残留 | §6 | F3(low) |
| HDL LSP 行 | 组装可见, `disabled: true` | §2 §4.3 | **pending-t16**(有意设计, 不判缺陷) |

## 9. Findings

- **F1(high / blocker for coexistence)** — silicon 的 `mpd-dsh-adapter` 副本仍 `ctx.provide("mpdDsh", …)`, 与 mpd 的 adapter 撞服务名; 两个 bundle 同装时插件树 `failed to apply loader entry` → **启动失败**。已批准的 S1(改 `siliconDsh` + 解析链 `siliconDsh ?? mpdDsh ?? createDshAdapter`)在交付物中**不存在**(`src/index.ts:445-450`, dist 内 `mpdDsh`×1)。最小复现 = §4.3 V2/V3: 只禁 mpd-verif 仍红且错误恰为 service 冲突。→ 交 captain 转派修复; 修复后需复跑 §4.2。
- **F2(medium / 预期)** — `mpd_verif_venv` 等 8 个工具名双注册; 由 t5 删除 mpd 的 `mpd-verif` 行消除(§4.3 V2 证明充分性)。当前"两 bundle 同装"是必然冲突, 不是可容忍状态。
- **F3(low)** — `plugin remove` 后 `$DSH_HOME/profiles/<p>/node_modules/@mpd-dsh/silicon` 符号链接残留(惰性)。**已由 t26 承接**: README「Install」段已写明该残留与手工删除方式(commit `37b93cf`), 实现侧不修(dsh plugin-manager 行为)。
- **F4(info)** — silicon 未随包携带 verif 冒烟脚本(`packages/mpd-verif-plugin/` 只有 src/test/dist/README/package.json), 本次借用源工程脚本; 建议后续随包附带, 使新仓库自证。同时记录方法论: **`--help` 引导会对致命插件树错误给出 exit 0 假绿**(§4.2)。

## 10. 后续追补(分期判定)

1. **S1 落地后**: 复跑 §4.2(两 bundle 全量) → B1 应消失(预期错误只剩 B2)。
2. **t5 落地后**: 复跑 §4.3 V3 形态(或直接全量) → B2 应消失; 追加"最终共存结论"段(带时间戳)。
3. **t5 + t15 落地后**: 复跑 §5 → rtl-ip 可见性必须由 **silicon 数据文件**经 mpd 钩子提供; 否则即真实缺陷。
4. **t16 落地后**: `silicon-mcp-lsp` `disabled: false`, 复跑 §4.2 确认无 retry-storm。

## 11. 复现命令(自包含)

```bash
QA=$(mktemp -d); mkdir -p $QA/home $QA/ws; cd $QA/ws
export HOME=$QA/home DSH_HOME=$QA/home
SIL=/root/dshProj/my-power-dsh-silicon; MPD=/root/dshProj/my-power-dsh

# 1+2 安装与 row 集
dsh plugin --profile silicon-qa add $SIL
dsh --profile silicon-qa --dump-config | grep -n "^\- id: silicon-"

# 3 真实工具链调用(silicon dist)
M=$QA/tc; mkdir -p $M/repo/packages/mpd-verif-plugin/{dist,evidence/smoke}
cp $SIL/packages/mpd-verif-plugin/dist/index.js $M/repo/packages/mpd-verif-plugin/dist/
cp $MPD/packages/mpd-verif-plugin/evidence/smoke/smoke.mjs $M/repo/packages/mpd-verif-plugin/evidence/smoke/
ln -s $MPD/.venv-rtl $M/repo/.venv-rtl
(cd $M/repo && PYTHONDONTWRITEBYTECODE=1 bun packages/mpd-verif-plugin/evidence/smoke/smoke.mjs)   # 期望 16 PASS / exit 0

# 4 共存(组装绿、挂载红)
dsh --profile coexist --from-default-profile web --dump-config >/dev/null
dsh plugin --profile coexist add $SIL; dsh plugin --profile coexist add $MPD
dsh --profile coexist --dump-config | grep -c "duplicate loader entry id"        # 期望 0
timeout 30 dsh --profile coexist --no-open --port 0 2>&1 | grep -E "failed to apply loader entry|already registered"
printf -- "- id: mpd-dsh-adapter\n  disabled: true\n- id: mpd-verif\n  disabled: true\n" > $QA/v3.yml
timeout 25 dsh --profile coexist --patch $QA/v3.yml --no-open --port 0            # 期望: 0 错误, 打印监听地址

# 6 卸载
dsh plugin --profile silicon-qa remove @mpd-dsh/silicon
dsh --profile silicon-qa --dump-config | grep -c "^\- id: silicon-"               # 期望 0

# 7 门禁
(cd $SIL && node scripts/verify-rows-disjoint.mjs && node scripts/verify-rows-disjoint.mjs --self-test)
```
