export function formatPayPalAmount(price: string): string {
  const value = parseFloat(price);
  if (!isFinite(value) || value < 0) {
    throw new Error(`Invalid price for PayPal: ${price}`);
  }
  return value.toFixed(2);
}

export function findApprovalUrl(
  links: Array<{ href: string; rel: string; method: string }> = [],
): string | undefined {
  return links.find((l) => l.rel === 'approve' || l.rel === 'payer-action')?.href;
}

export function buildRedirectHtml(url: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${url.replace(/"/g, '&quot;')}"><title>Redirecting…</title></head><body><script>window.location.replace(${JSON.stringify(url)});</script><p>Redirecting to PayPal…</p></body></html>`;
}
