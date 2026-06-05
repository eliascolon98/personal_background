import puppeteer, { Browser, Page } from 'puppeteer';

export interface SimitResumen {
  comparendosCount: number;
  multasCount: number;
  acuerdosPago: number;
  nombre: string;
  total: string;
}

export interface Comparendo {
  numero: string;
  tipo: string;
  fechaImposicion: string;
  notificacion: string;
  placa: string;
  secretaria: string;
  infraccion: string;
  estado: string;
  valor: string;
  valorAPagar: string;
}

export interface SimitResult {
  success: boolean;
  busqueda: string;
  fechaConsulta: string;
  resumen?: SimitResumen;
  comparendos: Comparendo[];
  totalComparendos: number;
  error?: string;
}

const SIMIT_URL = 'https://www.fcm.org.co/simit/#/home-public';

export async function consultarSimit(busqueda: string): Promise<SimitResult> {
  const fechaConsulta = new Date().toISOString();
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
    await page.setViewport({ width: 1440, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );

    // ── 1. Navigate ──────────────────────────────────────────────
    console.log('[SIMIT 1/4] Navegando...');
    await page.goto(SIMIT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for the SPA to render the search input
    await page.waitForSelector('#txtBusqueda', { visible: true, timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    // ── 2. Fill input via evaluate (bypass Angular/Vue reactivity) ─
    console.log('[SIMIT 2/4] Llenando campo de búsqueda...');
    await page.evaluate((val: string) => {
      const input = document.querySelector('#txtBusqueda') as HTMLInputElement | null;
      if (!input) throw new Error('No se encontró #txtBusqueda');
      input.focus();
      input.value = val;
      ['input', 'change', 'keyup'].forEach((ev) =>
        input.dispatchEvent(new Event(ev, { bubbles: true })),
      );
    }, busqueda);
    await new Promise((r) => setTimeout(r, 600));

    // ── 3. Click and wait for the page to settle (navigation or AJAX) ─
    console.log('[SIMIT 3/4] Enviando búsqueda...');

    // Start navigation listener BEFORE clicking so we don't miss it
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
      page.evaluate(() => {
        const btn = document.querySelector('#consultar') as HTMLElement | null;
        if (!btn) throw new Error('No se encontró el botón #consultar');
        btn.click();
      }),
    ]);

    // Extra settle time after navigation/AJAX
    await new Promise((r) => setTimeout(r, 3000));

    const afterNav = await page.evaluate(() => ({
      url: window.location.href,
      hasResumen: !!document.querySelector('#resumenEstadoCuenta'),
      hasTable:   !!document.querySelector('#multaTable'),
    }));
    console.log('[SIMIT] URL después de búsqueda:', afterNav.url);
    console.log('[SIMIT] resumen:', afterNav.hasResumen, ' tabla:', afterNav.hasTable);

    // ── 4. Poll until rows render OR confirmed empty ─────────────
    console.log('[SIMIT 4/4] Esperando resultados...');
    const pollState = await pollForResults(page, 45000);
    console.log('[SIMIT] Estado poll:', pollState);

    if (pollState === 'empty') {
      return { success: true, busqueda, fechaConsulta, comparendos: [], totalComparendos: 0 };
    }

    if (pollState === 'timeout') {
      const debug = await page.evaluate(() => ({
        url: window.location.href,
        hasResumen: !!document.querySelector('#resumenEstadoCuenta'),
        hasTable:   !!document.querySelector('#multaTable'),
        rows:       document.querySelectorAll('#multaTable tbody tr').length,
        bodySnippet: (document.body.textContent || '').substring(0, 400),
      }));
      console.log('[SIMIT] Timeout debug:', JSON.stringify(debug));
      // Don't throw — try to extract whatever is there
    }

    const resumen     = await extraerResumen(page);
    const comparendos = await extraerComparendos(page);
    console.log(`[SIMIT] Comparendos extraídos: ${comparendos.length}`);

    return { success: true, busqueda, fechaConsulta, resumen, comparendos, totalComparendos: comparendos.length };
  } catch (error: any) {
    return {
      success: false,
      busqueda,
      fechaConsulta,
      comparendos: [],
      totalComparendos: 0,
      error: error.message || 'Error desconocido al consultar SIMIT',
    };
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Returns:
 *  'rows'    — table rows are in the DOM (comparendos exist)
 *  'empty'   — resumen loaded and says 0 comparendos
 *  'timeout' — nothing appeared within timeoutMs
 */
async function pollForResults(
  page: Page,
  timeoutMs: number,
): Promise<'rows' | 'empty' | 'timeout'> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      // Wait for actual data rows (not just the header row)
      const rows = document.querySelectorAll('#multaTable tbody tr');
      if (rows.length > 0) return 'rows';

      // Resumen is present — only declare empty when the count <strong> has
      // actual content (i.e. the async data has been injected into the DOM)
      const resumen = document.querySelector('#resumenEstadoCuenta');
      if (resumen) {
        const labels = Array.from(resumen.querySelectorAll('label'));
        const getCount = (text: string): number | null => {
          const lbl = labels.find((l) => (l.textContent || '').includes(text));
          const strong = lbl?.closest('div')?.querySelector('strong');
          const raw = (strong?.textContent || '').trim();
          if (!raw) return null; // <strong> not populated yet
          return parseInt(raw) || 0;
        };
        const comp = getCount('Comparendos');
        const mult = getCount('Multas');
        // Both values loaded AND both are zero → truly empty
        if (comp !== null && mult !== null && comp === 0 && mult === 0) return 'empty';
        // comp or mult > 0 → rows are coming, keep waiting
        // comp or mult null → resumen still loading, keep waiting
      }

      return 'waiting';
    });

    if (state === 'rows' || state === 'empty') return state;
    await new Promise((r) => setTimeout(r, 1500));
  }

  return 'timeout';
}

async function extraerResumen(page: Page): Promise<SimitResumen | undefined> {
  try {
    return await page.evaluate(() => {
      const section = document.querySelector('#resumenEstadoCuenta');
      if (!section) return undefined;

      const norm = (t: string | null | undefined) =>
        (t || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

      const getStrong = (labelText: string): string => {
        const labels = Array.from(section.querySelectorAll('label'));
        for (const lbl of labels) {
          if ((lbl.textContent || '').includes(labelText)) {
            const strong = lbl.closest('div')?.querySelector('strong');
            return norm(strong?.textContent);
          }
        }
        return '';
      };

      const nombre = norm(
        Array.from(section.querySelectorAll('label')).find((l) => {
          const t = (l.textContent || '').trim();
          return !t.includes(':') && t.length > 3 && !t.includes('Resumen');
        })?.textContent,
      );

      return {
        comparendosCount: parseInt(getStrong('Comparendos')) || 0,
        multasCount:      parseInt(getStrong('Multas'))      || 0,
        acuerdosPago:     parseInt(getStrong('Acuerdos'))    || 0,
        nombre,
        total: getStrong('Total'),
      };
    });
  } catch {
    return undefined;
  }
}

async function extraerComparendos(page: Page): Promise<Comparendo[]> {
  return page.evaluate(() => {
    const norm = (t: string | null | undefined) =>
      (t || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

    const rows = Array.from(
      document.querySelectorAll('#multaTable tbody tr.page-row, #multaTable tbody tr'),
    );

    return rows.map((row) => {
      const cell = (label: string) => row.querySelector(`td[data-label="${label}"]`);

      // ── Tipo ───────────────────────────────────────────────────
      const tipoTd = cell('Tipo');
      const numero = norm(tipoTd?.querySelector('a span')?.textContent ?? tipoTd?.querySelector('a')?.textContent);
      const tipo   = norm(tipoTd?.querySelector('p.font-weight-bold, p.text-muted')?.textContent);
      const fechaSpan = Array.from(tipoTd?.querySelectorAll('span') ?? [])
        .find((s) => (s.textContent ?? '').includes('Fecha'));
      const fechaImposicion = norm(fechaSpan?.textContent)
        .replace(/Fecha\s+imposici[oó]n\s*:/i, '').trim();

      // ── Notificación ───────────────────────────────────────────
      const notificacion = norm(
        cell('Notificación')?.querySelector('span')?.textContent
        ?? cell('Notificación')?.textContent,
      );

      // ── Placa ──────────────────────────────────────────────────
      const placa = norm(cell('Placa')?.textContent);

      // ── Secretaría ─────────────────────────────────────────────
      const secretaria = norm(cell('Secretaría')?.textContent);

      // ── Infracción ─────────────────────────────────────────────
      const infTd   = cell('Infracción');
      const infCode = norm(infTd?.querySelector('label span')?.textContent ?? infTd?.querySelector('label')?.textContent);
      const infDesc = norm(infTd?.querySelector('p.mb-0.fs-13')?.textContent);
      const infraccion = infDesc ? `${infCode} — ${infDesc}` : infCode;

      // ── Estado ─────────────────────────────────────────────────
      const estadoTd   = cell('Estado');
      const estadoNode = Array.from(estadoTd?.childNodes ?? [])
        .find((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
      const estado = norm(estadoNode?.textContent ?? estadoTd?.textContent);

      // ── Valor ──────────────────────────────────────────────────
      const valor = norm(cell('Valor')?.textContent);

      // ── Valor a pagar (first text node only) ───────────────────
      const vTd   = cell('Valor a pagar');
      const vNode = Array.from(vTd?.childNodes ?? [])
        .find((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
      const valorAPagar = norm(vNode?.textContent ?? vTd?.textContent);

      return { numero, tipo, fechaImposicion, notificacion, placa, secretaria, infraccion, estado, valor, valorAPagar };
    }).filter((r) => r.numero || r.placa || r.estado);
  });
}
