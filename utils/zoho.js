import axios from 'axios';

/**
 * Generiše novi Zoho access token koristeći refresh token
 */
export const getZohoAccessToken = async () => {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
  });

  const resp = await axios.post(
    'https://accounts.zoho.com/oauth/v2/token',
    params.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
  );

  return resp.data.access_token;
};

/**
 * Generiše i vraća novi Zoho access token
 */
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

/**
 * Konvertuje vrednost u pozitivan ceo broj ili vraća fallback vrednost
 */
export function toPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Konvertuje datum u Zoho timestamp
 */
export function toZohoTimestamp(dateStr, endOfDay = false) {
  if (!dateStr) return null;

  const normalized = String(dateStr).trim();

  const iso = endOfDay
    ? `${normalized}T23:59:59.999`
    : `${normalized}T00:00:00.000`;

  const ms = new Date(iso).getTime();

  return Number.isNaN(ms) ? null : String(ms);
}

/**
 * Normalizuje redosled sortiranja
 */
export function normalizeSortOrder(value) {
  return String(value || '').toLowerCase() === 'asc' ? 'asc' : 'desc';
}

/**
 * Univerzalni wrapper za SDP API pozive
 */
export const zohoRequest = async ({
  method = 'get',
  endpoint,
  token,
  data,
  params,
  headers = {},
  usePortalBaseUrl = false,
}) => {
  const baseUrl = usePortalBaseUrl
    ? process.env.ZOHO_PORTAL_BASE_URL
    : process.env.ZOHO_BASE_URL;

  return axios({
    method,
    url: `${baseUrl}${endpoint}`,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept: 'application/vnd.manageengine.sdp.v3+json',
      ...headers,
    },
    data,
    params,
    validateStatus: () => true,
    maxBodyLength: Infinity,
  });
};

// **** REPORTS ****

export function debugLog(enabled, label, payload = null) {
  if (!enabled) return;

  if (payload !== null) {
    console.log(label, payload);
  } else {
    console.log(label);
  }
}

export const ALLOWED_REPORT_GROUPS = [
  'Tehnička podrška',
  'Proizvodnja',
  'Prodaja',
];

export const REQUEST_ADDITIONAL_FIELD_KEYS = {
  bazaIPodaciSuNa: 'udf_char3',
  brojRacunara: 'udf_long1',
  datumUgovora: 'udf_date1',
  email: 'udf_char7',
  firma: 'udf_ref1',
  knjigAgencija: 'udf_char8',
  korisnik: 'udf_ref2',
  korisnikImaStampu: 'udf_char4',
  pibIliMb: 'udf_char6',
  planRealTaskovaDo: 'udf_date4',
  planRealTiketaDo: 'udf_date3',
  pridruzeniTehnicar: 'udf_char5',
  pridruzeniTehnicari: 'udf_char2',
  rezimeResenja: 'udf_char11',
  rezimeZahteva: 'udf_char10',
  vremeZakazivanja: 'udf_char1',
  zakazano: 'udf_date2',
};

export const REQUEST_EXPORT_ADDITIONAL_FIELDS = {
  rezimeZahteva: {
    label: 'Rezime zahteva',
    key: REQUEST_ADDITIONAL_FIELD_KEYS.rezimeZahteva,
  },
  rezimeResenja: {
    label: 'Rezime rešenja',
    key: REQUEST_ADDITIONAL_FIELD_KEYS.rezimeResenja,
  },
  korisnik: {
    label: 'Korisnik',
    key: REQUEST_ADDITIONAL_FIELD_KEYS.korisnik,
  },
};

/**
 * Formatira datum u format YYYY-MM-DD
 */
export function formatDateToYMD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Vraća opseg datuma za trenutni mesec
 */
export function getThisMonthRange() {
  const now = new Date();

  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    createdAfterRaw: formatDateToYMD(firstDay),
    createdBeforeRaw: formatDateToYMD(lastDay),
  };
}

/**
 * Vraća display vrednost iz Zoho vrednosti
 */
export function extractZohoDisplayValue(value) {
  if (value === null || value === undefined) return '';

  if (Array.isArray(value)) {
    return value
      .map((item) => extractZohoDisplayValue(item))
      .filter(Boolean)
      .join(', ');
  }

  if (typeof value === 'object') {
    return (
      value.display_value ||
      value.name ||
      value.value ||
      value.email_id ||
      value.id ||
      ''
    );
  }

  return value;
}

/**
 * Vraća vrednost iz objekta koristeći moguće ključeve
 */
export function getValueFromObjectByPossibleKeys(source, possibleKeys) {
  if (!source || typeof source !== 'object') return '';

  for (const key of possibleKeys) {
    if (source[key] !== undefined && source[key] !== null) {
      return extractZohoDisplayValue(source[key]);
    }
  }

  return '';
}

/**
 * Vraća dodatno polje iz zahteva preko Field Key-a ili naziva polja
 */
export function getRequestAdditionalField(request, fieldConfigOrName) {
  const possibleContainers = [
    request?.udf_fields,
    request?.request?.udf_fields,
    request?.request_udf_fields,
    request?.request?.request_udf_fields,
    request?.additional_fields,
    request?.request?.additional_fields,
    request?.request_additional_fields,
    request?.request?.request_additional_fields,
  ];

  const fieldConfig =
    typeof fieldConfigOrName === 'object'
      ? fieldConfigOrName
      : {
          label: fieldConfigOrName,
          key: fieldConfigOrName,
        };

  const possibleKeys = [
    fieldConfig.key,
    fieldConfig.label,
    fieldConfig.name,
  ].filter(Boolean);

  for (const container of possibleContainers) {
    if (!container || typeof container !== 'object') continue;

    const valueByKey = getValueFromObjectByPossibleKeys(
      container,
      possibleKeys,
    );

    if (valueByKey !== '') {
      return valueByKey;
    }

    const normalizedKeys = possibleKeys.map((key) =>
      String(key).toLowerCase().trim(),
    );

    for (const [key, value] of Object.entries(container)) {
      const normalizedKey = String(key).toLowerCase().trim();

      if (normalizedKeys.includes(normalizedKey)) {
        return extractZohoDisplayValue(value);
      }
    }
  }

  return '';
}

/**
 * Spaja list request objekat i detail request objekat
 */
export function mergeRequestListAndDetail(listRequest, detailRequest) {
  const detail = detailRequest?.request || detailRequest || {};

  return {
    ...listRequest,
    ...detail,
    requester: detail.requester || listRequest.requester,
    technician: detail.technician || listRequest.technician,
    group: detail.group || listRequest.group,
    site: detail.site || listRequest.site,
    udf_fields: detail.udf_fields || listRequest.udf_fields,
    request_udf_fields:
      detail.request_udf_fields || listRequest.request_udf_fields,
    additional_fields:
      detail.additional_fields || listRequest.additional_fields,
    request_additional_fields:
      detail.request_additional_fields || listRequest.request_additional_fields,
  };
}

/**
 * Dohvata detail podatke za jedan request
 */
/**
 * Dohvata detail podatke za jedan request
 */
export async function fetchZohoRequestDetails({
  token,
  requestId,
  debug = false,
}) {
  const endpoint = `/requests/${requestId}`;

  debugLog(debug, '[ZOHO DETAIL] START', {
    requestId,
    endpoint,
  });

  const startedAt = Date.now();

  const resp = await zohoRequest({
    method: 'get',
    endpoint,
    token,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  debugLog(debug, '[ZOHO DETAIL] END', {
    requestId,
    httpStatus: resp.status,
    elapsedMs: Date.now() - startedAt,
    hasRequest: Boolean(resp.data?.request),
    responseStatus: resp.data?.response_status ?? null,
    udfKeys: resp.data?.request?.udf_fields
      ? Object.keys(resp.data.request.udf_fields)
      : [],
  });

  return resp;
}

/**
 * Obogaćuje listu zahteva detail podacima, uključujući udf_fields
 */
export async function enrichRequestsWithDetails({
  token,
  requests,
  debug = false,
}) {
  if (!Array.isArray(requests) || requests.length === 0) {
    debugLog(debug, '[ZOHO ENRICH] No requests to enrich');
    return [];
  }

  debugLog(debug, '[ZOHO ENRICH] START', {
    requestsCount: requests.length,
  });

  const startedAt = Date.now();
  const enriched = [];

  for (let i = 0; i < requests.length; i += 1) {
    const request = requests[i];
    const requestId = request?.id;
    const displayId =
      request?.display_id || request?.display_key?.value || null;

    debugLog(debug, '[ZOHO ENRICH] Item START', {
      index: i + 1,
      total: requests.length,
      requestId,
      displayId,
    });

    if (!requestId) {
      debugLog(debug, '[ZOHO ENRICH] Item skipped - missing requestId', {
        index: i + 1,
        displayId,
      });

      enriched.push(request);
      continue;
    }

    try {
      const detailResp = await fetchZohoRequestDetails({
        token,
        requestId,
        debug,
      });

      if (detailResp.status >= 200 && detailResp.status < 300) {
        const merged = mergeRequestListAndDetail(request, detailResp.data);

        debugLog(debug, '[ZOHO ENRICH] Item merged', {
          index: i + 1,
          requestId,
          displayId,
          hasUdfFields: Boolean(merged?.udf_fields),
          udfKeys: merged?.udf_fields ? Object.keys(merged.udf_fields) : [],
        });

        enriched.push(merged);
      } else {
        debugLog(
          debug,
          '[ZOHO ENRICH] Item detail failed, using list request',
          {
            index: i + 1,
            requestId,
            displayId,
            httpStatus: detailResp.status,
            response: detailResp.data,
          },
        );

        enriched.push(request);
      }
    } catch (e) {
      debugLog(debug, '[ZOHO ENRICH] Item exception, using list request', {
        index: i + 1,
        requestId,
        displayId,
        message: e?.message,
      });

      enriched.push(request);
    }
  }

  debugLog(debug, '[ZOHO ENRICH] END', {
    inputCount: requests.length,
    outputCount: enriched.length,
    elapsedMs: Date.now() - startedAt,
  });

  return enriched;
}
/**
 * Mapira zahtev u red za izvoz
 */
export function mapRequestToExportRow(request) {
  return {
    Group: request?.group?.name || '',
    Technician: request?.technician?.name || '',
    Site:
      request?.requester?.site?.name ||
      request?.site?.name ||
      request?.technician?.site?.name ||
      '',
    Subject: request?.subject || '',
    RequestID:
      request?.display_id ||
      request?.display_key?.display_value ||
      request?.display_key?.value ||
      request?.id ||
      '',
    'Created Time': request?.created_time?.display_value || '',
    'Completed Time':
      request?.completed_time?.display_value ||
      request?.resolved_time?.display_value ||
      request?.closed_time?.display_value ||
      '',
    'Rezime zahteva': getRequestAdditionalField(
      request,
      REQUEST_EXPORT_ADDITIONAL_FIELDS.rezimeZahteva,
    ),
    'Rezime rešenja': getRequestAdditionalField(
      request,
      REQUEST_EXPORT_ADDITIONAL_FIELDS.rezimeResenja,
    ),
    Korisnik: getRequestAdditionalField(
      request,
      REQUEST_EXPORT_ADDITIONAL_FIELDS.korisnik,
    ),
  };
}

/**
 * Gradi kriterijume pretrage za zahteve
 */
export function buildRequestsSearchCriteria({
  group,
  createdAfter,
  createdBefore,
}) {
  const searchCriteria = [];

  if (group) {
    searchCriteria.push({
      field: 'group.name',
      condition: 'is',
      values: [group],
    });
  }

  if (createdAfter) {
    searchCriteria.push({
      field: 'created_time',
      condition: 'greater than',
      logical_operator: searchCriteria.length ? 'and' : undefined,
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

  return searchCriteria;
}

/**
 * Dohvata jednu stranicu izveštaja o zahtevima sa Zoho API-ja
 */
export async function fetchRequestsReportPage({
  token,
  page,
  perPage,
  startIndex,
  sortField,
  sortOrder,
  group,
  createdAfter,
  createdBefore,
  debug = false,
}) {
  const searchCriteria = buildRequestsSearchCriteria({
    group,
    createdAfter,
    createdBefore,
  });

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

  debugLog(debug, '[ZOHO REPORT PAGE] START', {
    page,
    perPage,
    startIndex,
    sortField,
    sortOrder,
    group: group || null,
    createdAfter,
    createdBefore,
    inputData,
  });

  const startedAt = Date.now();

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

  debugLog(debug, '[ZOHO REPORT PAGE] END', {
    page,
    startIndex,
    httpStatus: resp.status,
    elapsedMs: Date.now() - startedAt,
    responseStatus: resp.data?.response_status ?? null,
    hasMoreRows: resp.data?.list_info?.has_more_rows,
    zohoRowCount: resp.data?.list_info?.row_count,
    returnedRequests: Array.isArray(resp.data?.requests)
      ? resp.data.requests.length
      : 0,
    firstRequestId: resp.data?.requests?.[0]?.id ?? null,
    lastRequestId:
      resp.data?.requests?.length > 0
        ? resp.data.requests[resp.data.requests.length - 1]?.id
        : null,
  });

  return {
    resp,
    inputData,
    page,
    perPage,
    startIndex,
  };
}

export const TASK_WORKLOG_REPORT_COLUMNS = [
  'Group',
  'Technician',
  'Site',
  'Department',
  'RequestID',
  'Subject',
  'Created Time',
  'Completed Time',
  'Worklog Type',
  'Rezime zahteva',
  'Worklog Description',
  'Rezime rešenja',
  'Executed Time',
  'Time Spent',
  'Amount',
  'Korisnik',
];

export function getZohoDateDisplay(dateObject) {
  return dateObject?.display_value || '';
}

export function getRequestDisplayId(request, task) {
  return (
    request?.display_id ||
    request?.display_key?.display_value ||
    request?.display_key?.value ||
    task?.request?.display_id ||
    task?.request?.display_key?.display_value ||
    task?.request?.display_key?.value ||
    request?.id ||
    task?.request?.id ||
    ''
  );
}

export function getWorklogTimeSpentDisplay(worklog) {
  const hours = worklog?.time_spent?.hours;
  const minutes = worklog?.time_spent?.minutes;

  if (hours !== undefined || minutes !== undefined) {
    return `${hours || 0}h ${minutes || 0}m`;
  }

  const valueMs = Number(worklog?.time_spent?.value);

  if (Number.isFinite(valueMs) && valueMs > 0) {
    const totalMinutes = Math.round(valueMs / 60000);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;

    return `${h}h ${m}m`;
  }

  return '';
}

export function getWorklogAmountDisplay(worklog) {
  return (
    worklog?.total_charge?.display_value ||
    worklog?.tech_charge?.display_value ||
    worklog?.total_charge?.value ||
    worklog?.tech_charge?.value ||
    ''
  );
}

export function mapTaskWorklogToExportRow({ request, task, worklog }) {
  return {
    Group: request?.group?.name || task?.group?.name || '',
    Technician:
      worklog?.owner?.name ||
      task?.owner?.name ||
      request?.technician?.name ||
      '',
    Site:
      request?.site?.name ||
      request?.requester?.site?.name ||
      task?.site?.name ||
      '',
    Department:
      request?.requester?.department?.name ||
      request?.department?.name ||
      task?.owner?.department?.name ||
      '',
    RequestID: getRequestDisplayId(request, task),
    Subject: request?.subject || task?.request?.subject || '',
    'Created Time': getZohoDateDisplay(request?.created_time),
    'Completed Time':
      getZohoDateDisplay(request?.completed_time) ||
      getZohoDateDisplay(request?.resolved_time) ||
      getZohoDateDisplay(request?.closed_time),
    'Worklog Type': worklog?.worklog_type?.name || '',
    'Rezime zahteva': getRequestAdditionalField(
      request,
      REQUEST_EXPORT_ADDITIONAL_FIELDS.rezimeZahteva,
    ),
    'Worklog Description': worklog?.description || '',
    'Rezime rešenja': getRequestAdditionalField(
      request,
      REQUEST_EXPORT_ADDITIONAL_FIELDS.rezimeResenja,
    ),
    'Executed Time':
      getZohoDateDisplay(worklog?.recorded_time) ||
      getZohoDateDisplay(worklog?.start_time),
    'Time Spent': getWorklogTimeSpentDisplay(worklog),
    Amount: getWorklogAmountDisplay(worklog),
    Korisnik: getRequestAdditionalField(
      request,
      REQUEST_EXPORT_ADDITIONAL_FIELDS.korisnik,
    ),
  };
}

/**
 * Dohvata jednu stranicu taskova za request
 */
export async function fetchRequestTasksPage({
  token,
  requestId,
  page,
  perPage,
  startIndex,
  sortField = 'created_time',
  sortOrder = 'desc',
  debug = false,
}) {
  const inputData = {
    list_info: {
      row_count: perPage,
      start_index: startIndex,
      sort_field: sortField,
      sort_order: sortOrder,
    },
  };

  const endpoint = `/requests/${requestId}/tasks`;

  debugLog(debug, '[ZOHO TASKS PAGE] START', {
    requestId,
    page,
    perPage,
    startIndex,
    endpoint,
    inputData,
  });

  const startedAt = Date.now();

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

  debugLog(debug, '[ZOHO TASKS PAGE] END', {
    requestId,
    page,
    startIndex,
    httpStatus: resp.status,
    elapsedMs: Date.now() - startedAt,
    hasMoreRows: resp.data?.list_info?.has_more_rows,
    rowCount: resp.data?.list_info?.row_count,
    tasksCount: Array.isArray(resp.data?.tasks) ? resp.data.tasks.length : 0,
  });

  return {
    resp,
    inputData,
    page,
    perPage,
    startIndex,
  };
}

/**
 * Dohvata sve taskove za request
 */
export async function fetchAllRequestTasks({
  token,
  requestId,
  perPage = 100,
  sortField = 'created_time',
  sortOrder = 'desc',
  maxPages = 50,
  debug = false,
}) {
  const tasks = [];
  let currentPage = 1;
  let currentStartIndex = 1;
  let hasMoreRows = true;

  while (hasMoreRows && currentPage <= maxPages) {
    const { resp } = await fetchRequestTasksPage({
      token,
      requestId,
      page: currentPage,
      perPage,
      startIndex: currentStartIndex,
      sortField,
      sortOrder,
      debug,
    });

    if (resp.status < 200 || resp.status >= 300) {
      debugLog(debug, '[ZOHO TASKS ALL] Failed page', {
        requestId,
        currentPage,
        currentStartIndex,
        httpStatus: resp.status,
        response: resp.data,
      });

      break;
    }

    const pageTasks = resp.data?.tasks ?? [];
    tasks.push(...pageTasks);

    hasMoreRows = Boolean(resp.data?.list_info?.has_more_rows);

    if (!hasMoreRows || pageTasks.length === 0) {
      break;
    }

    const zohoReturnedCount =
      Number(resp.data?.list_info?.row_count) || pageTasks.length || perPage;

    currentStartIndex += zohoReturnedCount;
    currentPage += 1;
  }

  return tasks;
}

/**
 * Dohvata jednu stranicu worklogova za task
 */
export async function fetchTaskWorklogsPage({
  token,
  requestId,
  taskId,
  page,
  perPage,
  startIndex,
  debug = false,
}) {
  const inputData = {
    list_info: {
      row_count: perPage,
      start_index: startIndex,
    },
  };

  const endpoint = `/requests/${requestId}/tasks/${taskId}/worklogs`;

  debugLog(debug, '[ZOHO WORKLOGS PAGE] START', {
    requestId,
    taskId,
    page,
    perPage,
    startIndex,
    endpoint,
  });

  const startedAt = Date.now();

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

  debugLog(debug, '[ZOHO WORKLOGS PAGE] END', {
    requestId,
    taskId,
    page,
    startIndex,
    httpStatus: resp.status,
    elapsedMs: Date.now() - startedAt,
    hasMoreRows: resp.data?.list_info?.has_more_rows,
    rowCount: resp.data?.list_info?.row_count,
    worklogsCount: Array.isArray(resp.data?.worklogs)
      ? resp.data.worklogs.length
      : 0,
  });

  return {
    resp,
    inputData,
    page,
    perPage,
    startIndex,
  };
}

/**
 * Dohvata sve worklogove za jedan task
 */
export async function fetchAllTaskWorklogs({
  token,
  requestId,
  taskId,
  perPage = 100,
  maxPages = 50,
  debug = false,
}) {
  const worklogs = [];
  let currentPage = 1;
  let currentStartIndex = 1;
  let hasMoreRows = true;

  while (hasMoreRows && currentPage <= maxPages) {
    const { resp } = await fetchTaskWorklogsPage({
      token,
      requestId,
      taskId,
      page: currentPage,
      perPage,
      startIndex: currentStartIndex,
      debug,
    });

    if (resp.status < 200 || resp.status >= 300) {
      debugLog(debug, '[ZOHO WORKLOGS ALL] Failed page', {
        requestId,
        taskId,
        currentPage,
        currentStartIndex,
        httpStatus: resp.status,
        response: resp.data,
      });

      break;
    }

    const pageWorklogs = resp.data?.worklogs ?? [];
    worklogs.push(...pageWorklogs);

    hasMoreRows = Boolean(resp.data?.list_info?.has_more_rows);

    if (!hasMoreRows || pageWorklogs.length === 0) {
      break;
    }

    const zohoReturnedCount =
      Number(resp.data?.list_info?.row_count) || pageWorklogs.length || perPage;

    currentStartIndex += zohoReturnedCount;
    currentPage += 1;
  }

  return worklogs;
}

/**
 * Za listu requestova dohvaća taskove i worklogove i vraća redove za export
 */
export async function buildTaskWorklogReportRowsForRequests({
  token,
  requests,
  taskPerPage = 100,
  worklogPerPage = 100,
  taskMaxPages = 50,
  worklogMaxPages = 50,
  debug = false,
}) {
  const rows = [];
  const debugSummary = [];

  for (let i = 0; i < requests.length; i += 1) {
    const request = requests[i];
    const requestId = request?.id;

    debugLog(debug, '[ZOHO TASK-WORKLOG REPORT] Request START', {
      index: i + 1,
      total: requests.length,
      requestId,
      displayId: getRequestDisplayId(request),
    });

    if (!requestId) {
      continue;
    }

    const tasks = await fetchAllRequestTasks({
      token,
      requestId,
      perPage: taskPerPage,
      maxPages: taskMaxPages,
      debug,
    });

    let requestWorklogCount = 0;

    for (let j = 0; j < tasks.length; j += 1) {
      const task = tasks[j];
      const taskId = task?.id;

      debugLog(debug, '[ZOHO TASK-WORKLOG REPORT] Task START', {
        requestId,
        taskIndex: j + 1,
        totalTasks: tasks.length,
        taskId,
        taskTitle: task?.title || '',
      });

      if (!taskId) {
        continue;
      }

      const worklogs = await fetchAllTaskWorklogs({
        token,
        requestId,
        taskId,
        perPage: worklogPerPage,
        maxPages: worklogMaxPages,
        debug,
      });

      requestWorklogCount += worklogs.length;

      for (const worklog of worklogs) {
        rows.push(
          mapTaskWorklogToExportRow({
            request,
            task,
            worklog,
          }),
        );
      }
    }

    debugSummary.push({
      requestId,
      displayId: getRequestDisplayId(request),
      tasksCount: tasks.length,
      worklogsCount: requestWorklogCount,
    });

    debugLog(debug, '[ZOHO TASK-WORKLOG REPORT] Request END', {
      requestId,
      tasksCount: tasks.length,
      worklogsCount: requestWorklogCount,
      totalRowsSoFar: rows.length,
    });
  }

  return {
    rows,
    debugSummary,
  };
}
