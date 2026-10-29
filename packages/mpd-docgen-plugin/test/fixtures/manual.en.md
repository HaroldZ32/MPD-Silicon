# Timer Module

## Overview

The timer module provides a 32-bit time base and one 16-bit status register for measuring external event intervals.

Key features:

- 32-bit free-running counter with software start/stop control
- Programmable divider coefficient
- Event flag cleared by writing 1

Clock and reset behaviour:

```text
TIMER_CLK = SYSCLK / (DIV + 1)
TIMER_EN  = START
```

| Parameter | Min | Max | Unit |
|---|---|---|---|
| Input clock | 1 | 100 | MHz |
| Counter width | 16 | 32 | bit |

## Registers

### Registers overview

| Offset | Register | Width |
|---|---|---|
| 0x00 | TSCTR | 32 |
| 0x0C | STATUS | 16 |

### Time stamp counter (TSCTR)

Offset: 0x00

Reset value: 0x0000 1020

| Bits | Name | Access | Description |
|---|---|---|---|
| 23:16 | RESERVED | | Reserved; keep the reset value |
| 15:8 | PERIOD | rw | Counter period; takes effect on write<br>0: stopped<br>1: running |
| 6:2 | DIV | rw | Divider coefficient |
| 1 | FLAG | w1c | Event flag; write 1 to clear |
| 0 | START | rw | Start counting |

### Status register (STATUS)

Offset: 0x0C

Reset value: 0x0030

| Bits | Name | Access | Description |
|---|---|---|---|
| 15 | BUSY | ro | Busy flag |
| 14 | RC_FLAG | rc | Flag cleared on read |
| 13:12 | RESERVED | | Reserved; keep the reset value |
| 11:10 | PRESCALE | rw | Prescaler selection |
| 9:8 | MODE | rw | Operating mode<br>0: one-shot<br>1: continuous |
| 7:0 | VALUE | ro | Current counter value |
