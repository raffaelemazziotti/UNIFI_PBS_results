# PBS modulo 1

Pagina statica per la consultazione dei risultati: statistiche aggregate, distribuzione dei voti, ricerca per matricola e dettaglio dei dodici punteggi. Non contiene nomi, risposte, commenti, informazioni DSA/Erasmus o classifiche individuali.

Aprire [docs/index.html](docs/index.html) nel browser, oppure servire la cartella:

```sh
python3 -m http.server 8080 --directory docs
```

La pagina non richiede un backend, cookie, account, servizi esterni o dipendenze JavaScript. I punteggi sono su **16**, non in trentesimi. La fascia `< 8` raccoglie tutti i punteggi inferiori a 8, senza posizioni interne. I ritirati sono esclusi dalle statistiche e dai grafici.

## Aggiornare i risultati

La fonte dei punteggi è il file XLSX locale nella cartella `PBS/`, esclusa da Git. Il generatore legge i dodici voti dal workbook: non usa i precedenti report o il JSON privato delle valutazioni. Le matricole numeriche esportate dal file come `1234567.0` sono normalizzate in `1234567`, preservando eventuali zeri iniziali.

Con Python, NumPy e scikit-learn disponibili:

```sh
PYTHONNOUSERSITE=1 python3 scripts/export_pbs.py
PYTHONNOUSERSITE=1 python3 scripts/export_pbs.py --check
```

Il generatore aggiorna `docs/data.js`. Dopo modifiche ai voti nell’XLSX, rigenerare questo file e versionare il cambiamento. La pagina è una fotografia esportata, non un collegamento in tempo reale a Excel o Google Drive.

## Mappa delle somiglianze

Il generatore confronta localmente parole e coppie di parole delle risposte alla stessa domanda, con pesi TF-IDF. Le dodici domande hanno lo stesso peso prima della normalizzazione per compito. Le distanze associate alla somiglianza coseno complessiva sono proiettate in due dimensioni con t-SNE (seed fisso, perplexity 20 per il gruppo attuale), privilegiando le vicinanze locali.

Sono esportate soltanto le coordinate bidimensionali, ordinate per coordinate, senza corrispondenza con matricole o righe del workbook. I punti non sono colorati per voto. La pagina riporta la percentuale media dei dieci vicini più prossimi mantenuti dalla proiezione: la mappa è esplorativa e non conserva tutte le distanze. Le distanze fra gruppi non hanno un significato metrico preciso. Lessico del corso, lunghezza e completezza delle risposte possono influenzarla. **Non è un rilevatore di copiatura, originalità o uso di LLM.**

## Riservatezza e versionamento

- Versionabili: `docs/`, generatore, test e questa documentazione. I dati autorizzati includono matricole e punteggi.
- Non versionabili: tutta la cartella `PBS/`, inclusi compiti, workbook, risposte, commenti, report interni, backup e anteprime dei test.
- La ricerca per matricola non è autenticazione: i dati pubblici di una pagina statica possono essere letti dal sorgente. Non usare questo progetto per informazioni che richiedono accesso individuale riservato.
- Le matricole cercate non sono salvate in cookie, URL o memoria persistente. Non sono presenti analytics o richieste verso servizi esterni.

Il repository non viene pubblicato automaticamente. Per GitHub Pages, quando si decide di pubblicare, si può selezionare il branch desiderato e la cartella `/docs` nelle impostazioni Pages. Verificare prima l’autorizzazione alla pubblicazione dei dati.

## Verifiche

```sh
PYTHONNOUSERSITE=1 python3 -m unittest discover -s tests -p 'test_*.py'
node tests/check_pbs_ui.cjs
```

Il test browser richiede Playwright con Chromium installato nell’ambiente di sviluppo. In alternativa indicare il percorso del modulo con `PLAYWRIGHT_MODULE`. Verifica ricerca, punteggi, ritiro, fascia aggregata, accessibilità di base, assenza di richieste esterne e layout mobile. Le anteprime sono salvate solo sotto `PBS/`.
