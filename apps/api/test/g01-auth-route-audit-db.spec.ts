import { lastValueFrom, throwError } from 'rxjs';
import { AuthenticationAuditInterceptor } from '../src/common/interceptors/authentication-audit.interceptor';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';

jest.setTimeout(180_000);
it('G01-015: public authentication failures preserve the original rejection and bounded redacted evidence',async()=>{
  await withDisposableDatabase(async({admin,app})=>{
    const interceptor=new AuthenticationAuditInterceptor(app);
    const failure=new Error('fixture-only OTP_123456_INVITE_SECRET');
    const req={path:'/api/v1/guest/RAW_INVITATION_TOKEN/otp/verify',ip:'192.0.2.30'};
    const context:any={switchToHttp:()=>({getRequest:()=>req})};
    for(let i=0;i<15;i++)await expect(lastValueFrom(interceptor.intercept(context,
      {handle:()=>throwError(()=>failure)}))).rejects.toBe(failure);
    const events=(await admin.query("SELECT * FROM auth_security_events WHERE event_type='AUTH_ROUTE_DENIED'")).rows;
    expect(events.length).toBeGreaterThan(0);
    const windows=(await admin.query(`SELECT date_trunc('minute',occurred_at),count(*)::int AS n
      FROM auth_security_events WHERE event_type='AUTH_ROUTE_DENIED' GROUP BY 1`)).rows;
    expect(windows.every(window=>window.n<=10)).toBe(true);
    expect(events.every(e=>e.reason_code==='AUTH_OPERATION_REJECTED' && e.source_digest)).toBe(true);
    const stored=JSON.stringify(events);
    for(const secret of ['123456','RAW_INVITATION_TOKEN','INVITE_SECRET','192.0.2.30'])expect(stored).not.toContain(secret);
  });
});
