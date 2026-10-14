// Client HTTP Stallion Express v5.
// Les endpoints métier (tarifs, envois, lots, suivi) seront branchés une fois
// la doc v5 vérifiée sur le sandbox ; ce module gère auth, idempotence et relances.

export type StallionEnv = "sandbox" | "production";

const BASE_URLS: Record<StallionEnv, string> = {
  sandbox: "https://sandbox.stallion.ca/api/v5",
  production: "https://ship.stallion.ca/api/v5",
};

export class StallionError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Obligatoire pour toute requête qui crée ou achète quelque chose. */
  idempotencyKey?: string;
}

export interface ClientConfig {
  token: string;
  env: StallionEnv;
  fetch?: typeof fetch;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class StallionClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly config: ClientConfig) {
    if (!config.token) throw new Error("STALLION_API_TOKEN manquant (voir .env ou les secrets Cloudflare).");
    if (!(config.env in BASE_URLS)) throw new Error(`STALLION_ENV invalide : ${config.env}`);
    this.baseUrl = BASE_URLS[config.env];
    this.fetchImpl = config.fetch ?? fetch.bind(globalThis);
    this.maxRetries = config.maxRetries ?? 4;
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? "GET";
    const mutating = method !== "GET";
    if (mutating && !opts.idempotencyKey) {
      throw new Error(`Clé d'idempotence obligatoire pour ${method} ${path}`);
    }
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.token}`,
      Accept: "application/json",
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        });
      } catch (err) {
        // Relancer est sûr : GET, ou mutation protégée par la même clé d'idempotence
        if (attempt < this.maxRetries) { await this.sleep(backoff(attempt)); continue; }
        throw err;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("Retry-After"));
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
        continue;
      }
      const text = await res.text();
      const data: unknown = text ? safeJson(text) : null;
      if (!res.ok) throw new StallionError(`Stallion ${method} ${path} → ${res.status}`, res.status, data);
      return data as T;
    }
  }
}

const backoff = (attempt: number) => 2000 * 2 ** attempt; // 2 s, 4 s, 8 s, 16 s

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}
