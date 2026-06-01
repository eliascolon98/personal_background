import puppeteer, { Browser, Page } from 'puppeteer';
import { Solver } from '2captcha-ts';
import { config } from './config';

export interface ConsultaResult {
  success: boolean;
  documento: string;
  nombre?: string;
  tieneAntecedentes: boolean;
  mensaje: string;
  fechaConsulta: string;
  horaConsulta?: string;
  error?: string;
}

export async function consultarAntecedentes(documento: string): Promise<ConsultaResult> {
  const fechaConsulta = new Date().toISOString();

  if (!config.twoCaptchaApiKey) {
    return {
      success: false,
      documento,
      tieneAntecedentes: false,
      mensaje: '',
      fechaConsulta,
      error: 'No se ha configurado la API key de 2Captcha. Configura TWOCAPTCHA_API_KEY en el archivo .env',
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
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Paso 1: Ir a la página de términos y condiciones
    console.log('[1/5] Navegando a la página de términos y condiciones...');
    await page.goto(config.indexUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    // Paso 2: Hacer scroll en el contenedor de términos y condiciones
    console.log('[2/5] Haciendo scroll en los términos y condiciones...');
    await scrollTerminos(page);

    // Paso 3: Hacer clic en "Aceptar"
    console.log('[3/5] Aceptando términos y condiciones...');
    await aceptarTerminos(page);

    // Verificar que estamos en la página de antecedentes
    // Esperar a que el input de cédula esté disponible
    await page.waitForSelector('#cedulaInput', { timeout: 20000 });

    // Debug: ver estado de la página de antecedentes
    const debugAntecedentes = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      return {
        url: window.location.href,
        inputCount: inputs.length,
        inputTypes: inputs.map(i => ({ id: i.id, type: i.type, name: i.name })),
        forms: document.querySelectorAll('form').length,
        hasRecaptcha: !!document.querySelector('.g-recaptcha, [data-sitekey], iframe[src*="recaptcha"]'),
        bodyLength: document.body.innerHTML.length,
      };
    });
    console.log('   Debug página antecedentes:', JSON.stringify(debugAntecedentes, null, 2));

    // Paso 4: Llenar el formulario
    console.log('[4/5] Llenando formulario con documento:', documento);
    await llenarFormulario(page, documento);

    // Paso 5: Resolver CAPTCHA con reintentos
    const maxIntentos = 2;
    let resultado: ResultadoParsed | null = null;

    for (let intento = 1; intento <= maxIntentos; intento++) {
      console.log(`[5/5] Resolviendo CAPTCHA (intento ${intento}/${maxIntentos})...`);
      await resolverCaptcha(page);

      // Hacer clic en consultar
      await clickConsultar(page);

      // Debug: ver qué hay en la página
      const pageContent = await page.evaluate(() => {
        const el = document.querySelector('[id="form:mensajeCiudadano"]')
          || document.querySelector('span[id*="mensajeCiudadano"]');
        return {
          mensajeElement: el ? el.textContent?.substring(0, 200) : 'NO ENCONTRADO',
          url: window.location.href,
          bodyLength: (document.body.innerHTML || '').length,
          bodyHTML: document.body.innerHTML?.substring(0, 500),
          forms: document.querySelectorAll('form').length,
          inputs: document.querySelectorAll('input').length,
          images: document.querySelectorAll('img').length,
        };
      });
      console.log('   Debug página después de consultar:', JSON.stringify(pageContent, null, 2));

      // Verificar si el resultado es válido
      // Esperar a que aparezca el elemento de resultado o un mensaje de error de captcha
      const tieneResultadoValido = await page.evaluate((doc) => {
        // Buscar el span de resultado con diferentes métodos
        const el = document.querySelector('[id="form:mensajeCiudadano"]')
          || document.querySelector('#form\\:mensajeCiudadano')
          || document.querySelector('span[id*="mensajeCiudadano"]');
        if (el) {
          const texto = el.textContent || '';
          // Verificar que contiene información real (el número de documento)
          if (texto.includes(doc) || texto.includes('NO TIENE ASUNTOS PENDIENTES') || texto.includes('autoridades judiciales')) {
            return true;
          }
        }
        // También verificar en todo el body
        const bodyText = document.body.textContent || '';
        if (bodyText.includes('Policía Nacional de Colombia informa') || 
            (bodyText.includes(doc) && bodyText.includes('Apellidos y Nombres'))) {
          return true;
        }
        return false;
      }, documento);

      if (tieneResultadoValido) {
        resultado = await obtenerResultado(page);
        break;
      }

      console.log(`   CAPTCHA incorrecto en intento ${intento}, reintentando...`);

      // Si no es el último intento, la página ya se recargó con un nuevo captcha
      // Solo necesitamos esperar a que el formulario esté listo de nuevo
      if (intento < maxIntentos) {
        // Esperar a que la página tenga el formulario listo
        await page.waitForSelector('form, input', { timeout: 10000 }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 1000));
        
        // Verificar si necesitamos volver a llenar el documento
        const needsRefill = await page.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
          for (const input of inputs) {
            if ((input as HTMLInputElement).value.length > 3) return false;
          }
          return true;
        });
        
        if (needsRefill) {
          await llenarFormulario(page, documento);
        }
      }
    }

    if (!resultado) {
      return {
        success: false,
        documento,
        tieneAntecedentes: false,
        mensaje: '',
        fechaConsulta,
        error: `No se pudo resolver el CAPTCHA después de ${maxIntentos} intentos. Por favor intenta de nuevo.`,
      };
    }

    return {
      success: true,
      documento,
      nombre: resultado.nombre,
      tieneAntecedentes: resultado.tieneAntecedentes,
      mensaje: resultado.mensaje,
      fechaConsulta,
      horaConsulta: resultado.horaConsulta,
    };
  } catch (error: any) {
    return {
      success: false,
      documento,
      tieneAntecedentes: false,
      mensaje: '',
      fechaConsulta,
      error: error.message || 'Error desconocido durante la consulta',
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function scrollTerminos(page: Page): Promise<void> {
  // El contenedor de términos es un div PrimeFaces ScrollPanel con id "j_idt19"
  const scrollPanel = await page.$('#j_idt19');

  if (scrollPanel) {
    await page.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    }, scrollPanel);
  } else {
    // Fallback: buscar el scrollpanel por clase
    const panel = await page.$('.ui-scrollpanel');
    if (panel) {
      await page.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      }, panel);
    } else {
      // Último fallback: scroll general
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
    }
  }

  // Esperar un momento
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

async function aceptarTerminos(page: Page): Promise<void> {
  // 1. Hacer clic en el radio button "Acepto"
  await page.evaluate(() => {
    const radio = document.querySelector('input[id="aceptaOption:0"]') as HTMLInputElement;
    if (radio) {
      radio.checked = true;
      radio.click();
      // Disparar el evento de PrimeFaces manualmente
      // @ts-ignore
      if (typeof PrimeFaces !== 'undefined') {
        // @ts-ignore
        PrimeFaces.ab({s: radio, e: "valueChange", f: "form", p: "aceptaOption", u: "continuarBtn"});
      }
    }
  });

  // 2. Esperar a que PrimeFaces habilite el botón
  await new Promise((resolve) => setTimeout(resolve, 4000));

  // 3. Verificar si el botón se habilitó
  const btnDisabled = await page.evaluate(() => {
    const btn = document.querySelector('#continuarBtn') as HTMLButtonElement;
    return btn ? btn.disabled : true;
  });

  console.log('   Botón continuarBtn disabled:', btnDisabled);

  // 4. Habilitar el botón forzosamente y hacer clic
  await page.evaluate(() => {
    const btn = document.querySelector('#continuarBtn') as HTMLButtonElement;
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('ui-state-disabled');
      btn.setAttribute('aria-disabled', 'false');
    }
  });

  // 5. Hacer clic y esperar navegación
  try {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }),
      page.click('#continuarBtn'),
    ]);
  } catch {
    // Si el click no navega, forzar con el callback del botón
    console.log('   Click en botón no navegó, forzando redirección...');
    try {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }),
        page.evaluate(() => {
          window.location.href = '/WebJudicial/antecedentes.xhtml';
        }),
      ]);
    } catch {
      // Último intento
      await page.goto(config.consultaUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    }
  }

  const finalUrl = page.url();
  console.log('   URL final después de aceptar:', finalUrl);

  // Si seguimos en index, capturar el HTML para debug
  if (!finalUrl.includes('antecedentes')) {
    const pageInfo = await page.evaluate(() => ({
      url: window.location.href,
      title: document.title,
      bodySnippet: document.body.textContent?.substring(0, 200),
    }));
    console.log('   ERROR: No se llegó a antecedentes:', JSON.stringify(pageInfo));
    throw new Error('No se pudo navegar a la página de antecedentes después de aceptar términos');
  }
}

async function llenarFormulario(page: Page, documento: string): Promise<void> {
  // Esperar a que el input del documento esté disponible
  await page.waitForSelector('#cedulaInput', { timeout: 15000 }).catch(() => {});

  const input = await page.$('#cedulaInput');
  if (input) {
    await input.click({ clickCount: 3 });
    await input.type(documento, { delay: 50 });
    return;
  }

  // Fallback: buscar por name
  await page.waitForSelector('input[name="cedulaInput"]', { timeout: 5000 }).catch(() => {});
  const inputByName = await page.$('input[name="cedulaInput"]');
  if (inputByName) {
    await inputByName.click({ clickCount: 3 });
    await inputByName.type(documento, { delay: 50 });
    return;
  }

  throw new Error('No se pudo encontrar el campo de número de documento');
}

async function resolverCaptcha(page: Page): Promise<void> {
  const solver = new Solver(config.twoCaptchaApiKey, 3000);

  console.log('   Buscando reCAPTCHA en la página...');

  // El sitekey conocido de esta página
  const KNOWN_SITEKEY = '6LcsIwQaAAAAAFCsaI-dkR6hgKsZwwJRsmE0tIJH';

  // Intentar obtener el sitekey del DOM, si no usar el conocido
  let sitekey = await page.evaluate(() => {
    // Buscar en iframe src
    const iframe = document.querySelector('iframe[src*="recaptcha"]') as HTMLIFrameElement;
    if (iframe) {
      const src = iframe.getAttribute('src') || '';
      const match = src.match(/[?&]k=([^&]+)/);
      if (match) return match[1];
    }
    // Buscar en data-sitekey
    const el = document.querySelector('[data-sitekey]');
    if (el) return el.getAttribute('data-sitekey');
    return null;
  });

  if (!sitekey) {
    // Buscar en el HTML fuente
    const content = await page.content();
    const match = content.match(/[?&]k=([^&"']+)/);
    if (match) sitekey = match[1];
  }

  // Usar el sitekey conocido como fallback
  if (!sitekey) {
    sitekey = KNOWN_SITEKEY;
  }

  console.log('   reCAPTCHA sitekey:', sitekey);
  console.log('   Enviando reCAPTCHA a 2Captcha para resolución...');

  // Resolver reCAPTCHA v2 con 2Captcha
  const result = await solver.recaptcha({
    pageurl: page.url(),
    googlekey: sitekey,
  });

  console.log('   reCAPTCHA resuelto, inyectando token...');

  // Inyectar el token en el textarea de g-recaptcha-response
  await page.evaluate((token) => {
    const textarea = document.querySelector('#g-recaptcha-response') as HTMLTextAreaElement;
    if (textarea) {
      textarea.style.display = 'block';
      textarea.value = token;
    }
    // También buscar por name
    const byName = document.querySelector('textarea[name="g-recaptcha-response"]') as HTMLTextAreaElement;
    if (byName) {
      byName.style.display = 'block';
      byName.value = token;
    }
  }, result.data);

  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function clickConsultar(page: Page): Promise<void> {
  // El botón de consultar es #j_idt17
  const btn = await page.$('#j_idt17');
  if (btn) {
    await btn.click();
  } else {
    // Fallback: buscar por texto
    const clicked = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('button, input[type="submit"]'));
      for (const el of elements) {
        const text = (el.textContent || '').trim().toLowerCase();
        if (text.includes('consultar')) {
          (el as HTMLElement).click();
          return true;
        }
      }
      return false;
    });
    if (!clicked) throw new Error('No se pudo encontrar el botón de consultar');
  }

  // Esperar a que aparezca el resultado
  try {
    await page.waitForFunction(() => {
      const el = document.querySelector('[id="form:mensajeCiudadano"]')
        || document.querySelector('span[id*="mensajeCiudadano"]');
      if (el && el.textContent && el.textContent.trim().length > 10) return true;
      return false;
    }, { timeout: 20000 });
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

interface ResultadoParsed {
  nombre: string;
  tieneAntecedentes: boolean;
  mensaje: string;
  horaConsulta: string;
}

async function obtenerResultado(page: Page): Promise<ResultadoParsed> {
  // Esperar a que aparezca el resultado
  await page.waitForSelector('#form\\:mensajeCiudadano', { timeout: 15000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const resultado = await page.evaluate(() => {
    const el = document.querySelector('#form\\:mensajeCiudadano') || document.querySelector('[id="form:mensajeCiudadano"]');
    if (!el) {
      return { texto: '', html: '' };
    }
    return {
      texto: el.textContent || '',
      html: el.innerHTML || '',
    };
  });

  const texto = resultado.texto;

  // Extraer nombre
  const nombreMatch = texto.match(/Apellidos y Nombres:\s*(.+?)(?:\n|NO TIENE|TIENE)/i);
  const nombre = nombreMatch ? nombreMatch[1].trim() : '';

  // Extraer hora
  const horaMatch = texto.match(/siendo las\s*([\d:]+\s*[APM]+)\s*horas/i);
  const horaConsulta = horaMatch ? horaMatch[1] : '';

  // Determinar si tiene antecedentes
  const noTieneAsuntos = texto.includes('NO TIENE ASUNTOS PENDIENTES CON LAS AUTORIDADES JUDICIALES');

  if (noTieneAsuntos) {
    return {
      nombre,
      tieneAntecedentes: false,
      mensaje: 'NO TIENE ASUNTOS PENDIENTES CON LAS AUTORIDADES JUDICIALES',
      horaConsulta,
    };
  } else {
    return {
      nombre,
      tieneAntecedentes: true,
      mensaje: 'TIENE ASUNTOS PENDIENTES CON LAS AUTORIDADES JUDICIALES',
      horaConsulta,
    };
  }
}
