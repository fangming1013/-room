// 效果图生成引擎抽象层（共用同一输入：户型结构 + 家具清单 + 档位风格 + 参考图）
// 模式一 demo：内置示例图（按空间类型映射），无网络依赖，未配置 API 时兜底
// 模式二 api：商业生图 API（快速模式）。配置存 storage 'render_api_cfg'（后台「生图 API」卡片填写）
//   首选阿里云百炼（通义万相）—— 异步任务协议：提交任务 → 轮询 task_id → 拿图 URL
//     wan2.6-image（0.2元/张，支持参考图 base64 直传）：/api/v1/services/aigc/image-generation/generation
//     wanx-v1（0.16元/张，参考图仅收公网 URL，本地参考图暂不传）   ：/api/v1/services/aigc/text2image/image-synthesis
//   另兼容 OpenAI 风格同步接口（响应 {data:[{url}]} / {url} / {images:[...]}）
//   注意：小程序正式发布后需在小程序后台把 dashscope.aliyuncs.com 加入 request 合法域名
// 模式三 comfyui（预留）：自建 ComfyUI+ControlNet+IP-Adapter 精准模式，接通后在此加分支即可。
// 模式四 proxy（2026-10-06 老板定）：走自有代理 backend/img-proxy.js，key 仅存服务端，
//   小程序只调代理域名（PROXY_BASE 在 utils/siliconflow.js 配置），避免 key 进包被盗刷。
const sf = require('./siliconflow.js');
const DEMO_MAP = {
  kitchen: '/assets/renders/kitchen.jpg',
  bathroom: '/assets/renders/bathroom.jpg',
  bedroom: '/assets/renders/bedroom.jpg',
  study: '/assets/renders/study.jpg',
  living: '/assets/renders/living.jpg',
  balcony: '/assets/renders/balcony.jpg'
};

const WALL_CN = { top: '上侧', bottom: '下侧', left: '左侧', right: '右侧' };
const DS_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const POLL_MS = 3000;      // 轮询间隔
const POLL_MAX_MS = 150000; // 最长等待 150s

function getApiCfg() {
  try { return wx.getStorageSync('render_api_cfg') || null; } catch (e) { return null; }
}

function setApiCfg(cfg) {
  wx.setStorageSync('render_api_cfg', cfg || {});
}

// 是否走阿里云百炼（通义万相）：显式 provider / wan 系模型名 / endpoint 含域名，三者任一
function isDashscope(cfg) {
  return cfg.provider === 'dashscope'
    || /^wan/i.test(cfg.model || '')
    || /dashscope\.aliyuncs\.com/i.test(cfg.endpoint || '');
}

// 按模型推导百炼端点（wan2.x 走多模态端点，wanx-v1 走文生图端点）
function dashscopeEndpoint(model) {
  return /^wan2\./.test(model || '')
    ? DS_BASE + '/services/aigc/image-generation/generation'
    : DS_BASE + '/services/aigc/text2image/image-synthesis';
}

function isApiReady() {
  const c = getApiCfg();
  if (!c || !c.apiKey) return false;
  if (isDashscope(c)) return true;          // 百炼有默认模型，endpoint/model 可自动推导
  return !!(c.endpoint);                     // 其他接口必须填完整地址
}

// 把空间状态编译成生图 prompt：户型尺寸 + 门窗位置 + 已选家具 + 档位风格
function buildPrompt(space, tierName) {
  const parts = [];
  parts.push((space.name || '房间') + '，' + space.w + 'cm宽×' + space.d + 'cm深×' + space.h + 'cm高');
  if (space.doorWall) parts.push('门在' + (WALL_CN[space.doorWall] || space.doorWall));
  if (space.winWall) parts.push('窗在' + (WALL_CN[space.winWall] || space.winWall));
  const on = (space.furniture || []).filter(f => f.on).map(f => f.name);
  if (on.length) parts.push('包含家具：' + on.join('、'));
  parts.push((tierName || '经济') + '档主材，现代简约风格，真实感室内照片级渲染，采光充足');
  return parts.join('；');
}

// 主入口：Promise<{ mode:'demo'|'api', url, prompt }>
function renderSpace(space, opts) {
  opts = opts || {};
  const prompt = buildPrompt(space, opts.tierName);
  // 优先走自有代理（key 仅服务端，安全）；PROXY_BASE 为空则跳过
  if (sf.PROXY_BASE) {
    const refs = (opts.refImages || []).slice(0, 3);
    return Promise.all(refs.map(readImageAsData)).then(imgs => {
      const firstImg = imgs.filter(Boolean)[0] || null;   // 代理当前取首张参考图做风格迁移
      return sf.genImage({ model: opts.model || 'Kwai-Kolors/Kolors', prompt, imageBase64: firstImg })
        .then(url => ({ mode: 'api', url, prompt }))
        .catch(err => { console.error('[proxy 生图失败]', err); throw err; });
    });
  }
  if (isApiReady()) return callApi(getApiCfg(), prompt, opts).then(url => ({ mode: 'api', url, prompt }));
  // demo 模式：短延迟模拟生成过程，返回内置示例图
  return new Promise(resolve => {
    setTimeout(() => resolve({ mode: 'demo', url: DEMO_MAP[space.key] || DEMO_MAP.living, prompt }), 400);
  });
}

// ===== 通用：从各种响应格式里抠图 URL =====
function extractUrl(d) {
  if (!d) return null;
  const results = (d.output && d.output.results) || d.results || null;   // 百炼任务结果 / 直接传 output 对象
  if (Array.isArray(results) && results[0]) return results[0].url || null;
  if (Array.isArray(d.data) && d.data[0]) return d.data[0].url || (d.data[0].b64_json ? 'data:image/png;base64,' + d.data[0].b64_json : null);
  if (d.url) return d.url;
  if (Array.isArray(d.images) && d.images[0]) return d.images[0];
  return null;
}

// ===== 本地参考图 → base64 dataURI（读不到就跳过该张，不阻塞生成）=====
function readImageAsData(p) {
  return new Promise(resolve => {
    try {
      wx.getFileSystemManager().readFile({
        filePath: p,
        encoding: 'base64',
        success: r => resolve('data:image/jpeg;base64,' + r.data),
        fail: () => resolve(null)
      });
    } catch (e) { resolve(null); }
  });
}

// ===== 百炼：按模型组装请求体（wan2.x 多模态可带参考图；wanx-v1 纯文生图）=====
function buildDashscopeBody(cfg, prompt, refImages) {
  const model = cfg.model || 'wan2.6-image';
  const parameters = { n: 1 };
  if (cfg.size) parameters.size = cfg.size;
  if (/^wan2\./.test(model)) {
    const content = [{ text: prompt }];
    const refs = (refImages || []).slice(0, 3);   // 与页面参考图上限一致
    return Promise.all(refs.map(readImageAsData)).then(imgs => {
      imgs.filter(Boolean).forEach(d => content.push({ image: d }));
      return { endpoint: dashscopeEndpoint(model), body: { model: model, input: { messages: [{ role: 'user', content: content }] }, parameters: parameters } };
    });
  }
  // wanx-v1：ref_image 仅收公网 URL，本地临时文件传不了 → 纯文生图
  return Promise.resolve({ endpoint: dashscopeEndpoint(model), body: { model: model, input: { prompt: prompt }, parameters: parameters } });
}

// ===== 百炼：提交任务。同步出图直接 resolve(url)；异步任务 resolve('__task__<id>') =====
function submitTask(cfg, endpoint, body) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: endpoint,
      method: 'POST',
      timeout: 30000,
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey,
        'X-DashScope-Async': 'enable'
      },
      data: body,
      success(res) {
        const d = res.data || {};
        const sync = extractUrl(d);
        if (sync) return resolve(sync);
        const tid = (d.output || {}).task_id;
        if (tid) return resolve('__task__' + tid);
        reject(new Error('提交生图任务失败：' + JSON.stringify(d).slice(0, 160)));
      },
      fail(err) { reject(new Error(err.errMsg || '网络请求失败')); }
    });
  });
}

// ===== 百炼：按 task_id 轮询结果（3s 一次，最长 150s）=====
function pollTask(cfg, taskId, start) {
  start = start || Date.now();
  return new Promise((resolve, reject) => {
    wx.request({
      url: DS_BASE + '/tasks/' + taskId,
      timeout: 15000,
      header: { 'Authorization': 'Bearer ' + cfg.apiKey },
      success(res) {
        const out = res.data && res.data.output ? res.data.output : {};
        const st = out.task_status;
        if (st === 'SUCCEEDED') {
          const url = extractUrl(out);
          if (url) resolve(url);
          else reject(new Error('任务完成但未返回图片：' + JSON.stringify(out).slice(0, 120)));
        } else if (st === 'FAILED' || st === 'CANCELED' || st === 'UNKNOWN') {
          reject(new Error('生图任务' + st + '：' + JSON.stringify(out).slice(0, 140)));
        } else if (Date.now() - start > POLL_MAX_MS) {
          reject(new Error('生图等待超时（>' + Math.round(POLL_MAX_MS / 1000) + 's），请重试'));
        } else {
          setTimeout(() => pollTask(cfg, taskId, start).then(resolve, reject), POLL_MS);
        }
      },
      fail(err) {
        if (Date.now() - start > POLL_MAX_MS) reject(new Error(err.errMsg || '查询生图结果失败'));
        else setTimeout(() => pollTask(cfg, taskId, start).then(resolve, reject), POLL_MS);
      }
    });
  });
}

// ===== OpenAI 风格同步接口（旧路径，保持兼容）=====
function openaiSync(cfg, prompt, opts) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: cfg.endpoint,
      method: 'POST',
      header: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      data: {
        model: cfg.model || '',
        prompt: prompt,
        ref_images: opts.refImages || [],
        size: cfg.size || '1024x1024',
        n: 1
      },
      timeout: 90000,
      success(res) {
        const url = extractUrl(res.data);
        if (url) resolve(url);
        else reject(new Error('API 返回格式无法解析：' + JSON.stringify(res.data).slice(0, 120)));
      },
      fail(err) { reject(new Error(err.errMsg || '网络请求失败')); }
    });
  });
}

// ===== 商业 API 调用总入口 =====
function callApi(cfg, prompt, opts) {
  opts = opts || {};
  if (isDashscope(cfg)) {
    return buildDashscopeBody(cfg, prompt, opts.refImages)
      .then(r => submitTask(cfg, r.endpoint, r.body))
      .then(first => {
        if (typeof first === 'string' && first.indexOf('__task__') === 0) return pollTask(cfg, first.slice(8));
        return first;
      });
  }
  return openaiSync(cfg, prompt, opts);
}

module.exports = { renderSpace, buildPrompt, getApiCfg, setApiCfg, isApiReady, isDashscope, dashscopeEndpoint, extractUrl, DEMO_MAP };
