# mpd-silicon-guard-plugin

[English](./README.md)

`silicon-require-mpd` —— `@mpd-dsh/silicon` 的启动守卫。它存在的目的：没有 `@mpd-dsh/mpd` 的
profile 会带着可操作的错误停下，而不是以空工具面启动。

## 为什么需要这一行

消费行（`silicon-verif`、`silicon-bootstrap`）在 `inject` 里声明了 `mpdDsh`。Cordis 只在提供者
ACTIVE 之后才 apply 被注入的行；提供者始终不出现时，该行只会保持 PENDING 并打印一条警告。那就是
静默的无工具启动 —— 本 bundle 绝不能交付的失败形态。

inject-free 的行才能大声：它在任何组合里都会 apply（包括只有 silicon 的组合），轮询服务，并在
超时后 throw。CLI 会把未捕获异常转成 `dsh: fatal uncaught exception: …` 并以退出码 1 结束。

## 行为

| 属性 | 值 |
| --- | --- |
| `name` | `silicon-require-mpd` |
| `inject` | `[]`（按设计 inject-free） |
| 默认超时 | `15000` ms |
| 轮询间隔 | `100` ms |
| 探测 | `ctx.get("mpdDsh", true)` —— 严格模式，未注册或尚未 ACTIVE 都读作「未就绪」 |
| 配置 | `{ timeoutMs?: number }` |
| 超时后 | 从 timer 中 throw（此时 `apply` 已返回） |

探测会吞掉严格 `ctx.get` 的 throw：「未注册」与「已注册但未 ACTIVE」在这里都表示「未就绪」。
非 `undefined` 的答案即成功 —— 探测返回服务本身，绝不返回布尔值。

throw 刻意从 timer 中抛出，而不是在 `apply` 内直接抛：apply 期抛异常会与并发 fiber 竞争，不能可靠
地致命。

## 错误与退出行为

```
silicon requires @mpd-dsh/mpd: the mpdDsh service is absent; install @mpd-dsh/mpd@0.15.1 and enable the mpd-dsh-adapter row
```

在只有 silicon 的 profile 上实测：进程约 18 s 后以退出码 1 结束，两个消费行都报
`pending (waiting for service: mpdDsh)`。mpd 存在时本行立即返回，不会启动轮询。

## 配置

```yaml
- id: silicon-require-mpd
  name: '@mpd-dsh/silicon/packages/mpd-silicon-guard-plugin/dist/index.js'
  config:
    timeoutMs: 15000
```

`timeoutMs` 是唯一的旋钮 —— 提供者行变为 ACTIVE 的宽限期。慢机器可以调大；调小会与 loader 竞争，
不受支持。

## 测试

```sh
bun test packages/mpd-silicon-guard-plugin   # 11 个测试 / 2 个文件
```

等待 helper 对时间与调度是纯函数（时钟与调度器均由外部注入），因此两种结果 —— 可用时 resolve、
到点 reject —— 都无需 sleep 即可测试。

## 构建

```sh
node scripts/build.mjs          # 整个仓库
bun build src/index.ts --target node --format esm --outfile dist/index.js
```

本包没有从 `@mpd-dsh/mpd` 的运行时导入；它只通过 `ctx` 读取服务。
