// Aviso por notificación push (APNs de Apple en iPhone, FCM de Firebase en Android) cuando alguien se une a un grupo, evento o momento
// (por QR, código o invitación). La llama la base al insertarse un miembro: disparadores group_members_push
// (supabase/uniones.sql) y event_members_push (supabase/aviso-union-evento.sql).
// A quién avisar lo decide la base: public.join_push_targets(grupo, usuario) o public.event_join_push_targets(evento, usuario).
// Solo responde a quien manda la clave guardada en Vault (cabecera x-cleanup-secret).
// Secretos necesarios: APNS_KEY_P8 y GOOGLE_SA_JSON (ver _shared/push.ts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviar, plataformas } from "../_shared/push.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Row = { token: string; quien: string; eventos?: number; titulo?: string; tipo?: string };

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ok } = await db.rpc("check_cleanup_secret", { s: req.headers.get("x-cleanup-secret") ?? "" });
  if (ok !== true) return json({ error: "no autorizado" }, 401);

  const { group_id, event_id, user_id } = await req.json().catch(() => ({ group_id: null, event_id: null, user_id: null }));
  if ((!group_id && !event_id) || !user_id) return json({ error: "faltan datos" }, 400);
  const { data, error } = event_id
    ? await db.rpc("event_join_push_targets", { eid: event_id, uid: user_id })
    : await db.rpc("join_push_targets", { gid: group_id, uid: user_id });
  if (error) return json({ error: error.message }, 500);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return json({ enviados: 0 });

  const plat = await plataformas(db, rows.map((r) => r.token));
  let enviados = 0, fallidos = 0;
  const detalle: unknown[] = []; // qué respondió cada teléfono (para diagnosticar)
  for (const r of rows) {
    const n = Number(r.eventos) || 0;
    const cuerpo = event_id
      ? `${r.quien} aceptó y ya está en ${r.tipo === "momento" ? "el momento " : ""}${r.titulo || "tu evento"}.`
      : `${r.quien} se unió a tu grupo` + (n === 1 ? " y ya ve tu evento." : n > 1 ? ` y ya ve tus ${n} eventos.` : ".");
    const res = await enviar(db, r.token, plat[r.token], { title: "Friends Party", body: cuerpo });
    if (res.status === 200) enviados++; else fallidos++;
    detalle.push(res);
  }
  return json({ enviados, fallidos, detalle });
});
