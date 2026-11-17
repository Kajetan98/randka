// Vercel Function: przyjmuje jedno zdarzenie z formularza i dopisuje wiersz
// do pliku CSV w repozytorium na GitHubie (przez GitHub Contents API).
//
// Wymagane zmienne środowiskowe w projekcie Vercel:
//   GITHUB_TOKEN   fine-grained token z uprawnieniem Contents: Read and write
//                  tylko do tego repozytorium
// Opcjonalne:
//   GITHUB_REPO    domyślnie "Kajetan98/randka"
//   GITHUB_BRANCH  domyślnie "main"
//   CSV_PATH       domyślnie "odpowiedzi.csv"

const PLACES = { kino: "Kino", kolacja: "Kolacja", kawa: "Kawa i deser", spacer: "Spacer" };
const STEPS = new Set(["otwarcie", "kliknieto_tak", "wybrano_miejsce", "wpisano_godzine", "zamknieto_bez_tak"]);
const HEADER = "czas_pl,etap,odpowiedz,miejsce,godzina_spotkania,proby_nie,wizyta,czas_utc\n";
const MAX_BODY = 2048;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // ochrona przed formułami w arkuszu
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function clean(body) {
  if (!body || typeof body !== "object") return null;
  if (!STEPS.has(body.etap)) return null;
  if (typeof body.wizyta !== "string" || !/^[a-z0-9]{4,32}$/.test(body.wizyta)) return null;
  const godzina = typeof body.godzina === "string"
    ? body.godzina.replace(/[^\p{L}\p{N} :.\-]/gu, "").trim().slice(0, 20)
    : "";
  const n = Number.parseInt(body.proby_nie, 10);
  return {
    etap: body.etap,
    wizyta: body.wizyta,
    odpowiedz: body.odpowiedz === "tak" ? "tak" : "",
    miejsce: PLACES[body.miejsce] || "",
    godzina,
    proby: Number.isFinite(n) && n >= 0 ? Math.min(n, 9999) : 0,
  };
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
  if (raw.length > MAX_BODY) throw new Error("body too large");
  return raw ? JSON.parse(raw) : null;
}

function warsawTime(date) {
  // "sv-SE" daje format RRRR-MM-DD GG:MM:SS, wygodny do sortowania
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Warsaw",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(date);
}

async function appendRow(line) {
  const repo = process.env.GITHUB_REPO || "Kajetan98/randka";
  const branch = process.env.GITHUB_BRANCH || "main";
  const path = process.env.CSV_PATH || "odpowiedzi.csv";
  const url = `https://api.github.com/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "randka-csv",
  };

  for (let attempt = 0; attempt < 4; attempt++) {
    const getRes = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers, cache: "no-store" });
    let content = HEADER;
    let sha;
    if (getRes.status === 200) {
      const file = await getRes.json();
      sha = file.sha;
      content = Buffer.from(file.content || "", "base64").toString("utf8");
      if (content && !content.endsWith("\n")) content += "\n";
      if (!content) content = HEADER;
    } else if (getRes.status !== 404) {
      throw new Error(`GitHub GET ${getRes.status}`);
    }

    const putRes = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Nowa odpowiedź",
        content: Buffer.from(content + line, "utf8").toString("base64"),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (putRes.ok) return;
    // 409/422: plik zmienił się w międzyczasie (inny zapis), spróbuj ponownie
    if (putRes.status === 409 || putRes.status === 422) {
      await sleep(150 + Math.random() * 450);
      continue;
    }
    throw new Error(`GitHub PUT ${putRes.status}`);
  }
  throw new Error("GitHub: zbyt wiele konfliktów zapisu");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false });
  }

  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return res.status(403).json({ ok: false });
    } catch {
      return res.status(403).json({ ok: false });
    }
  }

  if (!process.env.GITHUB_TOKEN) {
    console.error("Brak zmiennej GITHUB_TOKEN w projekcie Vercel");
    return res.status(503).json({ ok: false, error: "not_configured" });
  }

  let row;
  try {
    row = clean(await readBody(req));
  } catch {
    return res.status(400).json({ ok: false });
  }
  if (!row) return res.status(400).json({ ok: false });

  const now = new Date();
  const line = [warsawTime(now), row.etap, row.odpowiedz, row.miejsce, row.godzina, row.proby, row.wizyta, now.toISOString()]
    .map(csvCell)
    .join(",") + "\n";

  try {
    await appendRow(line);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err.message);
    return res.status(502).json({ ok: false });
  }
};

module.exports._test = { clean, csvCell, warsawTime };
