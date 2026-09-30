// Manda una notificación push (APNs de Apple) cuando alguien recibe una invitación.
// Secretos necesarios (Supabase > Edge Functions > Secrets):
//   APNS_KEY_P8 (solo ese)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const KEY_ID = "HJWQN4HQV3", TEAM_ID = "P4242HMZ49", BUNDLE_ID = "com.henryhall.friendsparty";
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function apnsJwt(): Promise<string> {
  const pem = Deno.env.get("APNS_KEY_P8")!.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: KEY_ID })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({ iss: TEAM_ID, iat: Math.floor(Date.now() / 1000) })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

async function push(host: string, jwt: string, token: string, payload: unknown) {
  return await fetch(`https://${host}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": BUNDLE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    body: JSON.stringify(payload),
  });
}

Deno.serve(async (req) => {
  // No se confía en lo que llega: solo se avisa de invitaciones reales, recientes y aún no avisadas.
  const { record } = await req.json().catch(() => ({ record: null }));
  if (!record?.id) return new Response("sin id", { status: 400 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: inv } = await db.from("user_invites").update({ notified: true })
    .eq("id", record.id).eq("notified", false).eq("status", "pending").gte("created_at", since)
    .select("from_user,to_user").maybeSingle();
  if (!inv) return new Response("nada que avisar", { status: 200 });
  record.from_user = inv.from_user; record.to_user = inv.to_user;

  const { data: from } = await db.from("profiles").select("display_name,username").eq("id", record.from_user).maybeSingle();
  const { data: tokens } = await db.from("device_tokens").select("token").eq("user_id", record.to_user);
  const who = from?.display_name || from?.username || "Un amigo";
  const payload = { aps: { alert: { title: "Friends Party", body: `${who} te invitó a su grupo` }, sound: "default", badge: 1 } };

  const jwt = await apnsJwt();
  const out: unknown[] = [];
  for (const t of tokens ?? []) {
    // Las pruebas desde Xcode usan el servidor "sandbox"; TestFlight y App Store usan producción.
    let r = await push("api.push.apple.com", jwt, t.token, payload);
    if (r.status !== 200) r = await push("api.sandbox.push.apple.com", jwt, t.token, payload);
    if (r.status === 410) await db.from("device_tokens").delete().eq("token", t.token);
    out.push({ status: r.status, apple: (await r.text()).slice(0, 200) });
  }
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
});
