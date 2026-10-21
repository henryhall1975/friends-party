// Aviso por notificación push (APNs de Apple en iPhone, FCM de Firebase en Android) a los del grupo cuando alguien crea un evento
// (por ejemplo, la clase de zumba). La llama la base al insertarse un evento (disparador events_new_push,
// ver supabase/aviso-nuevo-evento.sql). De una serie semanal se avisa una sola vez.
// A quién avisar lo decide la base: public.new_event_push_targets(evento).
// Solo responde a quien manda la clave guardada en Vault (cabecera x-cleanup-secret).
// Secretos necesarios: APNS_KEY_P8 y GOOGLE_SA_JSON (ver _shared/push.ts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviar, plataformas } from "../_shared/push.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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

  const plat = await plataformas(db, rows.map((r) => r.token));
  let enviados = 0, fallidos = 0;
  for (const r of rows) {
    const res = await enviar(db, r.token, plat[r.token], { title: "Friends Party", body: texto(r) });
    if (res.status === 200) enviados++; else fallidos++;
  }
  return json({ enviados, fallidos });
});
