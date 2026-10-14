// Fichier « Confirmation d'expédition » à téléverser dans Seller Central
// (Commandes → Téléverser des fichiers liés aux commandes).

export interface ShippedItem {
  amazonOrderId: string;
  orderItemId: string;
  quantity: number;
  shipDate: string; // YYYY-MM-DD
  carrier: string;
  service: string;
  trackingNumber: string;
}

const HEADER = ["order-id", "order-item-id", "quantity", "ship-date", "carrier-code", "carrier-name", "tracking-number", "ship-method"];

// Transporteurs reconnus par Amazon (code exact). Les autres passent par « Other » + nom.
// [à vérifier] présence d'Intelcom dans la liste des transporteurs Amazon.ca.
const AMAZON_CARRIER_CODES: Record<string, string> = {
  "canada post": "Canada Post",
  "postes canada": "Canada Post",
  purolator: "Purolator",
  ups: "UPS",
  fedex: "FedEx",
};

const clean = (s: string) => s.replace(/[\t\r\n]/g, " ").trim();

export function shippingConfirmationTsv(items: ShippedItem[]): string {
  const rows = items.map((i) => {
    const code = AMAZON_CARRIER_CODES[i.carrier.trim().toLowerCase()];
    return [i.amazonOrderId, i.orderItemId, String(i.quantity), i.shipDate,
      code ?? "Other", code ? "" : i.carrier, i.trackingNumber, i.service].map(clean).join("\t");
  });
  return [HEADER.join("\t"), ...rows].join("\r\n") + "\r\n";
}
