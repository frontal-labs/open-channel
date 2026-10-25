import { ActionError } from "ocp-core";
import { z } from "zod";
import type { ActionDefinition } from "../types.js";
import { action } from "../types.js";

import type {
  CalendarActions,
  CalendarCancelInput,
  CalendarClient,
  CalendarCreateInput,
  CalendarEvent,
  CalendarUpdateInput,
} from "./types.js";

const calendarFields = {
  attendees: z.array(z.string().min(1)).optional(),
  conference: z.boolean().optional(),
  description: z.string().optional(),
  end: z.string().min(1),
  start: z.string().min(1),
  timezone: z.string().optional(),
  title: z.string().min(1),
};

/**
 * Requires `end` to be later than `start`. Only checked when both are present, so a partial
 * update that changes one of them passes here. An unparseable time compares as not later and fails.
 */
function endsAfterStart(range: { start?: string; end?: string }): boolean {
  if (range.start === undefined || range.end === undefined) {
    return true;
  }
  return Date.parse(range.end) > Date.parse(range.start);
}

const endAfterStartIssue = { message: "end must be a time after start", path: ["end"] };

const CalendarCreateSchema = z.object(calendarFields).refine(endsAfterStart, endAfterStartIssue);

const CalendarUpdateSchema = z
  .object(calendarFields)
  .partial()
  .extend({ eventId: z.string().min(1) })
  .refine(endsAfterStart, endAfterStartIssue);

const CalendarCancelSchema = z.object({
  eventId: z.string().min(1),
  reason: z.string().optional(),
});

/**
 * Runs one provider call and classifies its failure. An `ActionError` thrown by the client
 * keeps its own code and retry flag; anything else becomes a retryable calendar error.
 */
async function callProvider<T>(failureMessage: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ActionError) {
      throw error;
    }
    throw new ActionError(failureMessage, { cause: error, provider: "calendar", retryable: true });
  }
}

/**
 * Creates the three policy-controlled calendar actions (`calendar.create`, `calendar.update`,
 * `calendar.cancel`). Input is validated before the SDK asks policy for a decision, so a
 * rejected input never reaches policy or the client.
 */
export function calendarActions(client: CalendarClient): CalendarActions {
  const createAction = action<CalendarCreateInput, CalendarEvent>({
    execute: (input) => callProvider("Calendar event creation failed", () => client.create(input)),
    type: "calendar.create",
    validate: (input) => CalendarCreateSchema.parse(input),
  });
  const updateAction = action<CalendarUpdateInput, CalendarEvent>({
    execute: (input) => callProvider("Calendar event update failed", () => client.update(input)),
    type: "calendar.update",
    validate: (input) => CalendarUpdateSchema.parse(input),
  });
  const cancelAction = action<CalendarCancelInput, { cancelled: boolean }>({
    execute: (input) =>
      callProvider("Calendar event cancellation failed", () => client.cancel(input)),
    type: "calendar.cancel",
    validate: (input) => CalendarCancelSchema.parse(input),
  });
  return [createAction, updateAction, cancelAction] as CalendarActions;
}

/**
 * Identity helper that gives one action definition its input and result types. It does not
 * add validation; `validate` must still be supplied by the caller.
 */
export function calendarAction<TInput, TResult>(
  definition: ActionDefinition<TInput, TResult>,
): ActionDefinition<TInput, TResult> {
  return definition;
}
