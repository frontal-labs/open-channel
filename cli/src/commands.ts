import { readFile } from "node:fs/promises";
import type { JsonValue } from "@bufbuild/protobuf";
import { eventType, fromJson, PROTOCOL_VERSION } from "@openchannelprotocol/protocol";

/** I/O operations required by the OCP CLI commands. */
export interface CliIO {
  readStdin: () => Promise<string>;
  stderr: (message: string) => void;
  stdout: (message: string) => void;
}

/** Human-readable CLI usage text. */
export const HELP_TEXT = `OCP CLI ${PROTOCOL_VERSION}

Usage:
  ocp help
  ocp version
  ocp validate [event.json]

Commands:
  help              Show this help.
  version           Print the protocol version.
  validate [file]   Validate an OCP ProtoJSON event from a file or stdin.
`;

/** Runs one OCP CLI command and returns a process-style exit code. */
export async function runCommand(args: string[], io: CliIO): Promise<number> {
  const [command = "help", target] = args;

  if (command === "help" || command === "--help" || command === "-h") {
    io.stdout(HELP_TEXT);
    return 0;
  }

  if (command === "version" || command === "--version") {
    io.stdout(PROTOCOL_VERSION);
    return 0;
  }

  if (command === "validate") {
    try {
      const source = target ? await readFile(target, "utf8") : await io.readStdin();
      const event = fromJson(JSON.parse(source) as JsonValue);
      io.stdout(`valid OCP event: ${eventType(event)}`);
      return 0;
    } catch (error) {
      io.stderr(`invalid OCP event: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  io.stderr(`Unknown command: ${command}`);
  io.stderr(HELP_TEXT);
  return 1;
}
