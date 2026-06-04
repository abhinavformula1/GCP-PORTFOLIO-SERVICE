/**
 * Timezone-aware location time/day/status display.
 *
 * Renders Abhinav's current local time, the delta vs the viewer's
 * resolved timezone, and a working-hours status pill. Pure browser
 * primitives — Intl + Date + setInterval, no API keys, no network calls.
 *
 * Why this matters for a recruiter: timezone is the first practical
 * question on every remote-hire conversation. Answering it inside the
 * Contact Info modal — right next to the location row — removes a
 * mental round-trip from "where are they?" to "is this a good time to
 * email?".
 *
 * The element IDs this module writes to (`locPopoverTime`,
 * `locPopoverDay`, `locPopoverDelta`, `locPopoverStatus`,
 * `locPopoverStatusText`) used to live in an inline hover popover; they
 * now live inside the Contact Info dialog. The kept names are honest:
 * the *behaviour* is still "popover-style live data", just rehoused.
 *
 * Public API: `initLocationPopover()`. Call once on boot from main.js.
 */

export function initLocationPopover() {
  var timeEl       = document.getElementById('locPopoverTime');
  var dayEl        = document.getElementById('locPopoverDay');
  var deltaEl      = document.getElementById('locPopoverDelta');
  var statusEl     = document.getElementById('locPopoverStatus');
  var statusTextEl = document.getElementById('locPopoverStatusText');
  if (!timeEl || !deltaEl || !statusEl || !statusTextEl) return;

  var IST_TZ = 'Asia/Kolkata';
  // 9 AM – 8 PM IST = comfortable working window.
  var WORKING_START_HOUR = 9;
  var WORKING_END_HOUR   = 20;

  // Resolve the viewer's timezone via Intl. Falls back gracefully on
  // ancient browsers; on undetectable TZs we just hide the delta line.
  var viewerTz = '';
  try { viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}

  /** Format the IST hour:minute as "h:mm AM/PM" (12h, locale-stable). */
  function formatIstTime(now) {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: IST_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
      }).format(now);
    } catch (_) {
      return '--:--';
    }
  }

  /** Format the IST day-of-week ("Mon", "Tue", ...). Disambiguates the
   *  international-date-line case where the viewer's calendar day is
   *  different from Bengaluru's. Subtle but important — recruiters often
   *  forget that "evening for them" is "next morning IST". */
  function formatIstDay(now) {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: IST_TZ, weekday: 'short',
      }).format(now);
    } catch (_) {
      return '';
    }
  }

  /** Returns the integer "hour" in the IST timezone for status logic. */
  function istHour(now) {
    try {
      return parseInt(new Intl.DateTimeFormat('en-GB', {
        timeZone: IST_TZ, hour: '2-digit', hour12: false,
      }).format(now), 10);
    } catch (_) {
      return -1;
    }
  }

  /** Compute the offset (in hours, signed) between IST and the viewer's TZ.
   *  Uses the formatToParts trick to ask Intl for the IST time and the
   *  viewer's local time at the same instant, then diffs them.
   *  Stable across DST transitions — we recompute on every tick. */
  function computeDeltaHours(now) {
    if (!viewerTz) return null;
    try {
      var istMin    = localOffsetMinutes(IST_TZ,   now);
      var viewerMin = localOffsetMinutes(viewerTz, now);
      return (istMin - viewerMin) / 60;
    } catch (_) {
      return null;
    }
  }

  /** Build a "wall clock" Date as if the instant were in `tz`, then diff it
   *  from the actual UTC instant to recover the offset. Lifted out of
   *  computeDeltaHours so the working-window logic below can reuse it. */
  function localOffsetMinutes(tz, now) {
    var dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    var parts = dtf.formatToParts(now).reduce(function (acc, p) {
      if (p.type !== 'literal') acc[p.type] = p.value; return acc;
    }, {});
    var asUTC = Date.UTC(
      +parts.year, +parts.month - 1, +parts.day,
      +parts.hour, +parts.minute, +parts.second
    );
    return (asUTC - now.getTime()) / 60000;
  }

  function formatDelta(hours) {
    if (hours == null) return '';
    if (Math.abs(hours) < 0.01) return 'Same timezone as you';
    var rounded = Math.round(hours * 2) / 2;
    var abs = Math.abs(rounded);
    var label = (abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(1)) + ' h';
    return rounded > 0
      ? label + ' ahead of you'
      : label + ' behind you';
  }

  function updateStatus(hour) {
    var status, label;
    if (hour < 0) {                                 status = 'asleep';  label = '—'; }
    else if (hour >= WORKING_START_HOUR && hour < WORKING_END_HOUR) { status = 'working'; label = 'Working hours'; }
    else if (hour >= WORKING_END_HOUR  && hour < 23) { status = 'late';    label = 'Late evening'; }
    else                                            { status = 'asleep';  label = 'Likely asleep'; }
    statusEl.setAttribute('data-status', status);
    statusTextEl.textContent = label;
  }

  function tick() {
    var now = new Date();
    timeEl.textContent  = formatIstTime(now);
    if (dayEl) dayEl.textContent = formatIstDay(now);
    deltaEl.textContent = formatDelta(computeDeltaHours(now));
    updateStatus(istHour(now));
  }

  tick();
  // Update once a minute. setInterval is fine here — the page lives for
  // the duration of a recruiter's visit, no need for visibilitychange games.
  setInterval(tick, 60 * 1000);
}
