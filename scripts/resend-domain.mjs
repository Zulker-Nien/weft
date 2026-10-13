// Weft's domain on Resend (docs/architecture/email-forwarding.md). Runs through the 🔐 vault (mcp__secrets__run)
// with RESEND_API_KEY in its env, so the key never shows in a thread:
//   npm run resend -- create weft.zip      add the domain with sending and receiving on; print its DNS records
//   npm run resend -- verify weft.zip      ask Resend to check the records, then print their status
//   npm run resend -- status weft.zip      print the domain and its records
//   npm run resend -- webhook <url>        subscribe <url> to email.received (the signing secret stays in the dashboard)
//   npm run resend -- webhooks             list the webhooks
const key = process.env.RESEND_API_KEY;
if (!key) {
  console.error("RESEND_API_KEY is not set; run this through the vault.");
  process.exit(2);
}

async function api(method, path, body) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${json.message ?? json.name ?? ""}`.trim());
  return json;
}

async function find(name) {
  const { data = [] } = await api("GET", "/domains");
  const d = data.find((x) => x.name === name);
  if (!d) throw new Error(`${name} isn't on this Resend account yet; run create first.`);
  return d;
}

function show(d) {
  const caps = d.capabilities ?? {};
  console.log(`${d.name}: ${d.status} (sending ${caps.sending ?? "?"}, receiving ${caps.receiving ?? "?"}, region ${d.region})`);
  for (const r of d.records ?? []) {
    const name = r.name === "" || r.name == null ? "@" : r.name;
    console.log(`  ${String(r.record).padEnd(9)} ${String(r.type).padEnd(5)} ${name.padEnd(24)} ${r.priority ?? "-"}  ${r.value}  [${r.status}]`);
  }
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case "create": {
    const { data = [] } = await api("GET", "/domains");
    let d = data.find((x) => x.name === arg);
    if (!d) d = await api("POST", "/domains", { name: arg, capabilities: { sending: "enabled", receiving: "enabled" } });
    else if (d.capabilities?.receiving !== "enabled") await api("PATCH", `/domains/${d.id}`, { capabilities: { sending: "enabled", receiving: "enabled" } });
    show(await api("GET", `/domains/${d.id}`));
    break;
  }
  case "verify": {
    const d = await find(arg);
    await api("POST", `/domains/${d.id}/verify`);
    show(await api("GET", `/domains/${d.id}`));
    break;
  }
  case "status":
    show(await api("GET", `/domains/${(await find(arg)).id}`));
    break;
  case "webhook": {
    const w = await api("POST", "/webhooks", { endpoint: arg, events: ["email.received"] });
    console.log(`webhook ${w.id} → ${arg} (email.received). Copy its signing secret from the webhook's page in the Resend dashboard into the vault as RESEND_WEBHOOK_SECRET.`);
    break;
  }
  case "webhooks": {
    const { data = [] } = await api("GET", "/webhooks");
    if (!data.length) console.log("no webhooks");
    for (const w of data) console.log(`${w.id}  ${w.status ?? ""}  ${w.endpoint}  ${(w.events ?? []).join(",")}`);
    break;
  }
  default:
    console.error("usage: npm run resend -- create|verify|status <domain> | webhook <url> | webhooks");
    process.exit(2);
}
