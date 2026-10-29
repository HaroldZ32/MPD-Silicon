# mpd-silicon-bootstrap-plugin

[English](./README.md)

`@mpd-dsh/silicon` bundle 的**引用式**资产供给插件。

silicon bundle 只随包提供一类可安装资产 —— `<bundle>/skills` 下的 **RTL 技能语料**
（`rtl-ip-flow`、`rtl-codestyle`、`rtl-verif`）。本行在该目录上注册一个
`ctx.skills` provider，因此语料**恰好**在 bundle 安装期间可见，行卸载即消失；
不会向 `$DSH_HOME` 复制任何内容，`dsh plugin remove` 之后不留残留。

| 属性 | 值 |
| --- | --- |
| `name` | `mpd-silicon-bootstrap` |
| `inject` | `["skills", "mpdDsh"]` |
| provider 名 | `silicon-bundle`（进程内唯一；mpd 自身的行使用 `mpd-bundle`，两个 bundle 可共存安装） |
| provider rank | `600`（`bundled`），低于用户根 |
| 语料根目录 | `<pkg-root>/skills`（或 `config.skillsDir`） |
| 配置项 | `skillsDir?`、`skipSkills?` |

## 必须安装 mpd

`@mpd-dsh/mpd` 是**硬运行时依赖**（`0.15.1`，钉在 bundle 根 `package.json`），不是可选伴生。本行
经 **mpd 的 adapter** 提供语料，因此不支持只有 silicon 的 profile：它会经 `silicon-require-mpd`
守卫以退出码 1 停下，而不是提供空技能列表。测试或构建前必须执行 `bun install`。

bundle 根目录由**被加载文件自身的位置**推导（从
`packages/mpd-silicon-bootstrap-plugin/dist/index.js` 上溯三层），绝不依赖包名解析，
因此在源码检出与已安装 bundle 两种形态下行为一致。

## 有意缺席的部分（属于 mpd bundle，而非 RTL 面）

- **不提供 agent preset 根**：silicon bundle 不随包提供任何 preset。
- **不做 legacy `$DSH_HOME` 副本清理**：silicon 从未写过 home 副本，无可迁移内容。
  本行**完全不写** harness home。

插件单元测试针对**有效代码**（而非注释文字）断言这两项缺席，因此一旦重新引入
任一行为，测试即失败。

## frontmatter 子集

语料 frontmatter 由一个刻意收窄、零依赖的 YAML 子集解析：顶层标量、一个嵌套
`metadata` 映射，以及 `|` / `>` 块标量。若文件违反该子集、缺少 frontmatter、
缺少 `name`/`description`，或技能名不符合 `^[a-z0-9]+(?:-[a-z0-9]+)*$`，则
**跳过并告警** —— 单个坏文件绝不会导致整个语料列表失败。`test/fixtures/`
固定了该子集（含中文内容与两个故意非法的条目），因此本测试不依赖真实语料存在。

## Harness 接口

所有 harness 访问都经由 `@mpd-dsh/mpd` 的 adapter
（`@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js`）：本行声明
`inject: [...dshSeamInject(DSH_SEAM_SKILLS), "mpdDsh"]`，从 `ctx.mpdDsh` 读取活适配器，并调用
`dsh.registerSkillProvider(...)`。**没有回退 adapter**：没有 `mpdDsh` 的 profile 会让本行保持
PENDING，bundle 的 `silicon-require-mpd` 守卫会拒绝启动。唯一的直接 harness 访问是
`ctx.logger.warn`，保留为告警主通道，adapter 的 `rowLogLine` 作为回退；其余接缝全部经由
adapter。

## 测试

```sh
bun test packages/mpd-silicon-bootstrap-plugin   # 30 个测试 / 2 个文件
```

## 构建

```sh
node scripts/build.mjs          # 整个仓库
bun build src/index.ts --target node --format esm --outfile dist/index.js
```
