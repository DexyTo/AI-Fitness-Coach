import type { ExerciseOptions, ExerciseResult, ExerciseType } from '../exercises/types';
import { criterionStatusLabels, reasonText } from '../exercises/types';
import { criterionName, exerciseRegistry, usesDumbbells } from '../exercises/registry';
import { exercisePose } from '../pose/exerciseDemo';
import { demoPose } from '../pose/demo';
import { edges, visible } from '../pose/landmarks';

export function ExerciseOptionsFields({exercise,value,onChange,disabled=false}:{exercise:ExerciseType;value:ExerciseOptions;onChange:(value:ExerciseOptions)=>void;disabled?:boolean}) {
  const def=exerciseRegistry[exercise];
  return <fieldset className='exercise-options' disabled={disabled}><legend>Вариант и параметры</legend><div className='goal-fields'>
    {def.variants.length>1&&<label>Вариант<select value={value.variant} onChange={e=>onChange({...value,variant:e.target.value as ExerciseOptions['variant']})}><option value='standing'>Стоя</option><option value='seated'>Сидя</option></select></label>}
    {(def.view==='side')&&<label>{exercise==='reverse_lunge'?'Передняя опорная нога':'Наблюдаемая сторона'}<select value={value.side} onChange={e=>onChange({...value,side:e.target.value as ExerciseOptions['side']})}><option value='left'>Левая анатомическая</option><option value='right'>Правая анатомическая</option></select></label>}
    {(exercise==='reverse_lunge'||exercise==='front_hold')&&<label>Лицо в исходном кадре<select value={value.facing} onChange={e=>onChange({...value,facing:e.target.value as ExerciseOptions['facing']})}><option value='right'>Вправо →</option><option value='left'>← Влево</option></select></label>}
    {usesDumbbells(exercise)&&<label>Вес одной гантели, кг · необязательно<input type='number' min='.1' max='200' step='.1' value={value.weightKg??''} onChange={e=>{const next={...value};if(e.target.value==='')delete next.weightKg;else next.weightKg=Number(e.target.value);onChange(next);}}/></label>}
  </div>{usesDumbbells(exercise)&&<p className='fine-print'>Вес указан вами. Камера не подтверждает наличие гантелей, их массу или равенство веса.</p>}</fieldset>;
}
export function ExerciseGuide({exercise}:{exercise:ExerciseType}) {
  const def=exerciseRegistry[exercise];
  const pose=exercise==='squat'||exercise==='pushup'?demoPose(exercise,0):exercisePose(exercise,0);
  return <section className='camera-guide'><strong>{def.equipment} · {def.view==='side'?'Камера сбоку':'Камера спереди'}</strong>
    <svg viewBox='0 0 320 165' role='img' aria-label={def.camera}><g fill='none' stroke='currentColor' strokeWidth='3' strokeLinecap='round'><rect x='8' y='65' width='24' height='20' rx='4'/><path d='m32 70 12-5v22l-12-5M20 86v28m30-38h18' /><path strokeDasharray='4 5' strokeWidth='1' d='M70 5h245v150H70z'/>{edges.filter(([a,b])=>visible(pose[a])&&visible(pose[b])).map(([a,b])=><line key={`${a}-${b}`} x1={80+pose[a].x*230} y1={pose[a].y*144} x2={80+pose[b].x*230} y2={pose[b].y*144}/>)}{def.points.filter(i=>visible(pose[i])).map(i=><circle key={i} cx={80+pose[i].x*230} cy={pose[i].y*144} r='2'/>)}</g><text x='8' y='137' fill='currentColor' fontSize='9'>КАМЕРА</text><text x='180' y='164' fill='currentColor' fontSize='10'>{def.view==='front'?'АНФАС':'ПРОФИЛЬ'}</text></svg>
    <p>{def.description}</p><p>{def.camera}</p><p><b>Подготовка:</b> {def.initial}</p><details><summary>Что можно оценить</summary><p>{def.limitation}</p><p>Пороговые углы — предварительные настройки распознавания. Они не задают персональную нагрузку.</p></details>
  </section>;
}
export function HoldSummary({result,exercise}:{result:ExerciseResult;exercise:ExerciseType}) {
  const hold=result.hold;if(!hold)return null;
  return <section aria-label='Результат удержания'><div className='result-grid'>
    {[[hold.creditedMs,'Засчитано, с'],[hold.longestMs,'Самый длинный отрезок, с'],[hold.deviationMs,'Отклонения, с'],[hold.unassessedMs,'Не оценено, с']].map(([v,label])=><div className='result-tile' key={label}><span>{label}</span><strong>{(Number(v)/1000).toFixed(1)}</strong></div>)}
  </div><p className='fine-print'>Подготовка и пропуски не добавляют засчитанное время. Длительность подхода включает подготовку.</p>
    <details><summary>Отрезки, критерии и причины</summary>{hold.intervals.length?hold.intervals.map((i,index)=><article className='attempt-item' key={index}><b>{({credited:'Засчитано',deviation:'Отклонение',unassessed:'Не оценено'})[i.status]} · {((i.endedAt-i.startedAt)/1000).toFixed(1)} с</b><ul>{Object.entries(i.criteria).map(([code,c])=><li key={code}>{criterionName(exercise,code as keyof typeof i.criteria)}: {criterionStatusLabels[c.status]}</li>)}{i.reasons.map((r,n)=><li key={n}>{reasonText(r)}</li>)}</ul></article>):<p>Новых интервалов наблюдения не было.</p>}</details>
  </section>;
}
export function SideSummary({result}:{result:ExerciseResult}) {
  return result.sides?<p className='side-summary'>Полные по сторонам: левая {result.sides.left} · правая {result.sides.right}. Стороны анатомические.</p>:null;
}
