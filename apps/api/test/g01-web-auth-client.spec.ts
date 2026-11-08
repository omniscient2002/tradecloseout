import {
  apiFetch, getAuthGeneration, getCsrfToken,
  setCsrfToken, watchAuthChanges,
} from '../../web/src/lib/api-client';

describe('G01 browser API client actor-generation fencing', () => {
  it('does not re-bootstrap and submit stale mutations when another tab changes account', async () => {
    const oldWindow=(globalThis as any).window;
    const oldSessionStorage=(globalThis as any).sessionStorage;
    const oldLocalStorage=(globalThis as any).localStorage;
    const oldFetch=globalThis.fetch;
    const session=new Map<string,string>();
    const local=new Map<string,string>();
    let storageHandler: ((event: any)=>void)|null=null;
    let authChangeCalls=0;
    (globalThis as any).window = {
      location:{pathname:'/dashboard'},
      addEventListener:jest.fn((name:string,callback:any)=>{
        if(name==='storage')storageHandler=callback;
      }),
      removeEventListener:jest.fn(),
    };
    (globalThis as any).sessionStorage={
      getItem:(k:string)=>session.get(k)??null,
      setItem:(k:string,v:string)=>{session.set(k,v);},
      removeItem:(k:string)=>{session.delete(k);},
    };
    (globalThis as any).localStorage={
      getItem:(k:string)=>local.get(k)??null,
      setItem:(k:string,v:string)=>{local.set(k,v);},
      removeItem:(k:string)=>{local.delete(k);},
    };
    globalThis.fetch=jest.fn().mockResolvedValue({
      ok:true,status:200,json:async()=>({saved:true}),
    }) as any;
    try {
      setCsrfToken('first-factor-csrf','first-session-generation',false);
      const unsubscribe=watchAuthChanges(()=>{authChangeCalls++;});
      expect(getCsrfToken()).toBe('first-factor-csrf');
      expect(getAuthGeneration()).toBe('first-session-generation');
      expect(storageHandler).not.toBeNull();

      (storageHandler as any)({key:'tc_auth_epoch',newValue:'different-tab'});
      expect(authChangeCalls).toBe(1);
      expect(getCsrfToken()).toBeNull();
      expect(getAuthGeneration()).toBeNull();

      await expect(apiFetch('/api/v1/projects', {
        method:'POST',body:JSON.stringify({name:'old-form'}),
      })).rejects.toMatchObject({status:409,code:'AUTH_CONTEXT_CHANGED'});
      expect(globalThis.fetch).not.toHaveBeenCalled();

      // A new explicit successful OTP login may bind this tab to the new
      // session. Automatic bootstrap has no such power.
      setCsrfToken('new-verified-csrf','new-verified-generation');
      await expect(apiFetch('/api/v1/projects', {
        method:'POST',body:JSON.stringify({name:'new-approved-form'}),
      })).resolves.toMatchObject({saved:true});
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const headers=(globalThis.fetch as jest.Mock).mock.calls[0][1].headers as Headers;
      expect(headers.get('X-CSRF-Token')).toBe('new-verified-csrf');
      expect(headers.get('X-Auth-Generation')).toBe('new-verified-generation');
      unsubscribe();
    } finally {
      globalThis.fetch=oldFetch;
      (globalThis as any).window=oldWindow;
      (globalThis as any).sessionStorage=oldSessionStorage;
      (globalThis as any).localStorage=oldLocalStorage;
    }
  });
});
