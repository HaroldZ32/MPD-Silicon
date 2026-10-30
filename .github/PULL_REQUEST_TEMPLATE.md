# Pull Request

## Summary / 摘要

<!-- English: what changed, why, and which rows/tools/docs are affected. -->
<!-- 中文：改了什么、为什么改、影响哪些 row/工具/文档。 -->

## Change type / 变更类型

- [ ] `feat` — new capability / 新能力
- [ ] `fix` — bug fix / 缺陷修复
- [ ] `docs` — documentation / 文档
- [ ] `test` — tests only / 仅测试
- [ ] `evidence` — evidence record / 证据记录
- [ ] `chore` — build, CI, dependency pin / 构建、CI、依赖固定
- [ ] `refactor` — no behaviour change / 无行为变更

## Gates / 闸门

Record the observed exit code, not "it passed". / 记录实际观察到的退出码，不要写“通过了”。

| Gate / 闸门 | Command / 命令 | Result / 结果 | Evidence / 证据 |
| --- | --- | --- | --- |
| Types / 类型 | `node scripts/typecheck.mjs --require` | | |
| Tests / 测试 | `bun test packages/` | | |
| Corpus / 语料 | `node scripts/verify-corpus.mjs` | | |
| Row ids / Row id | `node scripts/verify-rows-disjoint.mjs` | | |
| LSP assets / LSP 资产 | `node scripts/build-lsp.mjs --check` | | |
| Packer guards / 打包器守卫 | `node scripts/pack-silicon.mjs --self-test` | | |
| CI workflows / CI 工作流 | `node scripts/verify-github-workflows.mjs` | | |
| File modes / 文件模式 | `node scripts/pack-silicon.mjs --check` | | |
| Boot / 启动 | `node scripts/ci-boot.mjs --require` | | |

The GitHub Actions runs mirror this table: `ci.yml` (static gates), `docker-verify.yml` (the same
gates plus a real EDA smoke in a container), `boot-e2e.yml` (two real boots) and `release.yml`
(tag → npm stage publish via Trusted Publishing (OIDC, provenance) → maintainer 2FA approval + GitHub Release + GHCR). / GitHub Actions 与上表对应：`ci.yml`（静态闸门）、
`docker-verify.yml`（相同闸门 + 容器内真实 EDA 冒烟）、`boot-e2e.yml`（两次真实启动）与
`release.yml`（标签 → 经 Trusted Publishing（OIDC、provenance）暂存 npm 发布 → 维护者 2FA 批准 + GitHub Release + GHCR）。

Boot detail (required for any row, preset, patch or dependency change) / 启动细节（任何 row、preset、patch 或依赖变更都必需）：

- Mode / 模式: `coexist` / `no-mpd`
- Exit code / 退出码:
- Decisive log line / 决定性日志行:
- Log path / 日志路径: `dist/ci-boot-logs/…`

## Evidence path / 证据路径

<!-- Local log, committed evidence record, or CI artifact name (silicon-package / docker-verify-log / ci-boot-logs). -->
<!-- 本地日志、已提交的证据记录，或 CI 产物名（silicon-package / docker-verify-log / ci-boot-logs）。 -->

## Bounds and rollback / 边界与回滚

<!-- What this change does NOT prove; how to revert it safely. -->
<!-- 本次变更不能证明什么；如何安全回滚。 -->

## Checklist / 检查清单

- [ ] The diff is scoped; unrelated files are untouched. / 变更范围受控，未改无关文件。
- [ ] Every affected gate was re-run; observed exit codes are recorded above. / 所有受影响闸门已重跑，实际退出码已记录。
- [ ] Evidence is attached (log lines, path, or CI artifact). / 已附证据（日志行、路径或 CI 产物）。
- [ ] Human-facing docs are bilingual and updated in the same commit. / 面向人的文档已双语同步更新。
- [ ] No token, key, or credential appears in the diff, logs, or evidence. / diff、日志、证据中没有 token、密钥或凭据。
- [ ] `@mpd-dsh/mpd` stays pinned to an exact version, or the upgrade carries boot evidence. / `@mpd-dsh/mpd` 仍固定为精确版本，或升级带有启动证据。
- [ ] For a release PR: `package.json.version` matches the annotated tag (with or without `v`). / 发布 PR：`package.json.version` 与附注标签一致（带或不带 `v`）。
- [ ] No gate or test was weakened to obtain a pass. / 没有为了通过而放宽任何闸门或测试。
- [ ] Rollback path is stated and does not rewrite shared history. / 已说明回滚路径，且不重写共享历史。
