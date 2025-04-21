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

export const getWebServerDateTime = async (_req, res) => {
  try {
    const response = await axios.post(
      wsUrl,
      soapBodyBuilder('DatumVremeWebServera'),
      {
        headers: {
          'Content-Type': contentType,
          SOAPAction: getSoapAction('DatumVremeWebServera'),
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
        'DatumVremeWebServeraResponse'
      ]?.['DatumVremeWebServeraResult'];

    if (!result) {
      return res.status(404).send('Web server nije aktivan');
    }

    return res.status(200).json({ dateTime: result });
  } catch (error) {
    return res
      .status(500)
      .send('Greška prilikom povlačenja datuma i vremena web servisa');
  }
};

export const getDBServerDateTime = async (_req, res) => {
  try {
    const response = await axios.post(
      wsUrl,
      soapBodyBuilder('DatumVremeDBServera'),
      {
        headers: {
          'Content-Type': contentType,
          SOAPAction: getSoapAction('DatumVremeDBServera'),
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
        'DatumVremeDBServeraResponse'
      ]?.['DatumVremeDBServeraResult'];

    if (!result) {
      return res.status(404).send('DB server nije aktivan');
    }

    return res.status(200).json({ dateTime: result });
  } catch (error) {
    return res
      .status(500)
      .send('Greška prilikom povlačenja datuma i vremena DB servisa');
  }
};
