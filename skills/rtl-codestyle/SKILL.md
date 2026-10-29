---
name: rtl-codestyle
description: "Author and review synthesizable Verilog/SystemVerilog RTL in the verilog-generator (Erie) style referenced by the rtl-dev phase-1 owner decision: i_/o_/io_ port prefixes, C_ parameters, ST_ state localparams, reg_/cnt_/state_/flag_/enc_/dec_ internal prefixes, internal _o suffix with an assign bridge to o_ ports, ANSI module header, port groups by direction then protocol, fixed ordered region banners, a hard 3-process FSM (state_current/state_next, blocking next-state, explicit default + else closure), and //-only trailing-aligned comments. Trigger for writing new RTL modules, parameterizing datapath widths, adding/completing FSMs, or reviewing existing Verilog for style compliance."
---

# RTL Code Style (verilog-generator / Erie style)

Style contract for writing readable, synthesizable Verilog-2001 RTL in the style
referenced by the rtl-dev phase-1 owner decision (`github.com/Eriemon/verilog-generator`,
Erie ruleset). Use this skill in coding sessions whenever you generate, extend, or
review a `.v` RTL module: the module skeleton, parameterization conventions, style
checklist, and comment conventions below are the deliverable norm.

The skill is **English-only agent-facing content** (AGENTS.md language policy). The
upstream reference itself ships a fixed bilingual file header (English + Chinese);
if a project adopts that header, keep it as the file's very first comment block and
treat its content as project metadata, not code commentary.

---

## Route

- `create/write`: confirm the module contract (name, clock/reset, ports, behavior,
  pipeline expectation, interface family), then generate from
  `templates/module_skeleton.vinc`.
- `parameterize`: derive widths from the `C_` parameter model
  (`templates/parameterized_counter.vinc`).
- `fsm`: use the hard 3-process FSM shape (`templates/fsm_3process.vinc`).
- `review/analyze`: run the `references/style-checklist.md` gates read-only and
  report the failed items before proposing edits.

## Module Skeleton (templates/module_skeleton.vinc)

Load the skeleton and fill it in order:

1. **File header** — one comment block at the top (English; add the bilingual block
   only if the project norm requires it).
2. **Module name** — descriptive PascalCase; bus/controller wrappers may append
   `_Interface`.
3. **ANSI header** — parameters first (`C_*`), then ports, grouped **by direction
   first** (`i_` inputs, `o_` outputs, `io_` bidir), then **by protocol channel**
   (clk/reset, control channel, data channel, response channel).
4. **Region banners** — fixed ordered banners in the body, e.g.:
   `// configuration parameter region`, `// state parameter region`,
   `// counter signal region`, `// state-machine signal region`,
   `// register signal region`, `// flag signal region`, `// output signal region`,
   `// output assign region`, `// state-machine region`, `// state transition region`,
   `// output processing region`, `// module instantiation region`.
5. **Outputs** — internal `_o` reg/wire drives an explicit `assign o_* = *_o;`
   bridge; do not declare `output reg` in the ANSI header.
6. **FSM** — see `templates/fsm_3process.vinc`.

## Naming Conventions

- Ports: `i_` input, `o_` output, `io_` bidirectional.
- Parameters: `C_<NAME>` uppercase (e.g. `C_DATA_WIDTH`, `C_COUNT_WIDTH`).
- State localparams: `ST_<NAME>` uppercase.
- Internal signals: semantic prefix — `reg_`, `cnt_`, `state_`, `flag_`, `enc_`, `dec_`.
- Internal output drivers: `_o` suffix (`phase_data_o`), bridged by `assign o_* = *_o;`.
- Instances: `_Inst` suffix; `generate` branches labeled `gen_*`; named port mapping.
- No repeated prefixes (`C_C_`, `ST_ST_`, `reg_reg_`, `state_state_` are invalid).
- Clocks/resets per bus family: `i_clk`/`i_rstn`, `i_axi_aclk`/`i_axi_arstn`,
  `i_axis_aclk`/`i_axis_arstn`, `i_ahb_hclk`/`i_ahb_hrstn`, `i_apb_pclk`/`i_apb_prstn`.

## Hard 3-Process FSM

- Explicit `state_current` / `state_next` registers.
- Encoding via `localparam ST_*`.
- Three blocks, strictly separate:
  1. combinational next-state (`always @(*)`, **blocking** `=`, default keep + final
     `else` closure on every `if/else if` chain, `default: begin ... end` in case);
  2. sequential state register (`always @(posedge i_clk or negedge i_rstn)`,
     non-blocking `<=`);
  3. independent output/task block.
- `assign state_next = ...` is forbidden.

## Style Conventions (recap)

- Tab indentation; `always @(posedge ... or negedge ...) begin ... end` style
  (open `begin` on the same line as the condition).
- `//`-only comments; trailing comments aligned in columns.
- A pure leading comment sits directly above each `ST_*: begin` and `default: begin`
  branch, left-aligned, no blank line between comment and branch.
- Distinct semantic comments per entity (parameters, ports, signals, assigns,
  always blocks, instances) — region banners are navigation aids, not substitutes.

## Deliverables Checklist

Run `references/style-checklist.md` before handing off RTL. For verification flows,
see the `rtl-verif` skill (cocotb / UVM / backends).

## Resources

- `templates/module_skeleton.vinc` — full module skeleton with region banners.
- `templates/fsm_3process.vinc` — hard 3-process FSM.
- `templates/parameterized_counter.vinc` — parameterized widths from the `C_` model.
- `references/style-checklist.md` — read-only review gates.
- `references/comment-conventions.md` — comment placement/alignment rules.
