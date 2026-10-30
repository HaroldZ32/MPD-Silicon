# UVM skeleton templates (VCS-targeted)

These templates are **VCS-targeted only** — full UVM methodology runs on Synopsys
VCS by owner decision. Open-source backends (Icarus/Verilator) use the cocotb
templates in `../cocotb/` instead.

## Files

| File | Role |
|---|---|
| `dut_pkg.sv` | package: UVM import, macros, virtual interface, class includes |
| `dut_env.sv` | environment: owns agent + scoreboard |
| `dut_agent.sv` | agent: driver + sequencer + monitor (active/passive) |
| `dut_driver.sv` | driver: `seq_item_port` → DUT interface drive |
| `dut_monitor.sv` | monitor: passive sampling → analysis port |
| `dut_sequence_item.sv` | transaction object (stimulus + observed fields) |
| `dut_sequence.sv` | base sequence: randomized stimulus (`body()`) |
| `dut_scoreboard.sv` | scoreboard: analysis export + reference-model check |

## How to use

1. Copy this directory into the tb workspace; rename the `dut_` prefix to the
   DUT name.
2. Replace the `dut_if` virtual interface, port types, and TODOs with the real
   DUT interface and protocol.
3. Compile on VCS with UVM 1.2:

   ```bash
   vcs -sverilog -ntb_opts uvm-1.2 -f dut.f +incdir+<tb_dir> dut_tb_top.sv
   ```

## VCS pure-virtual-class caveat (from uvmprimer's VCS_README)

VCS and Questa disagree about pure virtual classes:

- Questa allows code that *could* instantiate a pure virtual class, as long as
  none is ever instantiated.
- **VCS rejects code that could instantiate a pure virtual class.**

So when a design uses a pure virtual base (e.g. a `base_tester`/`base_sequence`
overridden via the factory), VCS fails to compile the file that mentions it.
Fix pattern (uvmprimer): ship a concrete `vcs_*` variant of the base file and
swap it in for VCS builds. Keep this note in mind when editing the sequence /
driver skeletons above — prefer a concrete base class over a pure virtual one.
