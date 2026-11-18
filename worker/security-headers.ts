// The application uses DOM Response types; declare only the Worker API we use.
declare class HTMLRewriter {
  on(selector: string, handler: { element(element: { setAttribute(name: string, value: string): void }): void }): HTMLRewriter;
  transform(response: Response): Response;
}

/** Apply to successful responses, errors, redirects and private APIs alike. */
export function secureResponse(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  if (new URL(request.url).protocol === "https:") {
    // Do not opt unverified subdomains into HSTS or preload.
    headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  if (!(headers.get("Content-Type") || "").includes("text/html")) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const nonce = crypto.randomUUID().replaceAll("-", "");
  headers.set("Content-Security-Policy", [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://static.cloudflareinsights.com`,
    "script-src-attr 'none'",
    // React uses style attributes for measured layouts and payment dialogs.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://musetoken.store https://api.musetoken.store",
    "font-src 'self'",
    "connect-src 'self' https://api.musetoken.store https://cloudflareinsights.com",
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self' https://musetoken.store",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; "));
  // A response-specific nonce must never be reused from the browser/CDN HTML cache.
  // Fingerprinted JS, CSS and images keep their existing cache headers.
  headers.set("Cache-Control", "private, no-store");
  headers.delete("ETag");
  headers.delete("Content-Length");
  return new HTMLRewriter().on("script", {
    element(element) { element.setAttribute("nonce", nonce); },
  }).transform(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
}
