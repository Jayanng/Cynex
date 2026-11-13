# Contract toolchain evidence (2026-11-03)

rustc 1.99.0 (b940084d7 2026-09-28)
cargo 1.99.0 (5f94df478 2026-08-27)
rustup target list --installed output: wasm32-unknown-unknown, x86_64-unknown-linux-gnu
cargo near --version prints cargo-near-near 0.22.0
near-cli 4.0.13
cargo-audit 0.22.2
cargo-deny 0.20.2
cargo-geiger 0.14.0
cargo fmt --version: rustfmt 1.10.0-stable (b940084d7e 2026-09-28)
cargo clippy --version: clippy 0.1.99 (b940084d7e 2026-09-28)

Skills loaded for contract work:
near-smart-contracts, near-contract-audit
Note from near-smart-contracts: always cargo near new, never hand-write
Cargo.toml / lib.rs for a new contract. ft_transfer returns unit.

Version command exit codes, re-run 2026-11-03: rustc 0, cargo 0, cargo near 0, near 0, node 0, npm 0, cargo-audit 0, cargo-deny 0, cargo-geiger 0.
