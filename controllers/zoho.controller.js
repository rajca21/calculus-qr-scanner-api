import axios from 'axios';

import { getZohoAccessToken } from '../utils/zoho.js';
import { ensureRequester } from '../utils/sdpRequester.js';

export const getAccessTokenRoute = async (req, res) => {
  try {
    const token = await getZohoAccessToken();
    return res.json({ access_token: token });
  } catch (e) {
    return res.status(500).json({
      error: 'Token generation failed',
      message: e?.message,
    });
  }
};

export const getZohoRequests = async (req, res) => {
  try {
    const token = await getZohoAccessToken();

    const resp = await axios.get(`${process.env.ZOHO_BASE_URL}/requests`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        Accept: 'application/vnd.manageengine.sdp.v3+json',
      },
    });

    return res.json(resp.data);
  } catch (e) {
    return res.status(500).json({
      error: 'Fetching requests failed',
      message: e?.message,
    });
  }
};

/**
 * POST /api/zoho/requests
 *
 * {
 *   "subject": "...",
 *   "description": "...",
 *   "priority": "...",
 *   "requester": { "email": "...", "name": "...", "phone": "...", "company": "..." },
 *   "attachments": []
 * }
 */
export const createZohoRequest = async (req, res) => {
  try {
    const token = await getZohoAccessToken();

    const subject = String(req.body?.subject || '').trim();
    const description = String(req.body?.description || '');
    const priority = String(req.body?.priority || '').trim();

    const requester = req.body?.requester || {};
    const email = String(requester.email || '').trim();
    const name = String(requester.name || email).trim();
    const phone = String(requester.phone || '').trim();
    const company = String(requester.company || '').trim();

    if (!subject || !email || !priority) {
      return res.status(400).json({
        error: 'subject, requester.email i priority su obavezni',
        received: { subject, email, priority },
      });
    }

    const ensured = await ensureRequester({
      token,
      name,
      email,
      phone,
      company,
    });

    if (!ensured.id) {
      return res.status(409).json({
        error: 'Requester ne postoji i nije mogao biti kreiran',
        debug: ensured.error,
      });
    }

    const requestPayload = {
      request: {
        subject,
        description: description
          ? `<p>${description}</p>`
          : '<p>No description</p>',
        requester: { id: ensured.id },
        priority: { name: priority },
      },
    };

    const createResp = await axios.post(
      `${process.env.ZOHO_BASE_URL}/requests`,
      { input_data: JSON.stringify(requestPayload) },
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          Accept: 'application/vnd.manageengine.sdp.v3+json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        validateStatus: () => true,
      }
    );

    if (createResp.status < 200 || createResp.status >= 300) {
      return res.status(502).json({
        error: 'Zoho create request failed',
        zoho_http_status: createResp.status,
        zoho_response: createResp.data,
        sent_requestPayload: requestPayload,
      });
    }

    return res.json({
      status: 'success',
      requester_created: !ensured.existing,
      requester_id: ensured.id,
      request: createResp.data.request,
    });
  } catch (e) {
    return res.status(500).json({
      error: 'Create request failed',
      message: e?.message,
      zoho: e?.response?.data,
      status: e?.response?.status,
    });
  }
};
