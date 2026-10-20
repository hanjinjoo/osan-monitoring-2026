import test from 'node:test';
import assert from 'node:assert/strict';

const endpoint=process.env.REPORT_API_URL;
test('운영 결과관리 API는 익명·위조 세션을 거절한다', {skip:!endpoint}, async () => {
  const variants=[
    {description:'missing session',body:{action:'reports-list'}},
    {description:'forged session',body:{action:'reports-list',token:'invalid.token'}},
    {description:'unauthorized photo signature',body:{action:'photo-start',clubId:'major-001',filename:'photo.jpg',fileSize:1024,mime:'image/jpeg'}}
  ];
  for(const sample of variants) {
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sample.body)});
    assert.equal(response.status,401,sample.description);
    const body=await response.json();
    assert.equal(body.ok,false,sample.description);
    assert.ok(!JSON.stringify(body).includes('SUPABASE_SERVICE_ROLE_KEY'),sample.description);
  }
  const preflight=await fetch(endpoint,{method:'OPTIONS',headers:{Origin:'https://hanjinjoo.github.io','Access-Control-Request-Method':'POST'}});
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://hanjinjoo.github.io');
});

const schedulerEndpoint=process.env.SCHEDULER_API_URL;
test('기존 예약 API는 공개 일정 조회 유지, 잘못된 사번은 거절', {skip:!schedulerEndpoint}, async()=>{
 const state=await fetch(schedulerEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'state',group:'integrated'})});
 assert.equal(state.status,200,'Existing reservation state endpoint must keep working');
 const parsed=await state.json();assert.equal(parsed.ok,true);
 assert.ok(Array.isArray(parsed.data?.reservations));
 assert.ok(Array.isArray(parsed.data?.blocks));
 assert.ok(parsed.data.reservations.every(r=>r.status==='confirmed'));
 const login=await fetch(schedulerEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',code:'not-a-number'})});
 assert.equal(login.status,401);
 const bad=await login.json();assert.equal(bad.ok,false);
});
