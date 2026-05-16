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
  method,
  endpoint,
  token,
  data,
  headers = {},
}) => {
  return axios({
    method,
    url: `${process.env.ZOHO_BASE_URL}${endpoint}`,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept: 'application/vnd.manageengine.sdp.v3+json',
      ...headers,
    },
    data,
    validateStatus: () => true,
    maxBodyLength: Infinity,
  });
};
