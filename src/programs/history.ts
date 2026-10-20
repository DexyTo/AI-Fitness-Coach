import { same, validProgramRecord, type ProgramRecord } from '../../shared/program';
export const PROGRAM_HISTORY_KEY = 'playfit.programs.v2';
export function loadPrograms(): {records:ProgramRecord[];error:string;raw:string|null} {
  let raw:string|null = null;
  try {
    raw = localStorage.getItem(PROGRAM_HISTORY_KEY);
    if (raw === null) return {records:[],error:'',raw};
    const data = JSON.parse(raw);
    if (data.schemaVersion !== 2 || !Array.isArray(data.programs) || !data.programs.every(validProgramRecord) || new Set(data.programs.map((r:ProgramRecord)=>r.id)).size !== data.programs.length) throw Error();
    return {records:data.programs,error:'',raw};
  } catch { return {records:[],error:'История программ недоступна или повреждена. Исходные данные сохранены.',raw}; }
}
export function saveProgram(record:ProgramRecord) {
  const state = loadPrograms();
  if (state.error) throw Error(state.error);
  if (!validProgramRecord(record)) throw Error('Не удалось проверить результат программы. Экспортируй JSON.');
  const previous=state.records.find(r=>r.id===record.id);
  if(previous&&!same(previous,record))throw Error('С этим ID уже сохранён другой результат. Экспортируй текущий итог.');
  if(!previous)state.records.push(record);
  try { localStorage.setItem(PROGRAM_HISTORY_KEY,JSON.stringify({schemaVersion:2,programs:state.records})); }
  catch {throw Error('Не удалось записать программу: хранилище недоступно или заполнено. Экспортируй JSON.');}
}
