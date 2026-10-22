// 中文语音/文本解析：空间、尺寸(宽/深/高)、门窗墙位、家具
const CN = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };

function toNumber(token) {
  if (!token) return null;
  token = token.replace(/\s/g, '');
  // 「3米2」「1米5」→ 3.2 / 1.5（ASR 数字+米很常见，不能算成 32/15）
  const mx = token.match(/^([0-9]+)米([0-9]{1,2})$/);
  if (mx) return parseInt(mx[1]) + parseInt(mx[2]) / Math.pow(10, mx[2].length);
  const stripped = token.replace(/[米m]/g, '');
  if (/[0-9]/.test(stripped)) return parseFloat(stripped);
  // 含 点：三点二 -> 3.2
  if (token.indexOf('点') >= 0) {
    const parts = token.split('点');
    const a = CN[parts[0]] != null ? CN[parts[0]] : (parseInt(parts[0]) || 0);
    let bf = 0;
    if (parts[1]) for (const ch of parts[1]) bf = bf * 10 + (CN[ch] != null ? CN[ch] : 0);
    return a + bf / Math.pow(10, String(parts[1] || '').length);
  }
  // 含 米：三米二 -> 3.2，两米 -> 2
  if (/[米m]/.test(token)) {
    const chars = [...stripped];
    if (chars.length === 1) return CN[chars[0]] != null ? CN[chars[0]] : 0;
    const intPart = CN[chars[0]] != null ? CN[chars[0]] : 0;
    let fr = 0;
    for (let i = 1; i < chars.length; i++) fr = fr * 10 + (CN[chars[i]] != null ? CN[chars[i]] : 0);
    return intPart + fr / Math.pow(10, chars.length - 1);
  }
  if (CN[token] != null) return CN[token];
  const m = stripped.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// 解析 "宽三米二 深两米六 高两米六" -> {w,d,h}（厘米）。数值<30 视为米
function parseDims(text) {
  const out = {};
  // 防误伤（2026-09-29 老板反馈：说"门的宽度800"被当成墙长800，整图错位）：
  // 「门宽/窗宽/门的宽度/门洞宽」这类短语先整体剔除，它们是门窗尺寸不是房间尺寸。
  // 门窗尺寸由第二次确认弹层（parseOpenings）负责，这里只管房间宽/深/高。
  const cleaned = text
    // 间隔符不含空格：防止「门宽 宽三米二」把房间宽一起吃掉（跨空格就成「吃掉下一个短句」了）
    .replace(/(?:门窗|门|窗)[^\s，。、！？]{0,2}?(?:宽度|宽|尺寸|大小)\s*[:：是为]?\s*[0-9一二两三四五六七八九十百点米cm\.]+/g, ' ')
    .replace(/[0-9一二两三四五六七八九十百点米cm\.]+\s*[^\s，。、！？]{0,2}?(?:门窗|门|窗)的?\s*(?:宽度|宽|尺寸|大小)/g, ' ');
  // 口语「长X宽Y高Z」——长/深=进深(d)，宽/面宽=面宽(w)，高/层高=层高(h)
  const NUM = '([0-9一二两三四五六七八九十百点米m\\.]+)';
  const map = [
    { word: /(?:宽|面宽)/, key: 'w' },
    { word: /(?:长|深|进深|纵深)/, key: 'd' },
    { word: /(?:高|层高|净高)/, key: 'h' }
  ];
  const norm = raw => {
    const v = toNumber(raw);
    if (v == null) return null;
    return v < 30 ? Math.round(v * 100) : v;   // 数值<30 视为米，转 cm
  };
  map.forEach(({ word, key }) => {
    // 两种语序都支持：「宽三米二」和「三米宽」（在剔除门窗宽短语之后的文本上匹配）
    let m = cleaned.match(new RegExp(word.source + '\\s*' + NUM));
    if (!m) m = cleaned.match(new RegExp(NUM + '\\s*' + word.source));
    if (!m) return;
    const v = norm(m[1]);
    if (v) out[key] = v;
  });
  // 兜底：「厨房3米2米」这种没有关键词的，按顺序当宽、深
  if (!out.w && !out.d) {
    (cleaned.match(/[0-9一二两三四五六七八九十百点]+\s*米/g) || [])
      .map(t => norm(t.replace(/\s*米/g, '')))
      .forEach((v, i) => {
        if (!v || v < 80 || v > 2000) return;
        if (!out.w) out.w = v; else if (!out.d) out.d = v;
      });
  }
  return out;
}

// 门窗宽与定位（距所在墙面左端起算，cm）。未报定位 = 居中；说"居中/中间"也返回 'mid'
function parseOpenings(text) {
  const NUM = '([0-9一二两三四五六七八九十百点米cm\\.]+)';
  const cm = v => (v == null ? null : (v < 30 ? Math.round(v * 100) : Math.round(v)));
  const out = {};
  // 宽：「门宽90」「窗宽1米5」「门 尺寸 90」
  [['doorW', /门/], ['winW', /窗/]].forEach(([key, kind]) => {
    const m = text.match(new RegExp(kind.source + '\\s*(?:宽|尺寸|大小)\\s*[:：是为]?\\s*' + NUM));
    if (m) { const v = cm(toNumber(m[1])); if (v) out[key] = v; }
  });
  // 定位：「门距左端30」「窗离左20」「窗从左边40」
  // 注意：定位是长度不是尺寸——纯数字一律当厘米（不像尺寸那样 <30 当米）
  const cmOff = raw => {
    const v = toNumber(raw);
    if (v == null) return null;
    return /[米m]/.test(raw) ? (v < 30 ? Math.round(v * 100) : Math.round(v)) : Math.round(v);
  };
  const POS = '距|离|从|靠|往', ENDS = '左端|左边|左';
  [['doorOff', /门/], ['winOff', /窗/]].forEach(([key, kind]) => {
    let m = text.match(new RegExp(kind.source + '[^，。、！]{0,8}?(?:' + POS + ')[^，。、！]{0,6}?(?:' + ENDS + ')[^，。、！]{0,4}?(' + NUM + ')'));
    if (!m) m = text.match(new RegExp('(' + NUM + ')\\s*(?:距|离)[^，。、！]{0,4}?(?:' + ENDS + ')[^，。、！]{0,4}?' + kind.source));
    if (m) { const v = cmOff(m[1]); if (v) out[key] = v; }
    // 「居中 / 中间」
    if (out[key] == null && new RegExp(kind.source + '[^，。、！]{0,6}?(?:居中|中间)').test(text)) {
      out[key.replace('Off', 'End')] = 'mid';
    }
  });
  return out;
}

function parseSpaceKey(text) {
  if (/厨房/.test(text)) return 'kitchen';
  if (/卫生|浴室|厕所|马桶/.test(text)) return 'bathroom';
  if (/客厅|客/.test(text)) return 'living';
  if (/卧室|卧|房间/.test(text)) return 'bedroom';
  if (/阳台/.test(text)) return 'balcony';
  if (/书房|书/.test(text)) return 'study';
  return null;
}

// 墙位：北/上->top 南/下->bottom 西/左->left 东/右->right
function parseWall(text, marker) {
  const re = new RegExp(marker + '\\s*(在|靠)?\\s*(左|右|上|下|北|南|东|西)');
  const m = text.match(re);
  if (!m) return null;
  const w = m[2];
  if (/北|上/.test(w)) return 'top';
  if (/南|下/.test(w)) return 'bottom';
  if (/西|左/.test(w)) return 'left';
  if (/东|右/.test(w)) return 'right';
  return null;
}

function parseFurniture(text, furnitureList) {
  const on = {};
  const kw = {
    '橱柜': 'cabinet', '油烟机': 'hood', '灶': 'stove', '冰箱': 'fridge',
    '马桶': 'toilet', '蹲': 'toilet', '浴室柜': 'vanity', '淋浴': 'shower',
    '沙发': 'sofa', '茶几': 'table', '电视': 'tv', '电视柜': 'tvcab',
    '床': 'bed', '衣柜': 'wardrobe', '书桌': 'desk', '书柜': 'bookshelf',
    '洗衣机': 'washer', '晾衣架': 'rack', '阳台柜': 'balcab', '收纳': 'storage'
  };
  Object.keys(kw).forEach(k => { if (text.indexOf(k) >= 0) on[kw[k]] = true; });
  return on;
}

// 解析工程地址：支持「地址：xxx」「工程地址 xxx」「在 xxx小区/路/号…」
function parseAddress(text) {
  let m = text.match(/(?:工程)?地址[：:\s]*(.+)$/);
  if (m) return m[1].trim().replace(/[，。、\s]+$/, '');
  m = text.match(/在\s*([^\s，。、]+?(?:小区|花园|苑|府|城|村|镇|路|街|道|号|栋|单元|室|广场|大厦|公寓)[^\s，。、]*)/);
  if (m) return m[1].trim();
  return '';
}

module.exports = { parseDims, parseSpaceKey, parseWall, parseFurniture, parseAddress, parseOpenings };
