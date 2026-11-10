#!/usr/bin/env node
'use strict';

/**
 * Epic Games 每周免费游戏 —— 本地自动领取 + 邮件通知
 *
 * 设计思路：
 *   1. 用你电脑上已有的 Edge / Chrome（不下载额外浏览器），配一个专属的持久化用户目录。
 *   2. 第一次用 `node claim.js --login` 手动登录一次 Epic，登录状态长期保存在 browser-profile 里。
 *   3. 之后每次运行都复用这个登录状态，去免费游戏页面点「获取 -> 添加到库」。
 *   4. 结果写日志 + 发邮件。登录失效时会自动弹出浏览器让你重新登录，然后继续领。
 *
 * 常用命令：
 *   node claim.js --login        首次登录（会打开浏览器，登录完直接关掉浏览器窗口）
 *   node claim.js                立即领取一次
 *   node claim.js --list         只列出本周免费游戏，不领取
 *   node claim.js --check        体检：只检查能不能找到「获取」按钮，不点击、不改账号
 *   node claim.js --debug        出问题时用，会保存页面截图和 HTML 方便排查
 *   node claim.js --test-email   测试邮件配置
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIRS = {
  logs: path.join(ROOT, 'logs'),
  shots: path.join(ROOT, 'screenshots'),
  profile: path.join(ROOT, 'browser-profile'),
};
for (const d of Object.values(DIRS)) {
  fs.mkdirSync(d, { recursive: true });
}

// ---------------------------------------------------------------------------
// 命令行参数
// ---------------------------------------------------------------------------
const ARGS = process.argv.slice(2);
const FLAG = (n) => ARGS.includes(n);
const OPT = {
  login: FLAG('--login'),
  testEmail: FLAG('--test-email'),
  debug: FLAG('--debug'),
  headed: FLAG('--headed'),
  listOnly: FLAG('--list'),
  check: FLAG('--check'),
  noEmail: FLAG('--no-email'),
};

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  locale: 'zh-CN',
  country: 'CN',
  browser: {
    // msedge = 用系统自带的 Edge；chrome = 用 Chrome；留空 = 下载独立 Chromium
    channel: 'msedge',
    // 【必须保持 false】实测：Epic 的风控会永久拦截无界面浏览器，页面卡在"安全检查"过不去。
    // 有界面模式 3 秒就能放行。
    headless: false,
    // 有界面，但把浏览器窗口挪到屏幕外，不打扰你正常用电脑
    hideWindow: true,
    slowMo: 0,
  },
  // 登录失效时自动弹出浏览器让你重新登录
  autoLoginWhenExpired: true,
  // 自动登录等待时长（分钟）
  loginWaitMinutes: 10,
  // 领取动作之间的间隔（毫秒），别设太小
  stepDelayMs: 1500,
  // 领取成功后停留秒数（弹窗模式下方便你看结果），0 = 立即关闭
  keepOpenSeconds: 0,
  email: {
    enabled: false,
    smtpHost: 'smtp.qq.com',
    smtpPort: 465,
    secure: true,
    user: 'your@qq.com',
    // QQ/163 邮箱这里要填「授权码」，不是你登录邮箱的密码
    pass: '',
    from: '',
    to: '',
    // 即使没有变化也发邮件（false = 只有领到东西或出错才发）
    always: false,
  },
};

const CONFIG_FILE = path.join(ROOT, 'config.json');

function loadConfig() {
  let user = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
      console.error('config.json 解析失败，将使用默认配置：' + e.message);
    }
  }
  const cfg = {
    ...DEFAULT_CONFIG,
    ...user,
    browser: { ...DEFAULT_CONFIG.browser, ...(user.browser || {}) },
    email: { ...DEFAULT_CONFIG.email, ...(user.email || {}) },
  };
  return cfg;
}

const cfg = loadConfig();

// ---------------------------------------------------------------------------
// 日志
// ---------------------------------------------------------------------------
const stamp = () => new Date().toLocaleString('zh-CN', { hour12: false });
const logFile = path.join(DIRS.logs, `claim-${new Date().toISOString().slice(0, 10)}.log`);
const collected = [];

function log(msg, level = 'info') {
  const line = `[${stamp()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(logFile, line + '\r\n', 'utf8');
  } catch {}
}
const info = (m) => log('  ' + m);
const good = (m) => log('  ✅ ' + m);
const warn = (m) => log('  ⚠️  ' + m);
const bad = (m) => log('  ❌ ' + m);

// ---------------------------------------------------------------------------
// 浏览器
// ---------------------------------------------------------------------------
function requirePlaywright() {
  try {
    return require('playwright-core');
  } catch {
    console.error('');
    console.error('找不到 playwright-core。请先在当前文件夹执行：');
    console.error('    npm install');
    console.error('（或者直接双击「1-安装.bat」）');
    process.exit(1);
  }
}

async function launchBrowser(headless, forceVisible = false) {
  const { chromium } = requirePlaywright();
  const wanted = cfg.browser.channel;
  const candidates = [];
  if (wanted) candidates.push(wanted);
  for (const c of ['msedge', 'chrome']) if (!candidates.includes(c)) candidates.push(c);
  if (!candidates.length) candidates.push('msedge');
  // 说明：本工具只用系统已安装的 Edge / Chrome，刻意不回退到"自动下载 Chromium"，
  // 因为那会多下载一百多 MB，而且无界面 Chromium 本来就会被 Epic 风控拦截。

  const hide = !headless && cfg.browser.hideWindow && !forceVisible;
  const args = hide
    ? ['--window-position=-32000,-32000', '--window-size=1440,900', '--disable-blink-features=AutomationControlled']
    : ['--start-maximized', '--disable-blink-features=AutomationControlled'];

  const failures = [];
  for (const channel of candidates) {
    try {
      const ctx = await chromium.launchPersistentContext(DIRS.profile, {
        headless,
        channel,
        viewport: headless || hide ? { width: 1440, height: 900 } : null,
        locale: 'zh-CN',
        slowMo: cfg.browser.slowMo || 0,
        args,
        acceptDownloads: false,
      });
      const mode = headless ? '无界面' : hide ? '后台（窗口在屏幕外）' : '有界面';
      info(`已启动浏览器：${channel}（${mode}）`);
      return ctx;
    } catch (e) {
      failures.push({ channel, msg: String((e && e.message) || e).split('\n')[0] });
    }
  }

  const details = failures.map((f) => `  · ${f.channel}：${f.msg}`).join('\n');
  const busy = failures.some((f) =>
    /ProcessSingleton|SingletonLock|already running|正在使用|user data directory is already in use/i.test(f.msg)
  );
  throw new Error(
    (busy
      ? '这个专属浏览器正被另一个程序占用（多半是上一次的领取还没跑完）。\n' +
        '请把弹出的浏览器窗口全部关掉，等几秒再重试。\n\n'
      : '无法启动浏览器。请确认已安装 Microsoft Edge 或 Google Chrome（本工具不会额外下载浏览器）。\n\n') +
      details
  );
}

async function newPage(ctx) {
  const pages = ctx.pages();
  const page = pages.length ? pages[0] : await ctx.newPage();
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(90000);
  return page;
}

async function shot(page, name) {
  try {
    const p = path.join(DIRS.shots, `${Date.now()}-${name}.png`);
    await page.screenshot({ path: p, fullPage: false });
    info(`已保存截图：${p}`);
  } catch {}
}

async function dumpHtml(page, name) {
  try {
    const p = path.join(DIRS.shots, `${Date.now()}-${name}.html`);
    fs.writeFileSync(p, await page.content(), 'utf8');
    info(`已保存页面源码：${p}`);
  } catch {}
}

// ---------------------------------------------------------------------------
// 页面小工具
// ---------------------------------------------------------------------------
async function clickByTexts(page, texts, timeout = 6000, dryRun = false) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const handle = await page.evaluateHandle((wanted) => {
      const selectors = 'button, a, [role="button"], input[type="submit"], input[type="button"]';
      const nodes = Array.from(document.querySelectorAll(selectors));
      const visible = (el) => {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      const textOf = (el) =>
        (el.innerText || el.value || el.getAttribute('aria-label') || '')
          .replace(/\s+/g, ' ')
          .trim();
      const pool = nodes.filter((el) => !el.disabled && visible(el));
      // 先精确匹配，再包含匹配，避免误点
      for (const want of wanted) {
        const hit = pool.find((el) => textOf(el) === want);
        if (hit) return hit;
      }
      for (const want of wanted) {
        const hit = pool.find((el) => textOf(el).includes(want));
        if (hit) return hit;
      }
      return null;
    }, texts);

    const el = handle.asElement();
    if (el) {
      if (dryRun) {
        const t = await el.innerText().catch(() => '');
        info(`找到按钮：「${(t || '').trim()}」`);
        await handle.dispose().catch(() => {});
        return true;
      }
      try {
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await el.click({ timeout: 5000 });
        return true;
      } catch {}
    }
    await handle.dispose().catch(() => {});
    await page.waitForTimeout(400);
  }
  return false;
}

async function bodyText(page) {
  try {
    return await page.evaluate(() => document.body ? document.body.innerText : '');
  } catch {
    return '';
  }
}

async function hasAnyText(page, texts) {
  const t = await bodyText(page);
  return texts.some((x) => t.includes(x));
}

async function dismissCookieBanner(page) {
  await clickByTexts(
    page,
    ['全部接受', '接受全部', '接受', '同意', 'Accept All', 'Accept all', 'Accept', 'I Accept'],
    2500
  );
}

async function describeButtons(page) {
  try {
    const list = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, a[role="button"], [role="button"]'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 1 && r.height > 1;
        })
        .map((el) => (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 40)
    );
    info('页面上的按钮文字：' + JSON.stringify([...new Set(list)]));
  } catch {}
}

// ---------------------------------------------------------------------------
// 风控拦截检测
// 实测：Epic 会对自动化浏览器返回一个"安全检查"过渡页，必须等它自己放行。
// ---------------------------------------------------------------------------
const SECURITY_MARKS = [
  '请完成安全检查',
  '安全检查以继续',
  '再进行一步操作',
  'Just a moment',
  'Checking your browser',
  'Verify you are human',
  '正在验证',
];

async function pageState(page) {
  const text = await bodyText(page);
  const title = await page.title().catch(() => '');
  const security =
    SECURITY_MARKS.some((m) => text.includes(m) || title.includes(m)) ||
    /请稍候|Just a moment|Checking/i.test(title);
  return { text, title, security, ready: text.length > 400 && !security };
}

async function waitForPageReady(page, ms = 60000) {
  const deadline = Date.now() + ms;
  let state = { security: false, ready: false, text: '', title: '' };
  while (Date.now() < deadline) {
    state = await pageState(page);
    if (state.ready) return state;
    await page.waitForTimeout(2500);
  }
  return state;
}

// ---------------------------------------------------------------------------
// 登录状态
// ---------------------------------------------------------------------------
const ACCOUNT_URL = 'https://www.epicgames.com/account/personal';

async function isLoggedIn(page) {
  try {
    await page.goto(ACCOUNT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const u = page.url();
    if (/\/id\/login|\/id\/register|\/login\?/.test(u)) return false;
    if (/account/.test(u)) return true;
    const t = await bodyText(page);
    if (/登录|Sign In|Sign in/.test(t) && !/退出登录|Sign Out|账号/.test(t)) return false;
    return true;
  } catch {
    return false;
  }
}

const LOGIN_URL = 'https://www.epicgames.com/id/login?lang=zh-CN';

/**
 * 不额外打开标签页的登录检查。
 * browserContext.request 会复用浏览器里的 Cookie，所以既能判断登录状态，又不会干扰你正在操作的页面。
 */
async function isLoggedInViaRequest(ctx) {
  try {
    const res = await ctx.request.get(ACCOUNT_URL, { maxRedirects: 10, timeout: 30000 });
    const u = res.url();
    if (/\/id\/login|\/id\/register/.test(u)) return false;
    if (/account/.test(u)) return true;
    return res.ok();
  } catch {
    return false;
  }
}

async function waitForManualLogin(ctx, page, minutes) {
  const deadline = Date.now() + minutes * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 7000));
    if (await isLoggedInViaRequest(ctx)) return true;
    // 兜底：登录页已经跳到别的地方去了，通常说明登录成功
    const u = page.url();
    if (/epicgames\.com/.test(u) && !/\/id\//.test(u)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 免费游戏列表
// ---------------------------------------------------------------------------
const FREE_API = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions';

function pickSlug(el) {
  const candidates = [];
  for (const m of el.offerMappings || []) {
    if (m && m.pageSlug) candidates.push(m.pageSlug);
  }
  if (el.productSlug) candidates.push(el.productSlug);
  if (el.urlSlug) candidates.push(el.urlSlug);
  for (let c of candidates) {
    c = String(c).split('/')[0].trim();
    if (c && c !== 'undefined') return c;
  }
  return null;
}

async function fetchFreeGames() {
  const url =
    `${FREE_API}?locale=${encodeURIComponent(cfg.locale)}` +
    `&country=${encodeURIComponent(cfg.country)}` +
    `&allowCountries=${encodeURIComponent(cfg.country)}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`免费游戏接口返回 HTTP ${res.status}`);

  const json = await res.json();
  const elements = json && json.data && json.data.Catalog && json.data.Catalog.searchStore
    ? json.data.Catalog.searchStore.elements || []
    : [];

  const now = [];
  const upcoming = [];
  for (const el of elements) {
    const promos = el.promotions || {};
    const cur = promos.promotionalOffers && promos.promotionalOffers[0] && promos.promotionalOffers[0].promotionalOffers
      ? promos.promotionalOffers[0].promotionalOffers[0]
      : null;
    const next = promos.upcomingPromotionalOffers && promos.upcomingPromotionalOffers[0] && promos.upcomingPromotionalOffers[0].promotionalOffers
      ? promos.upcomingPromotionalOffers[0].promotionalOffers[0]
      : null;

    if (cur && cur.discountSetting && cur.discountSetting.discountPercentage === 0) {
      now.push({ title: el.title, slug: pickSlug(el) });
    } else if (next) {
      upcoming.push({ title: el.title, slug: pickSlug(el) });
    }
  }
  return { now, upcoming };
}

// ---------------------------------------------------------------------------
// 领取
// ---------------------------------------------------------------------------
const OWNED_MARKS = ['已在库中', '已在您的库中', '已拥有', 'In Library', 'In your library', 'Already in your library'];
const DONE_MARKS = ['谢谢', '感谢', 'Thank you', '已添加到库', '已添加至库', '添加到库成功', 'Success', '成功'];

function productUrl(slug) {
  return `https://store.epicgames.com/${cfg.locale}/p/${slug}`;
}

async function productOwned(page) {
  return hasAnyText(page, OWNED_MARKS);
}

/**
 * 在商品页上找到并点击「获取」按钮。
 * 实测（2026-10 验证）：Epic 商品页的领取按钮没有稳定的 data-testid，
 * 真正的按钮就是文字「获取」，所以按文字找是主路径，testid 只作为兜底。
 */
async function clickGetButton(page, dryRun = false) {
  if (await hasAnyText(page, OWNED_MARKS)) return 'owned';

  const texts = ['获取', '立即获取', '免费获取', '添加到库', '加入库', 'Get', 'Add to library', 'Get for free'];
  if (await clickByTexts(page, texts, dryRun ? 12000 : 12000, dryRun)) return dryRun ? 'found' : 'clicked';

  // 兜底：万一 Epic 以后又给按钮加上了 testid
  const selectors = [
    'button[data-testid="purchase-cta-button"]',
    'button[data-testid="addToCart"]',
    'button[data-testid="add-to-cart"]',
  ];
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (!el) continue;
    try {
      const txt = ((await el.innerText()) || '').trim();
      if (OWNED_MARKS.some((m) => txt.includes(m))) return 'owned';
      if (dryRun) {
        info(`找到按钮（testid 兜底）：${txt || sel}`);
        return 'found';
      }
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ timeout: 8000 });
      info(`点击了按钮：${txt || sel}`);
      return 'clicked';
    } catch {}
  }
  return 'notfound';
}

/** 点击弹窗里的确认按钮 */
async function confirmDialog(page, ms = 20000) {
  const confirms = [
    '添加到库', '加入库', '下订单', '确认订单', '确认', '确定', '继续', '同意', '接受',
    'Add to library', 'Add to Library', 'Place Order', 'Confirm', 'Continue', 'Agree', 'Accept', 'Yes',
  ];
  const deadline = Date.now() + ms;
  let clickedAny = false;
  while (Date.now() < deadline) {
    // 只勾弹窗里的协议勾选框。限定在对话框内，避免误勾"订阅营销邮件"之类的选项
    try {
      const boxes = await page.$$(
        '[role="dialog"] input[type="checkbox"]:not(:checked), [aria-modal="true"] input[type="checkbox"]:not(:checked)'
      );
      for (const b of boxes) {
        if (await b.isVisible().catch(() => false)) {
          await b.check({ timeout: 1500 }).catch(() => {});
        }
      }
    } catch {}

    if (await clickByTexts(page, confirms, 1500)) {
      clickedAny = true;
      await page.waitForTimeout(cfg.stepDelayMs);
      if (await hasAnyText(page, DONE_MARKS)) return true;
      continue;
    }
    if (await hasAnyText(page, DONE_MARKS)) return true;
    await page.waitForTimeout(1000);
  }
  return clickedAny;
}

async function claimOne(page, game) {
  const url = productUrl(game.slug);
  info(`→ ${game.title}`);
  info(`  ${url}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  } catch (e) {
    bad(`页面打开失败：${e.message}`);
    return { game, status: 'failed', reason: '页面打开超时' };
  }
  const st = await waitForPageReady(page, 60000);
  if (st.security && !st.ready) {
    bad('被 Epic 的安全检查拦住了。');
    await shot(page, 'security-check-' + game.slug);
    return {
      game,
      status: 'failed',
      reason: '被 Epic 安全检查拦截。用「2-立即领取(显示窗口).bat」跑一次，在弹出的窗口里手动通过验证即可。',
    };
  }
  if (!st.ready) await page.waitForTimeout(cfg.stepDelayMs + 2000);
  await dismissCookieBanner(page);

  if (await productOwned(page)) {
    info('  已经在库里了，跳过');
    return { game, status: 'owned' };
  }

  const r = await clickGetButton(page);
  if (r === 'owned') {
    info('  已经在库里了，跳过');
    return { game, status: 'owned' };
  }
  if (r === 'notfound') {
    if (OPT.debug) {
      await describeButtons(page);
      await dumpHtml(page, 'cta-notfound-' + game.slug);
    }
    await shot(page, 'cta-notfound-' + game.slug);
    return { game, status: 'failed', reason: '页面上找不到「获取」按钮' };
  }

  await page.waitForTimeout(cfg.stepDelayMs + 1500);
  await confirmDialog(page, 25000);
  await page.waitForTimeout(cfg.stepDelayMs);

  if (await hasAnyText(page, DONE_MARKS) || (await productOwned(page))) {
    good(`领取成功：${game.title}`);
    return { game, status: 'claimed' };
  }

  // 有些情况点击后只是把商品放进购物车，需要再走一次结算
  if (/\/cart|checkout/.test(page.url())) {
    info('  进入结算页，尝试完成下单…');
    await clickByTexts(page, ['下订单', '确认订单', 'Place Order', 'Checkout', '继续', 'Continue'], 10000);
    await page.waitForTimeout(cfg.stepDelayMs + 2000);
    if (await hasAnyText(page, DONE_MARKS)) {
      good(`领取成功：${game.title}`);
      return { game, status: 'claimed' };
    }
  }

  if (OPT.debug) {
    await describeButtons(page);
    await dumpHtml(page, 'claim-unknown-' + game.slug);
  }
  await shot(page, 'claim-unknown-' + game.slug);
  return { game, status: 'unknown', reason: '没有看到明确的成功提示，请打开截图确认' };
}

// ---------------------------------------------------------------------------
// 邮件
// ---------------------------------------------------------------------------
function buildReport(results, startedAt) {
  const claimed = results.filter((r) => r.status === 'claimed');
  const owned = results.filter((r) => r.status === 'owned');
  const failed = results.filter((r) => r.status === 'failed' || r.status === 'unknown');

  const lines = [];
  lines.push(`运行时间：${startedAt.toLocaleString('zh-CN', { hour12: false })}`);
  lines.push(`本周免费游戏：${results.length} 个`);
  lines.push(`新领取成功：${claimed.length} 个`);
  lines.push(`此前已拥有：${owned.length} 个`);
  lines.push(`需要处理：${failed.length} 个`);
  lines.push('');
  if (claimed.length) {
    lines.push('【本次新领到】');
    for (const r of claimed) lines.push(`  · ${r.game.title}`);
    lines.push('');
  }
  if (owned.length) {
    lines.push('【早已在库】');
    for (const r of owned) lines.push(`  · ${r.game.title}`);
    lines.push('');
  }
  if (failed.length) {
    lines.push('【没搞定的】');
    for (const r of failed) lines.push(`  · ${r.game.title} —— ${r.reason || '未知原因'}`);
    lines.push('');
    lines.push('处理办法：在这个文件夹里双击「3-立即领取.bat」，用 --debug 模式手动跑一次，');
    lines.push('看 screenshots 文件夹里的截图，通常是 Epic 改了页面。');
    lines.push('');
  }
  lines.push('完整日志：logs 文件夹');
  return lines.join('\n');
}

async function sendEmail(subject, text) {
  if (!cfg.email.enabled || OPT.noEmail) {
    info('邮件通知未启用，跳过发送。');
    return false;
  }
  const mail = cfg.email;
  if (!mail.smtpHost || !mail.user || !mail.pass || !mail.to) {
    warn('邮件配置不完整（需要 smtpHost / user / pass / to），跳过发送。');
    return false;
  }
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    warn('找不到 nodemailer 模块，跳过发送邮件。请先执行 npm install。');
    return false;
  }
  try {
    const transport = nodemailer.createTransport({
      host: mail.smtpHost,
      port: Number(mail.smtpPort) || 465,
      secure: mail.secure !== false,
      auth: { user: mail.user, pass: mail.pass },
    });
    const info2 = await transport.sendMail({
      from: mail.from || mail.user,
      to: mail.to,
      subject,
      text,
    });
    good(`邮件已发送：${info2.messageId || 'ok'}`);
    return true;
  } catch (e) {
    bad(`邮件发送失败：${e.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function doLoginFlow(initialCtx) {
  let ctx = initialCtx;
  const page = await newPage(ctx);
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });

  console.log('');
  console.log('==============================================================');
  console.log('  请在弹出的浏览器里登录你的 Epic 账号。');
  console.log('  验证码 / 两步验证都按正常流程操作即可。');
  console.log('  登录完成后，直接把这个浏览器窗口关掉，程序会自动继续。');
  console.log('==============================================================');
  console.log('');

  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    ctx.on('close', finish);
    page.on('close', finish);
    setTimeout(finish, 30 * 60 * 1000); // 兜底：30 分钟
  });

  await ctx.close().catch(() => {});
  return true;
}

async function runOnce() {
  const startedAt = new Date();
  log('==================================================');
  log('Epic 免费游戏自动领取 开始运行');
  log('==================================================');

  // 1. 先拿本周免费游戏名单
  let games = [];
  let upcoming = [];
  try {
    const r = await fetchFreeGames();
    games = r.now.filter((g) => g.slug);
    upcoming = r.upcoming;
  } catch (e) {
    bad(`获取免费游戏列表失败：${e.message}`);
    await shotlessFail(`获取免费游戏列表失败：${e.message}`);
    return 1;
  }

  log(`本周免费游戏 ${games.length} 个：`);
  for (const g of games) info(`· ${g.title}`);
  if (upcoming.length) {
    info(`（下周预告：${upcoming.map((u) => u.title).join('、')}）`);
  }

  if (OPT.listOnly) return 0;

  // 体检模式：只打开商品页确认能不能找到「获取」按钮，不点击、不改动账号
  if (OPT.check) {
    const ctx = await launchBrowser(false, true);
    const page = await newPage(ctx);
    let okCount = 0;
    for (const g of games) {
      info(`体检：${g.title}`);
      try {
        await page.goto(productUrl(g.slug), { waitUntil: 'domcontentloaded', timeout: 90000 });
        const st = await waitForPageReady(page, 60000);
        if (!st.ready) {
          bad('  页面没能正常加载（可能被风控拦截）');
          await shot(page, 'check-blocked-' + g.slug);
          continue;
        }
        const r = await clickGetButton(page, true);
        if (r === 'owned') {
          good('  已经在你的库里了');
          okCount++;
        } else if (r === 'found') {
          good('  找得到「获取」按钮，自动领取没问题');
          okCount++;
        } else {
          bad('  没找到「获取」按钮（Epic 可能改了页面）');
          await describeButtons(page);
          await shot(page, 'check-notfound-' + g.slug);
          await dumpHtml(page, 'check-notfound-' + g.slug);
        }
      } catch (e) {
        bad('  检查出错：' + e.message);
      }
    }
    await ctx.close().catch(() => {});
    log('--------------------------------------------------');
    log(`体检完成：${okCount}/${games.length} 个商品页正常。`);
    return okCount === games.length ? 0 : 1;
  }

  if (games.length === 0) {
    warn('本周没有正在免费的游戏（可能还没到周四，或者本周空档）。');
    if (cfg.email.always) {
      await sendEmail('[Epic 喜加一] 本周没有免费游戏', buildReport([], startedAt));
    }
    return 0;
  }

  // 2. 启动浏览器
  const wantHeadless = cfg.browser.headless && !OPT.headed && !OPT.debug;
  if (wantHeadless) {
    warn('当前配置为无界面模式。实测 Epic 风控会拦截无界面浏览器，建议把 config.json 里的 headless 设为 false。');
  }
  let ctx = await launchBrowser(wantHeadless, OPT.headed || OPT.debug);
  let page = await newPage(ctx);

  // 3. 检查登录状态
  let loggedIn = await isLoggedIn(page);
  if (!loggedIn) {
    warn('登录状态已失效。');
    if (!cfg.autoLoginWhenExpired) {
      await ctx.close().catch(() => {});
      await sendEmail(
        '[Epic 喜加一] 需要重新登录',
        '你的 Epic 登录状态已失效。\n\n请双击本文件夹里的「1-登录Epic.bat」重新登录一次。'
      );
      return 2;
    }
    info('正在打开浏览器，请你手动登录一次…');
    await ctx.close().catch(() => {});
    ctx = await launchBrowser(false, true);
    page = await newPage(ctx);
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const ok = await waitForManualLogin(ctx, page, cfg.loginWaitMinutes);
    if (!ok) {
      bad(`等了 ${cfg.loginWaitMinutes} 分钟还没登录成功。`);
      await shot(page, 'login-timeout');
      await ctx.close().catch(() => {});
      await sendEmail(
        '[Epic 喜加一] 需要重新登录',
        `自动领取失败：登录状态失效，等你 ${cfg.loginWaitMinutes} 分钟也没有完成登录。\n\n` +
          '请双击本文件夹里的「1-登录Epic.bat」重新登录一次。'
      );
      return 2;
    }
    good('登录成功，继续领取。');
  } else {
    info('登录状态正常。');
  }

  // 4. 逐个领取
  const results = [];
  for (const g of games) {
    try {
      const r = await claimOne(page, g);
      results.push(r);
      if (r.status === 'claimed') collected.push(g.title);
    } catch (e) {
      bad(`${g.title} 处理出错：${e.message}`);
      results.push({ game: g, status: 'failed', reason: e.message });
    }
    await page.waitForTimeout(cfg.stepDelayMs);
  }

  // 5. 汇总
  const claimed = results.filter((r) => r.status === 'claimed');
  const owned = results.filter((r) => r.status === 'owned');
  const failed = results.filter((r) => r.status === 'failed' || r.status === 'unknown');

  log('--------------------------------------------------');
  log(`结果：新领到 ${claimed.length} 个 / 早已拥有 ${owned.length} 个 / 有问题 ${failed.length} 个`);
  for (const r of claimed) good(r.game.title);
  for (const r of failed) bad(`${r.game.title} —— ${r.reason || '未知'}`);
  log('--------------------------------------------------');

  if (cfg.keepOpenSeconds > 0) {
    info(`浏览器将保持 ${cfg.keepOpenSeconds} 秒，方便你看结果…`);
    await page.waitForTimeout(cfg.keepOpenSeconds * 1000);
  }
  await ctx.close().catch(() => {});

  // 6. 邮件
  const needMail = claimed.length > 0 || failed.length > 0 || cfg.email.always;
  if (needMail) {
    const subject =
      `[Epic 喜加一] ${startedAt.toLocaleDateString('zh-CN')} ` +
      (claimed.length ? `新领 ${claimed.length} 个` : failed.length ? `有 ${failed.length} 个没领到` : '无变化');
    await sendEmail(subject, buildReport(results, startedAt));
  } else {
    info('没有变化，按配置不发邮件。');
  }

  return failed.length > 0 ? 1 : 0;
}

async function shotlessFail(msg) {
  if (cfg.email.enabled && !OPT.noEmail) {
    await sendEmail('[Epic 喜加一] 运行出错', msg + '\n\n请手动运行一次看详细日志。');
  }
}

async function main() {
  if (typeof fetch !== 'function') {
    console.error('需要 Node.js 18 或更高版本。当前版本：' + process.version);
    process.exit(1);
  }

  if (OPT.testEmail) {
    log('测试邮件配置…');
    const ok = await sendEmail(
      '[Epic 喜加一] 邮件测试',
      '如果你看到这封邮件，说明邮件通知配置成功。\n\n' + new Date().toLocaleString('zh-CN', { hour12: false })
    );
    process.exit(ok ? 0 : 1);
  }

  if (OPT.login) {
    const ctx = await launchBrowser(false, true);
    await doLoginFlow(ctx);
    console.log('');
    console.log('登录流程结束。下次运行会自动复用这次登录状态。');
    return;
  }

  const code = await runOnce();
  process.exitCode = code;
}

main().catch(async (e) => {
  console.error('');
  console.error('运行出错：' + (e && e.stack ? e.stack : e));
  await shotlessFail('运行出错：' + (e && e.message ? e.message : String(e)));
  process.exitCode = 1;
});
