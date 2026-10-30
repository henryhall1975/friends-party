// Aviso por notificación push (APNs en iPhone, FCM en Android) cuando alguien sube fotos a un evento
// (por ejemplo, a la clase de zumba). La llama la base al insertarse una foto (disparador photos_new_push,
// ver supabase/aviso-fotos-nuevas.sql); si la misma persona sube varias seguidas, se avisa una vez.
// A quién avisar lo decide la base: public.photo_push_targets(foto).
// Solo responde a quien manda la clave guardada en Vault (cabecera x-cleanup-secret).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviar, plataformas } from "../_shared/push.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Row = { token: string; quien: string; titulo: string };

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ok } = await db.rpc("check_cleanup_secret", { s: req.headers.get("x-cleanup-secret") ?? "" });
  if (ok !== true) return json({ error: "no autorizado" }, 401);

  const { photo_id } = await req.json().catch(() => ({ photo_id: null }));
  if (!photo_id) return json({ error: "faltan datos" }, 400);
  const { data, error } = await db.rpc("photo_push_targets", { pid: photo_id });
  if (error) return json({ error: error.message }, 500);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return json({ enviados: 0 });

  const plat = await plataformas(db, rows.map((r) => r.token));
  let enviados = 0, fallidos = 0;
  for (const r of rows) {
    const res = await enviar(db, r.token, plat[r.token], { title: r.titulo, body: `${r.quien} subió fotos nuevas 📸` });
    if (res.status === 200) enviados++; else fallidos++;
  }
  return json({ enviados, fallidos });
});
