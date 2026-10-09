(() => {
  "use strict";
  if (navigator.webdriver) return;
  const BASE = new URL(".", document.currentScript.src).href;
  const Z = 1;
  const G = 2400;
  const GAP = 4;
  const MIN_ROOM = 200;
  const $ = (sel) => document.querySelector(sel);
  const rand = (a, b) => a + Math.random() * (b - a);
  const chance = (p) => Math.random() < p;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  let now = 0, dt = 0, last = 0, waiters = [], layer = null, origin = { x: 0, y: 0 };
  const cats = [];
  const frame = () => new Promise((r) => waiters.push(r));
  async function wait(ms) {
    const end = now + ms;
    while (now < end) await frame();
  }
  function tick(t) {
    dt = last ? clamp(t - last, 0, 50) : 0;
    last = t;
    now += dt;
    const o = layer.getBoundingClientRect();
    origin = { x: o.left, y: o.top };
    const w = waiters;
    waiters = [];
    for (const r of w) r();
    queueMicrotask(render);
    requestAnimationFrame(tick);
  }
  function rectOf(el) {
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { l: r.left - origin.x, r: r.right - origin.x, t: r.top - origin.y, b: r.bottom - origin.y };
  }
  const bottomOf = (sel, inset = 12) => () => {
    const r = rectOf($(sel));
    return r && { x0: r.l + inset, x1: r.r - inset, y: r.b - 1 };
  };
  const topOf = (el, inset = 10) => () => {
    const r = rectOf(el);
    return r && { x0: r.l + inset, x1: r.r - inset, y: r.t };
  };
  const HEADER = bottomOf("header"), BANNER = bottomOf("#login-banner"), BAR = bottomOf("#sticky-bar");
  const barAway = () => {
    const b = $("#sticky-bar");
    return !b || b.classList.contains("pinned") || b.classList.contains("offscreen");
  };
  function floors() {
    const out = [HEADER];
    if (BANNER()) out.push(BANNER);
    if (!barAway() && BAR()) out.push(BAR);
    return out;
  }
  function cardRow() {
    const row = [];
    let top = null;
    for (const el of document.querySelectorAll("#clips-grid .clip-card")) {
      const r = rectOf(el);
      if (!r) continue;
      if (top === null) top = r.t;
      if (Math.abs(r.t - top) > 4) break;
      row.push(topOf(el));
    }
    const table = $("#clips-grid .clips-table");
    if (!row.length && rectOf(table)) row.push(topOf(table, 40));
    return row;
  }
  const cardAt = (row, x) => {
    let best = 0, bestD = Infinity;
    row.forEach((g, i) => {
      const f = g();
      if (!f) return;
      const d = x < f.x0 ? f.x0 - x : x > f.x1 ? x - f.x1 : 0;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };
  const visibleY = (y) => y > 0 && y < innerHeight - 8;
  function headerGap() {
    const h = rectOf($("header"));
    if (!h) return null;
    let x0 = h.l + 24, x1 = h.r - 24;
    for (const sel of ["header h1", "#streamer-tag", "#site-desc"]) {
      const r = rectOf($(sel));
      if (r) x0 = Math.max(x0, r.r + 24);
    }
    const ctl = rectOf($("#header-controls"));
    if (ctl) x1 = Math.min(x1, ctl.l - 16);
    return x1 - x0 >= MIN_ROOM ? { x0, x1, y: h.b - 1 } : null;
  }
  function measure(P, img) {
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const g = cv.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, cv.width, cv.height).data, W = cv.width, [w, h] = P.cell, [ax, ay] = P.anchor;
    P.box = [];
    for (const clip of Object.values(P.clips)) for (const d in clip.frames) for (const [k] of clip.frames[d]) {
      if (P.box[k] !== void 0) continue;
      const x0 = k % P.cols * w, y0 = Math.floor(k / P.cols) * h;
      let l = w, r = -1, t = h, b = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0, i = ((y0 + y) * W + x0) * 4 + 3; x < w; x++, i += 4) {
          if (data[i]) {
            if (x < l) l = x;
            if (x > r) r = x;
            if (y < t) t = y;
            b = y;
          }
        }
      }
      P.box[k] = r < 0 ? null : [l - ax, t - ay, r + 1 - ax, b + 1 - ay];
    }
  }
  const boxes = new Map();
  function boxOf(c, names, dir) {
    const key = c.name + "|" + names + "|" + dir;
    let u = boxes.get(key);
    if (!u) {
      u = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
      for (const n of names) {
        const clip = c.P.clips[n];
        if (!clip || !clip.frames[dir]) continue;
        for (const [k] of clip.frames[dir]) {
          const q = c.P.box[k];
          if (q) {
            u.l = Math.min(u.l, q[0] * Z);
            u.t = Math.min(u.t, q[1] * Z);
            u.r = Math.max(u.r, q[2] * Z);
            u.b = Math.max(u.b, q[3] * Z);
          }
        }
      }
      if (u.l === Infinity) {
        const [w, h] = c.P.cell, [ax, ay] = c.P.anchor;
        u = { l: -ax * Z, t: -ay * Z, r: (w - ax) * Z, b: (h - ay) * Z };
      }
      boxes.set(key, u);
    }
    return u;
  }
  const REST = ["sleep", "wake", "standUp", "stretch", "idle", "stand", "lieDown", "settle"];
  const STOP = ["idle", "stand", "run", "zoomies", "land", "leapLand", "jumpCrouch", "dropStart", "hopRise", "hopFall", "hopLand"];
  const other = (c) => c === cats[0] ? cats[1] : cats[0];
  const byX = () => cats[0].x <= cats[1].x ? [cats[0], cats[1]] : [cats[1], cats[0]];
  const curBox = (c) => c.clipName ? boxOf(c, [c.clipName], c.cdir) : boxOf(c, STOP, c.dir || "E");
  function wideOf(c) {
    const e = boxOf(c, STOP, "E"), w = boxOf(c, STOP, "W");
    return { l: Math.min(e.l, w.l) - GAP / 2, t: Math.min(e.t, w.t), r: Math.max(e.r, w.r) + GAP / 2, b: Math.max(e.b, w.b) };
  }
  const sepOf = (left, right) => wideOf(left).r - wideOf(right).l + 3;
  function span(c, f) {
    const p = rectOf($("header")), w = wideOf(c);
    const lo = Math.max(f.x0, (p ? p.l : 0) - w.l), hi = Math.min(f.x1, (p ? p.r : innerWidth) - w.r);
    return lo <= hi ? [lo, hi] : [f.x0, f.x1];
  }
  const hits = (ax, ay, a, bx, by, b) => ax + a.l < bx + b.r && bx + b.l < ax + a.r && ay + a.t < by + b.b && by + b.t < ay + a.b;
  function clash(c, x, y, box, ob) {
    const o = other(c), m = { l: box.l - 1, t: box.t - 1, r: box.r + 1, b: box.b + 1 };
    return hits(x, y, m, o.x, o.y, ob || (o.air ? curBox(o) : wideOf(o))) || !!(o.claim && hits(x, y, m, o.claim.x, o.claim.y, o.claim.box));
  }
  let bedOrder = null;
  function bedSpots() {
    const g = headerGap();
    if (!g) return null;
    const [L, R] = bedOrder || cats, lb = boxOf(L, REST, "E"), rb = boxOf(R, REST, "W");
    const rx = g.x1 - rb.r, lx = rx + rb.l - GAP - lb.r;
    if (lx + lb.l < g.x0) return null;
    return [{ c: L, x: lx, dir: "E" }, { c: R, x: rx, dir: "W" }];
  }
  function play(c, name, onEnd) {
    const clip = c.P.clips[name];
    if (!clip || !clip.frames[c.dir]) return false;
    c.clip = clip;
    c.clipName = name;
    c.cdir = c.dir;
    c.t0 = now;
    c.ended = false;
    c.onEnd = onEnd || null;
    return true;
  }
  const playWait = (c, name) => new Promise((r) => {
    const clip = c.P.clips[name];
    if (!play(c, name, r) || clip.loop || clip.hold) r();
  });
  const stand = (c) => {
    c.vx = 0;
    return play(c, "idle") || play(c, "stand");
  };
  const face = (c, dir) => {
    c.dir = dir;
    stand(c);
  };
  function cellOf(c) {
    const fr = c.clip.frames[c.cdir], total = c.clip.total[c.cdir];
    let e = now - c.t0;
    if (c.clip.loop && total) e %= total;
    else if (e >= total && !c.clip.hold && !c.ended) {
      c.ended = true;
      if (c.onEnd) {
        const f = c.onEnd;
        c.onEnd = null;
        f();
      }
    }
    let i = 0, acc = 0;
    while (i < fr.length - 1 && acc + fr[i][1] <= e) acc += fr[i++][1];
    return fr[i][0];
  }
  let busy = false, lastBed = -1e9, zNow = "";
  function render() {
    if (!busy && now - lastBed > 250) {
      lastBed = now;
      const bed = bedSpots();
      layer.classList.toggle("cats-away", !bed);
      if (bed) for (const { c, x, dir } of bed) {
        c.x = x;
        c.surf = HEADER;
        if (c.dir !== dir) {
          c.dir = dir;
          if (play(c, "sleep")) c.t0 = now - rand(0, c.clip.total[dir]);
        }
      }
    }
    const z = barAway() ? "9" : "20";
    if (z !== zNow) layer.style.zIndex = zNow = z;
    const dpr = devicePixelRatio || 1;
    for (const c of cats) {
      if (!c.air && c.surf) {
        const f = c.surf();
        if (f) c.y = f.y;
      }
      if (c.clip) {
        const k = cellOf(c);
        if (k !== c.cur) {
          c.cur = k;
          c.el.style.backgroundPosition = `${-(k % c.P.cols) * c.P.cell[0]}px ${-Math.floor(k / c.P.cols) * c.P.cell[1]}px`;
        }
      }
      const L = Math.round((c.x - c.P.anchor[0] * Z) * dpr) / dpr, T = Math.round((c.y - c.P.anchor[1] * Z) * dpr) / dpr;
      if (L !== c.L || T !== c.T) {
        c.L = L;
        c.T = T;
        c.el.style.transform = `translate(${L}px, ${T}px)` + (Z === 1 ? "" : ` scale(${Z})`);
      }
    }
  }
  const speedOf = (c, clip) => (c.P.clips[clip] && c.P.clips[clip].speed || 210) * Z;
  async function run(c, x1, { clip = "run", pass = null, leap = false, keep = false, tight = false } = {}) {
    const f = c.surf && c.surf();
    if (f) x1 = clamp(x1, ...span(c, f));
    if (Math.abs(x1 - c.x) < 1) {
      if (!keep) stand(c);
      return;
    }
    const s = x1 > c.x ? 1 : -1;
    c.dir = s > 0 ? "E" : "W";
    if (!c.P.clips[clip]) clip = "run";
    const v = speedOf(c, clip), box = tight ? boxOf(c, [clip], c.dir) : wideOf(c), o = other(c);
    if (o !== pass && (x1 - c.x) * (c.x - o.x) > 0) {
      const rb = boxOf(c, [clip], c.dir);
      for (let n = 0; n < 24 && clash(c, c.x, c.y, rb, curBox(o)); n++) c.x += s;
    }
    play(c, clip) || play(c, "stand");
    let blocked = 0;
    while ((x1 - c.x) * s > 0) {
      await frame();
      if (leap && o === pass && !o.air) {
        const vr = v + Math.max(0, -o.vx * s), h = overH(c, o, vr), [tA, tB] = arcT(0, h), T = tA + tB, gap = (o.x - c.x) * s;
        if (gap > 0 && gap < vr * T / 2) {
          leap = false;
          const land = c.x + s * v * T;
          if ((x1 - land) * s > 0) {
            await arc(c, land, c.surf, h, "leap", { force: true });
            play(c, clip);
            continue;
          }
        }
      }
      let nx = c.x + s * v * dt / 1e3;
      if ((x1 - nx) * s < 0) nx = x1;
      if (o !== pass && Math.abs(nx - o.x) < Math.abs(c.x - o.x) && clash(c, nx + (blocked ? s * 8 : 0), c.y, box, tight ? curBox(o) : null)) {
        if (!blocked) {
          blocked = now;
          stand(c);
        }
        if (now - blocked > (o.vx || o.air ? 1500 : 250)) break;
        continue;
      }
      if (blocked) {
        blocked = 0;
        play(c, clip);
      }
      c.vx = s * v;
      c.x = nx;
    }
    c.vx = 0;
    if (!keep) stand(c);
  }
  function overH(c, o, vr) {
    const lb = boxOf(c, ["leapRise", "leapFall"], c.dir), ob = curBox(o), t = (lb.r - lb.l + ob.r - ob.l) / 2 / vr;
    return lb.b - ob.t + 3 + G * t * t / 2;
  }
  const KINDS = {
    jump: ["jumpCrouch", "jumpRise", "jumpFall", "land"],
    drop: ["dropStart", "dropFall", "dropFall", "land"],
    leap: [null, "leapRise", "leapFall", "leapLand"],
    hop: ["jumpCrouch", "hopRise", "hopFall", "hopLand"]
  };
  const arcT = (e, h) => {
    const H = Math.max(0, e) + h;
    return [Math.sqrt(2 * H / G), Math.sqrt(2 * (H - e) / G)];
  };
  const arcAt = (xa, ya, x1, yb, h, u) => {
    const [tA, tB] = arcT(ya - yb, h), s = u * (tA + tB);
    return [xa + (x1 - xa) * u, ya - (G * tA * s - G * s * s / 2)];
  };
  function freeX(c, to, x, box) {
    const f = to();
    if (!f) return null;
    const o = other(c), side = c.x <= o.x ? -1 : 1, [lo, hi] = span(c, f);
    box = { l: Math.min(box.l, wideOf(c).l), t: box.t, r: Math.max(box.r, wideOf(c).r), b: box.b };
    x = clamp(x, lo, hi);
    for (let d = 0; d <= 480; d += 6) {
      for (const s of d ? [side, -side] : [0]) {
        const xx = x + s * d;
        if (xx < lo || xx > hi || (xx - o.x) * side < 0) continue;
        if (!clash(c, xx, f.y, box)) return xx;
      }
    }
    return null;
  }
  async function arc(c, x1, to, h, kind, { onApex = null, force = false } = {}) {
    const pose = (i) => {
      const n = KINDS[kind][i];
      return n && !c.P.clips[n] ? KINDS.jump[i] : n;
    };
    if (Math.abs(x1 - c.x) > 2) c.dir = x1 > c.x ? "E" : "W";
    const fly = boxOf(c, [pose(1), pose(2)], c.dir), landBox = boxOf(c, [pose(3), "idle", "stand"], c.dir);
    let f = to();
    if (!f) return false;
    if (!force) {
      x1 = freeX(c, to, x1, landBox);
      if (x1 === null) return false;
      const clear = () => {
        for (let i = 1; i <= 12; i++) {
          const [x, y] = arcAt(c.x, c.y, x1, f.y, h, i / 12);
          if (clash(c, x, y, fly)) return false;
        }
        return true;
      };
      for (let n = 0; !clear(); n++) {
        if (!n) stand(c);
        if (n > 120) return false;
        await frame();
        f = to();
        if (!f) return false;
      }
    } else x1 = clamp(x1, ...span(c, f));
    c.claim = { x: x1, y: f.y, box: landBox };
    if (pose(0)) await playWait(c, pose(0));
    f = to();
    if (!f) {
      c.claim = null;
      return false;
    }
    const xa = c.x, ya = c.y, yb = f.y, [tA, tB] = arcT(ya - yb, h), T = (tA + tB) * 1e3;
    c.air = true;
    c.vx = (x1 - xa) / (T / 1e3);
    let t = 0, cur = "";
    while (t < T) {
      await frame();
      t = Math.min(T, t + dt);
      const g2 = to(), [x, y] = arcAt(xa, ya, x1, yb, h, t / T);
      c.x = x;
      c.y = y + (g2 ? (g2.y - yb) * (t / T) : 0);
      const p = t / 1e3 < tA ? pose(1) : pose(2);
      if (p !== cur) {
        if (cur && onApex) onApex();
        cur = p;
        play(c, p) || play(c, "stand");
      }
    }
    c.surf = to;
    c.air = false;
    c.vx = 0;
    c.claim = null;
    const g = to();
    if (g) c.y = g.y;
    await playWait(c, pose(3));
    return true;
  }
  async function runRow(c, row, x1, clip = "run") {
    const j = cardAt(row, x1);
    for (let n = 0; n < row.length; n++) {
      const i = row.indexOf(c.surf);
      if (i < 0) break;
      if (i === j) return run(c, x1, { clip });
      const s = j > i ? 1 : -1, here = row[i](), next = row[i + s], nf = next && next();
      if (!here || !nf) break;
      await run(c, s > 0 ? here.x1 : here.x0, { clip, keep: true });
      c.dir = s > 0 ? "E" : "W";
      if (!await arc(c, s > 0 ? nf.x0 + 22 : nf.x1 - 22, next, 14, "leap")) break;
    }
    stand(c);
  }
  function floorNext(c, down) {
    const fs = floors().filter((g) => g !== c.surf && g()).filter((g) => down ? g().y > c.y + 8 : g().y < c.y - 8);
    fs.sort((p, q) => down ? p().y - q().y : q().y - p().y);
    return fs[0];
  }
  async function climb(c, dir) {
    for (let n = 0; n < 6 && c.surf !== HEADER; n++) {
      const up = floorNext(c, false) || HEADER;
      face(c, dir);
      await wait(rand(150, 400));
      if (!await arc(c, c.x + (dir === "E" ? 1 : -1) * rand(15, 45), up, up === HEADER ? 10 : 18, "jump")) await wait(300);
    }
  }
  async function wakeUp(c) {
    await playWait(c, "wake");
    await playWait(c, "standUp");
    await playWait(c, "stretch");
    stand(c);
  }
  async function goHome() {
    const [L, R] = byX();
    await Promise.all([climb(R, "E"), climb(L, "W")]);
    for (const c of cats) if (c.surf !== HEADER) {
      c.surf = HEADER;
      c.air = false;
    }
    bedOrder = [L, R];
    const bed = bedSpots();
    const home = async (c, spot) => {
      if (spot) {
        await run(c, spot.x, { tight: true });
        face(c, spot.dir);
      } else stand(c);
      await wait(rand(300, 700));
      await playWait(c, "lieDown");
      await playWait(c, "settle");
      play(c, "sleep");
    };
    await Promise.all([home(L, bed && bed[0]), home(R, bed && bed[1])]);
  }
  async function chase() {
    const f = HEADER();
    if (!f) return;
    const lo = f.x0 + 60, hi = f.x1 - 60, [L, R] = byX(), mid = (L.x + R.x) / 2, s = mid - lo < hi - mid ? 1 : -1;
    const [lead, tail] = s > 0 ? [R, L] : [L, R], sep = sepOf(L, R);
    await Promise.all([run(lead, s > 0 ? hi : lo, { clip: "zoomies" }), wait(rand(250, 500)).then(() => run(tail, (s > 0 ? hi : lo) - s * sep, { clip: "zoomies" }))]);
    face(lead, s > 0 ? "W" : "E");
    await wait(rand(500, 900));
    const back = lo + (hi - lo) * rand(0.3, 0.7);
    await Promise.all([run(tail, back), wait(rand(200, 400)).then(() => run(lead, back + s * sep))]);
    face(tail, s > 0 ? "E" : "W");
    await wait(rand(300, 600));
  }
  const swatTarget = () => $("header [data-cats-swat]") || [...document.querySelectorAll("header h1 img")].pop();
  function wobble(el, big) {
    const a = big ? 26 : 16;
    try {
      el.animate([{ transform: "none" }, { transform: `translateY(-3px) rotate(${-a}deg)` }, { transform: `rotate(${a * 0.6}deg)` }, { transform: "none" }], { duration: big ? 650 : 500, easing: "ease-out", composite: "add" });
    } catch {
    }
  }
  async function swat() {
    const img = swatTarget(), r = rectOf(img), f = HEADER();
    if (!r || !f) return;
    const pops = img.hasAttribute("data-cats-swat");
    const [L, R] = byX(), SW = ["idle", "stand", "jumpCrouch", "hopRise", "hopFall", "hopLand"], tx = (r.l + r.r) / 2;
    const lr = Math.max(boxOf(L, SW, "E").r, boxOf(L, ["idle"], "W").r), rl = Math.min(boxOf(R, SW, "W").l, boxOf(R, ["idle"], "E").l), sep = lr - rl + GAP;
    const lx = Math.max((2 * tx - boxOf(L, ["idle"], "E").r - sep - boxOf(R, ["idle"], "W").l) / 2, span(L, f)[0]);
    await Promise.all([run(L, lx, { tight: true }), run(R, lx + sep, { tight: true })]);
    face(L, "E");
    face(R, "W");
    await wait(rand(300, 600));
    const hop = (c, onApex) => arc(c, c.x, c.surf, clamp(c.y + boxOf(c, ["hopRise"], c.dir).t - 2, 0, rand(8, 16)), "hop", { force: true, onApex });
    const [p, q] = shuffle([L, R]);
    await hop(p, () => wobble(img));
    await wait(rand(150, 350));
    await hop(q, () => wobble(img));
    await wait(rand(250, 450));
    const last2 = pops ? () => img.classList.add("open") : () => wobble(img, true);
    await Promise.all([hop(L, last2), hop(R, last2)]);
    stand(L);
    stand(R);
    await wait(pops ? rand(1600, 2200) : rand(400, 700));
    await run(R, L.x + sepOf(L, R));
    if (R.x - L.x < sepOf(L, R)) await run(L, R.x - sepOf(L, R));
  }
  const canDescend = () => {
    const f = BAR();
    return !barAway() && f && visibleY(f.y);
  };
  async function descent() {
    const down = async (c) => {
      for (let n = 0; n < 4; n++) {
        const below = floorNext(c, true);
        if (!below) return;
        stand(c);
        await wait(rand(150, 350));
        await arc(c, c.x + (c.x <= other(c).x ? -1 : 1) * rand(25, 60), below, rand(6, 14), "drop");
      }
    };
    const [a, b] = shuffle(cats.slice());
    await Promise.all([down(a), wait(rand(400, 800)).then(() => down(b))]);
    const f = BAR();
    if (f && a.surf === BAR && b.surf === BAR) {
      const lo = f.x0 + 60, hi = f.x1 - 60, [l, r] = byX();
      await Promise.all([run(l, lo + (hi - lo) * 0.25), run(r, lo + (hi - lo) * 0.75)]);
      face(l, "E");
      face(r, "W");
      await wait(rand(400, 700));
      const jumper = chance(0.5) ? l : r;
      await Promise.all([run(l, hi - 40, { clip: "zoomies", pass: r, leap: jumper === l }), run(r, lo + 40, { clip: "zoomies", pass: l, leap: jumper === r })]);
      face(l, "W");
      face(r, "E");
      await wait(rand(300, 600));
      const row = cardRow(), first = row[0] && row[0]();
      if (first && first.y - f.y <= 260 && visibleY(first.y)) {
        const drop = async (c) => {
          const i = cardAt(row, c.x), cf = row[i]();
          await arc(c, clamp(c.x + (c.dir === "E" ? 1 : -1) * rand(20, 40), cf.x0, cf.x1), row[i], rand(6, 12), "drop");
        };
        await Promise.all([drop(l), wait(rand(200, 500)).then(() => drop(r))]);
        const [L2, R2] = byX(), m = (L2.x + R2.x) / 2 + rand(-80, 80), sep = sepOf(L2, R2);
        await Promise.all([runRow(L2, row, m - sep / 2), runRow(R2, row, m + sep / 2)]);
        face(L2, "E");
        face(R2, "W");
        await wait(rand(1e3, 1800));
      }
    }
    const [L, R] = byX();
    await Promise.all([climb(R, "E"), wait(rand(300, 600)).then(() => climb(L, "W"))]);
  }
  async function romp() {
    busy = true;
    layer.classList.add("cats-awake");
    try {
      const [a, b] = shuffle(cats.slice());
      await Promise.all([wakeUp(a), wait(rand(300, 800)).then(() => wakeUp(b))]);
      await wait(rand(300, 600));
      const scenes = $("header [data-cats-swat]") ? [swat, chase] : shuffle([chase, swat]);
      if (canDescend() && chance(0.85)) scenes[1] = descent;
      if (chance(0.5)) scenes.reverse();
      for (const scene of scenes) await scene();
      await goHome();
    } catch (e) {
      cats.forEach((c) => {
        c.air = false;
        c.claim = null;
        c.surf = HEADER;
        c.dir = "";
      });
      console.error(e);
    }
    const t = $("header [data-cats-swat]");
    if (t) t.classList.remove("open");
    layer.classList.remove("cats-awake");
    busy = false;
    lastBed = -1e9;
  }
  async function start() {
    const pack = await (await fetch(BASE + "pack.json")).json();
    const names = Object.keys(pack.cats).slice(0, 2);
    if (names.length < 2) return;
    const imgs = await Promise.all(names.map(async (n) => {
      const img = new Image();
      img.src = BASE + pack.cats[n].image;
      await img.decode();
      return img;
    }));
    names.forEach((n, i) => measure(pack.cats[n], imgs[i]));
    const style = document.createElement("style");
    style.textContent = `
.cats-layer { position: absolute; left: 0; top: 0; width: 100%; height: 100vh; overflow: hidden; pointer-events: none; z-index: 20; }
.cats-cat { position: absolute; left: 0; top: 0; background-repeat: no-repeat; image-rendering: pixelated; transform-origin: 0 0; will-change: transform; transition: opacity 0.4s; animation: cats-in 0.8s ease-out; }
.cats-layer.cats-away .cats-cat { opacity: 0; }
.cats-layer:not(.cats-awake):not(.cats-away) .cats-cat { pointer-events: auto; cursor: pointer; }
@keyframes cats-in { from { opacity: 0; } }`;
    document.head.appendChild(style);
    layer = document.createElement("div");
    layer.className = "cats-layer cats-away";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
    for (const name of names) {
      const P = pack.cats[name];
      for (const clip of Object.values(P.clips)) {
        clip.total = {};
        for (const d in clip.frames) clip.total[d] = clip.frames[d].reduce((a, f) => a + f[1], 0);
      }
      const el = document.createElement("div");
      el.className = "cats-cat";
      el.style.width = P.cell[0] + "px";
      el.style.height = P.cell[1] + "px";
      el.style.backgroundImage = `url("${BASE + P.image}")`;
      el.addEventListener("click", () => {
        if (!busy) romp();
      });
      layer.appendChild(el);
      cats.push({ name, P, el, x: 0, y: 0, vx: 0, dir: "", surf: HEADER, air: false, claim: null, clip: null, clipName: "", cur: -1, L: NaN, T: NaN });
    }
    requestAnimationFrame((t) => {
      last = t;
      tick(t);
    });
  }
  function whenSettled() {
    const idle = window.requestIdleCallback ? (f) => requestIdleCallback(f, { timeout: 2e3 }) : (f) => setTimeout(f, 200);
    let tries = 0;
    const check = () => {
      const loading = document.getElementById("loading");
      if (!loading || loading.style.display === "none" || ++tries > 80) idle(() => start().catch(() => {
      }));
      else setTimeout(check, 250);
    };
    check();
  }
  function whenRoom() {
    if (headerGap()) return whenSettled();
    let t = 0;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (headerGap()) {
          removeEventListener("resize", onResize);
          whenSettled();
        }
      }, 300);
    };
    addEventListener("resize", onResize);
  }
  const target = $("header [data-cats-swat]");
  if (target) target.addEventListener("click", () => {
    if (busy) return;
    if (layer && !layer.classList.contains("cats-away")) romp();
    else if (!target.classList.contains("open")) {
      target.classList.add("open");
      setTimeout(() => target.classList.remove("open"), 8e3);
    }
  });
  if (document.readyState === "complete") whenRoom();
  else addEventListener("load", whenRoom, { once: true });
})();
