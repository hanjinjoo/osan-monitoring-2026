/* 데모 전용: 이 브라우저의 localStorage에만 저장됩니다. 실운영에 사용하지 마세요. */
import {validateReservation, isInRange, isWeekend, TIMES} from './utils.js';
const KEY = 'osan-monitoring-demo-state-v1';
const STAFF = { '900001':'integrated', '900002':'startup' }; // 데모 체험 번호, 실제 담당자 사번 아님
function read() {
  try { const v=JSON.parse(localStorage.getItem(KEY)||'{}'); return {reservations:Array.isArray(v.reservations)?v.reservations:[],blocks:Array.isArray(v.blocks)?v.blocks:[]}; }
  catch { return {reservations:[],blocks:[]}; }
}
function write(db) { localStorage.setItem(KEY,JSON.stringify(db)); }
function uuid() { return crypto.randomUUID?.() || String(Date.now())+String(Math.random()); }
export class DemoService {
  constructor(clubs,cfg) {this.clubs=clubs;this.cfg=cfg;}
  async state(group, token=null) {
    const d=read();
    const showCancelled = token && token===`demo-${group}`;
    return {reservations:d.reservations.filter(x=>x.reservation_group===group && (showCancelled||x.status==='confirmed')),
      blocks:d.blocks.filter(x=>x.reservation_group===group)};
  }
  async create({clubId,date,time}) {
    const club=this.clubs.find(x=>x.id===clubId); const db=read();
    const error=validateReservation(club,date,time,db.reservations,db.blocks,this.cfg);
    if(error) throw Error(error);
    const item={id:uuid(),club_id:club.id,reservation_group:club.reservation_group,reservation_date:date,reservation_time:time,status:'confirmed',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
    db.reservations.push(item);write(db);return item;
  }
  async login(code) {
    const group=STAFF[String(code)]||null;
    if(!group) throw Error('등록되지 않은 담당자 번호입니다.');
    return {group,token:`demo-${group}`};
  }
  _check(token,recordGroup) { if(token!==`demo-${recordGroup}`) throw Error('권한이 없는 예약 그룹입니다.'); }
  async update({token,reservationId,date,time}) {
    const db=read(),r=db.reservations.find(x=>x.id===reservationId && x.status==='confirmed');
    if(!r) throw Error('예약을 찾을 수 없습니다.');this._check(token,r.reservation_group);
    const club=this.clubs.find(x=>x.id===r.club_id);
    const error=validateReservation(club,date,time,db.reservations,db.blocks,this.cfg,r.id);
    if(error) throw Error(error);
    r.reservation_date=date;r.reservation_time=time;r.updated_at=new Date().toISOString();write(db);return r;
  }
  async cancel({token,reservationId}) {
    const db=read(),r=db.reservations.find(x=>x.id===reservationId && x.status==='confirmed');
    if(!r) throw Error('예약을 찾을 수 없습니다.');this._check(token,r.reservation_group);
    r.status='cancelled';r.updated_at=new Date().toISOString();write(db);return r;
  }
  async block({token,date,time,group}) {
    this._check(token,group);this._valid(date,time);
    const db=read();
    if(db.reservations.some(r=>r.status==='confirmed'&&r.reservation_group===group&&r.reservation_date===date&&r.reservation_time===time)) throw Error('해당 시간에 예약이 있어 차단할 수 없습니다.');
    if(!db.blocks.some(b=>b.reservation_group===group&&b.blocked_date===date&&b.blocked_time===time)) db.blocks.push({id:uuid(),reservation_group:group,blocked_date:date,blocked_time:time});
    write(db);return {success:true};
  }
  async blockDay({token,date,group}) {
    this._check(token,group);this._valid(date,TIMES[0]);
    const db=read();
    if(db.reservations.some(r=>r.status==='confirmed'&&r.reservation_group===group&&r.reservation_date===date))
      throw Error('이 날짜에는 이미 예약된 동아리가 있어 전체 차단할 수 없습니다. 기존 예약은 유지됩니다.');
    for(const time of TIMES){
      if(!db.blocks.some(b=>b.reservation_group===group&&b.blocked_date===date&&b.blocked_time===time))
        db.blocks.push({id:uuid(),reservation_group:group,blocked_date:date,blocked_time:time});
    }
    write(db);return {success:true,blocked_slots:TIMES.length};
  }
  async unblock({token,date,time,group}) {
    this._check(token,group);
    const db=read();db.blocks=db.blocks.filter(b=>!(b.reservation_group===group&&b.blocked_date===date&&b.blocked_time===time));write(db);return {success:true};
  }
  _valid(date,time) {
    if(!isInRange(date,this.cfg)||!TIMES.includes(time)) throw Error('운영 범위 밖의 일시입니다.');
    if(isWeekend(date)&&this.cfg.WEEKENDS_ENABLED!==true) throw Error('주말 예약은 설정되지 않았습니다.');
  }
}
