# Email-MCP Timezone Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert email-mcp date output from UTC to the user's local timezone, matching the cal-mcp pattern.

**Architecture:** Add timezone resolution to `ImapService` constructor via pim-core's `getTimezone()`. Replace two `.toISOString()` calls with `formatInTimezone()`. Update tests to use `PIM_TIMEZONE` for deterministic assertions.

**Tech Stack:** TypeScript, pim-core timezone utilities, Vitest

---

### Task 1: Write failing test for timezone-formatted dates in searchEmails

**Files:**
- Modify: `packages/email-mcp/src/__tests__/ImapService.test.ts`

- [ ] **Step 1: Add timezone env var and new test**

Add `PIM_TIMEZONE` setup at the top of the test file (inside the outer `describe` block's `beforeEach`, or a new `beforeAll`), then add a test that asserts the date format includes an offset instead of `Z`.

At the top of the file, after the existing imports (line 2), add:

```typescript
import { beforeAll, afterAll } from "vitest";
```

Wait — `beforeAll` and `afterAll` are already available from `vitest` globals. Add them to the existing import on line 1:

In the existing import on line 1, `beforeAll` and `afterAll` are not imported but vitest globals are enabled, so they're available. Instead, set the env var in a dedicated describe block.

Add the following new `describe` block at the end of the file, before the closing of the outer describe (find the last `});` pair):

```typescript
describe("timezone formatting", () => {
  const originalTz = process.env.PIM_TIMEZONE;

  beforeAll(() => {
    process.env.PIM_TIMEZONE = "America/Chicago";
  });

  afterAll(() => {
    if (originalTz !== undefined) {
      process.env.PIM_TIMEZONE = originalTz;
    } else {
      delete process.env.PIM_TIMEZONE;
    }
  });

  it("formats searchEmails dates in user timezone", async () => {
    mockSearch.mockResolvedValueOnce([101]);

    const messages = [
      {
        uid: 101,
        envelope: {
          messageId: "<msg-tz@test.com>",
          subject: "TZ Test",
          from: [{ address: "a@test.com", name: "A" }],
          to: [{ address: "b@test.com", name: "B" }],
          date: new Date("2026-03-04T18:00:00Z"),
        },
        flags: new Set([]),
        bodyStructure: { type: "text/plain" },
      },
    ];
    mockFetch.mockReturnValueOnce(
      (async function* () {
        for (const msg of messages) yield msg;
      })(),
    );

    const results = await service.searchEmails("INBOX", {}, { limit: 10 });
    expect(results[0].date).toBe("2026-03-04T12:00:00-06:00");
  });

  it("formats fetchEmail dates in user timezone", async () => {
    const results = await service.fetchEmail("INBOX", 1);
    // Default mock has date: new Date("2026-03-04T12:00:00Z")
    // America/Chicago in March (CST) = UTC-6
    expect(results.date).toBe("2026-03-04T06:00:00-06:00");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/ImapService.test.ts`

Expected: FAIL — dates will still be UTC ISO strings like `"2026-03-04T18:00:00.000Z"` instead of `"2026-03-04T12:00:00-06:00"`.

---

### Task 2: Implement timezone conversion in ImapService

**Files:**
- Modify: `packages/email-mcp/src/services/ImapService.ts:1,55-57,179,222`

- [ ] **Step 1: Add imports and timezone property**

On line 1, add `formatInTimezone` and `getTimezone` to the pim-core import:

```typescript
import { type EmailConfig, EmailError, ErrorCode, formatInTimezone, getTimezone, toPimError } from "@miguelarios/pim-core";
```

- [ ] **Step 2: Add timezone field to ImapService class**

Replace the constructor block (lines 53-57):

```typescript
export class ImapService {
  private config: EmailConfig;
  private timezone: string;

  constructor(config: EmailConfig) {
    this.config = config;
    this.timezone = getTimezone();
  }
```

- [ ] **Step 3: Update fetchSummaries date formatting**

Replace line 179:

```typescript
        date: envelope.date ? formatInTimezone(envelope.date.toISOString(), this.timezone) : "",
```

- [ ] **Step 4: Update fetchEmail date formatting**

Replace line 222:

```typescript
          date: parsed.date ? formatInTimezone(parsed.date.toISOString(), this.timezone) : "",
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/ImapService.test.ts`

Expected: ALL PASS — timezone formatting tests pass, existing sort tests still pass (sort compares via `new Date()` which parses offset strings correctly).

- [ ] **Step 6: Run the full test suite**

Run: `npm test`

Expected: ALL PASS

- [ ] **Step 7: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`

Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/email-mcp/src/services/ImapService.ts packages/email-mcp/src/__tests__/ImapService.test.ts
git commit -m "feat(email-mcp): convert email dates to user's local timezone

Use pim-core getTimezone() and formatInTimezone() in ImapService,
matching the cal-mcp pattern. Dates now include timezone offset
instead of UTC Z suffix."
```

---

### Task 3: Update memory and close open issue

- [ ] **Step 1: Update MEMORY.md**

Remove "email-mcp dates returned in UTC, not user's timezone (deferred)" from the Open Issues section. Add a note under Recent Changes about the timezone conversion.

Note: `pim-core` already exports `getTimezone` and `formatInTimezone` from `packages/core/src/index.ts` (lines 34-35). No changes needed there.
