# open-channel-cli

The `ocp` command-line tool for inspecting and validating OCP events.

Install the published npm package with:

```bash
pnpm add --global open-channel-cli
```

## Commands

```bash
ocp help
ocp version
ocp validate event.json
cat event.json | ocp validate
```

`validate` accepts OCP ProtoJSON and validates both the protobuf envelope and OCP event/payload invariants.

The command exits with status `0` for a valid event and status `1` for invalid
JSON, an invalid envelope, or an event/payload mismatch.

## Development

```bash
pnpm cli -- version
pnpm --filter ocp-cli build
```
