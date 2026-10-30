# ============================================================================
# Makefile -- standard cocotb Makefile flow (template)
# ----------------------------------------------------------------------------
# Owner decision DP-6: the cocotb templates follow the standard cocotb
# Makefile flow. Public knobs:
#   SIM              icarus | verilator           (default: icarus)
#   TOPLEVEL         top Verilog module name
#   MODULE           cocotb testbench module (file basename, e.g. tb_adder4)
#   TOPLEVEL_LANG    verilog (fixed for this repo's RTL)
#   WAVES            1 -> dump an FST waveform (Icarus: <TOPLEVEL>.fst;
#                    Verilator: --trace --trace-fst --trace-structs -> dump.fst)
#   COCOTB_RESULTS_FILE  xUnit results file name (default: results.xml)
#
# VENV rule: run inside the project venv (.venv-rtl). NEVER system python/pip.
#   source ../../templates/cocotb/bootstrap_venv.sh   # creates+activates .venv-rtl
#   make sim SIM=icarus
#   make sim SIM=verilator
# ============================================================================

# --- Simulator & DUT selection ----------------------------------------------
SIM          ?= icarus
TOPLEVEL     ?= <dut>
MODULE       ?= tb_<dut>
TOPLEVEL_LANG = verilog

# --- Test selection / discovery ---------------------------------------------
# COCOTB_TEST_MODULES selects which testbench module(s) cocotb imports and
# discovers @cocotb.test() coroutines from. Defaults to MODULE.
COCOTB_TEST_MODULES ?= $(MODULE)

# --- Results -----------------------------------------------------------------
# xUnit-compatible results file, consumed by regression harnesses / CI.
COCOTB_RESULTS_FILE ?= results.xml

# --- Waveform dump -----------------------------------------------------------
# WAVES=1 enables FST tracing.  Icarus: automatic FST dump (file: <TOPLEVEL>.fst).
# Verilator: --trace --trace-fst --trace-structs produce dump.fst (hierarchy kept).
WAVES ?= 1
ifeq ($(WAVES),1)
  ifeq ($(SIM),verilator)
    EXTRA_ARGS += --trace --trace-fst --trace-structs
  endif
endif

# --- Verilog sources (DUT + any helpers) -------------------------------------
# For golden fixtures, point RTL_SOURCES at tests/golden/fixtures/verilog/modules.
RTL_DIR      ?= ../../../../tests/golden/fixtures/verilog/modules
VERILOG_SOURCES = $(RTL_DIR)/<dut>.v

# --- Include the cocotb Makefile ----------------------------------------------
include $(shell cocotb-config --makefiles)/Makefile.sim
