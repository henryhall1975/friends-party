// Manda una notificación push (APNs de Apple en iPhone, FCM de Firebase en Android) cuando alguien recibe una invitación.
// Secretos necesarios: APNS_KEY_P8 y GOOGLE_SA_JSON (ver _shared/push.ts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviarATodos } from "../_shared/push.ts";

Deno.serve(async (req) => {
  // No se confía en lo que llega: solo se avisa de invitaciones reales, recientes y aún no avisadas.
  const { record } = await req.json().catch(() => ({ record: null }));
  if (!record?.id) return new Response("sin id", { status: 400 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: inv } = await db.from("user_invites").update({ notified: true })
    .eq("id", record.id).eq("notified", false).eq("status", "pending").gte("created_at", since)
    .select("from_user,to_user,event_id").maybeSingle();
  if (!inv) return new Response("nada que avisar", { status: 200 });

  const { data: from } = await db.from("profiles").select("display_name,username").eq("id", inv.from_user).maybeSingle();
  const { data: tokens } = await db.from("device_tokens").select("token").eq("user_id", inv.to_user);
  const who = from?.display_name || from?.username || "Un amigo";
  // invitación a un evento o momento (no al grupo): se dice a cuál
  let body = `${who} te invitó a su grupo`;
  if (inv.event_id) {
    const { data: ev } = await db.from("events").select("title,kind").eq("id", inv.event_id).maybeSingle();
    body = ev?.title ? `${who} te invitó ${ev.kind === "momento" ? "al momento" : "a"} ${ev.title}` : `${who} te invitó a un evento`;
  }
  const r = await enviarATodos(db, (tokens ?? []).map((t: { token: string }) => t.token), { title: "Friends Party", body, badge: 1 });
  return new Response(JSON.stringify(r), { headers: { "content-type": "application/json" } });
});
