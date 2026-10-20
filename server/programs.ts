import type Database from 'better-sqlite3';
import type { ProgramPlan } from '../shared/program.js';
import { goalSchema, obj, workoutSchema } from './workoutSchema.js';
const id = { type:'string',minLength:1,maxLength:100 };
const seconds = { type:'integer',minimum:0,maximum:3600 };
export const planSchema = obj({ schemaVersion:{const:1},id,version:{type:'integer',minimum:1},origin:{enum:['catalog','personal']},ownerId:{anyOf:[id,{type:'null'}]},title:{type:'string',minLength:1,maxLength:100},description:{type:'string',maxLength:1000},
  steps:{type:'array',minItems:1,maxItems:12,items:obj({id:{...id,maxLength:64},exercise:{enum:['squat','pushup']},goal:goalSchema,transitionSeconds:seconds})} });
export const programSnapshotSchema = obj({kind:{const:'program'},program:planSchema,mode:{enum:['camera','demo']},conditions:{type:'string',maxLength:200}});
export const programRecordSchema = obj({schemaVersion:{const:2},kind:{const:'program'},id,date:{type:'string',minLength:1,maxLength:40},program:planSchema,mode:{enum:['camera','demo']},conditions:{type:'string',maxLength:200},ended:{enum:['completed','interrupted']},duration:{type:'number',minimum:0,maximum:604800},steps:{type:'array',maxItems:12,items:workoutSchema}});
export function catalog(db: Database.Database): ProgramPlan[] {
  const rows = db.prepare("SELECT * FROM programs WHERE origin='catalog' ORDER BY rowid").all() as {id:string;version:number;title:string;description:string}[];
  return rows.map(row => ({ schemaVersion:1,id:row.id,version:row.version,title:row.title,description:row.description,origin:'catalog',ownerId:null,
    steps:(db.prepare('SELECT * FROM program_steps WHERE program_id=? ORDER BY position').all(row.id) as {id:string;exercise:'squat'|'pushup';sets:number;reps:number;rest_seconds:number;transition_seconds:number}[]).map(s => ({id:s.id,exercise:s.exercise,goal:{sets:s.sets,reps:s.reps,restSeconds:s.rest_seconds},transitionSeconds:s.transition_seconds})) }));
}
