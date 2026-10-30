# ============================================================================
# tb_<dut>.py -- cocotb testbench skeleton (template)
# ----------------------------------------------------------------------------
# Generic cocotb testbench template for a Verilog DUT. Copy into a workspace,
# rename to tb_<dut>.py, and fill in the test bodies for your DUT ports.
#
# Test discovery: cocotb auto-discovers every top-level coroutine whose name
# starts with `test_` and that is decorated with @cocotb.test(). The MODULE
# make variable (or COCOTB_TEST_MODULES) selects this file's basename.
#
# Runner flow (standard cocotb Makefile flow, see the sibling Makefile):
#   make sim SIM=icarus     # or SIM=verilator
#
# VENV rule: always run inside the project venv (.venv-rtl) created by
# bootstrap_venv.sh -- NEVER system python/pip.
# ============================================================================

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import ClockCycles, FallingEdge, RisingEdge, Timer


# ---------------------------------------------------------------------------
# Reset helper: drive an active-low or active-high reset for N cycles.
# ---------------------------------------------------------------------------
async def reset_dut(dut, cycles: int = 4, active_low: bool = True):
    """Drive the reset port for `cycles` clock cycles."""
    rst = getattr(dut, "rst_n" if active_low else "rst")
    rst.value = 1 if active_low else 0  # assert reset
    await ClockCycles(dut.clk, cycles)
    rst.value = 0 if active_low else 1  # deassert reset
    await RisingEdge(dut.clk)


# ---------------------------------------------------------------------------
# Smoke test: drive reset, check the DUT clocks in cleanly.
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_smoke(dut):
    """Basic smoke: reset and confirm the clock toggles."""
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    await reset_dut(dut)
    for _ in range(4):
        await RisingEdge(dut.clk)
    dut._log.info("smoke test completed")


# ---------------------------------------------------------------------------
# Directed test: drive inputs, assert expected outputs.
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_directed(dut):
    """Directed stimulus + expected-output check.  FILL IN for the DUT."""
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    await reset_dut(dut)

    # TODO(<dut>): drive DUT inputs, e.g.
    #   dut.a.value = 5
    #   dut.b.value = 3
    await RisingEdge(dut.clk)
    await Timer(1, units="ns")

    # TODO(<dut>): assert against a reference model, e.g.
    #   assert dut.sum.value.integer == 8, dut.sum.value
    dut._log.info("directed test completed")


# ---------------------------------------------------------------------------
# Random test: randomize inputs, cross-check against a reference model.
# ---------------------------------------------------------------------------
@cocotb.test()
async def test_random(dut):
    """Randomized stimulus + reference-model check.  FILL IN for the DUT."""
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    await reset_dut(dut)

    for _ in range(100):
        # TODO(<dut>): randomize inputs and check outputs, e.g.
        #   a = random.randint(0, 15)
        #   b = random.randint(0, 15)
        #   dut.a.value = a
        #   dut.b.value = b
        #   await Timer(1, units="ns")
        #   assert dut.sum.value.integer == a + b + dut.cin.value.integer
        await RisingEdge(dut.clk)

    dut._log.info("random test completed")
