import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs/promises';
import fsSync from 'fs';
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
    return res.status(500).send('Greška pri povlačenju tiketa iz Zoho Desk');
  }
};

/**
 * @route   POST /api/zoho/requests/create
 * @desc    Kreira novi Zoho Desk request
 */
export const createZohoRequest = async (req, res) => {
  try {
    const token = await getZohoAccessToken();
    const { subject, description, requester_email, priority } = req.body;

    if (!subject) {
      return res.status(400).json({ error: 'Subject je obavezan' });
    }

    const requestData = {
      request: {
        subject,
        description: description
          ? `<p>${description}</p>`
          : '<p>No description</p>',
      },
    };

    if (requester_email) {
      requestData.request.requester = { email_id: requester_email };
    }

    if (priority) {
      requestData.request.priority = { name: priority };
    }

    const createResponse = await axios.post(
      `${process.env.ZOHO_BASE_URL}/requests`,
      { input_data: JSON.stringify(requestData) },
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          Accept: 'application/vnd.manageengine.sdp.v3+json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const requestId = createResponse.data.request.id;

    const uploadedFiles = [];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const form = new FormData();
        form.append(
          'filename',
          fsSync.createReadStream(file.path),
          file.originalname
        );
        form.append('addtoattachment', 'true');

        const uploadResp = await axios.post(
          `${process.env.ZOHO_BASE_URL}/requests/${requestId}/_uploads`,
          form,
          {
            headers: {
              Authorization: `Zoho-oauthtoken ${token}`,
              Accept: 'application/vnd.manageengine.sdp.v3+json',
              ...form.getHeaders(),
            },
            maxBodyLength: Infinity,
          }
        );

        uploadedFiles.push(uploadResp.data);

        await fs.unlink(file.path);
      }
    }

    return res.json({
      status: 'success',
      request: createResponse.data.request,
      attachments: uploadedFiles,
    });
  } catch (error) {
    console.log(
      'Create Zoho Request Error:',
      JSON.stringify(error?.response?.data || error, null, 2)
    );

    return res.status(500).json({
      error: 'Zoho request creation failed',
      details: error?.response?.data || error,
    });
  }
};
