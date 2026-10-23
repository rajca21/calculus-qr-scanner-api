import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';

import {
  agent,
  contentType,
  getSoapAction,
  wsUrl,
} from '../utils/requestConstants.js';
import { soapBodyBuilder } from '../utils/requestBuilder.js';

// Naslov i Opis moraju ostati stringovi i kada izgledaju kao broj
const parser = new XMLParser({ parseTagValue: false });

const WS_ERROR =
  'ERROR [HY000] [Sybase][ODBC Driver][SQL Anywhere]User-defined exception signaled';

// # Poziv metode WS i vraćanje sadržaja <metoda>Response elementa
const callWS = async (method, keys, values) => {
  const response = await axios.post(
    wsUrl,
    soapBodyBuilder(method, keys, values),
    {
      headers: {
        'Content-Type': contentType,
        SOAPAction: getSoapAction(method),
        Accept: 'text/xml',
        'User-Agent': 'Node.js',
      },
      httpsAgent: agent,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      validateStatus: () => true,
    },
  );

  const jsonData = parser.parse(response.data);
  return jsonData['soap:Envelope']?.['soap:Body']?.[`${method}Response`];
};

const toDate = (value) => (value ? String(value).slice(0, 10) : null);

const toAnnouncement = (row) => ({
  id: String(row.QRScanObavestenjeSK),
  title: String(row.Naslov ?? '').trim(),
  body: String(row.Opis ?? '').trim(),
  type: String(row.Tip ?? '').trim(),
  priority: Number(row.Prioritet) || 0,
  link: row.Link ? String(row.Link).trim() : null,
  validFrom: toDate(row.DatumOd),
  validTo: toDate(row.DatumDo),
  createdAt: row.DatumKreiranja ? String(row.DatumKreiranja) : null,
  read: row.Procitano === 'D',
});

/**
 * @route   GET /api/announcements/:userId
 * @desc    Sva obaveštenja vidljiva korisniku (globalna, po bazi i lična)
 * @name    DajWebQRScanObavestenja
 * @param   {string} req.params.userId - SK korisnika
 * @param   {string} req.headers['x-session-token'] - Session token
 */
export const getAnnouncements = async (req, res) => {
  const { userId } = req.params;
  const token = req.get('x-session-token');

  try {
    if (!userId || !token) {
      return res
        .status(400)
        .send('Nisu prosleđeni identifikator i token sesije');
    }

    const response = await callWS(
      'DajWebQRScanObavestenja',
      ['korisniksk', 'token'],
      [userId, token],
    );

    if (response === undefined) {
      return res.status(400).send('Web server nije aktivan');
    }

    // WS za greške u bazi (i neispravan token) vraća prazan Response element
    const result = response?.['DajWebQRScanObavestenjaResult'];
    if (!result) {
      return res.status(401).send('Sesija je istekla ili token nije validan');
    }

    const rows = result?.['diffgr:diffgram']?.['NewDataSet']?.['Table'];
    const announcements = (Array.isArray(rows) ? rows : rows ? [rows] : []).map(
      toAnnouncement,
    );

    return res.status(200).json({ announcements });
  } catch (error) {
    return res.status(500).send('Greška prilikom povlačenja obaveštenja');
  }
};

/**
 * @route   PUT /api/announcements/:id/read
 * @desc    Označavanje obaveštenja kao pročitano/nepročitano
 * @name    AzurWebQRScanObavestenjeProcitano
 * @param   {string} req.params.id - SK obaveštenja
 * @param   {string} req.body.userId - SK korisnika
 * @param   {string} req.body.token - Session token
 * @param   {boolean} req.body.read - Pročitano (podrazumevano true)
 */
export const markAnnouncementRead = async (req, res) => {
  const { id } = req.params;
  const { userId, token, read = true } = req.body;

  try {
    if (!id || !userId || !token) {
      return res
        .status(400)
        .send('Nisu prosleđeni identifikatori obaveštenja i korisnika');
    }

    const response = await callWS(
      'AzurWebQRScanObavestenjeProcitano',
      ['obavestenjesk', 'korisniksk', 'token', 'procitano'],
      [String(id), String(userId), token, read === false ? 'N' : 'D'],
    );

    const result = response?.['AzurWebQRScanObavestenjeProcitanoResult'];

    if (!result) {
      return res.status(400).send('Web server nije aktivan');
    }

    if (result === WS_ERROR) {
      return res
        .status(403)
        .send('Niste autorizovani da izmenite ovo obaveštenje');
    }

    if (String(result).startsWith('ERROR')) {
      return res.status(500).send('Greška prilikom ažuriranja obaveštenja');
    }

    return res.status(200).json({ id: String(result), read: read !== false });
  } catch (error) {
    return res.status(500).send('Greška prilikom ažuriranja obaveštenja');
  }
};
