-- 2026-11-03: 겟잇뷰티 소속 학과 정정. 다른 동아리와 예약·결과 기록은 유지합니다.
-- 이미 정정된 데이터베이스에서 다시 실행해도 추가 변경이 없습니다.
UPDATE public.monitoring_report_scope AS s
SET department = '준오헤어시그니처과'
FROM public.clubs AS c
WHERE s.club_id = c.id
  AND c.id = 'major-015'
  AND c.name = '겟잇뷰티'
  AND s.department = '뷰티코스메틱계열';

SELECT c.id, c.name, s.academic_term, s.department
FROM public.clubs AS c
JOIN public.monitoring_report_scope AS s ON s.club_id = c.id
WHERE c.id = 'major-015' AND c.name = '겟잇뷰티';
