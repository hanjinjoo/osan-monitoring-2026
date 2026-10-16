export const CATEGORIES = Object.freeze({
  major: { label: '전공', name: '전공동아리', color: '#2779ca', group: 'integrated' },
  employment: { label: '취업', name: '취업동아리', color: '#ef8027', group: 'integrated' },
  startup: { label: '창업', name: '창업동아리', color: '#905be2', group: 'startup' },
  general: { label: '일반', name: '일반동아리', color: '#2c9369', group: 'integrated' }
});
export const CATEGORY_KEYS = ['major','employment','startup','general'];
export const WEEKDAYS = ['일','월','화','수','목','금','토'];
export const TIMES = (() => {
  const out = [];
  for (let minutes=9*60; minutes<18*60; minutes+=15) {
    if (minutes>=12*60 && minutes<13*60) continue;
    out.push(`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`);
  }
  return Object.freeze(out);
})();
export function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function toISO(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
export function fromISO(s) { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d,12); }
export function todaySeoul() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
export function isWeekend(dateISO) { return [0,6].includes(fromISO(dateISO).getDay()); }
export function isInRange(dateISO, cfg) { return dateISO>=cfg.FIRST_DATE && dateISO<=cfg.LAST_DATE; }
export function isSelectable(dateISO,cfg) {
  if (!isInRange(dateISO,cfg) || dateISO<todaySeoul()) return false;
  if (isWeekend(dateISO) && cfg.WEEKENDS_ENABLED !== true) return false;
  return true;
}
export function dateLabel(iso) {
  const d=fromISO(iso);
  return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}
export function addDays(date, n) { return new Date(date.getFullYear(),date.getMonth(),date.getDate()+n,12); }
export function slotKey(r) { return `${r.reservation_date}#${r.reservation_time.slice(0,5)}`; }
export function sortBooking(a,b) { return a.reservation_date.localeCompare(b.reservation_date) || a.reservation_time.localeCompare(b.reservation_time) || a.club_id.localeCompare(b.club_id); }
export function validateReservation(club, date, time, existing, blocked, cfg, editingId=null) {
  if (!club) return '동아리명을 선택해 주세요.';
  if (!isInRange(date,cfg)) return '모니터링 기간 내에서 날짜를 선택해 주세요.';
  if (date<todaySeoul()) return '이미 지난 날짜에는 예약할 수 없습니다.';
  if (isWeekend(date) && cfg.WEEKENDS_ENABLED !== true) return cfg.WEEKENDS_ENABLED===null ? '주말 예약 운영 여부가 아직 확정되지 않았습니다.' : '주말에는 예약할 수 없습니다.';
  if (!TIMES.includes(time)) return '운영시간(09:00~18:00, 점심시간 제외) 내 15분 단위로 선택해 주세요.';
  if (blocked.some(b=>b.reservation_group===club.reservation_group && b.blocked_date===date && b.blocked_time.slice(0,5)===time)) return '담당자가 예약을 차단한 시간입니다.';
  if (existing.some(r=>r.status==='confirmed' && r.id!==editingId && r.club_id===club.id)) return '해당 동아리는 이미 모니터링 일정이 예약되어 있습니다.';
  if (existing.some(r=>r.status==='confirmed' && r.id!==editingId && r.reservation_group===club.reservation_group && r.reservation_date===date && r.reservation_time.slice(0,5)===time)) return '선택한 시간은 이미 예약되었습니다.';
  return '';
}
