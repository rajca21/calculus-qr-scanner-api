import express from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { requireClientKey } from '../utils/clientAuth.js';
import { sendEmail, verifyApiKey } from '../controllers/sendgrid.controller.js';

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

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.SENDGRID_RATE_LIMIT_PER_MINUTE) || 60,
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
router.use(express.json({ limit: '32mb' }));

router.post('/send', sendEmail);
router.post('/verify', verifyApiKey);

// Greške parsera se ne loguju, jer err.body sadrži ceo sadržaj mejla
router.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      code: 'PAYLOAD_TOO_LARGE',
      error: 'Zahtev je veći od dozvoljenih 32 MB',
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      code: 'INVALID_JSON',
      error: 'Telo zahteva nije ispravan JSON',
    });
  }
  if (err?.type === 'charset.unsupported' || err?.type === 'encoding.unsupported') {
    return res.status(415).json({
      success: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      error: 'Telo zahteva mora biti u UTF-8 kodiranju',
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
