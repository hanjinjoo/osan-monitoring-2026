import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const base=path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');
const clubs=JSON.parse(read('data/clubs.json'));
const scopeSql=read('supabase/migrations/202610200001_monitoring_reports.sql');
const deptSql=read('supabase/migrations/202610200002_report_departments.sql');
const onePhotoSql=read('supabase/migrations/202610200003_one_photo_per_report.sql');
const frontend=read('src/reports.js');
const css=read('src/reports.css');
const api=read('supabase/functions/monitoring-reports/index.ts');
const original=read('src/main.js');
const index=read('index.html');

test('기존 88개 예약 동아리 수 및 분리 그룹 보존',()=>{
 assert.equal(clubs.length,88);
 for(const [category,n] of Object.entries({major:43,employment:19,startup:16,general:10})){
  assert.equal(clubs.filter(x=>x.category===category).length,n);
 }
 for(const club of clubs)assert.equal(club.reservation_group,club.category==='startup'?'startup':'integrated');
});
test('원본 순서에 따른 보고 대상 81개 / 전공 부트·신산업 7개 제외',()=>{
 const eligible=clubs.filter(c=>c.category!=='major'||Number(c.id.slice(-3))<=36);
 assert.equal(eligible.length,81);
 assert.equal(eligible.filter(c=>c.category==='major').length,36);
 assert.equal(eligible.filter(c=>c.category==='employment').length,19);
 assert.equal(eligible.filter(c=>c.category==='startup').length,16);
 assert.equal(eligible.filter(c=>c.category==='general').length,10);
 assert.match(scopeSql,/c\.id BETWEEN 'major-001' AND 'major-036'/);
 assert.match(scopeSql,/total<>81 OR majors<>36 OR jobs<>19 OR startups<>16 OR generals<>10/);
});
test('비개인정보 학과 71개만 GitHub 마이그레이션에 등록',()=>{
 const matches=[...deptSql.matchAll(/\('(major|employment|startup)-\d{3}','/g)];
 // 공백 구분이 있으므로 학과 seed의 레코드 개수는 ID 기준으로 확인.
 const seen=new Set([...deptSql.matchAll(/'(major|employment|startup)-\d{3}'/g)].map(x=>x[0]));
 assert.equal(seen.size,71);
 assert.doesNotMatch(deptSql,/professor_name\s*=/);
 assert.doesNotMatch(deptSql,/student_representative\s*=/);
});
test('기존 예약 함수·차단 경로를 변경하지 않고 결과관리만 추가',()=>{
 for(const action of ['commit-booking','commit-edit','commit-cancel','commit-block','unblock'])
  assert.match(original,new RegExp(action));
 assert.match(original,/data-action="reports"/);
 assert.match(original,/app\.reportMode/);
 assert.match(index,/src\/reports\.css/);
});
test('카메라와 갤러리 입력은 분리, 고화질 TUS 업로드 사용',()=>{
 assert.match(frontend,/capture="environment"/);
 assert.match(frontend,/id="report-gallery-input"/);
 assert.doesNotMatch(frontend,/id="report-gallery-input"[^>]*multiple/);
 assert.match(frontend,/tus-js-client/);
 assert.match(frontend,/x-signature/);
 assert.match(frontend,/onProgress/);
 assert.match(frontend,/photo-finish/);
 assert.match(frontend,/retry-photo/);
});
test('서버는 HMAC 관리자 인증 및 그룹별 scope 검증',()=>{
 assert.match(api,/crypto\.subtle\.verify/);
 assert.match(api,/MONITORING_SESSION_SECRET/);
 assert.match(api,/findScope\(body\.clubId,group\)/);
 assert.match(api,/\.eq\('reservation_group',group\)/);
 assert.match(api,/\.eq\('version',old\.version\)/);
});
test('비공개 사진 저장·민감정보 RLS와 service role 전용 접근',()=>{
 assert.match(scopeSql,/monitoring-report-photos','monitoring-report-photos',false/);
 assert.match(scopeSql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(scopeSql,/FROM PUBLIC,anon,authenticated/);
 assert.match(api,/createSignedUploadUrl/);
 assert.match(api,/createSignedUrl/);
 assert.doesNotMatch(frontend,/SUPABASE_SERVICE_ROLE_KEY|MONITORING_INTEGRATED_STAFF_CODE/);
 assert.doesNotMatch(css,/^body\s*\{/m);
});
test('지금 단계에서 PDF·HWP 자동생성은 제외',()=>{
 assert.doesNotMatch(frontend,/window\.print\(|pdfmake|jspdf|html2canvas|PDFDocument/);
});

test('한 동아리 증빙사진은 정확히 1장, 새 사진 실패 시 기존 유지',()=>{
 assert.match(onePhotoSql,/monitoring_photo_one_ready_per_report/);
 assert.match(onePhotoSql,/monitoring_photo_one_pending_per_report/);
 assert.match(onePhotoSql,/monitoring_finish_single_photo/);
 assert.match(onePhotoSql,/FOR UPDATE OF rep/);
 assert.match(onePhotoSql,/DELETE FROM public.monitoring_report_photos/);
 assert.match(onePhotoSql,/GRANT EXECUTE ON FUNCTION public.monitoring_finish_single_photo\(uuid,text\) TO service_role/);
 assert.match(api,/monitoring_finish_single_photo/);
 assert.match(api,/replaced_path/);
 assert.match(api,/if\(ready\.length!==MAX_PHOTOS_PER_REPORT\)/);
 assert.match(api,/report\.status==='completed'\)throw fail\(409/);
 assert.match(api,/STORAGE_SOFT_LIMIT_BYTES=850_000_000/);
 assert.match(frontend,/state\.photos=\[done\.photo\]/);
 assert.match(frontend,/discard-pending/);
 assert.match(frontend,/if\(state\.photos\.length!==1\)/);
 assert.match(frontend,/await imageUpload\(files\[0\]\)/);
});
