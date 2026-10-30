# <IP Name>

> User manual template — chapter order is fixed (do not reorder); detail level must match a full product manual (reference sample: `/root/hermesWork/mineru_rm0383/result/full.md` granularity).
>
> **Writing contract (required in every section; missing one item means the section is incomplete)**: every "Must include" item below must be covered with substantive content, never with a bare heading; feature points and registers must be described at `full.md` granularity (one subsection per feature, one bit-field explanation per register field).
> Diagram convention: block/function diagrams use drawio/plantuml/mermaid; draw a diagram whenever the content allows it and add a caption.

## Introduction

**Must include**:
- The IP's position in the system (which bus it sits on, whom it serves), 100–300 words;
- A data-flow/control-flow overview: input → processing → output in one sentence;
- Typical devices/scenarios that use this IP (1–2 examples).

## Key features

**Must include**:
- List each functional feature (≥5 items), each with ≥1 sentence on "what it does + which scenario it applies to";
- Explicitly list every parameter/mode (e.g. clock frequency range, bit width, supported modes, configurable items);
- Each distinctive capability gets its own item (interrupt, DMA, error protection, programmability, low-power support, etc. — list only what this IP actually has).

## Functional description

> The first subsection is the overall block diagram (mandatory); the remaining subsections expand one feature point each; **the structure and number of feature subsections are decided by the Spec Designer from this IP's actual functions** — do not copy another IP's subsection names (e.g. I2C's "slave/master mode, error conditions, DMA, checksum" or TIM's "time base, counting modes, capture/compare, dead-time, encoder" are each IP-specific).

> **Granularity reference (two verified full product manuals, both feature-level subsections, 10–20+ sections, third-level subsections allowed)**:
> - Communication: `/root/hermesWork/mineru_rm0383/result/full.md` (I2C: 18.3.1 mode selection → 18.3.2 slave mode
>   (split into slave transmit/slave receive/close communication) → 18.3.3 master mode (clock generation/start/slave address/master transmit/master receive/close)
>   → 18.3.4 error conditions → … → 18.3.9 packet error checking)
> - Timer: `/root/hermesWork/mineru_rm0383_238/result/full.md` (TIM1: 12.3.1 time base → 12.3.2 counting
>   modes (up/down/center-aligned) → 12.3.4 clock selection → 12.3.5 capture/compare channels → … → 12.3.19 external trigger
>   synchronization → 12.3.21 debug mode)
>
> **Subsection principles**: ① one subsection per feature point; ② order = basics first (overview/modes/clock/time base), then each functional mode;
> ③ when a feature contains sub-steps/sub-scenarios, expand with third-level subsections (e.g. "master mode" split into "master transmit/master receive");
> ④ name subsections with this IP's own vocabulary, include only functions that actually exist, and omit what does not.

**Must include (each feature subsection)**:
- Purpose and trigger conditions;
- Behaviour description (state/timing/action sequence);
- Accompanying diagram (state machine / timing / flow) + caption;
- Boundaries and exit conditions (when it ends, how it stops, how errors are handled);
- How software cooperates (which register bit each control point maps to — reference the "Registers" chapter).

### Functional overview and block diagram

**Must include**: overall block diagram + brief feature overview (covering ALL feature points; illustrative is enough).

### <Feature 1 — named after the IP's actual function>

**Must include**: purpose and trigger conditions; behaviour description (state/timing/action sequence); accompanying diagram + caption; boundaries and exit
(how it ends, how it stops, how errors are handled); software cooperation (which register bit each control point maps to — reference the "Registers" chapter).

### <Feature 2 — named after the IP's actual function>

**Must include**: same as above (one subsection per feature point, third-level subsections allowed, e.g. <Feature 2.1> / <Feature 2.2>).

## Software configuration flow

> Scenario-oriented: one subsection per scenario (covering all feature points), **never write code**; the reader must be able to write the code from the prose alone.

**Must include (each scenario)**:
- Scenario purpose;
- **Step-by-step operations** (each step states: what to do, which register and bits to configure, what value to use in each case);
- A state machine diagram (plantuml) + caption when possible;
- Expected behaviour/result (how to confirm the scenario succeeded);
- At least one "exception/boundary case" per scenario (what happens on misconfiguration).

## Registers

> **Machine-readable contract (required by the documentation generator; follow it when writing the manual)**:
>
> - The register chapter heading is fixed: `## Registers` (Chinese manual: `## 寄存器`), and it must be the last chapter of the document;
> - Each register gets one third-level heading, in the canonical form `### <name>(<REG_NAME>)` (e.g. `### Timestamp counter(TSCTR)`);
> - Every register must carry an `Offset: 0x…` line and a `Reset value: 0x…` line (Chinese manual: `偏移地址：` / `复位值：`); a missing line is a parse failure;
> - The field table header is fixed: `|Bits|Name|Access|Description|` (Chinese manual: `|位域|名称|读写属性|描述|`); rows use `|N or N:M|Name|Access|Description|`, and `<br>` marks a line break;
> - The `### Registers overview` table is a cross-check only (an offset mismatch is a warning, not an error); RESERVED rows may leave Access empty.

### Registers overview

The table below is a format example. RESERVED means reserved; within a register, an empty cell to its right means the bit extends the nearest cell on its left (same for RESERVED) — e.g. FIELD0 in the table below spans [5:4]. In the reset-value row, empty cells are allowed to the right of RESERVED only; every other bit must carry its reset value.

|Offset|Register|31|30|29|28|27|26|25|24|23|22|21|20|19|18|17|16|15|14|13|12|11|10| 9| 8| 7| 6| 5| 4| 3| 2| 1| 0|
|------|--------|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|
|  000h| IP_REG0|RESERVED| | | | | | | | | | |FIELD3|RESERVED| | | | | | |FIELD2|RESERVED| | | | | FIELD1| FIELD0| |RESERVED| | | |
|      |Reset Value|RESERVED| | | | | | | | | | |0|RESERVED| | | | | | |1|RESERVED| | | | | 0| 1| 0|RESERVED| | | |

### <Register name>(<REG_NAME>)

**Must include**: offset, reset value, bit-map rows (upper/lower 16 bits), field table, **per-field detailed description**.

Offset: 0x00

Reset value: 0x0000 1020

**Bit map** (two-row style, aligned with the overview):

| 31 | 30 | 29 | 28 | 27 | 26 | 25 | 24 | 23 | 22 | 21 | 20 | 19 | 18 | 17 | 16 |
|----|----|----|----|----|----|----|----|----|----|----|----|----| ----|----|----|
|RESERVED| | | | | | | | | | |FIELD3|RESERVED| | | |
| | | | | | | | | | | |rw| | | | |

| 15 | 14 | 13 | 12 | 11 | 10 |  9 |  8 |  7 |  6 |  5 |  4 |  3 |  2 |  1 |  0 |
|----|----|----|----|----|----|----|----|----|----|----|----|----| ----|----|----|
| | | |FIELD2|RESERVED| | | | | FIELD1| FIELD0| |RESERVED| | | |
| | | |rw|RESERVED| | | | | w1c| rw|rw|RESERVED| | | |

|Bits|Name|Access|Description|
|--|--|--|----------|
|31:21|RESERVED|  |Reserved; keep the reset value|
|20|FIELD3|rw|Example register 3; it performs function 3<br>0: function 3 behaves this way<br>1: function 3 behaves that way|
|19:13|RESERVED|  |Reserved; keep the reset value|
|12|FIELD2|rw|Example register 2; it performs function 2<br>0: function 2 behaves this way<br>1: function 2 behaves that way|
|11:7|RESERVED|  |Reserved; keep the reset value|
|6|FIELD1|rw|Example register 1; it performs function 1<br>0: function 2 behaves this way<br>1: function 2 behaves that way, write 1 to clear|
|5:4|FIELD0|rw|Example register 0; it performs function 0, and these bits have this and that function|
|3:0|RESERVED|  |Reserved; keep the reset value|

**Per-field detailed description** (match `full.md` granularity: one subsection per field, containing the name line + description + software usage):

**Bit 20 FIELD3: Function 3 enable**

> Example row format (must be copied): function 3 switch; this bit is 0 after power-on.
>
> - 0: function 3 behaves this way (default behaviour description)
> - 1: function 3 behaves that way
>
> Software usage: write 1 when configuring function 3; reading 0 means function 3 is not enabled.

**Bit 12 FIELD2: Function 2 enable**

> Function 2 direction select. - 0: function 2 behaves this way - 1: function 2 behaves that way

**Bits 5:4 FIELD0: Function 0 configuration**

> Two operating modes select. Reset value 01.
> - 00: mode A (describe A behaviour)
> - 01: mode B (describe B behaviour)
> - 10: mode C (describe C behaviour)
> - 11: reserved, must not be used
> Software usage: the software configuration flow's "some scenario" step explicitly says to configure 01.

**Bit 6 FIELD1: Function 1 flag (w1c)**

> Status-type bit: hardware sets it, software clears it by writing 1. - 0: no event - 1: event occurred (hardware sets it automatically when the event occurs)
> Software usage: write 1 to clear after handling each event; it is 0 after reset.

**RESERVED**: all reserved bits — fixed text "Reserved; keep the reset value"; no software usage is described.

Access semantics (following UVM; the table uses the short codes on the left):

```
rw  read/write
ro  read-only
wo  write-only
w1  write-once
w1c write a 1 to bitwise-clear
rc  clear on read
rs  Read Sets All
wrc Write Read Clears All
wrs Write, Read Sets All
wc  Write Clears All
ws  Write Sets All
wsrc Write Sets All, Read Clears All
wcrs Write Clears All, Read Sets All
w1s Write 1 to Set
w1t Write 1 to Toggle
w0c Write 0 to Clear
w0s Write 0 to Set
w0t Write 0 to Toggle
w1src Write 1 to Set, Read Clears All
w1crs Write 1 to Clear, Read Sets All
w0src Write 0 to Set, Read Clears All
w0crs Write 0 to Clear, Read Sets All
woc Write Only Clears All
wos Write Only Sets All
wo1 Write Only, Once
```

> One section per register, format identical to the above; the register count must match the overview table exactly, and offset/reset value/field layout must agree;
> every non-reserved field must have a "per-field detailed description" subsection (Bit-level granularity as in full.md).
