# cnt8 — 8-bit binary counter (load / en / rst_n)

> **Internal QA artifact** — golden-fixture reference doc (tests/golden/fixtures/verilog/modules/cnt8.v),
> not a user-facing doc; exempt from the bilingual policy (see AGENTS.md Language Policy + §3). Keep in sync with the
> fixture, not with product docs.

Source file: `tests/golden/fixtures/verilog/modules/cnt8.v`

`cnt8` is a synthesizable, Verilog-2001 compliant 8-bit binary counter with synchronous parallel
load (`load`), count enable (`en`), and asynchronous active-low reset (`rst_n`). All state updates
occur on the clock rising edge (except reset; see the timing notes below).

**Function**: on each clock rising edge, decisions are made in priority order — reset → load → count → hold.

## Port table

| Port | Direction | Width | Description |
|---|---|---|---|
| `clk` | input | 1 | Clock; state updates on the rising edge |
| `rst_n` | input | 1 | Asynchronous reset, active-low; highest priority |
| `en` | input | 1 | Count enable; when 1, increments by 1 on each clock edge |
| `load` | input | 1 | Synchronous load enable; when 1, captures `d` on the clock edge |
| `d` | input | 8 | Parallel load data, sampled on the `clk` rising edge |
| `q` | output | 8 | Current counter value (register output, always valid) |

## Timing notes

Control-signal priority (high to low): `rst_n` > `load` > `en`. When all three are inactive, `q` holds.

| Case | Trigger condition | Behavior |
|---|---|---|
| Reset | `rst_n` pulled low (any time, no clock required) | `q <= 0` (asynchronous) |
| Synchronous load | `rst_n=1` and `load=1` at a `clk` rising edge | `q <= d` |
| Count | `rst_n=1`, `load=0`, and `en=1` at a `clk` rising edge | `q <= q + 1` |
| Hold | `rst_n=1`, `load=0`, `en=0` | `q` unchanged |

### Key timing points

- **Reset is asynchronous**: once `rst_n` is pulled low, `q` clears immediately without waiting for a
  clock edge; releasing reset (pulling high) must avoid the region near the clock rising edge
  (recovery time) so synchronous logic has no metastability risk.
- **Load is synchronous**: `load` only needs to meet setup time before and hold time after the `clk`
  rising edge; `d` is captured into `q` on that same clock edge. When `load=1`, `en` is ignored
  (load takes priority).
- **Counting and wraparound**: with `en=1`, `q` increments by 1 on every clock rising edge; `q` is
  8 bits, so counting past `8'hFF` wraps to `8'h00` (modulo 256) with no separate carry output.
- **Setup/hold constraints**: `d`, `load`, and `en` must satisfy setup/hold times near the `clk`
  rising edge; except for reset, output changes occur only on the clock rising edge — standard
  single-clock synchronous design, directly synthesizable.

## Simple usage example

```verilog
module top (
    input  wire       clk,
    input  wire       rst_n,
    input  wire       en,
    input  wire       load,
    input  wire [7:0] d,
    output wire [7:0] q
);

    cnt8 u_cnt8 (
        .clk   (clk),
        .rst_n (rst_n),
        .en    (en),
        .load  (load),
        .d     (d),
        .q     (q)
    );

endmodule
```

### Typical control sequence

```
Reset    : rst_n = 0            -> q = 0
Count    : rst_n = 1, en = 1    -> each clock edge q goes 0,1,2,...,255,0,...
Preset   : load = 1, d = 8'hA5  -> next clock edge q = 8'hA5
Hold     : en = 0, load = 0     -> q holds its current value
```
