import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('src/main.js');
const api=read('supabase/functions/monitoring-api/index.ts');
const migration=read('supabase/migrations/202610200006_permanent_delete_cancelled_booking.sql');

test('취소된 예약에서만 삭제 버튼을 표시한다',()=>{
 assert.match(ui,/r\.status==='confirmed'\?/);
 assert.match(ui,/data-action="edit"/);
 assert.match(ui,/data-action="delete-cancelled"/);
 assert.match(ui,/if\(action==='delete-cancelled'\)/);
 assert.match(ui,/booking\.status!=='cancelled'/);
});
test('영구삭제 전에 동아리와 예약 일시를 보여주고 복구 불가를 알린다',()=>{
 assert.match(ui,/m\.type==='delete-cancelled'/);
 assert.match(ui,/dateLabel\(r\.reservation_date\)/);
 assert.match(ui,/영구 삭제되어 복구할 수 없습니다/);
 assert.match(ui,/actions\('영구 삭제','commit-delete-cancelled','danger'\)/);
 assert.match(ui,/execute\('delete-cancelled',\{token:app\.token,reservationId:booking\.id\}/);
});
test('API는 관리자 세션을 확인한 뒤 취소 예약 삭제 함수만 호출한다',()=>{
 assert.match(api,/\['update','update-location','cancel','delete-cancelled','block'/);
 assert.match(api,/const staffGroup=await checkToken\(body\.token\)/);
 assert.match(api,/if\(action==='delete-cancelled'\)/);
 assert.match(api,/monitoring_delete_cancelled_booking/);
});
test('DB 원자적 삭제는 상태와 그룹을 잠근 뒤 관련 변경 이력만 지운다',()=>{
 assert.match(migration,/FOR UPDATE/);
 assert.match(migration,/v_booking\.reservation_group<>p_group/);
 assert.match(migration,/v_booking\.status<>'cancelled'/);
 assert.match(migration,/DELETE FROM public\.monitoring_reservation_location_history WHERE reservation_id=p_id/);
 assert.match(migration,/DELETE FROM public\.reservation_history WHERE reservation_id=p_id/);
 assert.match(migration,/DELETE FROM public\.reservations WHERE id=p_id AND status='cancelled' AND reservation_group=p_group/);
 assert.doesNotMatch(migration,/DELETE FROM public\.monitoring_reports/);
 assert.doesNotMatch(migration,/DELETE FROM public\.blocked_slots/);
 assert.match(migration,/REVOKE ALL ON FUNCTION public\.monitoring_delete_cancelled_booking\(uuid,text\) FROM PUBLIC,anon,authenticated/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.monitoring_delete_cancelled_booking\(uuid,text\) TO service_role/);
});
