// Limpieza diaria de archivos (la llama una tarea programada, ver supabase/limpieza.sql):
//   1) historias en video vencidas: se borra el video, su miniatura y su fila
//   2) archivos de fotos y videos que ya no pertenecen a nada (cuentas o eventos eliminados)
// Qué entra en cada grupo lo decide la base: public.cleanup_candidates().
// Solo responde a quien manda la clave guardada en Vault (cabecera x-cleanup-secret).
// Con ?dry=1 solo lista lo que borraría, sin borrar nada.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Row = { kind: string; bucket: string; path: string; clip_id: string | null };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ok } = await db.rpc("check_cleanup_secret", { s: req.headers.get("x-cleanup-secret") ?? "" });
  if (ok !== true) return json({ error: "no autorizado" }, 401);

  const { data, error } = await db.rpc("cleanup_candidates");
  if (error) return json({ error: error.message }, 500);
  const rows = (data ?? []) as Row[];
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  if (dry) return json({ dry: true, total: rows.length, archivos: rows });

  // Los archivos se borran por la API de Storage (borrar la fila a mano dejaría el archivo en disco).
  const borrados: string[] = [], fallidos: string[] = [];
  for (const bucket of [...new Set(rows.map((r) => r.bucket))]) {
    const paths = rows.filter((r) => r.bucket === bucket).map((r) => r.path);
    for (let i = 0; i < paths.length; i += 100) {
      const lote = paths.slice(i, i + 100);
      const { error: e } = await db.storage.from(bucket).remove(lote);
      (e ? fallidos : borrados).push(...lote.map((p) => `${bucket}/${p}`));
    }
  }
  // La fila de una historia se quita solo si sus archivos se borraron; si no, se reintenta mañana.
  const clips = [...new Set(rows.filter((r) => r.clip_id).map((r) => r.clip_id as string))].filter((id) =>
    rows.filter((r) => r.clip_id === id).every((r) => borrados.includes(`${r.bucket}/${r.path}`))
  );
  if (clips.length) await db.from("event_clips").delete().in("id", clips).lt("expires_at", new Date().toISOString());

  return json({ dry: false, borrados: borrados.length, historias: clips.length, fallidos });
});
