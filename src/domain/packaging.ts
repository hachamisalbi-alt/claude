import { totalQuantity, type AmazonOrder } from "./amazonReport";

export interface BoxProfile {
  length: number; width: number; height: number; unit: "in";
  weight: number; weight_unit: "lb";
}
export type BoxKind = "single" | "multi";

export interface PackagingProposal {
  box: BoxKind;
  dimensions: BoxProfile;
  /** Les envois multi-articles doivent être confirmés par l'utilisateur. */
  needsConfirmation: boolean;
}

export function proposePackaging(order: Pick<AmazonOrder, "items">, boxes: Record<BoxKind, BoxProfile>): PackagingProposal {
  const box: BoxKind = totalQuantity(order) > 1 ? "multi" : "single";
  return { box, dimensions: boxes[box], needsConfirmation: box === "multi" };
}
