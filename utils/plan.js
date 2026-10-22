// ============================================================
// 平面图绘制 v3（单一实现，result 页与 index 录入页共用）
// 依据标准家装顶视符号规范（SmartDraw/Cedreo/measurefloorplan + 国内 CAD 图块惯例）：
//   床=矩形+床头板+双枕  沙发=靠背条+扶手+坐垫分隔  马桶=水箱矩形+椭圆座圈
//   淋浴=方框+坡水斜线+地漏+花洒  橱柜=沿墙带状+柜门分隔+嵌入水槽
//   灶=深色方块+炉头圆  油烟机=贴墙窄条(虚线,上方重叠)  冰箱=矩形+对开门+把手
// 布局按真实 cm 在房间坐标系内手工排布（0,0=左上角，cm）：
//   厨房: U型三面地柜(顶墙水槽对窗+左墙灶台烟机离上角55cm不在盲角+底墙冰箱紧邻左柜转角,前方过道≈135cm≥800mm); 推拉门(平开会扫台面); 工作三角不交叉
//   卫生间: 淋浴做玻璃隔断(非封闭淋浴房)左上角湿区 / 马桶背靠底墙(标准顶视符号,不正对门) / 浴室柜靠门侧干区
//   卧室: 床头靠右墙 / 床两侧配床头柜 / 衣柜沿底墙
//   客厅: 电视柜+电视靠底墙(实墙) / 沙发靠窗墙对电视 / 茶几居中
//   阳台(家政洗衣): 洗衣机靠窗上墙(湿区,避开门) / 晾衣架居中上空(干衣) / 储物柜靠右墙(干区); 中间留走道; 不放床
//   书房: 书桌靠窗 / 床头靠右墙 / 衣柜底墙
// 所有布局已校验：不越房间、不压门开启区、相互不重叠。
// ============================================================

// 圆角矩形路径
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r || 4, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ===== 配色（现代冷灰蓝：清爽、不老气；地面/家具统一浅冷调，墙体深石板） =====
const C = {
  floor:   '#eef1f5',   // 浅冷灰地面
  wall:    '#2b3440',   // 深石板实心墙体
  dim:     '#9aa7b4',   // 外部尺寸线
  dimTxt:  '#5b6b78',   // 尺寸文字
  name:    '#2b3440',   // 房间名
  area:    '#7a8896',   // 面积
  comp:    '#6b7785',   // 指北针
  circ:    '#2f6fed',   // 动线（现代蓝虚线箭头）
  ergoOk:  '#15a36a',   // 人体工程达标（绿）
  ergoWarn:'#f0683a',   // 人体工程未达标（橙红）
  labelBg: 'rgba(255,255,255,0.82)'
};

// 开洞中点（沿墙中心，朝房间内推 16px）
function openMidPx(o) {
  const u = o.g0 + o.len / 2;
  let mx, my;
  if (o.horiz) { mx = o.x1 + u; my = o.y1; } else { mx = o.x1; my = o.y1 + u; }
  const k = 16;
  if (o.wall === 'top') my += k;
  else if (o.wall === 'bottom') my -= k;
  else if (o.wall === 'left') mx += k;
  else mx -= k;
  return [mx, my];
}

// 主家具中心（动线终点：窗或主家具）
function mainFurnCenter(items, space) {
  const key = (space.key || '').toLowerCase();
  const pref = { kitchen: ['stove', 'cabinet'], bathroom: ['toilet'], bedroom: ['bed'],
                 living: ['sofa'], balcony: ['washer'], study: ['desk'] }[key] || [];
  for (const id of pref) { const it = items.find(i => i.id === id && i.rect); if (it) return [it.rect.x + it.rect.w / 2, it.rect.y + it.rect.h / 2]; }
  const any = items.find(i => i.rect && !i.clone);
  return any ? [any.rect.x + any.rect.w / 2, any.rect.y + any.rect.h / 2] : null;
}

function drawArrow(ctx, x, y, ang) {
  const s = 7;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - s * Math.cos(ang - 0.4), y - s * Math.sin(ang - 0.4));
  ctx.lineTo(x - s * Math.cos(ang + 0.4), y - s * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
}

// ===== 地面网格（极淡，提升"户型图纸"专业感；不喧宾夺主）=====
function drawGrid(ctx, ox, oy, rw, rh, scale) {
  const step = 50 * scale;                 // 每格 50cm
  if (step < 9) return;                     // 太小则不画，避免糊成一片
  ctx.save();
  ctx.setStrokeStyle('rgba(120,140,160,0.16)');
  ctx.setLineWidth(0.5);
  for (let x = ox + step; x < ox + rw - 0.5; x += step) {
    ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, oy + rh); ctx.stroke();
  }
  for (let y = oy + step; y < oy + rh - 0.5; y += step) {
    ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox + rw, y); ctx.stroke();
  }
  ctx.restore();
}

// ===== 动线层：门→房间中心→窗/主家具，暖橙虚线 + 箭头 + 图例 =====
function drawCirculation(ctx, space, items, ox, oy, rw, rh, scale, openings) {
  const door = openings.find(o => o.type === 'door' || o.type === 'slide');
  if (!door) return;
  const pts = [openMidPx(door)];
  pts.push([ox + rw / 2, oy + rh / 2]);
  const win = openings.find(o => o.type === 'win');
  const tgt = win ? openMidPx(win) : mainFurnCenter(items, space);
  if (tgt) pts.push(tgt);
  ctx.save();
  ctx.setStrokeStyle(C.circ); ctx.setLineWidth(2); ctx.setLineDash([7, 5]);
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
  ctx.stroke();
  ctx.setLineDash([]);
  const a = pts[pts.length - 1], b = pts[pts.length - 2];
  const ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
  ctx.setFillStyle(C.circ); drawArrow(ctx, a[0], a[1], ang);
  ctx.setFontSize(9); ctx.setFillStyle(C.circ); ctx.setTextAlign('left');
  ctx.fillText('动线', ox + 6, oy + rh - 8);
  ctx.restore();
}

// 人体工程小药丸标注
function drawPill(ctx, x, y, text, ok) {
  ctx.setFontSize(9); ctx.setTextAlign('center');
  const w = Math.max(48, textW(text, 9) + 12), h = 15;
  ctx.setFillStyle('rgba(255,255,255,0.92)');
  rr(ctx, x - w / 2, y - h / 2, w, h, 7); ctx.fill();
  ctx.setStrokeStyle(ok ? C.ergoOk : C.ergoWarn); ctx.setLineWidth(1);
  rr(ctx, x - w / 2, y - h / 2, w, h, 7); ctx.stroke();
  ctx.setFillStyle(ok ? C.ergoOk : C.ergoWarn);
  ctx.fillText(text, x, y + 3);
  ctx.setTextAlign('left');
}

// ===== 人体工程层：按空间算关键净距，达标绿/未达标橙红 =====
function drawErgo(ctx, space, items, ox, oy, scale) {
  const cm = r => ({ x: (r.x - ox) / scale, y: (r.y - oy) / scale, w: r.w / scale, h: r.h / scale });
  const key = (space.key || '').toLowerCase();
  const f = id => items.find(i => i.id === id && i.rect);
  const notes = [];
  if (key === 'kitchen') {
    const aisle = Math.round(space.d - 120);                       // 两面地柜进深各60
    if (aisle > 0) notes.push({ t: '操作通道 ' + aisle + 'cm', ok: aisle >= 80, x: ox + (space.w / 2) * scale, y: oy + (space.d / 2) * scale });
  } else if (key === 'bathroom') {
    const tf = f('toilet') || f('squat');
    if (tf) { const c = cm(tf.rect); const clr = Math.round(c.y); notes.push({ t: '如厕前净距 ' + clr + 'cm', ok: clr >= 100, x: tf.rect.x + tf.rect.w / 2, y: tf.rect.y - 8 }); }
  } else if (key === 'bedroom') {
    const bed = f('bed');
    if (bed) { const c = cm(bed.rect); const aisle = Math.round(c.x); notes.push({ t: '床侧通道 ' + aisle + 'cm', ok: aisle >= 60, x: bed.rect.x - 6, y: bed.rect.y + bed.rect.h / 2 }); }
  } else if (key === 'living') {
    const vd = Math.round(space.d - 95 - 8);                       // 沙发进深95 + 电视厚8
    if (vd > 0) notes.push({ t: '沙发视距 ' + vd + 'cm', ok: vd >= 200, x: ox + (space.w / 2) * scale, y: oy + (space.d / 2) * scale });
  } else if (key === 'balcony') {
    const aisle = Math.round(space.d - 60);
    if (aisle > 0) notes.push({ t: '家政通道 ' + aisle + 'cm', ok: aisle >= 60, x: ox + (space.w / 2) * scale, y: oy + (space.d / 2) * scale });
  } else if (key === 'study') {
    const desk = f('desk');
    if (desk) { const c = cm(desk.rect); const clr = Math.round(space.d - (c.y + c.h)); notes.push({ t: '书桌前净距 ' + clr + 'cm', ok: clr >= 60, x: desk.rect.x + desk.rect.w / 2, y: desk.rect.y + desk.rect.h + 7 }); }
  }
  notes.forEach(n => { if (isFinite(n.x) && isFinite(n.y)) drawPill(ctx, n.x, n.y, n.t, n.ok); });
}

// 家具形态字典（真实 cm；L=沿墙长度, D=进深朝房间）
const FURN = {
  cabinet:  { L: 220, D: 60,  shape: 'counter',  label: '橱柜' },
  counter:  { L: 220, D: 60,  shape: 'counter',  label: '台面' },
  hood:     { L: 90,  D: 35,  shape: 'hood',     label: '油烟机' },
  stove:    { L: 75,  D: 60,  shape: 'stove',    label: '灶具' },
  fridge:   { L: 80,  D: 65,  shape: 'fridge',   label: '冰箱' },
  wallcab:  { L: 180, D: 35,  shape: 'wallcab',  label: '吊柜' },
  toilet:   { L: 45,  D: 70,  shape: 'toilet',   label: '马桶' },
  squat:    { L: 45,  D: 70,  shape: 'toilet',   label: '蹲坑' },
  vanity:   { L: 90,  D: 55,  shape: 'vanity',   label: '浴室柜' },
  shower:   { L: 90,  D: 90,  shape: 'shower',   label: '淋浴' },
  sofa:     { L: 220, D: 95,  shape: 'sofa',     label: '沙发' },
  table:    { L: 120, D: 60,  shape: 'table',    label: '茶几' },
  tv:       { L: 130, D: 8,   shape: 'tv',       label: '电视' },
  tvcab:    { L: 180, D: 40,  shape: 'tvcab',    label: '电视柜' },
  bed:      { L: 180, D: 200, shape: 'bed',      label: '床' },
  wardrobe: { L: 200, D: 60,  shape: 'wardrobe', label: '衣柜' },
  desk:     { L: 120, D: 60,  shape: 'desk',     label: '书桌' },
  washer:   { L: 60,  D: 60,  shape: 'washer',   label: '洗衣机' },
  rack:     { L: 120, D: 10,  shape: 'rack',     label: '晾衣架' },
  bookshelf: { L: 200, D: 35, shape: 'bookshelf', label: '书柜' },
  storage:  { L: 80,  D: 40,  shape: 'box',      label: '收纳柜' }
};
const NAME = {
  '橱柜': 'cabinet', '油烟机': 'hood', '灶具': 'stove', '冰箱': 'fridge',
  '马桶/蹲坑': 'toilet', '马桶': 'toilet', '蹲坑': 'toilet', '浴室柜': 'vanity',
  '淋浴隔断': 'shower', '淋浴房': 'shower', '沙发': 'sofa', '茶几': 'table',
  '电视': 'tv', '电视柜': 'tvcab', '床': 'bed', '衣柜': 'wardrobe',
  '书桌': 'desk', '洗衣机': 'washer', '晾衣架': 'rack', '书柜': 'bookshelf', '收纳柜': 'storage', '吊柜': 'wallcab'
};
function symOf(f) {
  if (FURN[f.id]) return FURN[f.id];
  if (NAME[f.name]) return FURN[NAME[f.name]];
  return { L: 80, D: 60, shape: 'box', label: f.name };
}

// ===== 对外主入口 =====
// icons: 本小程序统一使用纯 canvas 矢量家具画法（clean、无水印、比例严格），调用方传 null。
//   若未来要换真实贴图，可在此恢复并维护 /assets/icons 资源。
// opts: { compass:false } —— 迷你预览图不画指北针（正式施工图保留）
function drawPlan(ctx, space, W, H, m, icons, opts) {
  m = m || 38;
  ctx.clearRect(0, 0, W, H);
  ctx.setFillStyle('#ffffff'); ctx.fillRect(0, 0, W, H);
  const noCompass = !!(opts && opts.compass === false);
  if (space.poly && space.poly.length >= 3) drawPoly(ctx, space, W, H, m, icons);
  else drawRect(ctx, space, W, H, m, icons, noCompass);
}

// ---- 墙体/门/窗（楼盘户型图制图规范：实心墙体+樘口线+外部尺寸标注链+房间面积+指北针） ----
function drawRect(ctx, space, W, H, m, icons, noCompass) {
  const dimBand = 30;                                   // 顶部/左侧尺寸标注带宽
  const mx = m + dimBand, my = m + dimBand;
  const scale = Math.min((W - mx - m) / space.w, (H - my - m) / space.d);
  const rw = space.w * scale, rh = space.d * scale;
  const ox = mx + ((W - mx - m) - rw) / 2;
  const oy = my + ((H - my - m) - rh) / 2;
  // 地面
  ctx.setFillStyle(C.floor); ctx.fillRect(ox, oy, rw, rh);
  drawGrid(ctx, ox, oy, rw, rh, scale);

  // 墙厚≈240mm（限制在 5~11px），实心填充
  const WT = Math.max(5, Math.min(11, 0.24 * scale));
  const half = WT / 2;
  const WALL = C.wall;

  const openOf = wall => {
    const slideKeys = ['balcony', 'kitchen'];   // 厨房推拉门(报价单含推拉门;平开会扫台面)、阳台推拉门
    // 定位：优先「距左端 cm」(doorOff/winOff)，未填则退回旧字段 doorEnd/winEnd，都没有＝居中
    const dOff = space.doorOff != null ? space.doorOff : (space.doorEnd || 'mid');
    const wOff = space.winOff != null ? space.winOff : (space.winEnd || 'mid');
    if (space.doorWall === wall) return { type: (slideKeys.indexOf(space.key) >= 0 ? 'slide' : 'door'), len: (space.doorW || 80) * scale, off: dOff, end: dOff };
    if (space.winWall === wall) return { type: 'win', len: (space.winW || 100) * scale, off: wOff, end: wOff };
    return null;
  };
  const winOpens = [];
  const openings = [];   // 门/窗开洞中点（动线层用）
  // 实心墙分段填充（开洞处断开）
  const fillSeg = (horiz, x1, y1, a, b) => {
    const len = b - a;
    if (len < 0.5) return;
    if (horiz) ctx.fillRect(x1 + a, y1 - half, len, WT);
    else ctx.fillRect(x1 - half, y1 + a, WT, len);
  };
  const drawWall = (wall, x1, y1, x2, y2, open) => {
    const horiz = (y1 === y2);
    const total = horiz ? Math.abs(x2 - x1) : Math.abs(y2 - y1);
    ctx.setFillStyle(WALL);
    if (!open) { fillSeg(horiz, x1, y1, 0, total); return; }
    let g0 = (total - open.len) / 2;
    const off = open.off;
    openings.push({ wall, x1, y1, g0, len: open.len, horiz, type: open.type });
    if (typeof off === 'number' && isFinite(off)) {
      // 距该墙左端起算（横墙从左、竖墙从上），夹在墙长内
      g0 = Math.max(0, Math.min(total - open.len, off * scale));
    } else if (off === 'min') g0 = 6;
    else if (off === 'max') g0 = total - open.len - 6;
    fillSeg(horiz, x1, y1, 0, g0);
    fillSeg(horiz, x1, y1, g0 + open.len, total);
    // 洞口两端樘口线（垂直墙面的短线）
    ctx.setStrokeStyle(WALL); ctx.setLineWidth(1.2);
    [g0, g0 + open.len].forEach(u => {
      ctx.beginPath();
      if (horiz) { ctx.moveTo(x1 + u, y1 - half); ctx.lineTo(x1 + u, y1 + half); }
      else { ctx.moveTo(x1 - half, y1 + u); ctx.lineTo(x1 + half, y1 + u); }
      ctx.stroke();
    });
    if (open.type === 'win') { winOpens.push({ x1, y1, g0, len: open.len, horiz, half }); return; }
    if (open.type === 'slide') {
      // 推拉门：两根错位滑轨
      ctx.setStrokeStyle('#5d6b78'); ctx.setLineWidth(2);
      const a = g0 + open.len * 0.06, b1 = g0 + open.len * 0.56, b2 = g0 + open.len * 0.44, c = g0 + open.len * 0.94;
      ctx.beginPath();
      if (horiz) { ctx.moveTo(x1 + a, y1 - 2.5); ctx.lineTo(x1 + b1, y1 - 2.5); } else { ctx.moveTo(x1 - 2.5, y1 + a); ctx.lineTo(x1 - 2.5, y1 + b1); }
      ctx.stroke();
      ctx.beginPath();
      if (horiz) { ctx.moveTo(x1 + b2, y1 + 2.5); ctx.lineTo(x1 + c, y1 + 2.5); } else { ctx.moveTo(x1 + 2.5, y1 + b2); ctx.lineTo(x1 + 2.5, y1 + c); }
      ctx.stroke();
    } else {
      // 平开门：门扇线(垂直墙入房) + 四分之一开启弧
      ctx.setStrokeStyle('#9aa7b4'); ctx.setLineWidth(1.1);
      const R = open.len;
      let hx, hy, leafAng, arcA, arcB;
      if (wall === 'bottom')      { hx = x1 + g0; hy = y1; leafAng = -Math.PI / 2; arcA = -Math.PI / 2; arcB = 0; }
      else if (wall === 'top')    { hx = x1 + g0; hy = y1; leafAng = Math.PI / 2; arcA = 0; arcB = Math.PI / 2; }
      else if (wall === 'left')   { hx = x1; hy = y1 + g0; leafAng = 0; arcA = 0; arcB = Math.PI / 2; }
      else                        { hx = x1; hy = y1 + g0; leafAng = Math.PI; arcA = Math.PI / 2; arcB = Math.PI; }
      ctx.beginPath(); ctx.moveTo(hx, hy);
      ctx.lineTo(hx + R * Math.cos(leafAng), hy + R * Math.sin(leafAng)); ctx.stroke();
      ctx.beginPath(); ctx.arc(hx, hy, R, arcA, arcB, false); ctx.stroke();
    }
  };
  drawWall('top', ox, oy, ox + rw, oy, openOf('top'));
  drawWall('bottom', ox, oy + rh, ox + rw, oy + rh, openOf('bottom'));
  drawWall('left', ox, oy, ox, oy + rh, openOf('left'));
  drawWall('right', ox + rw, oy, ox + rw, oy + rh, openOf('right'));

  // —— 外部尺寸标注链（延伸线+尺寸线+45°斜刻度，单位 m，与预算口径一致） ——
  const fmt = v => (Math.round(v) / 100).toFixed(2) + ' m';
  ctx.setStrokeStyle(C.dim); ctx.setLineWidth(0.8);
  const EXT = 18, DL = 10;   // 延伸线长 / 离墙距
  // 顶部：总宽（延伸线×2 + 尺寸线，各自独立路径）
  const dyT = oy - half - DL;
  ctx.beginPath(); ctx.moveTo(ox, dyT - EXT); ctx.lineTo(ox, oy - half - 3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ox + rw, dyT - EXT); ctx.lineTo(ox + rw, oy - half - 3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ox, dyT); ctx.lineTo(ox + rw, dyT); ctx.stroke();
  [ox, ox + rw].forEach(x => {
    ctx.beginPath(); ctx.moveTo(x - 3, dyT + 3); ctx.lineTo(x + 3, dyT - 3); ctx.stroke();
  });
  ctx.setFillStyle(C.dimTxt); ctx.setFontSize(10); ctx.setTextAlign('center');
  ctx.fillText(fmt(space.w), ox + rw / 2, dyT - 4);
  // 左侧：总深
  const dxL = ox - half - DL;
  ctx.beginPath(); ctx.moveTo(dxL - EXT, oy); ctx.lineTo(ox - half - 3, oy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(dxL - EXT, oy + rh); ctx.lineTo(ox - half - 3, oy + rh); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(dxL, oy); ctx.lineTo(dxL, oy + rh); ctx.stroke();
  [oy, oy + rh].forEach(y => {
    ctx.beginPath(); ctx.moveTo(dxL - 3, y + 3); ctx.lineTo(dxL + 3, y - 3); ctx.stroke();
  });
  ctx.fillText(fmt(space.d), dxL - 2, oy + rh / 2 + 3);
  ctx.setTextAlign('left');

  // —— 房间名 + 面积（居中白底片，压在家具上仍可读） ——
  const cx = ox + rw / 2, cy = oy + rh / 2;
  const fsN = 13, fsA = 10;
  const area = (space.w * space.d / 10000).toFixed(1) + '㎡';
  const wN = textW(space.name || '', fsN), wA = textW(area, fsA);
  const pw = Math.max(wN, wA) + 14;
  ctx.setFillStyle('rgba(255,255,255,0.86)');
  rr(ctx, cx - pw / 2, cy - 20, pw, 34, 5); ctx.fill();
  ctx.setTextAlign('center');
  ctx.setFillStyle(C.name); ctx.fillText(space.name || '', cx, cy - 6);
  ctx.setFillStyle(C.area); ctx.setFontSize(fsA); ctx.fillText(area, cx, cy + 8);
  ctx.setTextAlign('left');

  // —— 指北针（默认上=北，与墙体命名"上/北"一致；迷你预览图不画） ——
  if (!noCompass) {
    const nx = W - 24, ny = 26;
    ctx.setStrokeStyle(C.comp); ctx.setLineWidth(1);
    ctx.beginPath(); ctx.arc(nx, ny, 8, 0, 2 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(nx, ny + 5); ctx.lineTo(nx, ny - 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(nx - 3, ny - 1); ctx.lineTo(nx, ny - 5); ctx.lineTo(nx + 3, ny - 1); ctx.stroke();
    ctx.setFillStyle(C.comp); ctx.setFontSize(8); ctx.setTextAlign('center');
    ctx.fillText('N', nx, ny - 11);
    ctx.setTextAlign('left');
  }

  const items = drawFurn(ctx, space, ox, oy, rw, rh, scale, icons);
  // 窗玻璃符号最后画（压在家具上，标准制图画法：窗洞白底+三线玻璃）
  for (const w of winOpens) {
    ctx.setFillStyle('#f4f7fa');
    if (w.horiz) ctx.fillRect(w.x1 + w.g0, w.y1 - w.half, w.len, w.half * 2);
    else ctx.fillRect(w.x1 - w.half, w.y1 + w.g0, w.half * 2, w.len);
    ctx.setStrokeStyle('#6b8aa0'); ctx.setLineWidth(1.1);
    for (const off of [-w.half * 0.6, 0, w.half * 0.6]) {
      ctx.beginPath();
      if (w.horiz) { ctx.moveTo(w.x1 + w.g0, w.y1 + off); ctx.lineTo(w.x1 + w.g0 + w.len, w.y1 + off); }
      else { ctx.moveTo(w.x1 + off, w.y1 + w.g0); ctx.lineTo(w.x1 + off, w.y1 + w.g0 + w.len); }
      ctx.stroke();
    }
  }

  // —— 动线 + 人体工程（随录入实时算，对标模板视觉） ——
  drawErgo(ctx, space, items, ox, oy, scale);
  drawCirculation(ctx, space, items, ox, oy, rw, rh, scale, openings);
}

function drawPoly(ctx, space, W, H, m, icons) {
  const poly = space.poly;
  const maxx = Math.max.apply(null, poly.map(p => p.x)), maxy = Math.max.apply(null, poly.map(p => p.y));
  const scale = Math.min((W - 2 * m) / maxx, (H - 2 * m) / maxy);
  const rw = maxx * scale, rh = maxy * scale;
  const ox = (W - rw) / 2, oy = (H - rh) / 2;
  const P = poly.map(p => ({ x: ox + p.x * scale, y: oy + p.y * scale }));
  ctx.setFillStyle('#f4f7fa');
  ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y);
  for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].x, P[i].y);
  ctx.closePath(); ctx.fill();
  drawGrid(ctx, ox, oy, rw, rh, scale);
  const edges = space.edges || [];
  const thick = (edges[0] && edges[0].thick ? edges[0].thick : 180) / 1000;
  const halfT = (thick * scale) / 2;
  const n = P.length;
  const colOf = t => t === 'win' ? '#6b8aa0' : (t === 'door' ? '#9aa5a0' : '#2b3440');
  const band = (a, b, color, type) => {
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    if (L < 0.5) return;
    const nx = -dy / L, ny = dx / L;
    ctx.setStrokeStyle(color); ctx.setLineWidth(3);
    ctx.beginPath(); ctx.moveTo(a.x + nx * halfT, a.y + ny * halfT); ctx.lineTo(b.x + nx * halfT, b.y + ny * halfT); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.x - nx * halfT, a.y - ny * halfT); ctx.lineTo(b.x - nx * halfT, b.y - ny * halfT); ctx.stroke();
    if (type === 'win') {
      ctx.setLineWidth(1.2);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    } else if (type === 'door') {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      ctx.setLineWidth(1.3); ctx.beginPath(); ctx.arc(mx, my, halfT * 1.6, 0, 2 * Math.PI); ctx.stroke();
    }
  };
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    const type = edges[i] ? edges[i].type : 'wall';
    band(a, b, colOf(type), type);
  }
  drawFurn(ctx, space, ox, oy, rw, rh, scale, icons);
}

// ===== 家具布置（cm 坐标系：0,0=房间左上角，x 向右 y 向下） =====
function drawFurn(ctx, space, ox, oy, rw, rh, scale, icons) {
  const on = (space.furniture || []).filter(f => f.on);
  if (!on.length) return;
  const S = scale;
  const rm = { ox, oy, S, Wcm: space.w, Dcm: space.d };
  const items = on.map(f => {
    const s = symOf(f);
    return Object.assign({}, s, { id: f.id, name: f.name, dim: s.L + '×' + s.D });
  });
  const key = (space.key || '').toLowerCase();
  if (key === 'kitchen')        layoutKitchen(items, rm, space);
  else if (key === 'bathroom')  layoutBathroom(items, rm, space);
  else if (key === 'bedroom')   layoutBedroom(items, rm, space);
  else if (key === 'living')    layoutLiving(items, rm, space);
  else if (key === 'balcony')   layoutBalcony(items, rm, space);
  else if (key === 'study')     layoutStudy(items, rm, space);
  else                          layoutGeneric(items, rm, space);
  // 绘制顺序：被压在下层的先画（油烟机最上、电视压电视柜）
  const zOf = it => it.shape === 'hood' ? 20 : (it.shape === 'stove' ? 12 : (it.shape === 'fridge' ? 2 : (it.shape === 'tv' ? 10 : 0)));
  items.sort((a, b) => zOf(a) - zOf(b));
  // 兜底夹紧：不越房间
  items.forEach(it => {
    if (!it.rect) return;
    it.rect.x = Math.min(Math.max(it.rect.x, ox), ox + rw - it.rect.w);
    it.rect.y = Math.min(Math.max(it.rect.y, oy), oy + rh - it.rect.h);
  });
  // 尺寸标注以实际摆放为准（小空间里家具按比例缩小后，标注不能沿用目录尺寸）
  items.forEach(it => {
    if (!it.rect) return;
    const side = (it.wall === 'left' || it.wall === 'right');
    it.dim = Math.round((side ? it.rect.h : it.rect.w) / S) + '×' + Math.round((side ? it.rect.w : it.rect.h) / S);
  });
  items.forEach(it => { if (it.rect) drawFurnShape(ctx, it, icons); });
  return items;
}

function find(items, id) { return items.find(i => i.id === id); }

// 摆放：wall=靠哪面墙；u0=沿墙起点cm(左墙/右墙从上往下计,顶墙/底墙从左往右计)；
// v0=离墙距离cm；L=沿墙长cm；D=进深cm
function place(it, wall, u0, v0, L, D, rm) {
  const { ox, oy, S, Wcm, Dcm } = rm;
  it.wall = wall;
  if (wall === 'bottom')      it.rect = { x: ox + u0 * S,                 y: oy + (Dcm - v0 - D) * S, w: L * S, h: D * S };
  else if (wall === 'top')    it.rect = { x: ox + u0 * S,                 y: oy + v0 * S,             w: L * S, h: D * S };
  else if (wall === 'left')   it.rect = { x: ox + v0 * S,                 y: oy + u0 * S,             w: D * S, h: L * S };
  else                        it.rect = { x: ox + (Wcm - v0 - D) * S,     y: oy + u0 * S,             w: D * S, h: L * S };
}
// 自由摆放（不贴墙）
function placeFree(it, x, y, L, D, rm, wall) {
  it.rect = { x: rm.ox + x * rm.S, y: rm.oy + y * rm.S, w: L * rm.S, h: D * rm.S };
  it.wall = wall || 'bottom';
}

// 厨房(L型,跟随预算算法)：地柜=顶墙整条(W)+左墙(留角扣1.3),总长=W+D-1.3 与「地柜长度」公式一致
//   连续一体(同色L,非断块)；吊柜恒画、长度=0.6×地柜(单源,跟随预算)；冰箱置于底墙右端空位,不挡柜门
function layoutKitchen(items, rm, space) {
  const cabinet = find(items, 'cabinet') || find(items, 'counter');
  const stove = find(items, 'stove');
  const hood = find(items, 'hood');
  const fridge = find(items, 'fridge');
  const D = 60;                       // 地柜进深(标准)
  const leftLen = Math.max(60, space.d - 130);   // 左墙柜长：总长=W+leftLen = 长+宽−1.3m(=130cm,与预算「地柜长度」公式一致)
  if (cabinet) {
    place(cabinet, 'top', 0, 0, space.w, D, rm);                 // 顶墙整条(连续L的一臂)
    const leftC = Object.assign({}, cabinet, { id: 'cabinet_L', clone: true, sinkU: null, sinkUcm: null });
    place(leftC, 'left', 0, 0, leftLen, D, rm);                  // 左墙一臂(到墙底留1.3角扣)
    items.push(leftC);
    cabinet.sinkU = Math.min(Math.max(space.winOff != null ? space.winOff : space.w / 2, 40), space.w - 40); // 水槽对窗居中
    // 吊柜：顶墙上方,长度=0.6×地柜总长(跟预算同一公式);用户未加也自动补画,保证示意图与报价一致
    const wc = Math.min(space.w - 6, (space.w + leftLen) * 0.6);
    let wcItem = items.find(i => i.id === 'wallcab');
    if (!wcItem) { wcItem = Object.assign({}, cabinet, { id: 'wallcab', name: '吊柜', shape: 'wallcab', label: '吊柜', L: wc, D: 35 }); items.push(wcItem); }
    place(wcItem, 'top', 6, D, wc, 35, rm);                      // v0=D:高于台面,吊柜进深35
  }
  if (stove) place(stove, 'left', 55, 0, 75, 60, rm);            // 左墙离上角55cm避盲角,在L转角外
  if (hood)  place(hood, 'left', 55, 0, 90, 35, rm);             // 烟机悬于灶台正上方(同u0),宽90深35(标准尺寸)
  if (fridge) place(fridge, 'bottom', space.w - 80, 0, 80, 65, rm); // 冰箱置于底墙右端空位(不在柜墙上),不挡柜门
}

// 卫生间（门在右墙）：淋浴左上角(湿区)；马桶背靠底墙左侧(不正对门,前留≥100)；浴室柜底墙右侧靠门(干区)
function layoutBathroom(items, rm, space) {
  const shower = find(items, 'shower');
  const toilet = find(items, 'toilet') || find(items, 'squat');
  const vanity = find(items, 'vanity');
  const washer = find(items, 'washer');
  if (shower) place(shower, 'top', 0, 0, 90, 90, rm);
  if (toilet) place(toilet, 'bottom', 15, 0, 45, 70, rm);
  if (vanity) place(vanity, 'bottom', Math.min(105, space.w - 95), 0, 90, 55, rm);
  if (washer) place(washer, 'left', space.d - 60, 0, 60, 60, rm);
}

// 卧室（门在左墙贴顶角）：床头靠右墙(不正对门)；床两侧配床头柜；衣柜沿底墙；书桌靠窗(顶墙)
function layoutBedroom(items, rm, space) {
  const bed = find(items, 'bed');
  const wardrobe = find(items, 'wardrobe');
  const desk = find(items, 'desk');
  if (bed) {
    const u0 = (space.d - 180) / 2;
    place(bed, 'right', u0, 0, 180, 200, rm);
    // 床头柜：床沿右墙上、下两端各一个（空间够才放，避免越界/压门）
    const mkNs = () => ({ id: 'nightstand', name: '床头柜', dim: '40×40', L: 40, D: 40, shape: 'nightstand', label: '床头柜' });
    if (u0 >= 45) { const ns = mkNs(); place(ns, 'right', u0 - 45, 0, 40, 40, rm); items.push(ns); }
    if (space.d - (u0 + 180) >= 45) { const ns = mkNs(); place(ns, 'right', u0 + 180 + 5, 0, 40, 40, rm); items.push(ns); }
  }
  if (wardrobe) place(wardrobe, 'bottom', 0, 0, Math.min(200, space.w - 160), 60, rm);
  if (desk) place(desk, 'top', 15, 0, 120, 60, rm);
}

// 客厅（门在左墙）：电视柜+电视靠底墙(实墙)；沙发靠窗墙(顶墙)对电视；茶几居中
function layoutLiving(items, rm, space) {
  const sofa = find(items, 'sofa');
  const tv = find(items, 'tv');
  const tvcab = find(items, 'tvcab');
  const table = find(items, 'table');
  const bed = find(items, 'bed');
  const wardrobe = find(items, 'wardrobe');
  if (tvcab) place(tvcab, 'bottom', (space.w - 180) / 2, 0, 180, 40, rm);
  if (tv) place(tv, 'bottom', (space.w - 130) / 2, 0, 130, 8, rm);
  if (sofa) place(sofa, 'top', (space.w - 220) / 2, 10, 220, 95, rm);
  if (table) placeFree(table, (space.w - 120) / 2, space.d / 2 - 10, 120, 60, rm, 'top');
  if (wardrobe) place(wardrobe, 'bottom', 0, 0, 160, 60, rm);
  if (bed) place(bed, 'right', (space.d - 180) / 2, 0, 180, 200, rm);
}

// 阳台(家政洗衣区,门在左墙 y≈30~110 内开)：洗衣机靠窗上墙右段(湿区,避开门扇) / 晾衣架居中上空(干衣)
//   / 储物柜靠右墙(干区); 中间留走道; 不放床。湿(洗衣机)与干(储物柜)分置两侧。
function layoutBalcony(items, rm, space) {
  const washer = find(items, 'washer');
  const rack = find(items, 'rack');
  const wardrobe = find(items, 'wardrobe');
  if (washer) place(washer, 'top', space.w - 60, 0, 60, 60, rm);                       // 顶墙右(窗下湿区,远离左门)
  if (rack)   place(rack, 'top', 0, 0, Math.min(95, space.w - 95), 8, rm);            // 顶墙左:晾衣架(上方干衣)
  if (wardrobe) { wardrobe.label = '储物柜'; place(wardrobe, 'bottom', space.w - 80, 0, 80, 60, rm); } // 底墙右段:储物柜(干区,避开洗衣机与左门)
}

// 书房（门在左墙）：书桌靠窗(顶墙左)；床头靠右墙；衣柜底墙左
function layoutStudy(items, rm, space) {
  const desk = find(items, 'desk');
  const bookshelf = find(items, 'bookshelf');
  const bed = find(items, 'bed');
  const wardrobe = find(items, 'wardrobe');
  if (desk) place(desk, 'top', 20, 0, 120, 60, rm);
  if (bookshelf) { const bl = Math.min(200, space.w - 100); place(bookshelf, 'top', (space.w - bl) / 2, 0, bl, 35, rm); } // 书柜移顶墙(右墙被床占满,放右墙会被床盖住)
  if (bed) place(bed, 'right', (space.d - 180) / 2, 0, 180, 200, rm);
  if (wardrobe) place(wardrobe, 'bottom', 0, 0, 90, 60, rm);
}

// 通用兜底：按 FURN 默认墙居中贴墙
function layoutGeneric(items, rm, space) {
  items.forEach(it => {
    const w = it.wall || 'bottom';
    const u0 = (w === 'bottom' || w === 'top' ? space.w : space.d) / 2 - it.L / 2;
    place(it, w, Math.max(0, u0), 0, it.L, it.D, rm);
  });
}

// ===== (u,v) 映射：u=沿墙长(px,从贴墙起点), v=离墙深(px,朝房间) =====
function Mapper(it) {
  const r = it.rect, w = it.wall || 'bottom';
  return {
    P: (u, v) => {
      if (w === 'bottom') return [r.x + u, r.y + r.h - v];
      if (w === 'top') return [r.x + u, r.y + v];
      if (w === 'left') return [r.x + v, r.y + u];
      return [r.x + r.w - v, r.y + u];
    },
    // 局部矩形 (u0,v0,w,h) → 绝对 [x,y,w,h]（w沿u,h沿v）
    R: (u0, v0, ww, hh) => {
      if (w === 'bottom') return [r.x + u0, r.y + r.h - v0 - hh, ww, hh];
      if (w === 'top') return [r.x + u0, r.y + v0, ww, hh];
      if (w === 'left') return [r.x + v0, r.y + u0, hh, ww];
      return [r.x + r.w - v0 - hh, r.y + u0, hh, ww];
    },
    lenPx: (w === 'bottom' || w === 'top') ? r.w : r.h,
    depPx: (w === 'bottom' || w === 'top') ? r.h : r.w
  };
}

function textW(s, fs) {
  let w = 0;
  for (const ch of String(s)) w += ch.charCodeAt(0) > 255 ? fs : fs * 0.56;
  return w;
}

function label(ctx, it, color, vOff, uOff) {
  const M = Mapper(it);
  const c = M.P(M.lenPx / 2 + (uOff || 0), M.depPx / 2 + (vOff || 0));
  const showDim = Math.min(M.lenPx, M.depPx) > 36 && it.dim;
  // 半透明白底圆角片：保证文字压在家具图片上也读得清
  const fs1 = 10, fs2 = 8;
  const w1 = textW(it.label, fs1);
  const wMax = showDim ? Math.max(w1, textW(it.dim, fs2)) : w1;
  const pad = 3, lineH = showDim ? 22 : 13;
  ctx.setFillStyle('rgba(255,255,255,0.78)');
  rr(ctx, c[0] - wMax / 2 - pad, c[1] - fs1 - pad, wMax + pad * 2, lineH, 4); ctx.fill();
  ctx.setFillStyle(color || '#5d6b78'); ctx.setFontSize(fs1); ctx.setTextAlign('center');
  ctx.fillText(it.label, c[0], c[1] - 1);
  if (showDim) {
    ctx.setFontSize(fs2); ctx.setFillStyle('#8a938f');
    ctx.fillText(it.dim, c[0], c[1] + 10);
  }
  ctx.setTextAlign('left');
}

// ===== 家具顶视图图标（AI 生成、绿幕抠图、贴墙侧=图片上边） =====
const ICON_KEYS = {
  counter: 'counter', stove: 'stove', fridge: 'fridge', toilet: 'toilet',
  vanity: 'vanity', shower: 'shower', sofa: 'sofa', table: 'table',
  tvcab: 'tvcab', bed: 'bed', wardrobe: 'wardrobe', desk: 'desk',
  washer: 'washer', box: 'wardrobe'   // 储物柜复用衣柜图标
};
// 图标宽高比（裁剪后实测，用于长条柜平铺决策）
const ICON_AR = {
  toilet: 0.66, bed: 0.68, wardrobe: 2.91, counter: 2.38, sofa: 2.38,
  stove: 1.04, washer: 1.06, vanity: 2.30, desk: 1.05, tvcab: 2.03,
  table: 1.61, fridge: 1.76, shower: 1.03
};

// 按朝墙方向旋转贴图；长条柜类沿墙平铺避免拉宽变形
function drawIcon(ctx, img, it, icons) {
  const r = it.rect;
  const wall = it.wall || 'bottom';
  let tx, ty, rot;
  if (wall === 'top')         { tx = r.x;       ty = r.y;       rot = 0; }
  else if (wall === 'bottom') { tx = r.x + r.w; ty = r.y + r.h; rot = Math.PI; }
  else if (wall === 'left')   { tx = r.x;       ty = r.y + r.h; rot = -Math.PI / 2; }
  else                        { tx = r.x + r.w; ty = r.y;       rot = Math.PI / 2; }
  const along = (wall === 'top' || wall === 'bottom') ? r.w : r.h;
  const dep   = (wall === 'top' || wall === 'bottom') ? r.h : r.w;
  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(rot);
  let n = 1;
  const key = String(img).split('/').pop().replace(/\.png$/, '');
  const iar = ICON_AR[key];
  if (iar) {
    const rar = along / dep;
    if (iar > 1.6 && rar / iar > 1.5) n = Math.max(2, Math.round(rar / iar));  // 长条图标才平铺
  }
  const lu = along / n;
  for (let i = 0; i < n; i++) ctx.drawImage(img, i * lu, 0, lu, dep);
  ctx.restore();
}

// ===== 产品顶视图（优先真实图标，无图标退回矢量符号） =====
function drawFurnShape(ctx, it, icons) {
  const M = Mapper(it);
  const L = M.lenPx, D = M.depPx;
  const shape = it.shape || 'box';

  // —— 图标覆盖（油烟机/电视/晾衣架/床头柜/书柜保留矢量画法） ——
  const iconKey = ICON_KEYS[shape];
  const icon = iconKey && icons ? icons[iconKey] : null;
  if (icon) {
    drawIcon(ctx, icon, it, icons);
    if (shape === 'shower') {
      // 玻璃隔断线压在图标上（淋浴位固定在左上角，开口朝右、下）
      ctx.setStrokeStyle('rgba(95,168,214,0.9)'); ctx.setLineWidth(2.2);
      const eg1 = M.R(L, 0, 0, D);
      ctx.beginPath(); ctx.moveTo(eg1[0], eg1[1]); ctx.lineTo(eg1[0] + eg1[2], eg1[1] + eg1[3]); ctx.stroke();
      const eg2 = M.R(0, D, L, 0);
      ctx.beginPath(); ctx.moveTo(eg2[0], eg2[1]); ctx.lineTo(eg2[0] + eg2[2], eg2[1] + eg2[3]); ctx.stroke();
    }
    if (shape === 'counter' && (it.sinkU != null || it.sinkUcm != null)) {
      // 水槽按窗位矢量补画（图标里不带水槽，保证对窗）
      const su = it.sinkU != null ? it.sinkU : (it.sinkUcm * (L / (it._runLen || L)));
      const bw = Math.min(56, L * 0.3), bh = D - 18;
      const bs = M.R(Math.min(Math.max(su - bw / 2, 6), L - bw - 6), 10, bw, bh);
      ctx.setFillStyle('rgba(213,229,236,0.95)'); ctx.setStrokeStyle('#7fa6b3'); ctx.setLineWidth(1.3);
      rr(ctx, bs[0], bs[1], bs[2], bs[3], 7); ctx.fill(); ctx.stroke();
      const ic = M.R(Math.min(Math.max(su - bw / 2, 6), L - bw - 6) + 4, 14, bw - 8, bh - 8);
      ctx.setLineWidth(0.8); rr(ctx, ic[0], ic[1], ic[2], ic[3], 5); ctx.stroke();
      const fc = M.P(Math.min(Math.max(su, 6), L - 6), 5);
      ctx.setFillStyle('#5b6f76'); ctx.beginPath(); ctx.arc(fc[0], fc[1], 2.6, 0, 2 * Math.PI); ctx.fill();
    }
    const lbCol = { stove: '#e8ebee' }[shape] || '#5d6b78';
    if (shape === 'counter') label(ctx, it, '#5d6b78', D / 2 + 9);  // 标注放台面外侧，别盖住水槽
    else label(ctx, it, lbCol);
    return;
  }

  // —— 橱柜台面：沿墙带状 + 柜门分隔 + 嵌入水槽(对窗) ——
  if (shape === 'counter') {
    let b = M.R(0, 0, L, D);
    ctx.setFillStyle('#e9eef3'); rr(ctx, b[0], b[1], b[2], b[3], 3); ctx.fill();
    ctx.setStrokeStyle('#c3cdd8'); ctx.setLineWidth(1.2); rr(ctx, b[0], b[1], b[2], b[3], 3); ctx.stroke();
    // 柜门分隔 + 把手
    ctx.setStrokeStyle('#d7dee6'); ctx.setLineWidth(1);
    const doors = Math.max(2, Math.round(L / Math.max(24, D * 0.92)));
    for (let i = 1; i < doors; i++) {
      const seg = M.R(L * i / doors, 5, 0.8, D - 10);
      ctx.beginPath(); ctx.moveTo(seg[0], seg[1]); ctx.lineTo(seg[0] + seg[2], seg[1] + seg[3]); ctx.stroke();
    }
    for (let i = 0; i < doors; i++) {
      const h = M.R(L * (i + 0.5) / doors - 2, 6, 4, 1.6);
      ctx.setFillStyle('#aab6c2'); ctx.fillRect(h[0], h[1], h[2], h[3]);
    }
    // 水槽（嵌入，对窗）
    if (it.sinkU != null || it.sinkUcm != null) {
      const su = it.sinkU != null ? it.sinkU : (it.sinkUcm * (L / (it._runLen || L)));
      const bw = Math.min(56, L * 0.3), bh = D - 18;
      const bs = M.R(Math.min(Math.max(su - bw / 2, 6), L - bw - 6), 10, bw, bh);
      ctx.setFillStyle('#d5e5ec'); ctx.setStrokeStyle('#7fa6b3'); ctx.setLineWidth(1.3);
      rr(ctx, bs[0], bs[1], bs[2], bs[3], 7); ctx.fill(); ctx.stroke();
      const ic = M.R(Math.min(Math.max(su - bw / 2, 6), L - bw - 6) + 4, 14, bw - 8, bh - 8);
      ctx.setLineWidth(0.8); rr(ctx, ic[0], ic[1], ic[2], ic[3], 5); ctx.stroke();
      const fc = M.P(Math.min(Math.max(su, 6), L - 6), 5);
      ctx.setFillStyle('#5b6f76'); ctx.beginPath(); ctx.arc(fc[0], fc[1], 2.6, 0, 2 * Math.PI); ctx.fill();
    }
    // 标注放到台面下方（台面上被水槽+柜门分隔占满，文字放中间会糊成一团）
    label(ctx, it, '#5d6b78', D / 2 + 9);
    return;
  }
  // —— 灶具：深色台面段 + 双炉头 + 旋钮 ——
  if (shape === 'stove') {
    let b = M.R(0, 0, L, D);
    ctx.setFillStyle('#3a4046'); rr(ctx, b[0], b[1], b[2], b[3], 4); ctx.fill();
    ctx.setStrokeStyle('#22262a'); ctx.setLineWidth(1); rr(ctx, b[0], b[1], b[2], b[3], 4); ctx.stroke();
    ctx.setStrokeStyle('#aeb6bd'); ctx.setLineWidth(1.4);
    const r1 = Math.min(D * 0.26, L * 0.21);
    for (const uu of [L * 0.30, L * 0.70]) {
      const c = M.P(uu, D * 0.58);
      ctx.beginPath(); ctx.arc(c[0], c[1], r1, 0, 2 * Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(c[0], c[1], r1 * 0.45, 0, 2 * Math.PI); ctx.stroke();
    }
    ctx.setFillStyle('#c9ccd0');
    for (const uu of [L * 0.30, L * 0.70]) {
      const k = M.P(uu, D * 0.12);
      ctx.beginPath(); ctx.arc(k[0], k[1], 1.8, 0, 2 * Math.PI); ctx.fill();
    }
    label(ctx, it, '#e8ebee');
    return;
  }
  // —— 油烟机：悬于灶台正上方的薄机体(虚线外框表示吊装,尺寸=宽90×深35,与预算/实物一致) ——
  if (shape === 'hood') {
    ctx.setStrokeStyle('#7f93a6'); ctx.setLineWidth(1.4); ctx.setLineDash([5, 3]);
    let b = M.R(0, 0, L, D);
    ctx.strokeRect(b[0], b[1], b[2], b[3]);
    ctx.setLineDash([]);
    ctx.setStrokeStyle('#aebccb'); ctx.setLineWidth(0.9);
    const c = M.P(L / 2, D / 2);
    ctx.beginPath(); ctx.arc(c[0], c[1], Math.min(L, D) * 0.20, 0, 2 * Math.PI); ctx.stroke();
    const ct = M.P(L / 2, 5);
    ctx.setFontSize(8); ctx.setFillStyle('#5d6b78'); ctx.setTextAlign('center');
    ctx.fillText('油烟机', ct[0], ct[1]); ctx.setTextAlign('left');
    return;
  }
  // —— 吊柜(上柜)：顶墙上方,长度=0.6×地柜(跟随预算),浅灰描边 ——
  if (shape === 'wallcab') {
    let b = M.R(0, 0, L, D);
    ctx.setFillStyle('#e6ecf2'); rr(ctx, b[0], b[1], b[2], b[3], 3); ctx.fill();
    ctx.setStrokeStyle('#b3c0cd'); ctx.setLineWidth(1.1); rr(ctx, b[0], b[1], b[2], b[3], 3); ctx.stroke();
    ctx.setStrokeStyle('#cdd8e3'); ctx.setLineWidth(0.9);
    const doors = Math.max(2, Math.round(L / 60));
    for (let i = 1; i < doors; i++) {
      const s = M.R(L * i / doors, 4, 0.8, D - 8);
      ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(s[0] + s[2], s[1] + s[3]); ctx.stroke();
    }
    label(ctx, it, '#5d6b78', D / 2 + 8);
    return;
  }
  // —— 冰箱：矩形 + 对开门 + 双把手 ——
  if (shape === 'fridge') {
    let b = M.R(0, 0, L, D);
    ctx.setFillStyle('#f0f3f6'); rr(ctx, b[0], b[1], b[2], b[3], 5); ctx.fill();
    ctx.setStrokeStyle('#9aa7b4'); ctx.setLineWidth(1.3); rr(ctx, b[0], b[1], b[2], b[3], 5); ctx.stroke();
    const mid = M.R(L / 2 - 0.6, 4, 1.2, D - 8);
    ctx.beginPath(); ctx.moveTo(mid[0], mid[1]); ctx.lineTo(mid[0] + mid[2], mid[1] + mid[3]); ctx.stroke();
    ctx.setLineWidth(2.2);
    const h1s = M.P(L / 2 - 5, D * 0.30), h1e = M.P(L / 2 - 5, D * 0.70);
    const h2s = M.P(L / 2 + 5, D * 0.30), h2e = M.P(L / 2 + 5, D * 0.70);
    ctx.beginPath(); ctx.moveTo(h1s[0], h1s[1]); ctx.lineTo(h1e[0], h1e[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(h2s[0], h2s[1]); ctx.lineTo(h2e[0], h2e[1]); ctx.stroke();
    label(ctx, it, '#4a5a6b');
    return;
  }
  // —— 马桶：标准顶视符号 = 贴墙水箱(矩形) + 圆形座圈(留缝分层) + 内圈 + 盖中线 ——
  if (shape === 'toilet') {
    const tk = M.R(0, 0, L, D * 0.20);
    ctx.setFillStyle('#dde9ee'); ctx.fillRect(tk[0], tk[1], tk[2], tk[3]);
    ctx.setStrokeStyle('#6b8aa0'); ctx.setLineWidth(1.4); ctx.strokeRect(tk[0], tk[1], tk[2], tk[3]);
    const bw = Math.min(L * 0.88, D * 0.92), bh = D * 0.72;
    const bl = M.R((L - bw) / 2, D * 0.25, bw, bh);
    ctx.setFillStyle('#ffffff'); rr(ctx, bl[0], bl[1], bl[2], bl[3], Math.min(bw, bh) * 0.5); ctx.fill();
    ctx.setStrokeStyle('#6b8aa0'); ctx.setLineWidth(1.5); rr(ctx, bl[0], bl[1], bl[2], bl[3], Math.min(bw, bh) * 0.5); ctx.stroke();
    const sw = bw * 0.6, sh = bh * 0.58;
    const sl = M.R((L - sw) / 2, D * 0.25 + (bh - sh) / 2, sw, sh);
    ctx.setLineWidth(1); rr(ctx, sl[0], sl[1], sl[2], sl[3], Math.min(sw, sh) * 0.5); ctx.stroke();
    const lid = M.R(L / 2 - 0.5, D * 0.25, 1, bh * 0.5);
    ctx.setLineWidth(0.9); ctx.beginPath(); ctx.moveTo(lid[0], lid[1]); ctx.lineTo(lid[0] + lid[2], lid[1] + lid[3]); ctx.stroke();
    label(ctx, it, '#4a6276', D * 0.34);
    return;
  }
  // —— 浴室柜：柜体 + 椭圆台上盆 + 龙头 ——
  if (shape === 'vanity') {
    let b = M.R(0, 0, L, D);
    ctx.setFillStyle('#eef2f6'); rr(ctx, b[0], b[1], b[2], b[3], 4); ctx.fill();
    ctx.setStrokeStyle('#c3cdd8'); ctx.setLineWidth(1.2); rr(ctx, b[0], b[1], b[2], b[3], 4); ctx.stroke();
    const pw = L * 0.56, ph = D * 0.62;
    const p = M.R((L - pw) / 2, D * 0.26, pw, ph);
    ctx.setFillStyle('#d5e5ec'); ctx.setStrokeStyle('#7fa6b3'); ctx.setLineWidth(1.2);
    rr(ctx, p[0], p[1], p[2], p[3], Math.min(pw, ph) * 0.42); ctx.fill(); ctx.stroke();
    const fc = M.P(L / 2, D * 0.12);
    ctx.setFillStyle('#5b6f76'); ctx.beginPath(); ctx.arc(fc[0], fc[1], 2.4, 0, 2 * Math.PI); ctx.fill();
    label(ctx, it, '#5d6b78');
    return;
  }
  // —— 淋浴隔断：湿区浅填 + 两条内边玻璃屏(非实墙封闭) + 地漏 + 坡水 + 花洒 ——
  if (shape === 'shower') {
    let b = M.R(0, 0, L, D);
    ctx.setFillStyle('#eaf3f7'); rr(ctx, b[0], b[1], b[2], b[3], 3); ctx.fill();
    ctx.setStrokeStyle('#5fa8d6'); ctx.setLineWidth(2.2);
    const eg1 = M.R(L, 0, 0, D);
    ctx.beginPath(); ctx.moveTo(eg1[0], eg1[1]); ctx.lineTo(eg1[0] + eg1[2], eg1[1] + eg1[3]); ctx.stroke();
    const eg2 = M.R(0, D, L, 0);
    ctx.beginPath(); ctx.moveTo(eg2[0], eg2[1]); ctx.lineTo(eg2[0] + eg2[2], eg2[1] + eg2[3]); ctx.stroke();
    ctx.setStrokeStyle('#c4e6f4'); ctx.setLineWidth(0.8);
    const g1b = M.R(L - 2.5, 5, 0, D - 10); ctx.beginPath(); ctx.moveTo(g1b[0], g1b[1]); ctx.lineTo(g1b[0] + g1b[2], g1b[1] + g1b[3]); ctx.stroke();
    const g2b = M.R(5, D - 2.5, L - 10, 0); ctx.beginPath(); ctx.moveTo(g2b[0], g2b[1]); ctx.lineTo(g2b[0] + g2b[2], g2b[1] + g2b[3]); ctx.stroke();
    const dc = M.P(L / 2, D / 2);
    ctx.setStrokeStyle('#9db4c8'); ctx.setLineWidth(0.9);
    for (const corner of [[6, 6], [L - 6, 6], [6, D - 6], [L - 6, D - 6]]) {
      const p = M.P(corner[0], corner[1]);
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(dc[0], dc[1]); ctx.stroke();
    }
    ctx.setFillStyle('#5f87ad'); ctx.beginPath(); ctx.arc(dc[0], dc[1], 3, 0, 2 * Math.PI); ctx.fill();
    const hc = M.P(L * 0.16, D * 0.16);
    ctx.setStrokeStyle('#3a7bd5'); ctx.setLineWidth(1.4);
    ctx.beginPath(); ctx.arc(hc[0], hc[1], 4.5, 0, 2 * Math.PI); ctx.stroke();
    label(ctx, it, '#3d5f80', -D * 0.12);
    return;
  }
  // —— 沙发：靠背条(墙侧) + 双扶手 + 坐垫分隔 ——
  if (shape === 'sofa') {
    let b = M.R(0, 0, L, D);
    ctx.setFillStyle('#dde6ef'); rr(ctx, b[0], b[1], b[2], b[3], 8); ctx.fill();
    ctx.setStrokeStyle('#b3c2d1'); ctx.setLineWidth(1.2); rr(ctx, b[0], b[1], b[2], b[3], 8); ctx.stroke();
    const bk = M.R(0, 0, L, D * 0.20);
    ctx.setFillStyle('#ccd9e6'); rr(ctx, bk[0], bk[1], bk[2], bk[3], 5); ctx.fill();
    const aw = Math.min(14, L * 0.07);
    for (const u0 of [0, L - aw]) {
      const a = M.R(u0, 0, aw, D);
      ctx.setFillStyle('#ccd9e6'); rr(ctx, a[0], a[1], a[2], a[3], 5); ctx.fill();
      ctx.setStrokeStyle('#b3c2d1'); ctx.setLineWidth(1); rr(ctx, a[0], a[1], a[2], a[3], 5); ctx.stroke();
    }
    ctx.setStrokeStyle('#aebcca'); ctx.setLineWidth(1);
    for (const uu of [L / 3, 2 * L / 3]) {
      const s1 = M.P(uu, D * 0.22), s2 = M.P(uu, D - 4);
      ctx.beginPath(); ctx.moveTo(s1[0], s1[1]); ctx.lineTo(s2[0], s2[1]); ctx.stroke();
    }
    label(ctx, it, '#5d6b78', D * 0.16);
    return;
  }
  // —— 床：床头板(墙侧) + 双枕 + 盖被线 ——
  if (shape === 'bed') {
    let b = M.R(0, 0, L, D);
    ctx.setFillStyle('#e7ecf3'); rr(ctx, b[0], b[1], b[2], b[3], 6); ctx.fill();
    ctx.setStrokeStyle('#a9b6c8'); ctx.setLineWidth(1.2); rr(ctx, b[0], b[1], b[2], b[3], 6); ctx.stroke();
    const hb = M.R(0, 0, L, Math.min(10, D * 0.06));
    ctx.setFillStyle('#cdd8e6'); rr(ctx, hb[0], hb[1], hb[2], hb[3], 3); ctx.fill();
    const pw = L * 0.38, pd = Math.min(D * 0.16, 34);
    for (const u0 of [L * 0.08, L * 0.54]) {
      const p = M.R(u0, Math.min(12, D * 0.08), pw, pd);
      ctx.setFillStyle('#f6f9fc'); rr(ctx, p[0], p[1], p[2], p[3], pd * 0.3); ctx.fill();
      ctx.setStrokeStyle('#bcc8d8'); ctx.setLineWidth(0.9); rr(ctx, p[0], p[1], p[2], p[3], pd * 0.3); ctx.stroke();
    }
    const q = M.R(2, D * 0.34, L - 4, D * 0.62);
    ctx.setFillStyle('#dde4ee'); rr(ctx, q[0], q[1], q[2], q[3], 6); ctx.fill();
    label(ctx, it, '#4a5b78');
    return;
  }
  // —— 衣柜：柜体 + 挂杆中线 + 门缝 + 把手 ——
  if (shape === 'wardrobe') {
    let b = M.R(0, 0, L, D);
    ctx.setFillStyle('#e9eef3'); rr(ctx, b[0], b[1], b[2], b[3], 3); ctx.fill();
    ctx.setStrokeStyle('#c3cdd8'); ctx.setLineWidth(1.2); rr(ctx, b[0], b[1], b[2], b[3], 3); ctx.stroke();
    const rail = M.R(6, D / 2, L - 12, 1.2);
    ctx.setStrokeStyle('#a89878'); ctx.setLineWidth(1.6);
    ctx.beginPath(); ctx.moveTo(rail[0], rail[1]); ctx.lineTo(rail[0] + rail[2], rail[1] + rail[3]); ctx.stroke();
    if (L > 70) {
      const dv = M.R(L / 2, 3, 0.9, D - 6);
      ctx.setLineWidth(1);
      ctx.beginPath(); ctx.moveTo(dv[0], dv[1]); ctx.lineTo(dv[0] + dv[2], dv[1] + dv[3]); ctx.stroke();
      ctx.setLineWidth(2);
      const g1 = M.P(L / 2 - 4, D * 0.35), g1e = M.P(L / 2 - 4, D * 0.5);
      const g2 = M.P(L / 2 + 4, D * 0.5), g2e = M.P(L / 2 + 4, D * 0.65);
      ctx.beginPath(); ctx.moveTo(g1[0], g1[1]); ctx.lineTo(g1e[0], g1e[1]); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(g2[0], g2[1]); ctx.lineTo(g2e[0], g2e[1]); ctx.stroke();
    }
    // 标注避开挂杆中线和门缝（都压在正中会糊），放到左半扇门板上
    label(ctx, it, '#5d6b78', D * 0.24, -L * 0.25);
    return;
  }
  // —— 床头柜：小方柜 + 抽屉线 + 把手 ——
  if (shape === 'nightstand') {
    let b = M.R(0, 0, L, D);
    ctx.setFillStyle('#e3eaf1'); rr(ctx, b[0], b[1], b[2], b[3], 4); ctx.fill();
    ctx.setStrokeStyle('#b3c2d1'); ctx.setLineWidth(1.1); rr(ctx, b[0], b[1], b[2], b[3], 4); ctx.stroke();
    ctx.setStrokeStyle('#aebcca'); ctx.setLineWidth(0.9);
    const dl = M.R(4, D * 0.5, L - 8, 0.9);
    ctx.beginPath(); ctx.moveTo(dl[0], dl[1]); ctx.lineTo(dl[0] + dl[2], dl[1] + dl[3]); ctx.stroke();
    const h1 = M.P(L * 0.5, D * 0.26), h1e = M.P(L * 0.5, D * 0.44);
    const h2 = M.P(L * 0.5, D * 0.56), h2e = M.P(L * 0.5, D * 0.74);
    ctx.beginPath(); ctx.moveTo(h1[0], h1[1]); ctx.lineTo(h1e[0], h1e[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(h2[0], h2[1]); ctx.lineTo(h2e[0], h2e[1]); ctx.stroke();
    label(ctx, it, '#5d6b78');
    return;
  }
  // —— 书桌：桌面 + 椅子(朝桌) ——
  if (shape === 'desk') {
    let b = M.R(0, 0, L, D);
    ctx.setFillStyle('#e9eef3'); rr(ctx, b[0], b[1], b[2], b[3], 3); ctx.fill();
    ctx.setStrokeStyle('#aebcca'); ctx.setLineWidth(1.2); rr(ctx, b[0], b[1], b[2], b[3], 3); ctx.stroke();
    const cw = L * 0.42, cd = Math.min(20, D * 0.4);
    const ch = M.R((L - cw) / 2, D + 4, cw, cd);
    ctx.setFillStyle('#cdd9e6'); rr(ctx, ch[0], ch[1], ch[2], ch[3], 6); ctx.fill();
    ctx.setStrokeStyle('#9fb0bf'); ctx.setLineWidth(1); rr(ctx, ch[0], ch[1], ch[2], ch[3], 6); ctx.stroke();
    label(ctx, it, '#5d6b78', -2);
    return;
  }
  // —— 洗衣机：方身 + 滚筒圆 + 洗剂盒 ——
  if (shape === 'washer') {
    let b = M.R(0, 0, L, D);
    ctx.setFillStyle('#f0f3f6'); rr(ctx, b[0], b[1], b[2], b[3], 5); ctx.fill();
    ctx.setStrokeStyle('#9aa7b4'); ctx.setLineWidth(1.3); rr(ctx, b[0], b[1], b[2], b[3], 5); ctx.stroke();
    const c = M.P(L / 2, D * 0.62);
    ctx.setStrokeStyle('#7a8a96'); ctx.setLineWidth(1.4);
    ctx.beginPath(); ctx.arc(c[0], c[1], Math.min(L, D) * 0.26, 0, 2 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(c[0], c[1], Math.min(L, D) * 0.15, 0, 2 * Math.PI); ctx.stroke();
    const dp = M.P(L * 0.82, D * 0.16);
    ctx.setFillStyle('#9aa8b8'); ctx.beginPath(); ctx.arc(dp[0], dp[1], 2.2, 0, 2 * Math.PI); ctx.fill();
    // 标注贴墙侧（滚筒圆上方留白处），避免压住滚筒
    label(ctx, it, '#4a5a6b', -D * 0.30);
    return;
  }
  // —— 晾衣架：双杆 + 挂孔 ——
  if (shape === 'rack') {
    ctx.setStrokeStyle('#7f958f'); ctx.setLineWidth(1.6);
    for (const vv of [D * 0.3, D * 0.7]) {
      const s = M.P(3, vv), e = M.P(L - 3, vv);
      ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
    }
    ctx.setLineWidth(1);
    for (let i = 1; i <= 4; i++) {
      const a = M.P(L * i / 5, D * 0.3), b2 = M.P(L * i / 5, D * 0.7);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke();
    }
    const c = M.P(L / 2, D + 10);
    ctx.setFontSize(9); ctx.setFillStyle('#4a6276'); ctx.setTextAlign('center');
    ctx.fillText('晾衣架', c[0], c[1]); ctx.setTextAlign('left');
    return;
  }
  // —— 书柜：柜体 + 隔板 ——
  if (shape === 'bookshelf') {
    let b = M.R(0, 0, L, D);
    ctx.setFillStyle('#e9eef3'); rr(ctx, b[0], b[1], b[2], b[3], 3); ctx.fill();
    ctx.setStrokeStyle('#aebcca'); ctx.setLineWidth(1.2); rr(ctx, b[0], b[1], b[2], b[3], 3); ctx.stroke();
    ctx.setLineWidth(1);
    const n = 4;
    for (let i = 1; i < n; i++) {
      const s = M.P(L * i / n, 2), e = M.P(L * i / n, D - 2);
      ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
    }
    label(ctx, it, '#5d6b78');
    return;
  }
  // —— 电视：贴墙薄条 ——
  if (shape === 'tv') {
    let b = M.R(0, 0, L, D);
    ctx.setFillStyle('#2f3438'); rr(ctx, b[0], b[1], b[2], b[3], 2); ctx.fill();
    return;
  }
  // —— 电视柜：矮柜 + 门缝 ——
  if (shape === 'tvcab') {
    let b = M.R(0, 0, L, D);
    ctx.setFillStyle('#e3e9f0'); rr(ctx, b[0], b[1], b[2], b[3], 3); ctx.fill();
    ctx.setStrokeStyle('#b3c2d1'); ctx.setLineWidth(1.2); rr(ctx, b[0], b[1], b[2], b[3], 3); ctx.stroke();
    ctx.setLineWidth(1);
    for (const uu of [L / 3, 2 * L / 3]) {
      const s = M.P(uu, 3), e = M.P(uu, D - 3);
      ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
    }
    label(ctx, it, '#5d6b78');
    return;
  }
  // —— 茶几 ——
  if (shape === 'table') {
    let b = M.R(0, 0, L, D);
    ctx.setFillStyle('#dde7ee'); rr(ctx, b[0], b[1], b[2], b[3], 9); ctx.fill();
    ctx.setStrokeStyle('#8ba3b0'); ctx.setLineWidth(1.2); rr(ctx, b[0], b[1], b[2], b[3], 9); ctx.stroke();
    const ib = M.R(5, 5, L - 10, D - 10);
    ctx.setLineWidth(0.8); rr(ctx, ib[0], ib[1], ib[2], ib[3], 6); ctx.stroke();
    label(ctx, it, '#3f5b7a');
    return;
  }
  // —— 兜底方块 ——
  let b = M.R(0, 0, L, D);
  ctx.setFillStyle('#e8eef2'); rr(ctx, b[0], b[1], b[2], b[3], 5); ctx.fill();
  ctx.setStrokeStyle('#5b7b8a'); ctx.setLineWidth(1.2); rr(ctx, b[0], b[1], b[2], b[3], 5); ctx.stroke();
  label(ctx, it, '#1f5a4c');
}

// ===== 线稿参照图（AI 图生图参考底图）=====
// 改为「单点透视室内草图」：按真实宽/进深/层高比例画房间透视盒，
// 门/窗开在录入的墙面，并标注真实尺寸。模型据此写实景，能锁定比例与门窗位置。
function drawOpening(ctx, wall, geo, isWindow) {
  const { bx, by, bw, bh, Lx, Rx, Ty, By } = geo;
  ctx.strokeStyle = isWindow ? '#1565ff' : '#ff6a00';
  ctx.fillStyle = isWindow ? 'rgba(21,101,255,0.20)' : 'rgba(255,106,0,0.22)';
  ctx.lineWidth = 4;
  let x, y, w, h;
  if (wall === 'left') { w = 30; h = bh * 0.45; x = (bx + Lx) / 2 - w / 2; y = (by + (by + bh)) / 2 - h / 2; }
  else if (wall === 'right') { w = 30; h = bh * 0.45; x = (bx + bw + Rx) / 2 - w / 2; y = (by + (by + bh)) / 2 - h / 2; }
  else if (wall === 'top') { w = bw * 0.4; h = 34; x = bx + bw * 0.3; y = by + 8; }
  else { w = bw * 0.4; h = 34; x = bx + bw * 0.3; y = by + bh - 42; } // bottom(南墙在画面外正对，画在后墙下部示意)
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  if (isWindow) {
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h);
    ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
  } else {
    ctx.beginPath();
    if (wall === 'left') ctx.arc(x, y, w, -Math.PI / 2, 0);
    else if (wall === 'right') ctx.arc(x + w, y, w, -Math.PI, -Math.PI / 2);
    else if (wall === 'top') ctx.arc(x, y + h, h, Math.PI, Math.PI * 1.5);
    else ctx.arc(x + w, y + h, h, Math.PI * 1.5, Math.PI * 2);
    ctx.stroke();
  }
  // 符号内写"窗"/"门"大字（图生图模型对文字最敏感，防止忽略符号）
  ctx.fillStyle = isWindow ? '#0b48b8' : '#c74a00';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(isWindow ? '窗' : '门', x + w / 2, y + h / 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2.4;
}

function drawCompass(ctx, cx, cy, r) {
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy + r * 0.7); ctx.lineTo(cx, cy - r * 0.7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - r * 0.45, cy - r * 0.15); ctx.lineTo(cx, cy - r * 0.7); ctx.lineTo(cx + r * 0.45, cy - r * 0.15); ctx.stroke();
  ctx.fillStyle = '#1a1a1a'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', cx, cy - r - 4); ctx.textAlign = 'left';
}

function drawLinePlan(ctx, space, W, H) {
  const X = Math.round;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

  const wM = (Number(space.w) || 0) / 100;
  const dM = (Number(space.d) || 0) / 100;
  const hM = (Number(space.h) || 0) / 100;
  const name = space.name || '空间';
  const wallCN = { top: '北墙', bottom: '南墙', left: '西墙', right: '东墙' };
  const doorCN = wallCN[space.doorWall] || '东墙';
  const winCN = wallCN[space.winWall] || '北墙';

  // 透视盒：后墙(正视)宽高比 = 房间宽:层高
  const M = 64;
  const Lx = M, Rx = W - M, Ty = M, By = H - M;
  let backW = Math.min(400, W - M * 2);
  const ratio = (wM && hM) ? (wM / hM) : (4 / 3);
  let backH = backW / ratio;
  if (backH > (By - Ty) - 40) { backH = (By - Ty) - 40; backW = backH * ratio; }
  const bx = X((W - backW) / 2);
  const by = X((H - backH) / 2 - 16);
  const bw = X(backW), bh = X(backH);

  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2.4;
  ctx.strokeRect(bx, by, bw, bh);                 // 后墙
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by + bh); ctx.lineTo(Lx, By); ctx.lineTo(Lx, Ty); ctx.closePath(); ctx.stroke(); // 左墙
  ctx.beginPath(); ctx.moveTo(bx + bw, by); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(Rx, By); ctx.lineTo(Rx, Ty); ctx.closePath(); ctx.stroke(); // 右墙
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by); ctx.lineTo(Rx, Ty); ctx.lineTo(Lx, Ty); ctx.closePath(); ctx.stroke(); // 天花
  ctx.beginPath(); ctx.moveTo(bx, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(Rx, By); ctx.lineTo(Lx, By); ctx.closePath(); ctx.stroke(); // 地面

  // 门 / 窗（开在录入的墙面）
  const geo = { bx, by, bw, bh, Lx, Rx, Ty, By };
  drawOpening(ctx, space.doorWall, geo, false);
  drawOpening(ctx, space.winWall, geo, true);

  // 地面透视网格（增强空间感，帮助模型理解比例）
  ctx.strokeStyle = 'rgba(120,120,120,0.35)'; ctx.lineWidth = 0.8;
  const gx = 6, gy = 4;
  for (let i = 1; i < gx; i++) {
    const t = i / gx;
    ctx.beginPath(); ctx.moveTo(bx + bw * t, by + bh); ctx.lineTo(Lx + (Rx - Lx) * t, By); ctx.stroke();
  }
  for (let j = 1; j < gy; j++) {
    const t = j / gy;
    const yF = By - (By - (by + bh)) * t;
    const xl = Lx + (bx - Lx) * t, xr = Rx + (bx + bw - Rx) * t;
    ctx.beginPath(); ctx.moveTo(xl, yF); ctx.lineTo(xr, yF); ctx.stroke();
  }

  // 尺寸标注
  ctx.fillStyle = '#222'; ctx.strokeStyle = '#666'; ctx.lineWidth = 1;
  ctx.font = '22px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('宽 ' + (wM ? wM.toFixed(2) : '?') + ' m', W / 2, H - 22);
  ctx.save(); ctx.translate(W - 22, (Ty + By) / 2); ctx.rotate(Math.PI / 2);
  ctx.fillText('进深 ' + (dM ? dM.toFixed(2) : '?') + ' m', 0, 0); ctx.restore();
  ctx.save(); ctx.translate(24, (Ty + By) / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('层高 ' + (hM ? hM.toFixed(2) : '?') + ' m', 0, 0); ctx.restore();
  ctx.textAlign = 'left';

  // 标题 + 图例
  ctx.fillStyle = '#111'; ctx.font = '26px sans-serif';
  ctx.fillText(name + ' · 透视草图（严格按比例）', M, 38);
  ctx.font = 'bold 18px sans-serif';
  ctx.fillStyle = '#ff6a00';
  ctx.fillText('门: ' + doorCN, M, 62);
  const dw = ctx.measureText('门: ' + doorCN + '   ').width;
  ctx.fillStyle = '#1565ff';
  ctx.fillText('窗: ' + winCN, M + dw, 62);

  // 指北针
  drawCompass(ctx, W - 44, 44, 22);
}

// 小程序包内图标路径表（旧版 canvas drawImage 直接支持包内路径，无需预加载）
const PLAN_ICONS = {
  toilet: '/assets/icons/toilet.png', bed: '/assets/icons/bed.png',
  wardrobe: '/assets/icons/wardrobe.png', counter: '/assets/icons/counter.png',
  sofa: '/assets/icons/sofa.png', stove: '/assets/icons/stove.png',
  washer: '/assets/icons/washer.png', vanity: '/assets/icons/vanity.png',
  desk: '/assets/icons/desk.png', tvcab: '/assets/icons/tvcab.png',
  table: '/assets/icons/table.png', fridge: '/assets/icons/fridge.png',
  shower: '/assets/icons/shower.png'
};

// ===== 实测导出：按与绘制完全相同的布局算法，返回各家具实际摆放尺寸(cm，S=1) =====
// 供估算引擎使用：衣柜/橱柜等工程量按示意图实际布置长度计算，而非默认尺寸。
// 返回 [{id,name,wall,rect:{x,y,w,h}}]，rect 单位 cm；未摆放/无矩形的不返回。
function measureFurniture(space) {
  const on = (space.furniture || []).filter(f => f.on);
  if (!on.length || !space.w || !space.d) return [];
  const rm = { ox: 0, oy: 0, S: 1, Wcm: space.w, Dcm: space.d };
  const items = on.map(f => {
    const s = symOf(f);
    return Object.assign({}, s, { id: f.id, name: f.name });
  });
  const key = (space.key || '').toLowerCase();
  const fn = { kitchen: layoutKitchen, bathroom: layoutBathroom, bedroom: layoutBedroom,
               living: layoutLiving, balcony: layoutBalcony, study: layoutStudy }[key] || layoutGeneric;
  try { fn(items, rm, space); } catch (e) { return []; }
  // 与绘制一致：夹紧不越房间
  items.forEach(it => {
    if (!it.rect) return;
    it.rect.x = Math.min(Math.max(it.rect.x, 0), space.w - it.rect.w);
    it.rect.y = Math.min(Math.max(it.rect.y, 0), space.d - it.rect.h);
  });
  return items.filter(it => it.rect);
}

module.exports = { drawPlan, drawLinePlan, measureFurniture, PLAN_ICONS };
