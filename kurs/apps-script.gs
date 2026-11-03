/**
 * Сервер платформы «Продюсер с нуля» на Google Таблице.
 *
 * Листы создаются сами при первом запросе:
 *   Ученики         — коды доступа, имена, статус
 *   Сдачи заданий   — ответы учеников; куратор ставит статус, оценку и комментарий
 *   Вопросы         — вопросы с фото; куратор пишет ответ в колонку «Ответ куратора»
 *   Дневник         — задачи на день и отчёты
 *   Разборы недели  — итоги недели для каждого ученика
 *   Прогресс        — пройденные уроки (служебный)
 *
 * Пароль админки задаётся при первом входе в админку и хранится в свойствах скрипта (ADMIN_KEY).
 * BOT_KEY — секрет для бота, добавляется в свойства скрипта, когда подключаем бота.
 */
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PHOTO_FOLDER = 'Платформа обучения — фото';
const T = {
  students:    { title: 'Ученики',        cols: ['Код', 'Имя', 'Telegram', 'Тариф / заметка', 'Выдан', 'Последний вход', 'Статус'] },
  submissions: { title: 'Сдачи заданий',  cols: ['ID', 'Код', 'Ученик', 'ID задания', 'Задание', 'Ответ ученика', 'Отправлено', 'Статус', 'Оценка', 'Комментарий куратора', 'Дата комментария'] },
  requests:    { title: 'Вопросы',        cols: ['ID', 'Код', 'Ученик', '№', 'Дата', 'Вопрос', 'Фото', 'Ответ куратора', 'Дата ответа'] },
  journal:     { title: 'Дневник',        cols: ['Код', 'Ученик', 'Дата', 'Задачи', 'Выполнено', 'Причины невыполнения', 'Задачи поставлены', 'Отчёт сдан', 'json'] },
  reviews:     { title: 'Разборы недели', cols: ['Код', 'Ученик', 'Неделя', 'Дней с отчётом', 'Вывод', 'Получилось', 'Фокус на неделю', 'Дата'] },
  progress:    { title: 'Прогресс',       cols: ['Код', 'Ученик', 'Обновлено', 'json'] }
};
const SUB_STATUS = ['На проверке', 'Принято', 'На доработке'];

/* ---------- таблица ---------- */
function sh_(key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const t = T[key];
  let sh = ss.getSheetByName(t.title);
  if (!sh) {
    sh = ss.insertSheet(t.title);
    sh.getRange(1, 1, 1, t.cols.length).setValues([t.cols]).setFontWeight('bold').setBackground('#EDF2FE').setFontColor('#0B1530');
    sh.setFrozenRows(1);
    if (key === 'submissions') {
      sh.getRange('H2:H').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(SUB_STATUS, true).build());
      sh.getRange('I2:I').setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(1, 10).build());
    }
    if (key === 'students') sh.getRange('G2:G').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['active', 'blocked'], true).build());
    if (key === 'journal' || key === 'progress') sh.hideColumns(t.cols.length);
    sh.getRange(1, 1, 1, t.cols.length).setWrap(true);
  }
  return sh;
}
function rows_(key) {
  const v = sh_(key).getDataRange().getValues();
  return v.slice(1).map((r, i) => ({ row: i + 2, v: r }));
}
function append_(key, arr) { sh_(key).appendRow(arr); }
function set_(key, row, col, val) { sh_(key).getRange(row, col).setValue(val); }
function str_(x) { return x instanceof Date ? Utilities.formatDate(x, 'Europe/Moscow', 'dd.MM.yyyy, HH:mm') : String(x == null ? '' : x); }
function now_() { return Utilities.formatDate(new Date(), 'Europe/Moscow', 'dd.MM.yyyy, HH:mm'); }
function short_() { return Utilities.formatDate(new Date(), 'Europe/Moscow', 'd MMM').replace('.', ''); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function lock_(fn) { const l = LockService.getScriptLock(); l.waitLock(15000); try { return fn(); } finally { l.releaseLock(); } }

/* ---------- ученики ---------- */
function student_(code) {
  const r = rows_('students').find(x => x.v[0] === code);
  return r ? { row: r.row, code: r.v[0], name: r.v[1], tg: r.v[2], note: r.v[3], created: str_(r.v[4]), last: str_(r.v[5]), status: r.v[6] || 'active' } : null;
}
function pubStudent_(s) { return { code: s.code, name: s.name, tg: s.tg, note: s.note, created: s.created, last: s.last, status: s.status }; }
function genCode_() {
  const used = new Set(rows_('students').map(x => x.v[0]));
  let c;
  do { c = ''; for (let i = 0; i < 8; i++) c += ALPH[Math.floor(Math.random() * ALPH.length)]; c = c.slice(0, 4) + '-' + c.slice(4); } while (used.has(c));
  return c;
}
function issue_(tg, note) {
  return lock_(() => {
    const s = { code: genCode_(), name: '', tg: tg, note: note || '', created: now_(), last: '', status: 'active' };
    append_('students', [s.code, s.name, s.tg, s.note, s.created, s.last, s.status]);
    return s;
  });
}

/* ---------- данные ученика ---------- */
function pull_(code) {
  const prog = rows_('progress').find(x => x.v[0] === code);
  const journal = {};
  rows_('journal').filter(x => x.v[0] === code).forEach(x => { try { journal[str_(x.v[2]).slice(0, 10)] = JSON.parse(x.v[8]); } catch (e) {} });
  const st = { 'Принято': 'accepted', 'На доработке': 'rework' };
  const submissions = rows_('submissions').filter(x => x.v[1] === code).map(x => ({
    taskId: x.v[3], answer: x.v[5], sentAt: str_(x.v[6]), status: st[x.v[7]] || 'review', score: x.v[8] || '', comment: x.v[9], commentAt: str_(x.v[10])
  }));
  const requests = rows_('requests').filter(x => x.v[1] === code).map(x => ({
    id: x.v[0], num: x.v[3], date: str_(x.v[4]), text: x.v[5], photos: String(x.v[6] || '').split('\n').filter(Boolean),
    reply: x.v[7], replyDate: str_(x.v[8]), status: x.v[7] ? 'answered' : 'waiting'
  })).reverse();
  const split = s => String(s || '').split('\n').map(t => t.replace(/^[•\-]\s*/, '').trim()).filter(Boolean);
  const reviews = rows_('reviews').filter(x => x.v[0] === code).map(x => ({
    week: x.v[2], done: x.v[3], summary: x.v[4], wins: split(x.v[5]), focus: split(x.v[6]), date: str_(x.v[7])
  })).reverse();
  let progress = null; try { progress = prog ? JSON.parse(prog.v[3]) : null; } catch (e) {}
  return { progress, journal, submissions, requests, reviews };
}
function saveProgress_(s, data) {
  return lock_(() => {
    const json = JSON.stringify({ lessons: data.lessons || {}, current: data.current || '' });
    const r = rows_('progress').find(x => x.v[0] === s.code);
    if (r) { set_('progress', r.row, 2, s.name); set_('progress', r.row, 3, now_()); set_('progress', r.row, 4, json); }
    else append_('progress', [s.code, s.name, now_(), json]);
  });
}
function saveDay_(s, date, e) {
  return lock_(() => {
    const tasks = (e.tasks || []);
    const list = tasks.map((t, i) => (i + 1) + '. ' + t.text).join('\n');
    const done = e.reported ? tasks.filter(t => t.done).length + ' из ' + tasks.length : '';
    const why = e.reported ? tasks.filter(t => t.done === false).map(t => '• ' + t.text + ' — ' + (t.why || '')).join('\n') : '';
    const vals = [s.code, s.name, "'" + date, list, done, why, e.planAt || '', e.reported ? (e.reportAt || 'да') : '', JSON.stringify(e)];
    const r = rows_('journal').find(x => x.v[0] === s.code && str_(x.v[2]).slice(0, 10) === date);
    if (r) sh_('journal').getRange(r.row, 1, 1, vals.length).setValues([vals]);
    else append_('journal', vals);
  });
}
function savePhotos_(list, code) {
  if (!list || !list.length) return [];
  const it = DriveApp.getFoldersByName(PHOTO_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER);
  return list.slice(0, 5).map((d, i) => {
    const m = String(d).match(/^data:(image\/\w+);base64,(.+)$/);
    if (!m) return '';
    const f = folder.createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], code + '_' + Date.now() + '_' + i + '.jpg'));
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w1200';
  }).filter(Boolean);
}

/* ---------- кабинет куратора ---------- */
function json_(v) { try { return JSON.parse(v); } catch (e) { return null; } }
function adminData_() {
  const studs = rows_('students').map(x => ({ code: x.v[0], name: x.v[1], tg: x.v[2], note: x.v[3], created: str_(x.v[4]), last: str_(x.v[5]), status: x.v[6] || 'active' }));
  const subs = rows_('submissions').map(x => ({ id: String(x.v[0]), code: x.v[1], name: x.v[2], taskId: x.v[3], task: x.v[4], answer: x.v[5], sentAt: str_(x.v[6]), status: x.v[7] || 'На проверке', score: x.v[8], comment: x.v[9] }));
  const reqs = rows_('requests').map(x => ({ id: String(x.v[0]), code: x.v[1], name: x.v[2], num: x.v[3], date: str_(x.v[4]), text: x.v[5], photos: String(x.v[6] || '').split('\n').filter(Boolean), reply: x.v[7], replyDate: str_(x.v[8]) }));
  const prog = {}; rows_('progress').forEach(x => { const p = json_(x.v[3]); if (p) prog[x.v[0]] = p; });
  const jr = {}; rows_('journal').forEach(x => { (jr[x.v[0]] = jr[x.v[0]] || []).push({ date: str_(x.v[2]).slice(0, 10), entry: json_(x.v[8]) || { tasks: [] } }); });
  const latest = {}; subs.forEach(s => { latest[s.code + '|' + s.taskId] = s; });
  const last = Object.values(latest);
  const students = studs.map(st => {
    const mine = last.filter(s => s.code === st.code);
    const days = (jr[st.code] || []).sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 7);
    return Object.assign(st, {
      lessons: Object.keys((prog[st.code] || {}).lessons || {}).length,
      accepted: mine.filter(s => s.status === 'Принято').length,
      review: mine.filter(s => s.status === 'На проверке').length,
      rework: mine.filter(s => s.status === 'На доработке').length,
      days: days
    });
  }).reverse();
  return {
    students: students,
    pending: last.filter(s => s.status === 'На проверке').reverse(),
    questions: reqs.filter(r => !r.reply).reverse(),
    answered: reqs.filter(r => r.reply).slice(-20).reverse()
  };
}

/* ---------- точка входа ---------- */
function doGet() { return out_({ ok: true, service: 'kurs' }); }

function doPost(e) {
  let d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'Неверный запрос' }); }
  const adminKey = prop_('ADMIN_KEY');
  const isAdmin = !!d.key && !!adminKey && d.key === adminKey;
  const need = () => {
    const s = student_(d.code);
    if (!s) return { err: out_({ ok: false, error: 'Код не найден. Проверь, что ввёл его без ошибок.' }) };
    if (s.status !== 'active') return { err: out_({ ok: false, error: 'Доступ по этому коду приостановлен. Напиши куратору.' }) };
    return { s };
  };
  try {
    switch (d.action) {
      case 'verify': { const r = need(); if (r.err) return r.err; r.s.last = now_(); set_('students', r.s.row, 6, r.s.last); return out_({ ok: true, student: pubStudent_(r.s) }); }
      case 'setName': {
        const r = need(); if (r.err) return r.err;
        const name = String(d.name || '').trim().slice(0, 40);
        if (name.length < 2) return out_({ ok: false, error: 'Слишком короткое имя' });
        set_('students', r.s.row, 2, name); r.s.name = name;
        return out_({ ok: true, student: pubStudent_(r.s) });
      }
      case 'pull': { const r = need(); if (r.err) return r.err; return out_(Object.assign({ ok: true, student: pubStudent_(r.s) }, pull_(r.s.code))); }
      case 'saveProgress': { const r = need(); if (r.err) return r.err; saveProgress_(r.s, d.data || {}); return out_({ ok: true }); }
      case 'saveDay': { const r = need(); if (r.err) return r.err; saveDay_(r.s, String(d.date).slice(0, 10), d.entry || {}); return out_({ ok: true }); }
      case 'submitTask': {
        const r = need(); if (r.err) return r.err;
        lock_(() => append_('submissions', [Date.now(), r.s.code, r.s.name, d.taskId, d.task, String(d.answer || '').slice(0, 5000), now_(), 'На проверке', '', '', '']));
        return out_({ ok: true });
      }
      case 'sendRequest': {
        const r = need(); if (r.err) return r.err;
        const photos = savePhotos_(d.photos, r.s.code);
        const id = Date.now();
        lock_(() => append_('requests', [id, r.s.code, r.s.name, d.num, short_(), String(d.text || '').slice(0, 5000), photos.join('\n'), '', '']));
        return out_({ ok: true, request: { id, num: d.num, date: short_(), text: d.text, photos, status: 'waiting', reply: '' } });
      }

      case 'adminCheck':
        if (!adminKey) { // первый вход: введённый пароль становится паролем админки
          if (String(d.key || '').length < 6) return out_({ ok: false, error: 'Придумай пароль от 6 символов' });
          PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', String(d.key));
          return out_({ ok: true, created: true });
        }
        return out_(isAdmin ? { ok: true } : { ok: false, error: 'Неверный пароль' });
      case 'list':
        if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
        return out_({ ok: true, students: rows_('students').map(x => pubStudent_({ code: x.v[0], name: x.v[1], tg: x.v[2], note: x.v[3], created: str_(x.v[4]), last: str_(x.v[5]), status: x.v[6] || 'active' })).reverse() });
      case 'create':
        if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
        return out_({ ok: true, student: pubStudent_(issue_(String(d.tg || ''), String(d.note || ''))) });
      case 'toggle': {
        if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
        const s = student_(d.code); if (!s) return out_({ ok: false, error: 'Код не найден' });
        set_('students', s.row, 7, s.status === 'active' ? 'blocked' : 'active');
        return out_({ ok: true });
      }
      case 'adminData':
        if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
        return out_(Object.assign({ ok: true }, adminData_()));
      case 'review': {
        if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
        const r = rows_('submissions').find(x => String(x.v[0]) === String(d.id));
        if (!r) return out_({ ok: false, error: 'Сдача не найдена' });
        const score = Number(d.score) >= 1 && Number(d.score) <= 10 ? Number(d.score) : '';
        sh_('submissions').getRange(r.row, 8, 1, 4).setValues([[d.status === 'accepted' ? 'Принято' : 'На доработке', score, String(d.comment || '').slice(0, 3000), now_()]]);
        return out_({ ok: true });
      }
      case 'reply': {
        if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
        const r = rows_('requests').find(x => String(x.v[0]) === String(d.id));
        if (!r) return out_({ ok: false, error: 'Вопрос не найден' });
        const text = String(d.text || '').trim().slice(0, 5000);
        if (!text) return out_({ ok: false, error: 'Пустой ответ' });
        sh_('requests').getRange(r.row, 8, 1, 2).setValues([[text, now_()]]);
        return out_({ ok: true });
      }
      case 'saveReview':
        if (!isAdmin) return out_({ ok: false, error: 'Нет доступа' });
        append_('reviews', [d.code, d.name || '', d.week, d.done, d.summary, (d.wins || []).map(x => '• ' + x).join('\n'), (d.focus || []).map(x => '• ' + x).join('\n'), short_()]);
        return out_({ ok: true });
      case 'botIssue':
        if (!d.botKey || d.botKey !== prop_('BOT_KEY')) return out_({ ok: false, error: 'Нет доступа' });
        return out_({ ok: true, student: pubStudent_(issue_(String(d.tg || ''), String(d.note || 'Выдан ботом'))) });
    }
    return out_({ ok: false, error: 'Неизвестное действие' });
  } catch (err) {
    return out_({ ok: false, error: 'Ошибка сервера: ' + err.message });
  }
}

/* Запустить один раз вручную: создаёт все листы и запрашивает доступы */
function setup() {
  Object.keys(T).forEach(sh_);
  const first = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Лист1') || SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  if (first && SpreadsheetApp.getActiveSpreadsheet().getSheets().length > 1) SpreadsheetApp.getActiveSpreadsheet().deleteSheet(first);
  DriveApp.getRootFolder();
}
