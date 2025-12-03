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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );

  return resp.data.access_token;
};

/**
 * Wrapper za Zoho Desk GET API
 */
export const zohoGet = async (endpoint) => {
  const token = await getZohoAccessToken();

  const resp = await axios.get(`${process.env.ZOHO_BASE_URL}${endpoint}`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept: 'application/vnd.manageengine.sdp.v3+json',
    },
  });

  return resp.data;
};
