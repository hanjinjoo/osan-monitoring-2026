import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const main=read('src/main.js');
const reports=read('src/reports.js');
const api=read('supabase/functions/monitoring-api/index.ts');
const reportApi=read('supabase/functions/monitoring-reports/index.ts');
const migration=read('supabase/migrations/202610200005_reservation_location_and_soft_delete.sql');
test('student booking location is required in UI and server before creation',()=>{
 assert.match(main,/booking-location/);
 assert.match(main,/모니터링 진행 장소/);
 assert.match(main,/location:app\.modal\.location/);
 assert.match(api,/cleanLocation\(body\.location,true\)/);
 assert.match(api,/monitoring_create_booking_with_location/);
});
test('existing reservations preserve nullable location and staff may edit without changing slot',()=>{
 assert.match(migration,/ADD COLUMN IF NOT EXISTS reservation_location text/);
 assert.match(migration,/monitoring_update_booking_location/);
 assert.match(migration,/previous_location,new_location,updated_by_group/);
 assert.match(api,/action==='update-location'/);
 assert.match(main,/data-action="commit-location"/);
});
test('reservation and actual monitoring locations remain different fields',()=>{
 assert.match(api,/reservation_location/);
 assert.match(reportApi,/monitoring_location/);
 assert.match(reports,/defaults\.location/);
});
test('browser route supports report list editor and guarded history traversal',()=>{
 assert.match(main,/history\.pushState/);
 assert.match(main,/addEventListener\('popstate'/);
 assert.match(reports,/navigateReportRoute/);
 assert.match(main,/routePush\('admin'\)/);
 assert.match(main,/routePush\('reports'\)/);
 assert.doesNotMatch(main,/#(?:token|staff-code)=/);
});
test('status cards are accessible filters synchronized with list status',()=>{
 assert.match(reports,/data-r-action="stat-filter"/);
 assert.match(reports,/aria-pressed/);
 assert.match(reports,/state\.filter=value;state\.category='all';state\.search=''/);
});
test('completed report edit is explicit and retains completed status',()=>{
 assert.match(reports,/data-r-action="edit-report"/);
 assert.match(reports,/data-r-action="save-edit"/);
 assert.match(reports,/data-r-action="cancel-edit"/);
 assert.match(reports,/save\('completed'\)/);
 assert.doesNotMatch(reports,/if\(state\.draft\.status==='completed'\)state\.draft\.status='draft'/);
});
test('soft-delete and restore reports without removing private evidence photo',()=>{
 assert.match(migration,/deleted_at timestamptz/);
 assert.match(reportApi,/action==='report-delete'/);
 assert.match(reportApi,/action==='report-restore'/);
 assert.match(reportApi,/\.is\('deleted_at',null\)/);
 assert.match(reportApi,/\.not\('deleted_at','is',null\)/);
 assert.match(reports,/data-r-action="delete-report"/);
 assert.match(reports,/data-r-action="restore-report"/);
 assert.doesNotMatch(reportApi,/storage\.from\(BUCKET\)\.remove\(\[.*deleted_at/);
});

test('창업 관리자 로그인 직후 창업 예약 그룹을 먼저 선택하여 읽는다',()=>{
 assert.match(main,/app\.adminGroup=result\.group;app\.token=result\.token;app\.route='admin';/);
 assert.match(main,/const group=\(\)=>app\.route==='home'\?CATEGORIES\[app\.category\]\.group/);
});

test('예약 장소 공개 범위는 확정 예약에 한정하고 관리자 조회·수정 권한은 유지',()=>{
 assert.match(api,/const publicFields='id,club_id,reservation_group,reservation_date,reservation_time,reservation_location,status,created_at,updated_at'/);
 assert.match(api,/const adminFields='id,club_id,reservation_group,reservation_date,reservation_time,reservation_location,status,created_at,updated_at'/);
 assert.match(api,/select\(isAdmin\?adminFields:publicFields\)/);
 assert.match(api,/if\(!isAdmin\)q=q\.eq\('status','confirmed'\)/);
});

test('일반 달력 예약 상세는 서버에서 확정 예약의 장소를 받아 표시한다',()=>{
 const apiProjection=/const publicFields='([^']+)'/.exec(api)?.[1];
 assert.ok(apiProjection,'Public calendar state projection exists');
 assert.ok(apiProjection.split(',').includes('reservation_location'),'Public calendar must receive visit location');
 assert.match(api,/if\(!isAdmin\)q=q\.eq\('status','confirmed'\)/);
 assert.match(main,/r\.reservation_location\|\|"장소 미입력"/);
 assert.match(main,/if\(action==='show-booking'\)/);
});
