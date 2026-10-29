// Tarefas e cadernos da pessoa logada. Toda consulta filtra pelo usuário da sessão,
// então ninguém lê nem altera tarefas de outra conta.
import { handler, body, db, httpError, requireUser } from "./_lib.js";

const MAX_TASKS = 5000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const REPETIR = ["dia", "uteis", "semana", "mes", "ano"];   // tarefas recorrentes (igual ao index.html)

export default handler(async (req) => {
  const uid = requireUser(req);
  if (req.method === "GET") return load(uid);
  if (req.method !== "POST") throw httpError(405, "Método não permitido.");
  const b = body(req);
  switch (b.op) {
    case "upsert": return upsert(uid, b.task);
    case "delete": return remove(uid, b.id);
    case "books": return saveBooks(uid, b.books);
    case "replace": return replaceAll(uid, b);
    default: throw httpError(400, "Operação desconhecida.");
  }
});

async function load(uid) {
  const u = await db().query("select name, books from users where id = $1", [uid]);
  if (!u.rows[0]) throw httpError(401, "Conta não encontrada. Entre de novo.");
  const t = await db().query("select id, data from tasks where user_id = $1", [uid]);
  return { name: u.rows[0].name, books: u.rows[0].books, tasks: t.rows.map((r) => ({ ...r.data, id: r.id })) };
}

function cleanTask(t) {
  if (!t || typeof t !== "object" || !ID.test(String(t.id || ""))) throw httpError(400, "Tarefa inválida.");
  const texto = String(t.texto ?? "").trim().slice(0, 1000);
  if (!texto) throw httpError(400, "A tarefa está vazia.");
  return {
    id: String(t.id),
    data: {
      texto,
      caderno: String(t.caderno ?? "").slice(0, 64),
      feita: !!t.feita,
      feitaEm: t.feitaEm ? String(t.feitaEm).slice(0, 40) : null,
      importante: !!t.importante,
      prazo: /^\d{4}-\d{2}-\d{2}$/.test(String(t.prazo ?? "")) ? t.prazo : null,
      nota: String(t.nota ?? "").slice(0, 10000),
      criada: Number.isFinite(+t.criada) ? +t.criada : Date.now(),
      repetir: REPETIR.includes(t.repetir) ? t.repetir : null,
      ordem: t.ordem != null && Number.isFinite(+t.ordem) ? +t.ordem : null,   // posição escolhida arrastando
    },
  };
}

async function upsert(uid, task) {
  const t = cleanTask(task);
  const { rows } = await db().query("select count(*)::int as n from tasks where user_id = $1", [uid]);
  if (rows[0].n >= MAX_TASKS) {
    const exists = await db().query("select 1 from tasks where user_id = $1 and id = $2", [uid, t.id]);
    if (!exists.rows[0]) throw httpError(413, "Limite de tarefas atingido. Apague tarefas feitas para liberar espaço.");
  }
  await db().query(
    `insert into tasks (user_id, id, data, updated_at) values ($1, $2, $3, now())
     on conflict (user_id, id) do update set data = excluded.data, updated_at = now()`,
    [uid, t.id, JSON.stringify(t.data)]);
  return { ok: true };
}

async function remove(uid, id) {
  if (!ID.test(String(id || ""))) throw httpError(400, "Tarefa inválida.");
  await db().query("delete from tasks where user_id = $1 and id = $2", [uid, String(id)]);
  return { ok: true };
}

function cleanBooks(books) {
  if (!Array.isArray(books) || !books.length || books.length > 50) throw httpError(400, "Lista de cadernos inválida.");
  return books.map((b) => {
    if (!ID.test(String(b?.id || ""))) throw httpError(400, "Caderno inválido.");
    return {
      id: String(b.id),
      nome: String(b.nome ?? "").trim().slice(0, 60) || "Caderno",
      cor: /^#[0-9a-fA-F]{6}$/.test(String(b.cor)) ? b.cor : "#2c4fa3",
    };
  });
}

async function saveBooks(uid, books) {
  await db().query("update users set books = $2 where id = $1", [uid, JSON.stringify(cleanBooks(books))]);
  return { ok: true };
}

// Restaurar backup / importar tarefas antigas do aparelho.
async function replaceAll(uid, b) {
  const books = cleanBooks(b.books);
  const list = Array.isArray(b.tasks) ? b.tasks : Object.values(b.tasks || {});
  if (list.length > MAX_TASKS) throw httpError(413, "O backup tem tarefas demais.");
  const tasks = list.map(cleanTask);
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query("update users set books = $2 where id = $1", [uid, JSON.stringify(books)]);
    if (!b.merge) await client.query("delete from tasks where user_id = $1", [uid]);
    for (const t of tasks) {
      await client.query(
        `insert into tasks (user_id, id, data) values ($1, $2, $3)
         on conflict (user_id, id) do update set data = excluded.data, updated_at = now()`,
        [uid, t.id, JSON.stringify(t.data)]);
    }
    await client.query("commit");
  } catch (e) { await client.query("rollback").catch(() => {}); throw e; }
  finally { client.release(); }
  return load(uid);
}
