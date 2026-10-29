#!/usr/bin/env bash
# Throwaway reproduction of the patch-loader semantics probes recorded in
# loader-semantics.md (t3 pre-work). Everything runs under a mktemp DSH_HOME:
# the real ~/.dsh and both repos are never modified. Usage: bash repro.sh
set -uo pipefail
export DSH_HOME="$(mktemp -d)"
echo "DSH_HOME=$DSH_HOME"
mkdir -p "$DSH_HOME/profiles/probe"

cat > "$DSH_HOME/profiles/probe/package.json" <<'JSON'
{ "name": "probe-profile", "private": true, "type": "module", "dsh": { "profile": { "bundles": [] } } }
JSON

# Layer 1 stands in for the mpd bundle: it inserts the agent-teams row.
cat > "$DSH_HOME/profiles/probe/cordis.patch.yml" <<'YAML'
- insert:
    - id: agent-teams
      name: 'probe-agent-teams'
      config:
        stateDir: .mpd/team
        profiles:
          mpd:
            description: "MPD roster"
            taskPlanning: captain
            members:
              - name: Architect
                role: architecture review
                provider: deepseek-official
                model: deepseek-v4-pro
YAML

echo '=== PROBE A: same id: agent-teams in the home layer (whole-config replacement) ==='
cat > "$DSH_HOME/cordis.patch.yml" <<'YAML'
- id: agent-teams
  name: 'probe-agent-teams'
  config:
    stateDir: .mpd/team-silicon
    profiles:
      rtl-ip:
        description: "RTL IP swimlane roster"
        taskPlanning: captain
        members:
          - name: Spec Designer
            role: spec
            provider: deepseek-official
            model: deepseek-v4-pro
YAML
dsh --profile probe --dump-config
echo "[exit $?] — mpd profile is GONE (no deep merge)"

echo
echo '=== PROBE B: id + insert: targeting the non-group agent-teams row ==='
cat > "$DSH_HOME/cordis.patch.yml" <<'YAML'
- id: agent-teams
  insert:
    - id: agent-teams-silicon
      name: 'probe-agent-teams'
      config:
        profiles: { rtl-ip: { description: x } }
YAML
dsh --profile probe --dump-config
echo "[exit $?] — insert skipped: row is not a group"

echo
echo '=== PROBE C: distinct row ids, same module name ==='
cat > "$DSH_HOME/cordis.patch.yml" <<'YAML'
- insert:
    - id: agent-teams-silicon
      name: 'probe-agent-teams'
      config:
        stateDir: .mpd/team-silicon
        profiles:
          rtl-ip:
            description: "RTL IP swimlane roster"
            taskPlanning: captain
            members:
              - name: Spec Designer
                role: spec
                provider: deepseek-official
                model: deepseek-v4-pro
YAML
dsh --profile probe --dump-config
echo "[exit $?] — loader accepts both rows; mounting them still collides (see PROBE D)"

echo
echo '=== PROBE D: duplicate global tool registration (see collide4.mjs beside this file) ==='
node "$(dirname "$0")/collide4.mjs"
echo "[exit $?] — second instance cannot mount: tool already registered"
