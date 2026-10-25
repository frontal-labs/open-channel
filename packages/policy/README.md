# ocp-policy

Reference policy interfaces and ordered rule-based evaluation for OCP actions.

`RuleBasedPolicyEngine` uses the first matching rule. If no rule matches, the configured default decision is returned; the default is deny unless overridden.

```ts
new RuleBasedPolicyEngine({
  rules: [{ id: "internal", actionType: "message_internal_channel", allowed: true }],
});
```
