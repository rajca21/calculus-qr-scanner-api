import {
  ValidationError,
  createMailService,
  fail,
  fingerprint,
  getApiKey,
  handleSendGridError,
} from './sendgrid.controller.js';
import { getAccountFromToken } from './sendgridWebhook.controller.js';
import { findEvents } from '../utils/sendgridStore.js';

// Activity API dozvoljava do 160 uslova u jednom upitu
const MAX_MESSAGE_IDS = 50;
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{10,40}$/;

// Redosled od najgoreg ka najboljem; status mejla je najgori status među primaocima
const STATUS_ORDER = [
  'BOUNCED',
  'DROPPED',
  'SPAM',
  'NOT_DELIVERED',
  'DEFERRED',
  'UNKNOWN',
  'SENT',
  'DELIVERED',
  'OPENED',
  'CLICKED',
];

const ACTIVITY_FORBIDDEN =
  'API ključ nema pristup Email Activity API-ju (potreban je plaćeni Email Activity History dodatak i dozvola Email Activity)';

const worst = (statuses) =>
  statuses.reduce(
    (current, status) =>
      STATUS_ORDER.indexOf(status) < STATUS_ORDER.indexOf(current) ? status : current,
    'CLICKED',
  );

const toIso = (ms) => (ms ? new Date(ms).toISOString() : null);

const parseMessageIds = (input) => {
  let values;
  if (Array.isArray(input)) {
    values = input;
  } else if (typeof input === 'string') {
    values = input.split(/[;,]/);
  } else {
    throw new ValidationError('messageIds mora biti niz ili string odvojen zarezom');
  }

  const ids = [
    ...new Set(values.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)),
  ];

  if (!ids.length) {
    throw new ValidationError('Mora biti prosleđen bar jedan messageId');
  }
  if (ids.length > MAX_MESSAGE_IDS) {
    throw new ValidationError(`Dozvoljeno je najviše ${MAX_MESSAGE_IDS} messageId vrednosti po zahtevu`);
  }
  const invalid = ids.find((id) => !MESSAGE_ID_PATTERN.test(id));
  if (invalid) {
    throw new ValidationError(`Neispravan messageId: ${invalid.slice(0, 50)}`);
  }

  return ids;
};

const summarize = (messageId, recipients, opens, clicks) => {
  if (!recipients.length) {
    return { messageId, status: 'UNKNOWN', lastEventAt: null, opens: 0, clicks: 0, reason: null, recipients: [] };
  }

  const status = worst(recipients.map((r) => r.status));
  const lastEventAt = recipients
    .map((r) => r.lastEventAt)
    .filter(Boolean)
    .sort()
    .pop() || null;
  const reason = recipients.find((r) => r.status === status && r.reason)?.reason || null;

  return { messageId, status, lastEventAt, opens, clicks, reason, recipients };
};

// # Status primaoca iz događaja webhook-a; neuspeh ima prednost nad uspešnim događajima
const recipientStatus = (events) => {
  const has = (type) => events.some((e) => e.event === type);
  if (has('bounce')) return 'BOUNCED';
  if (has('dropped')) return 'DROPPED';
  if (has('spamreport')) return 'SPAM';
  if (has('click')) return 'CLICKED';
  if (has('open')) return 'OPENED';
  if (has('delivered')) return 'DELIVERED';
  if (has('deferred')) return 'DEFERRED';
  if (has('processed')) return 'SENT';
  return 'UNKNOWN';
};

const statusFromWebhook = (accountId, ids) => {
  const rows = findEvents(accountId, ids);

  return ids.map((messageId) => {
    const byEmail = new Map();
    for (const row of rows.filter((r) => r.message_id === messageId)) {
      if (!byEmail.has(row.email)) byEmail.set(row.email, []);
      byEmail.get(row.email).push(row);
    }

    let opens = 0;
    let clicks = 0;
    const recipients = [...byEmail].map(([email, events]) => {
      const status = recipientStatus(events);
      opens += events.filter((e) => e.event === 'open').length;
      clicks += events.filter((e) => e.event === 'click').length;
      const failure = events.filter((e) => e.reason).pop();
      return {
        email,
        status,
        lastEventAt: toIso(Math.max(...events.map((e) => e.occurred_at))),
        reason: ['BOUNCED', 'DROPPED', 'DEFERRED'].includes(status) ? failure?.reason || null : null,
      };
    });

    return summarize(messageId, recipients, opens, clicks);
  });
};

const ACTIVITY_STATUS = { processed: 'SENT', delivered: 'DELIVERED', not_delivered: 'NOT_DELIVERED' };

const statusFromActivity = async (apiKey, ids) => {
  // msg_id u Activity API-ju ima nastavak posle tačke, pa se traži po prefiksu (x-message-id)
  const query = ids.map((id) => `msg_id LIKE "${id}%"`).join(' OR ');
  const [, body] = await createMailService(apiKey).client.request({
    method: 'GET',
    url: `/v3/messages?limit=1000&query=${encodeURIComponent(query)}`,
  });
  const rows = Array.isArray(body?.messages) ? body.messages : [];

  return ids.map((messageId) => {
    let opens = 0;
    let clicks = 0;
    const recipients = rows
      .filter((row) => String(row?.msg_id || '').split('.')[0] === messageId)
      .map((row) => {
        const rowOpens = Number(row.opens_count) || 0;
        const rowClicks = Number(row.clicks_count) || 0;
        opens += rowOpens;
        clicks += rowClicks;

        let status = ACTIVITY_STATUS[row.status] || 'UNKNOWN';
        if (status === 'DELIVERED' && rowClicks > 0) status = 'CLICKED';
        else if (status === 'DELIVERED' && rowOpens > 0) status = 'OPENED';

        const lastEventAt = Date.parse(row.last_event_time);
        return {
          email: String(row.to_email || '').toLowerCase(),
          status,
          lastEventAt: Number.isFinite(lastEventAt) ? new Date(lastEventAt).toISOString() : null,
          reason: null,
        };
      });

    return summarize(messageId, recipients, opens, clicks);
  });
};

/**
 * @route   POST /api/sendgrid/messages/status
 * @desc    Status isporuke i otvaranja mejlova. Sa account tokenom se čitaju događaji
 *          primljeni preko webhook-a (svi planovi), a bez njega se pita SendGrid
 *          Email Activity API (plaćeni dodatak)
 * @header  {string} X-Calculus-Client-Key - Ključ klijenta (Calculus ERP)
 * @header  {string} X-SendGrid-Account-Token - Za podatke iz webhook-a
 * @header  {string} X-SendGrid-Api-Key - Za Email Activity API (kada nema account tokena)
 * @param   {string|Array} req.body.messageIds - Do 50 messageId vrednosti dobijenih iz /send
 */
export const getMessagesStatus = async (req, res) => {
  let ids;
  let tokenAccount;

  try {
    ids = parseMessageIds(req.body?.messageIds);
  } catch (error) {
    if (error instanceof ValidationError) {
      return fail(res, 400, 'VALIDATION_ERROR', error.message);
    }
    throw error;
  }

  try {
    tokenAccount = getAccountFromToken(req);
  } catch (error) {
    if (error instanceof ValidationError) {
      return fail(res, 401, 'ACCOUNT_TOKEN_INVALID', error.message);
    }
    throw error;
  }

  if (tokenAccount) {
    return res.status(200).json({
      success: true,
      code: 'OK',
      source: 'webhook',
      messages: statusFromWebhook(tokenAccount.account.id, ids),
    });
  }

  let apiKey;
  try {
    apiKey = getApiKey(req);
  } catch (error) {
    if (error instanceof ValidationError) {
      return fail(
        res,
        400,
        'VALIDATION_ERROR',
        'Potrebno je proslediti X-SendGrid-Account-Token (webhook) ili X-SendGrid-Api-Key (Email Activity)',
      );
    }
    throw error;
  }

  try {
    return res.status(200).json({
      success: true,
      code: 'OK',
      source: 'activity',
      messages: await statusFromActivity(apiKey, ids),
    });
  } catch (error) {
    return handleSendGridError(res, error, 'Čitanje statusa', fingerprint(apiKey), ACTIVITY_FORBIDDEN);
  }
};
