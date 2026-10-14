-- Réglages modifiables depuis l'app (coupure, boîtes, poids, transporteur préféré)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('cutoff_time', '23:00'),
  ('preferred_carrier', 'intelcom'),
  ('box_single', '{"length":8,"width":6,"height":4,"unit":"in","weight":2,"weight_unit":"lb"}'),
  ('box_multi',  '{"length":8,"width":8,"height":8,"unit":"in","weight":2,"weight_unit":"lb"}');

-- Commandes issues du rapport Seller Central
CREATE TABLE orders (
  amazon_order_id TEXT PRIMARY KEY,
  purchase_date   TEXT NOT NULL,
  recipient_name  TEXT NOT NULL,
  address1        TEXT NOT NULL,
  address2        TEXT,
  address3        TEXT,
  city            TEXT NOT NULL,
  province        TEXT NOT NULL,
  postal_code     TEXT NOT NULL,
  country         TEXT NOT NULL,
  phone           TEXT,
  imported_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_items (
  amazon_order_id TEXT NOT NULL REFERENCES orders(amazon_order_id),
  order_item_id   TEXT NOT NULL,
  sku             TEXT NOT NULL,
  product_name    TEXT,
  quantity        INTEGER NOT NULL,
  PRIMARY KEY (amazon_order_id, order_item_id)
);

-- Achat d'étiquette : une seule tentative active par commande
CREATE TABLE label_purchases (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  amazon_order_id  TEXT NOT NULL REFERENCES orders(amazon_order_id),
  version          INTEGER NOT NULL DEFAULT 1,
  idempotency_key  TEXT NOT NULL UNIQUE,
  state            TEXT NOT NULL CHECK (state IN
                     ('draft','confirmed','purchasing','purchased','failed','voided')),
  box              TEXT NOT NULL CHECK (box IN ('single','multi')),
  weight_lb        REAL NOT NULL,
  service          TEXT,
  carrier          TEXT,
  quoted_cost      REAL,
  final_cost       REAL,
  stallion_shipment_id TEXT,
  tracking_number  TEXT,
  error            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (amazon_order_id, version)
);
-- Interdit deux achats non annulés pour la même commande
CREATE UNIQUE INDEX one_active_label_per_order
  ON label_purchases (amazon_order_id) WHERE state <> 'voided' AND state <> 'failed';

-- Envois suivis (alimentés par la collecte)
CREATE TABLE shipments (
  stallion_shipment_id TEXT PRIMARY KEY,
  amazon_order_id TEXT,
  tracking_number TEXT,
  carrier         TEXT,
  service         TEXT,
  postal_code     TEXT,
  fsa             TEXT,
  province        TEXT,
  cost            REAL,
  status          TEXT,
  label_created_at TEXT,
  first_scan_at   TEXT,
  delivered_at    TEXT,
  last_synced_at  TEXT
);
CREATE INDEX shipments_fsa ON shipments (fsa);
CREATE INDEX shipments_status ON shipments (status);

-- Historique complet et dédoublonné des événements
CREATE TABLE tracking_events (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  stallion_shipment_id TEXT NOT NULL REFERENCES shipments(stallion_shipment_id),
  occurred_at          TEXT NOT NULL,
  code                 TEXT,
  description          TEXT,
  location             TEXT,
  raw                  TEXT,
  UNIQUE (stallion_shipment_id, occurred_at, code, location)
);

CREATE TABLE sync_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  shipments   INTEGER DEFAULT 0,
  events      INTEGER DEFAULT 0,
  error       TEXT
);
