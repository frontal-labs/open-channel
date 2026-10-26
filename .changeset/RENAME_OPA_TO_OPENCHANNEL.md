---
"ocp-sdk": minor
---

Rename the OPA policy adapter subpath from `ocp-sdk/opa` to `ocp-sdk/openchannel`. Replace the `opaPolicy`, `OpaPolicyEngine`, and `OpaTransport` exports with `openchannelPolicy`, `OpenchannelPolicyEngine`, and `OpenchannelTransport`. Policy IDs change from `opa:*` to `openchannel:*`, and the provider name changes from `opa` to `openchannel`. Update imports and any code that matches on those IDs. The adapter still evaluates Open Policy Agent decisions through your transport.
