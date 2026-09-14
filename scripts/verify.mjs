/**
 * 自带验收脚本 —— 从 script.js 里抽「真实现」跑对照，而不是读代码凭感觉。
 *
 *   node scripts/verify.mjs     （或 npm run verify）
 *
 * 覆盖三块：
 *   [A] 代码卫生：死代码残留、化石 id、getElementById 与 HTML 的交叉核对
 *   [B] 日期逻辑：固定 now 跑 parseLocalDate / calcAge / calcEndDate / splitDuration
 *   [C] 心跳线：常量自洽、波形形态、t=0 整屏空白、真扫描测节律、漂移、留痕模型
 *
 * 所有期望值都从源码常量推导，不写死数字 —— 改参数后这个脚本仍然有效。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const jsSrc = read('script.js');
const htmlSrc = read('index.html');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name + (extra ? '  \x1b[90m' + extra + '\x1b[0m' : '')); }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + (extra ? '  ' + extra : '')); }
};
const section = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m');
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ============================================================
// [A] 代码卫生
// ============================================================
section('[A] 代码卫生');

for (const f of ['parseBirthday', 'isLeapYear', 'getDaysInMonth', 'isValidDate',
                 'calculateTotalDays', 'calculateNextBirthday', 'getTimeDifference']) {
  const n = (jsSrc.match(new RegExp('\\b' + f + '\\b', 'g')) || []).length;
  ok(`不可达函数已清除：${f}`, n === 0, n ? `残留 ${n} 处` : '');
}
for (const id of ['daysToNext', 'hoursToNext', 'minutesToNext', 'secondsToNext']) {
  const n = (jsSrc + htmlSrc).split(id).length - 1;
  ok(`化石 id 已改名：${id}`, n === 0, n ? `残留 ${n} 处` : '');
}
{
  const called = [...new Set([...jsSrc.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]))];
  const missing = called.filter(id => !htmlSrc.includes(`id="${id}"`));
  ok(`getElementById 的 ${called.length} 个 id 在 HTML 中都存在`, missing.length === 0,
    missing.length ? '缺失: ' + missing.join(', ') : '');
}
ok('渲染进程未使用 Node API（故无需 nodeIntegration）',
  !/\brequire\(|process\.|__dirname\b/.test(jsSrc), '');

// ============================================================
// [B] 日期逻辑（固定 now）
// ============================================================
section('[B] 日期逻辑（固定 now = 2026-09-14 12:00）');

const grabFn = (name) => jsSrc.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n}'))?.[0];
const dateCode = ['parseLocalDate', 'calcAge', 'calcEndDate', 'splitDuration'].map(grabFn);
ok('日期工具函数可整块抽出', dateCode.every(Boolean));
const D = new Function(dateCode.join('\n') + '\nreturn { parseLocalDate, calcAge, calcEndDate, splitDuration };')();
const NOW = new Date(2026, 8, 14, 12, 0, 0);   // 2026-09-14 12:00 本地

ok('生日已过 → 年龄不递减', D.calcAge(D.parseLocalDate('2004-03-15'), NOW) === 22);
ok('生日未到 → 年龄递减 1', D.calcAge(D.parseLocalDate('2005-10-23'), NOW) === 20);
ok('生日当天 → 算已满', D.calcAge(D.parseLocalDate('2004-09-14'), NOW) === 22);
{
  const b = D.parseLocalDate('2004-03-15');
  const end = D.calcEndDate(b, 80);
  ok('终点 = 出生年 + 寿命', end.getFullYear() === 2084);
  ok('出生日期解析为本地 00:00', b.getHours() === 0 && b.getMinutes() === 0);
  ok('终点落在本地 00:00（UTC 偏移已修）', end.getHours() === 0 && end.getMinutes() === 0,
    `${end.getFullYear()}-${end.getMonth() + 1}-${end.getDate()}`);
  const d = D.splitDuration(end - NOW);
  const expectH = (24 - NOW.getHours()) % 24;
  ok('剩余时分秒无 8 小时残留', d.hours === expectH && d.minutes === 0,
    `${d.days}天 ${d.hours}时${d.minutes}分`);
}
ok('过期返回全 0', (() => { const z = D.splitDuration(-1); return !z.days && !z.hours && !z.minutes && !z.seconds; })());

// ============================================================
// [C] 心跳线
// ============================================================
section('[C] 心跳线（笔尖描记式 ECG）');

const constSrc = jsSrc.match(/const ECG_BEAT_W[\s\S]*?const ECG_PULSE_MS.*?;/)[0];
const pureBlock = jsSrc.match(/\/\/ >>> ECG_PURE_MATH_BEGIN[\s\S]*?\/\/ <<< ECG_PURE_MATH_END/)[0];
const E = new Function(constSrc + '\n' + pureBlock + '\nreturn {' +
  ' ECG_BEAT_W, ECG_PERIOD_MS, ECG_PERIOD_S, ECG_SCROLL, ECG_AMPL, ECG_PEN_FRAC, ECG_FIRST_BEAT,' +
  ' ECG_POINTS, ecgPhaseValue, latestBeatAtOrBefore, ecgAmplAtScreenX, ecgAmplAtPen };')();

const W = 1920, PEN_X = Math.round(W * E.ECG_PEN_FRAC);
const P = E.ECG_PERIOD_S, S = E.ECG_SCROLL;
const beatsUpTo = (t) => { const b = []; for (let k = E.ECG_FIRST_BEAT; k <= t + 1e-9; k += P) b.push(k); return b; };

console.log(`  \x1b[90m参数：周期 ${E.ECG_PERIOD_MS}ms  心率 ${(60000 / E.ECG_PERIOD_MS).toFixed(1)}bpm  漂移 ${S.toFixed(1)}px/s  幅度 ${E.ECG_AMPL}px\x1b[0m`);
ok('一次心搏占宽 = 周期 × 漂移速度', close(E.ECG_BEAT_W, P * S, 1e-6));
ok('笔尖位于屏幕中央', PEN_X === W / 2, `x=${PEN_X}`);

// 波形形态
const peak = (lo, hi) => E.ECG_POINTS.filter(p => p[0] >= lo && p[0] < hi).reduce((a, b) => (b[1] > a[1] ? b : a));
const R = E.ECG_POINTS.find(p => p[1] === 1.0), Sdip = E.ECG_POINTS.reduce((a, b) => (b[1] < a[1] ? b : a));
const Pw = peak(0, 0.10), Tw = peak(0.25, 0.40), Uw = peak(0.40, 0.46);
ok('R 峰 = 1.000', close(E.ecgPhaseValue(R[0]), 1, 1e-9), `u=${R[0]}`);
ok('S 深谷为负向', E.ecgPhaseValue(Sdip[0]) < -0.3, `${E.ecgPhaseValue(Sdip[0]).toFixed(3)}`);
ok('P 波存在（正小丘）', Pw[1] > 0 && Pw[1] < 0.2, `${Pw[1]} @ u=${Pw[0]}`);
ok('T 波存在（正小丘）', Tw[1] > 0.2 && Tw[1] < 0.4, `${Tw[1]} @ u=${Tw[0]}`);
ok('U 波存在（正小丘）', Uw[1] > 0 && Uw[1] < 0.15, `${Uw[1]} @ u=${Uw[0]}`);
ok('相位序贯 P < QRS < T < U', Pw[0] < R[0] && R[0] < Tw[0] && Tw[0] < Uw[0]);
ok('全程无 NaN', (() => { for (let u = 0; u <= 1; u += 0.001) if (!Number.isFinite(E.ecgPhaseValue(u))) return false; return true; })());

// 核心诉求：一开始屏幕上什么都没有
{
  const nz = (t) => { let n = 0; for (let x = 0; x <= W; x++) if (E.ecgAmplAtScreenX(x, PEN_X, t, beatsUpTo(t)) !== 0) n++; return n; };
  ok('t=0 整屏振幅全为 0', nz(0) === 0);
  ok('首拍之前整屏仍为 0', nz(E.ECG_FIRST_BEAT * 0.9) === 0);
}

// 「咚」的那一下
{
  const tR = E.ECG_FIRST_BEAT + R[0] * P;
  ok('笔尖在 R 时刻 = 1.000', close(E.ecgAmplAtPen(tR, beatsUpTo(tR)), 1, 1e-6));
  ok('笔尖在 S 时刻下沉到谷底', close(E.ecgAmplAtPen(E.ECG_FIRST_BEAT + Sdip[0] * P, beatsUpTo(tR)), Sdip[1], 1e-6));
  ok('静息期回到基线 0', close(E.ecgAmplAtPen(E.ECG_FIRST_BEAT + 0.8 * P, beatsUpTo(tR)), 0, 1e-9));
}

// 真·扫描 10s 找 R 峰量节律（不预设答案）
{
  const peaks = [];
  let inPeak = false, best = -Infinity, bestT = 0;
  for (let t = 0; t <= 10; t += 0.001) {
    const v = E.ecgAmplAtPen(t, beatsUpTo(t));
    if (v >= 0.95) {
      if (!inPeak) { inPeak = true; best = -Infinity; }
      if (v > best) { best = v; bestT = t; }
    } else if (inPeak) { inPeak = false; peaks.push({ t: bestT, v: best }); }
  }
  ok('R 峰个数 = floor(10s / 周期)', peaks.length === Math.floor(10 / P), `检出 ${peaks.length} 个`);
  ok('每个 R 峰都触到 ~1.000', peaks.every(p => Math.abs(p.v - 1) < 0.05));
  const iv = peaks.slice(1).map((p, i) => p.t - peaks[i].t);
  ok('实测心搏间隔 = 心搏周期', iv.every(d => Math.abs(d - P) < 0.003),
    `${iv.map(d => d.toFixed(3)).join(', ')}s vs ${P}s`);
}

// 漂移方向与速度
{
  const peakX = (t) => {
    const b = beatsUpTo(t); let bx = -1, bv = -Infinity;
    for (let x = 0; x <= PEN_X; x++) { const v = E.ecgAmplAtScreenX(x, PEN_X, t, b); if (v > bv) { bv = v; bx = x; } }
    return bx;
  };
  const moved = peakX(6) - peakX(6.5);
  ok('墨迹朝左漂移', moved > 0, `Δx=${moved}px`);
  ok('漂移速度与参数一致', Math.abs(moved - 0.5 * S) <= 2 * S / 60 + 1, `期望 ≈${(0.5 * S).toFixed(1)}px`);
}

// 笔尖右侧恒为空白 + 描记前沿
{
  const b = beatsUpTo(8);
  let bad = 0;
  for (let x = PEN_X + 1; x <= W; x++) if (E.ecgAmplAtScreenX(x, PEN_X, 8, b) !== 0) bad++;
  ok('笔尖右侧恒为空白', bad === 0, `违例 ${bad}`);

  const minNonZero = (t) => {
    const bb = beatsUpTo(t);
    for (let x = 0; x <= PEN_X; x++) if (E.ecgAmplAtScreenX(x, PEN_X, t, bb) !== 0) return x;
    return Infinity;
  };
  const f1 = minNonZero(1), f3 = minNonZero(3), f6 = minNonZero(6);
  ok('波形从笔尖一拍拍长出来（前沿左移）', f1 >= f3 && f3 >= f6, `${f1} → ${f3} → ${f6}`);
  ok('1s 时波形还贴着笔尖', f1 > PEN_X * 0.8, `前沿 x=${f1}`);
  ok('未描到的区域恒为 0', (() => {
    for (const t of [6, 20]) {
      const bb = beatsUpTo(t), front = PEN_X - t * S;
      for (let x = 0; x < front - 1; x++) if (E.ecgAmplAtScreenX(x, PEN_X, t, bb) !== 0) return false;
    }
    return true;
  })());
}

// 留痕模型：后来发生的心搏不会改写已经描下的墨迹
{
  const past = [0.55, 2.15], future = [0.55, 2.15, 3.75], t = 3.0;
  let same = 0, total = 0;
  for (let x = 0; x <= PEN_X; x += 37) {
    total++;
    if (close(E.ecgAmplAtScreenX(x, PEN_X, t, future), E.ecgAmplAtScreenX(x, PEN_X, t, past), 1e-9)) same++;
  }
  ok('未来心搏不影响既有画面（墨迹是留痕的）', same === total, `${same}/${total}`);
}

console.log(`\n\x1b[1m===== ${pass} 通过 / ${fail} 失败 =====\x1b[0m\n`);
process.exit(fail ? 1 : 0);
