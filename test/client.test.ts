import { describe, expect, it, vi } from "vitest";
import { StallionClient, StallionError } from "../src/stallion/client";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

describe("client Stallion", () => {
  it("utilise le sandbox et envoie le jeton", async () => {
    const fetch = vi.fn(async () => json(200, { ok: true }));
    const client = new StallionClient({ token: "t", env: "sandbox", fetch });
    await client.request("/rates");
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://sandbox.stallion.ca/api/v5/rates");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });
  it("refuse une mutation sans clé d'idempotence", async () => {
    const client = new StallionClient({ token: "t", env: "sandbox", fetch: vi.fn() });
    await expect(client.request("/labels/1", { method: "POST" })).rejects.toThrow(/idempotence/);
  });
  it("relance un 503 avec la même clé d'idempotence", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json(503, {}))
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(json(200, { tracking: "X" }));
    const client = new StallionClient({ token: "t", env: "sandbox", fetch, sleep: async () => {} });
    await expect(client.request("/labels/1", { method: "POST", idempotencyKey: "k1" })).resolves.toEqual({ tracking: "X" });
    const keys = fetch.mock.calls.map((c) => (c[1] as RequestInit & { headers: Record<string, string> }).headers["Idempotency-Key"]);
    expect(keys).toEqual(["k1", "k1", "k1"]);
  });
  it("respecte Retry-After sur 429", async () => {
    const sleep = vi.fn(async () => {});
    const fetch = vi.fn().mockResolvedValueOnce(json(429, {}, { "Retry-After": "3" })).mockResolvedValueOnce(json(200, {}));
    await new StallionClient({ token: "t", env: "sandbox", fetch, sleep }).request("/shipments");
    expect(sleep).toHaveBeenCalledWith(3000);
  });
  it("ne relance pas une erreur 4xx", async () => {
    const fetch = vi.fn(async () => json(422, { error: "bad" }));
    const client = new StallionClient({ token: "t", env: "sandbox", fetch, sleep: async () => {} });
    await expect(client.request("/shipments")).rejects.toBeInstanceOf(StallionError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("exige un jeton", () => expect(() => new StallionClient({ token: "", env: "sandbox" })).toThrow(/STALLION_API_TOKEN/));
});
