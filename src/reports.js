/* 담당자 전용 결과관리: 기존 예약 렌더러와 분리된 모듈.
 * 서버 전용 영구 저장 / 비공개 사진 TUS 업로드. localStorage에 개인정보 저장 금지.
 */
import {esc,CATEGORIES} from './utils.js';

const TERM='2026-2', MAX_PHOTO=50_000_000;
let root, config, group, token, onBack, onRoutePush, bookings, view, sessionId=0;
const tabs={integrated:['major','employment','general'],startup:['startup']};
const statusLabel={missing:'미작성',draft:'작성 중',completed:'작성 완료',not_conducted:'미실시'};
const fmtBytes=n=>n>=1024*1024?(n/1024/1024).toFixed(1)+' MB':Math.max(1,Math.ceil(n/1024))+' KB';
const selfState=()=>({page:'list',items:[],filter:'all',category:'all',search:'',selected:null,photos:[],pendingPhoto:null,recoverable:null,editMode:false,pendingReplacement:null,report:null,draft:null,dirty:false,saving:false,revision:0,photoUploads:[],message:'',error:'',loading:true});
let state=selfState(), autosaveTimer=null, activeUploads=new Set();
function uploadSignedPhoto(url,file,record){
 // Supabase SDK uploadToSignedUrl matches PUT multipart FormData; original bytes preserved.
 // A signed URL is a short-lived credential. Never log it or persist it.
 const expected=new URL(config.API_URL).origin;
 const target=new URL(url);
 if(target.origin!==expected||!target.pathname.startsWith('/storage/v1/object/upload/sign/'))
  throw new Error('보안상 허용되지 않은 사진 업로드 주소입니다.');
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();
  xhr.open('PUT',url,true);
  xhr.timeout=10*60*1000;
  const fail=()=>reject(new Error('사진 전송이 중단됐습니다. 네트워크 연결을 확인하고 재시도해 주세요.'));
  xhr.onerror=fail;xhr.ontimeout=fail;xhr.onabort=fail;
  xhr.upload.onprogress=e=>{
   if(e.lengthComputable&&e.total){
    record.percent=Math.min(99,Math.round(e.loaded/e.total*100));
    record.status='업로드 중';photoSectionUpdate();
   }
  };
  xhr.onload=()=>{
   if(xhr.status>=200&&xhr.status<300){record.percent=100;resolve();return}
   let explanation='';
   try{const r=JSON.parse(xhr.responseText);explanation=String(r?.message||r?.error||'').slice(0,110)}catch{}
   reject(new Error('사진 저장소 응답 '+xhr.status+(explanation?' · '+explanation:'')));
  };
  const data=new FormData();
  data.append('cacheControl','3600');
  data.append('',file,file.name);
  xhr.send(data);
 });
}
const selectedScope=()=>state.items.find(x=>x.club_id===state.selected);
function apiUrl(){
 const url=config.API_URL;
 if(!url||!url.endsWith('/monitoring-api'))throw Error('결과관리 API 설정이 올바르지 않습니다.');
 return url.replace(/\/monitoring-api$/,'/monitoring-reports');
}
async function api(action,body={}){
 let res;
 try{
  res=await fetch(apiUrl(),{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',
    body:JSON.stringify({action,token,...body})});
 }catch{throw Error('서버 연결이 끊어졌습니다. 인터넷 연결을 확인해 주세요.')}
 const obj=await res.json().catch(()=>null);
 if(!res.ok||!obj?.ok)throw Error(obj?.error||('서버 오류 ('+res.status+')'));
 return obj.data;
}
const labelOf=item=>item?.category==='major'?'전공 혁신사업':CATEGORIES[item?.category]?.name||'';
function stats(){
 const counts={missing:0,draft:0,completed:0,not_conducted:0};
 state.items.forEach(x=>counts[x.status||'missing']++);
 return counts;
}
const baseShell=inner=>'<div class="app-shell report-shell"><div class="report-header">'+
 '<div><div class="report-eyebrow">OSAN UNIVERSITY · 2026-2</div><h1>모니터링 결과 관리</h1><p>실제 점검 내용과 현장 사진을 안전하게 기록합니다.</p></div>'+
 '<button type="button" class="button" data-r-action="back">← 예약 관리로</button></div>'+inner+'</div>';
const banner=(text,error=false)=>text?'<div class="report-banner '+(error?'is-error':'')+'" role="'+(error?'alert':'status')+'">'+esc(text)+'</div>':'';
function listHtml(){
 const counts=stats();
 const groups=tabs[group];
 const allowed=state.items.filter(x=>(state.category==='all'||x.category===state.category)&&
  (state.filter==='all'||(x.status||'missing')===state.filter)&&
  (!state.search||x.name.toLowerCase().includes(state.search)||String(x.department||'').toLowerCase().includes(state.search)));
 const options=[['all','전체'],...groups.map(k=>[k,k==='major'?'전공 혁신사업':CATEGORIES[k].name])];
 const card=(x)=>'<button type="button" class="report-club" data-r-action="open" data-id="'+esc(x.club_id)+'">'+
  '<span class="report-club-main"><strong>'+esc(x.name)+'</strong><small>'+esc(labelOf(x))+(x.department?' · '+esc(x.department):'')+
  (x.monitoring_date?' · '+esc(x.monitoring_date):'')+'</small></span>'+
  '<span class="report-club-meta"><span class="report-status '+esc(x.status||'missing')+'">'+esc(statusLabel[x.status||'missing'])+'</span>'+(x.recoverable?'<span class="report-status draft">복구 가능</span>':'')+
  '<span class="report-photo-count">사진 '+Number(x.photoCount||0)+'장</span></span><span class="report-chevron">›</span></button>';
 return baseShell('<main class="panel report-panel">'+
  '<div class="report-section-head"><div><span class="tag">담당자 전용</span><h2>'+ (group==='startup'?'창업동아리':'통합 담당자')+' 결과 기록</h2>'+
  '<p>내 담당 동아리 '+state.items.length+'개 · 전체 결과관리 대상 81개. 예약 여부와 관계없이 모두 표시합니다.</p></div>'+
  '<button type="button" class="button small" data-r-action="reload">↻ 새로고침</button></div>'+
  '<div class="report-stats">'+[
   ['전체 대상',state.items.length,'total'],['미작성',counts.missing,'missing'],['작성 중',counts.draft,'draft'],
   ['작성 완료',counts.completed,'completed'],['미실시',counts.not_conducted,'not_conducted']
  ].map(([title,num,cls])=>'<button type="button" data-r-action="stat-filter" data-value="'+(cls==='total'?'all':cls)+'" aria-pressed="'+(state.filter===(cls==='total'?'all':cls))+'" class="report-stat '+cls+' '+(state.filter===(cls==='total'?'all':cls)?'chosen':'')+'"><span>'+title+'</span><strong>'+num+'</strong></button>').join('')+'</div>'+
  '<div class="report-filters"><div class="report-category">'+options.map(([val,title])=>'<button class="report-tab '+(state.category===val?'on':'')+
  '" type="button" data-r-action="category" data-value="'+esc(val)+'">'+esc(title)+'</button>').join('')+'</div>'+
  '<div class="report-search-row"><label class="report-input-wrap">동아리명·학과 검색<input class="control" type="search" id="report-search" value="'+esc(state.search)+'" placeholder="동아리명 또는 학과 입력"></label>'+
  '<label class="report-input-wrap">작성 상태<select class="control" id="report-filter">'+[['all','전체 상태'],...Object.entries(statusLabel)].map(([k,n])=>
   '<option value="'+k+'" '+(state.filter===k?'selected':'')+'>'+n+'</option>').join('')+'</select></label></div></div>'+
  '<div class="report-list-heading"><strong>동아리 목록</strong><span>'+allowed.length+'개 표시</span></div>'+
  '<div class="report-club-list">'+(allowed.length?allowed.map(card).join(''):'<div class="report-empty">조건에 맞는 동아리가 없습니다.</div>')+'</div>'+
  banner(state.message)+banner(state.error,true)+'</main>');
}
const draftFields=d=>({
 monitoring_date:d?.monitoring_date||'',monitoring_time:(d?.monitoring_time||'').slice(0,5),
 monitoring_location:d?.monitoring_location||'',activity_description:d?.activity_description||'',
 staff_evaluation:d?.staff_evaluation||'',staff_opinion:d?.staff_opinion||'',
 not_conducted_reason:d?.not_conducted_reason||'',status:d?.status||'draft'
});
function dateTimeFor(x){
 const booking=(bookings||[]).find(b=>b.club_id===x.club_id&&b.status==='confirmed');
 return {date:booking?.reservation_date||'',time:(booking?.reservation_time||'').slice(0,5),location:booking?.reservation_location||''};
}
function photoHtml(){
 const photoLocked=state.report?.status==='completed'&&!state.editMode;
 const photos=state.photos.map(p=>'<div class="report-photo-tile" data-photo-id="'+esc(p.id)+'">'+
  '<button type="button" class="report-photo-preview" data-r-action="view-photo" data-id="'+esc(p.id)+'" aria-label="고화질 사진 크게 보기">'+
  (p.preview_url?'<img loading="lazy" src="'+esc(p.preview_url)+'" alt="첨부된 활동 사진" />':'<span class="report-photo-fallback">🖼 사진</span>')+'</button>'+
  '<div class="report-photo-foot"><span title="'+esc(p.original_filename)+'">'+esc(p.original_filename)+'</span>'+
  (state.draft?.status==='completed'?'':'<button class="report-trash" type="button" data-r-action="delete-photo" data-id="'+esc(p.id)+'" aria-label="사진 삭제">×</button>')+'</div></div>').join('');
 const uploading=state.photoUploads.map(f=>'<div class="report-photo-tile report-photo-uploading"><div class="report-upload-symbol">↑</div>'+
  '<strong>'+esc(f.filename)+'</strong><progress value="'+f.percent+'" max="100"></progress>'+
  '<small>'+esc(f.status)+(f.percent>0?' · '+f.percent+'%':'')+'</small>'+
  (f.error?'<div class="report-failed-actions"><button type="button" class="button small" data-r-action="retry-photo" data-id="'+esc(f.id)+'">재시도</button><button type="button" class="button small" data-r-action="discard-photo" data-id="'+esc(f.id)+'">제거</button></div>':'')+'</div>').join('');
 return '<div class="report-photos-head"><h3>모니터링 진행 사진</h3><span>서버 보관 '+state.photos.length+'장</span></div>'+
  '<p class="report-helper">동아리당 사진은 정확히 1장입니다. 최대 50MB의 원본을 비공개 저장하며, 새 사진 저장이 성공하면 기존 사진을 교체합니다. 무료 플랜의 전체 사진 저장 한도는 약 850MB입니다.</p>'+
  '<div class="report-photo-actions"><button type="button" class="button" data-r-action="camera" '+(state.photoUploads.length||photoLocked?'disabled':'')+'>📷 '+(photos?'새 사진 촬영·교체':'카메라로 촬영')+'</button>'+
  '<button type="button" class="button" data-r-action="gallery" '+(state.photoUploads.length||photoLocked?'disabled':'')+'>▧ '+(photos?'갤러리 사진으로 교체':'갤러리에서 선택')+'</button>'+
  '<input id="report-camera-input" type="file" accept="image/*" capture="environment" hidden>'+
  '<input id="report-gallery-input" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" hidden></div>'+
  (state.pendingPhoto?'<div class="report-banner is-error">이전에 완료되지 않은 사진 업로드가 있습니다. 새 사진을 선택하기 전에 미완료 항목을 정리하세요. <button type="button" class="button small" data-r-action="discard-pending">미완료 업로드 정리</button></div>':'')+
  (state.pendingReplacement?'<div class="report-banner">교체할 새 사진: '+esc(state.pendingReplacement.name)+' · 수정사항 저장 후 업로드합니다. 저장 전 수정 취소 시 교체되지 않습니다.</div>':'')+
  '<div class="report-photo-grid">'+(photos+uploading||'<div class="report-empty report-photo-empty">첨부된 사진이 없습니다.</div>')+'</div>'+
  '<p class="report-helper">기존 사진이 있다면 새 사진 저장 성공 전까지 그대로 보존합니다. 작성 완료하려면 사진 1장이 필요해요. 촬영한 사진은 기기와 브라우저에 따라 카메라 앱 또는 카메라 선택 화면이 열릴 수 있습니다.</p>';
}
function editorHtml(){
 const x=selectedScope(),d=state.draft||draftFields(null);
 if(!x)return baseShell('<div class="panel report-panel">동아리를 선택해 주세요.</div>');
 const completed=state.saving?'저장 중…':state.dirty?'저장하지 않은 변경사항 있음':'서버 저장 완료';
  const locked=state.report?.status==='completed'&&!state.editMode;
  if(state.recoverable)return baseShell('<main class="panel report-panel"><button type="button" class="report-return" data-r-action="list">← 동아리 목록</button><h2>'+esc(x.name)+'</h2><p>삭제된 기록입니다. 작성 내용과 사진은 복구할 수 있습니다.</p><button type="button" class="button primary" data-r-action="restore-report">삭제 기록 복구</button>'+banner(state.error,true)+'</main>');
 const needReason=d.status==='not_conducted';
 return baseShell('<main class="panel report-panel"><button type="button" class="report-return" data-r-action="list">← 전체 동아리 목록</button>'+
  '<div class="report-section-head"><div><span class="tag">'+esc(labelOf(x))+'</span><h2>'+esc(x.name)+'</h2>'+
  '<p>'+esc(x.department||'학과 정보 없음')+(x.professor_name?' · 지도교수 '+esc(x.professor_name):'')+
  (x.student_representative?' · 대표학생 '+esc(x.student_representative):'')+'</p></div>'+
  '<span class="report-status '+esc(d.status)+'">'+esc(statusLabel[d.status])+'</span></div>'+
  '<fieldset class="report-editor-fields" '+(locked?'disabled':'')+'><div class="report-form-grid"><label>실제 점검 날짜<input type="date" class="control" data-report-field="monitoring_date" value="'+esc(d.monitoring_date)+'"></label>'+
  '<label>실제 점검 시간<input type="time" class="control" data-report-field="monitoring_time" value="'+esc(d.monitoring_time)+'"></label></div>'+
  '<label class="report-form-row">점검장소<input class="control" data-report-field="monitoring_location" maxlength="1000" placeholder="방문 장소를 입력해 주세요" value="'+esc(d.monitoring_location)+'"></label>'+
  '<label class="report-form-row">활동내용<textarea class="control" data-report-field="activity_description" maxlength="20000" rows="5" placeholder="현장에서 확인한 실제 활동 내용을 작성해 주세요.">'+esc(d.activity_description)+'</textarea></label>'+
  '<label class="report-form-row">담당자평가<textarea class="control" data-report-field="staff_evaluation" maxlength="20000" rows="4" placeholder="운영 현황과 점검 결과를 작성해 주세요.">'+esc(d.staff_evaluation)+'</textarea></label>'+
  '<label class="report-form-row">담당자의견<textarea class="control" data-report-field="staff_opinion" maxlength="20000" rows="4" placeholder="개선 필요사항이나 특이사항을 작성해 주세요.">'+esc(d.staff_opinion)+'</textarea></label>'+
  '<label class="report-form-row">미실시 사유 <small>(미실시 처리할 때 작성)</small><textarea class="control" data-report-field="not_conducted_reason" maxlength="3000" rows="2" placeholder="방문하지 못한 사유를 작성해 주세요.">'+esc(d.not_conducted_reason)+'</textarea></label>'+
  '</fieldset><div id="report-photo-section" class="report-photo-section">'+photoHtml()+'</div>'+
  '<div class="report-savebar"><div><strong id="report-save-state">'+esc(completed)+'</strong><small id="report-saved-time">'+(state.report?.updated_at?'최종 저장 '+esc(new Date(state.report.updated_at).toLocaleString('ko-KR')):'저장된 기록 없음')+'</small></div>'+
  '<div class="report-buttons">'+(locked?
   '<button type="button" class="button primary" data-r-action="edit-report">수정하기</button>':
   state.editMode?'<button type="button" class="button" data-r-action="cancel-edit">수정 취소</button><button type="button" class="button primary" data-r-action="save-edit">수정사항 저장</button>':
   '<button type="button" class="button" data-r-action="save-draft">임시 저장</button>'+
   '<button type="button" class="button primary" data-r-action="complete">작성 완료</button>'+
   '<button type="button" class="button danger" data-r-action="not-conducted">미실시 처리</button>')+
   (state.report?'<button type="button" class="button danger" data-r-action="delete-report">결과 기록 삭제</button>':'')+'</div></div>'+
  banner(state.message)+banner(state.error,true)+'</main>');
}
function render(){
 if(!root)return;
 if(state.loading){root.innerHTML=baseShell('<main class="panel report-panel"><div class="report-empty">결과 기록을 불러오는 중입니다…</div></main>');return}
 root.innerHTML=state.page==='list'?listHtml():editorHtml();
}
function photoSectionUpdate(){
 const el=root?.querySelector('#report-photo-section');
 if(el)el.innerHTML=photoHtml();
}
function saveIndicator(){
 const el=root?.querySelector('#report-save-state');
 if(el)el.textContent=state.saving?'서버에 저장 중…':state.dirty?'변경사항이 아직 저장되지 않았습니다.':'서버 저장 완료';
 const t=root?.querySelector('#report-saved-time');
 if(t&&state.report?.updated_at)t.textContent='최종 저장 '+new Date(state.report.updated_at).toLocaleString('ko-KR');
}
function setMessage(message,error=false){
 state.message=error?'':message;state.error=error?message:'';
 const existing=root?.querySelector('.report-banner');
 if(existing)existing.remove();
 if(state.page==='editor'){
  root?.querySelector('.report-panel')?.insertAdjacentHTML('beforeend',banner(state.message)+banner(state.error,true));
 }else render();
}
async function loadList(){
 const data=await api('reports-list');
 const byClub=new Map(data.clubs.map(c=>[c.id,c]));
 const byReport=new Map(data.reports.map(r=>[r.club_id,r]));
 state.items=data.scopes.map(x=>{
  const c=byClub.get(x.club_id)||{},r=byReport.get(x.club_id);
  return {...x,...c, status:r&&!r.deleted_at?r.status:'missing',recoverable:!!r?.deleted_at,monitoring_date:r&&!r.deleted_at?r.monitoring_date||'':'',
   photoCount:data.photoCounts?.[r?.id]||0,updated_at:r?.updated_at||null};
 });
 state.items.sort((a,b)=>(a.category||'').localeCompare(b.category||'')||a.name.localeCompare(b.name,'ko'));
}
async function open(clubId){
 if((state.dirty||state.pendingReplacement)&&state.editMode){setMessage('수정사항 저장 또는 수정 취소를 눌러 주세요.',true);return}
  if(state.dirty&&!(await save('draft')))return;
 const current=++sessionId;
 state.page='editor';state.selected=clubId;state.loading=true;state.message='';state.error='';state.photoUploads=[];render();
 try{
  const data=await api('report-get',{clubId});
  if(current!==sessionId)return;
  const x=selectedScope(),defaults=dateTimeFor(x);
  state.report=data.report;state.photos=data.photos;state.pendingPhoto=data.pendingPhoto||null;state.recoverable=data.recoverable||null;state.editMode=false;state.pendingReplacement=null;
  state.draft={...draftFields(data.report),
   monitoring_date:data.report?.monitoring_date||defaults.date,
   monitoring_time:(data.report?.monitoring_time||defaults.time||'').slice(0,5),monitoring_location:data.report?.monitoring_location||defaults.location};
  state.dirty=false;state.saving=false;state.revision=0;state.loading=false;render();
 }catch(e){state.loading=false;state.page='list';state.error=e.message;render()}
}
async function reload(){
 try{state.loading=true;render();await loadList();state.loading=false;state.error='';state.message='최신 기록을 불러왔습니다.';render()}
 catch(e){state.loading=false;state.error=e.message;render()}
}
function collect(){
 root?.querySelectorAll('[data-report-field]').forEach(input=>{
  state.draft[input.dataset.reportField]=input.value;
 });
}
function markDirty(){
 state.revision++;state.dirty=true;state.message='';state.error='';
 // 작성 완료 결과 수정은 완료 상태를 유지한다.
 saveIndicator();
 clearTimeout(autosaveTimer);
 if(!state.editMode)autosaveTimer=setTimeout(()=>{if(state.page==='editor'&&state.dirty)save('draft')},1800);
}
async function save(status){
 if(state.page!=='editor')return false;
 if(state.saving){
  for(let i=0;i<120&&state.saving;i++)await new Promise(r=>setTimeout(r,100));
  if(state.saving){setMessage('저장 중입니다. 잠시 후 다시 시도해 주세요.',true);return false}
 }
 collect();
 const current=state.selected;
 const effective=status||state.draft.status||'draft';
 if(effective==='not_conducted'&&!state.draft.not_conducted_reason.trim()){
  setMessage('미실시 사유를 먼저 입력해 주세요.',true);return false;
 }
 if(effective==='completed'){
  if(activeUploads.size){setMessage('사진 업로드가 완료된 후 작성 완료를 눌러 주세요.',true);return false}
  if(state.photoUploads.some(p=>p.error)||state.pendingPhoto){
    setMessage('미완료 사진을 재시도하거나 정리한 뒤 작성 완료해 주세요.',true);return false;
  }
  const d=state.draft;
  if(!d.monitoring_date||!d.monitoring_time||!d.monitoring_location.trim()||!d.activity_description.trim()||
    !d.staff_evaluation.trim()||!d.staff_opinion.trim()){
    setMessage('작성 완료하려면 점검일시·장소·활동내용·담당자평가·담당자의견을 모두 입력해 주세요.',true);return false;
  }
  if(state.photos.length!==1){
   setMessage('모니터링 완료에는 해당 동아리의 사진 1장을 첨부해야 해요.',true);return false;
  }
 }
 const rev=state.revision;
 const payload={clubId:current,version:state.report?.version??null,
   ...state.draft,status:effective};
 clearTimeout(autosaveTimer);state.saving=true;saveIndicator();
 try{
  const result=await api('report-save',payload);
  if(current!==state.selected)return false;
  state.report=result.report;state.draft.status=result.report.status;
  if(state.revision===rev)state.dirty=false;
  state.saving=false;saveIndicator();
  if(status==='completed'||status==='not_conducted'||status==='draft'){
   setMessage(effective==='completed'?'결과 기록을 작성 완료했습니다.':effective==='not_conducted'?'미실시로 저장했습니다.':'임시 저장했습니다.');
  }
  if(state.dirty&&state.page==='editor'&&!state.editMode){
   clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>save('draft'),350);
  }
  return true;
 }catch(e){state.saving=false;state.dirty=true;saveIndicator();setMessage(e.message,true);return false}
}
async function showList(){
 clearTimeout(autosaveTimer);
 if(state.photoUploads.some(p=>p.error)&&!window.confirm('업로드 실패한 사진이 있습니다. 목록을 나가면 재시도 대상이 사라집니다. 이동하시겠습니까?'))return;
 if(activeUploads.size){setMessage('사진 업로드 중입니다. 완료될 때까지 기다려 주세요.',true);return}
 if((state.dirty||state.pendingReplacement)&&state.editMode){setMessage('수정사항 저장 또는 수정 취소를 눌러 주세요.',true);return}
  if(state.dirty&&!(await save('draft')))return;
 sessionId++;state.page='list';state.selected=null;state.loading=true;render();
 try{await loadList();state.loading=false;state.message='';state.error='';render();return true}catch(e){state.loading=false;state.error=e.message;render();return false}
}
async function leave(){
 if(state.photoUploads.some(p=>p.error)&&!window.confirm('업로드 실패한 사진이 있습니다. 이 화면을 나가시겠습니까?'))return;
 if(activeUploads.size){setMessage('사진 업로드를 완료한 후 이동해 주세요.',true);return}
 if(state.page==='editor'&&(state.dirty||state.pendingReplacement)&&state.editMode){setMessage('수정사항 저장 또는 수정 취소를 눌러 주세요.',true);return}
  if(state.page==='editor'&&state.dirty&&!(await save('draft')))return;
 clearTimeout(autosaveTimer);sessionId++;root=null;onBack();return true;
}
async function imageUpload(file,existing=null){
 if(!file)return;
 const fileTypes=['image/jpeg','image/png','image/webp','image/heic','image/heif'];
 let mime=file.type.toLowerCase();
 if(!mime&&/\.heic$/i.test(file.name))mime='image/heic';
 if(!mime&&/\.heif$/i.test(file.name))mime='image/heif';
 if(!fileTypes.includes(mime)){setMessage('지원하지 않는 이미지 형식입니다: '+file.name,true);return}
 if(file.size<=0||file.size>MAX_PHOTO){setMessage('파일당 50MB 이내 이미지여야 합니다: '+file.name,true);return}
 if(state.pendingPhoto&&!existing){setMessage('이전의 미완료 사진을 먼저 정리해 주세요.',true);return}
 if(state.dirty||!state.report){if(!await save(state.editMode?'completed':'draft'))return}
 const record=existing||{id:crypto.randomUUID(),file,filename:file.name,percent:0,status:'업로드 준비 중',error:false};
 record.error=false;record.status='업로드 준비 중';record.percent=0;
 if(!existing)state.photoUploads.push(record);
 photoSectionUpdate();activeUploads.add(record.id);
 try{
  const signed=record.photoId
   ?await api('photo-retry',{photoId:record.photoId})
   :await api('photo-start',{clubId:state.selected,filename:file.name,fileSize:file.size,mime});
  record.photoId=signed.photoId;
  record.status=signed.alreadyUploaded?'사진 전송 완료 · 저장 확인 중':'고화질 사진 전송 중';photoSectionUpdate();
  if(!signed.alreadyUploaded){
  await uploadSignedPhoto(signed.uploadUrl,file,record);
  }
  const done=await api('photo-finish',{photoId:signed.photoId});
  state.photos=[done.photo];state.pendingPhoto=null;
  state.photoUploads=state.photoUploads.filter(p=>p.id!==record.id);
  photoSectionUpdate();
  setMessage('사진이 안전하게 저장됐습니다.');return true;
 }catch(e){
  record.error=true;record.status='업로드 실패: '+(e?.message||'네트워크 연결 확인');
  photoSectionUpdate();setMessage('사진 저장에 실패했습니다. 실패 항목의 재시도를 눌러 주세요.',true);return false;
 }finally{activeUploads.delete(record.id)}
}
async function photoFiles(files){
 if(!files?.length)return;
 if(state.editMode){
  const file=files[0];
  if(file.size>MAX_PHOTO||file.size<=0){setMessage('파일당 50MB 이내 사진을 선택해 주세요.',true);return}
  state.pendingReplacement=file;photoSectionUpdate();return;
 }
 if(state.photos.length&&!(window.confirm('기존 사진은 새 사진이 정상적으로 업로드된 후 교체됩니다. 계속할까요?')))return;
 await imageUpload(files[0]);
}
async function deletePhoto(id){
 if(!window.confirm('선택한 사진을 삭제할까요? 삭제하면 복구할 수 없습니다.'))return;
 try{
  await api('photo-delete',{photoId:id});
  state.photos=state.photos.filter(p=>p.id!==id);photoSectionUpdate();setMessage('사진을 삭제했습니다.');
 }catch(e){setMessage(e.message,true)}
}
async function bind(){
 root.addEventListener('click',async e=>{
  const b=e.target.closest('[data-r-action]');if(!b)return;
  const {rAction:action,id,value}=b.dataset;
  if(action==='back'){if(await leave())onRoutePush?.('admin');return}
  if(action==='list'){if(await showList())onRoutePush?.('reports');return}
  if(action==='reload'){await reload();return}
   if(action==='stat-filter'){state.filter=value;state.category='all';state.search='';render();return}
   if(action==='edit-report'){state.editMode=true;render();return}
   if(action==='cancel-edit'){state.dirty=false;state.pendingReplacement=null;await open(state.selected);return}
   if(action==='save-edit'){
    if(!await save('completed'))return;
    if(state.pendingReplacement){const file=state.pendingReplacement;state.pendingReplacement=null;if(!await imageUpload(file))return}
    await open(state.selected);return;
   }
   if(action==='delete-report'){
    const x=selectedScope();if(!state.report)return;
    if(!window.confirm(x.name+'의 모니터링 결과 기록을 삭제할까요?\n기존 예약은 유지되고 결과 기록과 사진은 복구할 수 있습니다.'))return;
    try{await api('report-delete',{clubId:state.selected,version:state.report.version});state.dirty=false;state.editMode=false;await showList();state.message='삭제된 기록은 해당 동아리를 다시 열면 복구할 수 있습니다.';render()}
    catch(e){setMessage(e.message,true)}
    return;
   }
   if(action==='restore-report'){
    try{await api('report-restore',{clubId:state.selected,version:state.recoverable.version});await open(state.selected)}
    catch(e){setMessage(e.message,true)}
    return;
   }
  if(action==='category'){state.category=value;render();return}
  if(action==='open'){await open(id);if(state.page==='editor'&&!state.loading&&state.selected===id)onRoutePush?.('report/'+id);return}
  if(action==='save-draft'){await save('draft');return}
  if(action==='complete'){if(await save('completed'))await open(state.selected);return}
  if(action==='not-conducted'){if(await save('not_conducted'))await open(state.selected);return}
  if(action==='camera'){root.querySelector('#report-camera-input')?.click();return}
  if(action==='gallery'){root.querySelector('#report-gallery-input')?.click();return}
  if(action==='delete-photo'){await deletePhoto(id);return}
  if(action==='view-photo'){
   try{const image=await api('photo-url',{photoId:id});window.open(image.url,'_blank','noopener,noreferrer')}
   catch(ex){setMessage(ex.message,true)}
   return;
  }
  if(action==='retry-photo'){
   const f=state.photoUploads.find(p=>p.id===id);
   if(f)await imageUpload(f.file,f)
  }
  if(action==='discard-pending'){
   if(!state.pendingPhoto)return;
   if(!window.confirm('이전 미완료 업로드를 정리하고 새 사진을 선택할까요? 기존에 저장 완료한 사진은 그대로 유지됩니다.'))return;
   try{await api('photo-abort',{photoId:state.pendingPhoto.id});state.pendingPhoto=null;photoSectionUpdate();setMessage('미완료 업로드를 정리했습니다.')}
   catch(ex){setMessage('미완료 업로드 정리에 실패했습니다. '+ex.message,true)}
   return;
  }
  if(action==='discard-photo'){
   const f=state.photoUploads.find(p=>p.id===id);
   if(f?.photoId){
    try{await api('photo-abort',{photoId:f.photoId})}
    catch(ex){setMessage('미완료 사진 정리에 실패했습니다. '+ex.message,true);return}
   }
   state.photoUploads=state.photoUploads.filter(p=>p.id!==id);photoSectionUpdate();
  }
 });
 root.addEventListener('input',e=>{
  const field=e.target.dataset.reportField;
  if(field&&state.page==='editor'){state.draft[field]=e.target.value;markDirty();return}
  if(e.target.id==='report-search'){
   const pos=e.target.selectionStart;state.search=e.target.value.toLowerCase();render();
   const x=root.querySelector('#report-search');x?.focus();x?.setSelectionRange(pos,pos);
  }
 });
 root.addEventListener('change',async e=>{
  if(e.target.dataset.reportField){state.draft[e.target.dataset.reportField]=e.target.value;markDirty();return}
  if(e.target.id==='report-filter'){state.filter=e.target.value;render();return}
  if(e.target.id==='report-camera-input'||e.target.id==='report-gallery-input'){
   const files=Array.from(e.target.files||[]);e.target.value='';
   await photoFiles(files);
  }
 });
 window.addEventListener('beforeunload',beforeUnload);
}
function beforeUnload(e){if(state.dirty||state.pendingReplacement||activeUploads.size){e.preventDefault();e.returnValue=''}}
export async function mountReports(element,opts){
 root=element;config=opts.config;group=opts.group;token=opts.token;onBack=opts.onBack;onRoutePush=opts.onRoutePush;bookings=opts.bookings||[];
 state=selfState();state.category='all';state.loading=true;render();
 // 한 페이지에서 한 번만 event handler 등록하고 다음 진입 시 갱신.
 if(!root.dataset.reportBound){root.dataset.reportBound='true';await bind();}
 try{await loadList();state.loading=false;render()}
 catch(e){state.loading=false;state.error='결과관리 서버가 아직 준비되지 않았거나 접속에 실패했습니다. '+e.message;render()}
}

/** Receive History API Back/Forward transitions (without pushing another entry). */
export async function navigateReportRoute(route){
 if(!root)return false;
 if(route==='reports')return state.page==='list'?true:!!(await showList());
 if(route.startsWith('report/')){
  const id=route.slice(7);
  if(state.page==='editor'&&state.selected===id)return true;
  if(!state.items.some(item=>item.club_id===id))return false;
  await open(id);
  return state.page==='editor'&&state.selected===id&&!state.loading;
 }
 if(route==='admin'||route==='home')return !!(await leave());
 return false;
}
