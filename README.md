# Randka

Strona z pytaniem "Chcesz iść ze mną na randkę?". Przycisk "Nie" ucieka, po "Tak" osoba wybiera miejsce i wpisuje godzinę. Każdy krok dopisuje wiersz do pliku `odpowiedzi.csv` w tym repozytorium. Osoba, która odpowiada, nie widzi tego pliku.

## Jak to działa

- `public/index.html` to cała strona. Vercel serwuje tylko folder `public/`, więc `odpowiedzi.csv` nie jest dostępny pod adresem strony.
- `api/odpowiedz.js` to funkcja serwerowa na Vercelu. Przyjmuje zdarzenie ze strony i przez GitHub API dopisuje wiersz do `odpowiedzi.csv` (każdy wiersz to osobny commit).
- Token GitHuba jest tylko w zmiennej środowiskowej na Vercelu, nigdy w kodzie strony.

Repozytorium powinno być prywatne, bo `odpowiedzi.csv` zawiera odpowiedzi.

## Konfiguracja

1. Utwórz fine-grained token na GitHubie: Settings → Developer settings → Personal access tokens → Fine-grained tokens. Repository access: tylko to repozytorium. Permissions → Contents: Read and write.
2. W projekcie na Vercelu: Settings → Environment Variables → dodaj `GITHUB_TOKEN` z tym tokenem (środowisko Production).
3. Zrób ponowne wdrożenie (Deployments → Redeploy), żeby funkcja zobaczyła zmienną.

Opcjonalne zmienne: `GITHUB_REPO` (domyślnie `Kajetan98/randka`), `GITHUB_BRANCH` (domyślnie `main`), `CSV_PATH` (domyślnie `odpowiedzi.csv`).

`vercel.json` pomija budowanie, gdy commit zmienia tylko `odpowiedzi.csv`, więc nowe odpowiedzi nie uruchamiają wdrożeń.

## Kolumny w odpowiedzi.csv

| kolumna | znaczenie |
|---|---|
| `czas_pl` | czas zapisu, strefa Europe/Warsaw |
| `etap` | `otwarcie`, `kliknieto_tak`, `wybrano_miejsce`, `wpisano_godzine`, `zamknieto_bez_tak` |
| `odpowiedz` | `tak` po kliknięciu Tak |
| `miejsce` | Kino, Kolacja, Kawa i deser albo Spacer |
| `godzina_spotkania` | wpisana godzina |
| `proby_nie` | ile razy osoba próbowała kliknąć Nie |
| `wizyta` | identyfikator jednego otwarcia strony, łączy wiersze z tej samej wizyty |
| `czas_utc` | czas zapisu w UTC |

Pełna odpowiedź to wiersz z etapem `wpisano_godzine`. `zamknieto_bez_tak` oznacza, że ktoś próbował kliknąć Nie i zamknął stronę bez kliknięcia Tak.
