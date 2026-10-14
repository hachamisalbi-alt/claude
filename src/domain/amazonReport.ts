// Lecture du rapport « Commandes non expédiées » de Seller Central (TSV avec en-tête).

export interface OrderItem {
  orderItemId: string;
  sku: string;
  productName: string;
  quantity: number;
}

export interface AmazonOrder {
  amazonOrderId: string;
  purchaseDate: string; // ISO 8601
  recipientName: string;
  address1: string;
  address2: string;
  address3: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  phone: string;
  items: OrderItem[];
}

const REQUIRED = [
  "order-id", "order-item-id", "purchase-date", "sku", "quantity-to-ship",
  "recipient-name", "ship-address-1", "ship-city", "ship-state", "ship-postal-code", "ship-country",
] as const;

export class ReportFormatError extends Error {}

export function parseUnshippedOrdersReport(tsv: string): AmazonOrder[] {
  const lines = tsv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = (lines.shift() ?? "").split("\t").map((h) => h.trim().toLowerCase());
  // Selon le rapport, la quantité s'appelle quantity-to-ship ou quantity-purchased
  const qtyCol = header.includes("quantity-to-ship") ? "quantity-to-ship" : "quantity-purchased";
  const missing = REQUIRED.filter((c) => (c === "quantity-to-ship" ? !header.includes(qtyCol) : !header.includes(c)));
  if (missing.length) throw new ReportFormatError(`Colonnes manquantes : ${missing.join(", ")}`);

  const orders = new Map<string, AmazonOrder>();
  for (const line of lines) {
    const cells = line.split("\t");
    const get = (col: string) => (cells[header.indexOf(col)] ?? "").trim();
    const id = get("order-id");
    if (!id) continue;
    let order = orders.get(id);
    if (!order) {
      order = {
        amazonOrderId: id,
        purchaseDate: get("purchase-date"),
        recipientName: get("recipient-name"),
        address1: get("ship-address-1"),
        address2: get("ship-address-2"),
        address3: get("ship-address-3"),
        city: get("ship-city"),
        province: get("ship-state"),
        postalCode: get("ship-postal-code"),
        country: get("ship-country"),
        phone: get("ship-phone-number") || get("buyer-phone-number"),
        items: [],
      };
      orders.set(id, order);
    }
    const quantity = Number.parseInt(get(qtyCol), 10);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    order.items.push({ orderItemId: get("order-item-id"), sku: get("sku"), productName: get("product-name"), quantity });
  }
  return [...orders.values()].filter((o) => o.items.length > 0);
}

export const totalQuantity = (o: Pick<AmazonOrder, "items">) => o.items.reduce((n, i) => n + i.quantity, 0);
