// Tarefas e cadernos da pessoa logada. Toda consulta filtra pelo usuário da sessão,
// então ninguém lê nem altera tarefas de outra conta.
// Cadernos compartilhados guardam as tarefas no próprio caderno (shared_tasks) e só os
// membros (book_members) leem ou alteram.
import { handler, body, db, httpError, requireUser, newId, createCode, findCode, takeCode } from "./_lib.js";

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
    case "share": return shareBook(uid, b.id);
    case "invite": return invite(uid, b.id);
    case "join": return join(uid, b.code);
    case "members": return members(uid, b.id);
    case "remove-member": return removeMember(uid, b.id, b.userId);
    case "leave": return leave(uid, b.id);
    case "delete-shared": return deleteShared(uid, b.id);
    default: throw httpError(400, "Operação desconhecida.");
  }
});

// Cadernos compartilhados de que a pessoa participa.
async function sharedOf(uid) {
  const { rows } = await db().query(
    `select sb.id, sb.nome, sb.cor, sb.owner_id, u.name as dono,
            (select count(*)::int from book_members m2 where m2.book_id = sb.id) as membros
       from book_members m join shared_books sb on sb.id = m.book_id join users u on u.id = sb.owner_id
      where m.user_id = $1`, [uid]);
  return new Map(rows.map((r) => [r.id, r]));
}

async function load(uid) {
  const u = await db().query("select name, books from users where id = $1", [uid]);
  if (!u.rows[0]) throw httpError(401, "Conta não encontrada. Entre de novo.");
  const shared = await sharedOf(uid);
  const t = await db().query("select id, data from tasks where user_id = $1", [uid]);
  const st = shared.size
    ? await db().query("select id, data from shared_tasks where book_id = any($1)", [[...shared.keys()]])
    : { rows: [] };
  // A lista de cadernos da pessoa guarda a ordem; nome e cor dos compartilhados vêm do caderno.
  const view = (s) => ({ id: s.id, nome: s.nome, cor: s.cor, shared: true, dono: s.dono, souDono: s.owner_id === uid, membros: s.membros });
  const books = [];
  for (const b of u.rows[0].books || []) {
    if (!b.shared) books.push(b);
    else if (shared.has(b.id)) books.push(view(shared.get(b.id)));
  }
  for (const s of shared.values()) if (!books.some((b) => b.id === s.id)) books.push(view(s));
  return {
    name: u.rows[0].name, books,
    tasks: [...t.rows, ...st.rows].map((r) => ({ ...r.data, id: r.id })),
  };
}

function cleanTask(t) {
  if (!t || typeof t !== "object" || !ID.test(String(t.id || ""))) throw httpError(400, "Tarefa inválida.");
  const texto = String(t.texto ?? "").trim().slice(0, 1000);
  if (!texto) throw httpError(400, "A tarefa está vazia.");
  const itens = (Array.isArray(t.itens) ? t.itens : []).slice(0, 50)
    .filter((i) => i && ID.test(String(i.id || "")) && String(i.texto ?? "").trim())
    .map((i) => ({ id: String(i.id), texto: String(i.texto).trim().slice(0, 300), feito: !!i.feito }));
  const aviso = t.avisoEm ? new Date(String(t.avisoEm)) : null;
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
      itens,                                                                 // checklist (subtarefas)
      hora: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t.hora ?? "")) ? t.hora : null,   // lembrete, no horário local
      avisoEm: aviso && Number.isFinite(aviso.getTime()) ? aviso.toISOString() : null, // o mesmo lembrete, em UTC
    },
  };
}

async function upsert(uid, task) {
  const t = cleanTask(task);
  const shared = await sharedOf(uid);
  const acc = [...shared.keys()];
  // Uma tarefa que já está num caderno compartilhado só pode ser mexida por quem participa dele.
  const prev = await db().query("select book_id from shared_tasks where id = $1", [t.id]);
  if (prev.rows.some((r) => !shared.has(r.book_id))) throw httpError(403, "Você não participa desse caderno.");

  if (shared.has(t.data.caderno)) {
    await db().query(
      `insert into shared_tasks (book_id, id, data, updated_at) values ($1, $2, $3, now())
       on conflict (book_id, id) do update set data = excluded.data, updated_at = now()`,
      [t.data.caderno, t.id, JSON.stringify(t.data)]);
    await db().query("delete from shared_tasks where id = $1 and book_id <> $2", [t.id, t.data.caderno]);
    await db().query("delete from tasks where user_id = $1 and id = $2", [uid, t.id]);
    return { ok: true };
  }
  const { rows } = await db().query("select count(*)::int as n from tasks where user_id = $1", [uid]);
  if (rows[0].n >= MAX_TASKS) {
    const exists = await db().query("select 1 from tasks where user_id = $1 and id = $2", [uid, t.id]);
    if (!exists.rows[0]) throw httpError(413, "Limite de tarefas atingido. Apague tarefas feitas para liberar espaço.");
  }
  await db().query(
    `insert into tasks (user_id, id, data, updated_at) values ($1, $2, $3, now())
     on conflict (user_id, id) do update set data = excluded.data, updated_at = now()`,
    [uid, t.id, JSON.stringify(t.data)]);
  if (acc.length) await db().query("delete from shared_tasks where id = $1 and book_id = any($2)", [t.id, acc]);   // saiu de um compartilhado
  return { ok: true };
}

async function remove(uid, id) {
  if (!ID.test(String(id || ""))) throw httpError(400, "Tarefa inválida.");
  await db().query("delete from tasks where user_id = $1 and id = $2", [uid, String(id)]);
  await db().query(
    "delete from shared_tasks where id = $1 and book_id in (select book_id from book_members where user_id = $2)", [String(id), uid]);
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
      shared: !!b.shared,
    };
  });
}

// Guarda a ordem dos cadernos; dos compartilhados guarda só a referência e atualiza nome e cor no caderno.
async function saveBooks(uid, books) {
  const shared = await sharedOf(uid);
  const list = [];
  for (const b of cleanBooks(books)) {
    if (!b.shared) { list.push({ id: b.id, nome: b.nome, cor: b.cor }); continue; }
    if (!shared.has(b.id)) continue;
    const s = shared.get(b.id);
    if (s.nome !== b.nome || s.cor !== b.cor) await db().query("update shared_books set nome = $2, cor = $3 where id = $1", [b.id, b.nome, b.cor]);
    list.push({ id: b.id, shared: true });
  }
  if (!list.length) throw httpError(400, "Lista de cadernos inválida.");
  await db().query("update users set books = $2 where id = $1", [uid, JSON.stringify(list)]);
  return { ok: true };
}

// Restaurar backup / importar tarefas antigas do aparelho. Não mexe nos cadernos compartilhados.
async function replaceAll(uid, b) {
  const shared = await sharedOf(uid);
  const books = cleanBooks(b.books).filter((x) => !x.shared).map(({ id, nome, cor }) => ({ id, nome, cor }));
  const keep = (await db().query("select books from users where id = $1", [uid])).rows[0]?.books?.filter((x) => x.shared && shared.has(x.id)) || [];
  const list = Array.isArray(b.tasks) ? b.tasks : Object.values(b.tasks || {});
  if (list.length > MAX_TASKS) throw httpError(413, "O backup tem tarefas demais.");
  const tasks = list.map(cleanTask).filter((t) => !shared.has(t.data.caderno));
  if (!books.length && !keep.length) throw httpError(400, "Lista de cadernos inválida.");
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query("update users set books = $2 where id = $1", [uid, JSON.stringify([...books, ...keep])]);
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

// ---------- cadernos compartilhados ----------
async function memberOf(uid, bookId) {
  const s = (await sharedOf(uid)).get(String(bookId || ""));
  if (!s) throw httpError(403, "Você não participa desse caderno.");
  return s;
}

// Transforma um caderno da pessoa em compartilhado, levando as tarefas dele junto.
async function shareBook(uid, bookId) {
  bookId = String(bookId || "");
  const u = (await db().query("select books from users where id = $1", [uid])).rows[0];
  const own = (u?.books || []).find((b) => b.id === bookId && !b.shared);
  if (!own) throw httpError(404, "Caderno não encontrado.");
  const id = "g" + newId();
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query("insert into shared_books (id, owner_id, nome, cor) values ($1, $2, $3, $4)", [id, uid, own.nome, own.cor]);
    await client.query("insert into book_members (book_id, user_id) values ($1, $2)", [id, uid]);
    await client.query(
      `insert into shared_tasks (book_id, id, data)
       select $2, id, jsonb_set(data, '{caderno}', to_jsonb($2::text)) from tasks where user_id = $1 and data->>'caderno' = $3`,
      [uid, id, bookId]);
    await client.query("delete from tasks where user_id = $1 and data->>'caderno' = $2", [uid, bookId]);
    const books = u.books.map((b) => (b.id === bookId && !b.shared ? { id, shared: true } : b));
    await client.query("update users set books = $2 where id = $1", [uid, JSON.stringify(books)]);
    await client.query("commit");
  } catch (e) { await client.query("rollback").catch(() => {}); throw e; }
  finally { client.release(); }
  return { id, ...(await load(uid)) };
}

async function invite(uid, bookId) {
  const s = await memberOf(uid, bookId);
  return { code: await createCode("invite", uid, s.id, 60 * 48), hours: 48, nome: s.nome };
}

async function join(uid, code) {
  const c = await findCode("invite", code);
  if (!c) throw httpError(400, "Convite inválido ou vencido. Peça um novo para quem compartilhou.");
  const client = await db().connect();
  try {
    await client.query("begin");
    if (!(await takeCode(client, c.hash))) throw httpError(400, "Convite inválido ou vencido.");
    await client.query("insert into book_members (book_id, user_id) values ($1, $2) on conflict do nothing", [c.book_id, uid]);
    await client.query("commit");
  } catch (e) { await client.query("rollback").catch(() => {}); throw e; }
  finally { client.release(); }
  return { id: c.book_id, ...(await load(uid)) };
}

async function members(uid, bookId) {
  const s = await memberOf(uid, bookId);
  const { rows } = await db().query(
    "select u.id, u.name from book_members m join users u on u.id = m.user_id where m.book_id = $1 order by u.name", [s.id]);
  return { souDono: s.owner_id === uid, members: rows.map((r) => ({ id: r.id, name: r.name, dono: r.id === s.owner_id, eu: r.id === uid })) };
}

async function removeMember(uid, bookId, memberId) {
  const s = await memberOf(uid, bookId);
  if (s.owner_id !== uid) throw httpError(403, "Só quem criou o compartilhamento pode remover pessoas.");
  if (memberId === uid) throw httpError(400, "Para encerrar o compartilhamento, apague o caderno.");
  await db().query("delete from book_members where book_id = $1 and user_id = $2", [s.id, String(memberId || "")]);
  return members(uid, s.id);
}

async function dropFromList(uid, bookId) {
  const u = (await db().query("select books from users where id = $1", [uid])).rows[0];
  const books = (u?.books || []).filter((b) => b.id !== bookId);
  await db().query("update users set books = $2 where id = $1", [uid, JSON.stringify(books.length ? books : [{ id: "pessoal", nome: "Pessoal", cor: "#2c4fa3" }])]);
}

async function leave(uid, bookId) {
  const s = await memberOf(uid, bookId);
  if (s.owner_id === uid) throw httpError(400, "Você criou este compartilhamento. Para encerrar, apague o caderno.");
  await db().query("delete from book_members where book_id = $1 and user_id = $2", [s.id, uid]);
  await dropFromList(uid, s.id);
  return load(uid);
}

async function deleteShared(uid, bookId) {
  const s = await memberOf(uid, bookId);
  if (s.owner_id !== uid) throw httpError(403, "Só quem criou o compartilhamento pode apagar o caderno.");
  await db().query("delete from shared_books where id = $1", [s.id]);   // leva junto tarefas e participantes
  await dropFromList(uid, s.id);
  return load(uid);
}
