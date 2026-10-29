// ============================================================================
// dut_monitor.sv -- UVM monitor skeleton (VCS-targeted template)
// ----------------------------------------------------------------------------
// Passive monitor: samples the DUT interface and broadcasts transactions on
// an analysis port to the scoreboard. Skeleton only — replace the signal
// sampling with the real DUT interface protocol.
// ============================================================================

class dut_monitor extends uvm_monitor;

    `uvm_component_utils(dut_monitor)

    uvm_analysis_port #(dut_sequence_item) ap;

    // virtual dut_if vif;  // TODO: get from uvm_config_db, sample real signals

    function new(string name = "dut_monitor", uvm_component parent = null);
        super.new(name, parent);
    endfunction : new

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        ap = new("ap", this);
        // if (!uvm_config_db #(virtual dut_if)::get(this, "", "vif", vif))
        //     `uvm_fatal("NOVIF", "virtual interface not set on monitor");
    endfunction : build_phase

    task run_phase(uvm_phase phase);
        dut_sequence_item item;
        // TODO: forever @(...) -> collect -> item = dut_sequence_item::type_id::create();
        //       ap.write(item);
    endtask : run_phase

endclass : dut_monitor