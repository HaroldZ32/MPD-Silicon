// ============================================================================
// dut_pkg.sv -- UVM package skeleton (VCS-targeted template)
// ----------------------------------------------------------------------------
// Generic UVM package for a VCS-targeted testbench. Copy into a workspace,
// rename `dut` to the DUT name, and replace the `dut_if` virtual interface /
// placeholder classes below.
//
// Structure follows the gen-tb-skill methodology (package -> env -> agent ->
// driver/monitor/sequencer -> sequences -> scoreboard); class skeletons follow
// uvmprimer patterns (uvm_component_utils, build_phase / run_phase).
//
// VCS compile (UVM 1.2 bundled):
//   vcs -sverilog -ntb_opts uvm-1.2 -f dut.f +incdir+<this_dir> dut_tb_top.sv
// ============================================================================

package dut_pkg;

    import uvm_pkg::*;
    `include "uvm_macros.svh"

    // Virtual interface handle shared through uvm_config_db (see dut_tb_top.sv).
    // Replace `dut_if` with the real interface type.
    //   virtual dut_if vif;

    // --- Transaction / sequence item -----------------------------------------
    // `include "dut_sequence_item.svh"

    // --- Components -----------------------------------------------------------
    // `include "dut_driver.svh"
    // `include "dut_monitor.svh"
    // `include "dut_agent.svh"
    // `include "dut_scoreboard.svh"
    // `include "dut_env.svh"

    // --- Sequences & tests ----------------------------------------------------
    // `include "dut_sequence.svh"
    // `include "dut_base_test.svh"

endpackage : dut_pkg
