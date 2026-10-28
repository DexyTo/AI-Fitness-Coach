-- PostgreSQL / Neon. Independent migration ledger; SQLite sources remain unchanged.
-- Add templates without changing existing plans, snapshots or user data.
INSERT INTO programs (id,version,owner_id,origin,title,description) VALUES
 ('full-body-start',1,NULL,'catalog','Всё тело · без гантелей','Приседания, отжимания, ягодичный мостик и планка. Подготовь коврик и место для смены положения.'),
 ('lower-body',1,NULL,'catalog','Ноги и ягодицы','Приседания, выпады на каждую опорную ногу, мостик и стульчик. Понадобятся коврик и свободная стена.'),
 ('floor-workout',1,NULL,'catalog','На коврике','Ягодичный мостик, планка на предплечьях и отжимания. Все шаги выполняются на полу.'),
 ('dumbbell-upper',1,NULL,'catalog','Плечи · с гантелями','Жим стоя, подъёмы в стороны и удержание перед собой. Нужны две гантели; вес укажи в настройках шагов.'),
 ('standing-dumbbells',1,NULL,'catalog','С гантелями · стоя','Жим, подъёмы рук в стороны и боковые наклоны. Между шагами предусмотрено время для смены ракурса камеры.'),
 ('seated-press',1,NULL,'catalog','Жим гантелей · сидя','Два подхода жима сидя. Подготовь устойчивый стул и две гантели; вес выбирается в настройках шага.'),
 ('hold-circuit',1,NULL,'catalog','Удержания · три позиции','Планка, стульчик у стены и руки перед собой с гантелями. Цели заданы в секундах, а не повторах.'),
 ('lunge-bridge',1,NULL,'catalog','Выпады и мостик','Отдельный шаг выпадов на каждую опорную ногу, затем ягодичный мостик на коврике.');

WITH seed(program_id,position,id,exercise,sets,target,rest,transition,unit,variant,side) AS (VALUES
 ('full-body-start',0,'squat','squat',1,8,30,40,'reps','standard','left'),
 ('full-body-start',1,'pushup','pushup',1,5,40,40,'reps','standard','left'),
 ('full-body-start',2,'bridge','glute_bridge',1,8,30,30,'reps','standard','left'),
 ('full-body-start',3,'plank','forearm_plank',1,20,30,0,'seconds','standard','left'),
 ('lower-body',0,'squat','squat',2,8,40,40,'reps','standard','left'),
 ('lower-body',1,'lunge-left','reverse_lunge',1,6,30,30,'reps','standard','left'),
 ('lower-body',2,'lunge-right','reverse_lunge',1,6,30,40,'reps','standard','right'),
 ('lower-body',3,'bridge','glute_bridge',2,10,30,40,'reps','standard','left'),
 ('lower-body',4,'wall','wall_sit',1,20,30,0,'seconds','standard','left'),
 ('floor-workout',0,'bridge','glute_bridge',2,8,30,30,'reps','standard','left'),
 ('floor-workout',1,'plank','forearm_plank',2,20,40,40,'seconds','standard','left'),
 ('floor-workout',2,'pushup','pushup',2,5,40,0,'reps','standard','left'),
 ('dumbbell-upper',0,'press','overhead_press',2,8,45,40,'reps','standing','left'),
 ('dumbbell-upper',1,'raise','lateral_raise',2,8,45,40,'reps','standing','left'),
 ('dumbbell-upper',2,'hold','front_hold',1,15,40,0,'seconds','standing','left'),
 ('standing-dumbbells',0,'press','overhead_press',1,8,45,30,'reps','standing','left'),
 ('standing-dumbbells',1,'raise','lateral_raise',1,8,45,30,'reps','standing','left'),
 ('standing-dumbbells',2,'bend','side_bend',1,10,30,0,'reps','standing','left'),
 ('seated-press',0,'press-seated','overhead_press',2,8,45,0,'reps','seated','left'),
 ('hold-circuit',0,'plank','forearm_plank',1,20,30,40,'seconds','standard','left'),
 ('hold-circuit',1,'wall','wall_sit',1,20,30,40,'seconds','standard','left'),
 ('hold-circuit',2,'hold','front_hold',1,15,30,0,'seconds','standing','left'),
 ('lunge-bridge',0,'lunge-left','reverse_lunge',1,6,30,30,'reps','standard','left'),
 ('lunge-bridge',1,'lunge-right','reverse_lunge',1,6,30,40,'reps','standard','right'),
 ('lunge-bridge',2,'bridge','glute_bridge',2,8,30,0,'reps','standard','left')
)
INSERT INTO program_steps (program_id,position,id,exercise,sets,reps,rest_seconds,transition_seconds,goal_json)
SELECT program_id,position,id,exercise,sets,CASE WHEN unit='reps' THEN target END,rest,transition,
 jsonb_build_object('schemaVersion',2,'sets',sets,'restSeconds',rest,'unit',unit,
 CASE WHEN unit='seconds' THEN 'seconds' ELSE 'reps' END,target,
 'options',jsonb_build_object('variant',variant,'side',side,'facing','right'))::text
FROM seed;

INSERT INTO program_versions (program_id,version,snapshot_json,created_at)
SELECT p.id,p.version,playfit_program_snapshot(p.id),to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM programs p WHERE p.id IN ('full-body-start','lower-body','floor-workout','dumbbell-upper','standing-dumbbells','seated-press','hold-circuit','lunge-bridge');
