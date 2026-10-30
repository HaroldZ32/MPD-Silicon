// ============================================================================
// tb_adder4.v -- self-checking testbench for adder4 (Verilog-2001)
// ----------------------------------------------------------------------------
// Golden task G2: testbench covering several cases for the 4-bit ripple-carry
// adder. No external simulator is required to read it, but it is fully
// runnable with any Verilog-2001 simulator (e.g. iverilog):
//
//     iverilog -o tb_adder4.vvp modules/adder4.v tb/tb_adder4.v
//     vvp tb_adder4.vvp
//
// Coverage:
//   - Basic cases: 0+0, 1+1, 5+3
//   - Carry-in active: cin=1 with sum crossing a bit boundary
//   - Overflow: 15+1 (sum wraps to 0, cout=1), 15+15+1
//   - Exhaustive sweep: every a in [0..15] x b in [0..15] with cin 0 and 1
//     (2 * 16 * 16 = 512 stimulus points), checked against a behavioral
//     reference model.
// ============================================================================

`timescale 1ns / 1ps

module tb_adder4;

    // ---- DUT interface -----------------------------------------------------
    reg  [3:0] a;
    reg  [3:0] b;
    reg        cin;
    wire [3:0] sum;
    wire       cout;

    // ---- Expected values from the reference model --------------------------
    reg  [4:0] expected;   // {cout, sum}
    integer    errors;
    integer    ia, ib;     // bounded exhaustive-sweep counters (dead-loop
                           // fix: looping the 4-bit regs themselves with
                           // `a <= 4'hF` never terminates — the wrap at 15
                           // back to 0 keeps the bound always true)

    // ---- Device under test -------------------------------------------------
    adder4 dut (
        .a    (a),
        .b    (b),
        .cin  (cin),
        .sum  (sum),
        .cout (cout)
    );

    // ---- Task: apply one stimulus and compare against the reference --------
    task apply_and_check;
        input [3:0] ta;
        input [3:0] tb;
        input       tcin;
        begin
            a   = ta;
            b   = tb;
            cin = tcin;
            #10;                              // allow the ripple to settle

            expected = ta + tb + tcin;        // behavioral reference: 5-bit sum

            if ({cout, sum} !== expected) begin
                errors = errors + 1;
                $display("FAIL: a=%0d b=%0d cin=%0d -> sum=%0d cout=%0d (expected sum=%0d cout=%0d)",
                         ta, tb, tcin, sum, cout, expected[3:0], expected[4]);
            end
        end
    endtask

    // ---- Main test sequence -------------------------------------------------
    initial begin
        errors = 0;

        $display("== tb_adder4: starting ==");

        // Explicit named cases (readable regression anchors).
        apply_and_check(0,  0, 0);   // 0 + 0 = 0, no carry
        apply_and_check(0,  0, 1);   // carry-in only
        apply_and_check(1,  1, 0);   // 1 + 1 = 2
        apply_and_check(5,  3, 0);   // 5 + 3 = 8
        apply_and_check(7,  8, 0);   // 7 + 8 = 15, no overflow
        apply_and_check(7,  8, 1);   // 7 + 8 + 1 = 16 -> sum=0, cout=1
        apply_and_check(15, 1, 0);   // overflow: 15 + 1 = 16
        apply_and_check(15, 15, 1);  // 15 + 15 + 1 = 31 -> sum=15, cout=1
        apply_and_check(10, 5, 1);   // 10 + 5 + 1 = 16 -> sum=0, cout=1

        // Exhaustive sweep: all a x b with cin=0 and cin=1.
        apply_and_check(0, 0, 0);    // (re-check the corner while the sweep
                                     //  below already covers it; kept for
                                     //  explicitness in the named list)
        // Exhaustive sweep: all a in [0..15] x b in [0..15] with cin=0 and cin=1
        // (bounded integer counters drive the regs — every one of the
        //  2 * 16 * 16 = 512 points runs, then the loop terminates cleanly).
        $display("== tb_adder4: exhaustive sweep ==");
        for (ia = 0; ia < 16; ia = ia + 1) begin
            for (ib = 0; ib < 16; ib = ib + 1) begin
                apply_and_check(ia[3:0], ib[3:0], 0);
                apply_and_check(ia[3:0], ib[3:0], 1);
            end
        end

        // ---- Report ---------------------------------------------------------
        if (errors == 0) begin
            $display("== tb_adder4: ALL TESTS PASSED ==");
        end else begin
            $display("== tb_adder4: %0d CHECK(S) FAILED ==", errors);
        end
        $finish;
    end

endmodule
