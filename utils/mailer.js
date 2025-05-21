import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { compileTemplate } from './emailTemplateCompiler.js';

dotenv.config();

// Object for sending emails, with account details from .env file
const transporter = nodemailer.createTransport({
  host: 'smtp.office365.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.NODEMAILER_MAIL,
    pass: process.env.NODEMAILER_PASSWORD,
  },
  tls: {
    ciphers: 'SSLv3',
  },
});

export const sendMail = async (template, from, to, subject, text) => {
  try {
    const htmlContent = await compileTemplate(template);

    await transporter.sendMail({
      from,
      to,
      subject,
      html: htmlContent,
      text,
    });
  } catch (error) {
    console.error('Error sending email:', error);
  }
};

export const sendMailToSupport = async (text) => {
  try {
    await transporter.sendMail({
      from: process.env.NODEMAILER_MAIL,
      to: process.env.SUPPORT_MAIL,
      subject: 'Registrovan novi korisnik',
      html: text,
      text,
    });
  } catch (error) {
    console.error('Error sending email:', error);
  }
};
