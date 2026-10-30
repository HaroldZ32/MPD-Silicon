// ============================================================================
// adder4.v -- 4-bit ripple-carry adder (Verilog-2001)
// ----------------------------------------------------------------------------
// Golden task G2: implement a 4-bit ripple-carry adder with well-commented,
// synthesizable, Verilog-2001-compliant source.
//
// Function:  {cout, sum} = a + b + cin
//
// Structure: four chained full-adder stages. The carry-out of stage i feeds
// the carry-in of stage i+1, so the carry "ripples" from the LSB to the MSB.
// The full adder is described behaviorally with continuous assignments;
// no arithmetic operator is used for the addition itself, which keeps the
// ripple structure explicit and readable.
// ============================================================================

module adder4 (
    input  wire [3:0] a,     // operand A
    input  wire [3:0] b,     // operand B
    input  wire       cin,   // carry-in (for chaining or initial carry)
    output wire [3:0] sum,   // 4-bit sum result
    output wire       cout   // carry-out (overflow flag for unsigned add)
);

    // Internal carry chain. carry0 is the module's carry-in; carry4 is the
    // module's carry-out. Stage i receives carry<i> and produces carry<i+1>
    // together with sum[i]. Named 1-bit wires (not slices of one vector):
    // multiple narrow slice drivers on a single vector trip Verilator
    // UNOPTFLAT under --coverage even for a pure DAG (review D4).
    wire carry0, carry1, carry2, carry3, carry4;

    // ------------------------------------------------------------------------
    // Full adder stage i:
    //   sum[i]   = a[i] ^ b[i] ^ carry[i]
    //   carry[i+1] = (a[i] & b[i]) | (a[i] & carry[i]) | (b[i] & carry[i])
    // ------------------------------------------------------------------------
    assign carry0 = cin;

    // D4 fix (review round 1): the mixed concatenation-LHS + arithmetic form
    // ({carry[i+1],sum[i]} = a+b+cin) makes Verilator see the whole carry
    // vector as circular combinational logic (UNOPTFLAT) under --coverage,
    // fataling the sim. The explicit ripple gate form below is the same
    // truth table, stays Verilog-2001, matches this file's header claim
    // ("no arithmetic operator") and stays dual-compatible with both the
    // icarus and verilator toolchains used by the golden QA flow.
    assign sum[0] = a[0] ^ b[0] ^ carry0;                               // stage 0 (LSB)
    assign carry1 = (a[0] & b[0]) | (a[0] & carry0) | (b[0] & carry0);
    assign sum[1] = a[1] ^ b[1] ^ carry1;                               // stage 1
    assign carry2 = (a[1] & b[1]) | (a[1] & carry1) | (b[1] & carry1);
    assign sum[2] = a[2] ^ b[2] ^ carry2;                               // stage 2
    assign carry3 = (a[2] & b[2]) | (a[2] & carry2) | (b[2] & carry2);
    assign sum[3] = a[3] ^ b[3] ^ carry3;                               // stage 3 (MSB)
    assign carry4 = (a[3] & b[3]) | (a[3] & carry3) | (b[3] & carry3);

    assign cout = carry4;

endmodule
