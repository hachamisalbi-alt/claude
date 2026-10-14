import { PDFDocument } from "pdf-lib";

export interface LabelFile {
  amazonOrderId: string;
  skus: string[];
  pdf: Uint8Array;
}

/** Clé de tri : SKU (les commandes multi-SKU sont regroupées après leur premier SKU). */
export const sortKey = (l: LabelFile) => [...l.skus].sort().join("+");

/** Fusionne toutes les étiquettes 4x6 en un seul PDF trié par SKU puis par commande. */
export async function mergeLabelsBySku(labels: LabelFile[]): Promise<Uint8Array> {
  const sorted = [...labels].sort((a, b) =>
    sortKey(a).localeCompare(sortKey(b)) || a.amazonOrderId.localeCompare(b.amazonOrderId));
  const out = await PDFDocument.create();
  for (const label of sorted) {
    const src = await PDFDocument.load(label.pdf);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}
