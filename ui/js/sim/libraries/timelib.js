// time.h and NTP: time(), localtime_r(), strftime(), setenv("TZ", ...), and
// on ESP boards configTime() / getLocalTime(). The time comes from the
// laptop's clock once the pretend NTP server answers (about a second after
// configTime() with WiFi connected). Time zones follow POSIX TZ strings,
// e.g. "AEST-10AEDT,M10.1.0,M4.1.0/3" for Melbourne.

import { Ptr, cstr, writeCStr } from "../values.js";
import { waitFor } from "../api.js";

const HEADER = `
struct tm {
  int tm_sec;
  int tm_min;
  int tm_hour;
  int tm_mday;
  int tm_mon;
  int tm_year;
  int tm_wday;
  int tm_yday;
  int tm_isdst;
};
time_t time(time_t* t);
struct tm* localtime(const time_t* t);
struct tm* gmtime(const time_t* t);
struct tm* localtime_r(const time_t* t, struct tm* result);
struct tm* gmtime_r(const time_t* t, struct tm* result);
time_t mktime(struct tm* tm);
size_t strftime(char* s, size_t max, const char* format, const struct tm* tm);
double difftime(time_t a, time_t b);
int setenv(const char* name, const char* value, int overwrite);
int unsetenv(const char* name);
char* getenv(const char* name);
void tzset();
#ifndef __AVR__
void configTime(long gmtOffset_sec, int daylightOffset_sec, const char* server1, const char* server2 = nullptr, const char* server3 = nullptr);
void configTime(const char* tz, const char* server1, const char* server2 = nullptr, const char* server3 = nullptr);
void configTzTime(const char* tz, const char* server1, const char* server2 = nullptr, const char* server3 = nullptr);
bool getLocalTime(struct tm* info, uint32_t ms = 5000);
#endif
`;

/** Parses a POSIX TZ string into { std, dst, start, end } (offsets in seconds east of UTC). */
export function parseTZ(tz) {
  const off = (s) => {
    if (!s) return null;
    const m = /^([+-]?)(\d+)(?::(\d+))?(?::(\d+))?$/.exec(s);
    if (!m) return null;
    const v = Number(m[2]) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0);
    return m[1] === "-" ? v : -v || 0; // POSIX offsets count west of UTC
  };
  const name = "([A-Za-z]{3,}|<[^>]+>)";
  const num = "([+-]?\\d+(?::\\d+){0,2})";
  const rule = "(M\\d+\\.\\d+\\.\\d+(?:/[+-]?\\d+(?::\\d+){0,2})?)";
  const re = new RegExp(`^${name}${num}(?:${name}${num}?(?:,${rule},${rule})?)?$`);
  const m = re.exec(String(tz || "").trim());
  if (!m) return { std: 0, dst: null };
  const std = off(m[2]);
  if (!m[3]) return { std, dst: null };
  const dst = m[4] ? off(m[4]) : std + 3600;
  const r = (s) => {
    if (!s) return null;
    const [, mo, w, d, t] = /^M(\d+)\.(\d+)\.(\d+)(?:\/(.*))?$/.exec(s);
    return { month: Number(mo), week: Number(w), day: Number(d), time: t ? -off(t) : 7200 };
  };
  return { std, dst, start: r(m[5]) ?? { month: 3, week: 2, day: 0, time: 7200 }, end: r(m[6]) ?? { month: 11, week: 1, day: 0, time: 7200 } };
}

/** Seconds since 1970 (UTC) when a "Mm.w.d/time" rule happens in a year, given the local offset then. */
function ruleUtc(year, rule, offset) {
  const first = new Date(Date.UTC(year, rule.month - 1, 1));
  let day = 1 + ((rule.day - first.getUTCDay() + 7) % 7) + (rule.week - 1) * 7;
  const days = new Date(Date.UTC(year, rule.month, 0)).getUTCDate();
  while (day > days) day -= 7;
  return Date.UTC(year, rule.month - 1, day) / 1000 + rule.time - offset;
}

/** The offset east of UTC (seconds) and whether it's daylight saving, at a UTC time. */
export function zoneOffset(zone, epoch) {
  if (!zone || zone.dst == null) return { offset: zone?.std ?? 0, isdst: 0 };
  const year = new Date(epoch * 1000).getUTCFullYear();
  const start = ruleUtc(year, zone.start, zone.std);
  const end = ruleUtc(year, zone.end, zone.dst);
  const inDst = start < end ? epoch >= start && epoch < end : epoch >= start || epoch < end;
  return inDst ? { offset: zone.dst, isdst: 1 } : { offset: zone.std, isdst: 0 };
}

/** Splits seconds-since-1970 into a struct tm object. */
export function toTm(epoch, offset = 0, isdst = 0) {
  const d = new Date((epoch + offset) * 1000);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return {
    tm_sec: d.getUTCSeconds(), tm_min: d.getUTCMinutes(), tm_hour: d.getUTCHours(),
    tm_mday: d.getUTCDate(), tm_mon: d.getUTCMonth(), tm_year: d.getUTCFullYear() - 1900,
    tm_wday: d.getUTCDay(), tm_yday: Math.floor((d.getTime() - start) / 86400000), tm_isdst: isdst,
  };
}

function clock(R) {
  if (!R.clockState) R.clockState = { synced: false, configured: false, zone: { std: 0, dst: null }, env: {} };
  return R.clockState;
}

/** Seconds since 1970: the laptop's clock once synced, otherwise time since the board started. */
function now(R) {
  const c = clock(R);
  if (c.synced) return Math.floor(R.now() / 1000);
  return Math.floor(R.us / 1e6);
}

function fillTm(R, epoch, utc, target) {
  const c = clock(R);
  const z = utc ? { offset: 0, isdst: 0 } : zoneOffset(c.zone, epoch);
  const tm = toTm(epoch, z.offset, z.isdst);
  Object.assign(target, tm);
  return target;
}

function scheduleSync(R) {
  const c = clock(R);
  if (c.synced || c.pending || !c.configured) return;
  if (R.wifi.status !== "connected") return;
  c.pending = R.at(R.us + 1_000_000, () => { c.synced = true; c.pending = null; });
}

const read = (p) => (p ? p.a[p.i] : 0);

export const functions = {
  time(R, p) {
    R.progress();
    const t = now(R);
    if (p) p.a[p.i] = t;
    return t;
  },
  localtime(R, p) { return new Ptr([fillTm(R, read(p), false, {})], 0); },
  gmtime(R, p) { return new Ptr([fillTm(R, read(p), true, {})], 0); },
  localtime_r(R, p, out) { fillTm(R, read(p), false, out.a[out.i]); return out; },
  gmtime_r(R, p, out) { fillTm(R, read(p), true, out.a[out.i]); return out; },
  mktime(R, p) {
    const tm = p.a[p.i];
    const local = Date.UTC(tm.tm_year + 1900, tm.tm_mon, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec) / 1000;
    const z = zoneOffset(clock(R).zone, local - clock(R).zone.std);
    const epoch = local - z.offset;
    fillTm(R, epoch, false, tm);
    return epoch | 0;
  },
  strftime(R, buf, max, fmt, p) {
    const s = R.strftime(cstr(fmt), p.a[p.i]);
    if (s.length >= max) return 0;
    writeCStr(buf, s);
    return s.length;
  },
  difftime(R, a, b) { return a - b; },
  setenv(R, name, value) { clock(R).env[cstr(name)] = cstr(value); return 0; },
  unsetenv(R, name) { delete clock(R).env[cstr(name)]; return 0; },
  getenv(R, name) {
    const v = clock(R).env[cstr(name)];
    if (v == null) return null;
    const a = new Int8Array(v.length + 1);
    for (let i = 0; i < v.length; i++) a[i] = v.charCodeAt(i);
    return new Ptr(a, 0);
  },
  tzset(R) {
    const tz = clock(R).env.TZ;
    if (tz != null) clock(R).zone = parseTZ(tz);
  },
  configTime(R, a, b, c) {
    const st = clock(R);
    if (typeof a === "number") {
      st.zone = { std: a + b, dst: null };
      void c;
    } else {
      st.env.TZ = cstr(a);
      st.zone = parseTZ(st.env.TZ);
    }
    st.configured = true;
    const prev = R.onWifiConnected;
    R.onWifiConnected = () => { prev?.(); scheduleSync(R); };
    scheduleSync(R);
  },
  configTzTime(R, tz, server) { functions.configTime(R, tz, server); },
  *getLocalTime(R, p, ms = 5000) {
    const st = clock(R);
    if (!st.synced) yield* waitFor(R, ms * 1000, () => st.synced);
    if (!st.synced) return 0;
    fillTm(R, now(R), false, p.a[p.i]);
    return p.a[p.i].tm_year > 116 ? 1 : 0;
  },
};

export default {
  headers: { "time.h": HEADER, "sys/time.h": "#include <time.h>" },
  functions,
};
