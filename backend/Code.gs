/**
 * =============================================================
 *  กายภาพ AI — เซิร์ฟเวอร์ (Google Apps Script + Google Sheets)
 * =============================================================
 *  หน้าที่:
 *   1) รับ/ส่งข้อมูลกับแอป (ผู้ฝึก, นักกายภาพ, ญาติ)
 *   2) เก็บข้อมูลลง Google Sheet (ไฟล์ที่ผูกกับสคริปต์นี้)
 *   3) รับข้อความจาก LINE (Webhook) และส่งแจ้งเตือนเข้า LINE ญาติ
 *   4) ตรวจทุกวันว่ามีใครไม่ได้ฝึก หรือผลการฝึกลดลงผิดปกติ
 *
 *  ติดตั้ง: ดู INSTALL.md ขั้นที่ 2
 *  ค่าที่ต้องตั้งใน "การตั้งค่าโปรเจ็กต์ > พร็อพเพอร์ตี้ของสคริปต์" (Script Properties):
 *   ADMIN_PIN                  รหัสเข้าหน้านักกายภาพ (อย่างน้อย 6 หลัก)
 *   LINE_CHANNEL_ACCESS_TOKEN  จาก LINE Messaging API (ใส่ภายหลังได้)
 *   LINE_OA_ID                 LINE ID ของบัญชีทางการ เช่น @123abcde
 *   LINE_LOGIN_CHANNEL_ID      Channel ID ของ LINE Login (สำหรับ LIFF)
 *   LIFF_ID                    LIFF ID เช่น 1234567890-AbCdEfGh
 *   MISSED_DAYS                แจ้งเตือนเมื่อไม่ได้ฝึกกี่วัน (ค่าเริ่มต้น 2)
 * =============================================================
 */

const TZ = 'Asia/Bangkok';
const LINK_CODE_MINUTES = 10;

const SHEETS = {
  Patients: ['id', 'name', 'age', 'phone', 'note', 'token', 'plan', 'active', 'createdAt', 'lastSessionAt', 'lastMissedAlertAt', 'lastDeclineAlertAt'],
  Sessions: ['id', 'patientId', 'at', 'exercise', 'exerciseName', 'targetReps', 'targetSets', 'sets', 'reps', 'goodReps', 'durationSec', 'painBefore', 'painAfter', 'issues', 'stoppedEarly', 'params'],
  Alerts: ['id', 'patientId', 'patientName', 'type', 'detail', 'at', 'notified', 'status', 'ackAt'],
  Family: ['id', 'patientId', 'lineUserId', 'displayName', 'relation', 'status', 'at'],
  LinkCodes: ['code', 'patientId', 'expiresAt', 'usedAt', 'usedBy'],
};

const DEFAULT_PLAN = {
  exercises: [
    { id: 'sit_to_stand', reps: 10, sets: 2 },
    { id: 'arm_raise', reps: 10, sets: 2 },
  ],
  restSec: 30,
};

const ALERT_TEXT = {
  fall: (p, d) => `🚨 ตรวจพบการล้มระหว่างฝึก\nคุณ${p.name} อาจล้มเมื่อ ${nowText()} และไม่ได้กดยืนยันว่าปลอดภัย\nกรุณาติดต่อหรือไปดูทันที\n(ฉุกเฉินโทร 1669)`,
  sos: (p, d) => `🆘 คุณ${p.name} กดขอความช่วยเหลือ\nเวลา ${nowText()}\nกรุณาติดต่อกลับโดยเร็ว\n(ฉุกเฉินโทร 1669)`,
  pain: (p, d) => `⚠️ คุณ${p.name} แจ้งอาการระหว่างฝึกกายภาพ\n${d}\nเวลา ${nowText()}\nควรสอบถามอาการ และปรึกษานักกายภาพ/แพทย์หากไม่ดีขึ้น`,
  missed: (p, d) => `📅 คุณ${p.name} ไม่ได้ฝึกกายภาพมา ${d} วันแล้ว\nช่วยชวนให้ฝึกต่อนะครับ การฝึกสม่ำเสมอช่วยให้ร่างกายแข็งแรง`,
  decline: (p, d) => `📉 ผลการฝึกของคุณ${p.name} ลดลงผิดปกติ\n${d}\nอาจเป็นสัญญาณว่าร่างกายไม่ค่อยดี ควรสอบถามอาการหรือปรึกษานักกายภาพ`,
};
const ALERT_COOLDOWN_MIN = { fall: 1, sos: 1, pain: 10 };

// =============================================================
//  1) ติดตั้งครั้งแรก — กด "เรียกใช้" ฟังก์ชันนี้ 1 ครั้ง
// =============================================================
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = SHEETS[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#d7ece9');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@'); // เก็บเป็นข้อความ กัน Sheets แปลงวันที่เอง
  });
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);

  const props = PropertiesService.getScriptProperties();
  ['ADMIN_PIN', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_OA_ID', 'LINE_LOGIN_CHANNEL_ID', 'LIFF_ID'].forEach(function (k) {
    if (props.getProperty(k) === null) props.setProperty(k, '');
  });
  if (!props.getProperty('MISSED_DAYS')) props.setProperty('MISSED_DAYS', '2');

  // ตั้งเวลาตรวจรายวัน 18:00 น.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyCheck') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyCheck').timeBased().atHour(18).everyDays(1).inTimezone(TZ).create();

  Logger.log('ติดตั้งเสร็จแล้ว ✅ ต่อไป: ตั้งค่า ADMIN_PIN ในพร็อพเพอร์ตี้ของสคริปต์ แล้ว Deploy เป็น Web app');
}

// =============================================================
//  2) จุดรับคำขอ
// =============================================================
function doGet(e) {
  return json({ ok: true, data: { app: 'PhysioAI', time: nowIso(), ready: !!prop('ADMIN_PIN') } });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json({ ok: false, error: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' });
  }
  // ข้อความจาก LINE
  if (body.events) {
    try {
      handleLineWebhook(body);
    } catch (err) {
      console.error(err);
    }
    return json({ ok: true });
  }
  try {
    const fn = ROUTES[body.action];
    if (!fn) throw new Error('ไม่รู้จักคำสั่ง: ' + body.action);
    return json({ ok: true, data: fn(body) });
  } catch (err) {
    console.error(body.action, err);
    return json({ ok: false, error: String(err.message || err) });
  }
}

const ROUTES = {
  // ---- สาธารณะ ----
  'public.config': function () {
    return lineConfig();
  },
  'family.preview': function (b) {
    const lc = findValidCode(b.code);
    const p = getPatient(lc.patientId);
    return { patientName: p.name };
  },
  'family.link': function (b) {
    const prof = verifyLineIdToken(b.idToken);
    return processLinkCode(b.code, prof.sub, prof.name || 'ญาติ', b.relation || '');
  },

  // ---- ผู้ฝึก (ต้องมี patientId + token) ----
  'patient.get': function (b) {
    const p = authPatient(b);
    const today = todayStr();
    const sessions = readTable('Sessions').filter(function (s) {
      return s.patientId === p.id && String(s.at).slice(0, 10) === today;
    });
    const fam = readTable('Family').filter(function (f) {
      return f.patientId === p.id && (f.status === 'approved' || f.status === 'pending');
    });
    return {
      patient: { id: p.id, name: p.name, plan: parsePlan(p.plan) },
      today: sessions.map(cleanSession),
      family: fam.map(function (f) {
        return { id: f.id, displayName: f.displayName, relation: f.relation, status: f.status };
      }),
      lineReady: !!prop('LINE_CHANNEL_ACCESS_TOKEN'),
    };
  },
  'patient.saveSession': function (b) {
    const p = authPatient(b);
    const s = b.session || {};
    const row = {
      id: uid('S'),
      patientId: p.id,
      at: nowIso(),
      exercise: str(s.exercise, 40),
      exerciseName: str(s.exerciseName, 80),
      targetReps: num(s.targetReps),
      targetSets: num(s.targetSets),
      sets: num(s.sets),
      reps: num(s.reps),
      goodReps: num(s.goodReps),
      durationSec: num(s.durationSec),
      painBefore: str(s.painBefore, 20),
      painAfter: str(s.painAfter, 20),
      issues: JSON.stringify(s.issues || {}),
      stoppedEarly: s.stoppedEarly ? 'yes' : 'no',
      params: JSON.stringify(s.params || {}),
    };
    withLock(function () {
      appendRow('Sessions', row);
      updateRow('Patients', 'id', p.id, { lastSessionAt: row.at });
    });
    return { saved: true, id: row.id };
  },
  'patient.alert': function (b) {
    const p = authPatient(b);
    const type = ['fall', 'sos', 'pain'].indexOf(b.type) >= 0 ? b.type : 'sos';
    return createAlert(p, type, str(b.detail, 300));
  },
  'patient.linkCode': function (b) {
    const p = authPatient(b);
    let code;
    withLock(function () {
      // ยกเลิกรหัสเก่าที่ยังไม่ได้ใช้ของผู้ฝึกคนนี้
      readTable('LinkCodes').forEach(function (c) {
        if (c.patientId === p.id && !c.usedAt) updateRow('LinkCodes', 'code', c.code, { usedAt: nowIso(), usedBy: 'replaced' });
      });
      const used = {};
      readTable('LinkCodes').forEach(function (c) { used[c.code] = 1; });
      do {
        code = String(100000 + Math.floor(Math.random() * 900000));
      } while (used[code]);
      appendRow('LinkCodes', { code: code, patientId: p.id, expiresAt: isoPlus(LINK_CODE_MINUTES), usedAt: '', usedBy: '' });
    });
    const cfg = lineConfig();
    return {
      code: code,
      expiresAt: isoPlus(LINK_CODE_MINUTES),
      liffUrl: cfg.liffId ? 'https://liff.line.me/' + cfg.liffId + '?code=' + code : '',
      oaUrl: cfg.oaId ? 'https://line.me/R/oaMessage/' + encodeURIComponent(cfg.oaId) + '/?' + encodeURIComponent('LINK ' + code) : '',
      oaId: cfg.oaId,
    };
  },
  'patient.familyAction': function (b) {
    const p = authPatient(b);
    const f = readTable('Family').filter(function (x) { return x.id === b.familyId && x.patientId === p.id; })[0];
    if (!f) throw new Error('ไม่พบรายการ');
    setFamilyStatus(f, b.approve ? 'approved' : 'rejected', p);
    return { status: b.approve ? 'approved' : 'rejected' };
  },
  'patient.history': function (b) {
    const p = authPatient(b);
    const since = isoPlus(-60 * 24 * 30);
    return {
      sessions: readTable('Sessions')
        .filter(function (s) { return s.patientId === p.id && s.at >= since; })
        .map(cleanSession),
    };
  },

  // ---- นักกายภาพ (ต้องมี PIN) ----
  'admin.login': function (b) {
    authAdmin(b);
    return { ok: true, config: lineConfig(), lineReady: !!prop('LINE_CHANNEL_ACCESS_TOKEN') };
  },
  'admin.overview': function (b) {
    authAdmin(b);
    const sessions = readTable('Sessions');
    const alerts = readTable('Alerts');
    const fam = readTable('Family');
    const week = isoPlus(-60 * 24 * 7);
    const patients = readTable('Patients').map(function (p) {
      const mine = sessions.filter(function (s) { return s.patientId === p.id; });
      const wk = mine.filter(function (s) { return s.at >= week; });
      const reps = wk.reduce(function (t, s) { return t + num(s.reps); }, 0);
      const good = wk.reduce(function (t, s) { return t + num(s.goodReps); }, 0);
      return {
        id: p.id, name: p.name, age: p.age, active: p.active !== 'no',
        lastSessionAt: p.lastSessionAt, createdAt: p.createdAt,
        sessions7d: wk.length, reps7d: reps, goodPct7d: reps ? Math.round((good / reps) * 100) : null,
        daysActive7d: uniq(wk.map(function (s) { return String(s.at).slice(0, 10); })).length,
        family: fam.filter(function (f) { return f.patientId === p.id && f.status === 'approved'; }).length,
        pendingFamily: fam.filter(function (f) { return f.patientId === p.id && f.status === 'pending'; }).length,
        newAlerts: alerts.filter(function (a) { return a.patientId === p.id && a.status === 'new'; }).length,
      };
    });
    const recent = alerts.filter(function (a) { return a.status === 'new'; }).slice(-50).reverse();
    return { patients: patients, alerts: recent, lineReady: !!prop('LINE_CHANNEL_ACCESS_TOKEN') };
  },
  'admin.createPatient': function (b) {
    authAdmin(b);
    if (!str(b.name, 100)) throw new Error('กรุณาใส่ชื่อ');
    let p;
    withLock(function () {
      const all = readTable('Patients');
      let max = 0;
      all.forEach(function (x) { const n = parseInt(String(x.id).replace(/\D/g, ''), 10); if (n > max) max = n; });
      p = {
        id: 'P' + ('000' + (max + 1)).slice(-4),
        name: str(b.name, 100),
        age: str(b.age, 5),
        phone: str(b.phone, 30),
        note: str(b.note, 1000),
        token: randomToken(8),
        plan: JSON.stringify(sanitizePlan(b.plan || DEFAULT_PLAN)),
        active: 'yes',
        createdAt: nowIso(),
        lastSessionAt: '', lastMissedAlertAt: '', lastDeclineAlertAt: '',
      };
      appendRow('Patients', p);
    });
    return { patient: adminPatient(p) };
  },
  'admin.updatePatient': function (b) {
    authAdmin(b);
    const p = getPatient(b.id);
    const patch = {};
    ['name', 'age', 'phone', 'note'].forEach(function (k) { if (b[k] !== undefined) patch[k] = str(b[k], k === 'note' ? 1000 : 100); });
    if (b.plan) patch.plan = JSON.stringify(sanitizePlan(b.plan));
    if (b.active !== undefined) patch.active = b.active ? 'yes' : 'no';
    withLock(function () { updateRow('Patients', 'id', p.id, patch); });
    return { patient: adminPatient(getPatient(p.id)) };
  },
  'admin.resetToken': function (b) {
    authAdmin(b);
    const p = getPatient(b.id);
    const token = randomToken(8);
    withLock(function () { updateRow('Patients', 'id', p.id, { token: token }); });
    return { patient: adminPatient(getPatient(p.id)) };
  },
  'admin.patientDetail': function (b) {
    authAdmin(b);
    const p = getPatient(b.id);
    const since = isoPlus(-60 * 24 * 90);
    return {
      patient: adminPatient(p),
      sessions: readTable('Sessions').filter(function (s) { return s.patientId === p.id && s.at >= since; }).map(cleanSession),
      alerts: readTable('Alerts').filter(function (a) { return a.patientId === p.id; }).slice(-100).reverse(),
      family: readTable('Family').filter(function (f) { return f.patientId === p.id && f.status !== 'removed' && f.status !== 'rejected'; }),
    };
  },
  'admin.familyAction': function (b) {
    authAdmin(b);
    const f = readTable('Family').filter(function (x) { return x.id === b.id; })[0];
    if (!f) throw new Error('ไม่พบรายการ');
    const st = { approve: 'approved', reject: 'rejected', remove: 'removed' }[b.op];
    if (!st) throw new Error('คำสั่งไม่ถูกต้อง');
    setFamilyStatus(f, st, getPatient(f.patientId));
    return { status: st };
  },
  'admin.ackAlert': function (b) {
    authAdmin(b);
    withLock(function () { updateRow('Alerts', 'id', b.id, { status: 'ack', ackAt: nowIso() }); });
    return { ok: true };
  },
  'admin.testLine': function (b) {
    authAdmin(b);
    const p = getPatient(b.id);
    const n = notifyFamily(p.id, '✅ ทดสอบระบบแจ้งเตือนกายภาพ AI\nคุณจะได้รับข้อความแบบนี้เมื่อคุณ' + p.name + ' ต้องการความช่วยเหลือ');
    return { notified: n };
  },
  'admin.runDailyCheck': function (b) {
    authAdmin(b);
    return dailyCheck();
  },
};

// =============================================================
//  3) LINE
// =============================================================
function lineConfig() {
  const oa = prop('LINE_OA_ID');
  return {
    liffId: prop('LIFF_ID'),
    oaId: oa,
    addFriendUrl: oa ? 'https://line.me/R/ti/p/' + encodeURIComponent(oa) : '',
  };
}

function handleLineWebhook(body) {
  (body.events || []).forEach(function (ev) {
    const userId = ev.source && ev.source.userId;
    if (!userId) return;
    if (ev.type === 'follow') {
      lineReply(ev.replyToken, [text('สวัสดีครับ 🙏 นี่คือบัญชีแจ้งเตือนของระบบกายภาพ AI\n\nวิธีรับแจ้งเตือน:\n1) เปิดแอปกายภาพ AI ในเครื่องของผู้สูงอายุ\n2) กด "เชื่อมต่อญาติ"\n3) สแกน QR หรือพิมพ์รหัส 6 หลักในแชทนี้\n\nพิมพ์ "สถานะ" เพื่อดูผลการฝึกล่าสุด')]);
      return;
    }
    if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
    const msg = String(ev.message.text || '').trim();
    const m = msg.match(/^(?:LINK\s*)?(\d{6})$/i);
    if (m) {
      try {
        const prof = lineProfile(userId);
        const r = processLinkCode(m[1], userId, prof.displayName || 'ญาติ', '');
        lineReply(ev.replyToken, [text(r.status === 'approved'
          ? 'คุณเชื่อมต่อกับคุณ' + r.patientName + ' อยู่แล้วครับ ✅'
          : 'ส่งคำขอเชื่อมต่อกับคุณ' + r.patientName + ' แล้ว ⏳\nกรุณากด "อนุญาต" ในแอปของผู้สูงอายุ หรือแจ้งนักกายภาพให้อนุมัติ')]);
      } catch (err) {
        lineReply(ev.replyToken, [text('❌ ' + err.message)]);
      }
      return;
    }
    if (/^สถานะ|^status/i.test(msg)) {
      lineReply(ev.replyToken, [text(statusText(userId))]);
      return;
    }
    lineReply(ev.replyToken, [text('พิมพ์รหัส 6 หลักจากแอป เพื่อเชื่อมต่อ\nหรือพิมพ์ "สถานะ" เพื่อดูผลการฝึกล่าสุด')]);
  });
}

function statusText(userId) {
  const links = readTable('Family').filter(function (f) { return f.lineUserId === userId && f.status === 'approved'; });
  if (!links.length) return 'คุณยังไม่ได้เชื่อมต่อกับผู้ฝึกคนใด';
  const sessions = readTable('Sessions');
  const week = isoPlus(-60 * 24 * 7);
  return links.map(function (f) {
    const p = getPatient(f.patientId);
    const wk = sessions.filter(function (s) { return s.patientId === p.id && s.at >= week; });
    const reps = wk.reduce(function (t, s) { return t + num(s.reps); }, 0);
    const days = uniq(wk.map(function (s) { return String(s.at).slice(0, 10); })).length;
    return '👤 คุณ' + p.name + '\nฝึกล่าสุด: ' + (p.lastSessionAt ? thaiDate(p.lastSessionAt) : 'ยังไม่เคยฝึก') +
      '\n7 วันที่ผ่านมา: ฝึก ' + days + ' วัน รวม ' + reps + ' ครั้ง';
  }).join('\n\n');
}

function processLinkCode(code, userId, displayName, relation) {
  const fails = CacheService.getScriptCache();
  const key = 'linkfail_' + userId;
  if (Number(fails.get(key) || 0) >= 5) throw new Error('ใส่รหัสผิดหลายครั้ง กรุณารอ 10 นาที');
  let lc;
  try {
    lc = findValidCode(code);
  } catch (err) {
    fails.put(key, String(Number(fails.get(key) || 0) + 1), 600);
    throw err;
  }
  const p = getPatient(lc.patientId);
  let status = 'pending';
  withLock(function () {
    const existing = readTable('Family').filter(function (f) {
      return f.patientId === p.id && f.lineUserId === userId && (f.status === 'approved' || f.status === 'pending');
    })[0];
    updateRow('LinkCodes', 'code', lc.code, { usedAt: nowIso(), usedBy: userId });
    if (existing) {
      status = existing.status;
      if (relation) updateRow('Family', 'id', existing.id, { relation: str(relation, 40) });
      return;
    }
    appendRow('Family', {
      id: uid('F'), patientId: p.id, lineUserId: userId, displayName: str(displayName, 80),
      relation: str(relation, 40), status: 'pending', at: nowIso(),
    });
  });
  return { status: status, patientName: p.name };
}

function findValidCode(code) {
  code = String(code || '').trim();
  if (!/^\d{6}$/.test(code)) throw new Error('รหัสต้องเป็นตัวเลข 6 หลัก');
  const lc = readTable('LinkCodes').filter(function (c) { return c.code === code; })[0];
  if (!lc || lc.usedAt) throw new Error('รหัสไม่ถูกต้อง หรือถูกใช้ไปแล้ว');
  if (lc.expiresAt < nowIso()) throw new Error('รหัสหมดอายุแล้ว กรุณาสร้าง QR ใหม่ในแอป');
  return lc;
}

function setFamilyStatus(f, status, p) {
  withLock(function () { updateRow('Family', 'id', f.id, { status: status }); });
  if (status === 'approved') {
    linePush(f.lineUserId, [text('✅ เชื่อมต่อสำเร็จ\nคุณจะได้รับแจ้งเตือนเมื่อคุณ' + p.name + ' ต้องการความช่วยเหลือ ไม่ได้ฝึก หรือมีอาการผิดปกติ\n\nพิมพ์ "สถานะ" เพื่อดูผลการฝึกได้ตลอดเวลา')]);
  }
}

// ตรวจ ID Token จาก LIFF กับเซิร์ฟเวอร์ LINE (กันการปลอมตัวตน)
function verifyLineIdToken(idToken) {
  const channelId = prop('LINE_LOGIN_CHANNEL_ID');
  if (!channelId) throw new Error('ยังไม่ได้ตั้งค่า LINE_LOGIN_CHANNEL_ID');
  if (!idToken) throw new Error('ไม่พบข้อมูลการเข้าสู่ระบบ LINE');
  const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: idToken, client_id: channelId },
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200 || !data.sub) throw new Error('ยืนยันตัวตน LINE ไม่สำเร็จ กรุณาเปิดลิงก์ใหม่');
  return data; // { sub: userId, name, picture, ... }
}

function lineProfile(userId) {
  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId), {
      headers: { Authorization: 'Bearer ' + prop('LINE_CHANNEL_ACCESS_TOKEN') },
      muteHttpExceptions: true,
    });
    return res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : {};
  } catch (err) {
    return {};
  }
}

function text(t) {
  return { type: 'text', text: String(t).slice(0, 4900) };
}

function lineReply(replyToken, messages) {
  const token = prop('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token || !replyToken) return false;
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages }),
    muteHttpExceptions: true,
  });
  return res.getResponseCode() === 200;
}

function linePush(to, messages) {
  const token = prop('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token || !to) return false;
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: to, messages: messages }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) console.error('LINE push ไม่สำเร็จ', res.getResponseCode(), res.getContentText());
  return res.getResponseCode() === 200;
}

function notifyFamily(patientId, message) {
  const fam = readTable('Family').filter(function (f) { return f.patientId === patientId && f.status === 'approved'; });
  let n = 0;
  fam.forEach(function (f) { if (linePush(f.lineUserId, [text(message)])) n++; });
  return n;
}

function createAlert(p, type, detail) {
  // กันการกดซ้ำรัว ๆ
  const cd = ALERT_COOLDOWN_MIN[type];
  if (cd) {
    const cache = CacheService.getScriptCache();
    const k = 'alert_' + p.id + '_' + type;
    if (cache.get(k)) return { notified: Number(cache.get(k)), duplicate: true };
  }
  const msg = ALERT_TEXT[type](p, detail);
  const n = notifyFamily(p.id, msg);
  withLock(function () {
    appendRow('Alerts', { id: uid('A'), patientId: p.id, patientName: p.name, type: type, detail: detail, at: nowIso(), notified: n, status: 'new', ackAt: '' });
  });
  if (cd) CacheService.getScriptCache().put('alert_' + p.id + '_' + type, String(n), cd * 60);
  return { notified: n };
}

// =============================================================
//  4) ตรวจรายวัน (ตั้งเวลาอัตโนมัติไว้ 18:00 น. โดย setup())
// =============================================================
function dailyCheck() {
  const missedDays = Number(prop('MISSED_DAYS') || 2);
  const sessions = readTable('Sessions');
  const now = Date.now();
  const result = { missed: [], decline: [] };
  readTable('Patients').forEach(function (p) {
    if (p.active === 'no') return;
    // ไม่ได้ฝึก
    const last = p.lastSessionAt || p.createdAt;
    const days = Math.floor((now - new Date(last).getTime()) / 86400000);
    const lastMissed = p.lastMissedAlertAt ? new Date(p.lastMissedAlertAt).getTime() : 0;
    if (days >= missedDays && now - lastMissed > 20 * 3600000) {
      createAlert(p, 'missed', String(days));
      withLock(function () { updateRow('Patients', 'id', p.id, { lastMissedAlertAt: nowIso() }); });
      result.missed.push(p.id);
    }
    // ผลการฝึกลดลง: เฉลี่ยจำนวนครั้งต่อการฝึก 7 วันล่าสุด เทียบ 7 วันก่อนหน้า
    const mine = sessions.filter(function (s) { return s.patientId === p.id; });
    const cut1 = isoPlus(-60 * 24 * 7), cut2 = isoPlus(-60 * 24 * 14);
    const cur = mine.filter(function (s) { return s.at >= cut1; });
    const prev = mine.filter(function (s) { return s.at >= cut2 && s.at < cut1; });
    const avg = function (arr, f) { return arr.length ? arr.reduce(function (t, s) { return t + f(s); }, 0) / arr.length : 0; };
    const repsCur = avg(cur, function (s) { return num(s.reps); });
    const repsPrev = avg(prev, function (s) { return num(s.reps); });
    const lastDecline = p.lastDeclineAlertAt ? new Date(p.lastDeclineAlertAt).getTime() : 0;
    if (prev.length >= 3 && cur.length >= 2 && repsCur < repsPrev * 0.7 && now - lastDecline > 6 * 86400000) {
      const pct = Math.round((1 - repsCur / repsPrev) * 100);
      createAlert(p, 'decline', 'จำนวนครั้งเฉลี่ยต่อการฝึกลดลง ' + pct + '% จากสัปดาห์ก่อน');
      withLock(function () { updateRow('Patients', 'id', p.id, { lastDeclineAlertAt: nowIso() }); });
      result.decline.push(p.id);
    }
  });
  return result;
}

// =============================================================
//  5) ตรวจสิทธิ์
// =============================================================
function authAdmin(b) {
  const pin = prop('ADMIN_PIN');
  if (!pin || pin.length < 4) throw new Error('ผู้ดูแลยังไม่ได้ตั้งค่า ADMIN_PIN ใน Script Properties');
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('adminfail') || 0);
  if (fails >= 8) throw new Error('ใส่รหัสผิดหลายครั้ง กรุณารอ 15 นาที');
  if (String(b.pin || '') !== pin) {
    cache.put('adminfail', String(fails + 1), 900);
    throw new Error('รหัส PIN ไม่ถูกต้อง');
  }
}

function authPatient(b) {
  const p = readTable('Patients').filter(function (x) { return x.id === String(b.patientId || '').toUpperCase(); })[0];
  if (!p || !b.token || p.token !== String(b.token).toUpperCase()) throw new Error('รหัสผู้ฝึกไม่ถูกต้อง กรุณาลงทะเบียนเครื่องใหม่');
  if (p.active === 'no') throw new Error('บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อนักกายภาพ');
  return p;
}

function getPatient(id) {
  const p = readTable('Patients').filter(function (x) { return x.id === id; })[0];
  if (!p) throw new Error('ไม่พบผู้ฝึก');
  return p;
}

function adminPatient(p) {
  return { id: p.id, name: p.name, age: p.age, phone: p.phone, note: p.note, token: p.token, plan: parsePlan(p.plan), active: p.active !== 'no', createdAt: p.createdAt, lastSessionAt: p.lastSessionAt };
}

// =============================================================
//  6) ตัวช่วยจัดการตาราง
// =============================================================
function sheet(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบแผ่นงาน ' + name + ' — กรุณาเรียกใช้ setup() ก่อน');
  return sh;
}

function readTable(name) {
  const sh = sheet(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const headers = SHEETS[name];
  const values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  return values.map(function (r) {
    const o = {};
    headers.forEach(function (h, i) { o[h] = r[i] === null || r[i] === undefined ? '' : String(r[i]); });
    return o;
  });
}

function appendRow(name, obj) {
  const headers = SHEETS[name];
  const sh = sheet(name);
  const row = headers.map(function (h) { return obj[h] === undefined || obj[h] === null ? '' : String(obj[h]); });
  const r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, headers.length).setNumberFormat('@').setValues([row]);
}

function updateRow(name, keyCol, keyVal, patch) {
  const headers = SHEETS[name];
  const sh = sheet(name);
  const last = sh.getLastRow();
  if (last < 2) return false;
  const k = headers.indexOf(keyCol);
  const keys = sh.getRange(2, k + 1, last - 1, 1).getValues();
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === String(keyVal)) {
      Object.keys(patch).forEach(function (col) {
        const c = headers.indexOf(col);
        if (c >= 0) sh.getRange(i + 2, c + 1).setNumberFormat('@').setValue(String(patch[col]));
      });
      return true;
    }
  }
  return false;
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// =============================================================
//  7) ตัวช่วยทั่วไป
// =============================================================
function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function prop(k) {
  return String(PropertiesService.getScriptProperties().getProperty(k) || '').trim();
}
function nowIso() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}
function isoPlus(minutes) {
  return Utilities.formatDate(new Date(Date.now() + minutes * 60000), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}
function todayStr() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}
function nowText() {
  return Utilities.formatDate(new Date(), TZ, 'HH:mm น. วันที่ d/M/yyyy');
}
function thaiDate(iso) {
  return Utilities.formatDate(new Date(iso), TZ, 'd/M/yyyy HH:mm น.');
}
function uid(prefix) {
  return prefix + Utilities.formatDate(new Date(), TZ, 'yyMMddHHmmss') + Math.floor(Math.random() * 1000);
}
function randomToken(n) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ตัดตัวที่สับสน เช่น O/0, I/1
  let s = '';
  for (let i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
function str(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/^[=+\-@]/, "'$&").slice(0, max || 200);
}
function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
function uniq(a) {
  return a.filter(function (x, i) { return a.indexOf(x) === i; });
}
function parsePlan(s) {
  try {
    return s ? JSON.parse(s) : DEFAULT_PLAN;
  } catch (err) {
    return DEFAULT_PLAN;
  }
}
function sanitizePlan(plan) {
  const ids = ['sit_to_stand', 'arm_raise', 'knee_extension', 'march', 'heel_raise'];
  const out = { exercises: [], restSec: Math.min(300, Math.max(5, num(plan.restSec) || 30)) };
  (plan.exercises || []).forEach(function (x) {
    if (ids.indexOf(x.id) < 0) return;
    const e = { id: x.id, reps: Math.min(100, Math.max(1, num(x.reps) || 10)), sets: Math.min(10, Math.max(1, num(x.sets) || 1)) };
    ['down', 'up', 'good'].forEach(function (k) { if (x[k] !== undefined && x[k] !== '' && isFinite(Number(x[k]))) e[k] = Number(x[k]); });
    out.exercises.push(e);
  });
  return out;
}
function cleanSession(s) {
  const o = {};
  Object.keys(s).forEach(function (k) { o[k] = s[k]; });
  ['targetReps', 'targetSets', 'sets', 'reps', 'goodReps', 'durationSec'].forEach(function (k) { o[k] = num(s[k]); });
  try { o.issues = JSON.parse(s.issues || '{}'); } catch (err) { o.issues = {}; }
  try { o.params = JSON.parse(s.params || '{}'); } catch (err) { o.params = {}; }
  o.stoppedEarly = s.stoppedEarly === 'yes';
  return o;
}
