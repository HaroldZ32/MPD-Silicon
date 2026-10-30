---
name: rtl-verif
description: "RTL verification template layer for my-power-dsh: reusable cocotb testbench templates (Icarus/Verilator, VENV-first bootstrap, standard Makefile flow) and VCS-targeted UVM skeleton templates (package/env/agent/driver/monitor/sequence/scoreboard), plus an example regression workspace. Use whenever a task needs to scaffold a cocotb testbench for a Verilog DUT, set up a UVM verification environment for VCS, or start a small RTL regression workspace."
metadata:
  short-description: cocotb + UVM(VCS) RTL verification templates
---

# rtl-verif

RTL verification scaffolding for my-power-dsh. This is a **template layer only** — it ships
reusable skeletons, not a simulation plugin. Backend invocation (IVerilog/Verilator/VCS) is
performed by the `mpd-verif` plugin tools (`mpd_verif_*`) at runtime; these templates follow
the same Makefile-flow conventions so a templated workspace and the plugin runner stay
interchangeable.

## Layout

```
skills/rtl-verif/
├── templates/
│   ├── cocotb/              cocotb TB skeleton + standard Makefile flow + VENV-first bootstrap
│   └── uvm/                 VCS-targeted UVM skeleton (pkg/env/agent/driver/monitor/seq/scoreboard)
├── fixtures/                golden-fixture-wired cocotb TBs (adder4, cnt8)
└── examples/regression/     example regression workspace
```

## cocotb flow (Icarus / Verilator)

Standard cocotb Makefile flow per owner decision DP-6:

```bash
# 1) VENV-first bootstrap (never use system python/pip)
./templates/cocotb/bootstrap_venv.sh            # creates .venv-rtl, installs cocotb~=2.0 inside it
source .venv-rtl/bin/activate

# 2) run a fixture TB
cd fixtures/adder4 && make sim SIM=icarus      # FST wave via WAVES=1
cd fixtures/adder4 && make sim SIM=verilator   # FST via --trace --trace-fst --trace-structs
```

Results: `results.xml` (xUnit, `COCOTB_RESULTS_FILE`) + `<toplevel>.fst` (waveform) in the run dir.

## UVM flow (VCS only)

Full UVM methodology is VCS-targeted by owner decision. Copy
`templates/uvm/*.sv` into a tb tree, rename the `dut_` prefix, fill in the
interface/DUT ports, and compile with `vcs -sverilog -ntb_opts uvm-1.2 <tb_top.sv> ...`.
See `templates/uvm/README.md` for the VCS pure-virtual-class caveat.

## Constraints

- Templates are English-commented; bilingual user docs ship with the integration task (Lead).
- No plugin code, no real `~/.dsh` writes.
