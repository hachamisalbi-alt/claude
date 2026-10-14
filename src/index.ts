import { Hono } from "hono";
import { parseUnshippedOrdersReport, ReportFormatError, totalQuantity } from "./domain/amazonReport";
import { isInTodaysLot, lotCutoff } from "./domain/cutoff";
import { proposePackaging, type BoxProfile } from "./domain/packaging";
import { fsaOf, normalizePostalCode } from "./domain/zones";
import type { StallionEnv } from "./stallion/client";

export interface Env {
  DB: D1Database;
  STALLION_API_TOKEN: string;
  STALLION_ENV: StallionEnv;
  TIMEZONE: string;
}

const app = new Hono<{ Bindings: Env }>();

const EDITABLE_SETTINGS = new Set(["cutoff_time", "preferred_carrier", "box_single", "box_multi"]);

async function loadSettings(db: D1Database) {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    cutoffTime: s.cutoff_time ?? "23:00",
    preferredCarrier: s.preferred_carrier ?? "intelcom",
    boxes: { single: JSON.parse(s.box_single!) as BoxProfile, multi: JSON.parse(s.box_multi!) as BoxProfile },
  };
}

app.get("/api/health", (c) => c.json({ ok: true, stallionEnv: c.env.STALLION_ENV, tokenConfigured: Boolean(c.env.STALLION_API_TOKEN) }));

app.get("/api/settings", async (c) => c.json(await loadSettings(c.env.DB)));

app.put("/api/settings/:key", async (c) => {
  const key = c.req.param("key");
  if (!EDITABLE_SETTINGS.has(key)) return c.json({ error: "Réglage inconnu" }, 400);
  const { value } = await c.req.json<{ value: unknown }>();
  if (key === "cutoff_time" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) {
    return c.json({ error: "Heure invalide (HH:MM)" }, 400);
  }
  const stored = typeof value === "string" ? value : JSON.stringify(value);
  await c.env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, stored).run();
  return c.json({ ok: true });
});

// Import du rapport « Commandes non expédiées » (TSV brut dans le corps de la requête)
app.post("/api/orders/import", async (c) => {
  let orders;
  try {
    orders = parseUnshippedOrdersReport(await c.req.text());
  } catch (err) {
    if (err instanceof ReportFormatError) return c.json({ error: err.message }, 400);
    throw err;
  }
  const db = c.env.DB;
  const stmts = orders.flatMap((o) => [
    db.prepare(`INSERT INTO orders (amazon_order_id, purchase_date, recipient_name, address1, address2, address3, city, province, postal_code, country, phone)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(amazon_order_id) DO NOTHING`)
      .bind(o.amazonOrderId, o.purchaseDate, o.recipientName, o.address1, o.address2, o.address3, o.city, o.province,
        normalizePostalCode(o.postalCode) ?? o.postalCode, o.country, o.phone),
    ...o.items.map((i) => db.prepare(`INSERT INTO order_items (amazon_order_id, order_item_id, sku, product_name, quantity)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).bind(o.amazonOrderId, i.orderItemId, i.sku, i.productName, i.quantity)),
  ]);
  if (stmts.length) await db.batch(stmts);
  const invalidPostal = orders.filter((o) => !fsaOf(o.postalCode)).map((o) => o.amazonOrderId);
  return c.json({ imported: orders.length, invalidPostal });
});

// Lot du jour : commandes avant la coupure, sans étiquette active
app.get("/api/lot", async (c) => {
  const settings = await loadSettings(c.env.DB);
  const now = new Date();
  const { results: orders } = await c.env.DB.prepare(
    `SELECT o.* FROM orders o
     WHERE NOT EXISTS (SELECT 1 FROM label_purchases l WHERE l.amazon_order_id = o.amazon_order_id AND l.state NOT IN ('voided','failed'))
     ORDER BY o.purchase_date`).all<Record<string, string>>();
  const { results: items } = await c.env.DB.prepare("SELECT * FROM order_items").all<Record<string, string | number>>();
  const lot = orders
    .filter((o) => isInTodaysLot(o.purchase_date!, now, settings.cutoffTime, c.env.TIMEZONE))
    .map((o) => {
      const orderItems = items.filter((i) => i.amazon_order_id === o.amazon_order_id)
        .map((i) => ({ orderItemId: String(i.order_item_id), sku: String(i.sku), productName: String(i.product_name ?? ""), quantity: Number(i.quantity) }));
      return { ...o, items: orderItems, quantity: totalQuantity({ items: orderItems }), packaging: proposePackaging({ items: orderItems }, settings.boxes) };
    });
  return c.json({ cutoff: lotCutoff(now, settings.cutoffTime, c.env.TIMEZONE).toISOString(), orders: lot });
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    // Collecte du suivi : branchée après vérification des endpoints v5 sur le sandbox.
    await env.DB.prepare("INSERT INTO sync_runs (started_at, finished_at, error) VALUES (datetime('now'), datetime('now'), ?)")
      .bind("collecte non encore branchée").run();
  },
} satisfies ExportedHandler<Env>;
