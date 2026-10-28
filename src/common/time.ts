/** Business time zone; "daily" numbering and reports cut over at local midnight. */
export const APP_TIMEZONE = 'Asia/Vientiane';

/** Local calendar parts in the shop's time zone. */
export function localDateParts(date: Date, timeZone = APP_TIMEZONE) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { year: parts.year, month: parts.month, day: parts.day };
}

/** UTC instant of local midnight for a `YYYY-MM-DD` date in the shop's time zone. */
export function startOfLocalDay(
  isoDate: string,
  timeZone = APP_TIMEZONE,
): Date {
  // Vientiane has no DST, so the offset at noon that day is the offset at midnight.
  const noonUtc = new Date(`${isoDate}T12:00:00Z`);
  const local = new Date(noonUtc.toLocaleString('en-US', { timeZone }));
  const offsetMs = local.getTime() - noonUtc.getTime();
  return new Date(new Date(`${isoDate}T00:00:00Z`).getTime() - offsetMs);
}

/** Today's date as `YYYY-MM-DD` in the shop's time zone. */
export function localToday(now = new Date(), timeZone = APP_TIMEZONE): string {
  const { year, month, day } = localDateParts(now, timeZone);
  return `${year}-${month}-${day}`;
}

/** Same day `months` later (UTC calendar). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}
