# Randka

Strona z pytaniem "Chcesz iść ze mną na randkę?". Przycisk "Nie" ucieka, po "Tak" osoba wybiera miejsce i wpisuje godzinę. Każdy krok trafia do pliku `odpowiedzi.csv` w tym repozytorium. Osoba, która odpowiada, nie widzi tego pliku.

Adres strony: https://randka-tawny.vercel.app

## Jak to działa

1. `public/index.html` to cała strona. Każdy krok wysyła do `/api/odpowiedz`.
2. `api/odpowiedz.js` (Vercel Function) zapisuje zdarzenie jako prywatny plik w magazynie Vercel Blob `randka-odpowiedzi`.
3. Co 30 minut workflow `.github/workflows/synchronizuj.yml` uruchamia `scripts/synchronizuj.mjs`. Skrypt pobiera nowe zdarzenia z `/api/eksport`, dopisuje je do `odpowiedzi.csv`, robi commit jako `github-actions[bot]` i usuwa przeniesione zdarzenia z magazynu.
4. `/api/eksport` wpuszcza tylko zadanie GitHub Actions z tego repozytorium. Zadanie przedstawia się tokenem OIDC wystawionym przez GitHub. Funkcja sprawdza podpis tokenu, repozytorium (`Kajetan98/randka`, id `1461801637`), gałąź `main` i plik workflow. Nie ma żadnego hasła ani tokenu do przechowywania.

Workflow można uruchomić od razu: zakładka Actions → "Odpowiedzi do CSV" → Run workflow. Harmonogram GitHuba bywa opóźniony, więc nowe wiersze mogą pojawić się później niż po 30 minutach. Do tego czasu odpowiedzi czekają w magazynie i nie giną.

Repozytorium powinno być prywatne, bo `odpowiedzi.csv` zawiera odpowiedzi. W prywatnym repozytorium każde uruchomienie zużywa minuty GitHub Actions (około 1440 minut miesięcznie przy obecnym harmonogramie, darmowy limit to 2000). Harmonogram zmienisz w linii `cron` w pliku workflow.

Vercel serwuje tylko folder `public/` i funkcje z `api/`, więc `odpowiedzi.csv` nie jest dostępny pod adresem strony.

## Wdrażanie

Projekt `randka` na Vercelu jest wdrażany z plików, bez połączenia z GitHubem, bo konto Vercel nie ma podpiętego GitHuba. Zmiany w repozytorium nie wdrażają się więc same. Żeby to włączyć: Vercel → Account Settings → Authentication → połącz GitHub, potem w projekcie Settings → Git → Connect Git Repository → `Kajetan98/randka`. `vercel.json` pomija budowanie, gdy commit zmienia tylko `odpowiedzi.csv`.

## Kolumny w odpowiedzi.csv

| kolumna | znaczenie |
|---|---|
| `czas_pl` | czas zdarzenia, strefa Europe/Warsaw |
| `etap` | `otwarcie`, `kliknieto_tak`, `wybrano_miejsce`, `wpisano_godzine`, `zamknieto_bez_tak` |
| `odpowiedz` | `tak` po kliknięciu Tak |
| `miejsce` | Kino, Kolacja, Kawa i deser albo Spacer |
| `godzina_spotkania` | wpisana godzina |
| `proby_nie` | ile razy osoba próbowała kliknąć Nie |
| `wizyta` | identyfikator jednego otwarcia strony, łączy wiersze z tej samej wizyty |
| `czas_utc` | czas zdarzenia w UTC |
| `id` | identyfikator zdarzenia, chroni przed podwójnym zapisem |

Pełna odpowiedź to wiersz z etapem `wpisano_godzine`. `zamknieto_bez_tak` oznacza, że ktoś próbował kliknąć Nie i zamknął stronę bez kliknięcia Tak.
