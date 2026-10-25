import { describe, expect, it } from "vitest";

import { createActionId, createCorrelationId, ValidationError } from "../src/index.js";

const ACTION_ID_PATTERN = /^action:[0-9a-f-]{36}$/;
const CORRELATION_ID_PATTERN = /^corr:[0-9a-f-]{36}$/;

describe("ocp-core", () => {
  it("creates namespaced identifiers and classified errors", () => {
    expect(createActionId()).toMatch(ACTION_ID_PATTERN);
    expect(createCorrelationId()).toMatch(CORRELATION_ID_PATTERN);
    expect(new ValidationError("invalid").code).toBe("OCP_VALIDATION");
  });
});
