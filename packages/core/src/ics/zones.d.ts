declare module "@touch4it/ical-timezones/zones.js" {
  // Values are opaque (filenames, not VTIMEZONE blocks). Only Object.keys is used.
  const zones: Readonly<Record<string, unknown>>;
  export default zones;
}
