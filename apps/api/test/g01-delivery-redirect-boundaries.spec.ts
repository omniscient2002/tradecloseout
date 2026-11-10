import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { DltSmsService, TransactionalMailService } from '../src/modules/identity/identity.module';

async function start(server:Server):Promise<string>{
  await new Promise<void>((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>resolve());
  });
  return 'http://127.0.0.1:'+(server.address() as AddressInfo).port;
}
async function stop(server:Server):Promise<void>{
  await new Promise<void>((resolve)=>server.close(()=>resolve()));
}

describe('G01 real HTTP OTP/mail delivery boundary',()=>{
  it('accepts configured 2xx, but never forwards proofs or provider credentials through redirects',async()=>{
    const saved:Record<string,string|undefined>={};
    for(const key of [
      'NODE_ENV','DLT_SMS_URL','DLT_SMS_API_KEY',
      'MAIL_GATEWAY_URL','MAIL_API_KEY',
    ])saved[key]=process.env[key];
    process.env.NODE_ENV='test';
    process.env.DLT_SMS_API_KEY='fixture-only-sms-api-secret';
    process.env.MAIL_API_KEY='fixture-only-mail-api-secret';

    const received:Array<{path:string,headers:any,body:string}>=[];
    const captured:Array<{path:string,headers:any,body:string}>=[];
    const sink=createServer(async(req,res)=>{
      const chunks:Buffer[]=[];
      for await(const part of req)chunks.push(Buffer.from(part));
      captured.push({path:req.url||'',headers:req.headers,
        body:Buffer.concat(chunks).toString('utf8')});
      res.writeHead(204).end();
    });
    const sinkUrl=await start(sink);
    const provider=createServer(async(req,res)=>{
      const chunks:Buffer[]=[];
      for await(const part of req)chunks.push(Buffer.from(part));
      const path=req.url||'';
      received.push({path,headers:req.headers,
        body:Buffer.concat(chunks).toString('utf8')});
      if(path.startsWith('/redirect')){
        res.writeHead(307,{Location:sinkUrl+'/captured-secret'}).end();
      }else{
        res.writeHead(202,{'Content-Type':'application/json'}).end('{"accepted":true}');
      }
    });
    const url=await start(provider);
    try{
      const sms=new DltSmsService();
      const mail=new TransactionalMailService();
      process.env.DLT_SMS_URL=url+'/ok-sms';
      process.env.MAIL_GATEWAY_URL=url+'/ok-mail';
      await expect(sms.sendOtpSms('+919999999999','629183','G01-SMS-TEMPLATE'))
        .resolves.toMatchObject({delivered:true});
      await expect(mail.sendOtpEmail('verified@g01.test','926183','LOGIN'))
        .resolves.toBeUndefined();
      expect(received).toHaveLength(2);
      expect(received[0].headers.authorization).toBe('Bearer fixture-only-sms-api-secret');
      expect(JSON.parse(received[0].body)).toMatchObject({otp:'629183'});
      expect(received[1].headers.authorization).toBe('Bearer fixture-only-mail-api-secret');
      expect(JSON.parse(received[1].body).text).toContain('926183');

      process.env.DLT_SMS_URL=url+'/redirect-sms';
      process.env.MAIL_GATEWAY_URL=url+'/redirect-mail';
      await expect(sms.sendOtpSms('+919999999999','123489','G01-SMS-TEMPLATE'))
        .rejects.toMatchObject({response:expect.objectContaining({code:'SMS_GATEWAY_ERROR'})});
      await expect(mail.sendOtpEmail('verified@g01.test','444421','LOGIN'))
        .rejects.toMatchObject({response:expect.objectContaining({code:'MAIL_GATEWAY_ERROR'})});
      await expect(mail.sendMagicLinkEmail('verified@g01.test',
        'https://app.g01.test/login?invite=secret-token-fixture'))
        .rejects.toMatchObject({response:expect.objectContaining({code:'MAIL_GATEWAY_ERROR'})});
      expect(received).toHaveLength(5);
      // A 307 normally resends POST and its body. The redirect sink must NEVER
      // see raw OTPs, invitation URLs or provider bearer credentials.
      expect(captured).toHaveLength(0);
      for(const call of received.slice(2)){
        expect(call.path).toMatch(/^\/redirect/);
      }
    }finally{
      await stop(provider);
      await stop(sink);
      for(const [key,value] of Object.entries(saved)){
        if(value===undefined)delete process.env[key];
        else process.env[key]=value;
      }
    }
  });
});
