// 数据存储
let countdownData = null;
let intervalId = null;
let alignTimeoutId = null;      // 对齐到真实秒边界的那个一次性定时器
let heartbeatRafId = null;

// 页面加载时检查是否有保存的数据
window.addEventListener('DOMContentLoaded', () => {
  loadSavedData();
  loadTheme();
  initHeartbeat();
  buildOdoRow();
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

// 数值 → 定长数字数组（高位补零，超长截尾）
function odoDigitsOf(value, count) {
  return String(Math.max(0, Math.floor(value)))
    .padStart(count, '0')
    .slice(-count)
    .split('')
    .map(Number);
}

// 每一位的「圈长」（这根滚轮上到底印几个数字就回绕）：
//   个位 0-9 → 10 格 ；分/秒的十位 0-5 → 6 格 ；小时的十位 0-2 → 3 格
// 关键：十位不是 0-9 的十格轮。秒从 00 跳到 59 时，十位是 0→5，
// 若按十格轮算就得一次滚 5 格（糊成一片、方向还乱）；按 6 格轮算，
// 每一次永远只滚 1 格，跟机械里程表一样匀速。
function odoCycleFor(group, idx) {
  if (idx === 0) return 10;                       // 个位
  if (group === 'hours') return 3;                // 时十位：0,1,2
  return 6;                                       // 分/秒十位：0-5
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
let odoReels = [];          // 6 个滚轮：时/分/秒 各两位
let odoDaysEl = null;       // 天数（静态数字，不滚）

// 一位数字 = 一个竖向滚轮
function odoMakeReel(group, idx) {
  const cycle = odoCycleFor(group, idx);
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
  return { reel, track, group, idx, cycle, offset: 0, digit: 0, ready: false };
}

// 单位（天/时/分/秒）
function odoMakeUnit(text) {
  const s = document.createElement('span');
  s.className = 'odo-unit';
  s.textContent = text;
  return s;
}

// 搭出「X 天 HH 时 MM 分 SS 秒」这一行
function buildOdoRow() {
  const row = document.getElementById('odoRow');
  row.innerHTML = '';
  odoReels = [];

  odoDaysEl = document.createElement('span');
  odoDaysEl.className = 'odo-num';
  odoDaysEl.textContent = '0';
  row.appendChild(odoDaysEl);
  row.appendChild(odoMakeUnit('天'));

  for (const [group, label] of [['hours', '时'], ['minutes', '分'], ['seconds', '秒']]) {
    for (let idx = 1; idx >= 0; idx--) {     // 1 = 十位，0 = 个位
      const r = odoMakeReel(group, idx);
      odoReels.push(r);
      row.appendChild(r.reel);
    }
    row.appendChild(odoMakeUnit(label));
  }
  odoApplyVars();
}

// 把定稿参数写进 CSS 变量（JS 常量是唯一真源；style.css 里的同值只是启动前的兜底）
function odoApplyVars() {
  const row = document.getElementById('odoRow');
  row.style.setProperty('--digit-want', ODO_DIGIT_PX + 'px');
  // 走「有效滚动时长」而不是直接写设定值：万一以后把读数节拍调快了，
  // 这里会自动按节拍钳制，不会再出现「屏幕上映着错数字」那种情况。
  row.style.setProperty('--reel-dur', odoEffectiveDur(ODO_ROLL_MS, 1) + 'ms');
  row.style.setProperty('--reel-ease', ODO_EASE);
}

// 无动画地把滚轮钉到某个格索引
function odoPinReel(r, offset) {
  r.track.style.transition = 'none';
  r.track.style.transform = `translateY(calc(${-offset} * var(--cell)))`;
  void r.track.offsetHeight;                 // 强制重排，让 none 生效
  r.track.style.transition = '';
}

// 喂一个新数字
function odoFeedReel(r, digit) {
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

  // 数值一次跳了整圈以上（休眠唤醒、改了设置）→ 直接落位，别滚成电风扇
  if (step.delta >= r.cycle) {
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

// 用一份读数刷新整行滚轮
function odoFeedParts(parts) {
  if (!odoDaysEl) return;
  odoDaysEl.textContent = String(parts.days);

  const want = {
    hours:   odoDigitsOf(parts.hours, 2),
    minutes: odoDigitsOf(parts.minutes, 2),
    seconds: odoDigitsOf(parts.seconds, 2)
  };
  for (const r of odoReels) {
    odoFeedReel(r, want[r.group][1 - r.idx]);
  }
}

// 「重新设置」后把滚轮状态清干净：下次启动直接落位，不从上一次的偏移开始滚
function odoResetReels() {
  for (const r of odoReels) { r.ready = false; r.offset = 0; r.digit = 0; }
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
    expectedAge,
    startDate: new Date().toISOString()
  };
  
  saveData();
  showCountdown();
  startUpdateInterval();
}

// 显示倒计时界面
function showCountdown() {
  document.getElementById('inputSection').classList.add('hidden');
  document.getElementById('countdownSection').classList.remove('hidden');
  
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
  odoFeedParts(odoSplitDuration(endDate - now));

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
    odoResetReels();          // 滚轮状态清干净，下次启动直接落位不滚

    // 清除数据
    countdownData = null;
    localStorage.removeItem('lifeCountdownData');
    
    // 清空输入
    document.getElementById('birthDate').value = '';
    document.getElementById('expectedAge').value = '';
    
    // 切换界面
    document.getElementById('countdownSection').classList.add('hidden');
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
