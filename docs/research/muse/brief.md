# Muse page brief

Source: https://muse.gptibo.com/
Local route: /
Owned code: `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `src/components/sites/muse/*`
Owned assets: `public/sites/muse/*`

## Evidence and layout

- Desktop sample: 1440 × 900. Source screenshot: `source-desktop.png`. Local screenshot: `local-desktop.png`.
- Mobile sample: 390 × 844. Source screenshot: `source-mobile.png`. Local screenshot: `local-mobile.png`.
- Header: 1200px maximum, 100px high desktop; 120px high mobile with centered tabs on second row.
- Main: two columns with a 430px checkout card, 1120px maximum width. At 650px and below, the logo stage stacks above the card.
- Footer: 1200px maximum with a top rule. Mobile page scrolls to reveal it.
- The Muse mark and favicon are the source SVG files. The Latin Geist variable font is copied from the source; Chinese glyphs use the system fallback.

## Observed interactions

- Muse AI tab: account checkout form and email field.
- Muse Token tab: specification and price are pending; the sale button is disabled.
- Purchase terms: overlay with three notices; close button, backdrop, and Escape close it.
- My Orders: overlay with order number and query token fields.
- Submit validates the email and acceptance checkbox. The local clone displays an order review and an explicitly labeled preview payment state.

## Asset map

| Source URL | Local file |
| --- | --- |
| /favicon.svg | `public/sites/muse/favicon.svg` |
| /muse-logo.svg | `public/sites/muse/muse-logo.svg` |
| /muse-assets/geist-latin-wght-normal-BgDaEnEv.woff2 | `public/sites/muse/geist-latin.woff2` |

## Remaining gap

The source checkout and order lookup use a separate live API. This standalone frontend deliberately does not create orders, query real orders, or process payments. It shows an explicit local preview message instead of implying a real transaction. The reference site intermittently closed browser connections after the initial screenshots, so alternate-state screenshots were captured using locally served copies of the site's publicly fetched reference assets for inspection only; those production bundles are not part of the implementation.

