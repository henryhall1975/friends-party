// Aviso por notificación push (APNs de Apple en iPhone, FCM de Firebase en Android) cuando alguien te empieza a seguir.
// La llama la base al insertarse un seguimiento (disparador follows_push, ver supabase/seguidores.sql).
// A quién avisar lo decide la base: public.follow_push_targets(seguidor, seguido), que además limita a un aviso por pareja cada 24 horas.
// Solo responde a quien manda la clave guardada en Vault (cabecera x-cleanup-secret).
// Secretos necesarios: APNS_KEY_P8 y GOOGLE_SA_JSON (ver _shared/push.ts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviar, plataformas } from "../_shared/push.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Row = { token: string; quien: string; usuario: string };

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ok } = await db.rpc("check_cleanup_secret", { s: req.headers.get("x-cleanup-secret") ?? "" });
  if (ok !== true) return json({ error: "no autorizado" }, 401);

  const { follower_id, followee_id } = await req.json().catch(() => ({ follower_id: null, followee_id: null }));
  if (!follower_id || !followee_id) return json({ error: "faltan datos" }, 400);
  const { data, error } = await db.rpc("follow_push_targets", { fid: follower_id, tid: followee_id });
  if (error) return json({ error: error.message }, 500);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return json({ enviados: 0 });

  const plat = await plataformas(db, rows.map((r) => r.token));
  let enviados = 0, fallidos = 0;
  for (const r of rows) {
    const cuerpo = `${r.quien}` + (r.usuario ? ` (@${r.usuario})` : "") + " empezó a seguirte.";
    const res = await enviar(db, r.token, plat[r.token], { title: "Friends Party", body: cuerpo });
    if (res.status === 200) enviados++; else fallidos++;
  }
  return json({ enviados, fallidos });
});
