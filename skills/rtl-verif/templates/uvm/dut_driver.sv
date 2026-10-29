// ============================================================================
// dut_driver.sv -- UVM driver skeleton (VCS-targeted template)
// ----------------------------------------------------------------------------
// Drives the DUT interface from sequence items on the seq_item_port. Skeleton
// only: replace the virtual interface type / signal drive with the real DUT
// interface and protocol timing.
// ============================================================================

class dut_driver extends uvm_driver #(dut_sequence_item);

    `uvm_component_utils(dut_driver)

    // virtual dut_if vif;  // TODO: get from uvm_config_db, drive real signals

    function new(string name = "dut_driver", uvm_component parent = null);
        super.new(name, parent);
    endfunction : new

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        // if (!uvm_config_db #(virtual dut_if)::get(this, "", "vif", vif))
        //     `uvm_fatal("NOVIF", "virtual interface not set on driver");
    endfunction : build_phase

    task run_phase(uvm_phase phase);
        // TODO: reset-idle then seq_item_port.get_next_item() / item_done() loop.
        forever begin
            seq_item_port.get_next_item();
            // TODO: drive vif from req (e.g. vif.sig = req.field; @(posedge vif.clk));
            seq_item_port.item_done();
        end
    endtask : run_phase

endclass : dut_driver