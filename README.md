# 📲 Calculus QR Scanner API

Jednostavan Node.js REST API kreiran za **Calculus QR Scanner mobilnu aplikaciju**.

## 🚀 Karakteristike

- 🧾 Kreiranje i čuvanje računa u bazi podataka povezanoj na Calculus WS
- 👤 Autentikacija/autorizacija korisnika i upravljanje podacima profila
- ⏱️ Provera funkcionisanja web servisa i baze podataka
- 📦 Postavljen na IIS serveru (https://net.calculus.rs), a tokom prelaznog perioda i na [Render](https://render.com)

## 📁 Struktura projekta

- controllers - funkcije za poziv Calculus WS
- routes - rute koje se pozivaju iz mobilne aplikacije
- utils - pomoćne funkcije i konstante za lakše pozivanje WS-a
- server.js - polazni fajl gde su definisane rute
- web.config - IIS konfiguracija (AspNetCoreModuleV2 pokreće node.exe)
- scripts - PowerShell skripte za pripremu servera i deployment
- render.yaml - fajl za Render deployment (prelazni period)

## 🛠️ Instrukcije za pokretanje

### 1. Kloniranje repozitorijuma sa Github-a

```bash
git clone https://github.com/your-username/calculus-qr-scanner-api.git
```

### 2. Instalacija biblioteka

```bash
npm install
```

### 3. Pokretanje u lokalu (na adresi http://localhost:8000)

```bash
npm run dev
```

## 🖥️ Deployment na server (net.calculus.rs)

API radi na istom serveru kao CWSFiskaliQR. IIS sajt `CalculusQrScanner.Api` preko
AspNetCoreModuleV2 (out-of-process) pokreće `node.exe server.js`. Port mu dodeljuje kroz
`ASPNETCORE_PORT`, a proces ponovo pokreće ako padne. App pool je `AlwaysRunning` i nema
idle timeout, pa nema cold start-a.

```
C:\Apps\CalculusQrScanner.Api\
  src\          git clone ovog repozitorijuma
  releases\     jedan folder po deployment-u (yyyyMMdd-HHmmss)
  shared\.env   tajne (van release-a, dostupno samo Administrators/SYSTEM/app pool)
  shared\uploads\
  shared\data\  sendgrid.db (SQLite, SendGrid webhook događaji; app pool ima pravo upisa)
  logs\         stdout_*.log (izlaz node procesa)
```

Jednokratna priprema (PowerShell kao Administrator):

1. Instalirati Node.js LTS (x64 MSI) u `C:\Program Files\nodejs`.
2. `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Initialize-Server.ps1`
3. Kreirati `C:\Apps\CalculusQrScanner.Api\shared\.env` (vidi `.env.example`, bez `PORT`).
4. Sertifikat i HTTPS binding: `C:\win-acme\wacs.exe --source iis --siteid <id> --host net.calculus.rs --installation iis`
   (obnavlja se automatski kroz postojeći "win-acme renew" task).

Svaki sledeći deployment (posle `git push`):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Apps\CalculusQrScanner.Api\src\scripts\Deploy-Server.ps1
```

Provera: `curl.exe -i https://net.calculus.rs/health`, `/api/info/ws`, `/api/info/db`.

## 🌐 API Rute

🩺 Health
Metoda | Ruta | Opis
GET | /health | Vraća `{ "status": "ok" }` ako Node proces radi (ne poziva WS)

🔐 Autentikacija (/api/auth)
Metoda | Ruta | Opis
POST | /register | Registracija novog korisnika (detaljniji unos u bazu se mora obaviti u komunikaciji sa korisnikom, kako bi se uneli serijski brojevi baze. Za sada se ovaj proces obavlja ručno, u budućnosti će se možda automatizovati)
POST | /login | Prijavljivanje postojećeg korisnika
POST | /logout | Odjavljivanje ulogovanog korisnika

🧾 Računi (/api/receipts)
Metoda | Ruta | Opis
POST | / | Čuvanje TaxCore URL-ova fiskalnih računa u bazi

⏱ Server Info (/api/info)
Metoda | Ruta | Opis
GET | /ws | Datum i vreme Web servisa (ako ne vrati datum i vreme - nije aktiviran WS, proveriti IIS na Knjig serveru)
GET | /db | Datum i vreme servera baze podataka (ako ne vrati datum i vreme - proveriti bazu na Knjig serveru)

👤 Korisnički nalog (/api/users)
Metoda | Ruta | Opis
GET | /:id | Vraćanje podataka o korisniku
PUT | /:id/password | Promena lozinke korisnika
PUT | /:id/profile | Promena podataka profila (kontakt)

🔔 Obaveštenja (/api/announcements)
Metoda | Ruta | Opis
GET | /:userId | Obaveštenja vidljiva korisniku (globalna, po bazi i lična). Token se šalje u headeru `x-session-token`
PUT | /:id/read | Označavanje obaveštenja kao pročitano (`{ userId, token, read }`, `read` je podrazumevano `true`)

Obaveštenja se unose direktno u bazu: `WebQRScanObavestenje` (`Globalno = 'D'` za sve korisnike,
`Prioritet >= 1` za popup u aplikaciji), `WebQRScanObavestenjeBaze` (svi korisnici jedne baze) i
`WebQRScanObavestenjeKorisnika` (pojedinačni korisnik, čuva i status pročitanosti).

✉️ SendGrid (/api/sendgrid) - poziva se iz Calculus ERP-a
Metoda | Ruta | Opis
POST | /send | Slanje mejla preko SendGrid Web API-ja, sa SendGrid API ključem korisnika
POST | /verify | Provera da je SendGrid API ključ ispravan i da ima dozvolu `mail.send` (ne šalje mejl). Vraća i `canReadActivity` i `canSetupWebhook`
POST | /webhook/setup | Kreira potpisan Event Webhook na SendGrid nalogu korisnika i vraća `accountToken` (besplatni plan)
DELETE | /webhook | Briše webhook sa SendGrid naloga i sve sačuvane događaje tog naloga
POST | /messages/status | Status isporuke/otvaranja za do 50 mejlova (`{ "messageIds": ["..."] }`)
POST | /events/:accountId | Prijem događaja od SendGrid-a (ne poziva se iz ERP-a; proverava se ECDSA potpis)

Obavezni headeri (ključevi se nikad ne šalju u telu ili URL-u, ne čuvaju se i ne loguju):

- `X-Calculus-Client-Key` - ključ klijenta iz `ERP_CLIENT_KEYS`
- `X-SendGrid-Api-Key` - SendGrid API ključ korisnika (preporuka: Restricted Access, samo Mail Send)
- `Content-Type: application/json; charset=utf-8`

Telo `/send` zahteva (prilozi su u istom formatu kao kod `/api/zoho/requests`):

```json
{
  "from": "office@firma.rs",
  "fromName": "Firma d.o.o.",
  "to": "kupac@primer.rs; drugi@primer.rs",
  "cc": ["knjigovodstvo@firma.rs"],
  "bcc": "",
  "replyTo": "prodaja@firma.rs",
  "subject": "Faktura 123/2026",
  "text": "Poštovani, u prilogu je faktura.",
  "html": "<p>Poštovani, u prilogu je faktura.</p><img src=\"cid:logo\">",
  "attachments": [
    { "filename": "Faktura-123.pdf", "contentType": "application/pdf", "dataBase64": "JVBERi0..." },
    { "filename": "logo.png", "contentType": "image/png", "dataBase64": "iVBOR...", "contentId": "logo" }
  ]
}
```

- `from` mora biti verifikovan pošiljalac (Sender Identity) na SendGrid nalogu korisnika
- `to`, `cc`, `bcc` - niz ili string odvojen `,`/`;`; ukupno do 1000 adresa, duplikati se uklanjaju
- `text` i/ili `html` (bar jedno); do 20 priloga, ukupno do 20 MB; prelomi reda u base64 su dozvoljeni
- Odgovor je uvek ravan JSON: uspeh `{ "success": true, "code": "SENT", "messageId": "..." }`,
  greška `{ "success": false, "code": "...", "error": "poruka za korisnika", "details": [...] }`
- Kodovi grešaka: `CLIENT_UNAUTHORIZED` (401), `VALIDATION_ERROR`/`INVALID_JSON` (400), `UNSUPPORTED_MEDIA_TYPE` (415),
  `PAYLOAD_TOO_LARGE` (413), `RATE_LIMITED` (429), `SENDGRID_KEY_REJECTED`/`SENDGRID_FORBIDDEN`/`SENDGRID_KEY_NO_MAIL_SEND` (403),
  `SENDGRID_VALIDATION` (400), `SENDGRID_RATE_LIMITED` (429), `SENDGRID_TIMEOUT` (504), `SENDGRID_ERROR`/`SENDGRID_UNAVAILABLE` (502)
- Ključ klijenta se generiše sa `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
- `trackOpens` / `trackClicks` (opciono, `true`/`false`) uključuju praćenje otvaranja/klikova za taj mejl; bez njih važe podešavanja SendGrid naloga.
  Za status `OPENED` ERP treba da šalje `"trackOpens": true`

Statusi mejlova (`/messages/status`) - dva izvora, isti odgovor:

- **Plaćeni plan** (Email Activity History dodatak + dozvola Email Activity na ključu): zahtev bez account tokena, sa
  `X-SendGrid-Api-Key`. Podaci se čitaju direktno iz SendGrid Email Activity API-ja (`source: "activity"`). Neuspešna isporuka je `NOT_DELIVERED`, bez razloga
- **Svi planovi** (webhook): ERP jednom pozove `/webhook/setup` sa ključem koji ima Mail Send + Event Webhook (Full Access) i sačuva
  dobijeni `accountToken` uz SendGrid ključ. Statusi se čitaju sa `X-SendGrid-Account-Token` (`source: "webhook"`), uz razlog za bounce/odbijanje.
  Ponovni `/webhook/setup` sa istim tokenom zamenjuje webhook (npr. posle promene ključa). Događaji se čuvaju u
  `shared\data\sendgrid.db` (SQLite) 30 dana (`SENDGRID_EVENTS_RETENTION_DAYS`), samo za mejlove poslate preko ovog API-ja

```json
{ "success": true, "code": "OK", "source": "webhook", "messages": [
  { "messageId": "XhCSq6wyRDSbQEkhq4efFw", "status": "BOUNCED", "lastEventAt": "2026-10-28T16:40:06.000Z",
    "opens": 1, "clicks": 0, "reason": "550 5.1.1 User unknown",
    "recipients": [ { "email": "kupac@primer.rs", "status": "OPENED", "lastEventAt": "...", "reason": null },
                    { "email": "drugi@primer.rs", "status": "BOUNCED", "lastEventAt": "...", "reason": "550 5.1.1 User unknown" } ] }
] }
```

- `status` je najgori status među primaocima, od najgoreg ka najboljem: `BOUNCED`, `DROPPED`, `SPAM`, `NOT_DELIVERED`, `DEFERRED`,
  `UNKNOWN` (još nema podataka), `SENT`, `DELIVERED`, `OPENED`, `CLICKED`. ERP upisuje `status` (i po želji `lastEventAt`) u svoju kolonu
- `OPENED` je okviran podatak: Apple Mail Privacy Protection otvara mejlove automatski, a klijenti koji blokiraju slike ne javljaju otvaranje
- Dodatni kodovi grešaka: `ACCOUNT_TOKEN_INVALID` (401), `WEBHOOK_NOT_CONFIGURED` (503)

## ⚙️ Environment Varijable

- PORT - port na kom se pokreće server na lokalu (pod IIS-om se ne postavlja)
- NODEMAILER_MAIL - email adresa sa koje će se slati mejlovi korisnicima
- NODEMAILER_PASSWORD - lozinka gore navedene email adrese
- SUPPORT_MAIL - email adresa korisničke podrške na koju se šalje email o registraciji novog korisnika
- ZOHO_BASE_URL, ZOHO_PORTAL_BASE_URL, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_SCOPE - Zoho SDP pristup
- ERP_CLIENT_KEYS - ključevi Calculus ERP-a za /api/sendgrid (najmanje 32 karaktera, više odvojenih zarezom radi rotacije). Ako nije podešen, /api/sendgrid odbija sve zahteve
- SENDGRID_RATE_LIMIT_PER_MINUTE (opciono) - broj zahteva ka /api/sendgrid po IP adresi u minuti (podrazumevano 60)
- PUBLIC_BASE_URL - javna https adresa API-ja na koju SendGrid šalje događaje (pod IIS-om u web.config)
- DATA_DIR (opciono) - folder SQLite baze SendGrid događaja (podrazumevano ./data, pod IIS-om shared\data u web.config)
- SENDGRID_EVENTS_RETENTION_DAYS (opciono) - broj dana čuvanja SendGrid događaja (podrazumevano 30)
- WS_URL (opciono) - adresa Calculus WS-a
- UPLOADS_DIR (opciono) - folder za privremene fajlove

## 🧩 Tech Stack

- Node.js
- Express

## 📬 Autor

- Nikola Raičević
  📧 nikola.raicevic@calculus.rs
  📧 2nikolar1@gmail.com
