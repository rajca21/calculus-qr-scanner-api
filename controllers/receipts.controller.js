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
 * @route   POST /api/receipts
 * @desc    Unos računa u bazu
 * @name    UbaciWebQRScanUcitaniRacuni
 * @param   {string} req.body.dbSerialNumber - Serijski broj baze u koju se unose računi
 * @param   {string} req.body.receipts - URL računa, odvojeni zarezom
 * @param   {string} req.body.uid - SK korisnika koji unosi račune
 * @param   {string} req.body.token - Session Token
 */
export const createReceipts = async (req, res) => {
  const { dbSerialNumber, receipts, uid, token } = req.body;
  try {
    if (!dbSerialNumber || !receipts) {
      return res.status(400).send('Nisu prosleđeni podaci o računima');
    }
    if (!uid || !token) {
      return res.status(403).send('Nije prosleđen identifikator korisnika');
    }

    const response = await axios.post(
      wsUrl,
      soapBodyBuilder(
        'UbaciWebQRScanUcitaniRacuni',
        ['sbbaze', 'racuni', 'korisniksk', 'token'],
        [dbSerialNumber, receipts, uid, token]
      ),
      {
        headers: {
          'Content-Type': contentType,
          SOAPAction: getSoapAction('UbaciWebQRScanUcitaniRacuni'),
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
        'UbaciWebQRScanUcitaniRacuniResponse'
      ]?.['UbaciWebQRScanUcitaniRacuniResult'];

    if (!result) {
      return res.status(400).send('Web server nije aktivan');
    }

    if (
      result ===
      'ERROR [HY000] [Sybase][ODBC Driver][SQL Anywhere]User-defined exception signaled'
    ) {
      return res
        .status(400)
        .send(
          'Greška prilikom kreiranja računa. Proverite serijski broj baze.'
        );
    }

    return res.status(201).json({ receipts: String(result) });
  } catch (error) {
    return res.status(500).send('Greška prilikom kreiranja računa');
  }
};
