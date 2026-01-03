import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getZohoAccessToken, zohoGet } from '../utils/zoho.js';

export const getAccessTokenRoute = async (req, res) => {
  try {
    const token = await getZohoAccessToken();
    return res.json({ access_token: token });
  } catch (error) {
    console.error(
      'Greška pri generisanju access tokena:',
      error?.message || error
    );
    return res.status(500).json({
      error: 'Greška pri generisanju access tokena',
      message: error?.message,
      zoho: error?.response?.data,
    });
  }
};

export const getZohoRequests = async (req, res) => {
  try {
    const data = await zohoGet('/requests');
    return res.json({ requests: data.requests || [] });
  } catch (error) {
    console.error('Greška pri povlačenju tiketa:', error?.message || error);

    return res.status(500).json({
      error: 'Greška pri povlačenju tiketa iz Zoho SDP',
      message: error?.message,
      zoho: error?.response?.data,
      status: error?.response?.status,
    });
  }
};

/**
 * POST /api/zoho/requests
 * JSON:
 * - subject (mandatory)
 * - description
 * - requester_email (mandatory)
 * - priority (mandatory)
 * - attachments: [{ filename, contentType, dataBase64 }]
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

    const subject = (req.body?.subject ?? '').toString();
    const description = (req.body?.description ?? '').toString();
    const requester_email = (req.body?.requester_email ?? '').toString();
    const priority = (req.body?.priority ?? '').toString();

    if (!subject || subject.trim().length === 0) {
      return res.status(400).json({
        error: 'Subject je obavezan',
        hint: 'Pošalji JSON polje "subject".',
        received: { subject },
      });
    }

    if (!requester_email || requester_email.trim().length === 0) {
      return res.status(400).json({
        error: 'Requester email je obavezan',
        hint: 'Pošalji JSON polje "requester_email".',
        received: { requester_email },
      });
    }

    if (!priority || priority.trim().length === 0) {
      return res.status(400).json({
        error: 'Priority je obavezan',
        hint: 'Pošalji JSON polje "priority".',
        received: { priority },
      });
    }

    const requestData = {
      request: {
        subject: subject.trim(),
        description: description
          ? `<p>${description}</p>`
          : '<p>No description</p>',
        requester: { email_id: requester_email.trim() },
        priority: { name: priority.trim() },
      },
    };

    const createResponse = await axios.post(
      `${process.env.ZOHO_BASE_URL}/requests`,
      { input_data: JSON.stringify(requestData) },
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          Accept: 'application/vnd.manageengine.sdp.v3+json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        validateStatus: () => true,
      }
    );

    if (createResponse.status < 200 || createResponse.status >= 300) {
      console.error('[ZOHO] Create failed:', {
        httpStatus: createResponse.status,
        data: createResponse.data,
      });

      return res.status(502).json({
        error: 'Zoho create request failed',
        step: 'create_request',
        zoho_http_status: createResponse.status,
        zoho_response: createResponse.data,
        sent_requestData: requestData,
      });
    }

    const requestId = createResponse?.data?.request?.id;
    if (!requestId) {
      return res.status(502).json({
        error: 'Zoho did not return request.id',
        step: 'create_request',
        zoho_http_status: createResponse.status,
        zoho_response: createResponse.data,
      });
    }

    const attachments = Array.isArray(req.body?.attachments)
      ? req.body.attachments
      : [];
    const uploadedFiles = [];
    const uploadErrors = [];

    if (attachments.length > 0) {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (!fsSync.existsSync(uploadsDir))
        fsSync.mkdirSync(uploadsDir, { recursive: true });

      for (const a of attachments) {
        const filenameRaw = (a?.filename ?? 'file.bin').toString();
        const contentType = (
          a?.contentType ?? 'application/octet-stream'
        ).toString();
        const b64 = (a?.dataBase64 ?? '').toString();

        if (!b64) continue;

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
      request: createResponse.data.request,
      attachments: uploadedFiles,
      attachment_errors: uploadErrors.length ? uploadErrors : null,
      debug: {
        received_body_keys: Object.keys(req.body || {}),
        received_attachments: attachments.length,
      },
    });
  } catch (error) {
    console.error('Create Zoho Request Error (catch):', {
      message: error?.message,
      httpStatus: error?.response?.status,
      zohoData: error?.response?.data,
      stack: error?.stack,
    });

    return res.status(500).json({
      error: 'Zoho request creation failed',
      message: error?.message,
      httpStatus: error?.response?.status,
      zoho: error?.response?.data,
    });
  }
};
