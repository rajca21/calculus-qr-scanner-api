import { getZohoAccessToken, zohoGet } from '../utils/zoho.js';

/**
 * @route   GET /api/zoho/access-token
 * @desc    Vrati svež Zoho access token
 */
export const getAccessTokenRoute = async (req, res) => {
  try {
    const token = await getZohoAccessToken();
    return res.json({ access_token: token });
  } catch (error) {
    console.error('Greška pri generisanju access tokena:', error);
    return res.status(500).send('Greška pri generisanju access tokena');
  }
};

/**
 * @route   GET /api/zoho/requests
 * @desc    Vraća listu tiketa iz Zoho Desk
 */
export const getZohoRequests = async (req, res) => {
  try {
    const data = await zohoGet('/requests');
    return res.json({ requests: data.requests || [] });
  } catch (error) {
    console.error(
      'Greška pri povlačenju tiketa:',
      error?.response?.data || error
    );
    return res.status(500).send('Greška pri povlačenju tiketa iz Zoho Desk-a');
  }
};
