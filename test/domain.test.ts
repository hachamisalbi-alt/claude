import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { parseUnshippedOrdersReport, ReportFormatError } from "../src/domain/amazonReport";
import { isInTodaysLot, lotCutoff } from "../src/domain/cutoff";
import { proposePackaging, type BoxProfile } from "../src/domain/packaging";
import { selectService } from "../src/domain/serviceSelection";
import { assertTransition, ConfirmationError, idempotencyKey, lotTotal, validateConfirmation } from "../src/domain/labelPurchase";
import { mergeLabelsBySku } from "../src/domain/labelsPdf";
import { shippingConfirmationTsv } from "../src/domain/shippingConfirmation";
import { fsaOf, normalizePostalCode } from "../src/domain/zones";

const TZ = "America/Toronto";
const HEADER = "order-id\torder-item-id\tpurchase-date\tpayments-date\tbuyer-email\tbuyer-name\tsku\tproduct-name\tquantity-purchased\tquantity-shipped\tquantity-to-ship\tship-service-level\trecipient-name\tship-address-1\tship-address-2\tship-address-3\tship-city\tship-state\tship-postal-code\tship-country\tship-phone-number";
const row = (id: string, item: string, sku: string, qty: number, date = "2026-10-14T15:00:00+00:00") =>
  [id, item, date, date, "x@marketplace.amazon.ca", "Client", sku, "Produit", qty, 0, qty, "Standard", "Jean Tremblay", "123 rue Principale", "", "", "Laval", "QC", "h7n2a1", "CA", "5145550000"].join("\t");

describe("rapport Seller Central", () => {
  it("regroupe les lignes par commande", () => {
    const orders = parseUnshippedOrdersReport([HEADER, row("701-1", "a", "SKU-A", 1), row("701-1", "b", "SKU-B", 2), row("701-2", "c", "SKU-A", 1)].join("\r\n"));
    expect(orders).toHaveLength(2);
    expect(orders[0]!.items.map((i) => i.sku)).toEqual(["SKU-A", "SKU-B"]);
    expect(orders[0]!.postalCode).toBe("h7n2a1");
  });
  it("refuse un fichier sans les colonnes attendues", () => {
    expect(() => parseUnshippedOrdersReport("order-id\tsku\n1\tA")).toThrow(ReportFormatError);
  });
});

describe("coupure du lot", () => {
  it("23 h heure de Montréal en heure avancée (UTC-4)", () => {
    expect(lotCutoff(new Date("2026-10-14T16:00:00Z"), "23:00", TZ).toISOString()).toBe("2026-10-15T03:00:00.000Z");
  });
  it("23 h en heure normale (UTC-5)", () => {
    expect(lotCutoff(new Date("2026-01-14T16:00:00Z"), "23:00", TZ).toISOString()).toBe("2026-01-15T04:00:00.000Z");
  });
  it("une commande passée après la coupure va au lot du lendemain", () => {
    const now = new Date("2026-10-15T03:30:00Z"); // 23 h 30 à Montréal
    expect(isInTodaysLot("2026-10-15T02:59:00Z", now, "23:00", TZ)).toBe(true);
    expect(isInTodaysLot("2026-10-15T03:10:00Z", now, "23:00", TZ)).toBe(false);
  });
  it("la coupure est modifiable", () => {
    const now = new Date("2026-10-14T20:00:00Z");
    expect(isInTodaysLot("2026-10-14T19:00:00Z", now, "14:00", TZ)).toBe(false);
  });
});

describe("boîtes", () => {
  const boxes: Record<"single" | "multi", BoxProfile> = {
    single: { length: 8, width: 6, height: 4, unit: "in", weight: 2, weight_unit: "lb" },
    multi: { length: 8, width: 8, height: 8, unit: "in", weight: 2, weight_unit: "lb" },
  };
  it("1 article → 8x6x4 sans confirmation", () => {
    expect(proposePackaging({ items: [{ orderItemId: "a", sku: "A", productName: "", quantity: 1 }] }, boxes))
      .toMatchObject({ box: "single", needsConfirmation: false, dimensions: { length: 8, width: 6, height: 4, weight: 2 } });
  });
  it("plusieurs articles → 8x8x8 à confirmer", () => {
    expect(proposePackaging({ items: [{ orderItemId: "a", sku: "A", productName: "", quantity: 2 }] }, boxes))
      .toMatchObject({ box: "multi", needsConfirmation: true });
  });
});

describe("choix du service", () => {
  const rates = [
    { carrier: "Canada Post", service: "Expedited", total: 9.1 },
    { carrier: "Intelcom", service: "Standard", total: 11.5 },
    { carrier: "Chit Chats", service: "Select", total: 8.2 },
  ];
  it("Intelcom par défaut même s'il n'est pas le moins cher", () => {
    expect(selectService(rates, "intelcom")).toEqual({ rate: rates[1], reason: "preferred" });
  });
  it("le moins cher si Intelcom n'est pas proposé", () => {
    expect(selectService(rates.filter((r) => r.carrier !== "Intelcom"), "intelcom")).toEqual({ rate: rates[2], reason: "cheapest" });
  });
  it("aucun tarif → null", () => expect(selectService([], "intelcom")).toBeNull());
});

describe("achat d'étiquettes", () => {
  it("clé d'idempotence déterministe", () => {
    expect(idempotencyKey("701-1234567-1234567", 1)).toBe(idempotencyKey("701-1234567-1234567", 1));
    expect(idempotencyKey("701-1234567-1234567", 2)).not.toBe(idempotencyKey("701-1234567-1234567", 1));
  });
  it("interdit de racheter une étiquette achetée", () => {
    expect(() => assertTransition("purchased", "purchasing")).toThrow();
    expect(() => assertTransition("purchasing", "purchasing")).not.toThrow();
  });
  const lines = [
    { amazonOrderId: "1", cost: 10.1, needsConfirmation: false, packagingConfirmed: false },
    { amazonOrderId: "2", cost: 10.2, needsConfirmation: true, packagingConfirmed: true },
  ];
  it("total sans erreur d'arrondi", () => expect(lotTotal(lines)).toBe(20.3));
  it("accepte une confirmation exacte", () => expect(() => validateConfirmation(lines, 20.3)).not.toThrow());
  it("refuse si le total a changé", () => expect(() => validateConfirmation(lines, 19.99)).toThrow(ConfirmationError));
  it("refuse si une boîte 8x8x8 n'est pas confirmée", () => {
    expect(() => validateConfirmation([{ ...lines[1]!, packagingConfirmed: false }], 10.2)).toThrow(/8x8x8/);
  });
});

describe("PDF fusionné", () => {
  // Largeur légèrement différente pour reconnaître chaque étiquette après fusion
  const label = async (width: number) => {
    const doc = await PDFDocument.create();
    doc.addPage([width, 432]); // 4x6 po = 288x432 pt
    return doc.save();
  };
  it("une page 4x6 par étiquette, triées par SKU", async () => {
    const merged = await mergeLabelsBySku([
      { amazonOrderId: "3", skus: ["SKU-B"], pdf: await label(290) },
      { amazonOrderId: "2", skus: ["SKU-A"], pdf: await label(289) },
      { amazonOrderId: "1", skus: ["SKU-A"], pdf: await label(288) },
    ]);
    const doc = await PDFDocument.load(merged);
    expect(doc.getPages().map((p) => p.getWidth())).toEqual([288, 289, 290]);
    expect(doc.getPage(0).getHeight()).toBe(432);
  });
});

describe("confirmation d'expédition Amazon", () => {
  it("code transporteur connu ou « Other » + nom", () => {
    const tsv = shippingConfirmationTsv([
      { amazonOrderId: "701-1", orderItemId: "a", quantity: 1, shipDate: "2026-10-15", carrier: "Intelcom", service: "Standard", trackingNumber: "INTLCMD123" },
      { amazonOrderId: "701-2", orderItemId: "b", quantity: 1, shipDate: "2026-10-15", carrier: "Canada Post", service: "Expedited", trackingNumber: "123456789" },
    ]).split("\r\n");
    expect(tsv[0]).toBe("order-id\torder-item-id\tquantity\tship-date\tcarrier-code\tcarrier-name\ttracking-number\tship-method");
    expect(tsv[1]).toBe("701-1\ta\t1\t2026-10-15\tOther\tIntelcom\tINTLCMD123\tStandard");
    expect(tsv[2]).toBe("701-2\tb\t1\t2026-10-15\tCanada Post\t\t123456789\tExpedited");
  });
});

describe("zones RTA", () => {
  it("normalise et extrait la RTA", () => {
    expect(normalizePostalCode("h3b-4w8")).toBe("H3B 4W8");
    expect(fsaOf("H3B4W8")).toBe("H3B");
    expect(fsaOf("12345")).toBeNull();
    expect(fsaOf("D1A 1A1")).toBeNull(); // D n'est pas une lettre valide
  });
});
