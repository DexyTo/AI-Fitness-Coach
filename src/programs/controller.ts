import { same, stepCompleted, validProgramRecord, type ProgramRecord, type ProgramSnapshot } from '../../shared/program';
import type { WorkoutRecord } from '../../shared/workout';

// Composes complete single-exercise sessions. A fresh TrainingController is mounted
// for every step; its analyzer and preparation never carry into another exercise.
export class ProgramController {
  readonly snapshot: ProgramSnapshot;
  readonly children: WorkoutRecord[] = [];
  phase: 'exercise' | 'transition' | 'paused' | 'next' | 'finished' = 'exercise';
  private remainingMs = 0;
  private until = 0;
  private final: ProgramRecord | null = null;
  constructor(snapshot:ProgramSnapshot, readonly id:string, readonly date:string, private startAt:number) { this.snapshot = structuredClone(snapshot); }
  get index() { return this.children.length; }
  checkpoint(now:number):ProgramRecord {
    return {schemaVersion:2,id:this.id,date:this.date,...structuredClone(this.snapshot),ended:'interrupted',duration:Math.max(0,(now-this.startAt)/1000),steps:structuredClone(this.children)};
  }
  restore(record:ProgramRecord) {
    if(this.children.length || this.final || !validProgramRecord(record) || record.id!==this.id || record.date!==this.date || record.mode!==this.snapshot.mode || record.conditions!==this.snapshot.conditions || !same(record.program,this.snapshot.program)) throw Error('Черновик не соответствует запуску.');
    this.children.push(...structuredClone(record.steps));
    if(this.index===this.snapshot.program.steps.length || (this.index>0&&!stepCompleted(this.children[this.index-1]))) {
      this.phase='finished';this.final=structuredClone(record);
    }
  }
  accept(record:WorkoutRecord, now:number) {
    if (this.children.some(c => c.id === record.id)) return;
    if (this.phase !== 'exercise') throw Error('Сейчас нельзя завершить шаг.');
    const step = this.snapshot.program.steps[this.index];
    if (!step || record.id !== `${this.id}:${this.index}` || record.exercise !== step.exercise || !same(record.goal,step.goal) || record.mode !== this.snapshot.mode || record.conditions !== this.snapshot.conditions) throw Error('Результат не соответствует шагу.');
    this.children.push(structuredClone(record));
    if (!stepCompleted(record)) { this.finish(now,true); return; }
    if (this.index === this.snapshot.program.steps.length) { this.finish(now); return; }
    this.remainingMs = step.transitionSeconds*1000;
    this.until = now + this.remainingMs;
    this.phase = this.remainingMs ? 'transition' : 'next';
  }
  remaining(now:number) {
    if (this.phase === 'transition') {
      this.remainingMs = Math.max(0,this.until-now);
      if (!this.remainingMs) this.phase = 'next';
    }
    return Math.ceil(this.remainingMs/1000);
  }
  pause(now:number) { this.remaining(now); if (this.phase === 'transition') this.phase = 'paused'; }
  resume(now:number) { if (this.phase === 'paused') { this.until = now+this.remainingMs; this.phase = 'transition'; } }
  next(now:number) { this.remaining(now); if (this.phase !== 'next') return false; this.phase = 'exercise'; return true; }
  finish(now:number, interrupted = false):ProgramRecord {
    if (!this.final) {
      this.phase = 'finished';
      this.final = {schemaVersion:2,kind:'program',id:this.id,date:this.date,mode:this.snapshot.mode,conditions:this.snapshot.conditions,program:structuredClone(this.snapshot.program),
        ended:!interrupted && this.children.length === this.snapshot.program.steps.length && this.children.every(stepCompleted) ? 'completed' : 'interrupted',duration:Math.max(0,(now-this.startAt)/1000),steps:structuredClone(this.children)};
    }
    return structuredClone(this.final);
  }
}
