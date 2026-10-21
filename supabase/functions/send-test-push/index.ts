// Notificación de prueba a UNA sola cuenta (por su @usuario), para comprobar que los avisos llegan a su teléfono.
// También sirve para revisar si el servidor tiene permiso de mandar por Firebase: {"revisar_fcm": true}.
// Solo responde a quien manda la clave guardada en Vault (cabecera x-cleanup-secret); se llama desde SQL con net.http_post.
// Secretos necesarios: APNS_KEY_P8 y GOOGLE_SA_JSON (ver _shared/push.ts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviar, enviarATodos } from "../_shared/push.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ok } = await db.rpc("check_cleanup_secret", { s: req.headers.get("x-cleanup-secret") ?? "" });
  if (ok !== true) return json({ error: "no autorizado" }, 401);

  const { usuario, texto, revisar_fcm } = await req.json().catch(() => ({}));
  // con un token inventado: si Firebase contesta 400 (token no válido) el permiso está bien; 403 = falta el permiso
  if (revisar_fcm) return json(await enviar(db, "token-de-prueba", "android", { title: "Friends Party", body: "prueba" }));

  if (!usuario) return json({ error: "falta usuario" }, 400);
  const { data: p } = await db.from("profiles").select("id").eq("username", String(usuario).replace(/^@/, "").toLowerCase()).maybeSingle();
  if (!p) return json({ error: "no existe ese usuario" }, 404);
  const { data: tokens } = await db.from("device_tokens").select("token").eq("user_id", p.id);
  if (!tokens?.length) return json({ error: "ese usuario no tiene teléfonos registrados" });
  return json(await enviarATodos(db, tokens.map((t: { token: string }) => t.token), { title: "Friends Party", body: texto || "Esta es una notificación de prueba 🎉" }));
});
