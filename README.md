# 📲 Calculus QR Scanner API

Jednostavan Node.js REST API kreiran za **Calculus QR Scanner mobilnu aplikaciju**.

## 🚀 Karakteristike

- 🧾 Kreiranje i čuvanje računa u bazi podataka povezanoj na Calculus WS
- 👤 Autentikacija/autorizacija korisnika i upravljanje podacima profila
- ⏱️ Provera funkcionisanja web servisa i baze podataka
- 📦 Postavljen na [Render](https://render.com)

## 📁 Struktura projekta

- controllers - funkcije za poziv Calculus WS
- routes - rute koje se pozivaju iz mobilne aplikacije
- utils - pomoćne funkcije i konstante za lakše pozivanje WS-a
- server.js - polazni fajl gde su definisane rute
- render.yaml - fajl za deployment

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

## 🌐 API Rute

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

- PORT - port na kom se pokreće server na lokalu

## 🧩 Tech Stack

- Node.js
- Express

## 📬 Autor

- Nikola Raičević
  📧 nikola.raicevic@calculus.rs
  📧 2nikolar1@gmail.com
