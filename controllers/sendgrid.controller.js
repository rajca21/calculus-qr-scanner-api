import crypto from 'crypto';
import sgMail from '@sendgrid/mail';

const { MailService } = sgMail;

export const SENDGRID_KEY_HEADER = 'x-sendgrid-api-key';
export const CUSTOM_ARG_MARKER = 'calculus_erp';

const SENDGRID_TIMEOUT_MS = 30 * 1000;
// SendGrid dozvoljava do 1000 primalaca (to + cc + bcc) i poruku do 30 MB
const MAX_RECIPIENTS = 1000;
const MAX_ATTACHMENTS = 20;
const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024;
const MAX_SUBJECT_LENGTH = 998;
const MAX_NAME_LENGTH = 256;
const MAX_FILENAME_LENGTH = 255;

const API_KEY_PATTERN = /^SG\.[A-Za-z0-9_-]{8,128}\.[A-Za-z0-9_-]{8,128}$/;
const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const MIME_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const CONTENT_ID_PATTERN = /^[A-Za-z0-9_.@-]{1,100}$/;
const CONTROL_CHARS = /[\x00-\x1F\x7F]/;

export class ValidationError extends Error {}

export const fail = (res, status, code, error, details) =>
  res.status(status).json({
    success: false,
    code,
    error,
    ...(details?.length ? { details } : {}),
  });

// # Skraćeni otisak ključa za logove, kako bi se razlikovali korisnici bez otkrivanja ključa
export const fingerprint = (apiKey) =>
  crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 12);

const singleLine = (value) =>
  String(value ?? '')
    .replace(/[\x00-\x1F\x7F]+/g, ' ')
    .trim();

export const getApiKey = (req) => {
  const apiKey = String(req.get(SENDGRID_KEY_HEADER) || '').trim();

  if (!apiKey) {
    throw new ValidationError(
      `SendGrid API ključ mora biti prosleđen u ${SENDGRID_KEY_HEADER} headeru`,
    );
  }
  if (!API_KEY_PATTERN.test(apiKey)) {
    throw new ValidationError('SendGrid API ključ nije u ispravnom formatu');
  }

  return apiKey;
};

// # Nova instanca po zahtevu - podrazumevani export @sendgrid/mail deli jedan ključ za ceo proces
export const createMailService = (apiKey) => {
  const service = new MailService();
  service.setApiKey(apiKey);
  service.client.setDefaultRequest({
    timeout: SENDGRID_TIMEOUT_MS,
    maxRedirects: 0,
    maxContentLength: 1024 * 1024,
  });
  return service;
};

const parseEmail = (value, field) => {
  const email = String(value ?? '').trim();

  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new ValidationError(`Neispravna email adresa (${field}): ${singleLine(email)}`);
  }

  return email;
};

const parseName = (value, field) => {
  const name = singleLine(value);

  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`${field} može imati najviše ${MAX_NAME_LENGTH} karaktera`);
  }

  return name;
};

// # Primaoci kao niz ili string odvojen zarezom/tačka-zarezom
const parseRecipients = (input, field) => {
  if (input === undefined || input === null || input === '') return [];

  let values;
  if (Array.isArray(input)) {
    values = input;
  } else if (typeof input === 'string') {
    values = input.split(/[;,]/);
  } else {
    throw new ValidationError(`${field} mora biti string ili niz email adresa`);
  }

  return values
    .map((value) => (typeof value === 'string' ? value.trim() : value))
    .filter((value) => value !== '')
    .map((value) => parseEmail(value, field));
};

const parseAttachments = (input) => {
  if (input === undefined || input === null || input === '') return [];

  if (!Array.isArray(input)) {
    throw new ValidationError('attachments mora biti niz');
  }
  if (input.length > MAX_ATTACHMENTS) {
    throw new ValidationError(`Dozvoljeno je najviše ${MAX_ATTACHMENTS} priloga`);
  }

  let totalBytes = 0;

  return input.map((attachment, index) => {
    if (!attachment || typeof attachment !== 'object') {
      throw new ValidationError(`Prilog #${index + 1} nije ispravan objekat`);
    }

    const filename = String(attachment.filename ?? '').trim();
    if (
      !filename ||
      filename.length > MAX_FILENAME_LENGTH ||
      CONTROL_CHARS.test(filename) ||
      /[/\\]/.test(filename)
    ) {
      throw new ValidationError(`Prilog #${index + 1} nema ispravan naziv fajla`);
    }

    // CryptBinaryToString i slični enkoderi dodaju prelome reda na svakih 64/76 karaktera
    const content = String(attachment.dataBase64 ?? '').replace(/\s+/g, '');
    if (!content || content.length % 4 !== 0 || !BASE64_PATTERN.test(content)) {
      throw new ValidationError(`Prilog "${filename}" nema ispravan base64 sadržaj`);
    }

    const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
    totalBytes += (content.length / 4) * 3 - padding;
    if (totalBytes > MAX_ATTACHMENTS_BYTES) {
      throw new ValidationError(
        `Ukupna veličina priloga je veća od ${MAX_ATTACHMENTS_BYTES / 1024 / 1024} MB`,
      );
    }

    const type = String(attachment.contentType ?? '').trim();
    if (type && (type.length > 127 || !MIME_PATTERN.test(type))) {
      throw new ValidationError(`Prilog "${filename}" ima neispravan contentType`);
    }

    // Prilog sa contentId se ugrađuje u HTML (<img src="cid:...">)
    const contentId = String(attachment.contentId ?? '').trim();
    if (contentId && !CONTENT_ID_PATTERN.test(contentId)) {
      throw new ValidationError(`Prilog "${filename}" ima neispravan contentId`);
    }

    return {
      filename,
      content,
      ...(type ? { type } : {}),
      // Helper ne prevodi contentId u snake_case, pa se šalje direktno kao content_id
      ...(contentId
        ? { disposition: 'inline', content_id: contentId }
        : { disposition: 'attachment' }),
    };
  });
};

const buildMessage = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Telo zahteva mora biti JSON objekat');
  }

  const from = parseEmail(body.from, 'from');
  const fromName = parseName(body.fromName, 'fromName');
  const replyTo = body.replyTo ? parseEmail(body.replyTo, 'replyTo') : '';

  const subject = singleLine(body.subject);
  if (!subject) {
    throw new ValidationError('Naslov mejla (subject) mora biti prosleđen');
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new ValidationError(`Naslov mejla može imati najviše ${MAX_SUBJECT_LENGTH} karaktera`);
  }

  for (const field of ['text', 'html']) {
    if (body[field] !== undefined && body[field] !== null && typeof body[field] !== 'string') {
      throw new ValidationError(`${field} mora biti string`);
    }
  }
  const text = body.text || '';
  const html = body.html || '';
  if (!text.trim() && !html.trim()) {
    throw new ValidationError('Telo mejla nije prosleđeno. Potrebno je poslati text i/ili html sadržaj.');
  }

  // SendGrid odbija poruku ako se ista adresa ponavlja u to/cc/bcc, prednost ima prvo pojavljivanje
  const seen = new Set();
  const unique = (list) =>
    list.filter((email) => {
      const key = email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const to = unique(parseRecipients(body.to, 'to'));
  const cc = unique(parseRecipients(body.cc, 'cc'));
  const bcc = unique(parseRecipients(body.bcc, 'bcc'));

  if (!to.length) {
    throw new ValidationError('Primalac mejla (to) mora biti prosleđen');
  }
  if (seen.size > MAX_RECIPIENTS) {
    throw new ValidationError(`Dozvoljeno je najviše ${MAX_RECIPIENTS} primalaca (to + cc + bcc)`);
  }

  const attachments = parseAttachments(body.attachments);

  // Bez trackOpens/trackClicks važe podešavanja SendGrid naloga korisnika
  const trackingSettings = {};
  for (const [field, setting] of [
    ['trackOpens', 'openTracking'],
    ['trackClicks', 'clickTracking'],
  ]) {
    if (body[field] === undefined || body[field] === null) continue;
    if (typeof body[field] !== 'boolean') {
      throw new ValidationError(`${field} mora biti true ili false`);
    }
    trackingSettings[setting] = { enable: body[field] };
  }

  return {
    from: fromName ? { email: from, name: fromName } : from,
    to,
    ...(cc.length ? { cc } : {}),
    ...(bcc.length ? { bcc } : {}),
    ...(replyTo ? { replyTo } : {}),
    subject,
    ...(text ? { text } : {}),
    ...(html ? { html } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(Object.keys(trackingSettings).length ? { trackingSettings } : {}),
    // Webhook čuva samo događaje mejlova poslatih preko ovog API-ja
    customArgs: { [CUSTOM_ARG_MARKER]: '1' },
  };
};

// # Prevođenje SendGrid greške u odgovor; sirova greška se nikad ne loguje,
// # jer axios greška u config.headers nosi Authorization (API ključ korisnika)
export const handleSendGridError = (
  res,
  error,
  action,
  keyFingerprint,
  forbiddenMessage,
) => {
  const status = typeof error?.code === 'number' ? error.code : null;

  if (status && error.response) {
    const details = (Array.isArray(error.response.body?.errors) ? error.response.body.errors : [])
      .map((e) => [e?.message, e?.field ? `(${e.field})` : ''].filter(Boolean).join(' '))
      .filter(Boolean);

    console.error(`[SENDGRID] ${action} odbijeno`, { status, details, key: keyFingerprint });

    const message = details.length
      ? `SendGrid je odbio zahtev: ${details.join('; ')}`
      : `SendGrid je odbio zahtev (HTTP ${status})`;

    if (status === 401) {
      return fail(res, 403, 'SENDGRID_KEY_REJECTED', 'SendGrid je odbio API ključ (neispravan, obrisan ili onemogućen)', details);
    }
    if (status === 403) {
      return fail(res, 403, 'SENDGRID_FORBIDDEN', forbiddenMessage || message, details);
    }
    if (status === 413) return fail(res, 413, 'SENDGRID_PAYLOAD_TOO_LARGE', message, details);
    if (status === 429) return fail(res, 429, 'SENDGRID_RATE_LIMITED', 'Dostignut je limit zahteva na SendGrid nalogu', details);
    if (status >= 400 && status < 500) return fail(res, 400, 'SENDGRID_VALIDATION', message, details);
    return fail(res, 502, 'SENDGRID_ERROR', message, details);
  }

  console.error(`[SENDGRID] ${action} neuspešno`, {
    code: error?.code,
    message: error?.message,
    key: keyFingerprint,
  });

  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
    return fail(res, 504, 'SENDGRID_TIMEOUT', 'SendGrid nije odgovorio na vreme');
  }
  return fail(res, 502, 'SENDGRID_UNAVAILABLE', 'SendGrid servis trenutno nije dostupan');
};

/**
 * @route   POST /api/sendgrid/send
 * @desc    Slanje mejla preko SendGrid Web API-ja, sa API ključem korisnika
 * @header  {string} X-Calculus-Client-Key - Ključ klijenta (Calculus ERP)
 * @header  {string} X-SendGrid-Api-Key - SendGrid API ključ korisnika
 * @param   {string} req.body.from - Verifikovana adresa pošiljaoca
 * @param   {string} req.body.fromName - Ime pošiljaoca (opciono)
 * @param   {string|Array} req.body.to - Primaoci, niz ili string odvojen zarezom
 * @param   {string|Array} req.body.cc - Opciono
 * @param   {string|Array} req.body.bcc - Opciono
 * @param   {string} req.body.replyTo - Opciono
 * @param   {string} req.body.subject - Naslov mejla
 * @param   {string} req.body.text - Tekstualni sadržaj (text i/ili html)
 * @param   {string} req.body.html - HTML sadržaj (text i/ili html)
 * @param   {Array} req.body.attachments - Prilozi
 * @param   {string} req.body.attachments[].filename - Naziv fajla
 * @param   {string} req.body.attachments[].contentType - MIME tip fajla (opciono)
 * @param   {string} req.body.attachments[].dataBase64 - Base64 sadržaj fajla
 * @param   {string} req.body.attachments[].contentId - Za slike ugrađene u HTML (opciono)
 * @param   {boolean} req.body.trackOpens - Praćenje otvaranja (opciono, inače podešavanje naloga)
 * @param   {boolean} req.body.trackClicks - Praćenje klikova (opciono, inače podešavanje naloga)
 */
export const sendEmail = async (req, res) => {
  let apiKey;
  let message;

  try {
    apiKey = getApiKey(req);
    message = buildMessage(req.body);
  } catch (error) {
    if (error instanceof ValidationError) {
      return fail(res, 400, 'VALIDATION_ERROR', error.message);
    }
    throw error;
  }

  const keyFingerprint = fingerprint(apiKey);
  const recipientsCount =
    message.to.length + (message.cc?.length || 0) + (message.bcc?.length || 0);
  const attachmentsCount = message.attachments?.length || 0;

  try {
    const [response] = await createMailService(apiKey).send(message);
    const messageId = response?.headers?.['x-message-id'] || null;

    console.log('[SENDGRID] Mejl prihvaćen', {
      messageId,
      recipients: recipientsCount,
      attachments: attachmentsCount,
      key: keyFingerprint,
    });

    return res.status(200).json({
      success: true,
      code: 'SENT',
      messageId,
      recipients: recipientsCount,
      attachments: attachmentsCount,
    });
  } catch (error) {
    return handleSendGridError(res, error, 'Slanje mejla', keyFingerprint);
  }
};

/**
 * @route   POST /api/sendgrid/verify
 * @desc    Provera da je SendGrid API ključ ispravan i da ima dozvolu za slanje (mail.send),
 *          uz informaciju da li može da čita Email Activity i da podesi webhook
 * @header  {string} X-Calculus-Client-Key - Ključ klijenta (Calculus ERP)
 * @header  {string} X-SendGrid-Api-Key - SendGrid API ključ korisnika
 */
export const verifyApiKey = async (req, res) => {
  let apiKey;

  try {
    apiKey = getApiKey(req);
  } catch (error) {
    if (error instanceof ValidationError) {
      return fail(res, 400, 'VALIDATION_ERROR', error.message);
    }
    throw error;
  }

  const keyFingerprint = fingerprint(apiKey);

  try {
    const [, body] = await createMailService(apiKey).client.request({
      method: 'GET',
      url: '/v3/scopes',
    });
    const scopes = Array.isArray(body?.scopes) ? body.scopes : [];

    if (!scopes.includes('mail.send')) {
      return fail(
        res,
        403,
        'SENDGRID_KEY_NO_MAIL_SEND',
        'API ključ je ispravan, ali nema dozvolu za slanje mejlova (Mail Send)',
      );
    }

    // Activity API dodatno zahteva plaćeni Email Activity History dodatak, što se vidi tek pri pozivu
    return res.status(200).json({
      success: true,
      code: 'KEY_VALID',
      canSend: true,
      canReadActivity: scopes.includes('messages.read'),
      canSetupWebhook:
        scopes.includes('user.webhooks.event.settings.read') &&
        scopes.includes('user.webhooks.event.settings.update'),
    });
  } catch (error) {
    return handleSendGridError(res, error, 'Provera ključa', keyFingerprint);
  }
};
