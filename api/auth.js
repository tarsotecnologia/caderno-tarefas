// Contas com chave-senha (digital / Face ID). Ninguém tem senha: a chave fica no aparelho da pessoa.
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import {
  handler, body, db, site, httpError, newId,
  setSession, clearSession, sessionUser, setChallenge, takeChallenge,
  requireUser, createCode, findCode, takeCode,
} from "./_lib.js";

const RP_NAME = "Cadernos";
const signupCode = () => (process.env.SIGNUP_CODE || "").trim();

export default handler(async (req, res) => {
  if (req.method === "GET") return me(req);
  if (req.method !== "POST") throw httpError(405, "Método não permitido.");
  const b = body(req);
  switch (b.action) {
    case "register-options": return registerOptions(req, res, b);
    case "register-verify": return registerVerify(req, res, b);
    case "login-options": return loginOptions(req, res);
    case "login-verify": return loginVerify(req, res, b);
    case "pair-create": return { code: await createCode("pair", requireUser(req), null, 10), minutes: 10 };
    case "logout": clearSession(req, res); return { ok: true };
    default: throw httpError(400, "Ação desconhecida.");
  }
});

async function me(req) {
  const uid = sessionUser(req);
  const out = { user: null, signupCode: !!signupCode() };
  if (!uid) return out;
  const { rows } = await db().query(
    "select u.id, u.name, (select count(*)::int from credentials c where c.user_id = u.id) as devices from users u where u.id = $1", [uid]);
  if (rows[0]) out.user = rows[0];
  return out;
}

// Criar conta, ou (já logado) cadastrar mais um aparelho na mesma conta.
async function registerOptions(req, res, b) {
  const { rpID } = site(req);
  const current = sessionUser(req);
  let userId, name, exclude = [], pair = null;
  if (b.pairCode) {
    // Aparelho novo entrando com o código mostrado num aparelho que já está na conta.
    const c = await findCode("pair", b.pairCode);
    if (!c) throw httpError(400, "Código inválido ou vencido. Gere outro no aparelho que já está na conta.");
    const { rows } = await db().query("select name from users where id = $1", [c.user_id]);
    if (!rows[0]) throw httpError(400, "Código inválido ou vencido.");
    userId = c.user_id; name = rows[0].name; pair = c.hash;
    exclude = (await db().query("select id, transports from credentials where user_id = $1", [userId])).rows;
  } else if (current && b.addDevice) {
    const { rows } = await db().query("select name from users where id = $1", [current]);
    if (!rows[0]) throw httpError(401, "Entre na sua conta para continuar.");
    userId = current; name = rows[0].name;
    exclude = (await db().query("select id, transports from credentials where user_id = $1", [current])).rows;
  } else {
    name = String(b.name || "").trim().slice(0, 60);
    if (!name) throw httpError(400, "Escreva seu nome para criar a conta.");
    const code = signupCode();
    if (code && String(b.code || "").trim() !== code) throw httpError(403, "Código de convite incorreto.");
    userId = newId();
  }
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID,
    userID: Buffer.from(userId), userName: name, userDisplayName: name,
    attestationType: "none",
    excludeCredentials: exclude.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    preferredAuthenticatorType: "localDevice",
  });
  setChallenge(req, res, { c: options.challenge, u: userId, n: name, add: !pair && !!(current && b.addDevice), pair });
  return options;
}

async function registerVerify(req, res, b) {
  const ch = takeChallenge(req, res);
  const { origin, rpID } = site(req);
  let v;
  try {
    v = await verifyRegistrationResponse({
      response: b.credential, expectedChallenge: ch.c, expectedOrigin: origin, expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch { throw httpError(400, "Não foi possível confirmar a chave-senha. Tente de novo."); }
  if (!v.verified) throw httpError(400, "Não foi possível confirmar a chave-senha. Tente de novo.");

  const cred = v.registrationInfo.credential;
  const client = await db().connect();
  try {
    await client.query("begin");
    if (ch.pair) {
      // O código só vale uma vez.
      if (!(await takeCode(client, ch.pair))) throw httpError(400, "Código inválido ou vencido. Gere outro no aparelho que já está na conta.");
    } else if (ch.add) {
      if (sessionUser(req) !== ch.u) throw httpError(401, "Entre na sua conta para continuar.");
    } else {
      await client.query("insert into users (id, name, books) values ($1, $2, $3)", [ch.u, ch.n, JSON.stringify(DEFAULT_BOOKS)]);
    }
    await client.query(
      "insert into credentials (id, user_id, public_key, counter, transports, device) values ($1,$2,$3,$4,$5,$6)",
      [cred.id, ch.u, Buffer.from(cred.publicKey), cred.counter, cred.transports || [], deviceName(req)]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    if (e.code === "23505") throw httpError(409, "Esta chave-senha já está cadastrada.");
    throw e;
  } finally { client.release(); }
  setSession(req, res, ch.u);
  return { user: { id: ch.u, name: ch.n } };
}

async function loginOptions(req, res) {
  const { rpID } = site(req);
  // Sem lista de chaves: o aparelho mostra as chaves-senha que tem para este site.
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  setChallenge(req, res, { c: options.challenge });
  return options;
}

async function loginVerify(req, res, b) {
  const ch = takeChallenge(req, res);
  const { origin, rpID } = site(req);
  const credId = String(b.credential?.id || "");
  const { rows } = await db().query(
    "select c.id, c.user_id, c.public_key, c.counter, c.transports, u.name from credentials c join users u on u.id = c.user_id where c.id = $1", [credId]);
  const row = rows[0];
  if (!row) throw httpError(404, "Esta chave-senha não pertence a nenhuma conta. Crie uma conta primeiro.");
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: b.credential, expectedChallenge: ch.c, expectedOrigin: origin, expectedRPID: rpID,
      requireUserVerification: true,
      credential: { id: row.id, publicKey: new Uint8Array(row.public_key), counter: Number(row.counter), transports: row.transports },
    });
  } catch { throw httpError(401, "Não foi possível confirmar sua digital. Tente de novo."); }
  if (!v.verified) throw httpError(401, "Não foi possível confirmar sua digital. Tente de novo.");
  await db().query("update credentials set counter = $2, last_used_at = now() where id = $1", [row.id, v.authenticationInfo.newCounter]);
  setSession(req, res, row.user_id);
  return { user: { id: row.user_id, name: row.name } };
}

const DEFAULT_BOOKS = [
  { id: "pessoal", nome: "Pessoal", cor: "#2c4fa3" },
  { id: "trabalho", nome: "Trabalho", cor: "#2f8a6e" },
  { id: "casa", nome: "Casa", cor: "#c0563a" },
];

function deviceName(req) {
  const ua = String(req.headers["user-agent"] || "");
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Outro aparelho";
}
