// Aviso por notificación push (APNs de Apple) cuando llega un mensaje de chat.
// La llama la base al insertarse un mensaje (disparador messages_push, ver supabase/chat.sql).
// A quién avisar lo decide la base: public.chat_push_targets(id), que además marca el mensaje como avisado.
// Solo responde a quien manda la clave guardada en Vault (cabecera x-cleanup-secret).
// Secretos necesarios: APNS_KEY_P8 (el mismo de send-push).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const KEY_ID = "HJWQN4HQV3", TEAM_ID = "P4242HMZ49", BUNDLE_ID = "com.henryhall.friendsparty";
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
    headers: { authorization: `bearer ${jwt}`, "apns-topic": BUNDLE_ID, "apns-push-type": "alert", "apns-priority": "10" },
    body: JSON.stringify(payload),
  });
}

type Row = { token: string; autor: string; titulo: string; cuerpo: string };

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ok } = await db.rpc("check_cleanup_secret", { s: req.headers.get("x-cleanup-secret") ?? "" });
  if (ok !== true) return json({ error: "no autorizado" }, 401);

  const { id } = await req.json().catch(() => ({ id: null }));
  if (!id) return json({ error: "sin id" }, 400);
  const { data, error } = await db.rpc("chat_push_targets", { mid: id });
  if (error) return json({ error: error.message }, 500);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return json({ enviados: 0 });

  const jwt = await apnsJwt();
  let enviados = 0, fallidos = 0;
  for (const r of rows) {
    const texto = r.cuerpo ? (r.cuerpo.length > 140 ? r.cuerpo.slice(0, 137) + "…" : r.cuerpo) : "Te mandó una foto";
    const payload = { aps: { alert: { title: r.titulo, body: `${r.autor}: ${texto}` }, sound: "default" } };
    // Las pruebas desde Xcode usan el servidor "sandbox"; TestFlight y App Store usan producción.
    let res = await push("api.push.apple.com", jwt, r.token, payload);
    if (res.status !== 200) res = await push("api.sandbox.push.apple.com", jwt, r.token, payload);
    if (res.status === 410) await db.from("device_tokens").delete().eq("token", r.token);
    if (res.status === 200) enviados++; else fallidos++;
    await res.text();
  }
  return json({ enviados, fallidos });
});
