import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';

import {
  getAccessTokenRoute as zohoAccessTokenRoute,
  getZohoAccessToken,
  normalizeSortOrder,
  toPositiveInt,
  toZohoTimestamp,
  zohoRequest,
} from '../utils/zoho.js';
import { ensureRequester } from '../utils/sdpRequester.js';

/**
 * @route   GET /api/zoho/access-token
 * @desc    Generiše i vraća novi Zoho access token
 * @name    getAccessTokenRoute
 */
export const getAccessTokenRoute = zohoAccessTokenRoute;

/**
 * @route   GET /api/zoho/requests
 * @desc    Povlači listu Zoho SDP zahteva uz paginaciju, sortiranje i osnovne filtere
 * @name    getZohoRequests
 * @param   {number} req.query.page - Broj stranice
 * @param   {number} req.query.perPage - Broj zahteva po stranici
 * @param   {number} req.query.startIndex - Početni indeks za Zoho list_info
 * @param   {string} req.query.sortField - Polje po kom se sortira
 * @param   {string} req.query.sortOrder - Redosled sortiranja: asc ili desc
 * @param   {string} req.query.status - Interni naziv statusa zahteva
 * @param   {string} req.query.group - Naziv grupe zahteva
 * @param   {string} req.query.createdAfter - Datum od kog se povlače zahtevi, format YYYY-MM-DD
 * @param   {string} req.query.createdBefore - Datum do kog se povlače zahtevi, format YYYY-MM-DD
 */
export const getZohoRequests = async (req, res) => {
  try {
    const token = await getZohoAccessToken();

    const page = toPositiveInt(req.query.page, 1);
    const perPage = Math.min(toPositiveInt(req.query.perPage, 10), 100);
    const startIndex = toPositiveInt(
      req.query.startIndex,
      (page - 1) * perPage + 1,
    );

    const sortField = String(req.query.sortField || 'created_time').trim();
    const sortOrder = normalizeSortOrder(req.query.sortOrder);

    const status = String(req.query.status || '').trim();
    const group = String(req.query.group || '').trim();

    const createdAfterRaw = String(req.query.createdAfter || '').trim();
    const createdBeforeRaw = String(req.query.createdBefore || '').trim();

    const createdAfter = toZohoTimestamp(createdAfterRaw, false);
    const createdBefore = toZohoTimestamp(createdBeforeRaw, true);

    if (createdAfterRaw && !createdAfter) {
      return res.status(400).json({
        error: 'createdAfter mora biti validan datum u formatu YYYY-MM-DD',
        received: createdAfterRaw,
      });
    }

    if (createdBeforeRaw && !createdBefore) {
      return res.status(400).json({
        error: 'createdBefore mora biti validan datum u formatu YYYY-MM-DD',
        received: createdBeforeRaw,
      });
    }

    const searchCriteria = [];

    if (status) {
      searchCriteria.push({
        field: 'status.internal_name',
        condition: 'is',
        values: [status],
      });
    }

    if (group) {
      searchCriteria.push({
        field: 'group.name',
        condition: 'is',
        logical_operator: searchCriteria.length ? 'and' : undefined,
        values: [group],
      });
    }

    if (createdAfter) {
      searchCriteria.push({
        field: 'created_time',
        condition: 'greater than',
        value: createdAfter,
      });
    }

    if (createdBefore) {
      searchCriteria.push({
        field: 'created_time',
        condition: 'lesser than',
        logical_operator: searchCriteria.length ? 'and' : undefined,
        value: createdBefore,
      });
    }

    const listInfo = {
      row_count: perPage,
      start_index: startIndex,
      sort_field: sortField,
      sort_order: sortOrder,
    };

    if (searchCriteria.length === 1) {
      listInfo.search_criteria = searchCriteria[0];
    } else if (searchCriteria.length > 1) {
      listInfo.search_criteria = searchCriteria;
    }

    const inputData = { list_info: listInfo };

    const resp = await zohoRequest({
      method: 'get',
      endpoint: '/requests',
      token,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      params: {
        input_data: JSON.stringify(inputData),
      },
    });

    if (resp.status < 200 || resp.status >= 300) {
      return res.status(502).json({
        error: 'Fetching requests failed',
        zoho_http_status: resp.status,
        zoho_response: resp.data,
        sent_input_data: inputData,
      });
    }

    return res.json({
      status: 'success',
      pagination: {
        page,
        perPage,
        startIndex,
        hasMoreRows: resp.data?.list_info?.has_more_rows ?? false,
        zoho_list_info: resp.data?.list_info ?? null,
      },
      filters: {
        status: status || null,
        group: group || null,
        createdAfter: createdAfter || null,
        createdBefore: createdBefore || null,
      },
      data: resp.data?.requests ?? [],
      raw: resp.data,
    });
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
 * @route   GET /api/zoho/requests/:requestId/tasks
 * @desc    Povlači taskove za konkretan Zoho SDP zahtev
 * @name    getZohoRequestTasks
 * @param   {string} req.params.requestId - ID Zoho SDP zahteva
 * @param   {number} req.query.page - Broj stranice
 * @param   {number} req.query.perPage - Broj taskova po stranici
 * @param   {number} req.query.startIndex - Početni indeks za Zoho list_info
 * @param   {string} req.query.sortField - Polje po kom se sortira
 * @param   {string} req.query.sortOrder - Redosled sortiranja: asc ili desc
 */
export const getZohoRequestTasks = async (req, res) => {
  try {
    const token = await getZohoAccessToken();

    const requestId = String(req.params.requestId || '').trim();

    if (!requestId) {
      return res.status(400).json({
        error: 'requestId je obavezan',
      });
    }

    if (!process.env.ZOHO_PORTAL_BASE_URL) {
      return res.status(500).json({
        error: 'ZOHO_PORTAL_BASE_URL nije podešen u .env fajlu',
      });
    }

    const page = toPositiveInt(req.query.page, 1);
    const perPage = Math.min(toPositiveInt(req.query.perPage, 100), 100);
    const startIndex = toPositiveInt(
      req.query.startIndex,
      (page - 1) * perPage + 1,
    );

    const sortField = String(req.query.sortField || 'created_time').trim();
    const sortOrder = normalizeSortOrder(req.query.sortOrder);

    const inputData = {
      list_info: {
        row_count: perPage,
        start_index: startIndex,
        sort_field: sortField,
        sort_order: sortOrder,
      },
    };

    const endpoint = `/requests/${requestId}/tasks`;

    const resp = await zohoRequest({
      method: 'get',
      endpoint,
      token,
      usePortalBaseUrl: true,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      params: {
        input_data: JSON.stringify(inputData),
      },
    });

    if (resp.status < 200 || resp.status >= 300) {
      return res.status(502).json({
        error: 'Fetching request tasks failed',
        zoho_http_status: resp.status,
        zoho_response: resp.data,
        sent_input_data: inputData,
        requestId,
        zoho_url: `${process.env.ZOHO_PORTAL_BASE_URL}${endpoint}`,
      });
    }

    return res.json({
      status: 'success',
      requestId,
      pagination: {
        page,
        perPage,
        startIndex,
        hasMoreRows: resp.data?.list_info?.has_more_rows ?? false,
        zoho_list_info: resp.data?.list_info ?? null,
      },
      count: Array.isArray(resp.data?.tasks) ? resp.data.tasks.length : 0,
      data: resp.data?.tasks ?? [],
      raw: resp.data,
    });
  } catch (e) {
    return res.status(500).json({
      error: 'Fetching request tasks failed',
      message: e?.message,
      zoho: e?.response?.data,
      status: e?.response?.status,
    });
  }
};

/**
 * @route   GET /api/zoho/requests/:requestId/tasks/:taskId/worklogs
 * @desc    Povlači worklogove za konkretan task u okviru Zoho SDP zahteva
 * @name    getZohoRequestWorklogs
 * @param   {string} req.params.requestId - ID Zoho SDP zahteva
 * @param   {string} req.params.taskId - ID taska u okviru zahteva
 */
export const getZohoRequestWorklogs = async (req, res) => {
  try {
    const token = await getZohoAccessToken();

    const requestId = String(req.params.requestId || '').trim();
    const taskId = String(req.params.taskId || '').trim();

    if (!requestId || !taskId) {
      return res.status(400).json({
        error: 'requestId i taskId su obavezni',
      });
    }

    if (!process.env.ZOHO_PORTAL_BASE_URL) {
      return res.status(500).json({
        error: 'ZOHO_PORTAL_BASE_URL nije podešen u .env fajlu',
      });
    }

    const endpoint = `/requests/${requestId}/tasks/${taskId}/worklogs`;

    const resp = await zohoRequest({
      method: 'get',
      endpoint,
      token,
      usePortalBaseUrl: true,
    });

    if (resp.status < 200 || resp.status >= 300) {
      return res.status(502).json({
        error: 'Fetching worklogs failed',
        zoho_http_status: resp.status,
        zoho_response: resp.data,
        requestId,
        taskId,
        zoho_url: `${process.env.ZOHO_PORTAL_BASE_URL}${endpoint}`,
      });
    }

    return res.json({
      status: 'success',
      requestId,
      taskId,
      count: Array.isArray(resp.data?.worklogs) ? resp.data.worklogs.length : 0,
      data: resp.data?.worklogs ?? [],
      raw: resp.data,
    });
  } catch (e) {
    return res.status(500).json({
      error: 'Fetching worklogs failed',
      message: e?.message,
      zoho: e?.response?.data,
      status: e?.response?.status,
    });
  }
};

/**
 * @route   POST /api/zoho/requests
 * @desc    Kreira novi Zoho SDP zahtev i opciono dodaje attachment fajlove
 * @name    createZohoRequest
 * @param   {string} req.body.subject - Naslov zahteva
 * @param   {string} req.body.description - Opis zahteva
 * @param   {string} req.body.priority - Prioritet zahteva
 * @param   {object} req.body.requester - Podaci o requester-u
 * @param   {string} req.body.requester.email - Email requester-a
 * @param   {string} req.body.requester.name - Ime requester-a
 * @param   {string} req.body.requester.phone - Telefon requester-a
 * @param   {string} req.body.requester.company - Kompanija requester-a
 * @param   {Array} req.body.attachments - Lista attachment fajlova
 * @param   {string} req.body.attachments[].filename - Naziv fajla
 * @param   {string} req.body.attachments[].contentType - MIME tip fajla
 * @param   {string} req.body.attachments[].dataBase64 - Base64 sadržaj fajla
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

    const createResp = await zohoRequest({
      method: 'post',
      endpoint: '/requests',
      token,
      data: {
        input_data: JSON.stringify(requestPayload),
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

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
          a?.contentType ?? 'application/octet-stream',
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
            },
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
