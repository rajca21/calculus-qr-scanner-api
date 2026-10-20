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

## ⚙️ Environment Varijable

- PORT - port na kom se pokreće server na lokalu (pod IIS-om se ne postavlja)
- NODEMAILER_MAIL - email adresa sa koje će se slati mejlovi korisnicima
- NODEMAILER_PASSWORD - lozinka gore navedene email adrese
- SUPPORT_MAIL - email adresa korisničke podrške na koju se šalje email o registraciji novog korisnika
- ZOHO_BASE_URL, ZOHO_PORTAL_BASE_URL, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_SCOPE - Zoho SDP pristup
- WS_URL (opciono) - adresa Calculus WS-a
- UPLOADS_DIR (opciono) - folder za privremene fajlove

## 🧩 Tech Stack

- Node.js
- Express

## 📬 Autor

- Nikola Raičević
  📧 nikola.raicevic@calculus.rs
  📧 2nikolar1@gmail.com
