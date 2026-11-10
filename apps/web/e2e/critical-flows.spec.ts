import { test, expect } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';
import { isQueuedUploadContextCurrent } from '../src/lib/offline-upload-queue';

test.describe('TradeCloseout v0.2.1 Critical User Flows (SCR-002 -> SCR-010 -> SCR-013 -> SCR-025)', () => {
  test('E2E-01: Unauthenticated visitor to / is redirected to /login by middleware', async ({ page }) => {
    await page.goto('http://localhost:3002/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('h2')).toContainText('Sign in to your workspace');
  });

  test('E2E-02: PM Meera Deshmukh signs in via OTP, views 3-project portfolio on /dashboard, and opens HYD-BIO-09', async ({
    page,
  }) => {
    await page.goto('http://localhost:3002/login');
    await page.fill('input[type="text"]', 'meera@deccanmep.in');
    await page.click('button[type="submit"]');

    await expect(page.locator('h2')).toContainText('Enter verification code');
    // In development mode, OTP is pre-filled from devOtpPreview
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('h1')).toContainText('Deccan EnviroTech MEP Pvt Ltd');
    await expect(page.getByText('HYD-BIO-09')).toBeVisible();
    await expect(page.getByText('HYD-IT-04')).toBeVisible();
    await expect(page.getByText('SEC-HOSP-02')).toBeVisible();
  });
});

/**
 * Browser/API contract regression, not a substitute for live OTP/provider E2E.
 * Only the API responses are intercepted; the real Next login form and its
 * outgoing HTTP request are exercised.
 */
function currentTotp(secret:string):string {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits=0,value=0;
  const bytes:number[]=[];
  for(const c of secret.trim().toUpperCase()){
    const n=alphabet.indexOf(c);
    if(n<0)throw new Error('Invalid fixture TOTP secret');
    value=(value<<5)|n;
    bits+=5;
    if(bits>=8){
      bytes.push((value >>> (bits-=8)) & 255);
      value &= (1<<bits)-1;
    }
  }
  const ctr=Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30_000)));
  const digest=createHmac('sha1',Buffer.from(bytes)).update(ctr).digest();
  const off=digest[digest.length-1]&15;
  const number=(digest.readUInt32BE(off)&0x7fffffff)%1_000_000;
  return String(number).padStart(6,'0');
}

test.describe('G01 browser authentication contract', () => {
  test('E2E-G01: actual API/PG/Redis OTP, MFA rotation and logout revocation', async ({ page, request }) => {
    test.skip(process.env.E2E_LIVE_AUTH !== 'true',
      'Requires disposable API and PostgreSQL/Redis with test-only OTP delivery');
    const email='g01-live-'+randomUUID().replace(/-/g,'')+'@example.test';
    await page.goto('http://localhost:3002/login');
    await page.getByRole('button',{name:/New contractor\? Register a new organisation/}).click();
    await page.getByPlaceholder('e.g., meera@deccanmep.in or +919848011102').fill(email);
    await page.getByPlaceholder('e.g., Rajesh Sharma').fill('G01 Live Owner');
    await page.getByPlaceholder('e.g., Sharma HVAC Solutions Pvt Ltd').fill('G01 Verification HVAC Ltd');
    await page.getByRole('button',{name:'Send Verification Code'}).click();
    await expect(page.getByText('Enter verification code')).toBeVisible();
    await expect(page.getByText('Local Development OTP Code:')).toBeVisible();
    await expect(page.locator('input[maxlength="6"]')).toHaveValue(/^\d{6}$/);
    await page.getByRole('button',{name:'Verify & Open Company Dashboard'}).click();

    await expect(page).toHaveURL(/\/mfa(?:\?|$)/);
    const beforeFactor=(await page.context().cookies()).find(c=>c.name==='tc_session');
    expect(beforeFactor).toBeDefined();
    expect(beforeFactor!.httpOnly).toBe(true);
    await page.getByRole('button',{name:'Start authenticator enrollment'}).click();
    const secret=(await page.locator('code').first().innerText()).trim();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await page.locator('#mfa-code').fill(currentTotp(secret));
    await page.getByRole('button',{name:'Verify'}).click();
    await expect(page.getByText('Save these eight recovery codes offline. Each works once.')).toBeVisible();
    const afterFactor=(await page.context().cookies()).find(c=>c.name==='tc_session');
    expect(afterFactor).toBeDefined();
    expect(afterFactor!.value).not.toBe(beforeFactor!.value);

    // The pre-MFA cookie is already unusable after rotation; a CSRF header
    // cannot revive it. This uses real HTTP middleware, not route interception.
    const stale=await request.get('http://localhost:3002/api/v1/auth/me',{
      headers:{Cookie:'tc_session='+beforeFactor!.value},
    });
    expect(stale.status()).toBe(401);

    await page.getByRole('button',{name:'I have saved the codes securely'}).click();
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
    await expect(page.getByRole('button',{name:/G01 Live Owner/})).toBeVisible();
    // Two real browser tabs share the HttpOnly session cookie but have
    // separate JS state. Confirm logout in tab A invalidates tab B as well.
    const otherTab=await page.context().newPage();
    await otherTab.goto('http://localhost:3002/dashboard');
    await expect(otherTab.getByRole('button',{name:/G01 Live Owner/})).toBeVisible();
    await page.getByRole('button',{name:/G01 Live Owner/}).click();
    await page.getByRole('button',{name:'Sign Out Session'}).click();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(otherTab).toHaveURL(/\/login(?:\?|$)/);
    await otherTab.close();

    const loggedOut=await request.get('http://localhost:3002/api/v1/auth/me',{
      headers:{Cookie:'tc_session='+afterFactor!.value},
    });
    expect(loggedOut.status()).toBe(401);
  });

  test('E2E-G01: queued uploads reject changed account, generation, tab epoch and legacy drafts', async () => {
    const bound = {
      actorPartition:'member:org-a:user-a',authGeneration:'session-generation-1',
      authEpoch:'cross-tab-epoch-1',
    };
    const current = {
      partition:'member:org-a:user-a',generation:'session-generation-1',
      epoch:'cross-tab-epoch-1',
    };
    expect(isQueuedUploadContextCurrent(bound,current)).toBe(true);
    expect(isQueuedUploadContextCurrent(bound,{...current,partition:'member:org-b:user-b'})).toBe(false);
    expect(isQueuedUploadContextCurrent(bound,{...current,generation:'session-generation-2'})).toBe(false);
    expect(isQueuedUploadContextCurrent(bound,{...current,epoch:'cross-tab-epoch-2'})).toBe(false);
    expect(isQueuedUploadContextCurrent({...bound,authEpoch:undefined},current)).toBe(false);
    expect(isQueuedUploadContextCurrent({...bound,authGeneration:undefined},current)).toBe(false);
  });

  test('E2E-G01: blocks contractor content until session identity is verified', async ({ page }) => {
    await page.context().addCookies([{
      name:'tc_session', value:'expired-opaque-cookie',
      domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax',
    }]);
    let releaseVerification!: () => void;
    const verificationWait=new Promise<void>(resolve => {releaseVerification=resolve;});
    await page.route('**/api/v1/auth/me',async route=>{
      await verificationWait;
      await route.fulfill({
        status:401,contentType:'application/problem+json',
        body:JSON.stringify({status:401,code:'SESSION_EXPIRED',detail:'Session expired'}),
      });
    });
    await page.goto('http://localhost:3002/dashboard');
    await expect(page.getByRole('status')).toContainText('Verifying your workspace session');
    await expect(page.getByRole('navigation')).toHaveCount(0);
    releaseVerification();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
  });

  test('E2E-G01: forwards the server-issued challenge ID with the human-entered code', async ({ page }) => {
    const challengeId = '01999999-1234-7000-8000-999999999999';
    await page.route('**/api/v1/auth/otp/request', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        identifier: 'test@g01.example',
      });
      await route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ challengeId, channel: 'EMAIL', expiresInSeconds: 300 }),
      });
    });
    await page.route('**/api/v1/auth/otp/verify', async (route) => {
      await route.fulfill({
        status: 401, contentType: 'application/problem+json',
        body: JSON.stringify({ status: 401, code: 'OTP_INVALID', detail: 'Invalid OTP' }),
      });
    });
    await page.goto('http://localhost:3002/login');
    await page.locator('input[type="text"]').first().fill('test@g01.example');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Enter verification code')).toBeVisible();
    await page.locator('input[maxlength="6"]').fill('482615');
    const verification = page.waitForRequest((request) =>
      request.url().includes('/api/v1/auth/otp/verify') && request.method() === 'POST');
    await page.locator('button[type="submit"]').click();
    const sent = (await verification).postDataJSON();
    expect(sent).toMatchObject({
      challengeId, identifier: 'test@g01.example', code: '482615',
    });
    await expect(page.getByText('Invalid OTP', { exact: true })).toBeVisible();
  });
});
