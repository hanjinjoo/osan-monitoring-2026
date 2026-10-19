import assert from 'node:assert/strict';
import test from 'node:test';
import {DemoService} from '../src/demoStore.js';
import {TIMES} from '../src/utils.js';

const STORAGE_KEY='osan-monitoring-demo-state-v1';
const cfg={FIRST_DATE:'2026-10-26',LAST_DATE:'2026-11-27',WEEKENDS_ENABLED:false};

function setup() {
 const saved=new Map();
 globalThis.localStorage={
  getItem:key=>saved.get(key)??null,
  setItem:(key,value)=>saved.set(key,String(value)),
  removeItem:key=>saved.delete(key),
 };
 return new DemoService([],cfg);
}

test('하루 전체 차단은 점심을 뺀 32개 시간만 차단한다',async()=>{
 const service=setup();
 const r=await service.blockDay({token:'demo-integrated',date:'2026-10-26',group:'integrated'});
 const state=await service.state('integrated','demo-integrated');
 assert.equal(r.blocked_slots,32);
 assert.equal(state.blocks.length,32);
 assert.deepEqual(state.blocks.map(x=>x.blocked_time).sort(),[...TIMES].sort());
 assert.ok(!state.blocks.some(x=>x.blocked_time.startsWith('12:')));
});

test('전체 차단 재시도는 멱등이며 기존 개별 차단도 보존된다',async()=>{
 const service=setup();
 await service.block({token:'demo-integrated',date:'2026-10-26',time:'09:00',group:'integrated'});
 await service.blockDay({token:'demo-integrated',date:'2026-10-26',group:'integrated'});
 await service.blockDay({token:'demo-integrated',date:'2026-10-26',group:'integrated'});
 const state=await service.state('integrated','demo-integrated');
 assert.equal(state.blocks.length,32);
 assert.equal(new Set(state.blocks.map(x=>x.blocked_time)).size,32);
});

test('예약이 있으면 전체 차단이 실패하고 기존 개별 차단도 유지된다',async()=>{
 const service=setup();
 await service.block({token:'demo-integrated',date:'2026-10-26',time:'09:00',group:'integrated'});
 const before=JSON.parse(localStorage.getItem(STORAGE_KEY));
 before.reservations.push({
  id:'r1',club_id:'major-test',reservation_group:'integrated',
  reservation_date:'2026-10-26',reservation_time:'10:15',status:'confirmed'
 });
 localStorage.setItem(STORAGE_KEY,JSON.stringify(before));
 await assert.rejects(()=>service.blockDay({token:'demo-integrated',date:'2026-10-26',group:'integrated'}),/이미 예약/);
 const after=JSON.parse(localStorage.getItem(STORAGE_KEY));
 assert.deepEqual(after,before);
});

test('통합/창업 그룹은 같은 날짜를 독립적으로 차단할 수 있다',async()=>{
 const service=setup();
 await service.blockDay({token:'demo-integrated',date:'2026-10-26',group:'integrated'});
 assert.equal((await service.state('startup','demo-startup')).blocks.length,0);
 await service.blockDay({token:'demo-startup',date:'2026-10-26',group:'startup'});
 assert.equal((await service.state('startup','demo-startup')).blocks.length,32);
});

test('담당 그룹 불일치 및 주말 차단은 거부된다',async()=>{
 const service=setup();
 await assert.rejects(()=>service.blockDay({token:'demo-startup',date:'2026-10-26',group:'integrated'}),/권한/);
 await assert.rejects(()=>service.blockDay({token:'demo-integrated',date:'2026-10-31',group:'integrated'}),/주말/);
});
