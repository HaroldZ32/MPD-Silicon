# corpus gate — independent destructive verification (Lead)

- 时间(UTC): 2026-09-13T01:20Z 附近(本地 01:2x)
- 角色: **独立验证者**(实现归 t20 / Junior Engineer;本文件只记录独立复现,不改任何实现文件)
- 被验证修订(钉死):
  - `scripts/verify-corpus.mjs` = sha256 `2609efe901dc72fa661b478d0d07c5a434ee888ff72224d5affb37f104bcefe6`
  - `evidence/verification/corpus-baseline.json` = sha256 `0a00e4c7dc1a009db0f449cf07f61f5e9398a788e306e786c48e352f2ec926c3`
- 方法: 在 `/tmp/t7-vc/repo` 做**快照**(repo 去 node_modules)+ `/tmp/t7-vc/fakesrc` 伪源检出;所有破坏性用例都在快照里做,真实仓库只读(`pack --check` 本身无写入)。真实 `~/.dsh` 未触碰。
- **本文件不修改实现**: 快照内改动一律用副本/追加后还原,真实仓库仅在只读模式下运行。

## 1. 破坏性用例矩阵(契约第 4 条)

| # | 场景 | 命令 | 期望 | 实测 | 结论 |
|---|---|---|---|---|---|
| A | 源检出缺席(自持基线自证) | `MPD_SOURCE_SKILLS=/nonexistent/skills node scripts/verify-corpus.mjs` | exit 0 + 两种模式可区分 | 3 条 `PASS … match the committed baseline (sha256, source rev 3d99718)` + `SKIP fidelity cross-check: no source checkout … — the committed baseline above is authoritative` ; **PASS — 10 check(s) passed, 1 skipped** | **pass** |
| B | 篡改随包文件 1 字节 | `printf '\n' >> skills/rtl-codestyle/SKILL.md` 后运行 | exit 1 **并指名文件** | `FAIL rtl-codestyle: 1 file(s) differ from the committed baseline (sha256): SKILL.md` ; **FAIL — 1 problem(s)** | **pass** |
| C | 某棵树源目录缺席(逐树判定) | 伪源仅含 `rtl-codestyle`,`MPD_SOURCE_SKILLS=/tmp/t7-vc/fakesrc/skills` | 该树 SKIP(不判失败)+ 其余照常 | `SKIP fidelity cross-check: tree rtl-ip-flow is not present …`、`SKIP … rtl-verif …`(2 条),`rtl-codestyle` 交叉比对通过 ; **PASS — 11 check(s) passed, 2 skipped** | **pass** |
| D | 源检出与随包不一致 | 在伪源副本里追加 1 字节后运行 | exit 1 指名 | `FAIL rtl-codestyle: 1 file(s) differ from the source checkout: SKILL.md` | **pass** |
| E | 自检控制组 | `node scripts/verify-corpus.mjs --self-test` | exit 0 | `self-test: PASS (8 negative controls caught, 2 healthy controls clean)` ; PASS — 10 check(s), 1 skipped | **pass** |

用例 B 判分要点(证明基线"会咬人"而不是装饰): 篡改的是**随包**文件,源检出此时并不在场(源码树已被 t5 剥离),基线仍然抓住并指名 `SKILL.md` → 自证路径有效。
用例 B 后快照已还原,并用脚本复核 `restored-clean: YES`(35/35 与基线一致)。

## 2. manifest(基线)与随包文件逐条对照

```
files compared: 35   mismatches: 0
OK   rtl-ip-flow/SKILL.md                     actual=426dc99ca2849252… baseline=426dc99ca2849252…
OK   rtl-ip-flow/templates/defect-report.md   actual=30e933704a92af4f… baseline=30e933704a92af4f…
… (全 35 行见 /tmp/t7-vc/manifest-vs-actual.txt)
OK   rtl-verif/templates/uvm/dut_sequence.sv  actual=1292ee5e08c21ae1… baseline=1292ee5e08c21ae1…
```

基线元数据(可追溯): `generatedFrom = { project: "my-power-dsh", rev: "3d99718", path: "skills/<tree>", method: "git archive 3d99718 skills/<tree>" }`,三棵树 9+6+20 = 35 文件。

## 3. 其它只读核查

- 真实仓库 `node scripts/verify-corpus.mjs` → **PASS — 10 check(s) passed, 3 skipped**(3 条 skip 均为逐树 source cross-check,因 t5 已剥离源树;符合设计)。
- 真实仓库 `node scripts/pack-silicon.mjs --check` → **check PASS: every committed file is readable by a non-root consumer**(exit 0)。
- 新增文件模式: `evidence/verification/corpus-baseline.json` 644、`t6-port-fidelity.md` 644、`t7-install-boot.md` 644、`scripts/*.mjs` 755 → 无 600 残留。

## 4. 残留缺口(交 t20 处置,非阻断)

- **契约第 3 条只完成了一半**: 自检控制组仍全部使用**字面子串**匹配(`scripts/verify-corpus.mjs:377` = `problem.includes("differ from the committed baseline")`;`:358/:366/:387/:392/:401` 同型)。当前措辞下能通过,但未来文案微调仍会误报 —— 契约要求的是"语义片段匹配"(如匹配 `differ`)。属小改,建议 t20 在本轮一并收口。
- 基线文件放在 `evidence/verification/`(而非消息里建议的 `scripts/`)。已随包提交、`--check` 通过,功能与可追溯性无问题;仅提示:该路径与验证证据同目录,后续若有人把 `evidence/` 当作"纯输出目录"清理会误伤门禁基线。

## 5. 复现命令

```bash
R=/root/dshProj/my-power-dsh-silicon
sha256sum $R/scripts/verify-corpus.mjs $R/evidence/verification/corpus-baseline.json   # 与本文顶部钉死值比对
V=/tmp/t7-vc/repo; mkdir -p $(dirname $V); cp -a $R $V 2>/dev/null || true             # 或按 §"方法"自行快照
cd $V
MPD_SOURCE_SKILLS=/nonexistent/skills node scripts/verify-corpus.mjs                    # A: exit 0
printf '\n' >> skills/rtl-codestyle/SKILL.md && node scripts/verify-corpus.mjs           # B: exit 1, 指名 SKILL.md
mkdir -p /tmp/t7-vc/fakesrc/skills && cp -a skills/rtl-codestyle /tmp/t7-vc/fakesrc/skills/
MPD_SOURCE_SKILLS=/tmp/t7-vc/fakesrc/skills node scripts/verify-corpus.mjs               # C: exit 0, 2 条逐树 SKIP
printf '\n' >> /tmp/t7-vc/fakesrc/skills/rtl-codestyle/SKILL.md
MPD_SOURCE_SKILLS=/tmp/t7-vc/fakesrc/skills node scripts/verify-corpus.mjs               # D: exit 1
node scripts/verify-corpus.mjs --self-test                                              # E: exit 0
```
