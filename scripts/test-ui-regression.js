/**
 * test-ui-regression — 教練聊天 UI 真瀏覽器回歸防線（P5-A2）
 *
 * 覆蓋三個歷史 bug 現場（皆曾在 2026-07 連環修過）：
 *   R1. 使用者訊息泡泡：短 CJK 文字不得縮成直條（寬 < 高）
 *   R2. 輸入框高度：只隨輸入行數長高，送出後回復單行
 *   R3. 行動版（375px）：教練頁不得出現水平捲動，composer 需在畫面內
 *
 * 前置：前端已在 :3456 運行（npm run start 或 dev:all）。
 * 瀏覽器：優先用系統 Chrome，否則用 Playwright chromium（CI 需先 npx playwright install chromium）。
 * 截圖存到 test-artifacts/ui-regression/（gitignore）。
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const BASE = process.env.UI_TEST_BASE || 'http://127.0.0.1:3456/lumina-ai.html';
const ARTIFACT_DIR = path.join(__dirname, '..', 'test-artifacts', 'ui-regression');
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

let failures = 0;
function check(name, cond, detail) {
    if (cond) console.log(`OK ${name}${detail ? `（${detail}）` : ''}`);
    else { failures++; console.error(`FAIL ${name}${detail ? `（${detail}）` : ''}`); }
}

function frontendUp() {
    return new Promise(resolve => {
        const req = http.get(BASE, res => { res.resume(); resolve(res.statusCode === 200); });
        req.on('error', () => resolve(false));
        req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    });
}

async function launchBrowser() {
    try { return await chromium.launch({ channel: 'chrome', headless: true }); }
    catch (_) { return await chromium.launch({ headless: true }); }
}

/** 進到教練對話（訪客 + 範例任務），回傳 page */
async function openCoachAsGuest(ctx, viewport) {
    const page = await ctx.newPage();
    await page.setViewportSize(viewport);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.locator('[data-lumina-action="dismissAuthAsGuest"]').first().click().catch(() => {});
    await page.waitForTimeout(500);
    await page.evaluate(() => { if (typeof seedDemoFirstTask === 'function') seedDemoFirstTask(); });
    await page.waitForTimeout(800);
    await page.evaluate(() => { if (typeof showSection === 'function') showSection('coach'); });
    await page.waitForSelector('#chat-input', { timeout: 15000 });
    await page.waitForTimeout(1000);
    return page;
}

async function main() {
    if (!(await frontendUp())) {
        console.error(`SKIP-FAIL 前端未運行（${BASE}）。先 npm run start 或 npm run dev:all。`);
        process.exit(1);
    }
    const browser = await launchBrowser();

    // ---------- R1 + R2：桌面 ----------
    const ctx = await browser.newContext({ locale: 'zh-TW' });
    const page = await openCoachAsGuest(ctx, { width: 1280, height: 800 });

    // R2 前置：記錄輸入框單行高度
    const input = page.locator('#chat-input');
    const h1 = (await input.boundingBox()).height;

    // R1：送出短 CJK 訊息 → 泡泡必須「寬 ≥ 高」且寬度貼合內容
    await input.fill('你是誰');
    await input.press('Enter');
    await page.waitForTimeout(1500);
    const bubble = page.locator('.coach-agent-msg-user .coach-msg-text').last();
    const bb = await bubble.boundingBox();
    check('R1 短 CJK 泡泡非直條', bb && bb.width >= bb.height, bb ? `w=${Math.round(bb.width)} h=${Math.round(bb.height)}` : '找不到泡泡');
    check('R1 泡泡寬度貼合短文字', bb && bb.width < 400, bb ? `w=${Math.round(bb.width)}` : '');
    // 每字不應獨占一行：3 個字的高度應遠小於 3 行
    const lineHeight = await bubble.evaluate(el => parseFloat(getComputedStyle(el).lineHeight) || 24);
    check('R1 文字未逐字換行', bb && bb.height < lineHeight * 2, `h=${bb ? Math.round(bb.height) : '?'} lh=${Math.round(lineHeight)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'r1-cjk-bubble.png') });

    // R2：多行輸入長高、清空回復
    await input.fill('第一行\n第二行\n第三行');
    await page.waitForTimeout(300);
    const h3 = (await input.boundingBox()).height;
    check('R2 多行輸入會長高', h3 > h1 + 10, `1行=${Math.round(h1)}px 3行=${Math.round(h3)}px`);
    await input.press('Enter');
    await page.waitForTimeout(1200);
    const hAfter = (await input.boundingBox()).height;
    check('R2 送出後回復單行高度', Math.abs(hAfter - h1) < 6, `送出後=${Math.round(hAfter)}px`);
    // 空輸入不應被內容以外的因素撐高（歷史 bug：跟著訊息數長高）
    const hEmpty = (await input.boundingBox()).height;
    check('R2 空輸入維持單行', Math.abs(hEmpty - h1) < 6, `空=${Math.round(hEmpty)}px`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'r2-input-height.png') });
    await page.close();

    // ---------- R3：行動版 375px ----------
    const mctx = await browser.newContext({
        locale: 'zh-TW',
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true
    });
    const mpage = await openCoachAsGuest(mctx, { width: 375, height: 667 });
    await mpage.locator('#chat-input').fill('行動版寬度測試訊息，這是一句比較長的中文，看看會不會撐破版面');
    await mpage.locator('#chat-input').press('Enter');
    await mpage.waitForTimeout(1500);
    const overflow = await mpage.evaluate(() => ({
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth
    }));
    check('R3 行動版無水平捲動', overflow.docW <= overflow.winW + 1, `scrollWidth=${overflow.docW} innerWidth=${overflow.winW}`);
    const composerBox = await mpage.locator('#chat-input').boundingBox();
    check('R3 composer 在畫面內', composerBox && composerBox.x >= 0 && composerBox.x + composerBox.width <= overflow.winW + 1,
        composerBox ? `x=${Math.round(composerBox.x)} w=${Math.round(composerBox.width)}` : '找不到輸入框');
    // 泡泡不得超出視窗
    const mBubble = await mpage.locator('.coach-agent-msg-user .coach-msg-text').last().boundingBox();
    check('R3 行動版泡泡不超框', mBubble && mBubble.x >= 0 && mBubble.x + mBubble.width <= overflow.winW + 1,
        mBubble ? `x=${Math.round(mBubble.x)} w=${Math.round(mBubble.width)}` : '找不到泡泡');
    await mpage.screenshot({ path: path.join(ARTIFACT_DIR, 'r3-mobile-375.png') });
    await mpage.close();

    await browser.close();
    console.log('────────');
    if (failures) {
        console.error(`UI regression failed: ${failures}（截圖見 test-artifacts/ui-regression/）`);
        process.exit(1);
    }
    console.log('UI regression passed（截圖見 test-artifacts/ui-regression/）');
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
