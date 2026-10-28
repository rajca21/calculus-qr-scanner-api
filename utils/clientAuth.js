import crypto from 'crypto';

export const CLIENT_KEY_HEADER = 'x-calculus-client-key';

// Kraći ključevi se ignorišu, kako slab ključ ne bi slučajno ostao u upotrebi
const MIN_CLIENT_KEY_LENGTH = 32;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

// # Dozvoljeni ključevi klijenata (Calculus ERP), odvojeni zarezom radi rotacije
const getAllowedKeyHashes = () =>
  String(process.env.ERP_CLIENT_KEYS || '')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length >= MIN_CLIENT_KEY_LENGTH)
    .map(sha256);

/**
 * Middleware koji propušta samo zahteve sa ispravnim X-Calculus-Client-Key headerom.
 * Ako ERP_CLIENT_KEYS nije podešen, svi zahtevi se odbijaju.
 */
export const requireClientKey = (req, res, next) => {
  const allowed = getAllowedKeyHashes();

  if (!allowed.length) {
    console.error('[AUTH] ERP_CLIENT_KEYS nije podešen, zahtev je odbijen');
    return res.status(503).json({
      success: false,
      code: 'CLIENT_AUTH_NOT_CONFIGURED',
      error: 'Servis nije podešen za prijem zahteva',
    });
  }

  const provided = String(req.get(CLIENT_KEY_HEADER) || '');

  // Poređenje SHA-256 heševa jednake dužine, u konstantnom vremenu i bez ranog izlaska
  const providedHash = sha256(provided);
  let matched = false;
  for (const hash of allowed) {
    matched = crypto.timingSafeEqual(providedHash, hash) || matched;
  }

  if (!provided || !matched) {
    return res.status(401).json({
      success: false,
      code: 'CLIENT_UNAUTHORIZED',
      error: 'Klijent nije autorizovan za ovu operaciju',
    });
  }

  return next();
};
