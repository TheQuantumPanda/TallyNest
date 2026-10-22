import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const { chromium } = await import(resolve('frontend/node_modules/@playwright/test/index.mjs'));

const WIDTH = 900;
const HEIGHT = 220;
const FPS = 18;
const DURATION_SEC = 3.6;
const TOTAL_FRAMES = Math.round(FPS * DURATION_SEC);

const fontPath = resolve(
  'frontend/node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2',
);

const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'Manrope';
    src: url('file://${fontPath}') format('woff2');
    font-weight: 200 900;
    font-style: normal;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .banner-card {
    width: 100%;
    height: 100%;
    background: radial-gradient(circle at 50% 30%, #151a27 0%, #0d0f17 65%, #08090e 100%);
    border: 1px solid #22293a;
    border-radius: 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    position: relative;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    overflow: hidden;
  }

  /* Subtle background financial grid */
  .grid-pattern {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(to right, rgba(131, 229, 213, 0.035) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(131, 229, 213, 0.035) 1px, transparent 1px);
    background-size: 32px 32px;
    background-position: center center;
    mask-image: radial-gradient(ellipse at center, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 75%);
    -webkit-mask-image: radial-gradient(ellipse at center, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 75%);
  }

  /* Ambient mint glow */
  .glow-orb {
    position: absolute;
    width: 320px;
    height: 120px;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -60%);
    background: radial-gradient(circle, rgba(131, 229, 213, 0.12) 0%, rgba(131, 229, 213, 0) 70%);
    filter: blur(24px);
    pointer-events: none;
  }

  .content-row {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .logo-svg {
    width: 58px;
    height: 58px;
    filter: drop-shadow(0 0 12px rgba(131, 229, 213, 0.35));
  }

  .brand-text-col {
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .title-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  .brand-title {
    font-size: 44px;
    font-weight: 800;
    letter-spacing: -1.2px;
    color: #ffffff;
    line-height: 1;
    display: flex;
  }

  .brand-title .mint-text {
    color: #83e5d5;
  }

  .version-tag {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: #83e5d5;
    background: rgba(131, 229, 213, 0.1);
    border: 1px solid rgba(131, 229, 213, 0.25);
    padding: 3px 8px;
    border-radius: 6px;
    line-height: 1;
    align-self: center;
    box-shadow: 0 0 10px rgba(131, 229, 213, 0.15);
  }

  .tagline-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #83e5d5;
    box-shadow: 0 0 8px #83e5d5;
  }

  .tagline-text {
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #94a3b8;
  }

  .badge-pills {
    margin-top: 18px;
    display: flex;
    gap: 10px;
    z-index: 2;
  }

  .pill {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.8px;
    color: #7d89a1;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 4px 11px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .pill-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #4fd1c5;
  }

  /* Shimmer line across bottom */
  .bottom-accent {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: rgba(131, 229, 213, 0.08);
    overflow: hidden;
  }

  .shimmer-ray {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 280px;
    background: linear-gradient(90deg,
      transparent 0%,
      rgba(131, 229, 213, 0.15) 20%,
      rgba(131, 229, 213, 0.85) 50%,
      rgba(131, 229, 213, 0.15) 80%,
      transparent 100%
    );
    will-change: transform;
  }
</style>
</head>
<body>
<div class="banner-card">
  <div class="grid-pattern"></div>
  <div class="glow-orb" id="glow"></div>
  <div class="bottom-accent">
    <div class="shimmer-ray" id="shimmer-ray"></div>
  </div>

  <div class="content-row">
    <svg class="logo-svg" id="logo" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g stroke="#83e5d5" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
        <path id="tally1" d="M16 14v7" />
        <path id="tally2" d="M24 9v16" />
        <path id="tally3" d="M32 14v7" />
        <path id="nest1" d="m10 25 14 8 14-8" />
        <path id="nest2" d="m10 32l14 8 14-8" />
      </g>
    </svg>
    <div class="brand-text-col">
      <div class="title-row">
        <div class="brand-title" id="brand-title">
          <span>Tally</span><span class="mint-text">Nest</span>
        </div>
        <div class="version-tag" id="vtag">v1.0</div>
      </div>
      <div class="tagline-row" id="tagline-row">
        <div class="status-dot" id="status-dot"></div>
        <div class="tagline-text">Your money. In perspective.</div>
      </div>
    </div>
  </div>

  <div class="badge-pills" id="badge-pills">
    <div class="pill"><span class="pill-dot"></span>Personal Ledger & Analytics</div>
    <div class="pill"><span class="pill-dot"></span>Group Splits & Settlements</div>
    <div class="pill"><span class="pill-dot"></span>Isolated Settlement Cycles</div>
    <div class="pill"><span class="pill-dot"></span>Exact Integer Minor Units</div>
  </div>
</div>

<script>
window.setProgress = function(progress) {
  // Brand elements remain 100% visible throughout - no wipes, no resets.
  for (const id of ['tally1', 'tally2', 'tally3', 'nest1', 'nest2',
    'brand-title', 'vtag', 'tagline-row', 'badge-pills']) {
    const el = document.getElementById(id);
    if (el) {
      el.style.opacity = '1';
      el.style.transform = 'none';
    }
  }

  // Smooth sinusoidal breathing pulse (progress: 0 -> 1 -> 0)
  const pulse = (1 - Math.cos(progress * 2 * Math.PI)) / 2;

  // 1. Ambient mint glow orb breathing
  const glowScale = 1 + pulse * 0.32;
  const glowOpacity = 0.75 + pulse * 0.45;
  const glow = document.getElementById('glow');
  glow.style.transform = 'translate(-50%, -60%) scale(' + glowScale + ')';
  glow.style.opacity = glowOpacity;

  // 2. Subtle drop shadow bloom on logo icon
  const logo = document.getElementById('logo');
  const logoDrop = 10 + pulse * 10;
  const logoAlpha = 0.3 + pulse * 0.3;
  logo.style.filter = 'drop-shadow(0 0 ' + logoDrop + 'px rgba(131, 229, 213, ' + logoAlpha + '))';

  // 3. Live status dot breathing pulse
  const dot = document.getElementById('status-dot');
  const dotGlow = 6 + pulse * 8;
  dot.style.boxShadow = '0 0 ' + dotGlow + 'px #83e5d5';

  // 4. Version tag subtle glow
  const vtag = document.getElementById('vtag');
  vtag.style.boxShadow = '0 0 ' + (8 + pulse * 8) + 'px rgba(131, 229, 213, ' + (0.15 + pulse * 0.25) + ')';

  // 5. Light sweep ray travelling across bottom border (offscreen left -> offscreen right)
  const rayWidth = 280;
  const totalTravel = 900 + rayWidth * 2;
  const rayX = -rayWidth + progress * totalTravel;
  const ray = document.getElementById('shimmer-ray');
  ray.style.transform = 'translateX(' + rayX + 'px)';
};
</script>
</body>
</html>
`;

async function main() {
  const tempDir = await mkdtemp(join(tmpdir(), 'tallynest-header-'));
  const htmlPath = join(tempDir, 'header.html');
  await writeFile(htmlPath, htmlContent);

  console.log(`Rendering ${TOTAL_FRAMES} frames at ${FPS} FPS...`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });

  await page.goto(`file://${htmlPath}`);
  await page.evaluate(() => document.fonts.ready);

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const progress = i / TOTAL_FRAMES;
    await page.evaluate((p) => window.setProgress(p), progress);
    const framePath = join(tempDir, `frame_${String(i).padStart(4, '0')}.png`);
    await page.screenshot({ path: framePath, omitBackground: true });
  }

  await browser.close();
  console.log('Frames captured. Encoding GIF with ffmpeg...');

  const outputPath = 'docs/media/tallynest-header.gif';
  await mkdir('docs/media', { recursive: true });
  const ffmpegArgs = [
    '-y',
    '-framerate',
    String(FPS),
    '-i',
    join(tempDir, 'frame_%04d.png'),
    '-filter_complex',
    'split[s0][s1];[s0]palettegen=max_colors=96:reserve_transparent=0[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
    '-loop',
    '0',
    outputPath,
  ];

  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ffmpegArgs, { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });

  // Layer optimization with magick
  await new Promise((resolve, reject) => {
    const proc = spawn('magick', [outputPath, '-layers', 'Optimize', outputPath], {
      stdio: 'inherit',
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`magick exited with code ${code}`));
    });
  });

  await rm(tempDir, { recursive: true, force: true });
  console.log(`Generated and optimized: ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
