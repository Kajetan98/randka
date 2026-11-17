// Vercel Function: przyjmuje jedno zdarzenie ze strony i zapisuje je jako
// prywatny plik JSON w magazynie Vercel Blob (folder "zdarzenia/").
// Zadanie GitHub Actions (.github/workflows/synchronizuj.yml) co jakiś czas
// pobiera te zdarzenia przez /api/eksport i dopisuje je do odpowiedzi.csv.
//
// Wymaga magazynu Vercel Blob podłączonego do projektu (zmienna
// BLOB_READ_WRITE_TOKEN ustawia się wtedy automatycznie).

const crypto = require("node:crypto");
const { put } = require("@vercel/blob");

const PLACES = { kino: "Kino", kolacja: "Kolacja", kawa: "Kawa i deser", spacer: "Spacer" };
const STEPS = new Set(["otwarcie", "kliknieto_tak", "wybrano_miejsce", "wpisano_godzine", "zamknieto_bez_tak"]);
const MAX_BODY = 2048;

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

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("Brak magazynu Vercel Blob (BLOB_READ_WRITE_TOKEN)");
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
  const id = crypto.randomBytes(8).toString("hex");
  const event = {
    id,
    czas_pl: warsawTime(now),
    etap: row.etap,
    odpowiedz: row.odpowiedz,
    miejsce: row.miejsce,
    godzina_spotkania: row.godzina,
    proby_nie: row.proby,
    wizyta: row.wizyta,
    czas_utc: now.toISOString(),
  };

  try {
    await put(`zdarzenia/${now.toISOString().replace(/[:.]/g, "-")}-${id}.json`, JSON.stringify(event), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Zapis do Vercel Blob nie powiódł się:", err.message);
    return res.status(502).json({ ok: false });
  }
};

module.exports._test = { clean, warsawTime };
