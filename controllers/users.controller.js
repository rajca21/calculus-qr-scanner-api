import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';

import {
  agent,
  contentType,
  getSoapAction,
  wsUrl,
} from '../utils/requestConstants.js';
import { soapBodyBuilder } from '../utils/requestBuilder.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  numberParseOptions: {
    leadingZeros: false,
    hex: false,
    skipLike: /\d{7,}/,
  },
});

/**
 * @route   GET /api/users/:id
 * @desc    Uzimanje podataka o korisniku
 * @name    DajWebQRScanKorisnik
 * @param   {string} req.params.id - SK korisnika
 */
export const getUserById = async (req, res) => {
  const { id } = req.params;

  try {
    if (!id) {
      return res.status(400).send('Nije prosleđen identifikator korisnika');
    }

    const response = await axios.post(
      wsUrl,
      soapBodyBuilder('DajWebQRScanKorisnik', ['QRScanKorisnikSK'], [id]),
      {
        headers: {
          'Content-Type': contentType,
          SOAPAction: getSoapAction('DajWebQRScanKorisnik'),
          Accept: 'text/xml',
          'User-Agent': 'Node.js',
        },
        httpsAgent: agent,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: () => true,
      }
    );

    const xmlData = response.data;
    const jsonData = parser.parse(xmlData);

    const result =
      jsonData['soap:Envelope']?.['soap:Body']?.[
        'DajWebQRScanKorisnikResponse'
      ]?.['DajWebQRScanKorisnikResult'];

    if (!result) {
      return res.status(400).send('Web server nije aktivan');
    }

    if (
      result ===
      'ERROR [HY000] [Sybase][ODBC Driver][SQL Anywhere]User-defined exception signaled'
    ) {
      return res.status(404).send('Korisnik nije pronađen');
    }

    const user = result?.['diffgr:diffgram']?.['NewDataSet']?.['Table'];

    const oldKey =
      'list_x0028_WebQRScanBaza.SerijskiBroj_x0020__x007C__x007C__x0020__x0027_-_x0027__x0020__x007C__x007C__x0020_WebQRScanBaza.Naziv_x0029_';
    if (user && user.hasOwnProperty(oldKey)) {
      user.SerijskiBrojevi = user[oldKey];
      delete user[oldKey];
    }

    if (!user) {
      return res.status(404).send('Korisnik nije pronađen');
    }

    user.QRScanKorisnikSK = String(user.QRScanKorisnikSK);
    return res.status(200).json({ user });
  } catch (error) {
    return res
      .status(500)
      .send('Greška prilikom povlačenja podataka o korisniku');
  }
};

/**
 * @route   PUT /api/users/:id/password
 * @desc    Promena lozinke korisnika
 * @name    AzurWebQRScanKorisnik
 * @param   {string} req.params.id - SK korisnika
 * @param   {string} req.body.token - Session token
 * @param   {string} req.body.password - Trenutna lozinka
 * @param   {string} req.body.newPassword - Nova lozinka
 */
export const resetPassword = async (req, res) => {
  const { id } = req.params;
  const { token, password, newPassword } = req.body;
  try {
    if (!id || !token) {
      return res.status(400).send('Nisu prosleđeni identifikatori korisnika');
    }
    if (!password || !newPassword) {
      return res.status(400).send('Prosledite trenutnu i novu lozinku');
    }

    const response = await axios.post(
      wsUrl,
      soapBodyBuilder(
        'AzurWebQRScanKorisnik',
        [
          'korisniksk',
          'email',
          'lozinka',
          'novalozinka',
          'pib',
          'nazivfirme',
          'kontakt',
          'token',
          'tipazur',
        ],
        [String(id), '', password, newPassword, '', '', '', token, 'R']
      ),
      {
        headers: {
          'Content-Type': contentType,
          SOAPAction: getSoapAction('AzurWebQRScanKorisnik'),
          Accept: 'text/xml',
          'User-Agent': 'Node.js',
        },
        httpsAgent: agent,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: () => true,
      }
    );

    const xmlData = response.data;
    const jsonData = parser.parse(xmlData);

    const result =
      jsonData['soap:Envelope']?.['soap:Body']?.[
        'AzurWebQRScanKorisnikResponse'
      ]?.['AzurWebQRScanKorisnikResult'];

    if (!result) {
      return res.status(400).send('Web server nije aktivan');
    }

    // Ista je greška i ako je pogrešan ID, i sessionToken i pogrešna trenutna lozinka
    // U budućnosti bi trebalo ove greške obraditi drugačije, ali kroz WS
    if (
      result ===
      'ERROR [HY000] [Sybase][ODBC Driver][SQL Anywhere]User-defined exception signaled'
    ) {
      return res
        .status(403)
        .send(
          'Došlo je do greške prilikom promene lozinke! Proverite da li ste ispravno uneli trenutnu lozinku'
        );
    }

    return res.status(202).json({ user: String(result) });
  } catch (error) {
    return res.status(500).send('Greška prilikom promene lozinke');
  }
};

/**
 * @route   PUT /api/users/:id/profile
 * @desc    Ažuriranje informacija o korisniku
 * @name    AzurWebQRScanKorisnik
 * @param   {string} req.params.id - SK korisnika
 * @param   {string} req.body.token - Session token
 * @param   {string} req.body.contact - Kontakt
 */
export const updateProfileInfo = async (req, res) => {
  const { id } = req.params;
  const { token, contact } = req.body;
  try {
    if (!id || !token) {
      return res.status(400).send('Nisu prosleđeni identifikatori korisnika');
    }
    if (!contact) {
      return res.status(400).send('Prosledite nove kontakt informacije');
    }

    const response = await axios.post(
      wsUrl,
      soapBodyBuilder(
        'AzurWebQRScanKorisnik',
        [
          'korisniksk',
          'email',
          'lozinka',
          'novalozinka',
          'pib',
          'nazivfirme',
          'kontakt',
          'token',
          'tipazur',
        ],
        [String(id), '', '', '', '', '', contact, token, 'P']
      ),
      {
        headers: {
          'Content-Type': contentType,
          SOAPAction: getSoapAction('AzurWebQRScanKorisnik'),
          Accept: 'text/xml',
          'User-Agent': 'Node.js',
        },
        httpsAgent: agent,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: () => true,
      }
    );

    const xmlData = response.data;
    const jsonData = parser.parse(xmlData);

    const result =
      jsonData['soap:Envelope']?.['soap:Body']?.[
        'AzurWebQRScanKorisnikResponse'
      ]?.['AzurWebQRScanKorisnikResult'];

    if (!result) {
      return res.status(400).send('Web server nije aktivan');
    }

    if (
      result ===
      'ERROR [HY000] [Sybase][ODBC Driver][SQL Anywhere]User-defined exception signaled'
    ) {
      return res
        .status(403)
        .send('Niste autorizovani da izvršite promenu informacija o profilu');
    }

    return res.status(202).json({ user: String(result) });
  } catch (error) {
    return res.status(500).send('Greška prilikom ažuriranja profila');
  }
};
