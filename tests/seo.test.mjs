import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("exported public pages are readable without JavaScript and have unique metadata", () => {
  const xml = readFileSync("out/sitemap.xml", "utf8");
  const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
  assert.equal(urls.length, 8);
  const titles = new Set();
  const descriptions = new Set();
  for (const url of urls) {
    const path = new URL(url).pathname;
    const html = readFileSync(`out${path}index.html`, "utf8");
    const head = html.split("</head>")[0];
    assert.ok(head.includes(`rel="canonical" href="${url}"`), path);
    assert.ok(head.includes('name="robots" content="index, follow"'), path);
    titles.add(head.match(/<title>(.*?)<\/title>/)[1]);
    descriptions.add(head.match(/name="description" content="(.*?)"/)[1]);
    assert.match(html.split("</head>")[1].replace(/<script[\s\S]*?<\/script>/g, ""), /Muse|Gmail|Mail|GPT/);
    assert.ok(!/admin|agent|order|payment/.test(path));
  }
  assert.equal(titles.size, urls.length);
  assert.equal(descriptions.size, urls.length);
  for (const path of ["admin", "admin/agents", "agent"]) {
    assert.match(readFileSync(`out/${path}/index.html`, "utf8").split("</head>")[0], /noindex/);
  }
  assert.match(readFileSync("out/robots.txt", "utf8"), /Sitemap: https:\/\/musetoken.store\/sitemap.xml/);
});

test("Worker excludes private responses, preserves public crawling, and redirects aliases", async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "seo-test", modules: true, scriptPath: "temp/worker/index.js", compatibilityDate: "2026-10-01", serviceBindings: { ASSETS: async () => new Response("<html>public</html>", { headers: { "Content-Type": "text/html" } }) } }] }));
  try {
    for (const path of ["/", "/account/", "/token/", "/guides/muse-token/"]) {
      const response = await mf.dispatchFetch(`https://musetoken.store${path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-Robots-Tag"), null);
    }
    for (const path of ["/admin/", "/admin/agents/", "/agent/", "/orders/", "/payment/", "/?order=test", "/?token=test", "/api/health", "/api/unknown"]) {
      const response = await mf.dispatchFetch(`https://musetoken.store${path}`);
      assert.match(response.headers.get("X-Robots-Tag"), /noindex/);
    }
    const http = await mf.dispatchFetch("http://musetoken.store/token/", { redirect: "manual" });
    assert.equal(http.status, 308);
    assert.equal(http.headers.get("Location"), "https://musetoken.store/token/");
    const response = await mf.dispatchFetch("https://api.musetoken.store/token/?utm_source=test", { redirect: "manual" });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("Location"), "https://musetoken.store/token/?utm_source=test");
  } finally { await mf.dispose(); }
});
