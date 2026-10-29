// ============================================================================
// dut_sequence.sv -- UVM sequence skeleton (VCS-targeted template)
// ----------------------------------------------------------------------------
// Base sequence: randomized stimulus produced on the sequencer for the driver.
// Follows uvmprimer sequence patterns (body() + `uvm_do macros).
// ============================================================================

class dut_base_sequence extends uvm_sequence #(dut_sequence_item);

    `uvm_object_utils(dut_base_sequence)

    function new(string name = "dut_base_sequence");
        super.new(name);
    endfunction : new

    task body();
        dut_sequence_item item;
        // TODO: randomized stimulus loop, e.g.
        //   repeat (100) begin
        //       item = dut_sequence_item::type_id::create("item");
        //       if (!item.randomize()) `uvm_fatal(get_type_name(), "randomize failed");
        //       `uvm_do(item)
        //   end
    endtask : body

endclass : dut_base_sequence