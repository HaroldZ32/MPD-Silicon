# RTL Gap Assessment — my-power-dsh for Digital-Logic (Verilog/SystemVerilog) Development

**English** | [中文](./rtl-gap-assessment.zh-CN.md)

Assessment of what the current my-power-dsh bundle still lacks for digital-logic RTL
development, aimed at an IC engineer interested in AI-assisted HDL work ("vibe coding"
for hardware, with automated validation). Evidence base: (a) bundle capability inventory,
(b) a 36-item RTL workflow reference surface (W-1..W-36) spanning open-source (OS) and
commercial (CX) toolchains, (c) a gap framework with three AI-usage-mode feedback loops.
This document is an assessment only — it makes no code changes.

---

## 1. Executive summary (TL;DR)

**Verdict: my-power-dsh today can *write* RTL text but cannot *validate* it. The minimum
viable AI-RTL loop — generate → check → simulate → evidence → improve — is broken at step 2
(lint/elaboration).** The bundle has no Verilog/SystemVerilog awareness anywhere in its
language-support surface:

- **ast-grep MCP**: exactly 25 languages, no Verilog/SystemVerilog.
- **LSP MCP**: 42 built-in servers, none HDL — no verible/svls/slang/hdl_checker is built in
  and `lsp-setup` has no HDL route; a Verilog/SV LSP **can** however be wired today through
  the LSP MCP's project/user JSON config seam (`lsp-client.json` with `command` +
  `extensions`) with no plugin change.
- **codegraph MCP**: 29 tree-sitter grammars, no Verilog grammar — cannot index `.v`/`.sv`.
- **Skill corpus**: 19 skills, none RTL-specific; `programming` covers only
  `.py/.rs/.ts/.go`; `lsp-setup` has no HDL route.
- **Golden fixtures**: `tests/golden/fixtures/verilog/` (adder4.v, cnt8.v, tb_adder4.v)
  exist but their README states "No simulator needed" — the bundle has *never* linted,
  elaborated, or simulated its own Verilog.

What **is** present and genuinely useful is a generic agent substrate: bash (any user
toolchain), fs tools, teams/workflow orchestration, ulw/boulder/memory disciplines,
git-master + svn-master skills, dsh-qa evidence discipline, and grep.app code search (the
only RTL-code discovery channel). All of these are language-agnostic.

The fix is cheap and bundle-shaped. P0 closes the blocking loop with a `skills/rtl-dev`
skill + two MCP-row wrappers (lint/elaboration gate, simulator+testbench run gate with
pass/fail evidence). P1 wires Verilog/SV LSP, waveform/coverage regression evidence, and
cocotb harness patterns. P2 adds EDA flow scaffolds and a UVM verification-assistant
skill. Dual-toolchain stance: the open stack (iverilog/verilator/yosys/cocotb/verible) is
fully bundle-able via PATH/env-resolved wrappers; commercial EDA (VCS/Xcelium/Questa,
Verdi, SpyGlass, Design Compiler, PrimeTime) stays user-environment-only, per commercial
EDA licensing reality (this repository's own code is MIT; no commercial EDA tool is
redistributed or implied).

---

## 2. Current state by layer (what exists today)

Verdicts: **PRESENT** = works today with bundle evidence · **PARTIAL** = manual
configuration or host-side help needed · **ABSENT** = no bundle surface at all.
Evidence is from the capability inventory (see Appendix A2 for file paths).

| Layer | Capability in the bundle today | Verdict | Evidence (inventory) |
|---|---|---|---|
| **A — Coding assistance** | RTL code generation from the model | **PRESENT** | LLM-native; DeepSeek dual-track model; Verilog is a model capability, not a bundle feature |
| A | Generic authoring tools (bash, read/write/edit, glob/grep, hashline anchored edits) | **PRESENT** | Preset `mpd` host tools; `mpd-hashline-plugin` |
| A | HDL syntax/lint gate (verible / verilator `--lint-only` / iverilog `-tnull`) | **ABSENT** | ast-grep has no Verilog/SV language; no wrapper MCP row; golden fixtures never syntax-checked |
| A | Auto-format (verible-verilog-format) | **ABSENT** | No format wrapper; ast-grep rewrite cannot touch `.v/.sv` |
| A | Verilog/SV language server (verible-verilog-ls, svls, slang, hdl_checker) | **ABSENT** | `mcp-lsp` built-in server list has no HDL server; `skills/lsp-setup/references/` has no verilog/systemverilog entry |
| A | HDL-aware structural code search/rewrite | **ABSENT** | ast-grep 25-language enum ends at `yaml`; codegraph has no `.v/.sv` grammar |
| A | RTL template/boilerplate knowledge (FIFO/FSM/ALU patterns, style guides) | **ABSENT** | No RTL skill in the shipped corpus |
| **B — Functional verification** | Simulator + testbench run gate with pass/fail evidence | **ABSENT** | No simulator MCP row; bash can call a user toolchain but there is no structured wrapper, no `.mpd` evidence capture |
| B | Lint/sim feedback → prompt improvement channel | **PARTIAL** | `mpd-memory` (git-backed, reflection) stores lessons generically, but nothing *produces* RTL lint/sim failure signals |
| B | Coverage collection (line/toggle/functional) | **ABSENT** | No verilator_coverage / urg wrapper; nothing reads `.dat`/`.vdb` |
| B | Waveform evidence (VCD/FST production + analysis) | **ABSENT** | No simulator flag wrapper, no VCD parsing; GTKWave viewing itself is host-level (not bundle-relevant) |
| B | Assertions (SVA) — *writing* | **PARTIAL** | The model writes SVA text, but no run gate ever checks it |
| B | UVM / constrained-random — *writing* | **PARTIAL** | Codegen only; no `+UVM_TESTNAME` run, no report parsing |
| B | Python TB (cocotb) / unit tests (SVUnit) | **ABSENT** | No harness wrapper; `programming` skill covers Python generally but has no cocotb route |
| B | Regression automation for RTL | **PARTIAL** | Generic jobs/subagents/workflow can orchestrate, but no RTL-aware runner (file lists, JUnit mapping, coverage merge) exists |
| B | Formal verification (SymbiYosys `sby`, equiv) | **ABSENT** | No wrapper; user can only shell out by hand |
| **C — Front-end flow** | Synthesis (Yosys `.ys`, commercial `dc_shell`) | **ABSENT** | No Yosys MCP/skill; commercial tools are license-gated (user-env only) |
| C | SDC constraints + STA (OpenSTA, PrimeTime) | **ABSENT** | No constraint-lint or timing-report tooling |
| C | CDC verification (SpyGlass CDC etc.) | **ABSENT** | Open-source track has no mature CDC lint at all (reference-surface gap, not just a bundle gap); commercial track is license-gated |
| C | Power intent (UPF IEEE 1801) | **ABSENT** | No open UPF flow exists; commercial only |
| C | DFT/ATPG | **ABSENT** | No mature open tooling; commercial only |
| **D — Engineering flow** | Orchestration substrate (agent-teams, workflow, ulw/boulder, memory) | **PRESENT** | Adopted agent-teams plugin; `mpd-ulw` / `mpd-boulder` / `mpd-memory` tools |
| D | RTL-aware flow gates (lint/sim as completion criteria) | **ABSENT** | ulw criteria are generic; no lint/sim gate exists to plug in |
| D | Flow scaffolds (filelist/make, FuseSoC/Edalize, vendor Tcl wrappers) | **ABSENT** | bash can hand-run anything, but no scaffold knowledge or helpers ship |
| D | VCS integration (Git, SVN) | **PRESENT** | git-master + svn-master skills (SVN still common in EDA flows) |
| D | QA evidence discipline reusable for RTL | **PARTIAL** | dsh-qa skill is rigorous but has zero RTL cases; no RTL evidence domain |
| D | RTL code discovery | **PARTIAL** | grep.app remote search retrieves real-world Verilog/SV; context7 docs are generic; codegraph cannot index `.v/.sv` |

---

## 3. Gap matrix (layer × capability, OS + CX reference, why it matters)

Each row maps a capability to its open-source reference (W-n) and commercial reference,
gives the bundle verdict, and says why it matters for AI-RTL feedback loops. Reference
numbers W-1..W-36 come from the workflow reference surface (Appendix A1).

| Layer / capability | OS reference | CX reference | Bundle verdict | Why it matters for AI-RTL loops |
|---|---|---|---|---|
| A1 Syntax + lint gate | W-1 (verible-verilog-lint, svlint, verilator `--lint-only`) | W-2 (SpyGlass Lint, Ascent Lint, HDL Checker) | **ABSENT** | Loop step 2. Without an exit-coded, line-addressed lint pass, generated RTL is accepted blind — "vibe coding" with zero feedback. Blocking. |
| A2 Elaboration/parse feedback | W-6 (slang `--ast-json`, Surelog/UHDM, sv2v) | — (embedded in CX IDEs) | **ABSENT** | AST JSON is the machine-parseable signal that lets the agent *understand* failures instead of grep-guessing. |
| A3 Language server (diagnostics/navigation) | W-4 (verible-verilog-ls, svls, svlangserver, slang LSP) | W-5 (no mature CX standard) | **ABSENT** | LSP over stdio gives editor-grade fix-loop feedback (diagnostics → localized edit). Closable by configuration only. |
| A4 Auto-format | W-3 (verible-verilog-format, svformat) | — (vendors ship style checkers, not formatters) | **ABSENT** | Deterministic formatting makes diffs reviewable and idempotent re-runs stable. |
| A5 Templates/style knowledge | W-7 (snippets, TerosHDL templates; style guides in W-1) | — | **ABSENT** | Skill-level knowledge raises first-pass quality of FIFO/FSM/ALU boilerplate. |
| B1 Simulation run gate | W-9 (Verilator, Icarus) | W-10 (VCS, Xcelium, Questa) | **ABSENT** | Loop step 3. No pass/fail capture means generated RTL is never executed. Blocking. |
| B2 Waveform evidence | W-11/W-12 (VCD/FST, GTKWave) | FSDB/VPD/WLF, Verdi/SimVision | **ABSENT** (host viewing not bundle-relevant) | VCD→text/JSON diffs close the loop: the agent sees *where* the sim diverged. |
| B3 Coverage evidence | W-13/W-15 (verilator_coverage, covergroups) | W-14 (VCS `urg`, IMC, vcover) | **ABSENT** | Coverage-gap feedback ("which states never exercised") drives testbench improvement. |
| B4 Assertions (SVA) execution | W-16 (Verilator `--assert`, SymbiYosys formal) | full SVA/PSL + assertion debug | **PARTIAL** (write-only) | Assertions are only worth what a run gate checks; today they are dead text. |
| B5 UVM execution | W-17 (uvm-core, uvm-verilator, pyuvm) | full UVM + VIP | **PARTIAL** (write-only) | Verification-assistant mode needs `+UVM_TESTNAME` runs + report (HTML/XML) parsing, not just codegen. |
| B6 Python TB (cocotb) | W-18 (cocotb; strongest OS automation surface) | — | **ABSENT** | cocotb+pytest is the cheapest high-value path to automated, agent-friendly TB loops. |
| B7 Regression automation | W-19/W-20 (SVUnit, VUnit, rtl_buddy) | vManager, Questa verify | **PARTIAL** | Generic orchestration exists; what is missing is the RTL-aware runner (test lists → logs → JUnit/coverage). |
| B8 Formal verification | W-21 (SymbiYosys `sby`, yosys `equiv_*`) | W-22 (JasperGold, VC Formal, Conformal/Formality) | **ABSENT** | `sby` proves small properties end-to-end with counterexample VCD — a later-stage amplifier. |
| C1 Synthesis | W-23 (Yosys + ABC, slang frontend) | W-24 (DC, Genus, Vivado/Quartus) | **ABSENT** | Closes the RTL→netlist leg; enables `equiv_*` LEC and "does it synthesize" gating. |
| C2 SDC + STA | W-25/W-26 (OpenSTA, OpenTimer) | PrimeTime, (DC/Genus STA) | **ABSENT** | Timing feedback (slack reports) turns synthesis runs into actionable fixes. |
| C3 CDC verification | — (no mature open CDC lint; W-28) | W-28 (SpyGlass CDC, Questa CDC, JasperGold CDC) | **ABSENT** | Cross-clock bugs are the highest-value lint class for SoC work; open track cannot close this — commercial, user-env only. |
| C4 Power intent (UPF) | — (no mature open flow; W-27) | W-27 (DC/Genus power-aware, SpyGlass Power) | **ABSENT** | Same as CDC: a real gap in the open ecosystem; bundle can only wrap user-licensed tools. |
| C5 DFT/ATPG | — (W-29: no mature open DFT) | W-29 (DFT Compiler, Tessent, Modus) | **ABSENT** | Not closable open-source; document as user-env-only from the start. |
| D1 Flow automation | W-31 (Make/CMake, Edalize, FuseSoC) | Tcl scripts (dc_shell/xrun/vsim) | **ABSENT** | File-list/make scaffolds + tool invocation are what turn single sims into repeatable flows. |
| D2 CI/regression gates | W-32 (GH Actions/GitLab CI + open tools) | Jenkins + vManager/Questa verify | **PARTIAL** | dsh-qa proves the evidence discipline; it just has no RTL case to gate on yet. |
| D3 IP/design library mgmt | W-33 (FuseSoC catalogs, IP-XACT) | Methodics IPLM, Cliosoft SOS | **ABSENT** | Only matters at multi-IP SoC scale; P2+. |
| D4 Version control | W-34 (Git/LFS, SVN, pre-commit lint) | SOS bridges | **PRESENT** | git-master + svn-master skills cover both common EDA VCS backends. |
| D5 Agent orchestration of the whole flow | W-36 (MCP wrappers, pyvcd/vcdvcd, pyverilog) | — | **PARTIAL** | This is the exact integration surface my-power-dsh consumes; substrate present, RTL gates absent. |

---

## 4. The three feedback loops (AI-usage modes)

### 4.1 Loop 1 — AI-generated RTL (codegen → lint → sim → coverage → improve)

Step-by-step status against the bundle:

| Loop step | Status | Missing link |
|---|---|---|
| 1. Codegen | **PRESENT** | Model-native; not a bundle gap. |
| 2. Syntax/lint gate | **ABSENT — BLOCKING** | No Verilog/SV grammar anywhere (ast-grep 25 langs; LSP list has no HDL server; codegraph 29 grammars without verilog). No wrapper for verilator `--lint-only` / iverilog `-tnull` / verible. The bundle's own golden fixtures are never syntax-checked — their README admits "No simulator needed". |
| 3. Elaboration/sim gate | **ABSENT — BLOCKING** | No simulator MCP row, no testbench run wrapper, no pass/fail capture into `.mpd` evidence. |
| 4. Coverage/waveform evidence | **ABSENT** (non-blocking: P0-4 establishes the pass/fail baseline; full coverage/waveform regression evidence closes at P1-2) | No VCD/FST production flags, no coverage collection; `mpd-memory` can store evidence but nothing produces RTL evidence. |
| 5. Prompt improvement | **PARTIAL** | `mpd-memory` + reflection store lessons generically; the missing link is a structured channel that feeds lint/sim failure text back into the next generation round (the skill closes this: failure log → note → re-run). |

Concrete consequence: an AI-written counter or FIFO is accepted on faith today. For an IC
engineer, that is not "assisted design", it is unsafe text generation.

### 4.2 Loop 2 — Verification assistant

Today the bundle is a **writer, not an assistant**: it can emit testbenches, SVA
assertions, and UVM scaffolding as text (W-16/W-17 references), but it can neither run
them nor triage failures. Closing evidence-backed steps:

- **Run**: wrap iverilog/verilator (W-9) or cocotb (W-18) — cocotb+pytest is the strongest
  open automation surface and maps cleanly onto the existing `programming` skill's Python
  discipline.
- **Measure**: verilator `--coverage-line/--coverage-toggle` + `verilator_coverage` (W-13)
  or, for UVM users, `+UVM_TESTNAME` + UVM report server XML (W-17) parsing.
- **Triage**: VCD→JSON/text conversion (pyvcd/vcdvcd, W-36) so the agent can diff golden
  vs. observed waveforms and localize the failing cycle instead of re-reading raw dumps.

### 4.3 Loop 3 — Flow automation

The orchestration substrate is **PRESENT and strong** (agent-teams, workflow, subagents,
ulw plan/execute, boulder ledger, memory + reflection). What is missing is RTL-shaped
**gate content**: lint/sim pass as ulw or workmate completion criteria, file-list/make
scaffolds (W-31), regression runners mapping test lists → JUnit/coverage (W-20/W-32), and
pre-commit format+lint hooks (W-34). Host bash can hand-run any tool today — the gap is
*structured gating and scaffolds*, not raw capability.

**Dual-toolchain note (both angles covered)**: the open stack (iverilog, verilator, yosys,
cocotb, verible, gtkwave, symbiyosys) is fully wrappable as PATH/env-resolved MCP rows with
graceful degradation when a binary is absent — exactly the ast-grep convention. The
commercial stack (VCS/Xcelium/Questa, Verdi, SpyGlass/JasperGold, DC/Genus, PrimeTime,
Tessent) is license-gated by its vendors: the bundle can only ship *generic
command wrappers resolved from the user's environment*, never bundled or vendored tooling.

---

## 5. Prioritized roadmap

Ordered by risk tier (t3 framework): **P0** = blocking for the minimum viable AI-RTL loop ·
**P1** = high value, loop still runs without it · **P2** = nice-to-have. Effort: S / M / L.
Integration shapes: **MCP row** (wrapper around a CLI, PATH/`MPD_DSH_*`-resolved),
**skill** (SKILL.md + references + golden fixtures + dsh-qa case), **LSP wiring**
(config-only), **plugin** (only when a stateful gate must be enforced — minimal-diff rule).

| P | Item | Effort | Shape | Closes |
|---|---|---|---|---|
| P0-1 | `skills/rtl-dev`: codify the loop discipline (lint → sim → evidence → fix), style guides, FIFO/FSM/ALU patterns, golden-fixture regression using the existing `tests/golden/fixtures/verilog/` | S | **skill** (+ dsh-qa case script) | Loop 1 step 5; makes A5, B4/B5 *writing* quality real |
| P0-2 | Verilog/SV syntax+lint gate: wrapper invoking verilator `--lint-only` / iverilog `-tnull` / verible-verilog-lint with exit-code + line diagnostics | S–M | **MCP row** (Pattern A) | Loop 1 step 2 (unblocks) |
| P0-3 | Simulator + testbench run gate: iverilog/verilator run, pass/fail + log capture written to `.mpd` evidence + memory | M | **MCP row** (Pattern A) | Loop 1 step 3 (unblocks) |
| P0-4 | Wire P0-1..3 into the golden fixtures as an executable dsh-qa RTL case (first real gate ever run on adder4.v/cnt8.v) | S | skill + dsh-qa case | Loop 1 step 4 baseline; D2 |
| P1-1 | Verilog/SV LSP reference: add verible-verilog-ls / svls / hdl_checker entries to `skills/lsp-setup/references/` | S | **LSP wiring** (config-only; daemon is generic) | A3 |
| P1-2 | Waveform/coverage evidence: VCD→JSON/text regression diff + verilator coverage capture in the skill | M | skill + small MCP helper | Loop 1 step 4; B2/B3 |
| P1-3 | cocotb harness pattern: Python TB template + pytest mapping inside `skills/rtl-dev` | M | skill | Loop 2 run leg; B6 |
| P1-4 | codegraph `.v/.sv` support: verify grammar coverage and document (or close) | S | verification + doc (Pattern D) | D5 cross-cut |
| P2-1 | EDA flow scaffolds: filelist/make, FuseSoC/Edalize invocation notes, vendor Tcl wrapper examples resolved from user env | M–L | skill (user-env only) | D1; C1/C2 entry points |
| P2-2 | UVM/SV verification-assistant skill: UVM test templates, `+UVM_TESTNAME` run + report parsing, VIP usage notes | M | skill | Loop 2 UVM leg; B5/B7 |
| P2-3 | RTL workmate template: persona with lint+sim-gate discipline for recurring RTL sessions | S | workmate init (roster base) | Loop 3 repetition |
| P2-4 | SymbiYosys/Yosys wrappers: `sby` property check + yosys synth/`equiv_*` | M | MCP row | B8; C1 leg |
| P2-5 | Stateful gate enforcement: lint+sim must pass before ulw/workmate completion | M | **plugin** (only if P0 wrappers are not enough — last resort per minimal-diff rule) | Loop 3 hard gate |

Top single recommendation: **close the P0 chain first — `skills/rtl-dev` (P0-1) + the two
MCP gate rows (P0-2/P0-3) + the first executable golden regression (P0-4)**. Everything
after that is an amplifier, not a prerequisite.

---

## 6. Constraints & compliance

- **License (MIT)**: this repository's own code is MIT (see `LICENSE`); the constraint on
  commercial EDA wrappers comes from the vendors' licenses, not from this repository.
  Consequence: commercial EDA wrappers (VCS/DC/SpyGlass/PrimeTime…) may only be
  *user-environment command wrappers* — never bundled, never vendored, no license
  assumption in the bundle.
- **No binary vendoring**: copyleft/open toolchains (iverilog GPL-2.0, verilator
  LGPL-3.0/Artistic-2.0, yosys ISC) and EDA tools are resolved from system PATH or
  `MPD_DSH_*`-style env at runtime with graceful degradation when absent — the existing
  ast-grep/codegraph resolution convention. This also keeps the installable bundle
  relocatable.
- **Upstream parity / no scope creep**: the capability baseline is pinned to upstream
  `8c57e46` (v5.0.0-beta.20) and is not chased. The RTL surface recommended here is
  *net-new* capability justified by the explicit goal of this assessment; it does not
  alter any upstream parity item.
- **Minimal diffs (Principle 6)**: recommended changes are skills and MCP-row wrappers by
  default; a new `mpd-*` plugin is sanctioned only for P2-5 (stateful gate enforcement),
  and even that only if wrapper-level gating proves insufficient.
- **Bundle-shaped, not script-shaped**: every recommendation takes a form the bundle
  already understands (skill via mpd-bootstrap, MCP row via the bundle patch, LSP
  reference via `lsp-setup`, workmate via `mpd_workmate_*`).
- **Bilingual docs policy**: this report ships as an EN + 简体中文 pair with switch links
  under the titles; agent-facing prose is English-only.
- **Not bundle-relevant (explicitly out of scope)**: commercial EDA license management,
  simulation-farm compute, desktop GUI waveform viewers (GTKWave/Verdi), proprietary
  PDK/IP access.

---

## 7. Appendix — evidence links

- **A1 — Workflow reference surface (W-1..W-36)**: team task t1 output (Researcher) —
  four layers (A coding assistance, B functional verification, C front-end flow,
  D engineering flow), each item OS+CX with cited sources (verible, svlint, slang, svls,
  verilator, iverilog, GTKWave, cocotb, VUnit, SymbiYosys, Yosys, OpenSTA, FuseSoC,
  Edalize; SpyGlass, VCS/Xcelium/Questa, Verdi, JasperGold, DC/Genus, PrimeTime,
  Tessent, Methodics/SOS).
- **A2 — Capability inventory**: team task t2 output (Explorer). Key file evidence:
  this bundle's `packages/mpd-bundle/cordis.patch.yml` (MCP rows mcp-astgrep/
mcp-lsp/mcp-codegraph,
  context7, grep_app, 13 mpd plugins, adopted agent-teams); ast-grep language list
  (`skills/ast-grep/scripts/ast_grep_helper.py`, 25 languages, no Verilog/SV);
  `packages/mpd-mcp-lsp/dist/cli.js` (silicon-owned; shipped in this bundle) built-in server
list (42, no HDL server);
  codegraph wasm grammar dir (29 grammars, no verilog); shipped skills list (19 skills,
  none RTL); `tests/golden/fixtures/verilog/` + `docs/adder4.md` + `docs/cnt8.md`
  ("No simulator needed"); `evidence/p5/` golden batch (Verilog written but never
  compiled/simulated/linted).
- **A3 — Gap framework & loops**: team task t3 output (Architect) — dimensions D1 (loop
  stage), D2 (capability ladder), D3 (evidence contract); BLOCKING/HIGHLY VALUABLE/
  NOT-bundle-relevant tiering; integration patterns A–E; prioritization skeleton adopted
  in Section 5.
- **Team outputs**: full t1/t2/t3 text lives in the team state
  (`.mpd/team/rtl-gap-assessment/team.json`, task outputs) for the reviewer's spot-check.
