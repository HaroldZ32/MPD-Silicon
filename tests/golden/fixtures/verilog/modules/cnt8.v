// ============================================================================
// cnt8.v -- 8-bit binary counter with load / enable / reset (Verilog-2001)
// ----------------------------------------------------------------------------
// Golden task G9: implement an 8-bit binary counter with well-commented,
// synthesizable, Verilog-2001-compliant source.
//
// Function (on each rising clock edge, priority highest first):
//   1. rst_n == 0  -> q <= 0            (asynchronous, active-low reset)
//   2. load == 1   -> q <= d            (synchronous parallel load)
//   3. en   == 1   -> q <= q + 1        (count enable; otherwise hold)
//
// The counter wraps naturally at 256: q=8'hFF increments to q=8'h00.
//
// Ports:
//   clk   - clock input, all state transitions occur on its rising edge
//   rst_n - asynchronous reset, active low; highest priority
//   en    - count enable; when high, the counter advances on each clock edge
//   load  - synchronous load enable; loads d when high (after reset)
//   d     - 8-bit parallel load data, captured on the rising edge of clk
//   q     - 8-bit counter output (registered, always valid)
// ============================================================================

module cnt8 (
    input  wire       clk,    // clock: state updates on posedge clk
    input  wire       rst_n,  // asynchronous reset, active low
    input  wire       en,     // count enable
    input  wire       load,   // synchronous load enable
    input  wire [7:0] d,      // parallel load data
    output reg  [7:0] q       // counter value
);

    // ------------------------------------------------------------------------
    // Sequential core: reset -> load -> enable -> hold, encoded as an
    // if/else-if priority chain inside one always block, so the synthesis
    // result is a single 8-bit register with reset/load/clock-enable.
    // Non-blocking assignments (<=) make the register updates race-free.
    // ------------------------------------------------------------------------
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            // Asynchronous reset: q is forced to 0 without waiting for clk.
            q <= 8'h00;
        end else if (load) begin
            // Synchronous load: d is captured on the rising edge of clk.
            q <= d;
        end else if (en) begin
            // Count enable: advance by one; 8'hFF + 1 wraps to 8'h00.
            q <= q + 8'h01;
        end
        // else: en == 0 and load == 0 -> q holds its previous value.
    end

endmodule
