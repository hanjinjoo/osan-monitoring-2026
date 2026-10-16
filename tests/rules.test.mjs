import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { TIMES, CATEGORIES,validateReservation,isInRange,isWeekend } from '../src/utils.js';
const clubs=JSON.parse(fs.readFileSync(new URL('../data/clubs.json',import.meta.url),'utf8'));
const cfg={FIRST_DATE:'2026-10-26',LAST_DATE:'2026-11-27',WEEKENDS_ENABLED:false};
const integrated=clubs.find(c=>c.category==='major');
const employment=clubs.find(c=>c.category==='employment');
const general=clubs.find(c=>c.category==='general');
const startup=clubs.find(c=>c.category==='startup');
const occupied={id:'r1',club_id:integrated.id,reservation_group:'integrated',reservation_date:'2026-10-28',reservation_time:'14:15',status:'confirmed'};

test('원본 88개 동아리 수 검증',()=>{
 assert.equal(clubs.length,88);
 assert.deepEqual(['major','employment','startup','general'].map(category=>clubs.filter(c=>c.category===category).length),[43,19,16,10]);
 assert.equal(new Set(clubs.map(c=>c.id)).size,88);
 assert.ok(clubs.some(c=>c.name==='RAVENS' && c.category==='major'));
 assert.ok(clubs.some(c=>c.name.includes('레이븐즈 이스포츠') && c.category==='startup'));
});
test('동아리 예약 그룹 정확성',()=>{
 assert.ok(clubs.every(c=>c.reservation_group===(c.category==='startup'?'startup':'integrated')));
 assert.equal(clubs.filter(c=>c.reservation_group==='integrated').length,72);
});
test('15분 단위 32개 시작 시각, 12~13시 제외',()=>{
 assert.equal(TIMES.length,32);assert.equal(TIMES[0],'09:00');assert.equal(TIMES.at(-1),'17:45');
 for(const t of ['12:00','12:15','12:30','12:45','18:00','08:45','14:07'])assert.ok(!TIMES.includes(t));
 for(const t of ['09:15','11:45','13:00','14:15','17:45'])assert.ok(TIMES.includes(t));
});
test('모니터링 날짜 양 끝 포함',()=>{
 assert.ok(isInRange('2026-10-26',cfg));assert.ok(isInRange('2026-11-27',cfg));
 assert.ok(!isInRange('2026-10-25',cfg));assert.ok(!isInRange('2026-11-28',cfg));
 assert.equal(isWeekend('2026-10-31'),true);
});
test('전공 선점 -> 취업·일반 충돌 / 창업은 독립적으로 가능',()=>{
 for(const c of [employment,general])assert.match(validateReservation(c,'2026-10-28','14:15',[occupied],[],cfg),/이미 예약/);
 assert.equal(validateReservation(startup,'2026-10-28','14:15',[occupied],[],cfg),'');
 assert.match(validateReservation(integrated,'2026-10-28','14:30',[occupied],[],cfg),/이미/);
});
test('같은 창업 그룹은 같은 시각 충돌',()=>{
 const startup2=clubs.filter(c=>c.category==='startup')[1];
 const booked={...occupied,id:'r2',club_id:startup.id,reservation_group:'startup'};
 assert.match(validateReservation(startup2,'2026-10-28','14:15',[booked],[],cfg),/이미 예약/);
});
test('차단 슬롯, 점심시간 및 15분 외 시각 거부',()=>{
 const blocked=[{reservation_group:'startup',blocked_date:'2026-10-28',blocked_time:'14:30'}];
 assert.match(validateReservation(startup,'2026-10-28','14:30',[],blocked,cfg),/차단/);
 assert.match(validateReservation(startup,'2026-10-28','12:30',[],blocked,cfg),/15분 단위/);
 assert.match(validateReservation(startup,'2026-10-28','14:07',[],blocked,cfg),/15분 단위/);
});
