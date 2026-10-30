# RTL Style Checklist (verilog-generator / Erie)

Read-only review gates. Run this checklist before delivering generated or
modified RTL, and report every failed item (with file:line) before proposing
edits. Severity labels: `BLOCKER` = cannot deliver without a fix or an explicit
user waiver; `WARNING` = deliverable only while the risk stays visible;
`NOTE` = optional maintainability improvement.

## Must answer yes

1. Does the module use an ANSI header — parameters first, then ports — with no
   `wire`/`reg`/`logic` keywords inside the port list?
2. Do ports use `i_` (input), `o_` (output), `io_` (inout) prefixes, except
   approved vendor/wrapper ABI ports?
3. Do parameters use `C_*`, state localparams use `ST_*`, and internal signals
   use `reg_`/`cnt_`/`state_`/`flag_`/`enc_`/`dec_` semantic prefixes?
4. Are there no repeated semantic prefixes (`C_C_`, `ST_ST_`, `reg_reg_`, ...)?
5. Are registered/complex outputs driven through internal `_o` signals with an
   explicit `assign o_* = *_o;` bridge (no `output reg` in the ANSI header)?
6. Are port groups ordered by direction first, then by protocol channel
   (clock/reset, control, data, response)?
7. Are region banners present in the fixed order for the structures that exist?
8. Does each combinational `always @(*)` block use **blocking** assignments and
   cover all branches with safe defaults?
9. Does each sequential `always @(posedge ... or negedge ...)` block use
   **non-blocking** assignments and model async reset on the matching edge?
10. Is every FSM strictly three-process: P1 combinational next-state (blocking,
    `default` + final `else` closure), P2 sequential state register, P3
    independent output/task block? No `assign state_next = ...`.
11. Is the state encoding `localparam ST_*` with explicit `state_current` and
    `state_next` registers?
12. Does every case have an explicit `default` branch?
13. Are instance names suffixed `_Inst`, generate branches labeled `gen_*`, and
    port maps named (never positional)?
14. Do clock/reset names follow the bus family (`i_clk`/`i_rstn`,
    `i_axi_aclk`/`i_axi_arstn`, `i_axis_aclk`/`i_axis_arstn`,
    `i_ahb_hclk`/`i_ahb_hrstn`, `i_apb_pclk`/`i_apb_prstn`)?
15. Is the file Tab-indented, `//`-comment-only, with a trailing final newline
    and no trailing whitespace?

## Must answer no

1. Are outputs assigned directly inside `always` blocks instead of via `_o` +
   `assign` bridge?
2. Is there any `assign state_next = ...` continuous assignment?
3. Are blocking and non-blocking assignments mixed in one `always` block?
4. Are there inline `wire` assignments, block comments (`/* */`), space
   indentation, or missing final newline?
5. Are generic placeholder/fallback comments present where real signal meaning
   is known (e.g. bare `parameter`, `port signal`, `assign`)?
6. Are entity comments exact or near-duplicate copies of one another?
7. Does a case/if chain leave an uncovered branch (missing default / missing
   final else)?
8. Are simulation-only constructs (`initial`, `#delay`) present in synthesizable
   RTL source?

## External lint signals

Run at least one independent linter when available and treat its findings as
supplementary signal (not as a replacement for this checklist):

- `verible-verilog-lint` (Verible LSP ships the same ruleset)
- `verilator --lint-only`
- `slang --lint-only`
