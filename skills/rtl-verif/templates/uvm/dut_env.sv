// ============================================================================
// dut_env.sv -- UVM environment skeleton (VCS-targeted template)
// ----------------------------------------------------------------------------
// Top-level environment: owns the agent(s) and the scoreboard. Skeleton only —
// wiring of analysis ports between agent and scoreboard is left as TODOs.
// ============================================================================

class dut_env extends uvm_env;

    `uvm_component_utils(dut_env)

    // dut_agent     agent;         // TODO: instantiate the agent
    // dut_scoreboard scoreboard;   // TODO: instantiate the scoreboard

    function new(string name = "dut_env", uvm_component parent = null);
        super.new(name, parent);
    endfunction : new

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        // agent     = dut_agent::type_id::create("agent", this);
        // scoreboard = dut_scoreboard::type_id::create("scoreboard", this);
    endfunction : build_phase

    function void connect_phase(uvm_phase phase);
        super.connect_phase(phase);
        // TODO: agent.mon_ap.connect(scoreboard.analysis_export);
    endfunction : connect_phase

endclass : dut_env
