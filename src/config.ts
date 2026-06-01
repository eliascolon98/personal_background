import path from 'path';
import fs from 'fs';

// Cargar variables de entorno desde .env si existe
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach((line: string) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=');
      if (key && value) {
        process.env[key.trim()] = value.trim();
      }
    }
  });
}

export const config = {
  twoCaptchaApiKey: process.env.TWOCAPTCHA_API_KEY || '',
  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: 'https://antecedentes.policia.gov.co:7005/WebJudicial',
  indexUrl: 'https://antecedentes.policia.gov.co:7005/WebJudicial/index.xhtml',
  consultaUrl: 'https://antecedentes.policia.gov.co:7005/WebJudicial/antecedentes.xhtml',
};
