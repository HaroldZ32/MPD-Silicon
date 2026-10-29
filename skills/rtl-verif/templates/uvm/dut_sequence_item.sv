// ============================================================================
// dut_sequence_item.sv -- UVM sequence item skeleton (VCS-targeted template)
// ----------------------------------------------------------------------------
// Transaction object moved between sequences -> driver and monitor -> scoreboard.
// Add rand fields (stimulus) + non-rand fields (observed results) as needed.
// ============================================================================

class dut_sequence_item extends uvm_sequence_item;

    `uvm_object_utils(dut_sequence_item)

    // rand bit [3:0] a;       // TODO: stimulus fields
    // rand bit [3:0] b;
    //      bit [3:0] result;  // TODO: observed fields

    function new(string name = "dut_sequence_item");
        super.new(name);
    endfunction : new

    // `uvm_object_utils_begin(dut_sequence_item)
    //     `uvm_field_int(a,    UVM_ALL_ON)
    //     `uvm_field_int(b,    UVM_ALL_ON)
    //     `uvm_field_int(result, UVM_ALL_ON)
    // `uvm_object_utils_end

endclass : dut_sequence_item