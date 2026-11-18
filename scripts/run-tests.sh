#!/usr/bin/env bash
# Runs the whole compatibility suite: Rust engine vs recorded JS output, then pixel parity in Chrome.
# Pixel parity needs Python 3 + playwright + Chrome (optional; the Rust tests need only cargo).
set -euo pipefail
cd "$(dirname "$0")/.."
cargo test --release -p popai-core
(cd ui && npm run build)
cargo build --release -p popai-engine-host
./target/release/popai-engine-host --port 7878 --ui ui/dist & HOST=$!
trap 'kill $HOST' EXIT
sleep 1
python3 tests/parity/pixel_parity.py
