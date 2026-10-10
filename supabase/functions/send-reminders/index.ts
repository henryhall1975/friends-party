// Recordatorios de eventos por notificación push (APNs de Apple): 3 días antes, 1 día antes y el mismo día.
// La llama una tarea programada una vez al día (ver supabase/recordatorios.sql).
// A quién toca avisar lo decide la base: public.reminder_candidates().
// Solo responde a quien manda la clave guardada en Vault (cabecera x-cleanup-secret, la misma de la limpieza).
// Con ?dry=1 solo lista lo que mandaría, sin mandar nada.
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

type Row = { event_id: string; kind: "d3" | "d1" | "d0"; title: string; place: string; hhmm: string; user_id: string; token: string };

// "21:00" -> "9:00 p. m."; la medianoche exacta se toma como "sin hora".
function hora(hhmm: string): string {
  if (!hhmm || hhmm === "00:00") return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}
function texto(r: Row): string {
  const cuando = r.kind === "d3" ? "Faltan 3 días para" : r.kind === "d1" ? "Mañana es" : "Hoy es";
  const h = hora(r.hhmm);
  return `${cuando} ${r.title}` + (h ? `, a las ${h}` : "") + (r.place ? `, en ${r.place}` : "") + ".";
}

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ok } = await db.rpc("check_cleanup_secret", { s: req.headers.get("x-cleanup-secret") ?? "" });
  if (ok !== true) return json({ error: "no autorizado" }, 401);

  const { data, error } = await db.rpc("reminder_candidates");
  if (error) return json({ error: error.message }, 500);
  const rows = (data ?? []) as Row[];
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  if (dry) return json({ dry: true, total: rows.length, avisos: rows.map((r) => ({ evento: r.title, tipo: r.kind, texto: texto(r) })) });
  if (!rows.length) return json({ dry: false, enviados: 0, eventos: 0 });

  const jwt = await apnsJwt();
  let enviados = 0, fallidos = 0;
  for (const r of rows) {
    const payload = { aps: { alert: { title: "Friends Party", body: texto(r) }, sound: "default" } };
    // Las pruebas desde Xcode usan el servidor "sandbox"; TestFlight y App Store usan producción.
    let res = await push("api.push.apple.com", jwt, r.token, payload);
    if (res.status !== 200) res = await push("api.sandbox.push.apple.com", jwt, r.token, payload);
    if (res.status === 410) await db.from("device_tokens").delete().eq("token", r.token);
    if (res.status === 200) enviados++; else fallidos++;
    await res.text();
  }
  // Se marca cada aviso como mandado (aunque algún teléfono haya fallado) para no repetirlo mañana ni al reintentar.
  const marcas = [...new Set(rows.map((r) => `${r.event_id}|${r.kind}`))].map((k) => ({ event_id: k.split("|")[0], kind: k.split("|")[1] }));
  await db.from("event_reminders_sent").upsert(marcas, { onConflict: "event_id,kind", ignoreDuplicates: true });

  return json({ dry: false, enviados, fallidos, eventos: marcas.length });
});
