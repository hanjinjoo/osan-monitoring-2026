/**
 * Supabase Edge Function: 공개 예약 조회/신청과 간단한 사번 기반 관리자 기능.
 * verify_jwt=false. 이 함수에서 입력/사번/서명 세션/예약 그룹을 검사하고
 * service_role을 통한 DB RPC만 허용합니다. service_role 키를 프런트엔드에 넣지 마세요.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors: Record<string,string>={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'content-type, authorization, apikey',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Cache-Control':'no-store',
};
const env=(name:string)=>Deno.env.get(name)||'';
const supabase=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{
  auth:{persistSession:false,autoRefreshToken:false},
});
const weekendEnabled=env('WEEKENDS_ENABLED')==='true';
const json=(data:unknown,status=200)=>new Response(JSON.stringify({ok:status<400,data:status<400?data:undefined,error:status>=400?String(data):undefined}),{
  status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'},
});
const isGroup=(x:unknown):x is 'integrated'|'startup'=>x==='integrated'||x==='startup';
const isDate=(x:unknown)=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(`${x}T12:00:00+09:00`));
const isTime=(x:unknown)=>typeof x==='string'&&/^\d{2}:\d{2}$/.test(x);
const isUuid=(x:unknown)=>typeof x==='string'&&/^[a-f0-9-]{36}$/i.test(x);

function bytesToB64Url(bytes:Uint8Array){return btoa(Array.from(bytes,x=>String.fromCharCode(x)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function b64UrlToBytes(value:string){const fixed=value.replace(/-/g,'+').replace(/_/g,'/');const raw=atob(fixed+'='.repeat((4-fixed.length%4)%4));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function secretKey(){
 const secret=env('MONITORING_SESSION_SECRET');
 if(secret.length<32)throw Error('관리자 세션 비밀키가 설정되지 않았습니다.');
 return await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
async function makeToken(group:'integrated'|'startup'){
 const payload=bytesToB64Url(new TextEncoder().encode(JSON.stringify({group,exp:Math.floor(Date.now()/1000)+60*60*2})));
 const sign=await crypto.subtle.sign('HMAC',await secretKey(),new TextEncoder().encode(payload));
 return `${payload}.${bytesToB64Url(new Uint8Array(sign))}`;
}
async function checkToken(token:unknown){
 if(typeof token!=='string'||token.length>2048)return null;
 const bits=token.split('.');if(bits.length!==2)return null;
 try{
  const okay=await crypto.subtle.verify('HMAC',await secretKey(),b64UrlToBytes(bits[1]),new TextEncoder().encode(bits[0]));
  if(!okay)return null;
  const payload=JSON.parse(new TextDecoder().decode(b64UrlToBytes(bits[0])));
  if(!isGroup(payload.group)||!Number.isInteger(payload.exp)||payload.exp<Math.floor(Date.now()/1000))return null;
  return payload.group as 'integrated'|'startup';
 }catch{return null;}
}
async function rpc(name:string, args:Record<string,unknown>){
 const {data,error}=await supabase.rpc(name,args);
 if(error)throw Error(error.message);
 return data;
}
function requireSlot(date:unknown,time:unknown){
 if(!isDate(date)||!isTime(time))throw Error('날짜 또는 시간 형식이 올바르지 않습니다.');
 if(date<'2026-10-26'||date>'2026-11-27')throw Error('모니터링 기간 외 날짜입니다.');
 const [hh,mm]=time.split(':').map(Number);
 if(hh<9||hh>=18||(hh===12)||mm%15!==0||mm<0||mm>=60)throw Error('예약 시간은 09:00~17:45이며 점심시간을 제외하고 15분 간격이어야 합니다.');
 const dow=new Date(`${date}T12:00:00+09:00`).getUTCDay();
 if((dow===0||dow===6)&&!weekendEnabled)throw Error('주말 예약 운영이 허용되지 않았습니다.');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(date<today)throw Error('이미 지난 날짜에는 예약할 수 없습니다.');
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return json('POST 방식으로 요청해 주세요.',405);
 try{
  const body=await req.json();
  if(!body||typeof body!=='object')return json('요청 형식이 올바르지 않습니다.',400);
  const {action}=body;
  if(action==='state'){
   if(!isGroup(body.group))return json('예약 그룹을 선택해 주세요.',400);
   let isAdmin=false;
   if(body.token){const staffGroup=await checkToken(body.token);if(staffGroup!==body.group)return json('담당자 인증이 만료되었거나 권한이 없습니다.',401);isAdmin=true;}
   let q=supabase.from('reservations').select('id,club_id,reservation_group,reservation_date,reservation_time,status,created_at,updated_at').eq('reservation_group',body.group).order('reservation_date').order('reservation_time');
   if(!isAdmin)q=q.eq('status','confirmed');
   const [res,blocks]=await Promise.all([q,supabase.from('blocked_slots').select('id,reservation_group,blocked_date,blocked_time').eq('reservation_group',body.group).order('blocked_date').order('blocked_time')]);
   if(res.error||blocks.error)throw Error(res.error?.message||blocks.error?.message);
   return json({reservations:res.data,blocks:blocks.data});
  }
  if(action==='create'){
   if(typeof body.clubId!=='string'||body.clubId.length>60)return json('동아리를 선택해 주세요.',400);
   requireSlot(body.date,body.time);
   return json(await rpc('monitoring_create_booking',{p_club_id:body.clubId,p_date:body.date,p_time:body.time,p_weekends:weekendEnabled}));
  }
  if(action==='login'){
   const code=String(body.code||'').trim();if(!/^\d{1,20}$/.test(code))return json('등록되지 않은 담당자 번호입니다.',401);
   const integrated=env('MONITORING_INTEGRATED_STAFF_CODE'),startup=env('MONITORING_STARTUP_STAFF_CODE');
   if(!integrated||!startup)return json('담당자 번호가 아직 운영 서버에 설정되지 않았습니다.',503);
   let group:'integrated'|'startup'|null=null;
   if(code===integrated)group='integrated';else if(code===startup)group='startup';
   if(!group)return json('등록되지 않은 담당자 번호입니다.',401);
   return json({group,token:await makeToken(group)});
  }
  if(['update','cancel','block','block-day','unblock'].includes(action)){
   const staffGroup=await checkToken(body.token);
   if(!staffGroup)return json('관리자 인증이 만료되었거나 권한이 없습니다.',401);
   if(action==='update'){
    if(!isUuid(body.reservationId))return json('예약 ID가 유효하지 않습니다.',400);
    requireSlot(body.date,body.time);
    return json(await rpc('monitoring_update_booking',{p_id:body.reservationId,p_group:staffGroup,p_date:body.date,p_time:body.time,p_weekends:weekendEnabled}));
   }
   if(action==='cancel'){
    if(!isUuid(body.reservationId))return json('예약 ID가 유효하지 않습니다.',400);
    return json(await rpc('monitoring_cancel_booking',{p_id:body.reservationId,p_group:staffGroup}));
   }
   if(body.group!==staffGroup)return json('담당하는 동아리 그룹이 아닙니다.',403);
   if(action==='block-day'){
    requireSlot(body.date,'09:00');
    return json(await rpc('monitoring_block_day',{p_group:staffGroup,p_date:body.date,p_weekends:weekendEnabled}));
   }
   if(!isDate(body.date)||!isTime(body.time))return json('날짜 또는 시간을 확인해 주세요.',400);
   if(action==='block'){
    requireSlot(body.date,body.time);
    return json(await rpc('monitoring_block_slot',{p_group:staffGroup,p_date:body.date,p_time:body.time,p_weekends:weekendEnabled}));
   }
   return json(await rpc('monitoring_unblock_slot',{p_group:staffGroup,p_date:body.date,p_time:body.time}));
  }
  return json('지원하지 않는 작업입니다.',400);
 }catch(e){
  const message=e instanceof Error?e.message:'서버 오류가 발생했습니다.';
  // 민감한 내부 설정값을 포함한 오류 전체를 응답하지 말 것.
  console.error('monitoring-api error',message.slice(0,200));
  const safe=/SUPABASE_|SECRET|connection refused|invalid API key/i.test(message)?'운영 서버 설정에 문제가 있습니다. 담당자에게 문의해 주세요.':message;
  return json(safe,400);
 }
});
