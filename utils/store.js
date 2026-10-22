// 本地存储：客户注册信息 + 每次生成的报价历史（便于后期查看）
const USER_KEY = 'user_v1';
const HISTORY_KEY = 'quote_history_v1';

// ===== 客户注册 =====
function getUser() {
  try { return wx.getStorageSync(USER_KEY) || null; } catch (e) { return null; }
}
function setUser(u) {
  try { wx.setStorageSync(USER_KEY, u); } catch (e) {}
  return u;
}
function logout() {
  try { wx.removeStorageSync(USER_KEY); } catch (e) {}
}

// ===== 报价历史（每次生成存一条）=====
function getHistory() {
  try { return wx.getStorageSync(HISTORY_KEY) || []; } catch (e) { return []; }
}
function addHistory(rec) {
  const list = getHistory();
  list.unshift(Object.assign({ id: 'h' + Date.now(), time: Date.now() }, rec));
  if (list.length > 50) list.length = 50; // 最多保留 50 条
  try { wx.setStorageSync(HISTORY_KEY, list); } catch (e) {}
  return list;
}
function clearHistory() {
  try { wx.setStorageSync(HISTORY_KEY, []); } catch (e) {}
}
// 删除单条历史（单个空间预算）
function deleteHistory(id) {
  const list = getHistory().filter(r => r.id !== id);
  try { wx.setStorageSync(HISTORY_KEY, list); } catch (e) {}
  return list;
}
// 按 id 更新一条历史（编辑后回写，保留原 time/id）
function updateHistory(id, patch) {
  const list = getHistory();
  const i = list.findIndex(r => r.id === id);
  if (i >= 0) {
    list[i] = Object.assign({}, list[i], patch);
    try { wx.setStorageSync(HISTORY_KEY, list); } catch (e) {}
  }
  return list;
}

// ===== 客资（留资线索，本机版）=====
// D-006：小程序漏斗最后一步收电话。后端只负责换手机号（无状态），线索落本机，避免后端重启丢数据。
const LEADS_KEY = 'leads_v1';
function getLeads() {
  try { return wx.getStorageSync(LEADS_KEY) || []; } catch (e) { return []; }
}
function addLead(lead) {
  const list = getLeads();
  // 同一手机号只保留最新一条，避免重复授权产生垃圾数据
  const i = list.findIndex(x => x.phone && x.phone === lead.phone);
  if (i >= 0) list.splice(i, 1);
  list.unshift(lead);
  if (list.length > 200) list.length = 200;   // 控制 storage 体积
  try { wx.setStorageSync(LEADS_KEY, list); } catch (e) {}
  return list;
}
function deleteLead(id) {
  const list = getLeads().filter(x => x.id !== id);
  try { wx.setStorageSync(LEADS_KEY, list); } catch (e) {}
  return list;
}
function clearLeads() {
  try { wx.setStorageSync(LEADS_KEY, []); } catch (e) {}
}

module.exports = { getUser, setUser, logout, getHistory, addHistory, updateHistory, clearHistory, deleteHistory,
  getProjects, upsertProject, deleteProject, clearProjects,
  getLeads, addLead, deleteLead, clearLeads };

// ===== 项目记录（单次项目合计：1空间+辅助 或 多空间+辅助，按 project.id 去重）=====
const PROJECT_KEY = 'quote_projects_v1';
function getProjects() {
  try { return wx.getStorageSync(PROJECT_KEY) || []; } catch (e) { return []; }
}
function upsertProject(proj) {
  const list = getProjects();
  const i = list.findIndex(p => p.id === proj.id);
  if (i >= 0) list[i] = Object.assign({}, list[i], proj);
  else list.unshift(Object.assign({ time: Date.now() }, proj));
  if (list.length > 50) list.length = 50;
  try { wx.setStorageSync(PROJECT_KEY, list); } catch (e) {}
  return list;
}
function deleteProject(id) {
  const list = getProjects().filter(p => p.id !== id);
  try { wx.setStorageSync(PROJECT_KEY, list); } catch (e) {}
  return list;
}
function clearProjects() {
  try { wx.setStorageSync(PROJECT_KEY, []); } catch (e) {}
}
