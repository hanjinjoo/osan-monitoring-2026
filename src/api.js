import {DemoService} from './demoStore.js';
export class Service {
  constructor(clubs,cfg){this.cfg=cfg;this.demo=cfg.DEMO_MODE?new DemoService(clubs,cfg):null;}
  async call(action,data={}) {
    if(this.demo){
      switch(action){
        case 'state':return this.demo.state(data.group,data.token);
        case 'create':return this.demo.create(data);
        case 'login':return this.demo.login(data.code);
        case 'update':return this.demo.update(data);
        case 'cancel':return this.demo.cancel(data);
        case 'block':return this.demo.block(data);
        case 'block-day':return this.demo.blockDay(data);
        case 'unblock':return this.demo.unblock(data);
      }
      throw Error('지원되지 않는 요청입니다.');
    }
    if(!this.cfg.API_URL)throw Error('운영 API 주소가 설정되지 않았습니다. app.config.js와 운영 설명서를 확인하세요.');
    let res;
    try { res=await fetch(this.cfg.API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...data}),cache:'no-store'}); }
    catch { throw Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.'); }
    let payload;
    try { payload=await res.json(); } catch { throw Error(`서버 응답을 확인할 수 없습니다. (${res.status})`); }
    if(!res.ok||!payload.ok)throw Error(payload.error||'요청 처리에 실패했습니다.');
    return payload.data;
  }
}
