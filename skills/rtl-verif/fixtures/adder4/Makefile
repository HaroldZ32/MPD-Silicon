# ============================================================================
# Makefile -- adder4 golden-fixture cocotb runner (DP-6 standard flow)
# ----------------------------------------------------------------------------
# Run (VENV-first):
#   source ../../templates/cocotb/bootstrap_venv.sh
#   make sim SIM=icarus       # or SIM=verilator
# ============================================================================

SIM             ?= icarus
TOPLEVEL        ?= adder4
MODULE          ?= tb_adder4
TOPLEVEL_LANG    = verilog
COCOTB_TEST_MODULES ?= $(MODULE)
COCOTB_RESULTS_FILE ?= results.xml

# FST waveform dump (DP-6): Icarus auto-FST via WAVES=1; Verilator via EXTRA_ARGS.
WAVES ?= 1
ifeq ($(WAVES),1)
  ifeq ($(SIM),verilator)
    EXTRA_ARGS += --trace --trace-fst --trace-structs
  endif
endif

# DUT source: golden fixture adder4.v
RTL_DIR ?= ../../../../tests/golden/fixtures/verilog/modules
VERILOG_SOURCES = $(RTL_DIR)/adder4.v

include $(shell cocotb-config --makefiles)/Makefile.sim
