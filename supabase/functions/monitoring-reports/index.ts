/**
 * monitoring-reports: 독립적인 민감정보 API.
 * verify_jwt=false (기존 monitoring-api의 HMAC 세션을 서버에서 재검증).
 * service_role과 MONITORING_SESSION_SECRET은 Edge Function Secrets에만 저장.
 * 배포 전 SQL 마이그레이션과 비공개 storage 버킷 필요.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ORIGIN = 'https://hanjinjoo.github.io';
const CORS:Record<string,string> = {
 'Access-Control-Allow-Origin':ORIGIN,
 'Access-Control-Allow-Headers':'content-type',
 'Access-Control-Allow-Methods':'POST, OPTIONS',
 'Cache-Control':'no-store',
 'Vary':'Origin'
};
const TERM='2026-2';
const BUCKET='monitoring-report-photos';
const MAX_FILE=50_000_000; // Free 프로젝트 파일당 최대 50 MB(10진), Storage 전역 설정과 재확인.
const MAX_PHOTOS_PER_REPORT=1;
const STORAGE_SOFT_LIMIT_BYTES=850_000_000; // Free 1GB, 원본 사진 전체 850MB까지만 안전하게 허용
// 단일 기록당 1장; 사진 교체 중에는 기존 ready 한 장 + 신규 pending 한 장까지 가능
const env=(n:string)=>Deno.env.get(n)||'';
const supabase=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{
 auth:{persistSession:false,autoRefreshToken:false}
});
const ok=(data:unknown)=>new Response(JSON.stringify({ok:true,data}),{status:200,headers:{...CORS,'Content-Type':'application/json; charset=utf-8'}});
class HttpError extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status}}
const fail=(status:number,message:string)=>new HttpError(status,message);
const groupValid=(x:unknown):x is 'integrated'|'startup'=>x==='integrated'||x==='startup';
const uidValid=(x:unknown):x is string=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const dateValid=(x:unknown)=>x===null||(typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x)));
const timeValid=(x:unknown)=>x===null||(typeof x==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(x));
function fromBase64(s:string){let v=s.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(v+'='.repeat((4-v.length%4)%4)),x=>x.charCodeAt(0))}
async function groupFromToken(token:unknown){
 if(typeof token!=='string'||token.length>2048)return null;
 const parts=token.split('.');if(parts.length!==2)return null;
 try{
  const secret=env('MONITORING_SESSION_SECRET');
  if(secret.length<32)throw fail(503,'서버의 관리자 인증 설정을 확인해 주세요.');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('HMAC',key,fromBase64(parts[1]),new TextEncoder().encode(parts[0]));
  if(!valid)return null;
  const payload=JSON.parse(new TextDecoder().decode(fromBase64(parts[0])));
  return groupValid(payload.group)&&Number.isInteger(payload.exp)&&payload.exp>Math.floor(Date.now()/1000)?payload.group:null;
 }catch{return null}
}
async function queryOne(table:string,column:string,value:string){
 const {data,error}=await supabase.from(table).select('*').eq(column,value).maybeSingle();
 if(error)throw fail(500,'기록을 조회하지 못했습니다.');
 return data;
}
async function findScope(clubId:unknown,group:'integrated'|'startup'){
 if(typeof clubId!=='string'||!/^(major|employment|general|startup)-\d{3}$/.test(clubId))throw fail(400,'동아리 ID가 올바르지 않습니다.');
 const {data,error}=await supabase.from('monitoring_report_scope').select('*').eq('academic_term',TERM).eq('club_id',clubId).eq('reservation_group',group).maybeSingle();
 if(error)throw fail(500,'작성 대상 명단을 조회하지 못했습니다.');
 if(!data)throw fail(403,'해당 동아리의 결과 기록 권한이 없습니다.');
 return data;
}
async function reportFor(scope:{club_id:string}){
 const {data,error}=await supabase.from('monitoring_reports').select('*').eq('academic_term',TERM).eq('club_id',scope.club_id).maybeSingle();
 if(error)throw fail(500,'모니터링 기록을 조회하지 못했습니다.');
 return data;
}
async function photosFor(reportId:string){
 const {data,error}=await supabase.from('monitoring_report_photos').select('*').eq('report_id',reportId).order('display_order').order('created_at');
 if(error)throw fail(500,'사진 기록을 조회하지 못했습니다.');
 return data||[];
}
async function photoBelongs(photoId:unknown,group:'integrated'|'startup'){
 if(!uidValid(photoId))throw fail(400,'사진 ID가 올바르지 않습니다.');
 const photo=await queryOne('monitoring_report_photos','id',photoId);
 if(!photo)throw fail(404,'사진을 찾을 수 없습니다.');
 const report=await queryOne('monitoring_reports','id',photo.report_id);
 if(!report)throw fail(404,'결과 기록을 찾을 수 없습니다.');
 await findScope(report.club_id,group);
 return {photo,report};
}
function field(value:unknown,name:string,max:number){
 if(typeof value!=='string'||value.length>max)throw fail(400,name+' 입력값이 올바르지 않거나 너무 깁니다.');
 return value;
}
const nullable=(value:unknown)=>value===''||value===undefined?null:value;
async function history(reportId:string,type:string,group:string,from:string|null,to:string|null){
 const {error}=await supabase.from('monitoring_report_history').insert({report_id:reportId,change_type:type,staff_group:group,old_status:from,new_status:to});
 if(error)console.error('report history insert failed');
}
async function route(body:Record<string,unknown>,group:'integrated'|'startup'){
 if(body.action==='reports-list'){
  const scopesRes=await supabase.from('monitoring_report_scope').select('club_id,academic_term,reservation_group,project_type,department,professor_name,student_representative').eq('academic_term',TERM).eq('reservation_group',group);
  if(scopesRes.error)throw fail(500,'대상 동아리 목록을 불러오지 못했습니다.');
  const scopes=scopesRes.data||[];
  const ids=scopes.map(c=>c.club_id);
  if(!ids.length)return {scopes:[],reports:[],photos:[],clubs:[]};
  const [reports,photos,clubs]=await Promise.all([
   supabase.from('monitoring_reports').select('id,club_id,status,monitoring_date,monitoring_time,updated_at,version').eq('academic_term',TERM).in('club_id',ids),
   supabase.from('monitoring_report_photos').select('report_id,upload_status').eq('upload_status','ready'),
   supabase.from('clubs').select('id,name,category,reservation_group').in('id',ids)
  ]);
  if(reports.error||photos.error||clubs.error)throw fail(500,'현황을 불러오지 못했습니다.');
  const reportIds=new Set((reports.data||[]).map(r=>r.id));
  const photoCounts:Record<string,number>={};
  for(const p of photos.data||[]){if(reportIds.has(p.report_id))photoCounts[p.report_id]=(photoCounts[p.report_id]||0)+1}
  return {scopes,reports:reports.data||[],photoCounts,clubs:clubs.data||[]};
 }
 if(body.action==='report-get'){
  const scope=await findScope(body.clubId,group);
  const report=await reportFor(scope);
  const photos=report?await photosFor(report.id):[];
  const pendingPhoto=photos.find(p=>p.upload_status==='pending');
  const resultPhotos=await Promise.all(photos.filter(p=>p.upload_status==='ready').map(async p=>{
   const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(p.storage_path,600);
   return {...p,preview_url:error?'':data?.signedUrl||''};
  }));
  return {scope,report,photos:resultPhotos,pendingPhoto:pendingPhoto?{id:pendingPhoto.id,original_filename:pendingPhoto.original_filename,created_at:pendingPhoto.created_at}:null};
 }
 if(body.action==='report-save'){
  const scope=await findScope(body.clubId,group);
  const status=body.status;
  if(!['draft','completed','not_conducted'].includes(String(status)))throw fail(400,'작성 상태가 올바르지 않습니다.');
  const date=nullable(body.monitoring_date),time=nullable(body.monitoring_time);
  if(!dateValid(date)||!timeValid(time))throw fail(400,'점검일시 형식을 확인해 주세요.');
  const content={
   monitoring_date:date,monitoring_time:time,
   monitoring_location:field(body.monitoring_location,'점검장소',1000),
   activity_description:field(body.activity_description,'활동내용',20000),
   staff_evaluation:field(body.staff_evaluation,'담당자평가',20000),
   staff_opinion:field(body.staff_opinion,'담당자의견',20000),
   not_conducted_reason:field(body.not_conducted_reason,'미실시 사유',3000),
   status:String(status),updated_by_group:group,updated_at:new Date().toISOString(),
   completed_at:status==='completed'?new Date().toISOString():null
  };
  if(status==='completed'){
   if(!date||!time||!content.monitoring_location.trim()||!content.activity_description.trim()||!content.staff_evaluation.trim()||!content.staff_opinion.trim())
    throw fail(400,'작성 완료하려면 점검일시·장소·활동내용·평가·의견을 입력해 주세요.');
   const currentReport=await reportFor(scope);
   if(!currentReport)throw fail(400,'사진을 첨부하기 위해 먼저 임시 저장해 주세요.');
   const ready=(await photosFor(currentReport.id)).filter(p=>p.upload_status==='ready');
   if(ready.length!==MAX_PHOTOS_PER_REPORT)throw fail(400,'실시한 동아리의 결과 작성 완료에는 사진 1장이 필요합니다.');
  }
  if(status==='not_conducted'&&!content.not_conducted_reason.trim())throw fail(400,'미실시 사유를 입력해 주세요.');
  const old=await reportFor(scope);
  if(old){
   if(!Number.isInteger(body.version)||body.version!==old.version)throw fail(409,'다른 화면에서 이 기록이 변경되었습니다. 다시 불러온 뒤 확인해 주세요.');
   const {data,error}=await supabase.from('monitoring_reports').update({...content,version:old.version+1})
    .eq('id',old.id).eq('version',old.version).select('*').maybeSingle();
   if(error)throw fail(500,'저장에 실패했습니다.');
   if(!data)throw fail(409,'다른 화면에서 먼저 저장했습니다. 다시 불러와 주세요.');
   await history(data.id,'save',group,old.status,data.status);return {report:data};
  }
  if(body.version!==null&&body.version!==undefined)throw fail(409,'서버에 새로운 기록이 작성되었습니다. 다시 불러와 주세요.');
  const {data,error}=await supabase.from('monitoring_reports').insert({
   academic_term:TERM,club_id:scope.club_id,created_by_group:group,...content
  }).select('*').single();
  if(error){
   if(error.code==='23505')throw fail(409,'다른 화면에서 먼저 작성했습니다. 다시 불러와 주세요.');
   throw fail(500,'최초 기록 저장에 실패했습니다.');
  }
  await history(data.id,'create',group,null,data.status);return {report:data};
 }
 if(body.action==='photo-start'){
  const scope=await findScope(body.clubId,group);
  const report=await reportFor(scope);
  if(!report)throw fail(400,'사진 첨부 전에 임시 저장을 해 주세요.');
  const filename=field(body.filename,'사진 이름',240);
  const size=Number(body.fileSize);
  const mime=String(body.mime||'').toLowerCase();
  const ext:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'};
  if(!ext[mime])throw fail(400,'JPG, PNG, WebP, HEIC, HEIF 사진만 지원합니다.');
  if(!Number.isSafeInteger(size)||size<=0||size>MAX_FILE)throw fail(400,'사진 크기는 파일당 최대 50MB 이내여야 합니다. 실제 프로젝트 한도는 다를 수 있습니다.');
  const photos=await photosFor(report.id);
  if(photos.filter(p=>p.upload_status==='pending').length)throw fail(409,'이미 진행 중이거나 실패한 업로드가 있습니다. 기존 업로드를 정리한 후 다시 첨부해 주세요.');
  if(photos.filter(p=>p.upload_status==='ready').length>MAX_PHOTOS_PER_REPORT)throw fail(409,'사진 연결 기록을 확인해야 합니다. 관리자에게 문의해 주세요.');
  const {data:recordSizes,error:sizeError}=await supabase.from('monitoring_report_photos').select('file_size');
  if(sizeError)throw fail(503,'현재 사진 사용량을 확인할 수 없습니다. 업로드를 중단합니다.');
  const totalUsed=(recordSizes||[]).reduce((sum,p)=>sum+Number(p.file_size||0),0);
  if(totalUsed+size>STORAGE_SOFT_LIMIT_BYTES)throw fail(413,'무료 저장소의 안전 용량(사진 총 850MB)에 도달했습니다. 기존 파일을 삭제하지 말고 관리자에게 문의해 주세요.');
  const photoId=crypto.randomUUID();
  const path=TERM+'/'+group+'/'+scope.club_id+'/'+photoId+'.'+ext[mime];
  const {data:created,error:createError}=await supabase.from('monitoring_report_photos').insert({
   id:photoId,report_id:report.id,storage_path:path,original_filename:filename,content_type:mime,
   file_size:size,display_order:photos.length,upload_status:'pending'
  }).select('id').single();
  if(createError||!created){
   if(createError?.code==='23505')throw fail(409,'다른 화면에서 사진 업로드가 진행 중입니다. 해당 작업을 확인해 주세요.');
   throw fail(500,'사진 업로드 정보를 생성하지 못했습니다.');
  }
  const {data:signed,error:signErr}=await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if(signErr||!signed){
   await supabase.from('monitoring_report_photos').delete().eq('id',photoId);
   throw fail(500,'사진 업로드 권한을 발급하지 못했습니다.');
  }
  const base=env('SUPABASE_URL').replace(/\.supabase\.co$/i,'.storage.supabase.co');
  return {photoId,path,token:signed.token,bucket:BUCKET,tusEndpoint:base+'/storage/v1/upload/resumable',maxBytes:MAX_FILE};
 }
 if(body.action==='photo-retry'){
  const {photo}=await photoBelongs(body.photoId,group);
  if(photo.upload_status!=='pending')throw fail(409,'이미 업로드가 완료된 사진입니다.');
  const {data,error}=await supabase.storage.from(BUCKET).createSignedUploadUrl(photo.storage_path);
  if(error||!data)throw fail(500,'재업로드 권한을 발급하지 못했습니다.');
  const base=env('SUPABASE_URL').replace(/\.supabase\.co$/i,'.storage.supabase.co');
  return {photoId:photo.id,path:photo.storage_path,token:data.token,bucket:BUCKET,tusEndpoint:base+'/storage/v1/upload/resumable'};
 }
 if(body.action==='photo-abort'){
  const {photo}=await photoBelongs(body.photoId,group);
  if(photo.upload_status!=='pending')throw fail(409,'저장 완료된 사진은 일반 삭제 기능을 사용해 주세요.');
  const {error:removeError}=await supabase.storage.from(BUCKET).remove([photo.storage_path]);
  if(removeError)throw fail(500,'미완료 사진 정리에 실패했습니다.');
  const {error}=await supabase.from('monitoring_report_photos').delete().eq('id',photo.id);
  if(error)throw fail(500,'미완료 사진 목록을 정리하지 못했습니다.');
  return {aborted:true};
 }
 if(body.action==='photo-finish'){
  const {photo}=await photoBelongs(body.photoId,group);
  const path=photo.storage_path;
  const pos=path.lastIndexOf('/');
  const {data:list,error}=await supabase.storage.from(BUCKET).list(path.slice(0,pos),{limit:100,search:path.slice(pos+1)});
  if(error)throw fail(500,'업로드된 사진을 확인하지 못했습니다.');
  const item=(list||[]).find(f=>f.name===path.slice(pos+1));
  if(!item)throw fail(409,'사진이 아직 서버에 업로드되지 않았습니다.');
  const actualSize=Number(item.metadata?.size||0);
  if(!Number.isFinite(actualSize)||actualSize!==photo.file_size)throw fail(409,'사진 용량이 전송 전후 다릅니다. 업로드 결과를 확인해 주세요.');
  const {data:swap,error:swapError}=await supabase.rpc('monitoring_finish_single_photo',{p_photo_id:photo.id,p_group:group});
  if(swapError)throw fail(409,'사진 교체 확정에 실패했습니다. 기존 사진은 유지됩니다. 다시 시도해 주세요.');
  const previousPath=swap?.replaced_path;
  if(typeof previousPath==='string'&&previousPath&&previousPath!==path){
   const {error:cleanupError}=await supabase.storage.from(BUCKET).remove([previousPath]);
   if(cleanupError)console.error('Prior photo cleanup needed',photo.report_id);
  }
  const updated=await queryOne('monitoring_report_photos','id',photo.id);
  const {data:signed}=await supabase.storage.from(BUCKET).createSignedUrl(path,600);
  return {photo:{...updated,preview_url:signed?.signedUrl||''}};
 }
 if(body.action==='photo-url'){
  const {photo}=await photoBelongs(body.photoId,group);
  if(photo.upload_status!=='ready')throw fail(409,'아직 업로드가 완료되지 않았습니다.');
  const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(photo.storage_path,600);
  if(error||!data)throw fail(500,'사진을 여는 데 실패했습니다.');
  return {url:data.signedUrl};
 }
 if(body.action==='photo-delete'){
  const {photo,report}=await photoBelongs(body.photoId,group);
  if(report.status==='completed')throw fail(409,'작성 완료 상태의 사진은 삭제할 수 없습니다. 새 사진으로 교체하거나 임시 저장 상태로 변경하세요.');
  const {error:storageError}=await supabase.storage.from(BUCKET).remove([photo.storage_path]);
  if(storageError)throw fail(500,'사진 파일 삭제에 실패했습니다. 기록은 유지됩니다.');
  const {error}=await supabase.from('monitoring_report_photos').delete().eq('id',photo.id);
  if(error)throw fail(500,'사진 목록 정리에 실패했습니다. 관리자에게 문의해 주세요.');
  return {deleted:true};
 }
 throw fail(400,'지원하지 않는 결과관리 작업입니다.');
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
 if(req.method!=='POST')return new Response('Method Not Allowed',{status:405,headers:CORS});
 try{
  if(Number(req.headers.get('content-length')||0)>100000)throw fail(413,'요청 본문이 너무 큽니다.');
  const raw=await req.text();
  if(raw.length>100000)throw fail(413,'요청 본문이 너무 큽니다.');
  let body: Record<string,unknown>;
  try{body=JSON.parse(raw)}catch{throw fail(400,'올바른 JSON 형식이 아닙니다.');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'요청 형식이 올바르지 않습니다.');
  const group=await groupFromToken(body.token);
  if(!group)throw fail(401,'담당자 인증이 만료되었습니다. 다시 로그인해 주세요.');
  const data=await route(body,group);return ok(data);
 }catch(e){
  const status=e instanceof HttpError?e.status:500;
  const message=e instanceof HttpError?e.message:'서버 처리 중 오류가 발생했습니다.';
  console.error('monitoring-reports',status,e instanceof Error?e.message.slice(0,140):'unknown');
  return new Response(JSON.stringify({ok:false,error:message}),{status,headers:{...CORS,'Content-Type':'application/json; charset=utf-8'}});
 }
});
