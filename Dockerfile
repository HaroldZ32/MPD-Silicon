# Real-machine verification image for @mpd-dsh/silicon.
#
# It exists to run the repository's §3 gate sequence on a machine where the
# EDA tools are REAL (iverilog / verilator / yosys from Debian bookworm), not
# stubbed: `docker/verify.sh` runs the full gate suite and then simulates,
# lints and synthesizes the shipped golden RTL.
#
# Build and run are network-free after the image exists: `docker build` needs
# network for apt and `bun install`, `docker run` needs none.

# Pinned bun, copied out of the upstream image so the binary is exactly the
# 1.4.3 CI uses (see .github/workflows/ci.yml, oven-sh/setup-bun).
FROM oven/bun:1.4.3 AS bun

FROM node:24-bookworm

# The one file we need from the bun stage; nothing else is inherited.
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

# Debian bookworm ships iverilog, verilator and yosys; git/make/g++/python3 are
# what the corpus, LSP and pack gates spawn. --no-install-recommends keeps the
# image lean; the apt lists are removed in the same layer.
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      git \
      make \
      g++ \
      python3 \
      iverilog \
      verilator \
      yosys \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /work

# Dependency layer: the manifest and the lock alone, so a source change does
# not re-resolve the tree. --frozen-lockfile makes the image and CI agree.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# The tree. .dockerignore keeps the local state dirs, node_modules, the root
# pack output and the evidence records out of the context (the corpus baseline
# under evidence/verification is the one exception: a gate reads it). The
# COMMITTED packages/*/dist stay in the image because the LSP gate verifies
# them against BUILD.lock.
COPY . .

# The entrypoint must stay executable even if the checkout loses the mode bit.
RUN chmod +x /work/docker/verify.sh

ENTRYPOINT ["/work/docker/verify.sh"]
