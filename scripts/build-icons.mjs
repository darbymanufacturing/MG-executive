/**
 * build-icons.mjs
 *
 * Rasterises the master SVG (public/asterism.svg) into all required PNG icon
 * variants for iOS home-screen, Android PWA adaptive icons, and browser favicons.
 *
 * Usage:
 *   node scripts/build-icons.mjs
 *
 * Requires: sharp (installed as a devDependency)
 *   npm run build:icons   (add to package.json scripts if desired)
 *
 * Output files (all written to public/):
 *   apple-touch-icon-180x180.png   — iOS Retina home-screen icon (primary)
 *   apple-touch-icon-167x167.png   — iPad Pro
 *   apple-touch-icon-152x152.png   — iPad
 *   apple-touch-icon-120x120.png   — iPhone non-retina fallback
 *   icon-192x192.png               — PWA manifest purpose: any
 *   icon-512x512.png               — PWA manifest purpose: any
 *   icon-maskable-512x512.png      — PWA manifest purpose: maskable
 *                                    (asterism content inside central 80% safe zone)
 *   favicon-32x32.png              — Browser favicon fallback
 *   favicon-16x16.png              — Browser favicon fallback (small)
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const masterSvgPath = path.join(publicDir, 'asterism.svg');

// The master SVG has a rust background and rays within the ~10% safe zone (tips at ~60–452 on 512).
// For the maskable icon, Android's adaptive-icon crop requires content inside the CENTRAL 80%
// (i.e., safe zone = inner 80% circle/square). The master SVG ray tips are already inside this
// zone so we can reuse it directly for the maskable variant — the rust background fills edge-to-edge.
const masterSvg = readFileSync(masterSvgPath);

const icons = [
  // iOS apple-touch-icons — square, no transparency (iOS ignores alpha, composites on white)
  { file: 'apple-touch-icon-180x180.png', size: 180 },
  { file: 'apple-touch-icon-167x167.png', size: 167 },
  { file: 'apple-touch-icon-152x152.png', size: 152 },
  { file: 'apple-touch-icon-120x120.png', size: 120 },
  // PWA manifest icons (purpose: any)
  { file: 'icon-192x192.png', size: 192 },
  { file: 'icon-512x512.png', size: 512 },
  // PWA manifest icon (purpose: maskable) — same master, rust bg fills full canvas
  { file: 'icon-maskable-512x512.png', size: 512 },
  // Raster favicon fallbacks
  { file: 'favicon-32x32.png', size: 32 },
  { file: 'favicon-16x16.png', size: 16 },
];

async function buildIcons() {
  console.log('Building PNG icons from master SVG...\n');

  for (const { file, size } of icons) {
    const outPath = path.join(publicDir, file);
    try {
      await sharp(masterSvg, { density: Math.ceil((size / 512) * 300) })
        .resize(size, size)
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toFile(outPath);
      console.log(`  ✓ ${file}  (${size}×${size})`);
    } catch (err) {
      console.error(`  ✗ ${file}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log('\nDone. All icons written to public/.');
}

buildIcons();
