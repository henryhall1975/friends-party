// Manda un aviso push al teléfono que corresponda: iPhone por APNs (Apple), Android por FCM (Firebase).
// Lo usan todas las funciones de avisos (send-push, send-join-push, send-chat-push, send-follow-push,
// send-reminders, send-new-event-push, send-photo-push). El tipo de teléfono está en device_tokens.platform.
// Secretos necesarios: APNS_KEY_P8 (llave de Apple) y GOOGLE_SA_JSON (cuenta de servicio con permiso
// "Firebase Cloud Messaging API Admin" en el proyecto friends-party-511920).

const KEY_ID = "5U5JY7775X", TEAM_ID = "P4242HMZ49", BUNDLE_ID = "com.henryhall.friendsparty";
const FCM_PROJECT = "friends-party-511920";

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let apnsCache: { jwt: string; at: number } | null = null;
async function apnsJwt(): Promise<string> {
  if (apnsCache && Date.now() - apnsCache.at < 30 * 60 * 1000) return apnsCache.jwt;
  const pem = Deno.env.get("APNS_KEY_P8")!.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: KEY_ID })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({ iss: TEAM_ID, iat: Math.floor(Date.now() / 1000) })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${body}`));
  apnsCache = { jwt: `${head}.${body}.${b64url(sig)}`, at: Date.now() };
  return apnsCache.jwt;
}

let fcmCache: { token: string; at: number } | null = null;
async function fcmToken(): Promise<string> {
  if (fcmCache && Date.now() - fcmCache.at < 45 * 60 * 1000) return fcmCache.token;
  const sa = JSON.parse(Deno.env.get("GOOGLE_SA_JSON")!);
  const pem = String(sa.private_key).replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${body}.${b64url(sig)}` }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("fcm_token: " + JSON.stringify(j).slice(0, 200));
  fcmCache = { token: j.access_token, at: Date.now() };
  return fcmCache.token;
}

async function apns(host: string, jwt: string, token: string, payload: unknown) {
  return await fetch(`https://${host}/3/device/${token}`, {
    method: "POST",
    headers: { authorization: `bearer ${jwt}`, "apns-topic": BUNDLE_ID, "apns-push-type": "alert", "apns-priority": "10" },
    body: JSON.stringify(payload),
  });
}

export type Aviso = { title: string; body: string; badge?: number };
export type Resultado = { tel: string; plataforma: string; status: number; detalle: string };

// tipo de teléfono de cada token ("ios" si no se sabe: los registros viejos son todos de iPhone)
// deno-lint-ignore no-explicit-any
export async function plataformas(db: any, tokens: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!tokens.length) return out;
  const { data } = await db.from("device_tokens").select("token,platform").in("token", tokens);
  for (const t of tokens) out[t] = "ios";
  for (const r of data ?? []) out[r.token] = r.platform === "android" ? "android" : "ios";
  return out;
}

// Manda un aviso a un teléfono. Si el teléfono ya no existe, lo borra de device_tokens.
// deno-lint-ignore no-explicit-any
export async function enviar(db: any, token: string, plataforma: string, aviso: Aviso): Promise<Resultado> {
  const tel = token.slice(0, 8);
  if (plataforma === "android") {
    try {
      const at = await fcmToken();
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT}/messages:send`, {
        method: "POST",
        headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
        body: JSON.stringify({ message: {
          token,
          notification: { title: aviso.title, body: aviso.body },
          android: { priority: "high", notification: { channel_id: "avisos", sound: "default" } },
        } }),
      });
      const t = (await r.text()).slice(0, 160);
      if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*token/i.test(t)) await db.from("device_tokens").delete().eq("token", token);
      return { tel, plataforma, status: r.status, detalle: r.ok ? "" : t };
    } catch (e) {
      return { tel, plataforma, status: 0, detalle: String((e as Error).message).slice(0, 160) };
    }
  }
  const payload = { aps: { alert: { title: aviso.title, body: aviso.body }, sound: "default", ...(aviso.badge ? { badge: aviso.badge } : {}) } };
  const jwt = await apnsJwt();
  // Las pruebas desde Xcode usan el servidor "sandbox"; TestFlight y App Store usan producción.
  let res = await apns("api.push.apple.com", jwt, token, payload);
  if (res.status !== 200) { await res.text(); res = await apns("api.sandbox.push.apple.com", jwt, token, payload); }
  if (res.status === 410) await db.from("device_tokens").delete().eq("token", token);
  return { tel, plataforma, status: res.status, detalle: res.status === 200 ? "" : (await res.text()).slice(0, 160) };
}

// Manda el mismo aviso a varios teléfonos y cuenta cuántos llegaron.
// deno-lint-ignore no-explicit-any
export async function enviarATodos(db: any, tokens: string[], aviso: Aviso) {
  const plat = await plataformas(db, tokens);
  let enviados = 0, fallidos = 0;
  const detalle: Resultado[] = [];
  for (const t of tokens) {
    const r = await enviar(db, t, plat[t], aviso);
    if (r.status === 200) enviados++; else fallidos++;
    detalle.push(r);
  }
  return { enviados, fallidos, detalle };
}
