// Lembretes por notificação (Web Push).
// GET                       → chave pública para o aparelho se inscrever
// POST {op:"subscribe"}     → guarda a inscrição deste aparelho
// POST {op:"unsubscribe"}   → remove a inscrição
// POST {op:"test"}          → manda uma notificação de teste para a própria conta
// GET ?cron=1 com "Authorization: Bearer CRON_SECRET" → envia os lembretes vencidos (chamar a cada 5 minutos)
import webpush from "web-push";
import { handler, body, db, httpError, requireUser } from "./_lib.js";

const publicKey = () => (process.env.VAPID_PUBLIC_KEY || "").trim();
function ready() {
  const pub = publicKey(), priv = (process.env.VAPID_PRIVATE_KEY || "").trim();
  if (!pub || !priv) throw httpError(503, "Lembretes ainda não configurados: faltam as variáveis VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY no Vercel.");
  webpush.setVapidDetails((process.env.VAPID_SUBJECT || "mailto:admin@example.com").trim(), pub, priv);
}

export default handler(async (req) => {
  if (req.method === "GET") {
    if (req.query?.cron) return cron(req);
    return { publicKey: publicKey() || null };
  }
  if (req.method !== "POST") throw httpError(405, "Método não permitido.");
  const uid = requireUser(req);
  const b = body(req);
  switch (b.op) {
    case "subscribe": return subscribe(uid, b.sub);
    case "unsubscribe":
      await db().query("delete from push_subs where endpoint = $1 and user_id = $2", [String(b.endpoint || ""), uid]);
      return { ok: true };
    case "test": {
      ready();
      const n = await sendTo([uid], { title: "Cadernos", body: "Os lembretes estão funcionando neste aparelho.", tag: "teste" });
      if (!n) throw httpError(400, "Nenhum aparelho desta conta está inscrito para receber lembretes.");
      return { ok: true, sent: n };
    }
    default: throw httpError(400, "Operação desconhecida.");
  }
});

async function subscribe(uid, sub) {
  const endpoint = String(sub?.endpoint || "");
  if (!/^https:\/\/[^\s]{10,2000}$/.test(endpoint) || typeof sub?.keys?.p256dh !== "string" || typeof sub?.keys?.auth !== "string")
    throw httpError(400, "Inscrição inválida.");
  const clean = { endpoint, keys: { p256dh: sub.keys.p256dh.slice(0, 200), auth: sub.keys.auth.slice(0, 100) } };
  await db().query(
    `insert into push_subs (endpoint, user_id, sub) values ($1, $2, $3)
     on conflict (endpoint) do update set user_id = excluded.user_id, sub = excluded.sub`,
    [endpoint, uid, JSON.stringify(clean)]);
  return { ok: true };
}

// Envia para todos os aparelhos inscritos das pessoas; apaga inscrições que o navegador já cancelou.
async function sendTo(userIds, payload) {
  const { rows } = await db().query("select endpoint, sub from push_subs where user_id = any($1)", [userIds]);
  let sent = 0;
  for (const r of rows) {
    try { await webpush.sendNotification(r.sub, JSON.stringify(payload), { TTL: 3600 }); sent++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await db().query("delete from push_subs where endpoint = $1", [r.endpoint]); }
  }
  return sent;
}

const DUE = `(data->>'feita')::boolean is not true and data->>'avisoEm' is not null
  and (data->>'avisoEm')::timestamptz <= now() and (data->>'avisoEm')::timestamptz > now() - interval '6 hours'
  and not exists (select 1 from sent_reminders s where s.task_id = id and s.aviso_em = data->>'avisoEm')`;

async function cron(req) {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) throw httpError(401, "Não autorizado.");
  ready();
  const { rows } = await db().query(
    `select id, data->>'texto' as texto, data->>'avisoEm' as aviso, array[user_id] as users from tasks where ${DUE}
     union all
     select id, data->>'texto', data->>'avisoEm', array(select m.user_id from book_members m where m.book_id = shared_tasks.book_id)
       from shared_tasks where ${DUE}`);
  let sent = 0;
  for (const r of rows) {
    // Marca antes de enviar: se duas execuções se cruzarem, só uma manda.
    const mark = await db().query(
      "insert into sent_reminders (task_id, aviso_em) values ($1, $2) on conflict do nothing", [r.id, r.aviso]);
    if (mark.rowCount !== 1) continue;
    sent += await sendTo(r.users, { title: "Lembrete", body: r.texto, tag: r.id });
  }
  await db().query("delete from sent_reminders where sent_at < now() - interval '30 days'");
  return { ok: true, due: rows.length, sent };
}
