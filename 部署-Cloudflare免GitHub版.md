# 部署后端（免 GitHub 版 · Cloudflare Workers）

不用 GitHub、不用 git 推送。只要注册一个 Cloudflare 账号（一个网站），代码我已经改成 `backend/worker.js`，你最后敲一条命令就上线。

## 前置：本机要有 Node.js
微信开发者工具自带 Node，命令行里敲 `node -v` 能显示版本即可（需 16 以上）。

---

## 步骤 1：注册 Cloudflare（一个账号，国内一般能打开）
1. 浏览器打开 https://dash.cloudflare.com/sign-up
2. 用邮箱注册（收一封验证邮件点一下）
3. 登录后进入控制台

> 如果 Cloudflare 也打不开/掉线，告诉我，我换 **Gitee + 国内云** 方案。

## 步骤 2：拿 API Token（部署时要用的"钥匙"）
1. 控制台右上角头像 → **My Profile** → **API Tokens**
2. 点 **Create Token** → 选模板 **Edit Cloudflare Workers** → 一路 **Continue to summary** → **Create Token**
3. **复制**那串 token（只显示一次，先存记事本）

## 步骤 3：注册 workers.dev 子域名（一次性的）
1. 控制台左侧 **Workers & Pages**
2. 右侧找到 **Your subdomain**，点 **Set up / Change**，填一个前缀（如 `roommini`）
3. 保存后你的地址会变成 `roommini.workers.dev`（前缀你自己定）

## 步骤 4：在本机 backend 目录运行命令
打开命令行（Git Bash 或开发者工具终端），依次敲：
```
cd "C:\Users\HUAWEI\WorkBuddy\2026-09-05-14-49-44\room-mini\backend"
npx wrangler login
```
`npx wrangler login` 会弹浏览器让你登录 Cloudflare，登录完关掉即可。
（若不想弹浏览器，改用环境变量：`set CLOUDFLARE_API_TOKEN=你的token` 和 `set CLOUDFLARE_ACCOUNT_ID=你的账户ID`，账户 ID 在步骤2的 API Tokens 页面或控制台右下角能看到。）

然后设置硅基流动密钥（生图必须）：
```
npx wrangler secret put SILICONFLOW_API_KEY
```
提示输入时，粘贴你的 `sk-xxx`（从 siliconflow.cn 拿），回车。

## 步骤 5：部署
```
npx wrangler deploy
```
成功的标志：终端最后一行打印出 `https://room-mini-proxy.<你的子域>.workers.dev`
**复制这个地址**。

> 想先免注册试跑 60 分钟，可改用：`npx wrangler deploy --temporary`
> 会直接给一个临时地址，不用登录，但 60 分钟后失效。适合先验证"生成"能不能出图。

## 步骤 6：把地址填进小程序
打开 `utils/siliconflow.js`，把第 8 行：
```js
const PROXY_BASE = '';
```
改成（**不要带末尾斜杠**）：
```js
const PROXY_BASE = 'https://room-mini-proxy.<你的子域>.workers.dev';
```

## 步骤 7：微信开发者工具里加白名单（测试用）
微信开发者工具 → 右上角 **详情** → **本地设置** → 勾选 **"不校验合法域名、TLS 版本以及 HTTPS 证书"**。
（正式发布前需把这个 `xxx.workers.dev` 域名做 ICP 备案，或绑一个已备案的自定义域名；测试阶段勾上面那项即可。）

## 步骤 8：真机/模拟器验证
小程序里选风格 → 上传现场照片（或直接生成）→ 点生成，应返回真实效果图。

---

## 微信支付正式收费（等商户号下来再做）
1. 去 pay.weixin.qq.com 用营业执照入驻，拿到商户号 + 证书（PKCS#8 格式私钥）+ 序列号 + APIv3 Key
2. 在 backend 目录依次：
```
npx wrangler secret put WX_APP_SECRET
npx wrangler secret put WX_MCH_ID
npx wrangler secret put WX_API_V3_KEY
npx wrangler secret put WX_CERT_SERIAL
npx wrangler secret put WX_PRIVATE_KEY      # 须 PKCS#8：openssl pkcs8 -topk8 -nocrypt -in apiclient_key.pem -out key_pkcs8.pem
npx wrangler secret put WX_NOTIFY_URL
npx wrangler deploy
```
3. 把 `utils/siliconflow.js` 的 `PAY_ENABLED` 改成 `true`
4. 真机付 2.99 元验证

---

## 和旧版（Render + GitHub）的关系
- `backend/img-proxy.js` 仍保留，那是给 Render + GitHub 用的。本方案用 `worker.js`，**二选一**，互不干扰。
- 选了 Cloudflare 这条路，就完全不用碰 GitHub 了。
