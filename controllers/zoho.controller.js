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
  ALLOWED_REPORT_GROUPS,
  getThisMonthRange,
  fetchRequestsReportPage,
  mapRequestToExportRow,
  buildRequestsSearchCriteria,
  enrichRequestsWithDetails,
  TASK_WORKLOG_REPORT_COLUMNS,
  buildTaskWorklogReportRowsForRequests,
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

/**
 * @route   GET /api/zoho/reports/requests-export
 * @desc    Report/export Zoho SDP zahteva sa izabranim kolonama
 * @name    getZohoRequestsExportReport
 * @param   {string} req.query.createdAfter - Datum od kog se povlače zahtevi, format YYYY-MM-DD
 * @param   {string} req.query.createdBefore - Datum do kog se povlače zahtevi, format YYYY-MM-DD
 * @param   {string} req.query.period - Custom period, trenutno podržano: this_month
 * @param   {string} req.query.group - Filter po grupi: Tehnička podrška, Proizvodnja ili Prodaja
 * @param   {number} req.query.page - Broj stranice
 * @param   {number} req.query.perPage - Broj zahteva po stranici
 * @param   {number} req.query.startIndex - Početni indeks za Zoho list_info
 * @param   {string} req.query.sortField - Polje za sortiranje
 * @param   {string} req.query.sortOrder - Redosled sortiranja: asc ili desc
 * @param   {boolean} req.query.all - Ako je true, povlači sve strane za zadati period/filter
 * @param   {number} req.query.maxPages - Maksimalan broj strana kada je all=true
 * @param   {boolean} req.query.debug - Ako je true, ispisuje detaljne logove
 */
export const getZohoRequestsExportReport = async (req, res) => {
  try {
    const token = await getZohoAccessToken();

    const debug =
      String(req.query.debug || '')
        .trim()
        .toLowerCase() === 'true';

    const startedAt = Date.now();

    const period = String(req.query.period || '')
      .trim()
      .toLowerCase();

    const all =
      String(req.query.all || '')
        .trim()
        .toLowerCase() === 'true';

    let createdAfterRaw = String(req.query.createdAfter || '').trim();
    let createdBeforeRaw = String(req.query.createdBefore || '').trim();

    if (period && period !== 'this_month') {
      return res.status(400).json({
        error: 'Nepodržan period. Trenutno je podržano samo: this_month',
        received: period,
      });
    }

    if (period === 'this_month') {
      const range = getThisMonthRange();

      createdAfterRaw = range.createdAfterRaw;
      createdBeforeRaw = range.createdBeforeRaw;
    }

    if (!createdAfterRaw || !createdBeforeRaw) {
      return res.status(400).json({
        error:
          'createdAfter i createdBefore su obavezni, osim ako se pošalje period=this_month',
        example:
          '/api/zoho/reports/requests-export?createdAfter=2026-04-01&createdBefore=2026-04-30',
      });
    }

    const createdAfter = toZohoTimestamp(createdAfterRaw, false);
    const createdBefore = toZohoTimestamp(createdBeforeRaw, true);

    if (!createdAfter) {
      return res.status(400).json({
        error: 'createdAfter mora biti validan datum u formatu YYYY-MM-DD',
        received: createdAfterRaw,
      });
    }

    if (!createdBefore) {
      return res.status(400).json({
        error: 'createdBefore mora biti validan datum u formatu YYYY-MM-DD',
        received: createdBeforeRaw,
      });
    }

    const group = String(req.query.group || '').trim();

    if (group && !ALLOWED_REPORT_GROUPS.includes(group)) {
      return res.status(400).json({
        error: 'Nepodržana grupa',
        allowed_groups: ALLOWED_REPORT_GROUPS,
        received: group,
      });
    }

    const page = toPositiveInt(req.query.page, 1);
    const perPage = Math.min(toPositiveInt(req.query.perPage, 100), 100);
    const sortField = String(req.query.sortField || 'created_time').trim();
    const sortOrder = normalizeSortOrder(req.query.sortOrder);

    const columns = [
      'Group',
      'Technician',
      'Site',
      'Subject',
      'RequestID',
      'Created Time',
      'Completed Time',
      'Rezime zahteva',
      'Rezime rešenja',
      'Korisnik',
    ];

    if (debug) {
      console.log('[ZOHO REPORT] START', {
        all,
        period: period || null,
        createdAfterRaw,
        createdBeforeRaw,
        createdAfter,
        createdBefore,
        group: group || null,
        page,
        perPage,
        sortField,
        sortOrder,
      });
    }

    if (!all) {
      const startIndex = toPositiveInt(
        req.query.startIndex,
        (page - 1) * perPage + 1,
      );

      const { resp, inputData } = await fetchRequestsReportPage({
        token,
        page,
        perPage,
        startIndex,
        sortField,
        sortOrder,
        group,
        createdAfter,
        createdBefore,
        debug,
      });

      if (resp.status < 200 || resp.status >= 300) {
        return res.status(502).json({
          error: 'Fetching requests export report failed',
          zoho_http_status: resp.status,
          zoho_response: resp.data,
          sent_input_data: inputData,
        });
      }

      const requests = resp.data?.requests ?? [];

      if (debug) {
        console.log('[ZOHO REPORT] Paged list fetched', {
          requestsCount: requests.length,
          hasMoreRows: resp.data?.list_info?.has_more_rows,
        });
      }

      const enrichedRequests = await enrichRequestsWithDetails({
        token,
        requests,
        debug,
      });

      const rows = enrichedRequests.map(mapRequestToExportRow);

      if (debug) {
        console.log('[ZOHO REPORT] END PAGED', {
          rowsCount: rows.length,
          elapsedMs: Date.now() - startedAt,
        });
      }

      return res.json({
        status: 'success',
        report: 'requests_export',
        mode: 'paged',
        filters: {
          period: period || null,
          createdAfter: createdAfterRaw,
          createdBefore: createdBeforeRaw,
          group: group || null,
        },
        pagination: {
          page,
          perPage,
          startIndex,
          hasMoreRows: resp.data?.list_info?.has_more_rows ?? false,
          zoho_list_info: resp.data?.list_info ?? null,
        },
        columns,
        count: rows.length,
        data: rows,
        raw_count: requests.length,
      });
    }

    const allRows = [];
    const rawRequestsCountByPage = [];
    let currentStartIndex = 1;
    let currentPage = 1;
    let hasMoreRows = true;
    let lastInputData = null;

    const maxPages = Math.min(toPositiveInt(req.query.maxPages, 200), 500);

    if (debug) {
      console.log('[ZOHO REPORT] ALL mode loop START', {
        maxPages,
      });
    }

    while (hasMoreRows && currentPage <= maxPages) {
      if (debug) {
        console.log('[ZOHO REPORT] ALL page loop BEFORE fetch', {
          currentPage,
          currentStartIndex,
          perPage,
          totalRowsSoFar: allRows.length,
        });
      }

      const { resp, inputData } = await fetchRequestsReportPage({
        token,
        page: currentPage,
        perPage,
        startIndex: currentStartIndex,
        sortField,
        sortOrder,
        group,
        createdAfter,
        createdBefore,
        debug,
      });

      lastInputData = inputData;

      if (resp.status < 200 || resp.status >= 300) {
        return res.status(502).json({
          error: 'Fetching all requests export report failed',
          failed_page: currentPage,
          failed_start_index: currentStartIndex,
          zoho_http_status: resp.status,
          zoho_response: resp.data,
          sent_input_data: inputData,
          collected_rows: allRows.length,
        });
      }

      const requests = resp.data?.requests ?? [];

      if (debug) {
        console.log('[ZOHO REPORT] ALL page list fetched', {
          currentPage,
          currentStartIndex,
          requestsCount: requests.length,
          hasMoreRowsFromZoho: resp.data?.list_info?.has_more_rows,
          zohoRowCount: resp.data?.list_info?.row_count,
        });
      }

      const enrichedRequests = await enrichRequestsWithDetails({
        token,
        requests,
        debug,
      });

      const rows = enrichedRequests.map(mapRequestToExportRow);

      allRows.push(...rows);

      rawRequestsCountByPage.push({
        page: currentPage,
        startIndex: currentStartIndex,
        count: requests.length,
      });

      hasMoreRows = Boolean(resp.data?.list_info?.has_more_rows);

      if (debug) {
        console.log('[ZOHO REPORT] ALL page processed', {
          currentPage,
          rowsAdded: rows.length,
          totalRows: allRows.length,
          hasMoreRows,
        });
      }

      if (!hasMoreRows || requests.length === 0) {
        break;
      }

      const zohoReturnedCount =
        Number(resp.data?.list_info?.row_count) || requests.length || perPage;

      currentStartIndex += zohoReturnedCount;
      currentPage += 1;
    }

    if (debug) {
      console.log('[ZOHO REPORT] END ALL', {
        pagesFetched: rawRequestsCountByPage.length,
        totalRows: allRows.length,
        elapsedMs: Date.now() - startedAt,
        stoppedByMaxPages: hasMoreRows && currentPage > maxPages,
      });
    }

    return res.json({
      status: 'success',
      report: 'requests_export',
      mode: 'all',
      filters: {
        period: period || null,
        createdAfter: createdAfterRaw,
        createdBefore: createdBeforeRaw,
        group: group || null,
      },
      pagination: {
        perPage,
        pagesFetched: rawRequestsCountByPage.length,
        lastStartIndex: currentStartIndex,
        hasMoreRows,
        stoppedByMaxPages: hasMoreRows && currentPage > maxPages,
        maxPages,
      },
      columns,
      count: allRows.length,
      data: allRows,
      debug: {
        pages: rawRequestsCountByPage,
        last_sent_input_data: lastInputData,
      },
    });
  } catch (e) {
    console.error('[ZOHO REPORT] ERROR', {
      message: e?.message,
      status: e?.response?.status,
      zoho: e?.response?.data,
      stack: e?.stack,
    });

    return res.status(500).json({
      error: 'Requests export report failed',
      message: e?.message,
      zoho: e?.response?.data,
      status: e?.response?.status,
    });
  }
};

/**
 * @route   GET /api/zoho/reports/task-worklogs-export
 * @desc    Report/export Zoho SDP worklogova kroz requeste i taskove
 * @name    getZohoTaskWorklogsExportReport
 * @param   {string} req.query.createdAfter - Datum od kog se povlače zahtevi, format YYYY-MM-DD
 * @param   {string} req.query.createdBefore - Datum do kog se povlače zahtevi, format YYYY-MM-DD
 * @param   {string} req.query.period - Custom period, trenutno podržano: this_month
 * @param   {string} req.query.group - Filter po grupi: Tehnička podrška, Proizvodnja ili Prodaja
 * @param   {number} req.query.page - Broj stranice zahteva
 * @param   {number} req.query.perPage - Broj zahteva po stranici
 * @param   {number} req.query.startIndex - Početni indeks za request list_info
 * @param   {string} req.query.sortField - Polje za sortiranje requestova
 * @param   {string} req.query.sortOrder - Redosled sortiranja: asc ili desc
 * @param   {boolean} req.query.all - Ako je true, povlači sve request strane za zadati period/filter
 * @param   {number} req.query.maxPages - Maksimalan broj request strana kada je all=true
 * @param   {number} req.query.taskMaxPages - Maksimalan broj task strana po requestu
 * @param   {number} req.query.worklogMaxPages - Maksimalan broj worklog strana po tasku
 * @param   {boolean} req.query.debug - Ako je true, ispisuje detaljne logove
 */
export const getZohoTaskWorklogsExportReport = async (req, res) => {
  try {
    const token = await getZohoAccessToken();

    const debug =
      String(req.query.debug || '')
        .trim()
        .toLowerCase() === 'true';

    const startedAt = Date.now();

    const period = String(req.query.period || '')
      .trim()
      .toLowerCase();

    const all =
      String(req.query.all || '')
        .trim()
        .toLowerCase() === 'true';

    let createdAfterRaw = String(req.query.createdAfter || '').trim();
    let createdBeforeRaw = String(req.query.createdBefore || '').trim();

    if (period && period !== 'this_month') {
      return res.status(400).json({
        error: 'Nepodržan period. Trenutno je podržano samo: this_month',
        received: period,
      });
    }

    if (period === 'this_month') {
      const range = getThisMonthRange();

      createdAfterRaw = range.createdAfterRaw;
      createdBeforeRaw = range.createdBeforeRaw;
    }

    if (!createdAfterRaw || !createdBeforeRaw) {
      return res.status(400).json({
        error:
          'createdAfter i createdBefore su obavezni, osim ako se pošalje period=this_month',
        example:
          '/api/zoho/reports/task-worklogs-export?createdAfter=2026-04-01&createdBefore=2026-04-30',
      });
    }

    const createdAfter = toZohoTimestamp(createdAfterRaw, false);
    const createdBefore = toZohoTimestamp(createdBeforeRaw, true);

    if (!createdAfter) {
      return res.status(400).json({
        error: 'createdAfter mora biti validan datum u formatu YYYY-MM-DD',
        received: createdAfterRaw,
      });
    }

    if (!createdBefore) {
      return res.status(400).json({
        error: 'createdBefore mora biti validan datum u formatu YYYY-MM-DD',
        received: createdBeforeRaw,
      });
    }

    const group = String(req.query.group || '').trim();

    if (group && !ALLOWED_REPORT_GROUPS.includes(group)) {
      return res.status(400).json({
        error: 'Nepodržana grupa',
        allowed_groups: ALLOWED_REPORT_GROUPS,
        received: group,
      });
    }

    const page = toPositiveInt(req.query.page, 1);
    const perPage = Math.min(toPositiveInt(req.query.perPage, 100), 100);
    const sortField = String(req.query.sortField || 'created_time').trim();
    const sortOrder = normalizeSortOrder(req.query.sortOrder);

    const taskMaxPages = Math.min(
      toPositiveInt(req.query.taskMaxPages, 50),
      200,
    );

    const worklogMaxPages = Math.min(
      toPositiveInt(req.query.worklogMaxPages, 50),
      200,
    );

    if (debug) {
      console.log('[ZOHO TASK-WORKLOG REPORT] START', {
        all,
        period: period || null,
        createdAfterRaw,
        createdBeforeRaw,
        group: group || null,
        page,
        perPage,
        sortField,
        sortOrder,
        taskMaxPages,
        worklogMaxPages,
      });
    }

    if (!all) {
      const startIndex = toPositiveInt(
        req.query.startIndex,
        (page - 1) * perPage + 1,
      );

      const { resp, inputData } = await fetchRequestsReportPage({
        token,
        page,
        perPage,
        startIndex,
        sortField,
        sortOrder,
        group,
        createdAfter,
        createdBefore,
        debug,
      });

      if (resp.status < 200 || resp.status >= 300) {
        return res.status(502).json({
          error: 'Fetching task worklogs export report failed',
          zoho_http_status: resp.status,
          zoho_response: resp.data,
          sent_input_data: inputData,
        });
      }

      const requests = resp.data?.requests ?? [];
      const enrichedRequests = await enrichRequestsWithDetails({
        token,
        requests,
        debug,
      });

      const { rows, debugSummary } =
        await buildTaskWorklogReportRowsForRequests({
          token,
          requests: enrichedRequests,
          taskMaxPages,
          worklogMaxPages,
          debug,
        });

      return res.json({
        status: 'success',
        report: 'task_worklogs_export',
        mode: 'paged',
        filters: {
          period: period || null,
          createdAfter: createdAfterRaw,
          createdBefore: createdBeforeRaw,
          group: group || null,
        },
        pagination: {
          page,
          perPage,
          startIndex,
          hasMoreRows: resp.data?.list_info?.has_more_rows ?? false,
          zoho_list_info: resp.data?.list_info ?? null,
        },
        columns: TASK_WORKLOG_REPORT_COLUMNS,
        count: rows.length,
        data: rows,
        raw_request_count: requests.length,
        debug: {
          elapsedMs: Date.now() - startedAt,
          summary: debugSummary,
        },
      });
    }

    const allRows = [];
    const rawRequestsCountByPage = [];
    const allDebugSummary = [];

    let currentStartIndex = 1;
    let currentPage = 1;
    let hasMoreRows = true;
    let lastInputData = null;

    const maxPages = Math.min(toPositiveInt(req.query.maxPages, 200), 500);

    while (hasMoreRows && currentPage <= maxPages) {
      if (debug) {
        console.log('[ZOHO TASK-WORKLOG REPORT] Request page START', {
          currentPage,
          currentStartIndex,
          rowsSoFar: allRows.length,
        });
      }

      const { resp, inputData } = await fetchRequestsReportPage({
        token,
        page: currentPage,
        perPage,
        startIndex: currentStartIndex,
        sortField,
        sortOrder,
        group,
        createdAfter,
        createdBefore,
        debug,
      });

      lastInputData = inputData;

      if (resp.status < 200 || resp.status >= 300) {
        return res.status(502).json({
          error: 'Fetching all task worklogs export report failed',
          failed_page: currentPage,
          failed_start_index: currentStartIndex,
          zoho_http_status: resp.status,
          zoho_response: resp.data,
          sent_input_data: inputData,
          collected_rows: allRows.length,
        });
      }

      const requests = resp.data?.requests ?? [];
      const enrichedRequests = await enrichRequestsWithDetails({
        token,
        requests,
        debug,
      });

      const { rows, debugSummary } =
        await buildTaskWorklogReportRowsForRequests({
          token,
          requests: enrichedRequests,
          taskMaxPages,
          worklogMaxPages,
          debug,
        });

      allRows.push(...rows);
      allDebugSummary.push(...debugSummary);

      rawRequestsCountByPage.push({
        page: currentPage,
        startIndex: currentStartIndex,
        count: requests.length,
        rowsAdded: rows.length,
      });

      hasMoreRows = Boolean(resp.data?.list_info?.has_more_rows);

      if (debug) {
        console.log('[ZOHO TASK-WORKLOG REPORT] Request page END', {
          currentPage,
          currentStartIndex,
          requestsCount: requests.length,
          rowsAdded: rows.length,
          totalRows: allRows.length,
          hasMoreRows,
        });
      }

      if (!hasMoreRows || requests.length === 0) {
        break;
      }

      const zohoReturnedCount =
        Number(resp.data?.list_info?.row_count) || requests.length || perPage;

      currentStartIndex += zohoReturnedCount;
      currentPage += 1;
    }

    return res.json({
      status: 'success',
      report: 'task_worklogs_export',
      mode: 'all',
      filters: {
        period: period || null,
        createdAfter: createdAfterRaw,
        createdBefore: createdBeforeRaw,
        group: group || null,
      },
      pagination: {
        perPage,
        pagesFetched: rawRequestsCountByPage.length,
        lastStartIndex: currentStartIndex,
        hasMoreRows,
        stoppedByMaxPages: hasMoreRows && currentPage > maxPages,
        maxPages,
      },
      columns: TASK_WORKLOG_REPORT_COLUMNS,
      count: allRows.length,
      data: allRows,
      debug: {
        elapsedMs: Date.now() - startedAt,
        pages: rawRequestsCountByPage,
        request_summary: allDebugSummary,
        last_sent_input_data: lastInputData,
      },
    });
  } catch (e) {
    console.error('[ZOHO TASK-WORKLOG REPORT] ERROR', {
      message: e?.message,
      status: e?.response?.status,
      zoho: e?.response?.data,
      stack: e?.stack,
    });

    return res.status(500).json({
      error: 'Task worklogs export report failed',
      message: e?.message,
      zoho: e?.response?.data,
      status: e?.response?.status,
    });
  }
};
