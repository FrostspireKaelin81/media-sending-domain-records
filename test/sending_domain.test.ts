import assert from "node:assert/strict";
import { recordPlan } from "../src/sending_domain.ts";

const records = recordPlan({ domain: "stream.example.com", dkimSelector: "stream", dkimContent: "dkim.example.net", spfContent: "v=spf1 include:spf.example.net ~all", dmarcContent: "v=DMARC1; p=quarantine" });
assert.deepEqual(records.map((record) => [record.record_type, record.name]), [
  ["TXT", "stream.example.com"],
  ["TXT", "_dmarc.stream.example.com"],
  ["CNAME", "stream._domainkey.stream.example.com"]
]);
assert.throws(() => recordPlan({ domain: "stream.example.com", dkimSelector: "stream", dkimContent: "dkim.example.net", spfContent: "invalid", dmarcContent: "v=DMARC1; p=quarantine" }));
console.log("record decision test passed");
