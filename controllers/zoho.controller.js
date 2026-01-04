import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';

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
      validateStatus: () => true,
    });

    if (resp.status < 200 || resp.status >= 300) {
      return res.status(502).json({
        error: 'Fetching requests failed',
        zoho_http_status: resp.status,
        zoho_response: resp.data,
      });
    }

    return res.json(resp.data);
  } catch (e) {
    return res.status(500).json({
      error: 'Fetching requests failed',
      message: e?.message,
      zoho: e?.response?.data,
      status: e?.response?.status,
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
 *   "attachments": [{ "filename": "...", "contentType": "...", "dataBase64": "..." }]
 * }
 */
export const createZohoRequest = async (req, res) => {
  const startedAt = Date.now();

  try {
    console.log('[ZOHO] Incoming JSON request:', {
      contentType: req.headers['content-type'],
      bodyKeys: Object.keys(req.body || {}),
      attachmentsCount: Array.isArray(req.body?.attachments)
        ? req.body.attachments.length
        : 0,
    });

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
      console.error('[ZOHO] Create failed:', {
        httpStatus: createResp.status,
        data: createResp.data,
      });

      return res.status(502).json({
        error: 'Zoho create request failed',
        step: 'create_request',
        zoho_http_status: createResp.status,
        zoho_response: createResp.data,
        sent_requestPayload: requestPayload,
      });
    }

    const requestId = createResp?.data?.request?.id;
    if (!requestId) {
      return res.status(502).json({
        error: 'Zoho did not return request.id',
        step: 'create_request',
        zoho_http_status: createResp.status,
        zoho_response: createResp.data,
      });
    }

    const attachments = Array.isArray(req.body?.attachments)
      ? req.body.attachments
      : [];

    const uploadedFiles = [];
    const uploadErrors = [];

    if (attachments.length > 0) {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (!fsSync.existsSync(uploadsDir)) {
        fsSync.mkdirSync(uploadsDir, { recursive: true });
      }

      for (const a of attachments) {
        const filenameRaw = String(a?.filename ?? 'file.bin');
        const contentType = String(
          a?.contentType ?? 'application/octet-stream'
        );
        const b64 = String(a?.dataBase64 ?? '');

        if (!b64 || b64.trim().length === 0) {
          uploadErrors.push({
            file: filenameRaw,
            error: 'Empty dataBase64',
          });
          continue;
        }

        const safeName = filenameRaw.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
        const tmpName = `${Date.now()}-${crypto
          .randomBytes(6)
          .toString('hex')}-${safeName}`;
        const filePath = path.join(uploadsDir, tmpName);

        try {
          const buffer = Buffer.from(b64, 'base64');
          await fs.writeFile(filePath, buffer);

          const form = new FormData();
          form.append('filename', fsSync.createReadStream(filePath), {
            filename: safeName,
            contentType,
          });
          form.append('addtoattachment', 'true');

          const uploadResp = await axios.post(
            `${process.env.ZOHO_BASE_URL}/requests/${requestId}/_uploads`,
            form,
            {
              headers: {
                Authorization: `Zoho-oauthtoken ${token}`,
                Accept: 'application/vnd.manageengine.sdp.v3+json',
                ...form.getHeaders(),
              },
              maxBodyLength: Infinity,
              validateStatus: () => true,
            }
          );

          if (uploadResp.status < 200 || uploadResp.status >= 300) {
            uploadErrors.push({
              file: safeName,
              zoho_http_status: uploadResp.status,
              zoho_response: uploadResp.data,
            });
          } else {
            uploadedFiles.push(uploadResp.data);
          }
        } catch (e) {
          uploadErrors.push({
            file: safeName,
            exception: e?.message,
            zoho: e?.response?.data,
            status: e?.response?.status,
          });
        } finally {
          try {
            await fs.unlink(filePath);
          } catch {}
        }
      }
    }

    return res.status(200).json({
      status: 'success',
      elapsed_ms: Date.now() - startedAt,
      requester_created: !ensured.existing,
      requester_id: ensured.id,
      request: createResp.data.request,
      attachments: uploadedFiles,
      attachment_errors: uploadErrors.length ? uploadErrors : null,
      debug: {
        received_body_keys: Object.keys(req.body || {}),
        received_attachments: attachments.length,
      },
    });
  } catch (e) {
    console.error('Create Zoho Request Error (catch):', {
      message: e?.message,
      httpStatus: e?.response?.status,
      zohoData: e?.response?.data,
      stack: e?.stack,
    });

    return res.status(500).json({
      error: 'Zoho request creation failed',
      message: e?.message,
      httpStatus: e?.response?.status,
      zoho: e?.response?.data,
    });
  }
};
