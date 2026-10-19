import {CATEGORIES,CATEGORY_KEYS,WEEKDAYS,TIMES,esc,toISO,fromISO,addDays,todaySeoul,isWeekend,isSelectable,dateLabel,sortBooking,validateReservation} from './utils.js';
import {Service} from './api.js';

const root=document.querySelector('#app');
const cfg=window.MONITORING_CONFIG || {};
const app={clubs:[],category:'major',selectedClub:'',month:new Date(2026,9,1,12),weekDate:'2026-10-26',view:'month',bookings:[],blocks:[],modal:null,busy:false,loading:true,adminGroup:null,token:null,adminSearch:'',adminFilter:'all',toast:null,toastTimer:null,updated:null};
let service;
const group=()=>app.adminGroup||CATEGORIES[app.category].group;
const clubById=id=>app.clubs.find(c=>c.id===id);
const activeBookings=()=>app.bookings.filter(r=>r.status==='confirmed');
const pillLabel=r=>{const club=clubById(r.club_id);return `${r.reservation_time.slice(0,5)} · ${club?.name||'알 수 없는 동아리'}`};
const groupTitle=g=>g==='startup'?'창업동아리 모니터링':'전공·취업·일반 통합 모니터링';

async function init(){
 try{
  const r=await fetch('./data/clubs.json',{cache:'no-store'});
  if(!r.ok) throw Error('동아리 명단 파일을 불러오지 못했습니다.');
  app.clubs=await r.json();service=new Service(app.clubs,cfg);
  await loadState();
 }catch(e){root.innerHTML=`<div class="app-shell"><section class="panel empty-state"><h2>사이트를 불러오지 못했습니다</h2><p>${esc(e.message)}</p><p>로컬 파일을 직접 여는 대신 웹서버로 실행해 주세요.</p></section></div>`;return;}
 render();
 window.setInterval(async()=>{if(app.busy||app.modal||document.hidden)return;try{await loadState(false);render()}catch{}},20000);
}
async function loadState(markLoading=true){
 if(markLoading)app.loading=true;
 const data=await service.call('state',{group:group(),token:app.token});
 app.bookings=data.reservations||[];app.blocks=data.blocks||[];app.updated=new Date();app.loading=false;
}
function flash(msg,error=false){app.toast={msg,error};render();clearTimeout(app.toastTimer);app.toastTimer=setTimeout(()=>{app.toast=null;render()},4300)}
function startBusy(){app.busy=true;render()}
function stopBusy(){app.busy=false;render()}
function modalError(e){app.modal={...app.modal,error:e.message||String(e)};app.busy=false;render()}
function elementToast(){return `<div class="toast-area" role="status" aria-live="polite">${app.toast?`<div class="toast ${app.toast.error?'error':''}"><span>${app.toast.error?'⚠':'✓'}</span><span>${esc(app.toast.msg)}</span></div>`:''}</div>`}

function head(){return `<header class="top-head">
 <div class="brand-row"><span class="brand-icon" aria-hidden="true">▦</span><div class="brand-text"><small>OSAN UNIVERSITY · 2026-2</small><h1>모니터링 일정 선택</h1></div></div>
 ${app.adminGroup?`<button class="button" data-action="logout">← 예약 화면으로</button>`:`<button class="button dark" data-action="login">🔒 일정 변경</button>`}
 </header>`}
function banners(){return `<section class="notice"><span class="notice-icon" aria-hidden="true">📅</span><div><strong>모니터링 기간 : 2026. 10. 26.(월) ~ 11. 27.(금)</strong><p>동아리를 선택하고 달력에서 날짜를 누른 뒤, 방문 시간을 예약해 주세요. 09:00~18:00 · 15분 간격 · 12:00~13:00 제외</p></div></section>
 ${cfg.DEMO_MODE?`<div class="banner-demo">⚠ <div><strong>데모 모드 · 실제 예약 서버 미연결</strong> — 예약 내용은 이 브라우저에만 저장됩니다. 다른 기기와 공유되지 않으며 실제 운영에는 사용할 수 없습니다.</div></div>`:''}
 ${cfg.WEEKENDS_ENABLED===null?'<div class="banner-demo">ℹ 주말 예약 여부가 미확정이므로 토·일요일은 일시적으로 선택할 수 없습니다. 운영 설정에서 결정해 주세요.</div>':''}`}
function tabs(){return `<div class="tabs" role="tablist" aria-label="동아리 유형">${CATEGORY_KEYS.map(key=>{const c=CATEGORIES[key];const count=app.clubs.filter(x=>x.category===key).length;return `<button type="button" role="tab" aria-selected="${app.category===key}" class="tab" data-action="category" data-value="${key}">${c.label}<span class="tab-count">${count}</span></button>`}).join('')}</div>`}
function clubSelector(){const list=app.clubs.filter(c=>c.category===app.category);return `<div class="picker-area"><div class="select-box"><label for="club-picker">${CATEGORIES[app.category].name}</label><select class="control" id="club-picker"><option value="">동아리명을 선택해 주세요</option>${list.map(c=>`<option value="${esc(c.id)}" ${app.selectedClub===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div><span class="picker-hint">예약된 시간은 모든 해당 담당자 그룹에 함께 반영됩니다.</span></div>`}
function monthTitle(){const d=app.view==='month'?app.month:fromISO(app.weekDate);return `${d.getFullYear()}년 ${d.getMonth()+1}월`}
function calendarDays(){
 if(app.view==='week'){
  const focus=fromISO(app.weekDate); const start=addDays(focus,-focus.getDay());return Array.from({length:7},(_,i)=>addDays(start,i));
 }
 const start=new Date(app.month.getFullYear(),app.month.getMonth(),1,12);const first=addDays(start,-start.getDay());
 const daysInMonth=new Date(start.getFullYear(),start.getMonth()+1,0).getDate();
 const total=Math.ceil((start.getDay()+daysInMonth)/7)*7;
 return Array.from({length:total},(_,i)=>addDays(first,i));
}
function calendar(){
 const days=calendarDays(); const byDate=new Map();for(const r of activeBookings()){const key=r.reservation_date;if(!byDate.has(key))byDate.set(key,[]);byDate.get(key).push(r)}
 return `<div class="calendar-toolbar"><div class="toolbar-buttons"><button class="button icon dark" data-action="prev" aria-label="이전 ${app.view==='month'?'달':'주'}">‹</button><button class="button icon dark" data-action="next" aria-label="다음 ${app.view==='month'?'달':'주'}">›</button><button class="button small muted" data-action="today">today</button></div><div class="calendar-title">${esc(monthTitle())}</div><div class="toolbar-view"><button class="button small ${app.view==='month'?'active':''}" data-action="view-month">월간</button><button class="button small ${app.view==='week'?'active':''}" data-action="view-week">주간</button></div></div>
 <div class="group-explain">${group()==='startup'?'창업동아리 16개 · 별도 담당자 예약 일정':'전공 43개 + 취업 19개 + 일반 10개 · 공통 예약 일정'}${app.loading?' · 새로고침 중…':''}</div>
 <div class="calendar-scroller"><div class="calendar ${app.view==='week'?'week-view':''}"><div class="weekdays">${WEEKDAYS.map((day,i)=>`<div class="weekday ${i===0?'sun':i===6?'sat':''}">${day}</div>`).join('')}</div>
 <div class="cal-grid">${days.map(date=>{
  const iso=toISO(date),inMonth=date.getMonth()===app.month.getMonth(),allowed=isSelectable(iso,cfg);const weekday=date.getDay();
  const all=(byDate.get(iso)||[]).sort(sortBooking);const show=app.view==='week'?all:all.slice(0,4);
  const tooltip=allowed?'이 날짜에 예약':'예약 불가 날짜';
  return `<div class="date-cell ${inMonth?'':'othermonth'} ${allowed?'bookable empty-eligible':'disabled-date'}" data-date="${iso}" role="button" tabindex="${allowed?0:-1}" aria-label="${esc(dateLabel(iso))} ${tooltip}">
   <div class="date-top"><span class="date-n ${weekday===0?'sun':weekday===6?'sat':''}">${date.getDate()}${app.view==='week'?'일':''}</span>${isWeekend(iso)&&cfg.WEEKENDS_ENABLED===null?'<span class="label-status">주말 미정</span>':''}</div>
   ${show.map(r=>{const type=clubById(r.club_id)?.category||'major';return `<button type="button" class="event-pill ${type}" data-action="detail" data-id="${esc(r.id)}" title="${esc(pillLabel(r))}">[${CATEGORIES[type].label}] ${esc(pillLabel(r))}</button>`}).join('')}
   ${all.length>show.length?`<button class="more-events" data-action="more" data-date="${iso}">+${all.length-show.length}건 더 보기</button>`:''}
   ${allowed&&!all.length?'<span class="empty-txt">＋ 날짜 선택</span>':''}
   </div>`;
 }).join('')}</div></div></div>
 <div class="footer-strip"><div class="legend">${CATEGORY_KEYS.map(k=>`<span class="legend-item"><span class="legend-dot" style="background:${CATEGORIES[k].color}"></span>${CATEGORIES[k].label}</span>`).join('')}</div><div>${app.updated?`업데이트 ${app.updated.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`:''} <button class="button small" data-action="refresh">↻ 새로고침</button></div></div>`;
}
function home(){return `<div class="app-shell">${head()}${banners()}<main class="panel">${tabs()}${clubSelector()}${calendar()}</main><div class="bottom-note">예약 완료 후 일정 변경 및 취소는 담당자를 통해서만 가능합니다.</div></div>`}

function admin(){
 const all=app.clubs.filter(c=>c.reservation_group===app.adminGroup);
 const active=activeBookings();const bookedCount=new Set(active.map(x=>x.club_id)).size;
 const query=app.adminSearch.trim().toLowerCase();const rows=[...app.bookings].sort(sortBooking).filter(r=>{
   const c=clubById(r.club_id);return (app.adminFilter==='all'||c?.category===app.adminFilter)&&(!query||c?.name.toLowerCase().includes(query));
 });
 const filterOptions=(app.adminGroup==='startup'?['startup']:['major','employment','general']);
 return `<div class="app-shell">${head()}${cfg.DEMO_MODE?banners().match(/<div class="banner-demo">[\s\S]*?<\/div><\/div>/)?.[0]||'':''}<main class="panel">
 <div class="admin-header"><div><span class="tag">담당자 전용 관리 화면</span><h2>${groupTitle(app.adminGroup)}</h2><p>예약 일정 변경·취소 및 특정 시간 차단을 관리합니다.</p></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="button" data-action="admin-block">＋ 시간 차단</button><button class="button" data-action="export">⇩ CSV 다운로드</button></div></div>
 <div class="stats"><div class="stat"><span>전체 동아리</span><strong>${all.length}</strong></div><div class="stat"><span>예약 완료</span><strong>${bookedCount}</strong></div><div class="stat"><span>미예약</span><strong>${all.length-bookedCount}</strong></div></div>
 <div class="admin-controls"><input class="control" id="admin-search" placeholder="동아리명 검색" value="${esc(app.adminSearch)}" aria-label="동아리명 검색"><select class="control" id="admin-category"><option value="all">전체 유형</option>${filterOptions.map(k=>`<option value="${k}" ${app.adminFilter===k?'selected':''}>${CATEGORIES[k].name}</option>`).join('')}</select><button class="button" data-action="admin-missing">미예약 동아리 보기</button><button class="button" data-action="refresh">↻ 새로고침</button></div>
 <div class="admin-list">${rows.length?`<table class="admin-table"><thead><tr><th>유형</th><th>동아리명</th><th>예약 날짜</th><th>시간</th><th>상태</th><th>관리</th></tr></thead><tbody>${rows.map(r=>{const c=clubById(r.club_id);return `<tr><td>${esc(CATEGORIES[c?.category||'major'].label)}</td><td><strong>${esc(c?.name)}</strong></td><td>${esc(r.reservation_date)}</td><td>${esc(r.reservation_time.slice(0,5))}</td><td><span class="tag ${r.status==='confirmed'?'green':'gray'}">${r.status==='confirmed'?'예약 완료':'취소'}</span></td><td>${r.status==='confirmed'?`<div class="table-actions"><button class="button small" data-action="edit" data-id="${esc(r.id)}">변경</button><button class="button small danger" data-action="cancel" data-id="${esc(r.id)}">취소</button></div>`:'—'}</td></tr>`}).join('')}</tbody></table>`:`<div class="empty-state"><div class="emoji">▤</div>표시할 예약이 없습니다.</div>`}</div>
 <div class="admin-bottom"><div class="config-tip">미예약 동아리는 '미예약 동아리 보기'에서 확인할 수 있습니다. 신규 예약은 일반 예약 화면에서 신청해 주세요.</div></div>
 </main></div>`;
}
function timeOpts(date, selected, gid, exclude=null){
 return `<option value="">시간을 선택해 주세요</option>`+TIMES.map(t=>{
  const already=app.bookings.some(r=>r.status==='confirmed'&&r.id!==exclude&&r.reservation_group===gid&&r.reservation_date===date&&r.reservation_time.slice(0,5)===t);
  const blocked=app.blocks.some(x=>x.reservation_group===gid&&x.blocked_date===date&&x.blocked_time.slice(0,5)===t);
  return `<option value="${t}" ${selected===t?'selected':''} ${already||blocked?'disabled':''}>${t}${already?' — 예약 완료':blocked?' — 선택 불가':''}</option>`;
 }).join('');
}
function modalWrap(title,content){return `<div class="modal-shade" id="modal-shade"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="button icon ghost" data-action="close" aria-label="닫기">×</button></div><div class="modal-content">${content}${app.modal?.error?`<div class="inline-error" role="alert">${esc(app.modal.error)}</div>`:''}</div></section></div>`}
function actions(yes,action,kind='primary'){return `<div class="modal-actions"><button class="button" data-action="close">닫기</button><button class="button ${kind}" data-action="${action}" ${app.busy?'disabled':''}>${app.busy?'처리 중…':yes}</button></div>`}
function modalHtml(){
 const m=app.modal;if(!m)return '';
 const club=clubById(m.clubId);
 if(m.type==='login')return modalWrap('담당자 인증',`<p>일정 변경 및 취소는 담당자만 가능합니다. 등록된 담당자 사번을 입력해 주세요.</p><div class="field"><label for="staff-code">담당자 사번</label><input id="staff-code" class="control" type="password" inputmode="numeric" autocomplete="off" placeholder="사번을 입력하세요"></div>${cfg.DEMO_MODE?'<div class="field-help">데모 체험 번호: 통합 900001 / 창업 900002 (실제 사번 아님)</div>':''}${actions('인증하기','confirm-login')}`);
 if(m.type==='booking')return modalWrap('모니터링 일정 예약',`<dl class="summary-box"><div class="summary-row"><dt>동아리 유형</dt><dd>${esc(CATEGORIES[club?.category||app.category].name)}</dd></div><div class="summary-row"><dt>동아리명</dt><dd>${esc(club?.name)}</dd></div><div class="summary-row"><dt>방문 날짜</dt><dd>${esc(dateLabel(m.date))}</dd></div></dl><div class="field"><label for="booking-time">방문 시간</label><select id="booking-time" class="control">${timeOpts(m.date,m.time,club?.reservation_group)}</select><div class="field-help">09:00~17:45 · 15분 간격 · 12:00~13:00 제외</div></div>${actions('예약 신청','booking-confirm')}`);
 if(m.type==='confirm')return modalWrap('예약 내용 최종 확인',`<p>아래 일정으로 예약하시겠습니까?</p><dl class="summary-box"><div class="summary-row"><dt>동아리명</dt><dd>${esc(club?.name)}</dd></div><div class="summary-row"><dt>방문 날짜</dt><dd>${esc(dateLabel(m.date))}</dd></div><div class="summary-row"><dt>방문 시간</dt><dd>${esc(m.time)}</dd></div></dl><p>예약 완료 후 일정 변경 및 취소는 담당자를 통해서만 가능합니다.</p><div class="modal-actions"><button class="button" data-action="back-booking">돌아가기</button><button class="button primary" data-action="commit-booking" ${app.busy?'disabled':''}>${app.busy?'처리 중…':'예약 확정'}</button></div>`);
 if(m.type==='detail'){
  const r=app.bookings.find(x=>x.id===m.id),c=clubById(r?.club_id);if(!r)return '';
  return modalWrap('모니터링 예약 상세',`<dl class="summary-box"><div class="summary-row"><dt>동아리 분류</dt><dd>${esc(CATEGORIES[c?.category||'major'].name)}</dd></div><div class="summary-row"><dt>동아리명</dt><dd>${esc(c?.name)}</dd></div><div class="summary-row"><dt>방문 날짜</dt><dd>${esc(dateLabel(r.reservation_date))}</dd></div><div class="summary-row"><dt>방문 시간</dt><dd>${esc(r.reservation_time.slice(0,5))}</dd></div></dl><p>일정 변경 또는 취소는 담당자에게 요청해 주세요.</p><div class="modal-actions"><button class="button primary" data-action="close">확인</button></div>`);
 }
 if(m.type==='more'){
  const items=activeBookings().filter(r=>r.reservation_date===m.date).sort(sortBooking);
  return modalWrap(`${dateLabel(m.date)} 예약 내역`,`<p>담당자 그룹에서 예약된 모든 일정입니다.</p>${items.map(r=>{const c=clubById(r.club_id);return `<div class="summary-box"><strong>${esc(r.reservation_time.slice(0,5))} · ${esc(c?.name)}</strong><div class="field-help">${esc(CATEGORIES[c?.category||'major'].name)}</div></div>`}).join('')}${actions('확인','close')}`);
 }
 if(m.type==='edit'){
  const r=app.bookings.find(x=>x.id===m.id),c=clubById(r?.club_id);if(!r)return '';
  return modalWrap('예약 일정 변경',`<p><strong>${esc(c?.name)}</strong> · 현재 ${esc(dateLabel(r.reservation_date))} ${esc(r.reservation_time.slice(0,5))}</p><div class="field"><label for="edit-date">변경할 날짜</label><input id="edit-date" type="date" class="control" min="${cfg.FIRST_DATE}" max="${cfg.LAST_DATE}" value="${esc(m.date)}"></div><div class="field"><label for="edit-time">변경할 시간</label><select id="edit-time" class="control">${timeOpts(m.date,m.time,app.adminGroup,r.id)}</select></div>${actions('변경 확정','commit-edit')}`);
 }
 if(m.type==='cancel'){
  const r=app.bookings.find(x=>x.id===m.id),c=clubById(r?.club_id);if(!r)return '';
  return modalWrap('예약 취소 확인',`<p><strong>${esc(c?.name)}</strong>의 예약을 취소하시겠습니까?</p><dl class="summary-box"><div class="summary-row"><dt>예약 일시</dt><dd>${esc(dateLabel(r.reservation_date))} ${esc(r.reservation_time.slice(0,5))}</dd></div></dl><p>취소하면 해당 시간은 다시 예약 가능한 상태가 됩니다.</p>${actions('예약 취소','commit-cancel','danger')}`);
 }
 if(m.type==='block'){
  const blocks=[...app.blocks].sort((a,b)=>a.blocked_date.localeCompare(b.blocked_date)||a.blocked_time.localeCompare(b.blocked_time));
  return modalWrap('담당자 시간 차단',`<p>자신의 예약 그룹에서만 선택한 시간을 예약 불가로 설정합니다.</p><div class="field"><label for="block-date">차단 날짜</label><input class="control" type="date" id="block-date" min="${cfg.FIRST_DATE}" max="${cfg.LAST_DATE}" value="${esc(m.date)}"></div><div class="field"><label for="block-time">차단 시각</label><select id="block-time" class="control">${timeOpts(m.date,m.time,app.adminGroup)}</select></div><div class="modal-actions"><button class="button" data-action="close">닫기</button><button class="button primary" data-action="commit-block" ${app.busy?'disabled':''}>시간 차단</button></div><div class="field"><label>현재 차단된 시간 (${blocks.length}개)</label><div class="block-list">${blocks.length?blocks.map(b=>`<span class="block-chip">${esc(b.blocked_date)} ${esc(b.blocked_time.slice(0,5))}<button data-action="unblock" data-date="${esc(b.blocked_date)}" data-time="${esc(b.blocked_time.slice(0,5))}" aria-label="시간 차단 해제">×</button></span>`).join(''):'<span class="subtle">차단된 시간이 없습니다.</span>'}</div></div>`);
 }
 if(m.type==='missing'){
  const occupied=new Set(activeBookings().map(r=>r.club_id));const missing=app.clubs.filter(c=>c.reservation_group===app.adminGroup&&!occupied.has(c.id));
  const categories=app.adminGroup==='startup'?['startup']:['major','employment','general'];
  const selected=categories.includes(m.category)?m.category:categories[0];
  const visible=missing.filter(c=>c.category===selected);
  const categoryTabs=categories.length===1?'':`<div class='tabs' role='tablist' aria-label='미예약 동아리 유형'>${categories.map(key=>`<button type='button' role='tab' aria-selected='${selected===key}' class='tab' data-action='missing-category' data-value='${key}'>${CATEGORIES[key].label}<span class='tab-count'>${missing.filter(c=>c.category===key).length}</span></button>`).join('')}</div>`;
  return modalWrap(`미예약 동아리 (${missing.length}개)`,`${categoryTabs}<div style="max-height:53vh;overflow:auto">${visible.length?visible.map(c=>`<div style="padding:10px;border-bottom:1px solid #e8eef4"><strong>${esc(c.name)}</strong> <span class="tag gray">${CATEGORIES[c.category].label}</span></div>`).join(''):missing.length?'<p>선택한 유형의 미예약 동아리가 없습니다.</p>':'<p>모든 동아리가 예약을 완료했습니다.</p>'}</div>${actions('확인','close')}`);
 }
 return '';
}
function render(){root.innerHTML=(app.adminGroup?admin():home())+modalHtml()+elementToast();if(app.modal?.type==='login')root.querySelector('#staff-code')?.focus()}
function csvExport(){
 const rows=[['유형','동아리명','방문 날짜','방문 시간','예약 상태']];
 for(const r of [...app.bookings].sort(sortBooking)){
  const c=clubById(r.club_id);rows.push([CATEGORIES[c?.category||'major'].name,c?.name||'',r.reservation_date,r.reservation_time.slice(0,5),r.status==='confirmed'?'예약 완료':'취소']);
 }
 const sanitize=s=>{let x=String(s);if(/^[=+@\-\t\r]/.test(x))x="'"+x;return '"'+x.replaceAll('"','""')+'"'};
 const content='\ufeff'+rows.map(r=>r.map(sanitize).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
 const anchor=document.createElement('a');anchor.href=url;anchor.download=`동아리_모니터링_${app.adminGroup}_${toISO(new Date())}.csv`;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function execute(action,data,msg){startBusy();try{await service.call(action,data);app.modal=null;await loadState();app.busy=false;flash(msg);}catch(e){modalError(e)}}
async function refresh(){try{app.busy=true;render();await loadState();app.busy=false;flash('최신 예약 현황을 불러왔습니다.')}catch(e){app.busy=false;flash(e.message,true)}}

root.addEventListener('click',async e=>{
 const target=e.target.closest('[data-action]');
 if(!target){const cell=e.target.closest('.date-cell[data-date]');if(cell&&!app.adminGroup&&isSelectable(cell.dataset.date,cfg))openBooking(cell.dataset.date);else if(e.target.id==='modal-shade'&&!app.busy){app.modal=null;render()}return;}
 const {action,value,id,date,time}=target.dataset;
 if(app.busy)return;
 if(action==='category'){app.category=value;app.selectedClub='';app.modal=null;try{await loadState()}catch(ex){flash(ex.message,true)}render();return}
 if(action==='prev'||action==='next'){
  const offset=action==='prev'?-1:1;
  if(app.view==='month')app.month=new Date(app.month.getFullYear(),app.month.getMonth()+offset,1,12);
  else app.weekDate=toISO(addDays(fromISO(app.weekDate),offset*7));render();return;
 }
 if(action==='today'){const t=fromISO(todaySeoul());app.month=new Date(t.getFullYear(),t.getMonth(),1,12);app.weekDate=toISO(t);render();return}
 if(action==='view-month'){app.view='month';app.month=new Date(fromISO(app.weekDate).getFullYear(),fromISO(app.weekDate).getMonth(),1,12);render();return}
 if(action==='view-week'){app.view='week';app.weekDate=app.month.getFullYear()===2026&&app.month.getMonth()===9?'2026-10-26':toISO(new Date(app.month.getFullYear(),app.month.getMonth(),1,12));render();return}
 if(action==='detail'){app.modal={type:'detail',id};render();return}
 if(action==='more'){app.modal={type:'more',date};render();return}
 if(action==='close'){app.modal=null;render();return}
 if(action==='login'){app.modal={type:'login'};render();return}
 if(action==='confirm-login'){
  const code=root.querySelector('#staff-code')?.value?.trim();if(!code){app.modal.error='사번을 입력해 주세요.';render();return}
  startBusy();try{const result=await service.call('login',{code});app.adminGroup=result.group;app.token=result.token;app.adminSearch='';app.adminFilter='all';app.modal=null;await loadState();app.busy=false;flash('담당자 인증이 완료되었습니다.')}catch(ex){modalError(ex)}return;
 }
 if(action==='logout'){app.adminGroup=null;app.token=null;app.adminSearch='';app.adminFilter='all';try{await loadState()}catch(ex){flash(ex.message,true)}render();return}
 if(action==='booking-confirm'){
  const time=root.querySelector('#booking-time')?.value;const club=clubById(app.modal?.clubId);
  const err=validateReservation(club,app.modal.date,time,app.bookings,app.blocks,cfg);
  if(err){app.modal.error=err;render();return}
  app.modal={...app.modal,type:'confirm',time,error:null};render();return;
 }
 if(action==='back-booking'){app.modal={...app.modal,type:'booking'};render();return}
 if(action==='commit-booking'){await execute('create',{clubId:app.modal.clubId,date:app.modal.date,time:app.modal.time},'모니터링 일정이 정상적으로 예약되었습니다.');return}
 if(action==='edit'){const r=app.bookings.find(x=>x.id===id);if(!r)return;app.modal={type:'edit',id,date:r.reservation_date,time:r.reservation_time.slice(0,5)};render();return}
 if(action==='cancel'){app.modal={type:'cancel',id};render();return}
 if(action==='commit-edit'){
  const r=app.bookings.find(x=>x.id===app.modal.id);const c=clubById(r?.club_id);
  const err=validateReservation(c,app.modal.date,app.modal.time,app.bookings,app.blocks,cfg,r?.id);
  if(err){app.modal.error=err;render();return}
  await execute('update',{token:app.token,reservationId:app.modal.id,date:app.modal.date,time:app.modal.time},'모니터링 일정이 변경되었습니다.');return;
 }
 if(action==='commit-cancel'){await execute('cancel',{token:app.token,reservationId:app.modal.id},'모니터링 일정이 취소되었습니다.');return}
 if(action==='admin-block'){app.modal={type:'block',date:cfg.FIRST_DATE,time:''};render();return}
 if(action==='commit-block'){
  if(!app.modal.time){app.modal.error='차단할 시간을 선택해 주세요.';render();return}
  await execute('block',{token:app.token,date:app.modal.date,time:app.modal.time,group:app.adminGroup},'선택한 시간이 차단되었습니다.');return;
 }
 if(action==='unblock'){
  if(!confirm(`${date} ${time} 시간 차단을 해제하시겠습니까?`))return;
  startBusy();try{await service.call('unblock',{token:app.token,date,time,group:app.adminGroup});await loadState();app.modal={type:'block',date,time:''};app.busy=false;flash('시간 차단을 해제했습니다.')}catch(ex){modalError(ex)}return;
 }
 if(action==='missing-category'&&app.modal?.type==='missing'){
  if((app.adminGroup==='startup'?['startup']:['major','employment','general']).includes(value)){app.modal={...app.modal,category:value};render()}
  return;
 }
 if(action==='admin-missing'){app.modal={type:'missing'};render();return}
 if(action==='export'){csvExport();flash('예약 현황 CSV 파일을 생성했습니다.');return}
 if(action==='refresh'){await refresh();return}
});
function openBooking(date){
 if(!app.selectedClub){flash('먼저 동아리명을 선택해 주세요.',true);return}
 const club=clubById(app.selectedClub);
 if(app.bookings.some(r=>r.status==='confirmed'&&r.club_id===club.id)){flash('해당 동아리는 이미 모니터링 일정이 예약되어 있습니다.',true);return}
 app.modal={type:'booking',clubId:club.id,date,time:''};render();
}
root.addEventListener('change',e=>{
 if(e.target.id==='club-picker'){app.selectedClub=e.target.value;render();return}
 if(e.target.id==='booking-time'&&app.modal){app.modal.time=e.target.value;app.modal.error=null;return}
 if(e.target.id==='edit-date'&&app.modal){app.modal.date=e.target.value;app.modal.time='';app.modal.error=null;render();return}
 if(e.target.id==='edit-time'&&app.modal){app.modal.time=e.target.value;app.modal.error=null;return}
 if(e.target.id==='block-date'&&app.modal){app.modal.date=e.target.value;app.modal.time='';app.modal.error=null;render();return}
 if(e.target.id==='block-time'&&app.modal){app.modal.time=e.target.value;app.modal.error=null;return}
 if(e.target.id==='admin-category'){app.adminFilter=e.target.value;render();return}
});
root.addEventListener('input',e=>{
 if(e.target.id==='admin-search'){
  const selection=e.target.selectionStart;app.adminSearch=e.target.value;render();const input=root.querySelector('#admin-search');input?.focus();input?.setSelectionRange(selection,selection);
 }
});
root.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&app.modal&&!app.busy){app.modal=null;render();return}
 if((e.key==='Enter'||e.key===' ')&&e.target.classList.contains('date-cell')){e.preventDefault();if(isSelectable(e.target.dataset.date,cfg)&&!app.adminGroup)openBooking(e.target.dataset.date)}
 if(e.key==='Enter'&&e.target.id==='staff-code'){e.preventDefault();root.querySelector('[data-action="confirm-login"]')?.click()}
});
init();
