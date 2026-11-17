// Vercel Function: oddaje zapisane zdarzenia (GET) i usuwa już przeniesione
// do CSV (POST {"usun": [...]}).
//
// Dostęp ma tylko zadanie GitHub Actions z tego repozytorium. Zadanie
// przedstawia się tokenem OIDC wystawionym przez GitHub, a funkcja sprawdza
// jego podpis (klucze z token.actions.githubusercontent.com), odbiorcę,
// repozytorium, gałąź i plik workflow. Nie ma wspólnego hasła.

const crypto = require("node:crypto");
const { list, get, del } = require("@vercel/blob");

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "randka-eksport";
const REPO = process.env.GITHUB_REPO || "Kajetan98/randka";
const REPO_ID = process.env.GITHUB_REPO_ID || "1461801637";
const WORKFLOW_PREFIX = `${REPO}/.github/workflows/synchronizuj.yml@`;
const BRANCH_REF = "refs/heads/main";
const PREFIX = "zdarzenia/";
const MAX_BODY = 200000;

let jwksCache = null;

function decodePart(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

async function fetchJwks(force) {
  if (!force && jwksCache && Date.now() - jwksCache.at < 10 * 60 * 1000) return jwksCache.keys;
  const res = await fetch(`${ISSUER}/.well-known/jwks`);
  if (!res.ok) throw new Error(`JWKS ${res.status}`);
  const { keys } = await res.json();
  jwksCache = { at: Date.now(), keys: Array.isArray(keys) ? keys : [] };
  return jwksCache.keys;
}

async function verifyGithubToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("zły format");
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (header.alg !== "RS256") throw new Error("alg");

  let jwk = (await fetchJwks(false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await fetchJwks(true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("nieznany klucz");

  const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  if (!crypto.verify("RSA-SHA256", signed, key, Buffer.from(parts[2], "base64url"))) throw new Error("podpis");

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER) throw new Error("iss");
  if (!aud.includes(AUDIENCE)) throw new Error("aud");
  if (typeof claims.exp !== "number" || claims.exp < now - 30) throw new Error("wygasł");
  if (typeof claims.nbf === "number" && claims.nbf > now + 60) throw new Error("nbf");
  if (claims.repository !== REPO || String(claims.repository_id) !== REPO_ID) throw new Error("repozytorium");
  if (typeof claims.job_workflow_ref !== "string" || !claims.job_workflow_ref.startsWith(WORKFLOW_PREFIX)) throw new Error("workflow");
  if (claims.ref !== BRANCH_REF) throw new Error("gałąź");
  return claims;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  let raw = "";
  if (typeof req.body === "string") raw = req.body;
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString("utf8");
  else {
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) throw new Error("body too large");
    }
  }
  return raw ? JSON.parse(raw) : null;
}

async function readEvents() {
  const events = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, limit: 1000, cursor });
    for (const blob of page.blobs) {
      const result = await get(blob.pathname, { access: "private", useCache: false });
      if (!result || !result.stream) continue;
      try {
        events.push({ ...JSON.parse(await new Response(result.stream).text()), pathname: blob.pathname });
      } catch {
        // uszkodzony plik pomijamy
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && events.length < 2000);
  events.sort((a, b) => String(a.czas_utc).localeCompare(String(b.czas_utc)));
  return events;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false });
  }

  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || "");
  if (!match) return res.status(401).json({ ok: false });
  try {
    await verifyGithubToken(match[1]);
  } catch (err) {
    console.warn("Odrzucony token:", err.message);
    return res.status(401).json({ ok: false });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ ok: false, error: "not_configured" });

  try {
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, zdarzenia: await readEvents() });
    }
    const body = await readBody(req);
    const paths = Array.isArray(body && body.usun)
      ? body.usun.filter((p) => typeof p === "string" && p.startsWith(PREFIX) && !p.includes("..")).slice(0, 2000)
      : [];
    if (paths.length) await del(paths);
    return res.status(200).json({ ok: true, usunieto: paths.length });
  } catch (err) {
    console.error("Eksport nie powiódł się:", err.message);
    return res.status(502).json({ ok: false });
  }
};

module.exports._test = { verifyGithubToken, resetJwksCache: () => { jwksCache = null; } };
