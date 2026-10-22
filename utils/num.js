// 工程量小数处理：统一保留 1 位小数
function round1(n) {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  return Math.round(v * 10) / 10;
}
function fmt1(n) {
  return (Number(n) || 0).toFixed(1);
}
module.exports = { round1, fmt1 };
