// Regenerates the PNG app icons in public/icons from an inline SVG design.
// Usage: node scripts/generate-icons.mjs   (needs Playwright + Chromium installed)
import { createRequire } from 'node:module';
// require() (unlike import) also finds a globally installed Playwright via NODE_PATH.
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';

const svg = (size, maskable) => {
  // Maskable icons must keep content inside the central 80% "safe zone".
  const scale = maskable ? 0.62 : 0.8;
  const r = maskable ? 0 : size * 0.22;
  const c = size / 2;
  const w = size * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="#0f6b5c"/>
  <g transform="translate(${c - w / 2} ${c - w / 2}) scale(${w / 100})">
    <rect x="12" y="62" width="16" height="22" rx="3" fill="#8fe0cf"/>
    <rect x="34" y="48" width="16" height="36" rx="3" fill="#8fe0cf"/>
    <rect x="56" y="34" width="16" height="50" rx="3" fill="#ffffff"/>
    <circle cx="78" cy="22" r="14" fill="#ffd166"/>
    <text x="78" y="28" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#0f6b5c" text-anchor="middle">$</text>
  </g>
</svg>`;
};

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent">${svg(size, maskable)}</body>`);
  await page.locator('svg').screenshot({ path: `public/icons/${name}`, omitBackground: true });
  console.log('wrote', name);
}
await browser.close();
