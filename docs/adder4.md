# adder4 — 4-bit Ripple-Carry Adder

> **Internal QA artifact** — golden-fixture reference doc (tests/golden/fixtures/verilog/modules/adder4.v),
> not a user-facing doc; exempt from the bilingual policy (see AGENTS.md Language Policy + §3). Keep in sync with the
> fixture, not with product docs.

Source file: `tests/golden/fixtures/verilog/modules/adder4.v`

`adder4` is a synthesizable, Verilog-2001 compliant 4-bit ripple-carry adder. It is built from 4
full adders cascaded together; the carry-out of each lower stage ripples bit by bit to the carry-in
of the next higher stage. The addition itself is not implemented with arithmetic operators, and the
carry chain structure is explicitly visible.

**Function**: `{cout, sum} = a + b + cin`

## Port table

| Port | Direction | Width | Description |
|---|---|---|---|
| `a` | input | 4 | Operand A (augend) |
| `b` | input | 4 | Operand B (addend) |
| `cin` | input | 1 | Carry input (for cascade extension or initial carry) |
| `sum` | output | 4 | 4-bit sum result (low 4 bits of `a + b + cin`) |
| `cout` | output | 1 | Carry output (overflow flag for unsigned addition) |

## Behavior

- The addition result is formed by the internal 5-bit carry chain `carry[4:0]` and the 4-bit `sum`:
  `carry[0]` is tied to the module input `cin`, and `carry[4]` drives the module output `cout`.
- Each full-adder stage `i` (0 is the LSB, 3 is the MSB) satisfies:

  ```
  sum[i]     = a[i] ^ b[i] ^ carry[i]
  carry[i+1] = (a[i] & b[i]) | (a[i] & carry[i]) | (b[i] & carry[i])
  ```

- Stages are described with continuous assignments (`assign`), and stages are connected by explicit
  carry wires: pure combinational logic, no sequential state, directly synthesizable.

### Usage notes

- `cout` only indicates unsigned addition overflow (result >= 16).
- For two's-complement (signed) arithmetic, `cout` cannot be used directly as the overflow flag; to
  detect signed overflow, compare whether the highest-bit carry (`carry[3]` and `carry[4]`) agree.
- Cascade extension: connect a lower module's `cout` to a higher module's `cin` to compose a wider adder.

## Simple usage example

```verilog
module top (
    input  wire [3:0] a,
    input  wire [3:0] b,
    input  wire       cin,
    output wire [3:0] sum,
    output wire       cout
);

    // instantiate adder4 for 4-bit add with carry-in
    adder4 u_adder4 (
        .a    (a),
        .b    (b),
        .cin  (cin),
        .sum  (sum),
        .cout (cout)
    );

endmodule
```

### Cascade example (8-bit adder)

```verilog
module adder8 (
    input  wire [7:0] a,
    input  wire [7:0] b,
    input  wire       cin,
    output wire [7:0] sum,
    output wire       cout
);

    wire carry_mid;

    adder4 u_low (
        .a    (a[3:0]),
        .b    (b[3:0]),
        .cin  (cin),
        .sum  (sum[3:0]),
        .cout (carry_mid)
    );

    adder4 u_high (
        .a    (a[7:4]),
        .b    (b[7:4]),
        .cin  (carry_mid),
        .sum  (sum[7:4]),
        .cout (cout)
    );

endmodule
```
