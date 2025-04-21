import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';

import {
  agent,
  contentType,
  getSoapAction,
  wsUrl,
} from '../utils/requestConstants.js';
import { soapBodyBuilder } from '../utils/requestBuilder.js';

const parser = new XMLParser();

/**
 * @route   POST /api/auth/register
 * @desc    Registracija korisnika
 * @name    UbaciWebQRScanKorisnik
 * @param   {string} req.body.email - Email adresa
 * @param   {string} req.body.password - Lozinka
 * @param   {string} req.body.companyId - PIB
 * @param   {string} req.body.companyName - Naziv firme
 * @param   {string} req.body.contact - Kontakt
 */
export const registerUser = async (req, res) => {
  const { email, password, companyId, companyName, contact } = req.body;
  try {
    if (!email || !password || !companyId || !companyName) {
      return res
        .status(400)
        .send('Prosledite email adresu, lozinku, PIB i naziv firme');
    }

    const response = await axios.post(
      wsUrl,
      soapBodyBuilder(
        'UbaciWebQRScanKorisnik',
        ['email', 'lozinka', 'pib', 'nazivfirme', 'kontakt', 'token'],
        [email, password, companyId, companyName, contact, '']
      ),
      {
        headers: {
          'Content-Type': contentType,
          SOAPAction: getSoapAction('UbaciWebQRScanKorisnik'),
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
        'UbaciWebQRScanKorisnikResponse'
      ]?.['UbaciWebQRScanKorisnikResult'];

    if (!result) {
      return res.status(400).send('Web server nije aktivan');
    }

    if (
      result ===
      "ERROR [23000] [Sybase][ODBC Driver][SQL Anywhere]Index 'AK_WebQRScanKorisnikEmail' for table 'WebQRScanKorisnik' would not be unique"
    ) {
      return res.status(400).send('Korisnik sa ovom email adresom već postoji');
    }

    return res.status(201).json({ user: String(result) });
  } catch (error) {
    return res.status(500).send('Greška prilikom registrovanja korisnika');
  }
};

/**
 * @route   POST /api/auth/login
 * @desc    Logovanje korisnika
 * @name    AzurWebQRScanKorisnik
 * @param   {string} req.body.email - Email adresa
 * @param   {string} req.body.password - Lozinka
 */
export const loginUser = async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) {
      return res.status(400).send('Morate proslediti email adresu i lozinku');
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
        ['0', email, password, '', '', '', '', '', 'L']
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
      return res.status(400).send('Pogrešni kredencijali');
    }

    return res.status(200).json({ user: String(result) });
  } catch (error) {
    return res.status(500).send('Greška prilikom prijavljivanja korisnika');
  }
};

/**
 * @route   POST /api/auth/logout
 * @desc    Odjavljivanje korisnika
 * @name    AzurWebQRScanKorisnik
 * @param   {string} req.body.uid - SK korisnika
 * @param   {string} req.body.token - Session token
 */
export const logoutUser = async (req, res) => {
  const { uid, token } = req.body;

  try {
    if (!uid || !token) {
      return res
        .status(400)
        .send('Nisu prosleđeni identifikator i token sesije');
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
        [uid, '', '', '', '', '', '', token, 'O']
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
      return res.status(400).send('Niste autorizovani za ovu operaciju');
    }

    return res.status(200).json({ user: String(result) });
  } catch (error) {
    return res.status(500).send('Greška prilikom odjavljivanja korisnika');
  }
};
