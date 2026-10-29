// ============================================================================
// dut_agent.sv -- UVM agent skeleton (VCS-targeted template)
// ----------------------------------------------------------------------------
// Active agent: owns driver + sequencer + monitor; passive mode keeps the
// monitor only. Follows uvmprimer agent structure (build_phase creates sub-
// components, analysis port exported to the env).
// ============================================================================

class dut_agent extends uvm_agent;

    `uvm_component_utils(dut_agent)

    // uvm_sequencer #(dut_sequence_item) sequencer;  // TODO: uncomment
    // dut_driver  driver;                            // TODO: uncomment
    // dut_monitor monitor;                           // TODO: uncomment

    // uvm_analysis_port #(dut_sequence_item) mon_ap; // TODO: uncomment

    function new(string name = "dut_agent", uvm_component parent = null);
        super.new(name, parent);
    endfunction : new

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        // monitor = dut_monitor::type_id::create("monitor", this);
        // mon_ap  = new("mon_ap", this);
        // if (get_is_active() == UVM_ACTIVE) begin
        //     sequencer = uvm_sequencer#(dut_sequence_item)::type_id::create("sequencer", this);
        //     driver    = dut_driver::type_id::create("driver", this);
        // end
    endfunction : build_phase

    function void connect_phase(uvm_phase phase);
        super.connect_phase(phase);
        // if (get_is_active() == UVM_ACTIVE)
        //     driver.seq_item_port.connect(sequencer.seq_item_export);
        // monitor.ap.connect(mon_ap);
    endfunction : connect_phase

endclass : dut_agent