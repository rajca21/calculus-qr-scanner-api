import crypto from 'crypto';

import {
  CUSTOM_ARG_MARKER,
  ValidationError,
  createMailService,
  fail,
  fingerprint,
  getApiKey,
  handleSendGridError,
} from './sendgrid.controller.js';
import {
  deleteAccount,
  findAccountById,
  findAccountByTokenHash,
  insertEvents,
  saveAccount,
} from '../utils/sendgridStore.js';

export const ACCOUNT_TOKEN_HEADER = 'x-sendgrid-account-token';

const SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
const TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const ACCOUNT_TOKEN_PATTERN = /^sgat_[A-Za-z0-9_-]{43}$/;
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{10,40}$/;
const STORED_EVENTS = new Set([
  'processed',
  'dropped',
  'delivered',
  'deferred',
  'bounce',
  'open',
  'click',
  'spamreport',
]);
const MAX_REASON_LENGTH = 500;

const WEBHOOK_FORBIDDEN =
  'API ključ nema dozvolu za Event Webhook (Mail Settings > Event Webhook: Full Access)';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// # Nalog po account tokenu iz headera; null ako token nije prosleđen
export const getAccountFromToken = (req) => {
  const token = String(req.get(ACCOUNT_TOKEN_HEADER) || '').trim();
  if (!token) return null;

  const account = ACCOUNT_TOKEN_PATTERN.test(token)
    ? findAccountByTokenHash(hashToken(token))
    : undefined;
  if (!account) {
    throw new ValidationError('Account token nije ispravan ili je nalog uklonjen');
  }

  return { account, token };
};

const getPublicBaseUrl = () => {
  const value = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^/\s]+$/.test(value) ? value : '';
};

const parsePublicKey = (publicKey) => {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(String(publicKey || ''), 'base64'),
      format: 'der',
      type: 'spki',
    });
    return key.asymmetricKeyType === 'ec' ? key : null;
  } catch {
    return null;
  }
};

// Webhook koji je korisnik već obrisao u SendGrid-u ne smeta
const deleteSendGridWebhook = async (client, webhookId) => {
  try {
    await client.request({
      method: 'DELETE',
      url: `/v3/user/webhooks/event/settings/${encodeURIComponent(webhookId)}`,
    });
  } catch (error) {
    if (error?.code !== 404) throw error;
  }
};

const tokenErrorResponse = (res, error) => {
  if (error instanceof ValidationError) {
    return fail(res, 401, 'ACCOUNT_TOKEN_INVALID', error.message);
  }
  throw error;
};

/**
 * @route   POST /api/sendgrid/webhook/setup
 * @desc    Kreiranje potpisanog Event Webhook-a na SendGrid nalogu korisnika, koji šalje
 *          događaje (isporuka, otvaranje, bounce...) na /api/sendgrid/events/:accountId
 * @header  {string} X-Calculus-Client-Key - Ključ klijenta (Calculus ERP)
 * @header  {string} X-SendGrid-Api-Key - SendGrid API ključ sa dozvolom Event Webhook
 * @header  {string} X-SendGrid-Account-Token - Opciono, pri ponovnom podešavanju istog naloga
 */
export const setupWebhook = async (req, res) => {
  let apiKey;
  let existing;

  try {
    apiKey = getApiKey(req);
  } catch (error) {
    if (error instanceof ValidationError) {
      return fail(res, 400, 'VALIDATION_ERROR', error.message);
    }
    throw error;
  }
  try {
    existing = getAccountFromToken(req);
  } catch (error) {
    return tokenErrorResponse(res, error);
  }

  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) {
    console.error('[SENDGRID] PUBLIC_BASE_URL nije podešen ili nije https adresa');
    return fail(res, 503, 'WEBHOOK_NOT_CONFIGURED', 'Servis nije podešen za prijem SendGrid događaja');
  }

  const accountId = existing?.account.id || crypto.randomBytes(16).toString('hex');
  const accountToken = existing?.token || `sgat_${crypto.randomBytes(32).toString('base64url')}`;
  const keyFingerprint = fingerprint(apiKey);
  const { client } = createMailService(apiKey);

  let webhookId;
  let publicKey;

  try {
    // Postojeći webhook se briše pre kreiranja novog, jer besplatni plan dozvoljava mali broj webhook-ova
    if (existing?.account.webhook_id) {
      await deleteSendGridWebhook(client, existing.account.webhook_id);
    }

    const [, created] = await client.request({
      method: 'POST',
      url: '/v3/user/webhooks/event/settings',
      body: {
        enabled: true,
        url: `${baseUrl}/api/sendgrid/events/${accountId}`,
        friendly_name: 'Calculus ERP',
        processed: true,
        delivered: true,
        deferred: true,
        bounce: true,
        dropped: true,
        open: true,
        click: true,
        spam_report: true,
        unsubscribe: false,
        group_unsubscribe: false,
        group_resubscribe: false,
      },
    });
    webhookId = typeof created?.id === 'string' ? created.id : '';
    if (!webhookId) {
      console.error('[SENDGRID] Kreiranje webhook-a nije vratilo id', { key: keyFingerprint });
      return fail(res, 502, 'SENDGRID_ERROR', 'SendGrid nije vratio identifikator webhook-a');
    }

    const [, signed] = await client.request({
      method: 'PATCH',
      url: `/v3/user/webhooks/event/settings/signed/${encodeURIComponent(webhookId)}`,
      body: { enabled: true },
    });
    publicKey = String(signed?.public_key || '');
    if (!parsePublicKey(publicKey)) {
      console.error('[SENDGRID] Webhook nema ispravan javni ključ', { key: keyFingerprint });
      await deleteSendGridWebhook(client, webhookId).catch(() => {});
      return fail(res, 502, 'SENDGRID_ERROR', 'SendGrid nije vratio ispravan ključ za potpis webhook-a');
    }
  } catch (error) {
    if (webhookId) await deleteSendGridWebhook(client, webhookId).catch(() => {});
    return handleSendGridError(res, error, 'Podešavanje webhook-a', keyFingerprint, WEBHOOK_FORBIDDEN);
  }

  saveAccount({ id: accountId, tokenHash: hashToken(accountToken), webhookId, publicKey });

  console.log('[SENDGRID] Webhook podešen', {
    account: accountId,
    webhookId,
    renewed: Boolean(existing),
    key: keyFingerprint,
  });

  return res.status(200).json({
    success: true,
    code: 'WEBHOOK_READY',
    accountToken,
    webhookId,
  });
};

/**
 * @route   DELETE /api/sendgrid/webhook
 * @desc    Brisanje webhook-a sa SendGrid naloga i svih sačuvanih događaja tog naloga
 * @header  {string} X-Calculus-Client-Key - Ključ klijenta (Calculus ERP)
 * @header  {string} X-SendGrid-Api-Key - SendGrid API ključ sa dozvolom Event Webhook
 * @header  {string} X-SendGrid-Account-Token - Account token dobijen pri podešavanju
 */
export const removeWebhook = async (req, res) => {
  let apiKey;
  let existing;

  try {
    apiKey = getApiKey(req);
  } catch (error) {
    if (error instanceof ValidationError) {
      return fail(res, 400, 'VALIDATION_ERROR', error.message);
    }
    throw error;
  }
  try {
    existing = getAccountFromToken(req);
  } catch (error) {
    return tokenErrorResponse(res, error);
  }
  if (!existing) {
    return fail(res, 401, 'ACCOUNT_TOKEN_INVALID', `Account token mora biti prosleđen u ${ACCOUNT_TOKEN_HEADER} headeru`);
  }

  const keyFingerprint = fingerprint(apiKey);

  try {
    if (existing.account.webhook_id) {
      await deleteSendGridWebhook(createMailService(apiKey).client, existing.account.webhook_id);
    }
  } catch (error) {
    return handleSendGridError(res, error, 'Brisanje webhook-a', keyFingerprint, WEBHOOK_FORBIDDEN);
  }

  deleteAccount(existing.account.id);
  console.log('[SENDGRID] Webhook uklonjen', { account: existing.account.id, key: keyFingerprint });

  return res.status(200).json({ success: true, code: 'WEBHOOK_REMOVED' });
};

const toStoredEvent = (e) => {
  if (!e || typeof e !== 'object' || e[CUSTOM_ARG_MARKER] !== '1') return null;
  if (!STORED_EVENTS.has(e.event)) return null;

  const eventId = typeof e.sg_event_id === 'string' ? e.sg_event_id : '';
  const messageId = String(e.sg_message_id || '').split('.')[0];
  const email = typeof e.email === 'string' ? e.email.trim().toLowerCase() : '';
  const timestamp = Number(e.timestamp);

  if (
    !eventId ||
    eventId.length > 100 ||
    !MESSAGE_ID_PATTERN.test(messageId) ||
    !email ||
    email.length > 254 ||
    !Number.isFinite(timestamp)
  ) {
    return null;
  }

  const reason = ['bounce', 'dropped', 'deferred'].includes(e.event)
    ? String(e.reason || e.response || '')
        .replace(/[\x00-\x1F\x7F]+/g, ' ')
        .trim()
        .slice(0, MAX_REASON_LENGTH)
    : '';

  return {
    eventId,
    messageId,
    email,
    event: e.event,
    occurredAt: Math.round(timestamp * 1000),
    reason: reason || null,
  };
};

/**
 * @route   POST /api/sendgrid/events/:accountId
 * @desc    Prijem SendGrid Event Webhook događaja; prihvataju se samo zahtevi potpisani
 *          ključem tog naloga (ECDSA nad timestamp + sirovo telo)
 */
export const receiveEvents = (req, res) => {
  const { accountId } = req.params;
  const account = ACCOUNT_ID_PATTERN.test(accountId) ? findAccountById(accountId) : null;
  const publicKey = account?.public_key ? parsePublicKey(account.public_key) : null;

  if (!publicKey) {
    return res.status(404).end();
  }

  const signature = String(req.get(SIGNATURE_HEADER) || '');
  const timestamp = String(req.get(TIMESTAMP_HEADER) || '');
  const body = Buffer.isBuffer(req.body) ? req.body : null;

  let valid = false;
  if (signature && /^\d{1,12}$/.test(timestamp) && body) {
    try {
      valid = crypto.verify(
        'sha256',
        Buffer.concat([Buffer.from(timestamp), body]),
        publicKey,
        Buffer.from(signature, 'base64'),
      );
    } catch {
      valid = false;
    }
  }

  if (!valid) {
    console.warn('[SENDGRID] Odbijen webhook sa neispravnim potpisom', { account: accountId });
    return res.status(403).end();
  }

  let events;
  try {
    events = JSON.parse(body.toString('utf8'));
  } catch {
    return res.status(400).end();
  }
  if (!Array.isArray(events)) {
    return res.status(400).end();
  }

  const relevant = events.map(toStoredEvent).filter(Boolean);
  const stored = relevant.length ? insertEvents(accountId, relevant) : 0;

  return res.status(200).json({ received: events.length, stored });
};
