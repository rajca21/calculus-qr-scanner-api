import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs/promises';
import fsSync from 'fs';
import { getZohoAccessToken, zohoGet } from '../utils/zoho.js';

/**
 * @route   GET /api/zoho/access-token
 * @desc    Vrati svež Zoho access token
 */
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

/**
 * @route   GET /api/zoho/requests
 * @desc    Vraća listu tiketa iz Zoho ServiceDesk Plus
 */
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
 * @route   POST /api/zoho/requests
 * @desc    Kreira novi Zoho ServiceDesk Plus request + upload priloga (ako postoje)
 *
 * Očekuje multipart/form-data:
 * - subject (string) [mandatory]
 * - description (string)
 * - requester_email (string)
 * - priority (string)
 * - attachments (file[])  <-- multer: upload.array('attachments', 10)
 */
export const createZohoRequest = async (req, res) => {
  const startedAt = Date.now();

  try {
    console.log('[ZOHO] Incoming request:', {
      contentType: req.headers['content-type'],
      hasFiles: !!req.files?.length,
      filesCount: req.files?.length || 0,
      bodyKeys: Object.keys(req.body || {}),
    });

    if (req.files?.length) {
      console.log(
        '[ZOHO] Files:',
        req.files.map((f) => ({
          fieldname: f.fieldname,
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
          path: f.path,
        }))
      );
    }

    const token = await getZohoAccessToken();

    const subject = (req.body?.subject ?? '').toString();
    const description = (req.body?.description ?? '').toString();
    const requester_email = req.body?.requester_email
      ? req.body.requester_email.toString()
      : '';
    const priority = req.body?.priority ? req.body.priority.toString() : '';

    if (!subject || subject.trim().length === 0) {
      return res.status(400).json({
        error: 'Subject je obavezan',
        hint: 'Pošalji form-data polje "subject".',
        received: { subject },
      });
    }

    const requestData = {
      request: {
        subject: subject.trim(),
        description: description
          ? `<p>${description}</p>`
          : '<p>No description</p>',
      },
    };

    if (requester_email) {
      requestData.request.requester = { email_id: requester_email.trim() };
    }

    if (priority) {
      requestData.request.priority = { name: priority.trim() };
    }

    let createResponse;
    try {
      createResponse = await axios.post(
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
    } catch (e) {
      console.error(
        '[ZOHO] Axios error on create (network/axios):',
        e?.message || e
      );
      throw e;
    }

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
      console.error(
        '[ZOHO] Missing requestId in response:',
        createResponse.data
      );
      return res.status(502).json({
        error: 'Zoho did not return request.id',
        step: 'create_request',
        zoho_http_status: createResponse.status,
        zoho_response: createResponse.data,
      });
    }

    const uploadedFiles = [];
    const uploadErrors = [];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const form = new FormData();
          form.append(
            'filename',
            fsSync.createReadStream(file.path),
            file.originalname
          );
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
            console.error('[ZOHO] Upload failed:', {
              file: file.originalname,
              httpStatus: uploadResp.status,
              data: uploadResp.data,
            });

            uploadErrors.push({
              file: file.originalname,
              zoho_http_status: uploadResp.status,
              zoho_response: uploadResp.data,
            });
          } else {
            uploadedFiles.push(uploadResp.data);
          }
        } catch (e) {
          console.error(
            '[ZOHO] Upload exception:',
            file.originalname,
            e?.message || e
          );
          uploadErrors.push({
            file: file.originalname,
            exception: e?.message,
            zoho: e?.response?.data,
            status: e?.response?.status,
          });
        } finally {
          try {
            await fs.unlink(file.path);
          } catch (delErr) {
            console.warn(
              '[ZOHO] Failed to delete temp file:',
              file.path,
              delErr?.message || delErr
            );
          }
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
        received_files: req.files?.length || 0,
        received_body_keys: Object.keys(req.body || {}),
      },
    });
  } catch (error) {
    const isAxios = !!error?.isAxiosError;
    const httpStatus = error?.response?.status;
    const zohoData = error?.response?.data;

    console.error('Create Zoho Request Error (catch):', {
      message: error?.message,
      isAxios,
      httpStatus,
      zohoData,
      stack: error?.stack,
    });

    return res.status(500).json({
      error: 'Zoho request creation failed',
      message: error?.message,
      isAxios,
      httpStatus,
      zoho: zohoData,
      stack: error?.stack,
    });
  }
};
