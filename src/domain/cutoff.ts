// « Commandes du jour » : tout ce qui a été acheté avant l'heure de coupure locale d'aujourd'hui.

/** Décalage (ms) du fuseau `timeZone` par rapport à UTC à l'instant `date`. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const p = (t: string) => Number(parts.find((x) => x.type === t)?.value);
  const asUtc = Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"), p("second"));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Date locale (YYYY-MM-DD) de `date` dans `timeZone`. */
export function localDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Instant UTC correspondant à `localDay` + `hhmm` dans `timeZone`. */
export function zonedInstant(localDay: string, hhmm: string, timeZone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDay) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) {
    throw new RangeError(`Date ou heure invalide : ${localDay} ${hhmm}`);
  }
  const [y, m, d] = localDay.split("-").map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Deux passes pour gérer les changements d'heure
  let instant = guess - tzOffsetMs(new Date(guess), timeZone);
  instant = guess - tzOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** Heure limite du lot du jour pour l'instant `now`. */
export function lotCutoff(now: Date, cutoff: string, timeZone: string): Date {
  return zonedInstant(localDate(now, timeZone), cutoff, timeZone);
}

export function isInTodaysLot(purchaseDate: string, now: Date, cutoff: string, timeZone: string): boolean {
  const t = Date.parse(purchaseDate);
  return Number.isFinite(t) && t < lotCutoff(now, cutoff, timeZone).getTime();
}
