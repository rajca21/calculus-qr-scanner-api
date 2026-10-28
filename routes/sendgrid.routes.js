import express from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { requireClientKey } from '../utils/clientAuth.js';
import { sendEmail, verifyApiKey } from '../controllers/sendgrid.controller.js';
import {
  receiveEvents,
  removeWebhook,
  setupWebhook,
} from '../controllers/sendgridWebhook.controller.js';
import { getMessagesStatus } from '../controllers/sendgridStatus.controller.js';

const router = express.Router();

// IIS (ANCM) šalje X-Forwarded-For kao "ip:port", pa se port uklanja,
// inače svaka konekcija dobija svoj limit
const clientIp = (ip) => {
  const value = String(ip || '');
  const ipv6 = value.match(/^\[(.+)\]:\d+$/);
  if (ipv6) return ipv6[1];
  const ipv4 = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  return ipv4 ? ipv4[1] : value;
};

const createLimiter = (limit) =>
  rateLimit({
    windowMs: 60 * 1000,
    limit,
    keyGenerator: (req) => ipKeyGenerator(clientIp(req.ip)),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        error: 'Previše zahteva, pokušajte ponovo za minut',
      }),
  });

const limiter = createLimiter(Number(process.env.SENDGRID_RATE_LIMIT_PER_MINUTE) || 60);
// SendGrid šalje događaje u serijama sa malog broja IP adresa, pa je limit veći
const eventsLimiter = createLimiter(600);

// SendGrid se autorizuje potpisom (ne ključem klijenta), a potpis se proverava nad sirovim telom
router.post(
  '/events/:accountId',
  eventsLimiter,
  express.raw({ type: () => true, limit: '5mb' }),
  receiveEvents,
);

// Limit i provera klijenta idu pre parsiranja tela, kako neautorizovan zahtev ne bi parsirao do 32 MB
router.use(limiter, requireClientKey);

router.use((req, res, next) => {
  if (req.method === 'POST' && !req.is('application/json')) {
    return res.status(415).json({
      success: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      error: 'Zahtev mora imati Content-Type: application/json; charset=utf-8',
    });
  }
  return next();
});

// 20 MB priloga u base64 zapisu je oko 27 MB, ostatak je za text/html
router.use(express.raw({ type: 'application/json', limit: '32mb' }));

// Telo se dekodira eksplicitno: neispravan UTF-8 se odbija (umesto da slova postanu "�"),
// a windows-1250 je podržan jer PowerBuilder na srpskom Windows-u šalje ANSI tekst u tom kodiranju
router.use((req, res, next) => {
  if (!Buffer.isBuffer(req.body)) return next();

  const charset = (
    String(req.get('content-type') || '').match(/;\s*charset\s*=\s*"?([\w-]+)"?/i)?.[1] || 'utf-8'
  ).toLowerCase();
  const encoding = { 'utf-8': 'utf-8', utf8: 'utf-8', 'windows-1250': 'windows-1250', cp1250: 'windows-1250' }[charset];

  if (!encoding) {
    return res.status(415).json({
      success: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      error: 'Podržana kodiranja tela su utf-8 i windows-1250',
    });
  }

  let text;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(req.body);
  } catch {
    return res.status(400).json({
      success: false,
      code: 'INVALID_ENCODING',
      error:
        'Telo zahteva nije ispravan UTF-8. Pošaljite tekst u UTF-8 kodiranju ili navedite Content-Type: application/json; charset=windows-1250',
    });
  }

  try {
    req.body = text.trim() ? JSON.parse(text) : {};
  } catch {
    return res.status(400).json({
      success: false,
      code: 'INVALID_JSON',
      error: 'Telo zahteva nije ispravan JSON',
    });
  }
  return next();
});

router.post('/send', sendEmail);
router.post('/verify', verifyApiKey);
router.post('/webhook/setup', setupWebhook);
router.delete('/webhook', removeWebhook);
router.post('/messages/status', getMessagesStatus);

// Greške parsera se ne loguju, jer err.body sadrži ceo sadržaj mejla
router.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      code: 'PAYLOAD_TOO_LARGE',
      error: 'Zahtev je veći od dozvoljene veličine',
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      code: 'INVALID_JSON',
      error: 'Telo zahteva nije ispravan JSON',
    });
  }
  if (err?.type === 'encoding.unsupported') {
    return res.status(415).json({
      success: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      error: 'Content-Encoding zahteva nije podržan',
    });
  }

  console.error('[SENDGRID] Neočekivana greška', { name: err?.name, message: err?.message });
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    error: 'Došlo je do greške prilikom obrade zahteva',
  });
});

export default router;
