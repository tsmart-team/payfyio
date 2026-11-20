const CURRENCIES: Record<string, string> = {
  TRY: '949',
  TL: '949',
  USD: '840',
  EUR: '978',
  GBP: '826',
  JPY: '392',
};

export function getVakifBankCurrency(currency?: string): string {
  const code = CURRENCIES[(currency || 'TRY').toUpperCase()];
  if (!code) throw new Error(`VakıfBank does not support currency ${currency}`);
  return code;
}

/** VPOS and MPI take a dotted two-decimal amount: '1.2' → '1.20'. */
export function formatVakifBankAmount(price: string): string {
  const value = parseFloat(price);
  if (!isFinite(value) || value <= 0) throw new Error(`Invalid price for VakıfBank: ${price}`);
  return value.toFixed(2);
}

/** Returns [YYYY, MM]; accepts 2- or 4-digit years. */
function expiry(month: string, year: string): [string, string] {
  const mm = String(month).padStart(2, '0');
  const y = String(year);
  const yyyy = y.length === 2 ? `20${y}` : y;
  if (!/^(0[1-9]|1[0-2])$/.test(mm) || !/^\d{4}$/.test(yyyy)) {
    throw new Error(`Invalid card expiry: ${month}/${year}`);
  }
  return [yyyy, mm];
}

/** MPI wants YYMM, VPOS wants YYYYMM. */
export function vakifBankExpiry(month: string, year: string, format: 'YYMM' | 'YYYYMM'): string {
  const [yyyy, mm] = expiry(month, year);
  return format === 'YYMM' ? yyyy.slice(2) + mm : yyyy + mm;
}

/** MPI BrandName: 100 Visa, 200 Mastercard, 300 Troy, 400 Amex. */
export function vakifBankBrand(pan: string): string {
  if (/^3[47]/.test(pan)) return '400';
  if (/^(9792|65)/.test(pan)) return '300';
  if (/^(5[1-5]|2[2-7])/.test(pan)) return '200';
  return '100';
}

/** The order id is both the MPI VerifyEnrollmentRequestId and the VPOS TransactionId. */
export function assertVakifBankOrderId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) {
    throw new Error(`VakıfBank order id must be 1-40 letters, digits, "-" or "_": ${id}`);
  }
  return id;
}

/**
 * MPI host from the VPOS host — the two always come as a test pair or a live
 * pair. An unrecognised host (proxy, mock) is kept as is.
 */
export function deriveVakifBankMpiUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.hostname = url.hostname.replace(/^onlineodeme(test)?\./i, '3dsecure$1.');
  url.pathname = '/MPIAPI/MPI_Enrollment.aspx';
  url.search = '';
  return url.toString();
}

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** `prmstr=<urlencoded VposRequest XML>`. Undefined fields are left out (VPOS rejects empty ones). */
export function buildVposBody(fields: Record<string, string | number | undefined>): string {
  const inner = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `<${k}>${esc(v)}</${k}>`)
    .join('');
  return `prmstr=${encodeURIComponent(`<?xml version="1.0" encoding="utf-8"?><VposRequest>${inner}</VposRequest>`)}`;
}

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === '#') {
      return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()] ?? m;
  });
}

/**
 * Flat map of the leaf elements of an XML answer (first occurrence wins).
 * Throws when `root` is missing — an HTML error page is not a decline.
 */
export function readVakifBankXml(xml: unknown, root: string): Record<string, string> {
  const text = typeof xml === 'string' ? xml : '';
  if (!text.includes(`<${root}`)) throw new Error(`VakıfBank returned no <${root}> answer`);
  const out: Record<string, string> = {};
  for (const [, tag, value] of text.matchAll(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>([^<]*)<\/\1>/g)) {
    if (!(tag in out)) out[tag] = unescapeXml(value).trim();
  }
  return out;
}

/** Auto-submitting POST form; action and values are HTML-escaped (the ACS URL comes from the bank). */
export function buildAutoPostForm(action: string, fields: Record<string, string>): string {
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>3D Secure</title></head>' +
    `<body onload="document.forms[0].submit()"><form method="POST" action="${esc(action)}">${inputs}` +
    '<noscript><button type="submit">Continue to 3D Secure</button></noscript></form></body></html>'
  );
}
