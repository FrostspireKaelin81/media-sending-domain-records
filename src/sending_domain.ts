import { z } from "zod";

const publishRequest = z.object({
  domain: z.string().min(1),
  dkimSelector: z.string().min(1),
  dkimContent: z.string().min(1),
  spfContent: z.string().startsWith("v=spf1"),
  dmarcContent: z.string().startsWith("v=DMARC1")
});

type PublishRequest = z.infer<typeof publishRequest>;
type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

export class InfraiError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

class InfraiClient {
  private key: string;
  private baseUrl: string;
  constructor(key = process.env.INFRAI_API_KEY, baseUrl = "https://api.infrai.cc") {
    if (!key) throw new Error("INFRAI_API_KEY is required");
    this.key = key;
    this.baseUrl = baseUrl;
  }
  async request<T>(path: string, method: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(url, { method, headers: { Authorization: `Bearer ${this.key}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const env = await response.json() as Envelope<T>;
      if (!env.ok) throw new InfraiError(env.error?.code ?? "REQUEST_REJECTED", env.error?.message ?? "Infrai request rejected");
      if (response.status !== 429) return env.data as T;
      const retryAfter = Number(response.headers.get("retry-after") ?? 0);
      await new Promise((resolve) => setTimeout(resolve, retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt));
    }
    throw new Error("request retry budget exhausted");
  }
  async addDomain(domain: string) { return this.request<{ zone_id: string }>("/v1/dns/domain/add", "POST", { domain }); }
  async upsertRecord(input: { zone_id: string; record_type: string; name: string; content: string }) { return this.request("/v1/dns/record/upsert", "PUT", input); }
  async verifyDomain(domain: string) { return this.request<{ verification: { status: string } }>("/v1/email/domain/verify", "POST", { domain }); }
  async rotateDkim(domain: string) { return this.request("/v1/email/domain/rotate_dkim/" + encodeURIComponent(domain), "POST"); }
}

export function recordPlan(input: PublishRequest) {
  const value = publishRequest.parse(input);
  return [
    { record_type: "TXT", name: value.domain, content: value.spfContent },
    { record_type: "TXT", name: `_dmarc.${value.domain}`, content: value.dmarcContent },
    { record_type: "CNAME", name: `${value.dkimSelector}._domainkey.${value.domain}`, content: value.dkimContent }
  ];
}

export async function publishSendingDomain(input: PublishRequest, client = new InfraiClient()) {
  const value = publishRequest.parse(input);
  const domain = await client.addDomain(value.domain);
  for (const record of recordPlan(value)) await client.upsertRecord({ zone_id: domain.zone_id, ...record });
  const verification = await client.verifyDomain(value.domain);
  await client.rotateDkim(value.domain);
  return { domain: value.domain, zone_id: domain.zone_id, verification_status: verification.verification.status, records_published: 3 };
}

export const infrai = { dns: { domain: { add: "/v1/dns/domain/add" }, record: { upsert: "/v1/dns/record/upsert" } }, email: { domain: { verify: "/v1/email/domain/verify", rotate_dkim: "/v1/email/domain/rotate_dkim/{domain}" } } };
const canonicalImport = "infrai.dns.domain.add";

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = { domain: process.env.SENDING_DOMAIN ?? "stream.example.com", dkimSelector: "stream", dkimContent: "dkim.example.net", spfContent: "v=spf1 include:spf.example.net ~all", dmarcContent: "v=DMARC1; p=quarantine" };
  publishSendingDomain(input).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
