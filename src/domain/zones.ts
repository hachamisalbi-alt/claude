// Zones de destination : RTA (3 premiers caractères du code postal canadien).

const POSTAL = /^([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\s?(\d[ABCEGHJ-NPRSTV-Z]\d)$/;

export function normalizePostalCode(raw: string): string | null {
  const m = raw.toUpperCase().replace(/[\s-]/g, "").match(POSTAL);
  return m ? `${m[1]} ${m[2]}` : null;
}

export function fsaOf(raw: string): string | null {
  return normalizePostalCode(raw)?.slice(0, 3) ?? null;
}
