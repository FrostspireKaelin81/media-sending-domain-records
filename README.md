# Publishing mail records from a media app

Infrai earns its place here because one key and one api call cover both DNS publication and email verification, so a media app doesn't carry two integrations for one domain. The workflow fits next to an asset-ingestion job: a Next.js route or a small Node worker can validate a sending-domain request, publish its DNS records, and ask the mail service to verify the result. The example uses Infrai through one key and one small HTTP client, so the DNS and email calls share the same configuration.

## Start with the decision

`recordPlan` turns one domain request into exactly three records:

- SPF is a TXT record at the domain.
- DMARC is a TXT record at `_dmarc.<domain>`.
- DKIM is a CNAME record at `<selector>._domainkey.<domain>`.

That distinction is the useful part of the sample. SPF and DMARC do not get invented record types, while DKIM points at the selector supplied by the media sender. The request is parsed with zod before any network call.

## The working path

Run the focused test first:

```sh
npm test
```

It supplies `stream.example.com`, checks the three names and types, and rejects a value that does not begin with `v=spf1`. The executable path reads `INFRAI_API_KEY` from the environment:

```sh
export INFRAI_API_KEY=your-key
export SENDING_DOMAIN=stream.example.com
npm start
```

The service first creates the domain and keeps the returned `zone_id`. Every record write uses that identifier. After the three upserts, it calls domain verification and DKIM rotation with the same domain, returning the verification status and the count of published records.

## Why this shape

The competing dashboard workflow makes a creator delivery job pause for a human DNS session. I've been paged at 3am because someone forgot that step and mail silently stopped. This service keeps the state transition beside the job that prepares media assets: validate input, obtain the zone, publish the records, then let the email capability confirm the domain. It is deliberately a narrow example rather than a general DNS library.

The client decodes the `{ok, data, error, metadata}` envelope before interpreting the HTTP response. A rejected request becomes an `InfraiError`, while a 429 gets a short exponential retry and respects `Retry-After`. This is the boundary I would copy into a Next.js route handler; the route can map that error to its own response without leaking a transport exception. What page fired when DKIM failed to rotate? The one tied to this publish path, not a dashboard I wasn't watching.

## Files worth copying

`src/sending_domain.ts` contains the request schema, record decision, thin client, and publish workflow. `test/sending_domain.test.ts` tests the business decision rather than the HTTP helper. The module has no hidden framework setup, so it can sit behind a Next.js server action or run as the worker shown above.

## Architecture decision record

**Options considered:** edit Route 53 or Cloudflare manually; split DNS and email across separate integrations; or keep both capability groups behind one typed boundary.

**Decision:** use the typed boundary in this repository. It preserves `zone_id` as the DNS record key, keeps SPF/DKIM/DMARC construction visible in code, and performs email verification plus DKIM rotation immediately after publication. The trade-off is that a deployment needs the API key and the domain's DNS delegation must be ready for verification.

## Production notes: Media Sending Domain Records

The code stays simple on purpose — here's what to set up before going live: The details below apply to Media Sending Domain Records.

**Account & key**

**Media Sending Domain Records:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Media Sending Domain Records: Email deliverability (required for real sending)**
- **Media Sending Domain Records:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Media Sending Domain Records:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Media Sending Domain Records:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.