// Servido em /.well-known/webauthn (veja vercel.json). Diz ao navegador quais outros endereços
// podem usar as chaves-senha criadas no domínio RP_ID. Ex.: ORIGENS_EXTRAS=https://cadernos.exemplo.com
export default function webauthn(req, res) {
  const origins = String(process.env.ORIGENS_EXTRAS || "")
    .split(",").map((s) => s.trim().replace(/\/+$/, "")).filter((s) => /^https:\/\/[^/]+$/.test(s));
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json({ origins });
}
