/*
 * 공개 설정만 이 파일에 기입하세요. 사번/서비스롤 키는 절대로 넣지 마세요.
 * 데모: DEMO_MODE=true (이 브라우저에만 저장, 여러 기기에 공유 안 됨)
 * 운영: DEMO_MODE=false, API_URL='https://...supabase.co/functions/v1/monitoring-api'
 * 주말 예약은 운영자가 확정 후 true/false로 바꾸세요. null일 때 주말은 예약 불가입니다.
 */
window.MONITORING_CONFIG = Object.freeze({
  DEMO_MODE: false,
API_URL: 'https://irqovqzrdvqmuuuvxcmt.supabase.co/functions/v1/monitoring-api',
  WEEKENDS_ENABLED: null,
  FIRST_DATE: '2026-10-26',
  LAST_DATE: '2026-11-27',
  TIMEZONE: 'Asia/Seoul'
});
