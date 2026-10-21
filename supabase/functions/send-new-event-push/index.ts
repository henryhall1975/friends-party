// Aviso por notificación push (APNs de Apple) a los del grupo cuando alguien crea un evento
// (por ejemplo, la clase de zumba). La llama la base al insertarse un evento (disparador events_new_push,
// ver supabase/aviso-nuevo-evento.sql). De una serie semanal se avisa una sola vez.
// A quién avisar lo decide la base: public.new_event_push_targets(evento).
// Solo responde a quien manda la clave guardada en Vault (cabecera x-cleanup-secret).
// Secretos necesarios: APNS_KEY_P8 (el mismo de send-push).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const KEY_ID = "5U5JY7775X", TEAM_ID = "P4242HMZ49", BUNDLE_ID = "com.henryhall.friendsparty";
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

type Row = { token: string; quien: string; titulo: string; cuando: string | null; lugar: string; dias: string | null };

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
// "2026-10-21 19:00" -> "martes 21 oct, 7:00 p. m." (la medianoche exacta se toma como "sin hora")
function fecha(cuando: string | null): { dia: string; hora: string } {
  if (!cuando) return { dia: "", hora: "" };
  const [d, hm] = cuando.split(" ");
  const [y, m, dd] = d.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  let hora = "";
  if (hm && hm !== "00:00") {
    const [h, mi] = hm.split(":").map(Number);
    hora = `${h % 12 || 12}:${String(mi).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
  }
  return { dia: `${DIAS[wd]} ${dd} ${MESES[m - 1]}`, hora };
}
function texto(r: Row): string {
  const f = fecha(r.cuando);
  const cuando = r.dias ? `cada ${r.dias}` + (f.hora ? `, ${f.hora}` : "") : [f.dia, f.hora].filter(Boolean).join(", ");
  return `${r.quien} creó ${r.titulo}` + (cuando ? `: ${cuando}` : "") + (r.lugar ? `, en ${r.lugar}` : "") + ". ¿Vas?";
}

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ok } = await db.rpc("check_cleanup_secret", { s: req.headers.get("x-cleanup-secret") ?? "" });
  if (ok !== true) return json({ error: "no autorizado" }, 401);

  const { event_id } = await req.json().catch(() => ({ event_id: null }));
  if (!event_id) return json({ error: "faltan datos" }, 400);
  const { data, error } = await db.rpc("new_event_push_targets", { eid: event_id });
  if (error) return json({ error: error.message }, 500);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return json({ enviados: 0 });

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
  return json({ enviados, fallidos });
});
