// Aviso por notificación push (APNs de Apple en iPhone, FCM de Firebase en Android) cuando llega un mensaje de chat.
// La llama la base al insertarse un mensaje (disparador messages_push, ver supabase/chat.sql).
// A quién avisar lo decide la base: public.chat_push_targets(id), que además marca el mensaje como avisado.
// Solo responde a quien manda la clave guardada en Vault (cabecera x-cleanup-secret).
// Secretos necesarios: APNS_KEY_P8 y GOOGLE_SA_JSON (ver _shared/push.ts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviar, plataformas } from "../_shared/push.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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

  const plat = await plataformas(db, rows.map((r) => r.token));
  let enviados = 0, fallidos = 0;
  for (const r of rows) {
    const texto = r.cuerpo ? (r.cuerpo.length > 140 ? r.cuerpo.slice(0, 137) + "…" : r.cuerpo) : "Te mandó una foto";
    const res = await enviar(db, r.token, plat[r.token], { title: r.titulo, body: `${r.autor}: ${texto}` });
    if (res.status === 200) enviados++; else fallidos++;
  }
  return json({ enviados, fallidos });
});
