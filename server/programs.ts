import { exerciseIds } from '../src/exercises/types.js';
import type { TrainingGoal } from '../shared/workout.js';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ProgramPlan } from '../shared/program.js';
import { validDraft, type ProgramDraft } from '../shared/programDraft.js';
import { goalSchema, obj, workoutSchema } from './workoutSchema.js';
const id = { type:'string',minLength:1,maxLength:100 };
const seconds = { type:'integer',minimum:0,maximum:3600 };
export const planSchema = obj({ schemaVersion:{const:1},id,version:{type:'integer',minimum:1},origin:{enum:['catalog','personal']},ownerId:{anyOf:[id,{type:'null'}]},title:{type:'string',minLength:1,maxLength:100},description:{type:'string',maxLength:1000},
  steps:{type:'array',minItems:1,maxItems:12,items:obj({id:{...id,maxLength:64},exercise:{enum:[...exerciseIds]},goal:goalSchema,transitionSeconds:seconds})} });
export const programSnapshotSchema = obj({kind:{const:'program'},program:planSchema,mode:{enum:['camera','demo']},conditions:{type:'string',maxLength:200}});
export const programRecordSchema = obj({schemaVersion:{const:2},kind:{const:'program'},id,date:{type:'string',minLength:1,maxLength:40},program:planSchema,mode:{enum:['camera','demo']},conditions:{type:'string',maxLength:200},ended:{enum:['completed','interrupted']},duration:{type:'number',minimum:0,maximum:604800},steps:{type:'array',maxItems:12,items:workoutSchema}});
export function availablePrograms(db: Database.Database, ownerId: string | null): ProgramPlan[] {
  const rows = db.prepare("SELECT * FROM programs WHERE archived_at IS NULL AND (origin='catalog' OR owner_id=?) ORDER BY rowid DESC").all(ownerId) as {id:string;version:number;title:string;description:string;origin:ProgramPlan['origin'];owner_id:string|null}[];
  return rows.map(row => ({ schemaVersion:1,id:row.id,version:row.version,title:row.title,description:row.description,origin:row.origin,ownerId:row.owner_id,
    steps:(db.prepare('SELECT * FROM program_steps WHERE program_id=? ORDER BY position').all(row.id) as {id:string;exercise:ProgramPlan['steps'][number]['exercise'];sets:number;reps:number;rest_seconds:number;transition_seconds:number;goal_json:string|null}[]).map(s => ({id:s.id,exercise:s.exercise,goal:s.goal_json?JSON.parse(s.goal_json) as TrainingGoal:{sets:s.sets,reps:s.reps,restSeconds:s.rest_seconds},transitionSeconds:s.transition_seconds})) }));
}

export function registerPrograms(app: FastifyInstance, db: Database.Database,
  requireUser: (req: FastifyRequest) => {id:string}, optionalUser: (req: FastifyRequest) => {id:string}|undefined,
  fail: (status:number,code:string,message:string) => never) {
  const params = obj({id});
  const querystring = obj({});
  const draftSchema = obj({title:planSchema.properties.title,description:planSchema.properties.description,steps:planSchema.properties.steps});
  const find = (programId:string, userId:string|null) => availablePrograms(db,userId).find(p=>p.id===programId) ?? fail(404,'NOT_FOUND','Программа недоступна или удалена из списка. Старые результаты сохранены в истории.');
  const owned = (programId:string,userId:string) => {
    const plan=find(programId,userId);
    if(plan.origin!=='personal'||plan.ownerId!==userId) fail(404,'NOT_FOUND','Личная программа не найдена.');
    return plan;
  };
  const saveSteps = (p:ProgramPlan) => {
    db.prepare('DELETE FROM program_steps WHERE program_id=?').run(p.id);
    const insert=db.prepare('INSERT INTO program_steps (program_id,position,id,exercise,sets,reps,rest_seconds,transition_seconds,goal_json) VALUES (?,?,?,?,?,?,?,?,?)');
    p.steps.forEach((s,i)=>insert.run(p.id,i,s.id,s.exercise,s.goal.sets,s.goal.reps??null,s.goal.restSeconds,s.transitionSeconds,JSON.stringify(s.goal)));
    db.prepare('INSERT INTO program_versions VALUES (?,?,?,?)').run(p.id,p.version,JSON.stringify(p),new Date().toISOString());
  };
  const create = (draft:ProgramDraft,userId:string) => {
    if(!validDraft(draft)) fail(400,'INVALID_PROGRAM','Проверь название, шаги и параметры программы.');
    const program:ProgramPlan={...draft,title:draft.title.trim(),description:draft.description.trim(),schemaVersion:1,id:randomUUID(),version:1,origin:'personal',ownerId:userId};
    db.prepare('INSERT INTO programs (id,version,owner_id,origin,title,description) VALUES (?,?,?,?,?,?)').run(program.id,1,userId,'personal',program.title,program.description);
    saveSteps(program);return program;
  };
  app.get('/api/programs',{schema:{querystring}},async req=>({programs:availablePrograms(db,optionalUser(req)?.id??null)}));
  app.get('/api/me/programs',{schema:{querystring}},async req=>({programs:availablePrograms(db,requireUser(req).id).filter(p=>p.origin==='personal')}));
  app.get('/api/me/favorites',{schema:{querystring}},async req=>{
    const user=requireUser(req);
    const ids=new Set((db.prepare('SELECT program_id FROM program_favorites WHERE user_id=?').all(user.id) as {program_id:string}[]).map(r=>r.program_id));
    return {programs:availablePrograms(db,user.id).filter(p=>ids.has(p.id))};
  });
  app.get<{Params:{id:string}}>('/api/programs/:id',{schema:{params,querystring}},async req=>({program:find(req.params.id,optionalUser(req)?.id??null)}));
  app.post<{Body:ProgramDraft}>('/api/programs',{schema:{body:draftSchema,querystring}},async(req,reply)=>{
    const user=requireUser(req);return reply.code(201).send({program:db.transaction(()=>create(req.body,user.id))()});
  });
  app.put<{Params:{id:string};Body:ProgramDraft&{version:number}}>('/api/programs/:id',{schema:{params,querystring,body:obj({...draftSchema.properties,version:planSchema.properties.version})}},async req=>{
    const user=requireUser(req);
    return db.transaction(()=>{
      const previous=owned(req.params.id,user.id);
      if(previous.version!==req.body.version) fail(409,'PROGRAM_CHANGED','Программа изменена в другой вкладке. Сохрани черновик и открой актуальную версию.');
      if(!validDraft(req.body)) fail(400,'INVALID_PROGRAM','Проверь название, шаги и параметры программы.');
      const program:ProgramPlan={...previous,title:req.body.title.trim(),description:req.body.description.trim(),steps:req.body.steps,version:previous.version+1};
      db.prepare('UPDATE programs SET version=?,title=?,description=? WHERE id=?').run(program.version,program.title,program.description,program.id);
      saveSteps(program);return {program};
    })();
  });
  app.post<{Params:{id:string};Body:{version:number}}>('/api/programs/:id/copy',{schema:{params,querystring,body:obj({version:planSchema.properties.version})}},async(req,reply)=>{
    const user=requireUser(req);
    const program=db.transaction(()=>{
      const source=find(req.params.id,user.id);
      if(source.version!==req.body.version) fail(409,'PROGRAM_CHANGED','Программа изменилась. Открой её заново перед копированием.');
      return create({title:source.title,description:source.description,steps:source.steps},user.id);
    })();
    return reply.code(201).send({program});
  });
  app.delete<{Params:{id:string}}>('/api/programs/:id',{schema:{params,querystring}},async req=>{
    const user=requireUser(req);
    const row=db.prepare("SELECT id FROM programs WHERE id=? AND origin='personal' AND owner_id=?").get(req.params.id,user.id);
    if(!row) fail(404,'NOT_FOUND','Личная программа не найдена.');
    db.prepare('UPDATE programs SET archived_at=COALESCE(archived_at,?) WHERE id=?').run(new Date().toISOString(),req.params.id);
    return {ok:true};
  });
  app.put<{Params:{id:string}}>('/api/programs/:id/favorite',{schema:{params,querystring}},async req=>{
    const user=requireUser(req);find(req.params.id,user.id);
    db.prepare('INSERT OR IGNORE INTO program_favorites VALUES (?,?,?)').run(user.id,req.params.id,new Date().toISOString());
    return {ok:true};
  });
  app.delete<{Params:{id:string}}>('/api/programs/:id/favorite',{schema:{params,querystring}},async req=>{
    const user=requireUser(req);
    db.prepare('DELETE FROM program_favorites WHERE user_id=? AND program_id=?').run(user.id,req.params.id);
    return {ok:true};
  });
}
