import { Resend } from 'resend';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function normalizeRecipients(input) {
  if (!input) return [];

  if (Array.isArray(input)) {
    return input.map((x) => String(x).trim()).filter(Boolean);
  }

  const value = String(input).trim();

  return value
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseBoolean(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function normalizeUploadedAttachments(files) {
  if (!Array.isArray(files) || files.length === 0) return [];

  return files.map((file) => ({
    filename: String(file.originalname || 'file.bin').trim(),
    content: file.buffer.toString('base64'),
    ...(file.mimetype ? { contentType: file.mimetype } : {}),
  }));
}

/**
 * POST /api/resend/send
 * Content-Type: multipart/form-data
 *
 * Form-data fields:
 * - to                  -> "a@test.com" ili "a@test.com,b@test.com"
 * - cc                  -> opciono
 * - bcc                 -> opciono
 * - from                -> obavezno
 * - subject             -> obavezno
 * - resendApiKey        -> obavezno
 * - replyTo             -> opciono
 * - text                -> opciono
 * - html                -> opciono
 * - isHtmlFile          -> opciono: true/false
 * - attachments         -> 0..10 fajlova
 *
 * Napomena:
 * - Mora postojati bar jedno od: text ili html
 * - Ako isHtmlFile=true, prvi uploadovani fajl se čita kao HTML body,
 *   a ostali fajlovi idu kao attachmenti.
 */
export const sendEmailViaResend = async (req, res) => {
  try {
    const {
      to,
      cc,
      bcc,
      subject,
      text,
      html,
      resendApiKey,
      from,
      replyTo,
      isHtmlFile,
    } = req.body || {};

    const apiKey = String(resendApiKey || '').trim();
    const finalFrom = String(from || '').trim();
    const finalSubject = String(subject || '').trim();

    const recipients = normalizeRecipients(to);
    const ccRecipients = normalizeRecipients(cc);
    const bccRecipients = normalizeRecipients(bcc);

    if (!apiKey) {
      return res.status(400).json({
        error: 'Resend API ključ mora biti prosleđen',
      });
    }

    if (!finalFrom) {
      return res.status(400).json({
        error: 'Pošiljalac mejla mora biti prosleđen',
      });
    }

    if (!finalSubject) {
      return res.status(400).json({
        error: 'Naslov mejla mora biti prosleđen',
      });
    }

    if (!recipients.length) {
      return res.status(400).json({
        error: 'Primalac mejla mora biti prosleđen',
      });
    }

    for (const email of [...recipients, ...ccRecipients, ...bccRecipients]) {
      if (!isValidEmail(email)) {
        return res.status(400).json({
          error: `Neispravna email adresa: ${email}`,
        });
      }
    }

    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    const useHtmlFile = parseBoolean(isHtmlFile);

    let finalHtml = '';
    let finalText = '';
    let attachmentFiles = uploadedFiles;

    if (useHtmlFile) {
      if (uploadedFiles.length === 0) {
        return res.status(400).json({
          error:
            'Za HTML mejl mora biti prosleđen bar jedan fajl sa HTML sadržajem',
        });
      }

      const htmlFile = uploadedFiles[0];
      finalHtml = htmlFile.buffer.toString('utf8');

      // svi ostali fajlovi idu kao attachmenti
      attachmentFiles = uploadedFiles.slice(1);
    } else if (html) {
      finalHtml = String(html);
    } else if (text) {
      finalText = String(text);
    } else {
      return res.status(400).json({
        error:
          'Telo mejla nije prosleđeno. Potrebno je poslati ili text ili html sadržaj.',
      });
    }

    const normalizedAttachments = normalizeUploadedAttachments(attachmentFiles);

    const resend = new Resend(apiKey);

    const payload = {
      from: finalFrom,
      to: recipients,
      subject: finalSubject,
      ...(ccRecipients.length ? { cc: ccRecipients } : {}),
      ...(bccRecipients.length ? { bcc: bccRecipients } : {}),
      ...(replyTo ? { replyTo: String(replyTo).trim() } : {}),
      ...(finalHtml ? { html: finalHtml } : {}),
      ...(finalText ? { text: finalText } : {}),
      ...(normalizedAttachments.length
        ? { attachments: normalizedAttachments }
        : {}),
    };

    const { data, error } = await resend.emails.send(payload);

    if (error) {
      return res.status(502).json({
        error: 'Greška prilikom slanja mejla preko Resend servisa',
        resend_error: error,
        sent_payload_preview: {
          from: payload.from,
          to: payload.to,
          cc: payload.cc,
          bcc: payload.bcc,
          subject: payload.subject,
          hasHtml: Boolean(payload.html),
          hasText: Boolean(payload.text),
          attachmentsCount: normalizedAttachments.length,
        },
      });
    }

    return res.status(200).json({
      status: 'success',
      provider: 'resend',
      data,
      meta: {
        to: recipients,
        cc: ccRecipients,
        bcc: bccRecipients,
        subject: finalSubject,
        from: finalFrom,
        hasHtml: Boolean(finalHtml),
        hasText: Boolean(finalText),
        attachmentsCount: normalizedAttachments.length,
        uploadedFilesCount: uploadedFiles.length,
        usedHtmlFile: useHtmlFile,
      },
    });
  } catch (e) {
    console.error('Greška:', {
      message: e?.message,
      stack: e?.stack,
      response: e?.response?.data,
      status: e?.response?.status,
    });

    return res.status(500).json({
      error: 'Došlo je do greške prilikom obrade zahteva',
      message: e?.message,
      status: e?.response?.status,
      provider_response: e?.response?.data,
    });
  }
};
