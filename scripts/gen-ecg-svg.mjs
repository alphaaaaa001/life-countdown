/**
 * 生成 README 用的心电图示意图（SVG）。
 *
 * 关键点：它不重画一遍算法，而是直接从 script.js 里把标记为
 * ECG_PURE_MATH 的纯函数块整块抽出来跑 —— 所以这张图用的
 * 和 App 运行时是同一份实现，参数一改、图就跟着变。
 *
 *   node scripts/gen-ecg-svg.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'ecg-waveform.svg');

// ---------- 从 source of truth 抽真实实现 ----------
const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const constSrc = src.match(/const ECG_BEAT_W[\s\S]*?const ECG_PULSE_MS.*?;/)?.[0];
const pureBlock = src.match(/\/\/ >>> ECG_PURE_MATH_BEGIN[\s\S]*?\/\/ <<< ECG_PURE_MATH_END/)?.[0];
if (!constSrc || !pureBlock) {
  console.error('✗ 没在 script.js 里找到常量区或 ECG_PURE_MATH 标记块');
  process.exit(1);
}
const P = new Function(
  constSrc + '\n' + pureBlock + '\nreturn {' +
  ' ECG_BEAT_W, ECG_PERIOD_MS, ECG_PERIOD_S, ECG_SCROLL, ECG_AMPL, ECG_PEN_FRAC, ECG_FIRST_BEAT,' +
  ' ecgAmplAtScreenX, ecgAmplAtPen };'
)();

// ---------- 画布 ----------
const W = 1280, H = 300, CENTER_Y = 172;
const PEN_X = Math.round(W * P.ECG_PEN_FRAC);
const SNAP_T = 5.0;                                  // 取"已经跳了 5 秒"的瞬间
const beats = [];
for (let k = P.ECG_FIRST_BEAT; k <= SNAP_T; k += P.ECG_PERIOD_S) beats.push(k);

const front = Math.max(0, PEN_X - SNAP_T * P.ECG_SCROLL);   // 笔尖已经描到哪儿
const yOf = (amp) => CENTER_Y - P.ECG_AMPL * amp;

const trace = [];
for (let x = front; x <= PEN_X; x++) {
  trace.push(`${x},${yOf(P.ecgAmplAtScreenX(x, PEN_X, SNAP_T, beats)).toFixed(2)}`);
}
const penY = yOf(P.ecgAmplAtPen(SNAP_T, beats));

// ---------- 波包相位标注 ----------
// 方向：相位 0 是这一拍最先描下的 → 在最左；相位越大越靠近笔尖（x 越大）
const pktStart = PEN_X - (SNAP_T - beats[beats.length - 2]) * P.ECG_SCROLL;
const xAtPhase = (u) => pktStart + u * P.ECG_PERIOD_S * P.ECG_SCROLL;
const marks = [['P', 0.048, 0.10], ['QRS', 0.172, 1.00], ['T', 0.312, 0.26], ['U', 0.420, 0.08]];

// 自检：标注必须落在波包内、从左到右递增，且该处振幅 = 该特征波的振幅
const xs = marks.map(([, u]) => xAtPhase(u));
const amps = marks.map(([, u]) => P.ecgAmplAtScreenX(xAtPhase(u), PEN_X, SNAP_T, beats));
const problems = [];
if (!(xs.every(x => x >= pktStart && x <= xAtPhase(0.452)))) problems.push('标注跑出波包范围');
if (!xs.every((x, i) => i === 0 || x > xs[i - 1])) problems.push('标注顺序不是从左到右');
marks.forEach(([name, , ref], i) => {
  if (Math.abs(amps[i] - ref) > 0.01) problems.push(`${name} 标注处振幅 ${amps[i].toFixed(3)} ≠ ${ref}`);
});
if (problems.length) {
  console.error('✗ 自检未通过，拒绝出图：\n  - ' + problems.join('\n  - '));
  process.exit(1);
}

// ---------- 出图 ----------
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="-apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif" role="img" aria-label="笔尖描记式心电图示意：波形逐拍从中央笔尖长出并向左漂移，笔尖右侧为空白">
  <defs>
    <linearGradient id="ink" x1="${PEN_X}" y1="0" x2="${front}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.62"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.10"/>
    </linearGradient>
    <radialGradient id="glow">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#0a0e1a"/>

  <!-- 基线：整幅"纸"的横轴 -->
  <line x1="0" y1="${CENTER_Y}" x2="${W}" y2="${CENTER_Y}" stroke="#ffffff" stroke-opacity="0.12" stroke-width="2"/>

  <!-- 已经描出来的墨迹（仅笔尖左侧，越远越淡） -->
  <polyline points="${trace.join(' ')}" fill="none" stroke="url(#ink)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>

  <!-- 笔尖 -->
  <circle cx="${PEN_X}" cy="${penY.toFixed(2)}" r="18" fill="url(#glow)"/>
  <circle cx="${PEN_X}" cy="${penY.toFixed(2)}" r="3.5" fill="#ffffff" fill-opacity="0.8"/>

${marks.map(([name, u, ref]) => {
  const x = xAtPhase(u);
  const curveY = yOf(amps[marks.findIndex(m => m[0] === name)]);
  const top = curveY - 14;
  return `  <line x1="${x.toFixed(1)}" y1="${top.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(curveY - 4).toFixed(1)}" stroke="#7fd4ff" stroke-opacity="0.5" stroke-width="1"/>
  <text x="${x.toFixed(1)}" y="${(top - 4).toFixed(1)}" fill="#7fd4ff" fill-opacity="0.85" font-size="12" text-anchor="middle">${name}</text>`;
}).join('\n')}

  <text x="${PEN_X + 12}" y="${CENTER_Y + 5}" fill="#ffffff" fill-opacity="0.42" font-size="13">笔还没走到 → 空白</text>
  <text x="${PEN_X + 12}" y="${CENTER_Y + 26}" fill="#ffffff" fill-opacity="0.42" font-size="12">（右半边永远不会预先有波形）</text>
  <text x="24" y="${CENTER_Y + 5}" fill="#ffffff" fill-opacity="0.34" font-size="13">← 墨迹向左漂移，越远越淡</text>
  <text x="24" y="282" fill="#ffffff" fill-opacity="0.30" font-size="12">心搏周期 ${P.ECG_PERIOD_MS} ms（≈${(60000 / P.ECG_PERIOD_MS).toFixed(1)} bpm）　墨迹漂移 ${P.ECG_SCROLL.toFixed(1)} px/s　R 峰 ${P.ECG_AMPL} px　本图由 ecgAmplAtScreenX() 逐像素算出</text>
</svg>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, svg);
console.log(`✓ ${path.relative(ROOT, OUT).replace(/\\/g, '/')}`);
console.log(`  快照 t=${SNAP_T}s　笔尖 x=${PEN_X}　已描区间=[${front.toFixed(0)}, ${PEN_X}]　心搏 ${beats.length} 拍`);
console.log(`  标注 ${marks.map(([n], i) => n + '@x=' + xs[i].toFixed(0) + '=' + amps[i].toFixed(3)).join('  ')}`);
