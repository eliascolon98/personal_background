import puppeteer, { Browser, Page } from 'puppeteer';
import { Solver } from '2captcha-ts';
import { config } from './config';

export interface VehiculoResult {
  success: boolean;
  placa: string;
  documento: string;
  fechaConsulta: string;
  vehiculo?: VehiculoInfo;
  error?: string;
}

export interface VehiculoInfo {
  placa: string;
  nroLicenciaTransito: string;
  estadoVehiculo: string;
  tipoServicio: string;
  claseVehiculo: string;
  marca: string;
  linea: string;
  modelo: string;
  color: string;
  numeroSerie: string;
  numeroMotor: string;
  numeroChasis: string;
  numeroVIN: string;
  cilindraje: string;
  tipoCarroceria: string;
  tipoCombustible: string;
  fechaMatriculaInicial: string;
  autoridadTransito: string;
  gravamenesPropiedad: string;
  clasicoAntiguo: string;
  repotenciado: string;
  regrabacionMotor: string;
  nroRegrabacionMotor: string;
  regrabacionChasis: string;
  nroRegrabacionChasis: string;
  regrabacionSerie: string;
  nroRegrabacionSerie: string;
  regrabacionVIN: string;
  nroRegrabacionVIN: string;
  vehiculoEnsenanza: string;
  puertas: string;
}

const RUNT_URL = 'https://portalpublico.runt.gov.co/#/consulta-vehiculo/consulta/consulta-ciudadana';

export async function consultarVehiculo(placa: string, documento: string): Promise<VehiculoResult> {
  const fechaConsulta = new Date().toISOString();

  if (!config.twoCaptchaApiKey) {
    return {
      success: false,
      placa,
      documento,
      fechaConsulta,
      error: 'No se ha configurado la API key de 2Captcha.',
    };
  }

  let browser: Browser | null = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--ignore-certificate-errors',
        '--disable-web-security',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Paso 1: Navegar a la página del RUNT
    console.log('[VEHICULO 1/4] Navegando al portal RUNT...');
    await page.goto(RUNT_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Paso 2: Llenar el formulario
    console.log('[VEHICULO 2/4] Llenando formulario...');
    await llenarFormularioVehiculo(page, placa, documento);

    // Paso 3: Resolver captcha de imagen
    console.log('[VEHICULO 3/4] Resolviendo CAPTCHA...');
    const maxIntentos = 3;
    let resultado: VehiculoInfo | null = null;

    for (let intento = 1; intento <= maxIntentos; intento++) {
      console.log(`   Intento ${intento}/${maxIntentos}...`);
      await resolverCaptchaImagen(page);

      // Hacer clic en consultar
      await clickConsultarVehiculo(page);

      // Verificar resultado
      const esValido = await verificarResultadoVehiculo(page);

      if (esValido === 'success') {
        resultado = await extraerInfoVehiculo(page);
        break;
      } else if (esValido === 'not_found') {
        return {
          success: false,
          placa,
          documento,
          fechaConsulta,
          error: 'No se encontró información del vehículo con los datos proporcionados.',
        };
      }

      // Captcha incorrecto, esperar nuevo captcha
      console.log(`   CAPTCHA incorrecto, reintentando...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (!resultado) {
      return {
        success: false,
        placa,
        documento,
        fechaConsulta,
        error: `No se pudo resolver el CAPTCHA después de ${maxIntentos} intentos.`,
      };
    }

    console.log('[VEHICULO 4/4] Consulta exitosa.');
    return {
      success: true,
      placa,
      documento,
      fechaConsulta,
      vehiculo: resultado,
    };
  } catch (error: any) {
    return {
      success: false,
      placa,
      documento,
      fechaConsulta,
      error: error.message || 'Error desconocido durante la consulta',
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function llenarFormularioVehiculo(page: Page, placa: string, documento: string): Promise<void> {
  // Esperar a que el formulario cargue (Angular app)
  await page.waitForSelector('#mat-input-6, input[formcontrolname="placa"]', { timeout: 20000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Llenar placa
  const placaInput = await page.$('#mat-input-6') || await page.$('input[formcontrolname="placa"]');
  if (placaInput) {
    await placaInput.click({ clickCount: 3 });
    await placaInput.type(placa.toUpperCase(), { delay: 50 });
  } else {
    throw new Error('No se encontró el campo de placa');
  }

  // Esperar a que aparezcan los campos de documento
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Llenar documento
  const docInput = await page.$('#mat-input-7') || await page.$('input[formcontrolname="documento"]');
  if (docInput) {
    await docInput.click({ clickCount: 3 });
    await docInput.type(documento, { delay: 50 });
  } else {
    throw new Error('No se encontró el campo de documento');
  }
}

async function resolverCaptchaImagen(page: Page): Promise<void> {
  const solver = new Solver(config.twoCaptchaApiKey, 3000);

  // Buscar la imagen del captcha (es base64 inline)
  const captchaBase64 = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    for (const img of imgs) {
      if (img.src.startsWith('data:image/png;base64,')) {
        // Verificar que sea una imagen de tamaño captcha
        const rect = img.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 30) {
          return img.src.replace('data:image/png;base64,', '');
        }
      }
    }
    return null;
  });

  if (!captchaBase64) {
    throw new Error('No se encontró la imagen del CAPTCHA');
  }

  console.log('   Enviando CAPTCHA a 2Captcha...');

  const result = await solver.imageCaptcha({
    body: captchaBase64,
    numeric: 0,
    regsense: 1,
    min_len: 4,
    max_len: 6,
    lang: 'en',
    textinstructions: 'Type the characters shown in the image. Case sensitive.',
  });

  console.log('   CAPTCHA resuelto:', result.data);

  // Escribir en el input del captcha
  const captchaInput = await page.$('#mat-input-8') || await page.$('input[formcontrolname="captcha"]');
  if (captchaInput) {
    await captchaInput.click({ clickCount: 3 });
    await captchaInput.type(result.data, { delay: 30 });
  } else {
    throw new Error('No se encontró el campo del CAPTCHA');
  }
}

async function clickConsultarVehiculo(page: Page): Promise<void> {
  // Buscar el botón "Consultar Información"
  const btn = await page.$('button[type="submit"]');
  if (btn) {
    await btn.click();
  } else {
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const b of buttons) {
        if ((b.textContent || '').includes('Consultar')) {
          b.click();
          return;
        }
      }
    });
  }

  // Esperar respuesta
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await page.waitForNetworkIdle({ timeout: 15000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

async function verificarResultadoVehiculo(page: Page): Promise<'success' | 'not_found' | 'captcha_error'> {
  const result = await page.evaluate(() => {
    // Verificar si hay resultado de vehículo
    const infoVehiculo = document.querySelector('cyrconsultavehiculo-info-vehiculo-detallada');
    if (infoVehiculo && infoVehiculo.textContent && infoVehiculo.textContent.trim().length > 50) {
      return 'success';
    }

    // Verificar si hay modal de "no encontrado"
    const modals = Array.from(document.querySelectorAll('mat-dialog-container, .mat-dialog-container, .cdk-overlay-pane'));
    for (const modal of modals) {
      const text = (modal.textContent || '').toLowerCase();
      if (text.includes('no se encontr') || text.includes('no existe') || text.includes('sin resultado')) {
        return 'not_found';
      }
    }

    // Verificar mensajes de error
    const snackbar = document.querySelector('.mat-snack-bar-container, mat-snack-bar-container');
    if (snackbar) {
      const text = (snackbar.textContent || '').toLowerCase();
      if (text.includes('no se encontr') || text.includes('no existe')) {
        return 'not_found';
      }
    }

    return 'captcha_error';
  });

  return result as 'success' | 'not_found' | 'captcha_error';
}

async function extraerInfoVehiculo(page: Page): Promise<VehiculoInfo> {
  const info = await page.evaluate(() => {
    const getText = (label: string): string => {
      // Buscar en mat-card con strong
      const cards = Array.from(document.querySelectorAll('mat-card p'));
      for (const card of cards) {
        const strong = card.querySelector('strong');
        if (strong && strong.textContent && strong.textContent.includes(label)) {
          const fullText = card.textContent || '';
          return fullText.replace(strong.textContent, '').trim();
        }
      }
      // Buscar en filas label/b
      const labels = Array.from(document.querySelectorAll('label'));
      for (const lbl of labels) {
        if (lbl.textContent && lbl.textContent.includes(label)) {
          const row = lbl.closest('.row');
          if (row) {
            const bolds = row.querySelectorAll('b');
            // Buscar el b que está después del label
            const parent = lbl.parentElement;
            if (parent && parent.nextElementSibling) {
              const b = parent.nextElementSibling.querySelector('b');
              if (b) return b.textContent?.trim() || '';
            }
          }
        }
      }
      return '';
    };

    return {
      placa: getText('PLACA DEL VEHÍCULO'),
      nroLicenciaTransito: getText('Nro. de licencia de tránsito'),
      estadoVehiculo: getText('Estado del vehículo'),
      tipoServicio: getText('Tipo de servicio'),
      claseVehiculo: getText('Clase de vehículo'),
      marca: getText('Marca:'),
      linea: getText('Línea:'),
      modelo: getText('Modelo:'),
      color: getText('Color:'),
      numeroSerie: getText('Número de serie:'),
      numeroMotor: getText('Número de motor:'),
      numeroChasis: getText('Número de chasis:'),
      numeroVIN: getText('Número de VIN:'),
      cilindraje: getText('Cilindraje:'),
      tipoCarroceria: getText('Tipo de carrocería:'),
      tipoCombustible: getText('Tipo Combustible:'),
      fechaMatriculaInicial: getText('Fecha de Matricula Inicial:'),
      autoridadTransito: getText('Autoridad de tránsito:'),
      gravamenesPropiedad: getText('Gravámenes a la propiedad:'),
      clasicoAntiguo: getText('Clásico o Antiguo:'),
      repotenciado: getText('Repotenciado:'),
      regrabacionMotor: getText('Regrabación motor'),
      nroRegrabacionMotor: getText('Nro. regrabación motor:'),
      regrabacionChasis: getText('Regrabación chasis'),
      nroRegrabacionChasis: getText('Nro. regrabación chasis:'),
      regrabacionSerie: getText('Regrabación serie'),
      nroRegrabacionSerie: getText('Nro. regrabación serie:'),
      regrabacionVIN: getText('Regrabación VIN'),
      nroRegrabacionVIN: getText('Nro. regrabación VIN:'),
      vehiculoEnsenanza: getText('Vehículo Enseñanza'),
      puertas: getText('Puertas:'),
    };
  });

  return info;
}
