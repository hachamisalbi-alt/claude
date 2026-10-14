export interface Rate {
  carrier: string;
  service: string;
  total: number; // CAD, taxes incluses
  estimatedDays?: number;
}

export interface Selection {
  rate: Rate;
  reason: "preferred" | "cheapest";
}

const matches = (r: Rate, preferred: string) =>
  `${r.carrier} ${r.service}`.toLowerCase().includes(preferred.toLowerCase());

/** Transporteur préféré (Intelcom par défaut) s'il est proposé, sinon le moins cher. */
export function selectService(rates: Rate[], preferredCarrier: string): Selection | null {
  const valid = rates.filter((r) => Number.isFinite(r.total) && r.total > 0);
  const cheapest = (list: Rate[]) => list.reduce<Rate | null>((best, r) => (!best || r.total < best.total ? r : best), null);
  const preferred = preferredCarrier ? cheapest(valid.filter((r) => matches(r, preferredCarrier))) : null;
  if (preferred) return { rate: preferred, reason: "preferred" };
  const any = cheapest(valid);
  return any ? { rate: any, reason: "cheapest" } : null;
}
