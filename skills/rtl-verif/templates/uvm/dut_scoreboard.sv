// ============================================================================
// dut_scoreboard.sv -- UVM scoreboard skeleton (VCS-targeted template)
// ----------------------------------------------------------------------------
// Passive checker: receives monitor transactions via an analysis export and
// compares them against a reference model / expected values. Skeleton only.
// ============================================================================

class dut_scoreboard extends uvm_scoreboard;

    `uvm_component_utils(dut_scoreboard)

    uvm_analysis_imp #(dut_sequence_item, dut_scoreboard) analysis_export;
    int unsigned mismatch_count;
    int unsigned match_count;

    function new(string name = "dut_scoreboard", uvm_component parent = null);
        super.new(name, parent);
    endfunction : new

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        analysis_export = new("analysis_export", this);
        mismatch_count = 0;
        match_count = 0;
    endfunction : build_phase

    function void write(dut_sequence_item item);
        // TODO: compare item (observed result) against a reference model, e.g.
        //   if (item.result !== expected) begin
        //       mismatch_count++;
        //       `uvm_error(get_type_name(), $sformatf("mismatch: %s", item.convert2string()))
        //   end else
        //       match_count++;
    endfunction : write

    function void report_phase(uvm_phase phase);
        super.report_phase(phase);
        if (mismatch_count != 0)
            `uvm_error(get_type_name(), $sformatf("%0d mismatch(es)", mismatch_count))
        else
            `uvm_info(get_type_name(), $sformatf("%0d checks PASSED", match_count), UVM_LOW)
    endfunction : report_phase

endclass : dut_scoreboard