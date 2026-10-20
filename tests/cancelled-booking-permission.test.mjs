import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('supabase/migrations/202610200007_fix_cancelled_delete_history_permission.sql');
const deletion=read('supabase/migrations/202610200006_permanent_delete_cancelled_booking.sql');

test('장소 이력 DELETE 권한은 서비스 역할에만 부여한다',()=>{
 assert.match(migration,/GRANT DELETE ON TABLE public\.monitoring_reservation_location_history TO service_role;/);
 assert.doesNotMatch(migration,/TO (?:anon|authenticated|PUBLIC)/);
});
test('취소 예약 삭제 시 장소 변경 이력을 먼저 정리한다',()=>{
 const location=deletion.indexOf('DELETE FROM public.monitoring_reservation_location_history');
 const booking=deletion.indexOf('DELETE FROM public.reservations');
 assert.ok(location>=0&&booking>location);
 assert.match(deletion,/v_booking\.status<>'cancelled'/);
 assert.match(deletion,/v_booking\.reservation_group<>p_group/);
});
