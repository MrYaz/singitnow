# SingItNow

Lär dig körtexterna utantill, en formdel i taget, och öva stämmorna. Byggd för Sing It-körer.

**Appen:** https://mryaz.github.io/singitnow/ (installera via "Lägg till på hemskärmen")

## Vad den gör

- **Import:** klistra in länken till körens Google Drive-mapp, eller välj filer/mapp. Nya låtar i Drive-mappen hämtas automatiskt.
- **Analys i telefonen:** läser text-PDF:erna (rader, tidsstämplar, färgmarkerad stämsång) och hittar var varje rad sjungs genom att jämföra stämfilen med Musik-filen. Ingen server, inget konto.
- **Lektioner per formdel:** lyssna, välj ord, ordbrickor, första bokstaven, tonas bort, sjung själv. Rader du missar kommer tillbaka i Dagens pass (spaced repetition med FSRS).
- **Stämrep:** soloknappar per stämma (S, S1, S2, A1, A2, ALLA, Musik), mixer, loopa en rad eller en formdel.
- **Konsertläge:** hela låten med bara komp och ingen text.
- Streak, dagsmål, kronor, tyst läge, justera radtider för hand.

Allt material stannar på enheten. Inget av Sing Its ljud eller texter finns i det här repot.

## Utveckling

```sh
npm install
npm run dev        # http://localhost:5173/singitnow/
npm test           # enhetstester
npm run build
```

Tester mot riktigt körmaterial körs bara lokalt, eftersom materialet inte får ligga i repot:

```sh
MATERIAL_DIR="/sökväg/till/HT26 Piteå" npm test
MATERIAL_DIR="/sökväg/till/en mapp med låtmappar" npm run e2e
```

Google Drive-importen kräver en API-nyckel i miljövariabeln `VITE_GOOGLE_API_KEY` (i GitHub: repo-secret `GOOGLE_API_KEY`). Nyckeln ska vara låst till sidans adress och till Google Drive API.

## Struktur

- `src/lib/pdf/` – PDF-läsning (pdf.js) och tolkning av Sing Its textblad
- `src/lib/audio/` – aktivitetsanalys, radmatchning, ljudmotor (Web Audio)
- `src/lib/exercises.ts`, `src/lib/learn.ts` – övningar, repetition, streak
- `src/screens/` – skärmarna
