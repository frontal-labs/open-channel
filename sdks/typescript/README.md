# ocp-sdk

The npm package `ocp-sdk` for building OCP agents, hosts, policy-controlled
actions, and channel integrations. Providers and capabilities ship as subpaths, such as
`ocp-sdk/slack` and `ocp-sdk/postgres`. See [docs/SUBPATHS.md](docs/SUBPATHS.md).

```bash
pnpm add ocp-sdk
```

```ts
import { openChannel, RuleBasedPolicyEngine } from "ocp-sdk";
import { postgresStore } from "ocp-sdk/postgres";

const app = openChannel({
  policy: new RuleBasedPolicyEngine({ rules: [] }), // no actions granted yet
  store: postgresStore({ client }),                 // durable EventStore; any EventStore works
  agents: [
    {
      id: "agent:support",
      name: "Support Agent",
      onMessage: async (context) => {
        await context.reply(`Received: ${context.message.text}`);
      },
    },
  ],
});

await app.start();
```

`openChannel()` composes the runtime, `AgentHost`, channel source/sink
registration, action registry, lifecycle, and hooks. Use `AgentHost` directly
when an application needs lower-level composition. The package also exposes
the typed event builders through `ocp-sdk`. There is one envelope, version `2.0`.

## Development

```bash
pnpm --filter ocp-sdk build
pnpm --filter ocp-sdk typecheck
pnpm --filter ocp-sdk test
```

## Recovery, audit, and logging

- **Restart recovery.** `start()` rebuilds approval state from the event store. Unresolved approvals are tracked again, a deadline that passed while the process was down expires immediately, and a granted approval whose action never finished runs once. Restart with the same store and the same registered actions.
- **Audit.** `app.store` is the durable event store. Query it directly, for example `app.store.query({ eventType: "approval.granted" })`.
- **Logging.** Agents receive `ctx.logger`. It defaults to `consoleLogger`, which sends warnings and errors to the console. Pass `logger` to `openChannel()` to replace it.
