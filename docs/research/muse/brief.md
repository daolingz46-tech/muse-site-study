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

## Refinement — 2026-10-22

Live source access was restored. The new `source-*-refined.png` screenshots and measurements come directly from the live website, including its terms and order dialogs. Compared at widths 390, 768, 1280, 1440, and 1920 with a 900px viewport height and reduced motion to remove animation timing differences. `refined-measurements.json` records the source/local geometry. Local reference screenshots use the development server and may include its development indicator; `public-*-refined.png` uses the actual static production export.

Corrected normal line height, responsive logo sizes and offsets, independently centered pagination, exact total/button spacing, source terms text, and dialog layouts. Reproduced floating/rotating/scaling logo motion, breathing halo, entrance effects, and animated checkout height. Native dialogs constrain focus, restore the trigger focus, and support Escape/backdrop dismissal. Tabs support arrow keys, Home, and End.

The public export retains the prominent non-affiliation banner. Its email and order fields preserve the source appearance but are read-only, with no submission or data collection. This banner changes vertical geometry compared with the source. Backend purchase, delivery, and order lookup are not reproduced; the local review/payment steps remain demonstrative. Animation curves and states have been implemented, but no claim of frame-by-frame identity is made.

Validation: `npm run check` with the GitHub Pages export environment; browser checks at desktop/mobile for readonly fields, tab keyboard navigation, dialog focus and Escape, horizontal overflow, page errors, and missing assets.

## Input and payment selector fix — 2026-10-22

Supersedes the read-only preview behavior above: the user requested editable inputs and a WeChat payment option. Public/local builds now allow temporary test input, validation, and the demonstration confirmation/payment flow. Values remain in React memory only, are never submitted to a backend or browser storage, and reset on reload. The disclosure explicitly requests test information. Order lookup responds with an explicit not-connected message instead of silently ignoring clicks.

Rechecked the live source payment row: its Alipay indicator is a Lucide check, with no select/listbox after clicking. The new native Alipay/WeChat selector is a user-requested addition, not an observed source feature. The selected provider carries through confirmation and the unconnected payment screen. The displayed fee is illustrative, not a verified provider rate.

Verification: production `npm run check`; browser checks at 390/1440px for typing, email/consent validation, both payment choices, confirmation/back navigation, editable order lookup, no form-data network submission or local/session storage, and reset on reload. Evidence: `interactive-390.png`, `interactive-1440.png`. Real payment integration remains pending merchant onboarding, provider documentation, and backend hosting.

