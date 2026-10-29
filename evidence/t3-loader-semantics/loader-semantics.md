# DSH patch-loader semantics — probe results (t3 pre-work, read-only recon)

Status: reconnaissance only. t3 has NOT been claimed (deps t1/t2 still open). This file
answers the captain's question #2 ("先查清加载器对同 id 多次 patch 的语义") with executed
evidence. All probes ran offline against store DSH
(`@deepseek-ai/dsh` 0.1.16-rc line, `lib/dump-config` + `@deepseek-ai/dsh-app-boot`).

## 1. The patch algorithm (authoritative source)

`@deepseek-ai/dsh-app-boot/lib/index.js` → `applyEntryPatches(data, patches, warn)`:

- no `id`, has `insert:` → **appends** `insert[]` to the entry list (or to the config array
  when the target is a group). Rows are indexed as inserted, so a later patch in the same
  list can target a row an earlier patch inserted.
- has `id` + `insert:` → requires the target to be a **group**; otherwise
  `warn("patch insert: entry %C is not a group")` and the patch is **skipped**.
- has `id`, no `insert:` → `for (const [key, value] of Object.entries(overrides)) target[key] = value`.
  This is a **top-level whole-value assignment per key. There is NO deep merge.**
- duplicate `id` inside one entry list → `throw new TypeError("duplicate loader entry id: …")`
  (`cordis-plugin-loader/src/config/group.ts:64`). Same module name on two *different* ids
  is **not** an error.

## 2. Probe A — same `id: agent-teams` in two layers: mpd preset is DESTROYED

Layer 1 (`profiles/probe/cordis.patch.yml`, standing in for the mpd bundle) inserts
`id: agent-teams` with `config.profiles.mpd`. Layer 2 (`$DSH_HOME/cordis.patch.yml`,
standing in for the silicon bundle) applies `id: agent-teams` with `config.profiles.rtl-ip`.

```
$ dsh --profile probe --dump-config
# == /tmp/tmp.revwwy5yvz/profiles/probe/cordis.patch.yml, patched by /tmp/tmp.revwwy5yvz/cordis.patch.yml
- id: agent-teams
  name: probe-agent-teams
  config:
    stateDir: .mpd/team-silicon
    profiles:
      rtl-ip:
        ...
[exit 0]
```

Verdict: the second `id: agent-teams` patch **replaced the whole `config` object**. The
entire `mpd` profile map AND `sessionTeamPolicy` vanished — no warning, exit 0. This is
exactly the failure mode the captain flagged. **Using `id: agent-teams` in the silicon
bundle is forbidden.**

## 3. Probe B — the `id + insert:` escape hatch is closed

```
$ dsh --profile probe --dump-config   # layer 2 = {id: agent-teams, insert: [ {id: agent-teams-silicon, …} ]}
dsh: [.../cordis.patch.yml] patch insert: entry "agent-teams" is not a group
```

The `agent-teams` row has no `group:`/`config` array, so it is not a group; the insert is
skipped with a warning. **You cannot append a second row beside `agent-teams` through it.**

## 4. Probe C — two rows with distinct ids, same module: config dump succeeds

```
$ dsh --profile probe --dump-config
- id: agent-teams          (config.profiles: mpd)
- id: agent-teams-silicon  (config.profiles: rtl-ip)
[exit 0]
```

So distinct row ids pass the loader. **BUT `--dump-config` does not mount plugins**, and
`agent-teams` registers its tools globally (one `ctx.tools` service, global scope). Two
mounted instances both call `ctx.tools.register(...)` for the same names.

## 5. Probe D — duplicate tool registration is FATAL (two rows are not viable)

`@deepseek-ai/dsh-tools/lib/index.js` `register()` → `layers.effect(ctx, (layer) => layer.tools.insert(name, definition))`,
and `NamedEntries.insert` throws on a name already present in that table. Second
registration of the same name:

```
$ node collide4.mjs
instance-A: registered OK
instance-B: THREW Error: tool "agent_teams_create" is already registered (for a per-agent variant, register through that agent's `agent.ctx` instead)
```

Both `agent-teams` rows are global rows, so both land in the same `ToolLayer`. The second
instance fails to mount. Additionally each instance builds its captain prompt from **its
own** `config.profiles` (`index.js`: `captainPrompt: () => usageSectionText(..., formatProfilesForPrompt(config.profiles ?? {}))`,
and `registerAgentTeamsCommand(commandCtx, () => config.profiles ?? {})`), so two rows
would also split the profile listing and the slash command instead of unioning them.

## 6. Consequence for t3 (decision needed, not a silent workaround)

Allowed: every other silicon row (mpd-verif, mcp-lsp, wave-mcp, skill providers) is a
**new `- insert:` row id** — additive, zero-interference, proven by Probe C's home layer.

Forbidden: any silicon-side patch carrying `id: agent-teams`; and a second agent-teams row.

Therefore exactly one row must own `config.profiles` for a profile to see both `mpd` and
`rtl-ip`. Since the whole-value replacement is per top-level key, two bundles cannot each
"contribute a key" to that row:

1. mpd's `agent-teams` row carries both `mpd` **and** `rtl-ip` (needs a small mpd-side
   change — `!!js` `require`/read of a well-known silicon-provided path with a try/catch
   defaulting to `{}` would let silicon stay a pure data drop, but that is a t1/mpd-side
   decision);
2. mpd owns `agent-teams`, silicon ships its rtl-ip profile definition as a
   documented data file consumed by mpd (no patch at all), or
3. silicon's bundle declares a distinct row id only if the plugin is made
   multi-instance-safe (out of t3's scope; would need tool-name prefixing in mpd's plugin).

Option 1/2 keep the plugin single-instance and are the only shapes that satisfy the
captain's "t7 must see 7 rtl-ip members in `dsh --dump-config`" gate.

## Reproduction

The probe home is throwaway (`DSH_HOME=$(mktemp -d)`); real `~/.dsh` and both repos'
state were never touched. Re-run with the four probe patch files described in §2/§4 and
`node collide4.mjs` for §5.
