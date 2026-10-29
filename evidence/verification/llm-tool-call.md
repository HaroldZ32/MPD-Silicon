# LLM-driven tool call — `mpd_verif_*` through the real tool layer

**Executor**: captain · **Date**: 2026-09-13 · **Motivation**: the final acceptance ledger recorded
"no LLM-backed session was possible on this box" as a known limitation. That was measured on a
**non-interactive shell** (no provider key in `env`), but the key exists in `~/.bashrc` as
`export DEEPSEEK_API_KEY=…` — so a real model-driven session **is** possible, and this closes the
limitation for the tools exercised here.

## What was run

1. A provider key was read at runtime out of `~/.bashrc` (value never echoed, never written).
2. An isolated sandbox: `SB=$(mktemp -d)`, with `HOME=$SB DSH_HOME=$SB`, a workspace `$SB/ws`, the
   credentials file copied in, and a hand-built headless profile
   (`profiles/headless/package.json` with `dsh.profile.bundles = [dsh-base, dsh-headless]`).
3. The bundle under test was installed into that profile:
   `dsh plugin --profile headless add /root/dshProj/my-power-dsh-silicon`
   → `bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@mpd-dsh/silicon']`.
4. A real headless session was run with a prompt that asks the model to call two tools:
   ```
   dsh --profile headless "Call the mpd_verif_backends tool and tell me the exact iverilog path and
   version it reports. Then call mpd_verif_venv with action=status and report the verdict."
   ```
   Exit code 0.

## Transcript evidence (not inference)

The session transcript (`sessions/<projectKey>/session-*.v3.jsonl.zstd`, decompressed) contains
**2 `tool/call` records and 2 `tool/result` records**, plus the registration of all eight
`mpd_verif_*` tool names:

```
CALL  → mpd_verif_backends | args: {"backend": "all"}
RESULT→ {"turn":1,"step":1,"message":{"source":{"kind":"tool","callId":"call_00_ET_…"},"content":[
         {"type":"tool-result","toolCallId":"call_00_ET_…","content":[{"type":"text",
         "text":"mpd_verif_backends: i…

CALL  → mpd_verif_venv | args: {"action": "status"}
RESULT→ … {"type":"text","text":"mpd_verif_venv: venv …

tool-name registrations present in the transcript:
  mpd_verif_backends ×5 · mpd_verif_venv ×5 · mpd_verif_compile · mpd_verif_coverage
  mpd_verif_lint · mpd_verif_regress · mpd_verif_sim · mpd_verif_uvm   (all eight)
```

The model's answer, in the same run:

```
iverilog: present at `/opt/osscad/oss-cad-suite/bin/iverilog`, version `Icarus Verilog version 14.0 (devel) (s20260301-300-g3c3f46099-dirty)` (verilator 5.051 also present; vcs absent).
cocotb venv verdict: missing at `/tmp/tmp.HVuhFjAnwj/ws/.venv-rtl` — not created yet
```

Two details worth keeping:

- `mpd_verif_venv` reported the venv path **inside the sandbox workspace** — the isolation held.
- The same session's boot log shows the bundle's own rows doing their job:
  `[mpd-dsh-adapter] siliconDsh provided` and
  `[mpd-silicon-bootstrap] skill corpus served from /root/dshProj/my-power-dsh-silicon/skills
  (provider silicon-bundle, bundle 0.1.0)`.

## Scope of this evidence

- **Exercised through a model**: `mpd_verif_backends`, `mpd_verif_venv`.
- **Registered but not model-invoked in this run**: `compile`, `lint`, `sim`, `coverage`, `uvm`,
  `regress` — those have in-process coverage (`bun test packages/`, the shipped smoke script, and
  the t7/t9 real-toolchain runs) but not a model-driven call.
- The real `~/.dsh` was not touched; the sandbox is disposable.

## Reproduce

```bash
export DEEPSEEK_API_KEY=$(grep -m1 '^export DEEPSEEK_API_KEY=' ~/.bashrc | sed -E 's/^export DEEPSEEK_API_KEY=//')
SB=$(mktemp -d); mkdir -p "$SB/ws" "$SB/profiles/headless"; cp ~/.dsh/.credentials.yaml "$SB/"
cat > "$SB/profiles/headless/package.json" <<'EOF'
{ "name": "dsh-profile-headless", "private": true,
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }
EOF
HOME="$SB" DSH_HOME="$SB" dsh plugin --profile headless add <path-to-this-repo>
cd "$SB/ws" && HOME="$SB" DSH_HOME="$SB" dsh --profile headless "Call the mpd_verif_backends tool…"
# then decompress $SB/sessions/*/*/session.*.jsonl.zstd and grep for tool/call
```
