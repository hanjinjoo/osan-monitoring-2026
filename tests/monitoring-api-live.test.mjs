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
