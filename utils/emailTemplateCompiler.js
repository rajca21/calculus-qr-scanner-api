import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mjml2html from 'mjml';
import handlebars from 'handlebars';

handlebars.registerHelper('currentYear', () => new Date().getFullYear());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const compileTemplate = async (templateName) => {
  const templatePath = path.join(
    __dirname,
    '../templates',
    `${templateName}.mjml`
  );
  const templateFile = fs.readFileSync(templatePath, 'utf8');

  const mjmlResult = mjml2html(templateFile);
  if (mjmlResult.errors.length > 0) {
    throw new Error(`MJML compilation errors: ${mjmlResult.errors.join(', ')}`);
  }

  const template = handlebars.compile(mjmlResult.html);
  return template({
    currentYear: new Date().getFullYear(),
  });
};
