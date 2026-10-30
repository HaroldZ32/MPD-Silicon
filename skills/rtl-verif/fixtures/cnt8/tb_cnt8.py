# ============================================================================
# tb_cnt8.py -- cocotb testbench for the cnt8 golden fixture
# ----------------------------------------------------------------------------
# DUT: tests/golden/fixtures/verilog/modules/cnt8.v
#   q updates on posedge clk:  rst_n==0 -> q<=0 ; load==1 -> q<=d ; en==1 -> q++
#
# Run (VENV-first -- see ../../templates/cocotb/bootstrap_venv.sh):
#   source ../../templates/cocotb/bootstrap_venv.sh
#   make sim SIM=icarus       # or SIM=verilator
# Results: results.xml (xUnit) + FST waveform in this directory.
# ============================================================================

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import ClockCycles, RisingEdge, Timer


async def _reset(dut):
    dut.rst_n.value = 0
    dut.en.value = 0
    dut.load.value = 0
    dut.d.value = 0
    await ClockCycles(dut.clk, 2)
    dut.rst_n.value = 1
    await RisingEdge(dut.clk)
    await Timer(1, units="ns")  # settle: q updates in the NBA region of this edge


@cocotb.test()
async def test_cnt8_reset(dut):
    """Async reset forces q to 0 regardless of load/en."""
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    await _reset(dut)
    assert dut.q.value.integer == 0, f"q={dut.q.value.integer} after reset, want 0"


@cocotb.test()
async def test_cnt8_count_enable(dut):
    """With en=1 the counter advances by one per clock; en=0 holds."""
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    await _reset(dut)
    dut.en.value = 1
    for expected in range(1, 8):
        await RisingEdge(dut.clk)
        await Timer(1, units="ns")  # settle before sampling q
        assert dut.q.value.integer == expected, (
            f"q={dut.q.value.integer} after {expected} cycles, want {expected}"
        )
    # Hold: en=0 keeps the current value across a clock edge.
    dut.en.value = 0
    await RisingEdge(dut.clk)
    await Timer(1, units="ns")  # settle before sampling q
    assert dut.q.value.integer == 7, f"q={dut.q.value.integer} on hold, want 7"


@cocotb.test()
async def test_cnt8_load(dut):
    """Synchronous parallel load: q<=d takes priority over count-enable."""
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    await _reset(dut)
    dut.en.value = 1
    dut.load.value = 1
    dut.d.value = 0xAB
    await RisingEdge(dut.clk)
    await Timer(1, units="ns")  # settle before sampling q
    assert dut.q.value.integer == 0xAB, f"q={dut.q.value.integer} after load, want 0xAB"


@cocotb.test()
async def test_cnt8_wraparound(dut):
    """8-bit wrap: 0xFF + 1 -> 0x00 (en=1, no load)."""
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    await _reset(dut)
    dut.load.value = 1
    dut.d.value = 0xFF
    await RisingEdge(dut.clk)
    dut.load.value = 0
    dut.en.value = 1
    await RisingEdge(dut.clk)
    await Timer(1, units="ns")  # settle before sampling q
    assert dut.q.value.integer == 0, f"q={dut.q.value.integer} after wrap, want 0"
