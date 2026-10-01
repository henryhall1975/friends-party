// Confirma con Apple, directamente, que una compra dentro de la app es real
// antes de dar el Premium o un paquete de stickers. El teléfono nunca decide
// esto solo: le pasa el id de la transacción a esta función, y esta función
// le pregunta a Apple si de verdad se pagó.
//
// Secretos necesarios (Supabase > Edge Functions > Secrets), de la clave
// "In-App Purchase" que se crea en App Store Connect > Usuarios y accesos > Integraciones:
//   IAP_KEY_P8      (el contenido del archivo .p8 que se descarga una sola vez)
//   IAP_KEY_ID      (el Key ID de esa clave)
//   IAP_ISSUER_ID   (el Issuer ID que aparece arriba de la lista de claves)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUNDLE_ID = "com.henryhall.friendsparty";
const PREMIUM_ID = "com.henryhall.friendsparty.premium.monthly";
const PACK_IDS: Record<string, string> = {
  "com.henryhall.friendsparty.pack.stickers": "stickers",
  "com.henryhall.friendsparty.pack.emoticones": "emoticones",
  "com.henryhall.friendsparty.pack.christmas": "christmas",
  "com.henryhall.friendsparty.pack.halloween": "halloween",
};

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlDecode = (s: string) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
};
function decodeJwsPayload(jws: string): any {
  return JSON.parse(b64urlDecode(jws.split(".")[1]));
}

async function iapJwt(): Promise<string> {
  const raw = Deno.env.get("IAP_KEY_P8")!;
  const pem = raw
    .replace(/-{0,}\s*BEGIN[A-Z ]*KEY-{0,}/gi, "")
    .replace(/-{0,}\s*END[A-Z ]*KEY-{0,}/gi, "")
    .replace(/\\r\\n|\\n|\\r/g, "")
    .replace(/[^A-Za-z0-9+/=]/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: Deno.env.get("IAP_KEY_ID"), typ: "JWT" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({
    iss: Deno.env.get("IAP_ISSUER_ID"), iat: now, exp: now + 300, aud: "appstoreconnect-v1", bid: BUNDLE_ID,
  })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

async function appleGet(host: string, path: string, jwt: string) {
  return await fetch(`https://${host}${path}`, { headers: { authorization: `Bearer ${jwt}` } });
}

// El navegador (y el WKWebView de la app) manda primero una solicitud OPTIONS de
// "pre-verificación" antes de la solicitud real con el token. Si no la contestamos
// bien, el navegador cancela la solicitud real sin ni siquiera enviarla.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const rawAuth = req.headers.get("authorization");
  const authJwt = (rawAuth || "").replace(/^Bearer\s+/i, "");
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: who, error: whoErr } = await userClient.auth.getUser(authJwt);
  if (whoErr || !who?.user) {
    console.log("verify-purchase: sin sesion, error=" + JSON.stringify(whoErr?.message || whoErr));
    return new Response(JSON.stringify({ ok: false, error: "sin_sesion" }), { status: 401, headers: CORS_HEADERS });
  }
  const uid = who.user.id;

  const { transactionId } = await req.json().catch(() => ({}));
  if (!transactionId) return new Response(JSON.stringify({ ok: false, error: "sin_transactionId" }), { status: 400, headers: CORS_HEADERS });
  console.log("verify-purchase: uid=" + uid + " transactionId=" + JSON.stringify(transactionId));

  const jwt = await iapJwt();
  // Las compras hechas de prueba (Xcode, Sandbox) solo existen en el servidor de pruebas de Apple.
  let r = await appleGet("api.storekit.itunes.apple.com", `/inApps/v1/transactions/${transactionId}`, jwt);
  // Antes de que la app se publique alguna vez, el servidor de producción de Apple
  // contesta 401 (no 404) para cualquier consulta, así que probamos también ahí.
  if (r.status === 404 || r.status === 401) r = await appleGet("api.storekit-sandbox.itunes.apple.com", `/inApps/v1/transactions/${transactionId}`, jwt);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.log("verify-purchase: apple respondio " + r.status + ": " + t.slice(0, 300));
    return new Response(JSON.stringify({ ok: false, error: "apple_" + r.status }), { status: 200, headers: { ...CORS_HEADERS, "content-type": "application/json" } });
  }

  const { signedTransactionInfo } = await r.json();
  const info = decodeJwsPayload(signedTransactionInfo);
  if (info.bundleId !== BUNDLE_ID) return new Response(JSON.stringify({ ok: false, error: "app_invalida" }), { status: 200, headers: CORS_HEADERS });
  if (info.revocationDate) return new Response(JSON.stringify({ ok: false, error: "reembolsada" }), { status: 200, headers: CORS_HEADERS });

  const productId = info.productId as string;

  if (productId === PREMIUM_ID) {
    // Vuelve a preguntarle a Apple el estado ACTUAL de la suscripción (por si ya se
    // renovó o venció desde que se hizo esa primera compra).
    const oid = String(info.originalTransactionId || info.transactionId);
    let host = "api.storekit.itunes.apple.com";
    let sr = await appleGet(host, `/inApps/v1/subscriptions/${oid}`, jwt);
    if (sr.status === 404 || sr.status === 401) { host = "api.storekit-sandbox.itunes.apple.com"; sr = await appleGet(host, `/inApps/v1/subscriptions/${oid}`, jwt); }
    let expiresMs = info.expiresDate;
    if (sr.ok) {
      const sdata = await sr.json();
      for (const g of sdata.data || []) {
        for (const it of g.lastTransactions || []) {
          if (String(it.originalTransactionId) === oid && it.signedTransactionInfo) {
            const si = decodeJwsPayload(it.signedTransactionInfo);
            if (si.expiresDate) expiresMs = si.expiresDate;
          }
        }
      }
    }
    const until = new Date(expiresMs).toISOString();
    await db.from("subscriptions").upsert({ user_id: uid, premium_until: until });
    return new Response(JSON.stringify({ ok: true, kind: "premium", premiumUntil: until }), { headers: { ...CORS_HEADERS, "content-type": "application/json" } });
  }

  const packId = PACK_IDS[productId];
  if (!packId) return new Response(JSON.stringify({ ok: false, error: "producto_desconocido" }), { status: 200, headers: CORS_HEADERS });
  // La tabla "purchases" ya existía, hecha justo para esto.
  const amount = typeof info.price === "number" ? info.price / 1000 : 1.99;
  await db.from("purchases").upsert(
    { user_id: uid, product_id: productId, amount_usd: amount, platform: "apple", transaction_id: String(info.transactionId) },
    { onConflict: "transaction_id" }
  );
  return new Response(JSON.stringify({ ok: true, kind: "pack", packId }), { headers: { ...CORS_HEADERS, "content-type": "application/json" } });
});
