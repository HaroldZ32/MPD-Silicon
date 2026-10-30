# mpd-silicon-guard-plugin

[中文](./README.zh-CN.md)

`silicon-require-mpd` — the `@mpd-dsh/silicon` startup guard. It exists so a profile without
`@mpd-dsh/mpd` stops with an actionable error instead of booting with an empty tool surface.

## Why this row exists

The consumer rows (`silicon-verif`, `silicon-bootstrap`) declare `mpdDsh` in `inject`. Cordis
applies an injected row only once the provider is ACTIVE; when it never appears, the row simply
stays PENDING with a warning. That is a silent no-tools boot — the exact failure this bundle must
not ship.

An inject-free row can be loud: it is applied in every composition (including a silicon-only one),
polls the service, and throws after the deadline. The CLI turns an uncaught exception into
`dsh: fatal uncaught exception: …` and exits 1.

## Behavior

| Property | Value |
| --- | --- |
| `name` | `silicon-require-mpd` |
| `inject` | `[]` (inject-free by design) |
| Default timeout | `15000` ms |
| Poll interval | `100` ms |
| Probe | `ctx.get("mpdDsh", true)` — strict, so an unregistered or not-yet-ACTIVE service reads as "not ready" |
| Config | `{ timeoutMs?: number }` |
| On timeout | throws from a timer, after `apply` returned |

The probe absorbs the strict `ctx.get` throw: both "unregistered" and "registered but not ACTIVE"
mean "not ready" here. A non-`undefined` answer is success — the probe returns the service, never a
boolean.

The throw is deliberately scheduled from a timer rather than raised inside `apply`: an apply-time
throw races the concurrent fiber and is not reliably fatal.

## Error and exit behavior

```
silicon requires @mpd-dsh/mpd: the mpdDsh service is absent; install @mpd-dsh/mpd@0.15.1 and enable the mpd-dsh-adapter row
```

Measured on a silicon-only profile: the process exits 1 after about 18 s, and both consumer rows
report `pending (waiting for service: mpdDsh)`. With mpd present the row returns immediately and
never arms the poll.

## Configuration

```yaml
- id: silicon-require-mpd
  name: '@mpd-dsh/silicon/packages/mpd-silicon-guard-plugin/dist/index.js'
  config:
    timeoutMs: 15000
```

`timeoutMs` is the only knob — the grace period for the provider row to become ACTIVE. Raise it on
a slow host. Lowering it races the loader and is not supported.

## Tests

```sh
bun test packages/mpd-silicon-guard-plugin   # 11 tests / 2 files
```

The wait helper is pure with respect to time and scheduling (clock and scheduler are injected), so
both outcomes — resolve on availability, reject at the deadline — are tested without sleeping.

## Build

```sh
node scripts/build.mjs          # whole repo
bun build src/index.ts --target node --format esm --outfile dist/index.js
```

The package has no runtime import from `@mpd-dsh/mpd`; it only reads the service through `ctx`.
