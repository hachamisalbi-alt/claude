// Machine à états d'un achat d'étiquette + garde-fous de confirmation.

export type LabelState = "draft" | "confirmed" | "purchasing" | "purchased" | "failed" | "voided";

const TRANSITIONS: Record<LabelState, LabelState[]> = {
  draft: ["confirmed"],
  confirmed: ["purchasing", "draft"],
  // « purchasing » peut être relancé avec la même clé : Stallion renvoie l'achat existant
  purchasing: ["purchasing", "purchased", "failed"],
  purchased: ["voided"],
  failed: [],
  voided: [],
};

export function assertTransition(from: LabelState, to: LabelState): void {
  if (!TRANSITIONS[from].includes(to)) throw new Error(`Transition interdite : ${from} → ${to}`);
}

/**
 * Clé déterministe : une relance (double clic, coupure réseau, crash) réutilise la même clé,
 * donc Stallion ne facture jamais deux fois. La version ne change qu'après annulation ou échec.
 */
export function idempotencyKey(amazonOrderId: string, version: number): string {
  if (!/^[\w-]+$/.test(amazonOrderId) || !Number.isInteger(version) || version < 1) {
    throw new Error(`Commande ou version invalide : ${amazonOrderId} v${version}`);
  }
  return `mdk-label-${amazonOrderId}-v${version}`;
}

export interface LotLine {
  amazonOrderId: string;
  cost: number;
  needsConfirmation: boolean;
  packagingConfirmed: boolean;
}

export class ConfirmationError extends Error {}

const cents = (n: number) => Math.round(n * 100);

/** Total en dollars, calculé en cents pour éviter les erreurs d'arrondi. */
export function lotTotal(lines: LotLine[]): number {
  return lines.reduce((s, l) => s + cents(l.cost), 0) / 100;
}

/**
 * Refuse l'achat si un colis multi-articles n'est pas confirmé ou si le total
 * a changé depuis l'affichage (tarif modifié entre-temps).
 */
export function validateConfirmation(lines: LotLine[], confirmedTotal: number): void {
  if (lines.length === 0) throw new ConfirmationError("Aucune commande sélectionnée.");
  const unconfirmed = lines.filter((l) => l.needsConfirmation && !l.packagingConfirmed);
  if (unconfirmed.length) {
    throw new ConfirmationError(`Boîte 8x8x8 à confirmer : ${unconfirmed.map((l) => l.amazonOrderId).join(", ")}`);
  }
  if (cents(lotTotal(lines)) !== cents(confirmedTotal)) {
    throw new ConfirmationError(`Le total a changé (${lotTotal(lines).toFixed(2)} $ au lieu de ${confirmedTotal.toFixed(2)} $). Recomparez les tarifs.`);
  }
}
