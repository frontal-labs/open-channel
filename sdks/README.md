# OCP SDKs

The TypeScript, Python, and Rust distributions all use the package name
`ocp-sdk` in their respective registries. Their import identifier is also
`ocp-sdk`:

| SDK                            | Distribution                     | Import/module                | Primary API                       |
| ------------------------------ | -------------------------------- | ---------------------------- | --------------------------------- |
| [`typescript/`](./typescript/) | npm `ocp-sdk` | `ocp-sdk` | `openChannel`, `AgentHost`        |
| [`python/`](./python/)         | PyPI `ocp-sdk`              | `ocp-sdk`               | `OpenChannel`, `AgentHost`        |
| [`rust/`](./rust/)             | crates.io `ocp-sdk`         | `ocp-sdk`               | `OpenChannelOptions`, `OpenChannel` |

All SDKs expose one event API for both wire versions: `2.0` is the canonical
envelope in `proto/ocp`. There is one envelope and one protocol version, `2.0`.
Generated bindings live under `proto/gen`.
They expose transport-neutral application APIs; provider SDKs,
credentials, and framework-specific orchestration belong in adapters or the
opt-in examples.

Install the SDK for the language you use:

```bash
pnpm add ocp-sdk
python -m pip install ocp-sdk
cargo add ocp-sdk
```
