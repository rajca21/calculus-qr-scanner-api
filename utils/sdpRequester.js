import { zohoRequest } from './zoho.js';

const encode = (obj) => encodeURIComponent(JSON.stringify(obj));

const splitName = (fullName) => {
  const clean = String(fullName || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!clean) return { first_name: '', last_name: '' };

  const parts = clean.split(' ');
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };

  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(' '),
  };
};

/**
 * Pronađi requestera po email-u
 * GET /requesters
 */
export const findRequesterByEmail = async ({ token, email }) => {
  const inputData = {
    list_info: {
      row_count: 1,
      start_index: 1,
      search_fields: {
        email_id: email,
      },
    },
  };

  return zohoRequest({
    method: 'GET',
    endpoint: `/requesters?input_data=${encode(inputData)}`,
    token,
  });
};

/**
 * Kreiraj requestera (kontakt)
 * POST /requesters
 */
export const createRequester = async ({
  token,
  name,
  email,
  phone,
  company,
}) => {
  const { first_name, last_name } = splitName(name || email);

  const payload = {
    requester: {
      first_name: first_name || email,
      last_name: last_name || '',
      name: name || email,
      email_id: email,
      phone: phone || undefined,
      description: company ? `Company: ${company}` : undefined,
    },
  };

  return zohoRequest({
    method: 'POST',
    endpoint: '/requesters',
    token,
    data: {
      input_data: JSON.stringify(payload),
    },
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
};

/**
 * Ensure requester postoji:
 * - ako postoji -> vrati id
 * - ako ne -> kreiraj -> vrati id
 */
export const ensureRequester = async ({
  token,
  name,
  email,
  phone,
  company,
}) => {
  const findResp = await findRequesterByEmail({ token, email });

  if (findResp.status >= 200 && findResp.status < 300) {
    const requesters = findResp.data?.requesters || [];
    if (Array.isArray(requesters) && requesters.length > 0) {
      const id = requesters[0]?.id;
      if (id) return { id, existing: true };
    }
  }

  const createResp = await createRequester({
    token,
    name,
    email,
    phone,
    company,
  });

  if (createResp.status >= 200 && createResp.status < 300) {
    const requester =
      createResp.data?.requester ||
      (Array.isArray(createResp.data?.requesters)
        ? createResp.data.requesters[0]
        : null);

    if (requester?.id) {
      return { id: requester.id, existing: false };
    }
  }

  return {
    id: null,
    existing: false,
    error: {
      find: { status: findResp.status, data: findResp.data },
      create: { status: createResp.status, data: createResp.data },
    },
  };
};
