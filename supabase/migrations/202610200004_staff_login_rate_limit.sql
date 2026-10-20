-- 담당자 결과 사진 운영을 위한 기존 사번 인증의 무차별 대입 시도 완화
-- IP 해시 식별자를 DB에 저장하며 실제 사번/원본 IP는 저장하지 않음.
-- 별도의 기존 예약 로직/테이블 변경 없음.
BEGIN;
CREATE TABLE IF NOT EXISTS public.monitoring_staff_login_attempts (
  client_hash text PRIMARY KEY CHECK (length(client_hash)=64),
  attempts integer NOT NULL CHECK(attempts>=1),
  window_started timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.monitoring_staff_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monitoring_staff_login_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.monitoring_staff_login_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.monitoring_staff_login_rate_limit(p_client_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public','pg_temp' AS $$
DECLARE n integer;
BEGIN
 IF p_client_hash IS NULL OR length(p_client_hash)<>64 OR p_client_hash !~ '^[0-9a-f]+$' THEN
  RAISE EXCEPTION 'invalid login fingerprint';
 END IF;
 INSERT INTO public.monitoring_staff_login_attempts(client_hash,attempts,window_started)
 VALUES (p_client_hash,1,now())
 ON CONFLICT(client_hash) DO UPDATE SET
  attempts=CASE WHEN public.monitoring_staff_login_attempts.window_started<now()-interval '10 minutes'
   THEN 1 ELSE public.monitoring_staff_login_attempts.attempts+1 END,
  window_started=CASE WHEN public.monitoring_staff_login_attempts.window_started<now()-interval '10 minutes'
   THEN now() ELSE public.monitoring_staff_login_attempts.window_started END
 RETURNING attempts INTO n;
 RETURN n<=20;
END $$;
REVOKE ALL ON FUNCTION public.monitoring_staff_login_rate_limit(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.monitoring_staff_login_rate_limit(text) TO service_role;
COMMIT;
