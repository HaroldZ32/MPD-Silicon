# Example regression workspace (rtl-verif)

Example regression workspace demonstrating the cocotb flow across the golden
fixtures. This is a *template of a regression workspace* — the runnable per-DUT
cocotb tests live in `../../fixtures/{adder4,cnt8}` and are invoked through the
VENV-first bootstrap + standard Makefile flow.

> **Placeholder.** The bilingual (EN + 简体中文) body of this README is written by
> the integration task (Lead); the runnable shell below is final.

## Layout

```
examples/regression/
├── README.md            # this file (placeholder body; runnable instructions final)
└── run_regression.sh    # VENV-first bootstrap + run every fixture's cocotb suite
```

## Run

```bash
./run_regression.sh                  # default: both fixtures on Icarus
SIM=verilator ./run_regression.sh    # switch backend
```

Each fixture run produces `results.xml` (xUnit) + FST waveform in its directory.
