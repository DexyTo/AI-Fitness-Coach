import { compare } from './compare';
import { parseAnnotation, parseRun } from './schema';
import { runVideo, sha256 } from './runner';
import './validation.css';

function element<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }
const video = element<HTMLVideoElement>('video');
const status = element<HTMLParagraphElement>('status');
const output = element<HTMLPreElement>('output');
const downloads = element<HTMLElement>('downloads');
let links: string[] = [];
function file(id: string) {
  const selected = element<HTMLInputElement>(id).files?.[0];
  if (!selected) throw new Error(`Выберите файл: ${id}`);
  return selected;
}
async function annotation() { return parseAnnotation(JSON.parse(await file('annotation-file').text())); }
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
  links.push(url);
  const link = document.createElement('a'); link.href = url; link.download = name; link.textContent = `Скачать ${name}`;
  downloads.append(link);
}
function action(id: string, work: () => Promise<void>) {
  element<HTMLButtonElement>(id).addEventListener('click', async () => {
    const controls = [...document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')];
    controls.forEach(c => { c.disabled = true; });
    links.forEach(url => URL.revokeObjectURL(url)); links = []; downloads.replaceChildren(); output.textContent = '';
    status.textContent = 'Обработка…';
    try { await work(); }
    catch (error) { status.textContent = `Ошибка: ${error instanceof Error ? error.message : String(error)}`; }
    finally { controls.forEach(c => { c.disabled = false; }); }
  });
}
action('inspect', async () => {
  const selected = file('video-file');
  const url = URL.createObjectURL(selected);
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timeout); video.onloadedmetadata = null; video.onerror = null; };
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Таймаут чтения видео')); }, 15000);
      video.onloadedmetadata = () => { cleanup(); resolve(); };
      video.onerror = () => { cleanup(); reject(new Error('Не удалось прочитать видео')); };
    });
    video.src = url; await loaded;
    output.textContent = JSON.stringify({ video: { sha256: await sha256(await selected.arrayBuffer()), durationMs: video.duration * 1000 },
      dimensions: { width: video.videoWidth, height: video.videoHeight } }, null, 2);
    status.textContent = 'Скопируйте video в разметку. Просмотр и разметку выполняйте по исходному видео.';
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
});
action('run', async () => {
  const reference = await annotation();
  const run = await runVideo(file('video-file'), reference, video, Number(element<HTMLInputElement>('interval').value),
    percent => { status.textContent = `Прогон: ${percent.toFixed(0)}%`; });
  // Keep the raw evidence downloadable even if comparison subsequently fails.
  download(`${reference.clipId}.run.json`, run);
  const report = compare(reference, run);
  download(`${reference.clipId}.report.json`, report);
  output.textContent = JSON.stringify(report, null, 2);
  status.textContent = 'Прогон завершён. Сохраните обе выгрузки в validation-private/.';
});
action('compare', async () => {
  const reference = await annotation();
  const run = parseRun(JSON.parse(await file('run-file').text()));
  const report = compare(reference, run);
  download(`${reference.clipId}.report.json`, report);
  output.textContent = JSON.stringify(report, null, 2);
  status.textContent = 'Сравнение завершено. Тип доказательств указан в evidence.';
});
