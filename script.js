// 数据存储
let countdownData = null;
let intervalId = null;
let alignTimeoutId = null;      // 对齐到真实秒边界的那个一次性定时器
let heartbeatRafId = null;
let odoYearStamp = null;        // 上次喂值时的「年」——用来抓跨年那一刻
let oyMode = 'year';            // 心跳线下方那一块当前显示：'year' 年份倒计时 / 'life' 剩余生命

// 页面加载时检查是否有保存的数据
window.addEventListener('DOMContentLoaded', () => {
  loadSavedData();
  loadTheme();
  initHeartbeat();
  odoBuildRows();
  oyApplyMode();
});

// 加载主题
function loadTheme() {
  const theme = localStorage.getItem('theme') || 'dark';
  if (theme === 'light') {
    document.body.classList.add('light-mode');
    document.getElementById('themeToggle').querySelector('.theme-icon').textContent = '☀️';
  }
}

// 切换主题
function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  const icon = document.getElementById('themeToggle').querySelector('.theme-icon');
  
  if (isLight) {
    icon.textContent = '☀️';
    localStorage.setItem('theme', 'light');
  } else {
    icon.textContent = '🌙';
    localStorage.setItem('theme', 'dark');
  }
}

// ===== 心跳线：笔尖描记式心电图（ECG）=====
// 参考真实心电监护仪，也照着心脏电活动的先后顺序（教科书 ECG 图）：
//   P波 → PR段 → QRS波（咚！）→ ST段 → T波 → U波 → 静息基线
// 屏幕正中有个"笔尖"（发光点）。心脏每搏动一次，笔尖才在纸上描出一个波形包：
// 先小丘(P)、小下陷(Q)、猛地向上一挑(R) —— 就是"咚"的那一下 —— 再深谷(S)、
// T波、U波，然后回到基线等下一拍。笔尖画下的墨迹留在原处，并缓慢向左漂移。
//
// 所以：一开始屏幕上什么都没有，波形是随着心跳一拍一拍"长"出来的，
// 而不是一上来就铺满整屏的静态波纹。点一下画面，可以当场"咚"一下。
//
// 全屏 clearRect 只由唯一一个常驻 rAF 主循环独占，不存在并发擦画布。
// 调参：ECG_PERIOD_MS 越大心跳越慢；ECG_AMPL 控制波形高度；ECG_PEN_FRAC 是笔尖位置。

const ECG_BEAT_W     = 300;                                  // 一次心搏占的屏幕宽度(px)
const ECG_PERIOD_MS  = 1900;                                 // 一次心搏周期(ms)，越大越慢（≈31.6 bpm 的"弱弱的心跳"）
const ECG_PERIOD_S   = ECG_PERIOD_MS / 1000;                 // 同上，单位秒
const ECG_SCROLL     = (ECG_BEAT_W / ECG_PERIOD_MS) * 1000;  // 墨迹漂移速度 px/s
const ECG_AMPL       = 78;                                   // R 波尖峰高度(px)
const ECG_PEN_FRAC   = 0.5;                                  // 笔尖水平位置(0~1)
const ECG_FIRST_BEAT = 0.55;                                 // 首拍延迟(秒)：先静一息再"咚"
const ECG_MAX_BEATS  = 64;                                   // 最多保留多少拍心搏时刻
const ECG_PULSE_MS   = 620;                                  // "咚"的脉冲圈时长(ms)

// >>> ECG_PURE_MATH_BEGIN  此块为纯函数、不引用 DOM —— 供离线对照测试整块抽取
// 单次心搏波形控制点：[相位 0~1, 振幅系数]，正=向上，基线为 0
const ECG_POINTS = [
  [0.000,  0.00],
  [0.020,  0.00],
  [0.048,  0.10],   // P   小丘（心房除极）
  [0.078,  0.00],   // PR 段  回到基线
  [0.130,  0.00],
  [0.152, -0.12],   // Q   小下陷
  [0.172,  1.00],   // R   最高尖峰 ← "咚"
  [0.194, -0.40],   // S   深谷
  [0.226,  0.00],   // 回到基线
  [0.268,  0.00],   // ST 段
  [0.312,  0.26],   // T   小丘（心室复极）
  [0.368,  0.00],
  [0.420,  0.08],   // U   小丘
  [0.452,  0.00],
  [1.000,  0.00]    // 静息，等下一拍
];

// 相位 u(0~1) → 振幅系数（约 -0.40 ~ 1.00），线性插值保证尖峰锐利
function ecgPhaseValue(u) {
  if (u <= 0 || u >= 1) return 0;
  for (let i = 0; i < ECG_POINTS.length - 1; i++) {
    const u0 = ECG_POINTS[i][0], v0 = ECG_POINTS[i][1];
    const u1 = ECG_POINTS[i + 1][0], v1 = ECG_POINTS[i + 1][1];
    if (u >= u0 && u <= u1) {
      const t = (u - u0) / (u1 - u0 || 1);
      return v0 + (v1 - v0) * t;
    }
  }
  return 0;
}

// 取出 beats 中不晚于 t 的最近一次心搏时刻；没有则返回 null
function latestBeatAtOrBefore(beats, t) {
  for (let i = beats.length - 1; i >= 0; i--) {
    if (beats[i] <= t) return beats[i];
  }
  return null;
}

// 屏幕上 x 处此刻的振幅系数（延迟线模型：笔尖画下的墨迹随时间向左漂移）
function ecgAmplAtScreenX(x, penX, elapsed, beats) {
  if (x > penX) return 0;                       // 笔尖还没描到这里 → 空白
  const age = (penX - x) / ECG_SCROLL;          // 该处墨迹已存在多久(秒)
  const drawnAt = elapsed - age;                // 该处被描出的时刻(秒)
  if (drawnAt < 0) return 0;                    // 还没描到 → 空白
  const emit = latestBeatAtOrBefore(beats, drawnAt);
  if (emit === null) return 0;                  // 那时还没心跳 → 平线
  return ecgPhaseValue((drawnAt - emit) / ECG_PERIOD_S);
}

// 笔尖此刻的振幅系数（即当下这一拍的形态）
function ecgAmplAtPen(elapsed, beats) {
  const emit = latestBeatAtOrBefore(beats, elapsed);
  if (emit === null) return 0;
  const u = (elapsed - emit) / ECG_PERIOD_S;
  return u >= 1 ? 0 : ecgPhaseValue(u);
}
// <<< ECG_PURE_MATH_END

let hbCanvas = null;
let hbCtx = null;
let hbStart = null;                 // 首帧时间戳，elapsed 从这里算
let hbBeats = [];                   // 已发生的心搏时刻(秒) —— 相当于纸上已印下的波形包
let hbNextBeat = ECG_FIRST_BEAT;    // 下一次自动心搏的时刻(秒)
let hbPulses = [];                  // 每次"咚"的脉冲圈时刻(秒)

// 初始化心跳线
function initHeartbeat() {
  hbCanvas = document.getElementById('heartbeatCanvas');
  hbCtx = hbCanvas.getContext('2d');

  const resize = () => {
    hbCanvas.width = window.innerWidth;
    hbCanvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);

  // 点一下画面 → 当场"咚"一下，多描一个波形包
  window.addEventListener('pointerdown', onHeartbeatPointerDown);

  // 重置状态，防止重复初始化时残留旧循环
  hbStart = null;
  hbBeats = [];
  hbNextBeat = ECG_FIRST_BEAT;
  hbPulses = [];
  if (heartbeatRafId) cancelAnimationFrame(heartbeatRafId);
  heartbeatRafId = requestAnimationFrame(heartbeatFrame);
}

// 手动心搏：不改写已画下的墨迹，只往节律里插一拍
function triggerBeat() {
  if (hbStart === null) return;
  const elapsed = (performance.now() - hbStart) / 1000;
  const last = hbBeats.length ? hbBeats[hbBeats.length - 1] : -Infinity;
  if (elapsed - last < 0.35) return;              // 节流：别连点成机关枪
  hbBeats.push(elapsed);
  hbPulses.push(elapsed);
  hbNextBeat = elapsed + ECG_PERIOD_S;            // 插完这一拍，顺手回到正常节律
}

// 点在输入框/按钮上不算"摸脉搏"
function onHeartbeatPointerDown(e) {
  const tag = ((e.target && e.target.tagName) || '').toLowerCase();
  if (tag === 'input' || tag === 'button' || tag === 'a' || tag === 'select') return;
  triggerBeat();
}

// 心跳主循环：笔尖描记 + "咚"的脉冲圈
function heartbeatFrame(ts) {
  const ctx = hbCtx;
  const width = hbCanvas.width;
  const height = hbCanvas.height;
  const centerY = height / 2;
  const penX = Math.round(width * ECG_PEN_FRAC);

  if (hbStart === null) hbStart = ts;
  const elapsed = (ts - hbStart) / 1000;

  // —— 到点就"咚"：记下这一拍的时刻，笔尖随即把波形包描出来 ——
  while (hbNextBeat <= elapsed) {
    hbBeats.push(hbNextBeat);
    hbPulses.push(hbNextBeat);
    hbNextBeat += ECG_PERIOD_S;
  }
  if (hbBeats.length > ECG_MAX_BEATS) hbBeats.splice(0, hbBeats.length - ECG_MAX_BEATS);
  if (hbPulses.length > 8) hbPulses.splice(0, hbPulses.length - 8);

  // 主题颜色每帧现取，切主题无需额外重绘
  const isLight = document.body.classList.contains('light-mode');
  const baseColor  = isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.12)';
  const lineColor  = isLight ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.55)';
  const fadedColor = isLight ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.10)';
  const glowColor  = isLight ? 'rgba(0, 0, 0, 0.28)' : 'rgba(255, 255, 255, 0.28)';

  // 1) 整屏只清一次
  ctx.clearRect(0, 0, width, height);

  // 2) 基线：整幅"纸"的横轴
  ctx.strokeStyle = baseColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();

  // 3) 已描出的墨迹：只有笔尖走过的部分(xStart→penX)才有波形，其余是空白
  const xStart = Math.max(0, penX - elapsed * ECG_SCROLL);
  if (penX - xStart >= 1) {
    let stroke = lineColor;
    if (penX - xStart > 2) {
      const grad = ctx.createLinearGradient(penX, 0, xStart, 0);
      grad.addColorStop(0, lineColor);      // 刚画下的墨迹最清晰
      grad.addColorStop(1, fadedColor);     // 越远越淡（旧墨迹）
      stroke = grad;
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let x = xStart; x <= penX; x++) {
      const y = centerY - ECG_AMPL * ecgAmplAtScreenX(x, penX, elapsed, hbBeats);
      if (x === xStart) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 4) 笔尖发光点：跟着当下这一拍起伏，"咚"的时候向上挑一下
  const penY = centerY - ECG_AMPL * ecgAmplAtPen(elapsed, hbBeats);
  const glow = ctx.createRadialGradient(penX, penY, 0, penX, penY, 18);
  glow.addColorStop(0, glowColor);
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(penX, penY, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = lineColor;
  ctx.beginPath();
  ctx.arc(penX, penY, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // 5) "咚"的脉冲圈：从笔尖荡开、渐隐
  for (const p of hbPulses) {
    const age = elapsed - p;
    if (age < 0 || age * 1000 > ECG_PULSE_MS) continue;
    const k = (age * 1000) / ECG_PULSE_MS;        // 0 → 1
    ctx.strokeStyle = isLight
      ? `rgba(0, 0, 0, ${((1 - k) * 0.30).toFixed(3)})`
      : `rgba(255, 255, 255, ${((1 - k) * 0.30).toFixed(3)})`;
    ctx.lineWidth = 1.6 * (1 - k) + 0.4;
    ctx.beginPath();
    ctx.arc(penX, penY, 6 + k * 34, 0, Math.PI * 2);
    ctx.stroke();
  }

  heartbeatRafId = requestAnimationFrame(heartbeatFrame);
}

// ===== 读秒：滚轮（odometer）=====
// 视觉语言借自 CodePen 的「CSS-Only Countdown Clock」（竖向滚轮 + 窄视窗裁切），
// 但驱动逻辑换成了 JS —— 原版是「页面加载即启动的固定时长动画」，
// 没法对准真实时钟、没法设成任意时长、也没法归零。这里的滚轮由真实读数驱动。
//
// 参数（在 odometer-preview.html 上定稿）：
//   滚动范围 = 时 + 分 + 秒（天一天才动一次，滚它没意义还吵 → 保持静态数字）
//   滚动时长 = 600ms ／ 缓动 = 平滑 ／ 数字字号 = 80px
// 读数节拍是 setInterval(…, 1000)；600ms 远小于节拍，正式版永不触顶被钳制。
const ODO_DIGIT_PX    = 80;                                  // 数字字号(px)
const ODO_ROLL_MS     = 600;                                 // 滚动时长(ms)
const ODO_EASE        = 'cubic-bezier(0.22, 0.61, 0.36, 1)'; // 平滑
const ODO_REEL_CYCLES = 2;                                   // 每条滚带印几圈数字（折回后偏移 < 圈长，两圈足够）

// >>> ODO_PURE_MATH_BEGIN  纯函数区（不引用 DOM，供离线对照测试整块抽取）
// 毫秒差 → { days, hours, minutes, seconds }
function odoSplitDuration(diff) {
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  return {
    days:    Math.floor(diff / 86400000),
    hours:   Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000)
  };
}

// 距「今年结束」（次年 1/1 00:00 本地时间）还有多久。
// 与上面那条的关键区别：**小时是总小时数，不是 0-23** ——
// 1 月 1 日 00:00 那一刻约 8784 小时（闰年 366 天），所以这一行的小时是 4 位数。
function odoSplitYearSpan(diff) {
  if (diff <= 0) return { hours: 0, minutes: 0, seconds: 0 };
  return {
    hours:   Math.floor(diff / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000)
  };
}

// 今年结束的那个瞬间（本地时区）。跨年那一刻它自动变成「下一年的结束」，
// 不需要用户重设 —— 但数值会从 0000:00:00 直接跳到 8783:59:59，
// 所以调用方必须显式让滚轮落位（见 odoSnapRow 的说明）。
function odoYearEnd(now) {
  return new Date(now.getFullYear() + 1, 0, 1);
}

// 数值 → 定长数字数组（高位补零，超长截尾）
function odoDigitsOf(value, count) {
  return String(Math.max(0, Math.floor(value)))
    .padStart(count, '0')
    .slice(-count)
    .split('')
    .map(Number);
}

// 每一位的「圈长」（这根滚轮上到底印几个数字就回绕）：
//   个位 0-9 → 10 格 ；分/秒的十位 0-5 → 6 格 ；时的十位 0-2 → 3 格
// 关键：十位不是 0-9 的十格轮。秒从 00 跳到 59 时，十位是 0→5，
// 若按十格轮算就得一次滚 5 格（糊成一片、方向还乱）；按 6 格轮算，
// 每一次永远只滚 1 格，跟机械里程表一样匀速。
//
// 圈长原来是写死的（hours 十位 → 3），加「今年剩余」那一行就不够用了：
// 它的总小时数最大 8784（闰年 366 天），小时要 4 位，而千位只会用到 0-8 → 圈长 9。
// 所以改成**由该字段的取值范围推导**：某一位上出现过的最大数字 + 1 就是圈长。
//   距今年结束 hours ∈ 0..8784 → 千位 9 格、百/十/个位 10 格
//   生命倒计时 hours ∈ 0..23   → 十位 3 格、个位 10 格（与原来完全一致）
const ODO_FIELD_MAX = { hours: 23, minutes: 59, seconds: 59, yearHours: 8784 };

// 某一位上出现过的最大数字：
// maxValue 已经越过「该位满十进一」的边界（≥ 10×位权 − 1）时，这一位 0-9 全都出现过
function odoMaxDigitAt(maxValue, placeValue) {
  if (maxValue >= placeValue * 10 - 1) return 9;
  return Math.floor(maxValue / placeValue) % 10;
}

function odoCycleFor(group, idx) {
  const max = ODO_FIELD_MAX[group];
  if (max === undefined) return 10;               // 没登记过的字段按十格轮兜底
  return odoMaxDigitAt(max, Math.pow(10, idx)) + 1;
}

// 滚轮第 i 格上印的数字。倒计时递减、滚轮一律「向上滚」，
// 所以格子里要按【递减】顺序排：0, 9, 8, …, 1, 0, 9, 8, …
function odoCellDigit(i, cycle) {
  return (cycle - (i % cycle)) % cycle;
}

// 显示数字 d 时，滚轮该停在的格索引
function odoOffsetForDigit(d, cycle) {
  return (cycle - (d % cycle)) % cycle;
}

// 从 prevDigit 变到 nextDigit，滚轮要向上滚几格。
// 按各自的圈长算 → 正常递减永远是 1 格（含回绕）。
function odoReelDelta(prevDigit, nextDigit, cycle) {
  return ((prevDigit - nextDigit) % cycle + cycle) % cycle;
}

// 滚动一步的状态机。offset 会被折回 [0, cycle) ——
// 因为格子排布以 cycle 为周期，折回前后画面完全一样（无动画，看不出来）。
function odoAdvance(offset, prevDigit, nextDigit, cycle) {
  const delta = odoReelDelta(prevDigit, nextDigit, cycle);
  if (delta === 0) return { offset, delta: 0, folded: false };
  let o = offset, folded = false;
  if (o + delta >= cycle) { o = o % cycle; folded = true; }
  return { offset: o + delta, delta, folded };
}

// 「一次大跳」的判定：距上次喂值超过 ODO_JUMP_MS 毫秒，就认为中间发生了
// 休眠唤醒 / 改了设置 / 页面被挂起 —— 这时别把攒下的十几格慢慢滚出来
// （那会像电风扇），直接落位到目标格。
//
// 门槛为什么取「正常节拍的 3 倍」：正常一拍是 1000ms，机器偶尔卡顿会让
// 某一拍迟到，取 3 倍就不会把这种正常抖动误判成大跳。
const ODO_JUMP_MS = 3000;
// 间隔拿不到（首次喂值 / 时钟异常）时也按大跳处理 ——
// 直接落位总比滚成电风扇稳，而且首帧本来就不该有动画。
function odoIsBigJump(gapMs) {
  return !Number.isFinite(gapMs) || gapMs > ODO_JUMP_MS;
}

// 浏览器一帧。滚动动画结束后，必须至少留出一帧让数字"落格"，
// 否则它永远停在两格之间、读出来就是相邻的另一个数字。
const ODO_FRAME_MS = 1000 / 60;

// 演示倍速下的「有效滚动时长」。
// 读数节拍被倍速压缩成 dt = 1000/speed 毫秒，而滚动动画时长若还按原值走，
// 就会出现「动画还没跑完、下一次更新又来了」——滚轮永远追不上目标。
// 实测（Electron 真渲染进程，60 次采样 × 8 组参数）：
//   · dur > dt            → 「显示数字 == 真实读数」的时间占比恒为 0%，屏幕上是错的数字
//   · dur = dt - 10%dt    → 15× 下仍为 0%（停稳期只剩 6.7ms，不足一帧）
//   · dur <= dt - 一帧    → 恢复正常
// 所以钳制线取「节拍减一帧」，而不是按比例留百分比 —— 高速档下百分比会小于一帧。
// 只钳制、不缩放：绝不偷偷改动用户设定的数值，只保证它在当前倍速下不会算错。
function odoEffectiveDur(durWant, speed) {
  const dt = 1000 / Math.max(speed, 1e-6);
  const cap = Math.max(0, dt - ODO_FRAME_MS);
  return Math.min(durWant, cap);
}
// <<< ODO_PURE_MATH_END
// ── 读数行的注册表 ───────────────────────────────────────────────────
// 现在有三行滚轮，各自独立、各按自己的真值走：
//   life  → 老读秒卡里的「剩余生命倒计时」（天静态 + 时/分/秒，6 根）
//   year  → 心跳线下方新块的「距离今年结束」（时/分/秒，小时是总小时数 ⇒ 4 位，8 根）
//   life2 → 新块切到「剩余生命」时显示的那一行（与 life 同构）
// 为什么三行各自独立、而不是共用一组滚轮来回重建：
//   ① 位数不同（6 vs 8），共用就得每次切换重建 DOM，正好卡在 glitch 动效中间；
//   ② 两行都【持续喂值】⇒ 每行的数值始终连续，切换只是换个显示，
//      不会出现「12 时 → 8700 时」那种数值突变要滚一大段。
const ODO_ROWS_CFG = {
  life: {
    el: 'odoRow', days: true,
    fields: [
      { key: 'hours',   cycleKey: 'hours',   digits: 2, unit: '时' },
      { key: 'minutes', cycleKey: 'minutes', digits: 2, unit: '分' },
      { key: 'seconds', cycleKey: 'seconds', digits: 2, unit: '秒' }
    ]
  },
  year: {
    el: 'odoRowYear', days: false,
    fields: [
      { key: 'hours',   cycleKey: 'yearHours', digits: 4, unit: '时' },
      { key: 'minutes', cycleKey: 'minutes',   digits: 2, unit: '分' },
      { key: 'seconds', cycleKey: 'seconds',   digits: 2, unit: '秒' }
    ]
  },
  life2: {
    el: 'odoRowLife2', days: true,
    fields: [
      { key: 'hours',   cycleKey: 'hours',   digits: 2, unit: '时' },
      { key: 'minutes', cycleKey: 'minutes', digits: 2, unit: '分' },
      { key: 'seconds', cycleKey: 'seconds', digits: 2, unit: '秒' }
    ]
  }
};
let odoRows = {};           // name → { el, reels[], daysEl }

// 一位数字 = 一个竖向滚轮
function odoMakeReel(cycleKey, idx, digits) {
  const cycle = odoCycleFor(cycleKey, idx);
  const reel = document.createElement('span');
  reel.className = 'reel';

  const track = document.createElement('span');
  track.className = 'reel-track';
  for (let i = 0; i < cycle * ODO_REEL_CYCLES; i++) {
    const cell = document.createElement('i');
    cell.textContent = String(odoCellDigit(i, cycle));
    track.appendChild(cell);
  }
  reel.appendChild(track);
  return { reel, track, cycleKey, idx, digits, cycle,
           offset: 0, digit: 0, ready: false, lastFeedAt: 0 };
}

// 单位（天/时/分/秒）
function odoMakeUnit(text) {
  const s = document.createElement('span');
  s.className = 'odo-unit';
  s.textContent = text;
  return s;
}

// 把定稿参数写进某一行的 CSS 变量（JS 常量是唯一真源；style.css 里的同值只是启动前的兜底）
function odoApplyVars(el) {
  el.style.setProperty('--digit-want', ODO_DIGIT_PX + 'px');
  // 走「有效滚动时长」而不是直接写设定值：万一以后把读数节拍调快了，
  // 这里会自动按节拍钳制，不会再出现「屏幕上映着错数字」那种情况。
  el.style.setProperty('--reel-dur', odoEffectiveDur(ODO_ROLL_MS, 1) + 'ms');
  el.style.setProperty('--reel-ease', ODO_EASE);
}

// 搭出一行：「X 天 HH 时 MM 分 SS 秒」（days=false 时只搭后面的时/分/秒）
function odoBuildRow(name) {
  const cfg = ODO_ROWS_CFG[name];
  const row = document.getElementById(cfg.el);
  if (!row) return;
  row.innerHTML = '';

  const rec = { el: row, reels: [], daysEl: null };

  if (cfg.days) {
    rec.daysEl = document.createElement('span');
    rec.daysEl.className = 'odo-num';
    rec.daysEl.textContent = '0';
    row.appendChild(rec.daysEl);
    row.appendChild(odoMakeUnit('天'));
  }

  for (const f of cfg.fields) {
    for (let idx = f.digits - 1; idx >= 0; idx--) {    // 从最高位排到个位
      const r = odoMakeReel(f.cycleKey, idx, f.digits);
      r.key = f.key;
      rec.reels.push(r);
      row.appendChild(r.reel);
    }
    row.appendChild(odoMakeUnit(f.unit));
  }

  odoApplyVars(row);
  odoRows[name] = rec;
}

function odoBuildRows() { for (const name of Object.keys(ODO_ROWS_CFG)) odoBuildRow(name); }

// 无动画地把滚轮钉到某个格索引
function odoPinReel(r, offset) {
  r.track.style.transition = 'none';
  r.track.style.transform = `translateY(calc(${-offset} * var(--cell)))`;
  void r.track.offsetHeight;                 // 强制重排，让 none 生效
  r.track.style.transition = '';
}

// 喂一个新数字
function odoFeedReel(r, digit) {
  const now = performance.now();
  const gapMs = r.lastFeedAt ? now - r.lastFeedAt : null;
  r.lastFeedAt = now;

  if (!r.ready) {                            // 首次：直接落位，不滚
    r.digit = digit;
    r.offset = odoOffsetForDigit(digit, r.cycle);
    odoPinReel(r, r.offset);
    r.ready = true;
    return;
  }

  const step = odoAdvance(r.offset, r.digit, digit, r.cycle);
  if (step.delta === 0) return;
  r.digit = digit;

  // 距上次喂值太久 → 中间大概率休眠/挂起了，攒下的格数直接落位，别滚成电风扇
  if (odoIsBigJump(gapMs)) {
    r.offset = odoOffsetForDigit(digit, r.cycle);
    odoPinReel(r, r.offset);
    return;
  }

  if (step.folded) {                         // 折回：无动画，画面完全不变
    r.offset = r.offset % r.cycle;
    odoPinReel(r, r.offset);
  }

  r.offset = step.offset;
  r.track.style.transform = `translateY(calc(${-r.offset} * var(--cell)))`;
}

// 用一份读数刷新某一行的滚轮
function odoFeedRow(name, parts) {
  const rec = odoRows[name];
  if (!rec) return;
  if (rec.daysEl) rec.daysEl.textContent = String(parts.days == null ? 0 : parts.days);

  for (const r of rec.reels) {
    const ds = odoDigitsOf(parts[r.key] == null ? 0 : parts[r.key], r.digits);
    odoFeedReel(r, ds[r.digits - 1 - r.idx]);      // idx 0 = 个位 ⇒ 取数组最后一位
  }
}

// 让某一行（不给名字即全部）下次喂值时【直接落位】、不滚。
// 什么时候必须用它 —— 「时间没跳、但数值跳了」的场合：
//   · 跨年那一刻（0000:00:00 → 8783:59:59）
//   · 重新设置 / 换了出生日期与寿命
//   · 切换显示的行
// 为什么不能只靠 odoIsBigJump：它判的是「距上次喂值的毫秒差 > 3s」，
// 而这些场合相邻两次喂值只隔 1 秒 —— 时间差判据根本看不见数值突变。
// （这是上轮把「防电风扇」从 delta>=cycle 改成时间差驱动时留下的盲区。）
function odoSnapRow(name) {
  const rec = odoRows[name];
  if (!rec) return;
  for (const r of rec.reels) { r.ready = false; r.offset = 0; r.digit = 0; r.lastFeedAt = 0; }
}
function odoSnapAll() { for (const name of Object.keys(odoRows)) odoSnapRow(name); }

// ── 心跳线下方那一块：年份倒计时 ⇄ 剩余生命 ─────────────────────────────
// 两行都在被【持续喂值】，所以切换只是「换个显示」——数字本身不会突变。
// 视觉上用一次赛博朋克 glitch 把它盖住：横向错位 + 青/粉分离，然后换数。
const OY_TEXT = {
  year: { title: '距离今年结束',   btn: '⇄ 剩余生命' },
  life: { title: '剩余生命倒计时', btn: '⇄ 今年剩余' }
};

// 把当前模式对应的文案与显隐落到 DOM（幂等，启动时也调它一次）
function oyApplyMode() {
  const sec = document.getElementById('oySection');
  if (!sec) return;
  document.getElementById('oyTitle').textContent = OY_TEXT[oyMode].title;
  document.getElementById('oySwitch').textContent = OY_TEXT[oyMode].btn;
  document.getElementById('odoRowYear').classList.toggle('hidden', oyMode !== 'year');
  document.getElementById('odoRowLife2').classList.toggle('hidden', oyMode !== 'life');
}

function toggleYearMode() {
  const sec = document.getElementById('oySection');
  if (!sec) return;

  // 重新触发动画：先摘 class、强制重排、再挂上
  sec.classList.remove('glitching');
  void sec.offsetWidth;
  sec.classList.add('glitching');

  // 换数放在抖动中途（动画 180ms），正好被错位帧盖住
  setTimeout(() => {
    oyMode = (oyMode === 'year') ? 'life' : 'year';
    oyApplyMode();
  }, 90);

  setTimeout(() => sec.classList.remove('glitching'), 220);
}

// 加载保存的数据
function loadSavedData() {
  const saved = localStorage.getItem('lifeCountdownData');
  if (saved) {
    try {
      countdownData = JSON.parse(saved);
      showCountdown();
      startUpdateInterval();
    } catch (e) {
      console.error('加载数据失败', e);
    }
  }
}

// 保存数据
function saveData() {
  localStorage.setItem('lifeCountdownData', JSON.stringify(countdownData));
}

// ===== 日期工具 =====
// 把 <input type="date"> 给的 'YYYY-MM-DD' 按【本地时区】解析。
// 坑：new Date('2005-03-15') 会被当作 UTC 午夜 → 东八区变成当天 08:00，
// 倒计时终点会整体偏 8 小时。所以手动拆字段，构造本地 00:00。
function parseLocalDate(str) {
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 出生日期 → 当前周岁（今年生日还没到则减 1）
function calcAge(birthDate, now) {
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  const dayDiff = now.getDate() - birthDate.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age--;
  }
  return age;
}

// 出生日期 + 预期寿命年数 → 倒计时终点（生日当天 本地 00:00）
function calcEndDate(birthDate, expectedAge) {
  return new Date(
    birthDate.getFullYear() + expectedAge,
    birthDate.getMonth(),
    birthDate.getDate()
  );
}

// 启动倒计时
function startCountdown() {
  const birthDateStr = document.getElementById('birthDate').value;
  const expectedAge = parseInt(document.getElementById('expectedAge').value);
  
  // 验证输入
  if (!birthDateStr || !expectedAge) {
    alert('请填写完整信息');
    return;
  }
  
  const birthDate = parseLocalDate(birthDateStr);
  const now = new Date();
  
  // 验证出生日期
  if (birthDate > now) {
    alert('出生日期不能晚于今天');
    return;
  }
  
  const currentAge = calcAge(birthDate, now);
  
  // 验证预期寿命
  if (expectedAge <= currentAge) {
    alert(`预计寿命必须大于当前年龄（${currentAge}岁）`);
    return;
  }
  
  if (expectedAge > 150) {
    alert('预计寿命不能超过 150 岁');
    return;
  }
  
  // 保存数据
  countdownData = {
    birthDate: birthDateStr,
    expectedAge
  };
  
  saveData();
  showCountdown();
  startUpdateInterval();
}

// 显示倒计时界面
function showCountdown() {
  document.getElementById('inputSection').classList.add('hidden');
  document.getElementById('countdownSection').classList.remove('hidden');
  document.getElementById('oySection').classList.remove('hidden');   // 心跳线下方的年份块
  oyApplyMode();

  updateCountdown();
  generateHealthWarning();
}

// 更新倒计时显示
function updateCountdown() {
  if (!countdownData) return;
  
  const { birthDate: birthDateStr, expectedAge } = countdownData;
  const birthDate = parseLocalDate(birthDateStr);
  const now = new Date();
  
  const currentAge = calcAge(birthDate, now);
  const remainingYears = expectedAge - currentAge;
  
  // 更新统计数据
  document.getElementById('passedYears').textContent = currentAge;
  document.getElementById('remainingYears').textContent = remainingYears;
  
  // 到预期寿命终点（生日当天 00:00）还有多久 → 交给滚轮逐位翻牌
  const endDate = calcEndDate(birthDate, expectedAge);
  const lifeParts = odoSplitDuration(endDate - now);
  odoFeedRow('life', lifeParts);
  odoFeedRow('life2', lifeParts);       // 心跳线下方那一块切到「剩余生命」时显示的那行

  // 距「今年结束」（次年 1/1 00:00）还有多久。跨年那一刻年份会变 ——
  // 数值从 0000:00:00 直接跳到 8783:59:59，而时间差判据看不见这种突变，
  // 所以在这里显式让年行落位。
  const year = now.getFullYear();
  if (odoYearStamp !== null && year !== odoYearStamp) odoSnapRow('year');
  odoYearStamp = year;
  odoFeedRow('year', odoSplitYearSpan(odoYearEnd(now) - now));

  // 计算人生进度
  const progressPercent = ((currentAge / expectedAge) * 100).toFixed(2);
  document.getElementById('progressPercent').textContent = progressPercent + '%';
  document.getElementById('progressFill').style.width = progressPercent + '%';
}

// 生成健康警告
function generateHealthWarning() {
  const { expectedAge } = countdownData;
  const warningSection = document.getElementById('warningSection');
  
  if (expectedAge >= 70) {
    const warnings = [
      '老年期疾病高发：70岁以上人群心血管疾病、癌症、阿尔茨海默病等发病率显著上升。',
      '熬夜危害累积：长期睡眠不足会加速细胞衰老，增加慢性病风险，建议每日保证7-8小时优质睡眠。',
      '现代亚健康问题：久坐、缺乏运动、压力过大会导致代谢综合征，需要定期体检和适度运动。',
      '肥胖相关风险：超重会增加糖尿病、高血压、关节疾病风险，建议保持健康体重（BMI 18.5-24）。',
      '建议：保持规律作息、均衡饮食、适度运动、定期体检、保持良好心态。'
    ];
    
    let html = '<div class="warning-title">健康风险提示</div>';
    html += '<div class="warning-content"><ul>';
    
    warnings.forEach(warning => {
      html += `<li>${warning}</li>`;
    });
    
    html += '</ul></div>';
    warningSection.innerHTML = html;
    warningSection.style.display = 'block';
  } else {
    warningSection.style.display = 'none';
  }
}

// 开始定时更新
function startUpdateInterval() {
  // 清除旧的定时器
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (alignTimeoutId) {
    clearTimeout(alignTimeoutId);
    alignTimeoutId = null;
  }

  // 先对齐到「真实秒」的边界再起跳，之后每 1000ms 一次。
  // 这样滚轮总是在秒真正翻牌的那一刻开始滚；否则它会在「启动后第 N 毫秒」
  // 这个随机相位上滚，读数看着总慢半拍。
  alignTimeoutId = setTimeout(() => {
    alignTimeoutId = null;
    updateCountdown();
    intervalId = setInterval(updateCountdown, 1000);
  }, 1000 - (Date.now() % 1000));
}

// 重置应用
function resetApp() {
  if (confirm('确定要重新设置吗？')) {
    // 停止定时器
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (alignTimeoutId) {
      clearTimeout(alignTimeoutId);
      alignTimeoutId = null;
    }
    odoSnapAll();             // 滚轮状态清干净，下次启动直接落位不滚
    odoYearStamp = null;
    oyMode = 'year';          // 复位后回到「今年倒计时」
    oyApplyMode();

    // 清除数据
    countdownData = null;
    localStorage.removeItem('lifeCountdownData');
    
    // 清空输入
    document.getElementById('birthDate').value = '';
    document.getElementById('expectedAge').value = '';
    
    // 切换界面
    document.getElementById('countdownSection').classList.add('hidden');
    document.getElementById('oySection').classList.add('hidden');
    document.getElementById('inputSection').classList.remove('hidden');
  }
}

// 窗口关闭时清理
window.addEventListener('beforeunload', () => {
  if (intervalId) {
    clearInterval(intervalId);
  }
  if (alignTimeoutId) {
    clearTimeout(alignTimeoutId);
  }
  if (heartbeatRafId) {
    cancelAnimationFrame(heartbeatRafId);
  }
});
