// Side-effect import: registers the IANA timezone set with ICAL.TimezoneService
// at module load. Consumers of @miguelarios/pim-core/ics get tz resolution wired
// up by virtue of importing from this barrel.
import "./_tz-init.js";

export { IcsParseError, IcsGenerateError } from "./errors.js";
export type {
  ParsedAlarm,
  ParsedAttendee,
  ParsedOrganizer,
  ParsedGeo,
  ParsedEvent,
  ParsedTodo,
  ParsedJournal,
  TimeRange,
  EventCreateProps,
  TodoCreateProps,
} from "./types.js";
export { normalizeRecurrenceRule } from "./rrule.js";
export { parseIcsEvents } from "./parse-events.js";
export { parseIcsTodos } from "./parse-todos.js";
export { parseIcsJournals } from "./parse-journals.js";
export { generateEventIcs } from "./generate.js";
export { generateTodoIcs } from "./generate.js";
export {
  createExceptionComponent,
  combineIcsComponents,
  addExdateToIcs,
} from "./components.js";
export type { ExceptionOverrides } from "./components.js";
