-- PostgreSQL / Neon. Independent migration ledger; SQLite sources remain unchanged.
CREATE TABLE programs (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK(version >= 1),
  owner_id TEXT REFERENCES users(id),
  origin TEXT NOT NULL CHECK(origin IN ('catalog','personal')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  CHECK ((origin='catalog' AND owner_id IS NULL) OR (origin='personal' AND owner_id IS NOT NULL))
);
CREATE TABLE program_steps (
  program_id TEXT NOT NULL REFERENCES programs(id),
  position INTEGER NOT NULL CHECK(position >= 0),
  id TEXT NOT NULL,
  exercise TEXT NOT NULL CHECK(exercise IN ('squat','pushup')),
  sets INTEGER NOT NULL CHECK(sets BETWEEN 1 AND 100),
  reps INTEGER NOT NULL CHECK(reps BETWEEN 1 AND 1000),
  rest_seconds INTEGER NOT NULL CHECK(rest_seconds BETWEEN 0 AND 3600),
  transition_seconds INTEGER NOT NULL CHECK(transition_seconds BETWEEN 0 AND 3600),
  PRIMARY KEY(program_id, position), UNIQUE(program_id, id)
);
INSERT INTO programs (id,version,owner_id,origin,title,description) VALUES
 ('squat-intro',1,NULL,'catalog','Приседания · два подхода','Один шаг с двумя подходами приседаний без веса.'),
 ('pushup-intro',1,NULL,'catalog','Отжимания · два подхода','Один шаг с двумя подходами отжиманий.'),
 ('squat-pushup',1,NULL,'catalog','Приседания → отжимания','Два движения по очереди с отдыхом для смены положения.'),
 ('pushup-squat',1,NULL,'catalog','Отжимания → приседания','Начни с отжиманий, затем перейди к приседаниям без веса.'),
 ('alternating-three',1,NULL,'catalog','Приседания → отжимания → приседания','Три шага: приседания в начале и в конце.'),
 ('alternating-four',1,NULL,'catalog','Приседания и отжимания · два круга','Четыре последовательных шага, по одному подходу на каждом.'),
 ('mixed-sets',1,NULL,'catalog','Приседания и отжимания · по три подхода','Два шага с тремя подходами каждого упражнения.');
INSERT INTO program_steps VALUES
 ('squat-intro',0,'squat-1','squat',2,6,30,0),
 ('pushup-intro',0,'pushup-1','pushup',2,4,40,0),
 ('squat-pushup',0,'squat-1','squat',1,6,30,30),('squat-pushup',1,'pushup-1','pushup',1,4,40,0),
 ('pushup-squat',0,'pushup-1','pushup',1,5,40,40),('pushup-squat',1,'squat-1','squat',1,8,30,0),
 ('alternating-three',0,'squat-1','squat',1,6,30,30),('alternating-three',1,'pushup-1','pushup',1,4,40,40),('alternating-three',2,'squat-2','squat',1,6,30,0),
 ('alternating-four',0,'squat-1','squat',1,8,30,30),('alternating-four',1,'pushup-1','pushup',1,5,40,40),('alternating-four',2,'squat-2','squat',1,8,30,30),('alternating-four',3,'pushup-2','pushup',1,5,40,0),
 ('mixed-sets',0,'squat-1','squat',3,8,45,60),('mixed-sets',1,'pushup-1','pushup',3,5,45,0);
