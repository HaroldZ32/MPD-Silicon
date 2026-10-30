# ============================================================================
# tb_adder4.py -- cocotb testbench for the adder4 golden fixture
# ----------------------------------------------------------------------------
# DUT: tests/golden/fixtures/verilog/modules/adder4.v
#   {cout, sum} = a + b + cin  (4-bit ripple-carry adder)
#
# Run (VENV-first -- see ../../templates/cocotb/bootstrap_venv.sh):
#   source ../../templates/cocotb/bootstrap_venv.sh
#   make sim SIM=icarus       # or SIM=verilator
# Results: results.xml (xUnit) + FST waveform in this directory.
# ============================================================================

import cocotb
from cocotb.triggers import Timer

MAX4 = 0xF  # 4-bit operand max


def ref_model(a: int, b: int, cin: int) -> tuple[int, int]:
    """Behavioral reference: returns (sum[3:0], cout)."""
    full = a + b + cin
    return full & MAX4, (full >> 4) & 0x1


@cocotb.test()
async def test_adder4_exhaustive(dut):
    """Exhaustive sweep: every a x b with cin=0 and cin=1 vs reference model."""
    for a in range(16):
        for b in range(16):
            for cin in range(2):
                dut.a.value = a
                dut.b.value = b
                dut.cin.value = cin
                await Timer(1, units="ns")  # let the ripple settle
                exp_sum, exp_cout = ref_model(a, b, cin)
                assert dut.sum.value.integer == exp_sum, (
                    f"sum mismatch a={a} b={b} cin={cin}: "
                    f"got {dut.sum.value.integer} want {exp_sum}"
                )
                assert dut.cout.value.integer == exp_cout, (
                    f"cout mismatch a={a} b={b} cin={cin}: "
                    f"got {dut.cout.value.integer} want {exp_cout}"
                )
    dut._log.info("exhaustive sweep: all 512 stimulus points PASSED")


@cocotb.test()
async def test_adder4_directed(dut):
    """A few explicit corner cases (readable regression anchors)."""
    cases = [  # (a, b, cin, sum, cout)
        (0, 0, 0, 0, 0),
        (1, 1, 0, 2, 0),
        (5, 3, 0, 8, 0),
        (15, 1, 0, 0, 1),   # overflow: 15 + 1 = 16
        (15, 15, 1, 15, 1), # overflow: 15 + 15 + 1 = 31
        (10, 5, 1, 0, 1),   # 10 + 5 + 1 = 16
    ]
    for a, b, cin, exp_sum, exp_cout in cases:
        dut.a.value = a
        dut.b.value = b
        dut.cin.value = cin
        await Timer(1, units="ns")
        assert dut.sum.value.integer == exp_sum, (
            f"a={a} b={b} cin={cin}: got sum={dut.sum.value.integer} want {exp_sum}"
        )
        assert dut.cout.value.integer == exp_cout, (
            f"a={a} b={b} cin={cin}: got cout={dut.cout.value.integer} want {exp_cout}"
        )
    dut._log.info("directed cases PASSED")
