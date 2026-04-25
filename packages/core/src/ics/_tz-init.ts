import { getVtimezone } from "@touch4it/ical-timezones";
import zones from "@touch4it/ical-timezones/zones.js";
import ICAL from "ical.js";

let initialized = false;

export function initializeTimezones(): void {
  if (initialized) return;
  initialized = true;

  for (const tzid of Object.keys(zones)) {
    if (ICAL.TimezoneService.has(tzid)) continue;

    const vtimezoneBlock = getVtimezone(tzid);
    if (!vtimezoneBlock || typeof vtimezoneBlock !== "string") continue;

    try {
      const root = ICAL.Component.fromString(vtimezoneBlock);
      const vtz = root.getFirstSubcomponent("vtimezone");
      if (vtz) {
        const tz = new ICAL.Timezone({ component: vtz });
        ICAL.TimezoneService.register(tz, tzid);
      }
    } catch {
      // Skip any malformed entries silently — vendor data, not user input.
    }
  }
}

initializeTimezones();
