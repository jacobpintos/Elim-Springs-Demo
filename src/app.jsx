var useState=React.useState,useEffect=React.useEffect,useRef=React.useRef,useCallback=React.useCallback,useMemo=React.useMemo;

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DEFAULT_MIN_HRS = 1080; // Iowa Code §279.10(1): accredited nonpublic school = 180 days or 1,080 hours
const WARN_THRESHOLD = 40; // warn when projected hours within 40 of minimum
const GRADE_LEVELS = ["Kindergarten","1st Grade","2nd Grade","3rd Grade","4th Grade","5th Grade","6th Grade","7th Grade","8th Grade","9th Grade","10th Grade","11th Grade","12th Grade"];
const ELEM = ["Kindergarten","1st Grade","2nd Grade","3rd Grade","4th Grade","5th Grade"];
const LETTERS = ["A+","A","A-","B+","B","B-","C+","C","C-","D+","D","D-","F"];
const GP = {"A+":4.0,"A":4.0,"A-":3.7,"B+":3.3,"B":3.0,"B-":2.7,"C+":2.3,"C":2.0,"C-":1.7,"D+":1.3,"D":1.0,"D-":0.7,"F":0.0};
const L2P = {"A+":98,"A":95,"A-":92,"B+":88,"B":85,"B-":82,"C+":78,"C":75,"C-":72,"D+":68,"D":65,"D-":62,"F":50};
const MDN = {"M":3,"D":2,"N":1};
const MDN_LBL = {"M":"Mastered","D":"Developing","N":"Not Yet"};
const EXEMPT = "__exempt__"; // assignment marked excused/exempt — excluded from averages
const EMOJIS = ["📚","🔢","🌍","🔬","🎨","🎵","⚽","🏃","💻","✏️","📖","🗺️","🧮","🌿","🦋","🎭","🔭","🏺","🧩","📐"];
const DAYS = ["Mon","Tue","Wed","Thu","Fri"];
const TEACHER = {id:"t1",username:"teacher",role:"teacher",name:"Mrs. Slattery",email:"teacher@school.edu"};
const LOGO=(typeof window!=="undefined"&&window._logoSrc)||"";

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const today = () => new Date().toISOString().slice(0,10);
// Returns the most recent date that has any attendance record, capped at today.
// This lets demo data (which has records in 2024) show sensible projections
// without testers seeing "all remaining year" numbers from today's real date.
const fmt = d => d ? new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "";
const isMDN = (g, cutoff) => {
  const idx = GRADE_LEVELS.indexOf(g);
  const cutoffIdx = cutoff ? GRADE_LEVELS.indexOf(cutoff) : GRADE_LEVELS.indexOf("5th Grade");
  return idx >= 0 && idx <= cutoffIdx;
};

// Append an audit entry. actorName = who made the change, action = description
function addAudit(prev, actorName, action) {
  const entry={id:uid(),ts:Date.now(),date:today(),actor:actorName||"Teacher",action};
  const log=[...(prev.auditLog||[]),entry].slice(-500); // keep last 500
  return {...prev,auditLog:log};
}
function getParentsForStudent(users, studentId) {
  return (users||[]).filter(u=>u.role==="parent"&&(u.studentIds||[u.studentId]).filter(Boolean).includes(studentId));
}
function getStudentIdsForUser(user) {
  if(!user) return [];
  if(user.studentIds) return user.studentIds;
  if(user.studentId) return [user.studentId];
  return [];
}
function getLetter(p) {
  if(p>=97) return "A+"; if(p>=93) return "A"; if(p>=90) return "A-";
  if(p>=87) return "B+"; if(p>=83) return "B"; if(p>=80) return "B-";
  if(p>=77) return "C+"; if(p>=73) return "C"; if(p>=70) return "C-";
  if(p>=67) return "D+"; if(p>=63) return "D"; if(p>=60) return "D-";
  return "F";
}
function gColor(p) {
  if(p===null) return ""; if(p>=90) return "ga"; if(p>=80) return "gb";
  if(p>=70) return "gc"; if(p>=60) return "gd"; return "gf";
}
function mdnAvg(arr) {
  const v = arr.filter(x => x.score && MDN[x.score] && x.score !== EXEMPT);
  if(!v.length) return null;
  return v.reduce((s,x) => s + MDN[x.score], 0) / v.length;
}
function pctAvg(arr) {
  const v = arr.filter(a => a.score !== null && a.score !== "" && a.score !== undefined && a.score !== EXEMPT);
  if(!v.length) return null;
  // Total points earned / total points possible (weighted by point value)
  const earned = v.reduce((s,a)=>s+parseFloat(a.score),0);
  const possible = v.reduce((s,a)=>s+(a.maxScore||100),0);
  return (earned/possible)*100;
}
function hrsAtt(recs, sy) {
  const filtered=(recs||[]).filter(r=>{
    if(r.status!=="present"&&r.status!=="tardy"&&r.status!=="excused") return false;
    if(sy?.startDate&&r.date<sy.startDate) return false;
    if(sy?.endDate&&r.date>sy.endDate) return false;
    return true;
  });
  return filtered.reduce((s,r)=>s+(r.hours||0),0);
}
// asOf: date string "YYYY-MM-DD" to treat as "today" for projection purposes.
// In production this will always be today(); in demo mode the attendance page
// passes the selected date so projections shift as you navigate through the year.
function projRemain(sy, specialDays, asOf) {
  if(!sy?.startDate||!sy?.endDate) return 0;
  const ref=asOf||today();
  if(!ref||ref.length<10) return 0;
  const end=new Date(sy.endDate+"T12:00:00");
  const refDate=new Date(ref+"T12:00:00");
  if(isNaN(refDate.getTime())||isNaN(end.getTime())) return 0;
  if(refDate>=end) return 0;
  const hpd=sy.hoursPerDay||6;
  const dm={"Mon":1,"Tue":2,"Wed":3,"Thu":4,"Fri":5,"Sat":6,"Sun":0};
  let c=0;
  const d=new Date(ref+"T12:00:00"); d.setDate(d.getDate()+1);
  while(d<=end){
    const ds=d.toISOString().slice(0,10);
    const isSchoolDay=(sy.scheduledDays||DAYS).some(dd=>dm[dd]===d.getDay());
    const sp=(specialDays||[]).find(s=>s.startDate&&s.endDate&&ds>=s.startDate&&ds<=s.endDate);
    if(isSchoolDay){
      if(!sp) c++;
      else if(sp.type==="delay") c+=0.5;
      // break/cancel = 0
    }
    d.setDate(d.getDate()+1);
  }
  return c*hpd;
}
// Perfect-attendance projection (breaks subtracted, no absence rate applied)
function projPerfect(sy, specialDays, asOf) { return projRemain(sy, specialDays, asOf); }
// Absence-rate projection — counts absences only up to asOf date
function projWithRate(sy, specialDays, attRecs, asOf) {
  const ref=asOf||today();
  if(!ref||ref.length<10) return 0;
  const perfect=projRemain(sy, specialDays, ref);
  if(!perfect) return 0;
  const hpd=sy.hoursPerDay||6;
  const dm={"Mon":1,"Tue":2,"Wed":3,"Thu":4,"Fri":5,"Sat":6,"Sun":0};
  const start=new Date(sy.startDate+"T12:00:00");
  const refDate=new Date(ref+"T12:00:00");
  // Count scheduled school days elapsed from start up to (and including) asOf
  let elapsed=0;
  const d2=new Date(start);
  while(d2<=refDate&&d2<=new Date(sy.endDate+"T12:00:00")){
    const ds=d2.toISOString().slice(0,10);
    const isSchool=(sy.scheduledDays||DAYS).some(dd=>dm[dd]===d2.getDay());
    const sp=(specialDays||[]).find(s=>s.startDate&&s.endDate&&ds>=s.startDate&&ds<=s.endDate);
    if(isSchool&&!sp) elapsed++;
    d2.setDate(d2.getDate()+1);
  }
  if(!elapsed) return perfect;
  // Only count attendance records on or before asOf
  const recsToDate=(attRecs||[]).filter(r=>r.date<=ref&&(!sy?.startDate||r.date>=sy.startDate)&&(!sy?.endDate||r.date<=sy.endDate));
  const absences=recsToDate.filter(r=>r.status==="absent").length;
  const tardies=recsToDate.filter(r=>r.status==="tardy").length;
  const absRate=absences/elapsed;
  const tardyRate=tardies/elapsed;
  const remainingDays=Math.round(perfect/hpd);
  const projPresent=Math.round(remainingDays*(1-absRate-tardyRate));
  const projTardy=Math.round(remainingDays*tardyRate);
  return projPresent*hpd + projTardy*(hpd*0.75);
}

function autoCalcQuarters(startDate, endDate, count, existingIds) {
  if(!startDate||!endDate||!count) return [];
  const start=new Date(startDate+"T12:00:00");
  const end=new Date(endDate+"T12:00:00");
  const totalMs=end-start;
  const chunkMs=totalMs/count;
  const quarters=[];
  const ids=existingIds||[];
  for(let i=0;i<count;i++){
    const qStart=new Date(start.getTime()+i*chunkMs);
    const qEnd=i===count-1?new Date(end):new Date(start.getTime()+(i+1)*chunkMs-86400000);
    while(qEnd.getDay()===0) qEnd.setDate(qEnd.getDate()-2);
    while(qEnd.getDay()===6) qEnd.setDate(qEnd.getDate()-1);
    const ds=d=>d.toISOString().slice(0,10);
    quarters.push({id:ids[i]||uid(),label:"Q"+(i+1),startDate:ds(qStart),endDate:ds(qEnd)});
  }
  return quarters;
}
// Returns true if a subject should be visible/editable today.
// Empty activeQuarters = year-long (always active).
function isSubjectActiveToday(sub, finalizedQ, sy) {
  const aq = sub.activeQuarters||[];
  if(!aq.length) return true; // year-long
  const allQ = [...(sy?.quarters||[]), ...finalizedQ];
  const activeRanges = aq.map(qid=>allQ.find(q=>q.id===qid)).filter(Boolean);
  const t = today();
  return activeRanges.some(q=>t>=q.startDate&&t<=q.endDate);
}
// Returns true if ALL of a subject's active quarters are finalized
// Is a date inside a finalized (locked) quarter? Finalized quarters carry their
// own frozen range; older records fall back to the live quarter definition.
function isDateLocked(date, fqMap, allQ) {
  if(!date) return false;
  return Object.entries(fqMap||{}).some(([id,rec])=>{
    const q=(allQ||[]).find(x=>x.id===id);
    const s=typeof rec==="string"?(q&&q.startDate):rec.startDate;
    const e=typeof rec==="string"?(q&&q.endDate):rec.endDate;
    return s&&e&&date>=s&&date<=e;
  });
}
const LOCK_MSG="This quarter has been finalized. Unlock it in Settings to make changes.";
// After promotion the teacher may skip setting the new year's dates. Remind them
// once when they next add work to the gradebook, until the dates are updated.
let _yearDatesReminded=false;
function remindYearDates(st){
  if(_yearDatesReminded||!st||!st.sy||!st.sy.needsYearDates) return;
  _yearDatesReminded=true;
  alert("Reminder: the school year is still set to "+(st.sy.startDate?fmt(st.sy.startDate):"\u2014")+" \u2013 "+(st.sy.endDate?fmt(st.sy.endDate):"\u2014")+".\n\nUpdate it in Settings \u2192 School Year so this year's quarters, attendance, and reports line up with the right calendar.");
}
function isSubjectFullyFinalized(sub, fqMap) {
  const aq = sub.activeQuarters||[];
  if(!aq.length) return false; // year-long subjects never auto-hide
  return aq.every(qid=>!!fqMap[qid]);
}
// Returns the date range a subject is valid for (union of active quarter ranges)
function subjectDateRange(sub, allQ) {
  const aq = sub.activeQuarters||[];
  if(!aq.length) return null; // no restriction
  const ranges = aq.map(qid=>allQ.find(q=>q.id===qid)).filter(Boolean);
  if(!ranges.length) return null;
  const start = ranges.map(r=>r.startDate).sort()[0];
  const end = ranges.map(r=>r.endDate).sort().slice(-1)[0];
  return {start, end};
}

// Write a full replacement state straight to Firestore (the live data store),
// wait for the write to finish, then reload. The localStorage("hsa3") path is
// legacy from the pre-Firebase build and is no longer read on load, so writing
// there has no effect. When removeExtraLogins is set, non-teacher login docs in
// the users subcollection are also deleted (best-effort; Firebase Auth accounts
// themselves can only be removed in the Firebase console).
function replaceStateInDb(newState, removeExtraLogins, label) {
  // Cancel any pending debounced save so stale state can't overwrite the wipe
  if(window._saveTimer) clearTimeout(window._saveTimer);
  if(label && window._auditEntry){ newState=Object.assign({},newState,{auditLog:((newState.auditLog||[]).concat([window._auditEntry("data",label)])).slice(-2000)}); }
  const school=window._db.collection("schools").doc(window._schoolId);
  let removedEmails=[];
  // Keep ONLY admin accounts (and yourself). Teacher/parent/student records go.
  const cleanup=removeExtraLogins
    ? school.collection("users").get().then(snap=>{
        const doomed=snap.docs.filter(d=>d.id!==(window._appUser&&window._appUser.id)&&(d.data().role||"")!=="admin");
        removedEmails=doomed.map(d=>d.data().email||d.id);
        return Promise.all(doomed.map(d=>d.ref.delete()));
      }).catch(()=>{})
    : Promise.resolve();
  const wipeCols=removeExtraLogins
    ? Promise.all(["portals","responses","snapshots"].map(col=>school.collection(col).get().then(snap=>Promise.all(snap.docs.map(d=>d.ref.delete()))).catch(()=>{})))
    : Promise.resolve();
  return Promise.all([cleanup,wipeCols])
    .then(()=>school.collection("state").doc("main").set(newState))
    // Delete the sign-ins too, when the purge Cloud Function is deployed.
    .then(()=>removeExtraLogins?window._callFn("purgeNonAdminAuth",{}).catch(function(){return null;}):null)
    .then(function(purge){
      try{localStorage.removeItem("hsa3");}catch(e){}
      if(purge&&typeof purge.deleted==="number"){
        alert("Cleared. Removed "+removedEmails.length+" account record(s) and deleted "+purge.deleted+" Firebase Authentication sign-in(s)."+((purge.failed&&purge.failed.length)?"\n\nCould not delete: "+purge.failed.join(", "):""));
      } else if(removedEmails.length){
        alert("Removed "+removedEmails.length+" account record(s) from the database:\n\n"+removedEmails.join("\n")+"\n\nTheir sign-ins still exist in Firebase Authentication. Deploy the Cloud Functions (see DEPLOYMENT.md) to have these removed automatically, or delete them in the Firebase console under Authentication \u2192 Users.");
      }
      window.location.reload();
    })
    .catch(e=>alert("Could not update the school database: "+e.message));
}

// Build demo data relative to today's date (for "Create Demo Data" button)
function buildRelativeDemoState() {
  const d=new Date();
  // School year: Aug 26 to May 23, relative to current academic year
  const yr=d.getMonth()>=7?d.getFullYear():d.getFullYear()-1;
  const syStart=yr+"-08-26";
  const syEnd=(yr+1)+"-05-23";
  // Quarter midpoints based on school year
  const q1s=yr+"-08-26", q1e=yr+"-10-25";
  const q2s=yr+"-10-28", q2e=yr+"-12-20";
  const q3s=(yr+1)+"-01-06", q3e=(yr+1)+"-03-14";
  const q4s=(yr+1)+"-03-17", q4e=(yr+1)+"-05-23";
  // Offset helper: days from syStart
  const off=(n)=>{const dt=new Date(syStart+"T12:00:00");dt.setDate(dt.getDate()+n);return dt.toISOString().slice(0,10);};
  const demo=buildDemoState();
  // Replace all 2024/2025 dates with relative ones
  const str=JSON.stringify(demo)
    .replace(/2024-08-26/g,syStart).replace(/2025-05-23/g,syEnd)
    .replace(/2024-10-25/g,q1e).replace(/2024-10-28/g,q2s)
    .replace(/2024-12-20/g,q2e).replace(/2025-01-06/g,q3s)
    .replace(/2025-03-14/g,q3e).replace(/2025-03-17/g,q4s)
    .replace(/2025-01/g,(yr+1)+"-01").replace(/2025-02/g,(yr+1)+"-02")
    .replace(/2025-03/g,(yr+1)+"-03").replace(/2025-04/g,(yr+1)+"-04")
    .replace(/2025-05/g,(yr+1)+"-05")
    .replace(/2024-09/g,yr+"-09").replace(/2024-10/g,yr+"-10")
    .replace(/2024-11/g,yr+"-11").replace(/2024-12/g,yr+"-12")
    .replace(/2024-08/g,yr+"-08");
  return JSON.parse(str);
}

// ─── DEMO DATA ────────────────────────────────────────────────────────────────
// ⚠️  FAKE PLAY DATA — for demonstration purposes only. DELETE before going live.
// To reset: use the Clear All Data button in Settings.
function buildDemoState() {
  // Students
  const emma  = {id:"s1", name:"Emma Carter",    gradeLevel:"2nd Grade",  parentEmail:"carter.family@email.com",  parentPhone:"(515) 203-4471"};
  const liam  = {id:"s2", name:"Liam Torres",    gradeLevel:"Kindergarten",parentEmail:"torres.home@email.com",    parentPhone:"(515) 887-2230"};
  const sofia = {id:"s3", name:"Sofia Nguyen",   gradeLevel:"8th Grade",  parentEmail:"nguyen.parents@email.com", parentPhone:"(641) 334-9910"};
  const noah  = {id:"s4", name:"Noah Patel",     gradeLevel:"10th Grade", parentEmail:"patel.family@email.com",   parentPhone:"(515) 762-0054"};
  const mia   = {id:"s5", name:"Mia Robinson",   gradeLevel:"1st Grade",  parentEmail:"robinson.home@email.com",  parentPhone:"(641) 509-3318"};
  const ethan = {id:"s6", name:"Ethan Walsh",    gradeLevel:"11th Grade", parentEmail:"walsh.parents@email.com",  parentPhone:"(515) 448-7723"};

  // Parent accounts
  const pCarter  = {id:"p1",username:"carter",    role:"parent",  name:"David Carter",   email:"carter.family@email.com",  studentIds:["s1"]};
  const pTorres  = {id:"p2",username:"torres",    role:"parent",  name:"Maria Torres",   email:"torres.home@email.com",    studentIds:["s2"]};
  const pNguyen  = {id:"p3",username:"nguyen",    role:"parent",  name:"Hana Nguyen",    email:"nguyen.parents@email.com", studentIds:["s3"]};
  const pPatel   = {id:"p4",username:"patel",      role:"parent",  name:"Raj Patel",      email:"patel.family@email.com",   studentIds:["s4"]};
  const stSofia  = {id:"u5",username:"sofia",      role:"student", name:"Sofia Nguyen",   email:"sofia@student.edu",        studentIds:["s3"]};
  const stNoah   = {id:"u6",username:"noah",        role:"student", name:"Noah Patel",     email:"noah@student.edu",         studentIds:["s4"]};

  // Link parents
  const students = [
    {...emma},
    {...liam},
    {...sofia},
    {...noah},
    {...mia},
    {...ethan},
  ];

  // ── SUBJECTS ──
  // Emma (2nd Grade, MDN)
  const emmaReading   = {id:"sub_er",  name:"Reading",     emoji:"📖", assignments:[
    {id:"a1",  name:"Letter Sounds Quiz",   date:"2024-09-10", maxScore:100, score:"M", category:"test"},
    {id:"a2",  name:"Sight Words Test",     date:"2024-09-24", maxScore:100, score:"M", category:"test"},
    {id:"a3",  name:"Reading Fluency",      date:"2024-10-08", maxScore:100, score:"D"},
    {id:"a4",  name:"Comprehension Check",  date:"2024-10-22", maxScore:100, score:"M"},
    {id:"a5",  name:"Story Retell",         date:"2024-11-05", maxScore:100, score:"M"},
    {id:"a6",  name:"Nov Fluency Check",    date:"2024-11-19", maxScore:100, score:null},
    {id:"sub_er_7", name:"Winter Reading Log", date:"2024-12-03", maxScore:100, score:"M"},
    {id:"sub_er_8", name:"Author Study", date:"2024-12-16", maxScore:100, score:"D",category:"test"},
    {id:"sub_er_9", name:"Chapter Book Report", date:"2025-01-20", maxScore:100, score:"M"},
    {id:"sub_er_10", name:"Poetry Recitation", date:"2025-02-10", maxScore:100, score:"M",category:"test"},
    {id:"sub_er_11", name:"Vocabulary Check", date:"2025-03-03", maxScore:100, score:"M"},
    {id:"sub_er_12", name:"Spring Fluency", date:"2025-03-25", maxScore:100, score:"M"},
    {id:"sub_er_13", name:"Comprehension II", date:"2025-04-15", maxScore:100, score:"M",category:"test"},
    {id:"sub_er_14", name:"Year-End Reading", date:"2025-05-13", maxScore:100, score:"M",category:"test"},
  ]};
  const emmaMath      = {id:"sub_em",  name:"Math",        emoji:"🔢", assignments:[
    {id:"b1",  name:"Counting to 100",      date:"2024-09-12", maxScore:100, score:"M"},
    {id:"b2",  name:"Addition Facts",       date:"2024-09-26", maxScore:100, score:"D"},
    {id:"b3",  name:"Subtraction Intro",    date:"2024-10-10", maxScore:100, score:"D"},
    {id:"b4",  name:"Place Value",          date:"2024-10-24", maxScore:100, score:"M"},
    {id:"b5",  name:"Word Problems",        date:"2024-11-07", maxScore:100, score:"N"},
    {id:"b6",  name:"Measurement",          date:"2024-11-21", maxScore:100, score:null},
    {id:"sub_em_7", name:"Shapes & Patterns", date:"2024-12-03", maxScore:100, score:"M"},
    {id:"sub_em_8", name:"Telling Time", date:"2024-12-16", maxScore:100, score:"D",category:"test"},
    {id:"sub_em_9", name:"Money Counting", date:"2025-01-20", maxScore:100, score:"M"},
    {id:"sub_em_10", name:"Two-Digit Addition", date:"2025-02-10", maxScore:100, score:"D",category:"test"},
    {id:"sub_em_11", name:"Fractions Intro", date:"2025-03-03", maxScore:100, score:"M"},
    {id:"sub_em_12", name:"Graphing", date:"2025-03-25", maxScore:100, score:"M"},
    {id:"sub_em_13", name:"Multiplication Intro", date:"2025-04-15", maxScore:100, score:"D",category:"test"},
    {id:"sub_em_14", name:"Year-End Math", date:"2025-05-13", maxScore:100, score:"M",category:"test"},
  ]};
  const emmaSci       = {id:"sub_es",  name:"Science",     emoji:"🔬", assignments:[
    {id:"c1",  name:"Life Cycles Poster",   date:"2024-09-18", maxScore:100, score:"M"},
    {id:"c2",  name:"Weather Journal",      date:"2024-10-02", maxScore:100, score:"M"},
    {id:"c3",  name:"Animal Habitats",      date:"2024-10-16", maxScore:100, score:"D"},
    {id:"c4",  name:"Plant Observation",    date:"2024-11-01", maxScore:100, score:"M"},
    {id:"sub_es_7", name:"Seasons Chart", date:"2024-12-03", maxScore:100, score:"M"},
    {id:"sub_es_8", name:"Magnets Lab", date:"2024-12-16", maxScore:100, score:"M",category:"test"},
    {id:"sub_es_9", name:"States of Matter", date:"2025-01-20", maxScore:100, score:"D"},
    {id:"sub_es_10", name:"Solar System", date:"2025-02-10", maxScore:100, score:"M",category:"test"},
    {id:"sub_es_11", name:"Plant Growth", date:"2025-03-03", maxScore:100, score:"M"},
    {id:"sub_es_12", name:"Simple Machines", date:"2025-03-25", maxScore:100, score:"M"},
    {id:"sub_es_13", name:"Weather Patterns", date:"2025-04-15", maxScore:100, score:"M",category:"test"},
    {id:"sub_es_14", name:"Year-End Science", date:"2025-05-13", maxScore:100, score:"M",category:"test"},
  ]};
  const emmaArt       = {id:"sub_ea",  name:"Art",         emoji:"🎨", assignments:[
    {id:"d1",  name:"Color Wheel",          date:"2024-09-20", maxScore:100, score:"M"},
    {id:"d2",  name:"Fall Collage",         date:"2024-10-18", maxScore:100, score:"M"},
    {id:"d3",  name:"Self Portrait",        date:"2024-11-08", maxScore:100, score:null},
    {id:"sub_ea_7", name:"Winter Landscape", date:"2024-12-03", maxScore:100, score:"M"},
    {id:"sub_ea_8", name:"Clay Sculpture", date:"2024-12-16", maxScore:100, score:"M",category:"test"},
    {id:"sub_ea_9", name:"Watercolor Study", date:"2025-01-20", maxScore:100, score:"M"},
    {id:"sub_ea_10", name:"Printmaking", date:"2025-02-10", maxScore:100, score:"D",category:"test"},
    {id:"sub_ea_11", name:"Portrait Drawing", date:"2025-03-03", maxScore:100, score:"M"},
    {id:"sub_ea_12", name:"Spring Mural", date:"2025-03-25", maxScore:100, score:"M"},
    {id:"sub_ea_13", name:"Collage Project", date:"2025-04-15", maxScore:100, score:"M",category:"test"},
    {id:"sub_ea_14", name:"Art Portfolio", date:"2025-05-13", maxScore:100, score:"M",category:"test"},
  ]};

  // Liam (Kindergarten, MDN)
  const liamReading   = {id:"sub_lr",  name:"Reading",     emoji:"📖", assignments:[
    {id:"e1",  name:"Letter Recognition",   date:"2024-09-09", maxScore:100, score:"D"},
    {id:"e2",  name:"Phonics Check",        date:"2024-09-23", maxScore:100, score:"N"},
    {id:"e3",  name:"Sight Words 1",        date:"2024-10-07", maxScore:100, score:"D"},
    {id:"e4",  name:"Sight Words 2",        date:"2024-10-21", maxScore:100, score:"D"},
    {id:"e5",  name:"Read Aloud Nov",       date:"2024-11-04", maxScore:100, score:null},
    {id:"sub_lr_7", name:"Rhyming Words", date:"2024-12-03", maxScore:100, score:"D"},
    {id:"sub_lr_8", name:"Letter Blends", date:"2024-12-16", maxScore:100, score:"N",category:"test"},
    {id:"sub_lr_9", name:"Sight Words II", date:"2025-01-20", maxScore:100, score:"D"},
    {id:"sub_lr_10", name:"Story Sequence", date:"2025-02-10", maxScore:100, score:"D",category:"test"},
    {id:"sub_lr_11", name:"Beginning Sounds", date:"2025-03-03", maxScore:100, score:"M"},
    {id:"sub_lr_12", name:"Simple Sentences", date:"2025-03-25", maxScore:100, score:"D"},
    {id:"sub_lr_13", name:"Spring Read Aloud", date:"2025-04-15", maxScore:100, score:"D",category:"test"},
    {id:"sub_lr_14", name:"Year-End Reading", date:"2025-05-13", maxScore:100, score:"M",category:"test"},
  ]};
  const liamMath      = {id:"sub_lm",  name:"Math",        emoji:"🔢", assignments:[
    {id:"f1",  name:"Counting Objects",     date:"2024-09-11", maxScore:100, score:"M"},
    {id:"f2",  name:"Number Recognition",   date:"2024-09-25", maxScore:100, score:"M"},
    {id:"f3",  name:"Shapes",              date:"2024-10-09", maxScore:100, score:"D"},
    {id:"f4",  name:"Patterns",            date:"2024-10-23", maxScore:100, score:"M"},
    {id:"sub_lm_7", name:"Number Writing", date:"2024-12-03", maxScore:100, score:"D"},
    {id:"sub_lm_8", name:"Shape Sorting", date:"2024-12-16", maxScore:100, score:"M",category:"test"},
    {id:"sub_lm_9", name:"Counting by 5s", date:"2025-01-20", maxScore:100, score:"D"},
    {id:"sub_lm_10", name:"Comparing Numbers", date:"2025-02-10", maxScore:100, score:"N",category:"test"},
    {id:"sub_lm_11", name:"Simple Addition", date:"2025-03-03", maxScore:100, score:"D"},
    {id:"sub_lm_12", name:"Patterns", date:"2025-03-25", maxScore:100, score:"M"},
    {id:"sub_lm_13", name:"Measurement Intro", date:"2025-04-15", maxScore:100, score:"D",category:"test"},
    {id:"sub_lm_14", name:"Year-End Math", date:"2025-05-13", maxScore:100, score:"D",category:"test"},
  ]};
  const liamArt       = {id:"sub_la",  name:"Art",         emoji:"🎨", assignments:[
    {id:"g1",  name:"Finger Painting",      date:"2024-09-17", maxScore:100, score:"M"},
    {id:"g2",  name:"Clay Shapes",          date:"2024-10-15", maxScore:100, score:"D"},
    {id:"sub_la_7", name:"Winter Craft", date:"2024-12-03", maxScore:100, score:"M"},
    {id:"sub_la_8", name:"Finger Painting", date:"2024-12-16", maxScore:100, score:"M",category:"test"},
    {id:"sub_la_9", name:"Shape Collage", date:"2025-01-20", maxScore:100, score:"D"},
    {id:"sub_la_10", name:"Spring Flowers", date:"2025-02-10", maxScore:100, score:"M",category:"test"},
    {id:"sub_la_11", name:"Clay Play", date:"2025-03-03", maxScore:100, score:"M"},
    {id:"sub_la_12", name:"Color Mixing", date:"2025-03-25", maxScore:100, score:"D"},
    {id:"sub_la_13", name:"Nature Art", date:"2025-04-15", maxScore:100, score:"M",category:"test"},
    {id:"sub_la_14", name:"Art Showcase", date:"2025-05-13", maxScore:100, score:"M",category:"test"},
  ]};

  // Mia (1st Grade, MDN)
  const miaReading    = {id:"sub_mr",  name:"Reading",     emoji:"📖", assignments:[
    {id:"h1",  name:"Phonics Test 1",       date:"2024-09-10", maxScore:100, score:"M", category:"test"},
    {id:"h2",  name:"Short Vowels",         date:"2024-09-24", maxScore:100, score:"M"},
    {id:"h3",  name:"Word Families",        date:"2024-10-08", maxScore:100, score:"D"},
    {id:"h4",  name:"Fluency Oct",          date:"2024-10-22", maxScore:100, score:"M"},
    {id:"h5",  name:"Comprehension Nov",    date:"2024-11-05", maxScore:100, score:null},
    {id:"sub_mr_7", name:"Winter Story Time", date:"2024-12-03", maxScore:100, score:"M"},
    {id:"sub_mr_8", name:"Sight Word Test", date:"2024-12-16", maxScore:100, score:"M",category:"test"},
    {id:"sub_mr_9", name:"Reading Log Jan", date:"2025-01-20", maxScore:100, score:"D"},
    {id:"sub_mr_10", name:"Fluency Practice", date:"2025-02-10", maxScore:100, score:"M",category:"test"},
    {id:"sub_mr_11", name:"Book Report", date:"2025-03-03", maxScore:100, score:"M"},
    {id:"sub_mr_12", name:"Poetry Unit", date:"2025-03-25", maxScore:100, score:"D"},
    {id:"sub_mr_13", name:"Spring Fluency", date:"2025-04-15", maxScore:100, score:"M",category:"test"},
    {id:"sub_mr_14", name:"Year-End Reading", date:"2025-05-13", maxScore:100, score:"M",category:"test"},
  ]};
  const miaMath       = {id:"sub_mm",  name:"Math",        emoji:"🔢", assignments:[
    {id:"i1",  name:"Number Bonds",         date:"2024-09-12", maxScore:100, score:"M"},
    {id:"i2",  name:"Adding to 10",         date:"2024-09-26", maxScore:100, score:"M"},
    {id:"i3",  name:"Subtracting to 10",    date:"2024-10-10", maxScore:100, score:"D"},
    {id:"i4",  name:"Story Problems",       date:"2024-10-24", maxScore:100, score:"D"},
    {id:"sub_mm_7", name:"Addition Facts II", date:"2024-12-03", maxScore:100, score:"M"},
    {id:"sub_mm_8", name:"Subtraction Facts", date:"2024-12-16", maxScore:100, score:"D",category:"test"},
    {id:"sub_mm_9", name:"Place Value II", date:"2025-01-20", maxScore:100, score:"M"},
    {id:"sub_mm_10", name:"Time & Money", date:"2025-02-10", maxScore:100, score:"D",category:"test"},
    {id:"sub_mm_11", name:"Measurement", date:"2025-03-03", maxScore:100, score:"M"},
    {id:"sub_mm_12", name:"Simple Fractions", date:"2025-03-25", maxScore:100, score:"D"},
    {id:"sub_mm_13", name:"Word Problems II", date:"2025-04-15", maxScore:100, score:"M",category:"test"},
    {id:"sub_mm_14", name:"Year-End Math", date:"2025-05-13", maxScore:100, score:"M",category:"test"},
  ]};
  const miaScience    = {id:"sub_ms",  name:"Science",     emoji:"🌿", assignments:[
    {id:"j1",  name:"Seasons Chart",        date:"2024-09-18", maxScore:100, score:"M"},
    {id:"j2",  name:"Animal Sort",          date:"2024-10-03", maxScore:100, score:"M"},
    {id:"sub_ms_7", name:"Winter Weather", date:"2024-12-03", maxScore:100, score:"M"},
    {id:"sub_ms_8", name:"Animal Groups", date:"2024-12-16", maxScore:100, score:"M",category:"test"},
    {id:"sub_ms_9", name:"Magnets & Motion", date:"2025-01-20", maxScore:100, score:"D"},
    {id:"sub_ms_10", name:"Life Cycles II", date:"2025-02-10", maxScore:100, score:"M",category:"test"},
    {id:"sub_ms_11", name:"Rocks & Soil", date:"2025-03-03", maxScore:100, score:"M"},
    {id:"sub_ms_12", name:"Spring Garden", date:"2025-03-25", maxScore:100, score:"M"},
    {id:"sub_ms_13", name:"Habitats II", date:"2025-04-15", maxScore:100, score:"D",category:"test"},
    {id:"sub_ms_14", name:"Year-End Science", date:"2025-05-13", maxScore:100, score:"M",category:"test"},
  ]};

  // Sofia (8th Grade, Letter)
  const sofiaEnglish  = {id:"sub_se",  name:"English",     emoji:"✏️", assignments:[
    {id:"k1",  name:"Essay 1: Narrative",   date:"2024-09-11", maxScore:100, score:88},
    {id:"k2",  name:"Grammar Quiz 1",       date:"2024-09-25", maxScore:50,  score:44, category:"test"},
    {id:"k3",  name:"Vocabulary Test",      date:"2024-10-09", maxScore:40,  score:35, category:"test"},
    {id:"k4",  name:"Essay 2: Argument",    date:"2024-10-23", maxScore:100, score:91},
    {id:"k5",  name:"Book Report",          date:"2024-11-06", maxScore:100, score:85},
    {id:"k6",  name:"Midterm Essay",        date:"2024-11-20", maxScore:100, score:null},
    {id:"sub_se_7", name:"Essay: Theme", date:"2024-12-03", maxScore:100, score:91},
    {id:"sub_se_8", name:"Grammar Test", date:"2024-12-16", maxScore:50, score:44,category:"test"},
    {id:"sub_se_9", name:"Novel Study", date:"2025-01-20", maxScore:100, score:88},
    {id:"sub_se_10", name:"Research Notes", date:"2025-02-10", maxScore:50, score:46,category:"test"},
    {id:"sub_se_11", name:"Persuasive Essay", date:"2025-03-03", maxScore:100, score:93},
    {id:"sub_se_12", name:"Poetry Analysis", date:"2025-03-25", maxScore:100, score:89},
    {id:"sub_se_13", name:"Final Exam Prep", date:"2025-04-15", maxScore:50, score:45,category:"test"},
    {id:"sub_se_14", name:"Final Exam", date:"2025-05-13", maxScore:100, score:92,category:"test"},
  ]};
  const sofiaAlgebra  = {id:"sub_sa",  name:"Algebra I",   emoji:"🧮", assignments:[
    {id:"l1",  name:"Variables Quiz",       date:"2024-09-13", maxScore:25,  score:22, category:"test"},
    {id:"l2",  name:"Equations Test 1",     date:"2024-09-27", maxScore:100, score:79, category:"test"},
    {id:"l3",  name:"Inequalities",         date:"2024-10-11", maxScore:50,  score:38},
    {id:"l4",  name:"Graphing Lines",       date:"2024-10-25", maxScore:100, score:84},
    {id:"l5",  name:"Functions Quiz",       date:"2024-11-08", maxScore:30,  score:27, category:"test"},
    {id:"l6",  name:"Ch.5 Test",            date:"2024-11-22", maxScore:100, score:null, category:"test"},
    {id:"sub_sa_7", name:"Linear Equations", date:"2024-12-03", maxScore:100, score:86},
    {id:"sub_sa_8", name:"Systems Quiz", date:"2024-12-16", maxScore:25, score:22,category:"test"},
    {id:"sub_sa_9", name:"Inequalities", date:"2025-01-20", maxScore:100, score:90},
    {id:"sub_sa_10", name:"Quadratics Test", date:"2025-02-10", maxScore:100, score:84,category:"test"},
    {id:"sub_sa_11", name:"Factoring", date:"2025-03-03", maxScore:50, score:45},
    {id:"sub_sa_12", name:"Exponents", date:"2025-03-25", maxScore:100, score:88},
    {id:"sub_sa_13", name:"Review Quiz", date:"2025-04-15", maxScore:25, score:23,category:"test"},
    {id:"sub_sa_14", name:"Final Exam", date:"2025-05-13", maxScore:100, score:89,category:"test"},
  ]};
  const sofiaHistory  = {id:"sub_sh",  name:"History",     emoji:"🗺️", assignments:[
    {id:"m1",  name:"Timeline Project",     date:"2024-09-16", maxScore:100, score:95},
    {id:"m2",  name:"Primary Source Essay", date:"2024-10-01", maxScore:100, score:88},
    {id:"m3",  name:"Map Quiz",             date:"2024-10-14", maxScore:30,  score:28, category:"test"},
    {id:"m4",  name:"Civil War Test",       date:"2024-10-28", maxScore:100, score:72, category:"test"},
    {id:"m5",  name:"Research Paper Draft", date:"2024-11-11", maxScore:100, score:90},
    {id:"sub_sh_7", name:"Civil War Essay", date:"2024-12-03", maxScore:100, score:94},
    {id:"sub_sh_8", name:"Reconstruction Quiz", date:"2024-12-16", maxScore:25, score:23,category:"test"},
    {id:"sub_sh_9", name:"Industrial Age", date:"2025-01-20", maxScore:100, score:90},
    {id:"sub_sh_10", name:"Immigration Test", date:"2025-02-10", maxScore:100, score:87,category:"test"},
    {id:"sub_sh_11", name:"Progressive Era", date:"2025-03-03", maxScore:50, score:47},
    {id:"sub_sh_12", name:"WWI Project", date:"2025-03-25", maxScore:100, score:92},
    {id:"sub_sh_13", name:"Unit Review", date:"2025-04-15", maxScore:25, score:24,category:"test"},
    {id:"sub_sh_14", name:"Final Exam", date:"2025-05-13", maxScore:100, score:91,category:"test"},
  ]};
  const sofiaBiology  = {id:"sub_sb",  name:"Biology",     emoji:"🦋", assignments:[
    {id:"n1",  name:"Cell Structure Lab",   date:"2024-09-18", maxScore:100, score:93},
    {id:"n2",  name:"Photosynthesis Quiz",  date:"2024-10-02", maxScore:20,  score:17, category:"test"},
    {id:"n3",  name:"Genetics Worksheet",   date:"2024-10-16", maxScore:50,  score:44},
    {id:"n4",  name:"Lab Report",           date:"2024-10-30", maxScore:100, score:87},
    {id:"n5",  name:"Midterm",              date:"2024-11-13", maxScore:100, score:null},
    {id:"sub_sb_7", name:"Cell Division Lab", date:"2024-12-03", maxScore:100, score:89},
    {id:"sub_sb_8", name:"Genetics Quiz", date:"2024-12-16", maxScore:50, score:44,category:"test"},
    {id:"sub_sb_9", name:"Heredity Test", date:"2025-01-20", maxScore:100, score:86},
    {id:"sub_sb_10", name:"Ecology Project", date:"2025-02-10", maxScore:100, score:93,category:"test"},
    {id:"sub_sb_11", name:"Evolution Notes", date:"2025-03-03", maxScore:50, score:46},
    {id:"sub_sb_12", name:"Anatomy Unit", date:"2025-03-25", maxScore:100, score:88},
    {id:"sub_sb_13", name:"Lab Practical", date:"2025-04-15", maxScore:50, score:45,category:"test"},
    {id:"sub_sb_14", name:"Final Exam", date:"2025-05-13", maxScore:100, score:90,category:"test"},
  ]};

  // Noah (10th Grade, Letter)
  const noahLit       = {id:"sub_nl",  name:"Literature",  emoji:"📚", assignments:[
    {id:"o1",  name:"Short Story Analysis", date:"2024-09-10", maxScore:100, score:76},
    {id:"o2",  name:"Poetry Explication",   date:"2024-09-24", maxScore:100, score:82},
    {id:"o3",  name:"Hamlet Act I Quiz",    date:"2024-10-08", maxScore:25,  score:19, category:"test"},
    {id:"o4",  name:"Hamlet Essay",         date:"2024-10-22", maxScore:100, score:88},
    {id:"o5",  name:"Research Proposal",    date:"2024-11-05", maxScore:50,  score:43},
    {id:"o6",  name:"Final Essay",          date:"2024-11-26", maxScore:100, score:null},
    {id:"sub_nl_7", name:"Macbeth Act I", date:"2024-12-03", maxScore:50, score:40},
    {id:"sub_nl_8", name:"Macbeth Essay", date:"2024-12-16", maxScore:100, score:84,category:"test"},
    {id:"sub_nl_9", name:"Poetry Unit", date:"2025-01-20", maxScore:100, score:79},
    {id:"sub_nl_10", name:"Research Paper", date:"2025-02-10", maxScore:100, score:86,category:"test"},
    {id:"sub_nl_11", name:"Rhetoric Quiz", date:"2025-03-03", maxScore:25, score:20},
    {id:"sub_nl_12", name:"Modern Novel", date:"2025-03-25", maxScore:100, score:82},
    {id:"sub_nl_13", name:"Seminar Prep", date:"2025-04-15", maxScore:50, score:42,category:"test"},
    {id:"sub_nl_14", name:"Final Exam", date:"2025-05-13", maxScore:100, score:85,category:"test"},
  ]};
  const noahGeometry  = {id:"sub_ng",  name:"Geometry",    emoji:"📐", assignments:[
    {id:"p1",  name:"Proofs Quiz 1",        date:"2024-09-12", maxScore:30,  score:24, category:"test"},
    {id:"p2",  name:"Triangle Test",        date:"2024-09-26", maxScore:100, score:91, category:"test"},
    {id:"p3",  name:"Circle Theorems",      date:"2024-10-10", maxScore:50,  score:47},
    {id:"p4",  name:"Coordinate Geo Test",  date:"2024-10-24", maxScore:100, score:85, category:"test"},
    {id:"p5",  name:"Transformation Quiz",  date:"2024-11-07", maxScore:25,  score:23, category:"test"},
    {id:"p6",  name:"Semester Test",        date:"2024-12-03", maxScore:100, score:null, category:"test"},
    {id:"sub_ng_7", name:"Similarity Test", date:"2024-12-03", maxScore:100, score:83},
    {id:"sub_ng_8", name:"Trig Ratios Quiz", date:"2024-12-16", maxScore:25, score:21,category:"test"},
    {id:"sub_ng_9", name:"Area & Volume", date:"2025-01-20", maxScore:100, score:88},
    {id:"sub_ng_10", name:"Circles Unit", date:"2025-02-10", maxScore:100, score:80,category:"test"},
    {id:"sub_ng_11", name:"Proofs II", date:"2025-03-03", maxScore:50, score:43},
    {id:"sub_ng_12", name:"Solid Geometry", date:"2025-03-25", maxScore:100, score:86},
    {id:"sub_ng_13", name:"Review Test", date:"2025-04-15", maxScore:50, score:44,category:"test"},
    {id:"sub_ng_14", name:"Final Exam", date:"2025-05-13", maxScore:100, score:84,category:"test"},
  ]};
  const noahChemistry = {id:"sub_nc",  name:"Chemistry",   emoji:"🔬", assignments:[
    {id:"q1",  name:"Periodic Table Quiz",  date:"2024-09-13", maxScore:50,  score:42, category:"test"},
    {id:"q2",  name:"Atomic Structure",     date:"2024-09-27", maxScore:100, score:78},
    {id:"q3",  name:"Bonding Lab",          date:"2024-10-11", maxScore:100, score:83},
    {id:"q4",  name:"Reactions Test",       date:"2024-10-25", maxScore:100, score:69, category:"test"},
    {id:"q5",  name:"Stoichiometry Quiz",   date:"2024-11-08", maxScore:40,  score:31, category:"test"},
    {id:"q6",  name:"Midterm",              date:"2024-11-22", maxScore:100, score:null},
    {id:"sub_nc_7", name:"Gas Laws Test", date:"2024-12-03", maxScore:100, score:74},
    {id:"sub_nc_8", name:"Solutions Quiz", date:"2024-12-16", maxScore:25, score:19,category:"test"},
    {id:"sub_nc_9", name:"Acids & Bases", date:"2025-01-20", maxScore:100, score:81},
    {id:"sub_nc_10", name:"Thermochem", date:"2025-02-10", maxScore:100, score:77,category:"test"},
    {id:"sub_nc_11", name:"Equilibrium", date:"2025-03-03", maxScore:50, score:39},
    {id:"sub_nc_12", name:"Organic Intro", date:"2025-03-25", maxScore:100, score:83},
    {id:"sub_nc_13", name:"Lab Practical", date:"2025-04-15", maxScore:50, score:41,category:"test"},
    {id:"sub_nc_14", name:"Final Exam", date:"2025-05-13", maxScore:100, score:79,category:"test"},
  ]};
  const noahSpanish   = {id:"sub_ns",  name:"Spanish II",  emoji:"🌍", assignments:[
    {id:"r1",  name:"Vocabulary Ch.3",      date:"2024-09-11", maxScore:50,  score:46},
    {id:"r2",  name:"Conjugation Test",     date:"2024-09-25", maxScore:100, score:88, category:"test"},
    {id:"r3",  name:"Reading Comp.",        date:"2024-10-09", maxScore:30,  score:25},
    {id:"r4",  name:"Oral Presentation",    date:"2024-10-23", maxScore:100, score:92},
    {id:"r5",  name:"Culture Essay",        date:"2024-11-06", maxScore:100, score:null},
    {id:"sub_ns_7", name:"Past Tense Test", date:"2024-12-03", maxScore:100, score:90},
    {id:"sub_ns_8", name:"Culture Project", date:"2024-12-16", maxScore:100, score:94,category:"test"},
    {id:"sub_ns_9", name:"Listening Quiz", date:"2025-01-20", maxScore:25, score:22},
    {id:"sub_ns_10", name:"Subjunctive Unit", date:"2025-02-10", maxScore:100, score:85,category:"test"},
    {id:"sub_ns_11", name:"Oral Exam", date:"2025-03-03", maxScore:100, score:92},
    {id:"sub_ns_12", name:"Reading Comp II", date:"2025-03-25", maxScore:50, score:46},
    {id:"sub_ns_13", name:"Vocabulary Final", date:"2025-04-15", maxScore:50, score:47,category:"test"},
    {id:"sub_ns_14", name:"Final Exam", date:"2025-05-13", maxScore:100, score:91,category:"test"},
  ]};

  // Ethan (11th Grade, Letter)
  const ethanEnglish  = {id:"sub_ete", name:"AP English",  emoji:"✏️", assignments:[
    {id:"s1",  name:"Rhetorical Analysis",  date:"2024-09-11", maxScore:100, score:94},
    {id:"s2",  name:"Synthesis Essay",      date:"2024-09-25", maxScore:100, score:88},
    {id:"s3",  name:"Timed Write 1",        date:"2024-10-09", maxScore:100, score:82},
    {id:"s4",  name:"Research Essay",       date:"2024-10-23", maxScore:100, score:91},
    {id:"s5",  name:"Timed Write 2",        date:"2024-11-06", maxScore:100, score:86},
    {id:"s6",  name:"Portfolio",            date:"2024-11-20", maxScore:100, score:null},
    {id:"sub_ete_7", name:"Argument Essay", date:"2024-12-03", maxScore:100, score:93},
    {id:"sub_ete_8", name:"Seminar Paper", date:"2024-12-16", maxScore:100, score:90,category:"test"},
    {id:"sub_ete_9", name:"Rhetoric Test", date:"2025-01-20", maxScore:100, score:88},
    {id:"sub_ete_10", name:"Research Project", date:"2025-02-10", maxScore:100, score:95,category:"test"},
    {id:"sub_ete_11", name:"Timed Write 3", date:"2025-03-03", maxScore:100, score:87},
    {id:"sub_ete_12", name:"Literary Analysis", date:"2025-03-25", maxScore:100, score:91},
    {id:"sub_ete_13", name:"AP Practice Exam", date:"2025-04-15", maxScore:100, score:89,category:"test"},
    {id:"sub_ete_14", name:"Final Portfolio", date:"2025-05-13", maxScore:100, score:94,category:"test"},
  ]};
  const ethanCalc     = {id:"sub_etc", name:"Pre-Calculus",emoji:"🔢", assignments:[
    {id:"t1",  name:"Functions Test",       date:"2024-09-12", maxScore:100, score:73, category:"test"},
    {id:"t2",  name:"Trig Identities Quiz", date:"2024-09-26", maxScore:50,  score:38, category:"test"},
    {id:"t3",  name:"Polar Coordinates",    date:"2024-10-10", maxScore:100, score:68},
    {id:"t4",  name:"Sequences & Series",   date:"2024-10-24", maxScore:100, score:71},
    {id:"t5",  name:"Complex Numbers",      date:"2024-11-07", maxScore:50,  score:40},
    {id:"t6",  name:"Semester Exam",        date:"2024-12-05", maxScore:100, score:null},
    {id:"sub_etc_7", name:"Vectors Test", date:"2024-12-03", maxScore:100, score:70},
    {id:"sub_etc_8", name:"Matrices Quiz", date:"2024-12-16", maxScore:25, score:18,category:"test"},
    {id:"sub_etc_9", name:"Conic Sections", date:"2025-01-20", maxScore:100, score:74},
    {id:"sub_etc_10", name:"Limits Intro", date:"2025-02-10", maxScore:100, score:69,category:"test"},
    {id:"sub_etc_11", name:"Log Functions", date:"2025-03-03", maxScore:50, score:37},
    {id:"sub_etc_12", name:"Series & Sums", date:"2025-03-25", maxScore:100, score:76},
    {id:"sub_etc_13", name:"Review Test", date:"2025-04-15", maxScore:50, score:38,category:"test"},
    {id:"sub_etc_14", name:"Final Exam", date:"2025-05-13", maxScore:100, score:73,category:"test"},
  ]};
  const ethanPhysics  = {id:"sub_etp", name:"Physics",     emoji:"🔭", assignments:[
    {id:"u1",  name:"Kinematics Lab",       date:"2024-09-16", maxScore:100, score:88},
    {id:"u2",  name:"Forces & Motion Test", date:"2024-09-30", maxScore:100, score:81, category:"test"},
    {id:"u3",  name:"Energy Quiz",          date:"2024-10-14", maxScore:30,  score:26, category:"test"},
    {id:"u4",  name:"Momentum Lab Report",  date:"2024-10-28", maxScore:100, score:85},
    {id:"u5",  name:"Waves Test",           date:"2024-11-11", maxScore:100, score:79, category:"test"},
    {id:"u6",  name:"Midterm",              date:"2024-11-25", maxScore:100, score:null},
    {id:"sub_etp_7", name:"Circular Motion", date:"2024-12-03", maxScore:100, score:86},
    {id:"sub_etp_8", name:"Optics Lab", date:"2024-12-16", maxScore:100, score:90,category:"test"},
    {id:"sub_etp_9", name:"Electricity Test", date:"2025-01-20", maxScore:100, score:82},
    {id:"sub_etp_10", name:"Magnetism Quiz", date:"2025-02-10", maxScore:25, score:21,category:"test"},
    {id:"sub_etp_11", name:"Thermodynamics", date:"2025-03-03", maxScore:100, score:84},
    {id:"sub_etp_12", name:"Modern Physics", date:"2025-03-25", maxScore:100, score:88},
    {id:"sub_etp_13", name:"Lab Practical", date:"2025-04-15", maxScore:50, score:44,category:"test"},
    {id:"sub_etp_14", name:"Final Exam", date:"2025-05-13", maxScore:100, score:85,category:"test"},
  ]};

  const subjects = {
    s1: [emmaReading, emmaMath, emmaSci, emmaArt],
    s2: [liamReading, liamMath, liamArt],
    s3: [sofiaEnglish, sofiaAlgebra, sofiaHistory, sofiaBiology],
    s4: [noahLit, noahGeometry, noahChemistry, noahSpanish],
    s5: [miaReading, miaMath, miaScience],
    s6: [ethanEnglish, ethanCalc, ethanPhysics],
  };

  // ── ATTENDANCE ──
  // Build attendance for Aug 26 – Nov 15 2024 (Mon-Fri), 6hrs/day
  const schoolDays = [];
  const d = new Date("2024-08-26");
  const end = new Date("2024-11-15");
  while(d <= end) {
    const dow = d.getDay();
    if(dow>=1 && dow<=5) schoolDays.push(d.toISOString().slice(0,10));
    d.setDate(d.getDate()+1);
  }

  // Per-student attendance — small realistic variations
  const makeAtt = (sid, absIdx=[], tardyIdx=[]) =>
    schoolDays.map((date, i) => ({
      id: "att_"+sid+"_"+i,
      date,
      status: absIdx.includes(i) ? "absent" : tardyIdx.includes(i) ? "tardy" : "present",
      hours:  absIdx.includes(i) ? 0       : tardyIdx.includes(i) ? 4.5   : 6,
    }));

  const attendance = {
    s1: makeAtt("s1", [8,21,45], [3,14,30]),
    s2: makeAtt("s2", [5,18,32,47,52], [7,20,38]),   // Liam behind on hours
    s3: makeAtt("s3", [10,24], [2,9,19]),
    s4: makeAtt("s4", [6,15,29,40], [11,22,35,48]),
    s5: makeAtt("s5", [4,17,31], [8,23]),
    s6: makeAtt("s6", [2,13], [5,16,27]),
  };

  // ── SPECIAL DAYS ──
  const specialDays = [
    {id:"sp1", startDate:"2024-09-02", endDate:"2024-09-02", type:"break",  note:"Labor Day"},
    {id:"sp2", startDate:"2024-10-14", endDate:"2024-10-14", type:"break",  note:"Columbus Day"},
    {id:"sp3", startDate:"2024-11-11", endDate:"2024-11-11", type:"break",  note:"Veterans Day"},
    {id:"sp4", startDate:"2024-10-04", endDate:"2024-10-04", type:"delay",  note:"Morning delay"},
    {id:"sp5", startDate:"2024-11-01", endDate:"2024-11-01", type:"cancel", note:"Weather emergency"},
    {id:"sp6", startDate:"2024-11-25", endDate:"2024-11-29", type:"break",  note:"Thanksgiving Break"},
    {id:"sp7", startDate:"2024-12-23", endDate:"2025-01-03", type:"break",  note:"Winter Break"},
  ];

  // ── BEHAVIOR ──
  const behavior = {
    s1: [
      {id:"bh1",date:"2024-09-10",score:5,comment:"Excellent focus today"},
      {id:"bh2",date:"2024-09-18",score:4,comment:"Good participation"},
      {id:"bh3",date:"2024-10-03",score:5,comment:"Helped classmates"},
      {id:"bh4",date:"2024-10-15",score:3,comment:"Slightly distracted"},
      {id:"bh5",date:"2024-11-01",score:5,comment:"Outstanding day"},
      {id:"bh6",date:"2024-11-08",score:4,comment:"Good effort"},
    ],
    s2: [
      {id:"bh7", date:"2024-09-09",score:4,comment:"Good listening"},
      {id:"bh8", date:"2024-09-23",score:2,comment:"Had trouble sitting still"},
      {id:"bh9", date:"2024-10-07",score:5,comment:"Loved the art activity!"},
      {id:"bh10",date:"2024-10-21",score:3,comment:"Needed redirection twice"},
      {id:"bh11",date:"2024-11-04",score:4,comment:"Better focus today"},
    ],
    s3: [
      {id:"bh12",date:"2024-09-11",incident:false},
      {id:"bh13",date:"2024-10-09",incident:false},
      {id:"bh14",date:"2024-10-23",incident:false},
      {id:"bh15",date:"2024-11-06",incident:false},
    ],
    s4: [
      {id:"bh16",date:"2024-09-12",incident:false},
      {id:"bh17",date:"2024-10-10",incident:true,desc:"Refused to complete work",cons:"Loss of free period",next:"Check in with parents"},
      {id:"bh18",date:"2024-10-24",incident:false},
      {id:"bh19",date:"2024-11-07",incident:false},
    ],
    s5: [
      {id:"bh20",date:"2024-09-10",score:5,comment:"Great first week!"},
      {id:"bh21",date:"2024-09-24",score:4,comment:"Participated well"},
      {id:"bh22",date:"2024-10-08",score:5,comment:"Kind to everyone"},
      {id:"bh23",date:"2024-10-22",score:4,comment:"Good listening skills"},
      {id:"bh24",date:"2024-11-05",score:5,comment:"Star student today"},
    ],
    s6: [
      {id:"bh25",date:"2024-09-11",incident:false},
      {id:"bh26",date:"2024-10-09",incident:false},
      {id:"bh27",date:"2024-10-23",incident:false},
      {id:"bh28",date:"2024-11-06",incident:false},
    ],
  };

  // ── STRENGTHS & WEAKNESSES ──
  const sw = {
    s1: {
      strengths: [
        {id:"sw1",text:"Strong reading comprehension — above grade level",date:"2024-09-20"},
        {id:"sw2",text:"Creative and enthusiastic in art projects",date:"2024-10-05"},
        {id:"sw3",text:"Excellent memory for science vocabulary",date:"2024-10-28"},
      ],
      areas: [
        {id:"sw4",text:"Word problems in math need more practice",date:"2024-10-10"},
        {id:"sw5",text:"Handwriting consistency — letter formation",date:"2024-11-01"},
      ],
    },
    s2: {
      strengths: [
        {id:"sw6",text:"Natural enthusiasm and curiosity",date:"2024-09-15"},
        {id:"sw7",text:"Strong number sense — counts confidently to 100",date:"2024-10-02"},
      ],
      areas: [
        {id:"sw8",text:"Phonics decoding — needs daily reinforcement",date:"2024-09-23"},
        {id:"sw9",text:"Attention span during longer lessons",date:"2024-10-21"},
        {id:"sw10",text:"Fine motor skills for letter writing",date:"2024-11-01"},
      ],
    },
    s3: {
      strengths: [
        {id:"sw11",text:"Exceptional analytical writing skills",date:"2024-09-16"},
        {id:"sw12",text:"Self-motivated and independently organized",date:"2024-10-01"},
        {id:"sw13",text:"Strong biology and science lab work",date:"2024-10-18"},
      ],
      areas: [
        {id:"sw14",text:"Algebra: needs to show work step-by-step",date:"2024-10-12"},
        {id:"sw15",text:"Civil War unit — depth of historical analysis",date:"2024-11-01"},
      ],
    },
    s4: {
      strengths: [
        {id:"sw16",text:"Strong geometric reasoning and proofs",date:"2024-09-27"},
        {id:"sw17",text:"Oral Spanish skills are impressive",date:"2024-10-24"},
        {id:"sw18",text:"Literary analysis — nuanced close reading",date:"2024-10-09"},
      ],
      areas: [
        {id:"sw19",text:"Chemistry stoichiometry — needs more practice",date:"2024-11-08"},
        {id:"sw20",text:"Work refusal — managing frustration productively",date:"2024-10-11"},
        {id:"sw21",text:"Attendance pattern affecting continuity",date:"2024-11-01"},
      ],
    },
    s5: {
      strengths: [
        {id:"sw22",text:"Excellent phonics foundation",date:"2024-09-24"},
        {id:"sw23",text:"Kind, cooperative classroom presence",date:"2024-10-08"},
        {id:"sw24",text:"Strong number sense for 1st grade",date:"2024-10-22"},
      ],
      areas: [
        {id:"sw25",text:"Story problem comprehension — connecting words to math",date:"2024-10-25"},
      ],
    },
    s6: {
      strengths: [
        {id:"sw26",text:"Advanced rhetorical writing — AP-level quality",date:"2024-09-25"},
        {id:"sw27",text:"Strong physics intuition and lab skills",date:"2024-10-28"},
        {id:"sw28",text:"Disciplined study habits",date:"2024-10-01"},
      ],
      areas: [
        {id:"sw29",text:"Pre-Calculus: trigonometric identities need review",date:"2024-09-27"},
        {id:"sw30",text:"Test anxiety in timed math assessments",date:"2024-10-25"},
      ],
    },
  };

  // ── EVENTS ──
  const events = [
    {
      id:"ev1", name:"Fall Nature Walk", location:"Meskwaki Nature Trail",
      startDate:"2024-10-18", endDate:"2024-10-18",
      description:"Seasonal observation walk — bring a notebook and dress for the weather.",
      assignedStudents:["s1","s2","s5"],
      permissionSlip:true,
      responses:{s1:"authorized", s2:"authorized", s5:"authorized"},
    },
    {
      id:"ev2", name:"Library Research Day", location:"Montezuma Public Library",
      startDate:"2024-11-07", endDate:"2024-11-07",
      description:"Students will use library resources for current research projects.",
      assignedStudents:["s3","s4","s6"],
      permissionSlip:false,
      responses:{},
    },
    {
      id:"ev3", name:"Thanksgiving Break", location:"",
      startDate:"2024-11-25", endDate:"2024-11-29",
      description:"No classes. Enjoy the holiday!",
      assignedStudents:["s1","s2","s3","s4","s5","s6"],
      permissionSlip:false,
      responses:{},
    },
    {
      id:"ev4", name:"Parent-Teacher Conferences", location:"Home (Zoom)",
      startDate:"2024-12-05", endDate:"2024-12-06",
      description:"30-minute slots for each family. Progress reports will be distributed.",
      assignedStudents:["s1","s2","s3","s4","s5","s6"],
      permissionSlip:false,
      responses:{},
    },
    {
      id:"ev5", name:"Science Fair", location:"Community Center, Room B",
      startDate:"2025-01-24", endDate:"2025-01-24",
      description:"Students present independent science projects. Open to the public.",
      assignedStudents:["s3","s4","s6"],
      permissionSlip:true,
      responses:{s3:"authorized"},
    },
  ];

  return {
    users: [TEACHER, pCarter, pTorres, pNguyen, pPatel, stSofia, stNoah],
    students,
    subjects,
    attendance,
    specialDays,
    behavior,
    sw,
    events,
    saves: [],
    sy: {
      startDate:"2024-08-26",
      endDate:"2025-05-23",
      scheduledDays:DAYS,
      hoursPerDay:6,
      minHrs:DEFAULT_MIN_HRS,
      mdnCutoff:"5th Grade",
      pinnedNav:["dashboard","students","gradebook","attendance"],
      quarters:[
        {id:"q1",label:"Q1",startDate:"2024-08-26",endDate:"2024-10-25"},
        {id:"q2",label:"Q2",startDate:"2024-10-28",endDate:"2024-12-20"},
        {id:"q3",label:"Q3",startDate:"2025-01-06",endDate:"2025-03-14"},
        {id:"q4",label:"Q4",startDate:"2025-03-17",endDate:"2025-05-23"},
      ],
    },
    history:[],
    auditLog:[],
    finalizedQuarters:{},
    excuseFiles:[],
  };
}

function buildBlankState() {
  return {
    users:[TEACHER],
    students:[],
    subjects:{},
    attendance:{},
    behavior:{},
    sw:{},
    specialDays:[],
    events:[],
    saves:[],
    sy:{
      startDate:"",endDate:"",
      scheduledDays:DAYS,hoursPerDay:6,
      minHrs:DEFAULT_MIN_HRS,
      mdnCutoff:"5th Grade",
      numQuarters:4,
      quarters:[
        {id:"q1",label:"Q1",startDate:"",endDate:""},
        {id:"q2",label:"Q2",startDate:"",endDate:""},
        {id:"q3",label:"Q3",startDate:"",endDate:""},
        {id:"q4",label:"Q4",startDate:"",endDate:""},
      ],
      pinnedNav:["dashboard","students","gradebook","attendance"],
    },
    history:[],
    auditLog:[],
    finalizedQuarters:{},
    excuseFiles:[],
  };
}

function getInit() {
  try {
    const s=localStorage.getItem("hsa3");
    if(s) {
      const parsed = JSON.parse(s);
      // Always sync teacher record from TEACHER constant so name/email changes take effect
      parsed.users = parsed.users.map(u => u.role==="teacher" ? {...u, name:TEACHER.name, email:TEACHER.email} : u);
      if(!parsed.auditLog) parsed.auditLog=[];
      if(!parsed.finalizedQuarters) parsed.finalizedQuarters={};
      if(!parsed.excuseFiles) parsed.excuseFiles=[];
      return parsed;
    }
  } catch{}
  // No saved state in localStorage (e.g. first load or artifact sandbox reset)
  // In the artifact sandbox localStorage doesn't persist between sessions,
  // so we default to demo data so the app is always demonstrable.
  // In a real deployed app this fallback would be buildBlankState().
  return buildDemoState();
}

// ─── RADAR CHART ──────────────────────────────────────────────────────────────
function Radar({subs, sz=200}) {
  const empty=!subs?.length;
  const cx=sz/2, cy=sz/2, r=sz*0.35, n=empty?1:subs.length;
  const step=(2*Math.PI)/n;
  const pt=(i,v)=>{const a=i*step-Math.PI/2,d=(v/3)*r;return[cx+d*Math.cos(a),cy+d*Math.sin(a)];};
  const lp=(i)=>{const a=i*step-Math.PI/2,d=r+22;return[cx+d*Math.cos(a),cy+d*Math.sin(a)];};
  const grids=empty?[]:[1,2,3].map(lv=>subs.map((_,i)=>pt(i,lv).join(",")).join(" "));
  const pts=empty?[]:subs.map((s,i)=>{const v=s.avg!==null?Math.max(0,Math.min(3,s.avg)):0;return pt(i,v);});
  return (
    <svg width={sz} height={sz} style={{overflow:"visible"}}>
      {empty&&<text x={cx} y={cy} textAnchor="middle" fontSize={11} fill="#666">No data</text>}
      {!empty&&grids.map((g,i)=><polygon key={i} points={g} fill="none" stroke="rgba(0,0,0,0.15)" strokeWidth={1}/>)}
      {!empty&&subs.map((_,i)=>{const p=pt(i,3);return <line key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke="rgba(0,0,0,0.12)" strokeWidth={1}/>;})}
      {!empty&&<polygon points={pts.map(p=>p.join(",")).join(" ")} fill="rgba(26,106,26,0.15)" stroke="#1a6a1a" strokeWidth={2}/>}
      {!empty&&pts.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r={4} fill="#1a6a1a" stroke="#fff" strokeWidth={1.5}/>)}
      {!empty&&subs.map((s,i)=>{const l=lp(i);return <text key={i} x={l[0]} y={l[1]} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="#334155">{s.emoji} {s.name.length>7?s.name.slice(0,6)+"…":s.name}</text>;})}
    </svg>
  );
}

function BarChart({subs}) {
  // Single-period bar chart (used when only one period selected)
  return (
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      {(subs||[]).map(s=>{
        const p=s.avg!==null?Math.round(s.avg):null;
        const l=p!==null?getLetter(p):"—";
        const c=p>=90?"#4ade80":p>=70?"#fbbf24":p>=60?"#fb923c":"#f87171";
        return (
          <div key={s.id} style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:14,width:20}}>{s.emoji}</span>
            <span style={{fontSize:11,color:"#94a3b8",width:88,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</span>
            <div style={{flex:1,background:"rgba(255,255,255,0.07)",borderRadius:3,height:12,overflow:"hidden"}}>
              {p!==null&&<div style={{width:(p+"%"),background:c,height:"100%",borderRadius:3}}/>}
            </div>
            <span style={{fontSize:12,color:c,fontWeight:700,width:28,textAlign:"right"}}>{l}</span>
          </div>
        );
      })}
    </div>
  );
}

function MultiPeriodChart({periods}) {
  // Grouped bar chart comparing multiple periods across subjects
  // Get all unique subjects across all periods
  const allSubs=[];
  const seen=new Set();
  periods.forEach(p=>(p.sd||[]).forEach(s=>{if(!seen.has(s.id)){seen.add(s.id);allSubs.push({id:s.id,name:s.name,emoji:s.emoji});}}));
  // Color palette for periods
  const COLORS=["#4caf50","#34d399","#f59e0b","#f87171","#a78bfa","#fb923c"];
  const BAR_H=18;
  const GAP=4;
  const NAME_W=100;
  const chartH=allSubs.length*(periods.length*(BAR_H+GAP)+12)+40;
  return(
    <div style={{overflowX:"auto"}}>
      <div style={{fontSize:11,color:"#94a3b8",marginBottom:10,display:"flex",gap:16,flexWrap:"wrap"}}>
        {periods.map((p,i)=>(
          <span key={p.id} style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{width:12,height:12,borderRadius:2,background:COLORS[i%COLORS.length],display:"inline-block"}}/>
            {p.label}
          </span>
        ))}
      </div>
      <div style={{position:"relative",minWidth:340}}>
        {allSubs.map((sub,si)=>(
          <div key={sub.id} style={{marginBottom:12}}>
            <div style={{fontSize:11,color:"#94a3b8",marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              {sub.emoji} {sub.name}
            </div>
            {periods.map((p,pi)=>{
              const sd=(p.sd||[]).find(s=>s.id===sub.id);
              const pct=sd?.avg!==null&&sd?.avg!==undefined?Math.round(sd.avg):null;
              const ltr=pct!==null?getLetter(pct):"—";
              const color=COLORS[pi%COLORS.length];
              return(
                <div key={p.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:GAP}}>
                  <div style={{flex:1,background:"rgba(255,255,255,0.07)",borderRadius:3,height:BAR_H,overflow:"hidden",position:"relative"}}>
                    {pct!==null&&<div style={{width:pct+"%",background:color,height:"100%",borderRadius:3,opacity:0.85,transition:"width 0.3s"}}/>}
                    <span style={{position:"absolute",left:6,top:0,lineHeight:BAR_H+"px",fontSize:10,color:"#fff",fontWeight:600,mixBlendMode:"difference"}}>
                      {p.label}
                    </span>
                  </div>
                  <span style={{fontSize:12,color:color,fontWeight:700,width:52,textAlign:"right"}}>{pct!==null?pct+"%":""} <span style={{fontSize:10}}>{ltr}</span></span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --bg:#f0f4f8;--c1:#ffffff;--c2:#e8edf3;--c3:#dce3ec;--hov:#eef2f7;
  --br:rgba(0,0,0,0.08);--br2:rgba(0,0,0,0.13);
  --acc:#1a6a1a;--acc2:#2e8b2e;--grn:#16a34a;--yel:#d97706;
  --red:#dc2626;--org:#ea580c;--pur:#7c3aed;
  --t1:#0f172a;--t2:#475569;--t3:#94a3b8;
  font-family:'Sora',sans-serif;
}
body{background:var(--bg);color:var(--t1);min-height:100vh;}

/* LOGIN */
.lb{min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(145deg,#dcfce7 0%,#f0f4f8 40%,#ede9fe 100%);}
.lc{background:#fff;border:1px solid rgba(0,0,0,0.06);border-radius:20px;
  padding:44px 36px;width:100%;max-width:380px;text-align:center;
  box-shadow:0 2px 4px rgba(0,0,0,0.04),0 12px 32px rgba(26,106,26,0.08);}
.lc h1{font-size:20px;font-weight:700;margin:12px 0 4px;color:#0f172a;}
.lc p{font-size:12px;color:#64748b;margin-bottom:28px;}
.li{background:#f8fafc;border:1px solid rgba(0,0,0,0.12);border-radius:8px;padding:10px 13px;
  color:var(--t1);font-size:13px;font-family:inherit;width:100%;transition:border-color .2s;}
.li:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px rgba(26,106,26,0.1);}
.lform{display:flex;flex-direction:column;gap:10px;}
.lbtn{background:var(--acc);color:#fff;border:none;border-radius:8px;padding:11px;
  font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;margin-top:4px;box-shadow:0 2px 8px rgba(26,106,26,0.3);}
.lbtn:hover{background:#0f4d0f;}
.lerr{color:var(--red);font-size:12px;}
.lhint{font-size:11px;color:#94a3b8;margin-top:18px;}

/* SHELL */
.shell{display:flex;height:100vh;height:100dvh;overflow:hidden;}
.sb{width:200px;background:#ffffff;border-right:1px solid var(--br);display:flex;flex-direction:column;flex-shrink:0;overflow-y:auto;}
.sblogo{padding:18px 14px 14px;font-size:16px;font-weight:700;color:var(--acc);border-bottom:1px solid rgba(46,139,46,0.15);
  display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--br);}
.sbnav{flex:1;padding:6px 0;}
.ni{display:flex;align-items:center;gap:9px;padding:9px 16px;background:none;border:none;
  color:#475569;cursor:pointer;font-family:inherit;font-size:12px;font-weight:500;
  width:100%;border-left:3px solid transparent;transition:all .15s;text-align:left;border-right:none;}
.ni:hover{background:#f1f5f9;color:#0f172a;}
.ni.on{background:rgba(26,106,26,0.1);color:#1a6a1a;border-left-color:#1a6a1a;}
.sbfoot{padding:12px;border-top:1px solid var(--br);}
.mc{flex:1;overflow-y:auto;padding:28px 32px;background:var(--bg);}
.pg{max-width:1080px;}
.ph{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;}
.ptit{font-size:20px;font-weight:700;}
.stit{font-size:11px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;}

/* BUTTONS */
.bp{background:var(--acc);color:#fff;border:none;border-radius:8px;padding:7px 16px;font-weight:600;font-size:12px;cursor:pointer;font-family:inherit;box-shadow:0 1px 4px rgba(26,106,26,0.3);transition:all .15s;}
.bp:hover{background:#0f4d0f;box-shadow:0 2px 8px rgba(26,106,26,0.4);}
.bg{background:#fff;color:var(--t2);border:1px solid var(--br2);border-radius:8px;padding:7px 14px;font-size:12px;cursor:pointer;font-family:inherit;transition:all .15s;}
.bg:hover{background:#f1f5f9;color:var(--t1);}
.bs{padding:4px 9px;font-size:11px;border-radius:6px;border:1px solid var(--br2);background:#fff;color:var(--t2);cursor:pointer;font-family:inherit;transition:all .15s;}
.bs:hover{background:#f1f5f9;color:var(--t1);}
.bs.p{background:var(--acc);color:#fff;border-color:var(--acc);}
.bs.a{background:rgba(76,175,80,.12);color:var(--acc);border-color:rgba(76,175,80,.3);}
.bs.o{background:rgba(251,146,60,.12);color:var(--org);border-color:rgba(251,146,60,.3);}
.bs.r{background:rgba(248,113,113,.1);color:var(--red);border-color:rgba(248,113,113,.3);}
.bx{padding:3px 6px;font-size:10px;border-radius:4px;border:1px solid var(--br2);background:var(--hov);color:var(--t2);cursor:pointer;font-family:inherit;}
.bx.p{background:var(--acc);color:#fff;border-color:var(--acc);}
.ib{background:none;border:none;cursor:pointer;font-size:13px;padding:2px 3px;border-radius:3px;}
.ib.d:hover{background:rgba(248,113,113,.15);}

/* INPUTS */
.inp{background:#fff;border:1px solid rgba(0,0,0,0.12);border-radius:8px;padding:8px 12px;color:var(--t1);font-size:12px;font-family:inherit;width:100%;transition:border-color .15s;}
.inp:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px rgba(26,106,26,0.1);}
.ins{background:#fff;border:1px solid rgba(0,0,0,0.12);border-radius:6px;padding:4px 8px;color:var(--t1);font-size:11px;font-family:inherit;}
.ins:focus{outline:none;border-color:var(--acc);}
.inx{background:#fff;border:1px solid rgba(0,0,0,0.12);border-radius:5px;padding:3px 5px;color:var(--t1);font-size:11px;font-family:inherit;width:100%;}

/* FORM */
.fg{display:grid;grid-template-columns:100px 1fr;gap:9px 10px;align-items:center;margin-bottom:14px;}
.fg label{font-size:11px;color:var(--t2);font-weight:500;}
.cg{display:flex;flex-wrap:wrap;gap:7px;}
.cl{display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;}

/* MODAL */
.mo{position:fixed;inset:0;background:rgba(15,23,42,0.5);backdrop-filter:blur(4px);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;}
.md{background:#fff;border:1px solid rgba(0,0,0,0.1);border-radius:16px;padding:28px;width:100%;max-width:460px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.12),0 2px 8px rgba(0,0,0,0.06);}
.mdw{max-width:560px;}
.mdt{font-size:15px;font-weight:700;margin-bottom:18px;}
.mda{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;}

/* CARDS & BADGES */
.card{background:#fff;border:1px solid rgba(0,0,0,0.07);border-radius:14px;padding:20px;transition:box-shadow .2s,border-color .2s;box-shadow:0 1px 3px rgba(0,0,0,0.05);}
.card:hover{box-shadow:0 4px 16px rgba(0,0,0,0.08);border-color:rgba(26,106,26,0.2);}
.bdg{display:inline-block;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:600;background:rgba(76,175,80,.12);color:var(--acc);margin-right:4px;}
.bdgg{background:rgba(74,222,128,.12);color:var(--grn);}
.bdgr{background:rgba(248,113,113,.12);color:var(--red);}
.bdgy{background:rgba(251,191,36,.12);color:var(--yel);}

/* DASHBOARD */
.dgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;}
.sc{background:#fff;border:1px solid rgba(0,0,0,0.07);border-radius:12px;padding:18px;text-align:center;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,0.05);}
.sc:hover{box-shadow:0 4px 12px rgba(0,0,0,0.08);transform:translateY(-1px);}
.sv{font-size:30px;font-weight:700;margin:6px 0 2px;}
.sl{font-size:11px;color:var(--t3);}

/* STUDENTS */
.smgr{display:grid;grid-template-columns:210px 1fr;gap:16px;}
.slp{background:#fff;border:1px solid rgba(0,0,0,0.07);border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);}
.sli{display:flex;align-items:center;gap:9px;padding:11px 12px;border-bottom:1px solid rgba(0,0,0,0.06);cursor:pointer;transition:background .15s;}
.sli:hover{background:#f8fafc;}
.sli.on{background:rgba(76,175,80,.08);}
.av{width:30px;height:30px;background:#dcfce7;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#1a6a1a;flex-shrink:0;}
.avs{width:26px;height:26px;font-size:12px;}
.sdp{background:var(--c1);border:1px solid var(--br);border-radius:12px;padding:18px;}

/* GRADEBOOK */
.gbl{display:grid;grid-template-columns:200px 1fr;gap:16px;}
.ssb{display:flex;align-items:center;gap:9px;padding:9px 11px;background:var(--c1);border:1px solid var(--br);border-radius:8px;cursor:pointer;font-family:inherit;color:var(--t1);width:100%;transition:all .15s;}
.ssb:hover{background:var(--hov);}
.ssb.on{border-color:var(--acc);background:rgba(76,175,80,.08);}
.ssb>span{width:26px;height:26px;background:rgba(76,175,80,.15);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0;}
.gbm{background:#fff;border:1px solid rgba(0,0,0,0.07);border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,0.05);}
.agrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:7px;}
.gc{background:#f8fafc;border:1px solid rgba(0,0,0,0.07);border-radius:7px;padding:9px;}
.gcn{font-size:11px;font-weight:500;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gcd{font-size:9px;color:var(--t3);margin-bottom:5px;}
.sb2{display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;font-family:'JetBrains Mono',monospace;}
.ga{background:rgba(74,222,128,.12);color:var(--grn);}
.gb_{background:rgba(76,175,80,.12);color:var(--acc);}
.gc_{background:rgba(251,191,36,.12);color:var(--yel);}
.gd_{background:rgba(251,146,60,.12);color:var(--org);}
.gf_{background:rgba(248,113,113,.12);color:var(--red);}
.mM{background:rgba(74,222,128,.12);color:var(--grn);}
.mD{background:rgba(251,191,36,.12);color:var(--yel);}
.mN{background:rgba(248,113,113,.12);color:var(--red);}

/* ATTENDANCE */
.att{background:#fff;border:1px solid rgba(0,0,0,0.07);border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);}
.ath{display:grid;grid-template-columns:1.4fr 2fr 70px 90px 130px 140px;padding:9px 14px;background:var(--c2);font-size:10px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--br);}
.atr{display:grid;grid-template-columns:1.4fr 2fr 70px 90px 130px 140px;padding:10px 14px;border-bottom:1px solid var(--br);align-items:center;font-size:12px;}
.atr:last-child{border-bottom:none;}
.stb{padding:3px 7px;font-size:10px;border-radius:4px;border:1px solid var(--br2);background:none;color:var(--t3);cursor:pointer;font-family:inherit;transition:all .15s;}
.stb.sp.on{background:rgba(74,222,128,.12);border-color:var(--grn);color:var(--grn);}
.stb.se.on{background:rgba(167,139,250,.12);border-color:var(--pur);color:var(--pur);}
.stb.sa.on{background:rgba(248,113,113,.1);border-color:var(--red);color:var(--red);}
.stb.st.on{background:rgba(251,191,36,.12);border-color:var(--yel);color:var(--yel);}


/* BEHAVIOR */
.bgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;}
.bc{background:var(--c1);border:1px solid var(--br);border-radius:12px;padding:14px;}
.starb{background:none;border:none;font-size:20px;cursor:pointer;color:rgba(255,255,255,.15);transition:color .15s;-webkit-text-stroke:1px #000;}
.starb.on{color:var(--yel);}

/* NOTES */
.nps{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.nitem{display:flex;align-items:center;justify-content:space-between;padding:7px 9px;background:var(--bg);border-radius:6px;font-size:11px;gap:8px;}

/* EVENTS */
.ecard{background:var(--c1);border:1px solid var(--br);border-radius:12px;padding:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;}
.edb{text-align:center;min-width:42px;background:rgba(76,175,80,.1);border-radius:7px;padding:7px;}
.edm{font-size:9px;color:var(--acc);font-weight:700;text-transform:uppercase;}
.edd{font-size:20px;font-weight:700;line-height:1.1;}

/* REPORTS */
.rtabs{display:flex;gap:3px;margin-bottom:20px;background:var(--c1);border:1px solid var(--br);border-radius:8px;padding:3px;width:fit-content;}
.rtab{padding:6px 16px;border:none;border-radius:5px;background:none;color:var(--t2);font-family:inherit;font-size:12px;cursor:pointer;transition:all .15s;font-weight:500;}
.rtab.on{background:var(--acc);color:#fff;font-weight:700;}

/* PRINT */
.prpt{background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:12px;max-width:780px;margin:0 auto;padding:28px;box-shadow:0 1px 4px rgba(0,0,0,0.06);}
.rh{text-align:center;margin-bottom:24px;padding-bottom:18px;border-bottom:2px solid rgba(0,0,0,0.1);}
.tt{width:100%;border-collapse:collapse;font-size:12px;color:#0f172a;}
.tt th{text-align:left;padding:7px 10px;background:#f8fafc;border-bottom:2px solid rgba(0,0,0,0.12);font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#475569;}
.tt td{padding:7px 10px;border-bottom:1px solid rgba(0,0,0,0.06);color:#0f172a;}

/* PORTAL */
.psh{min-height:100vh;min-height:100dvh;background:var(--bg);}
.phdr{
  background:#1e293b;
  border-bottom:1px solid rgba(255,255,255,0.08);
  padding:14px 24px;
  display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;
  box-shadow:0 2px 12px rgba(0,0,0,0.3);
}
.ptab{
  padding:6px 14px;border:none;border-radius:20px;
  background:none;color:#94a3b8;font-family:inherit;font-size:12px;
  cursor:pointer;transition:all .2s;font-weight:500;
}
.ptab:hover{background:rgba(255,255,255,0.08);color:#e2e8f0;}
.ptab.on{background:rgba(46,139,46,0.2);color:#2e8b2e;font-weight:600;}
.pcont{padding:28px;max-width:900px;margin:0 auto;}
.pgradient{background:linear-gradient(135deg,rgba(76,175,80,0.08) 0%,rgba(167,139,250,0.05) 100%);}

/* MISC */
.emp{color:var(--t3);font-size:12px;font-style:italic;padding:10px 0;}
.empc{display:flex;align-items:center;justify-content:center;height:180px;color:var(--t3);font-style:italic;font-size:13px;}
.chip{display:flex;align-items:center;gap:5px;padding:4px 9px;background:var(--bg);border:1px solid var(--br2);border-radius:16px;font-size:11px;cursor:pointer;transition:all .15s;}
.chip:hover,.chip.on{border-color:var(--acc);color:var(--acc);background:rgba(76,175,80,.07);}
.logobtn{width:100%;padding:6px;background:none;border:1px solid var(--br2);border-radius:7px;color:#475569;font-family:inherit;font-size:11px;cursor:pointer;transition:all .15s;}
.logobtn:hover{background:rgba(255,255,255,0.08);color:#e2e8f0;}
.warn{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;font-size:12px;margin-bottom:7px;}
.sepbanner{background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.25);border-radius:7px;padding:9px 12px;font-size:12px;color:var(--yel);margin-bottom:14px;}

/* ── MOBILE ── */
@media (max-width: 767px) {
  .mc{padding:12px 10px;}
  .ph{flex-wrap:wrap;gap:8px;}
  .ptit{font-size:17px;}
  .card{padding:12px;}
  .modal .md{padding:18px;margin:8px;}
  .fg{grid-template-columns:90px 1fr;gap:8px;}
  .dgrid{grid-template-columns:1fr 1fr;}
  .gbl{grid-template-columns:1fr;}
  .smgr{grid-template-columns:1fr;}
  .nps{grid-template-columns:1fr;}
  .bgrid{grid-template-columns:1fr;}
  .agrid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr));}
  .ath,.atr{display:none;}
  .phdr{flex-direction:column;gap:8px;align-items:flex-start;}
  .prpt{padding:16px;}
  .rr2{grid-template-columns:1fr;}
  .rsw{grid-template-columns:1fr;}
  .rc2{flex-direction:column;}
}
@media print{
  .noprint{display:none!important;}
  .page-break{page-break-before:always;margin-top:0;}
  .prpt{page-break-inside:avoid;}
  .tt tr{page-break-inside:avoid;}
  @page{margin:1.5cm;}
  body{background:white!important;color:#111!important;}
  .prpt{background:white!important;color:#111!important;border:none!important;max-width:100%!important;padding:16px!important;}
}
::-webkit-scrollbar{width:5px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.15);border-radius:3px;}
`;

// ─── TOUR ─────────────────────────────────────────────────────────────────────
const TEACHER_TOUR=[
  {tab:"dashboard",title:"📊 Dashboard",body:"Your home base. See upcoming assignments due this week, attendance warnings, Iowa compliance alerts, and quick stats for all students."},
  {tab:"students",title:"👥 Students",body:"Add and manage students here. Assign subjects, set grade levels, and link parent accounts. Click a student to see their full profile and subjects."},
  {tab:"gradebook",title:"📊 Gradebook",body:"Select a student then enter grades per assignment. Use the View selector to see grades by quarter or as a projected final. Add subjects and assignments with the + buttons."},
  {tab:"gradebook",title:"📅 Quarter View",body:"The View dropdown lets you switch between quarters. Projected Final weights all quarters with grades equally — matching what will appear on the transcript when all quarters close."},
  {tab:"attendance",title:"📅 Attendance",body:"Mark daily attendance as Present, Absent, Excused, or Tardy. Upload excuse documents with 📎. Generate monthly Iowa compliance reports with 📋."},
  {tab:"behavior",title:"⭐ Behavior",body:"For MDN students: rate behavior 1–5 stars. For letter grade students: log incidents with descriptions. Both show a history log per student."},
  {tab:"notes",title:"📝 Notes",body:"Record strengths and areas for improvement per student. These notes appear on progress reports for parent-teacher conferences."},
  {tab:"events",title:"🗓️ Events",body:"Create school events with optional permission slips. Toggle 📚 Assignments and 📅 Attendance on the calendar. Quarter boundaries are marked automatically."},
  {tab:"reports",title:"📋 Progress Reports",body:"Generate reports for any date range. Multiple periods show a comparison bar chart and a grade trajectory line graph showing how grades moved over time."},
  {tab:"reports",title:"📋 Transcripts",body:"Generate official transcripts per student. Quarterly grade columns populate as quarters are finalized. Final grade only appears once all assigned quarters are closed."},
  {tab:"settings",title:"⚙️ Settings",body:"Configure school year dates, quarter dates (use ⟳ Auto-Calculate to divide evenly), grading scale, hours per day, and minimum hours. Finalize quarters here to lock grades."},
  {tab:"accounts",title:"👤 Accounts",body:"Create parent and student login accounts. Parents see their child's grades, upcoming assignments, events, and can use the grade calculator from their portal."},
];

const PORTAL_TOUR=[
  {tab:"calendar",title:"🗓️ Calendar",body:"Your home screen shows upcoming events, assignment due dates, and quarter boundaries. Assignments are shown by default — click any item for details."},
  {tab:"grades",title:"📊 Grades",body:"See current grades and averages per subject. Use the Grade Calculator (🎯) to see what score you need to reach your target — by quarter or for the final grade."},
  {tab:"attendance",title:"📅 Attendance",body:"View your full attendance record — present, absent, excused, and tardy days — with total hours attended shown for Iowa compliance."},
  {tab:"notes",title:"📝 Notes",body:"Your teacher's notes on your strengths and areas to work on. These come from progress report conferences."},
  {tab:"history",title:"📚 History",body:"Past school years appear here after year-end promotion. Official transcripts can be requested from your teacher."},
];

function TourOverlay({steps,stepIdx,onNext,onBack,onEnd,onTabChange}) {
  if(typeof stepIdx!=="number"||stepIdx<0||stepIdx>=steps.length) return null;
  const step=steps[stepIdx];
  const isLast=stepIdx===steps.length-1;
  const pct=Math.round(((stepIdx+1)/steps.length)*100);
  const goNext=()=>{
    const nextStep=steps[stepIdx+1];
    if(nextStep&&nextStep.tab&&nextStep.tab!==step.tab&&onTabChange) onTabChange(nextStep.tab);
    onNext();
  };
  return(
    <div style={{
      background:"#fff",
      border:"2px solid #1a6a1a",
      borderRadius:14,
      padding:20,
      marginBottom:16,
      boxShadow:"0 4px 24px rgba(26,106,26,0.15)",
    }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{fontSize:15,fontWeight:700,color:"#1a6a1a"}}>{step.title}</div>
        <div style={{fontSize:11,color:"#94a3b8"}}>{stepIdx+1} of {steps.length}</div>
      </div>
      <div style={{height:3,background:"#e2e8f0",borderRadius:2,marginBottom:12}}>
        <div style={{height:"100%",width:pct+"%",background:"#1a6a1a",borderRadius:2}}/>
      </div>
      <div style={{fontSize:13,color:"#475569",lineHeight:1.65,marginBottom:16}}>{step.body}</div>
      <div style={{display:"flex",gap:8,justifyContent:"space-between",alignItems:"center"}}>
        <button style={{background:"none",border:"1px solid #e2e8f0",borderRadius:7,padding:"5px 12px",color:"#64748b",cursor:"pointer",fontSize:11,fontFamily:"inherit"}} onClick={onEnd}>End Tour</button>
        <div style={{display:"flex",gap:8}}>
          {stepIdx>0&&<button style={{background:"none",border:"1px solid #e2e8f0",borderRadius:7,padding:"5px 14px",color:"#475569",cursor:"pointer",fontSize:12,fontFamily:"inherit"}} onClick={onBack}>← Back</button>}
          <button style={{background:"#1a6a1a",border:"none",borderRadius:7,padding:"6px 18px",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}} onClick={isLast?onEnd:goNext}>{isLast?"Finish ✓":"Next →"}</button>
        </div>
      </div>
    </div>
  );
}


// ─── APP ──────────────────────────────────────────────────────────────────────
function useMobile() {
  const [mobile, setMobile] = useState(typeof window!=="undefined"&&(window.innerWidth<768||/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)));
  useEffect(()=>{
    const check=()=>setMobile(window.innerWidth<768||/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
    window.addEventListener("resize",check);
    return ()=>window.removeEventListener("resize",check);
  },[]);
  return mobile;
}


// ─── FIREBASE-DRIVEN WRAPPER ──────────────────────────────────────────────────
// Used when state/auth is managed externally (e.g. Firebase).
// Bypasses the built-in localStorage login/state management.
function HomeschoolApp({state, upd, user, logout}) {
  const isMobile = useMobile();
  if(!state||!user) return null;
  if(user.role==="teacher") return <TeacherApp state={state} upd={upd} user={user} logout={logout} isMobile={isMobile}/>;
  return <Portal state={state} upd={upd} user={user} logout={logout} isMobile={isMobile}/>;
}

function App() {
  const [state, setState] = useState(getInit);
  const [user, setUser] = useState(null);
  const [view, setView] = useState("login");
  const [lf, setLf] = useState({u:"",p:""});
  const [lerr, setLerr] = useState("");

  useEffect(() => {
    const t = setInterval(() => {
      setState(prev => {
        const d = today();
        if((prev.saves||[]).find(s=>s.date===d)) { localStorage.setItem("hsa3",JSON.stringify(prev)); return prev; }
        const ns = {id:uid(),date:d,timestamp:Date.now(),snap:JSON.stringify(prev)};
        const saves = [...(prev.saves||[]),ns].sort((a,b)=>b.timestamp-a.timestamp).slice(0,30);
        const next = {...prev,saves};
        localStorage.setItem("hsa3",JSON.stringify(next));
        return next;
      });
    }, 4*60*1000);
    return ()=>clearInterval(t);
  },[]);

  const upd = fn => setState(prev => {
    const next = typeof fn==="function"?fn(prev):{...prev,...fn};
    localStorage.setItem("hsa3",JSON.stringify(next));
    return next;
  });

  const isMobile = useMobile();

  // Ensure proper mobile viewport scaling
  useEffect(()=>{
    let meta = document.querySelector("meta[name=viewport]");
    if(!meta){meta=document.createElement("meta");meta.name="viewport";document.head.appendChild(meta);}
    meta.content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no";
  },[]);

  const login = () => {
    const u = state.users.find(u=>u.username===lf.u&&u.password===lf.p);
    if(!u){setLerr("Invalid username or password");return;}
    setUser(u); setView(u.role==="teacher"?"teacher":"portal"); setLerr("");
  };
  const logout = () => {setUser(null);setView("login");setLf({u:"",p:""});};

  return (
    <>
      <style>{CSS}</style>
      {view==="login" && <Login lf={lf} setLf={setLf} login={login} lerr={lerr}/>}
      {view==="teacher" && user && <TeacherApp state={state} upd={upd} user={user} logout={logout} isMobile={isMobile}/>}
      {view==="portal" && user && <Portal state={state} upd={upd} user={user} logout={logout} isMobile={isMobile}/>}
    </>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function Login({lf,setLf,login,lerr}) {
  return (
    <div className="lb">
      <div className="lc">
        <div style={{fontSize:44}}>🏫</div>
        <h1>Empower Iowa - Elim Springs Campus</h1>
        <p>Student Management System</p>
        <div className="lform">
          <input className="li" placeholder="Username" value={lf.u} onChange={e=>setLf(f=>({...f,u:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&login()}/>
          <input className="li" type="password" placeholder="Password" value={lf.p} onChange={e=>setLf(f=>({...f,p:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&login()}/>
          {lerr&&<p className="lerr">{lerr}</p>}
          <button className="lbtn" onClick={login}>Sign In</button>
        </div>
        <p className="lhint">
          Teacher: <strong>teacher</strong> / <strong>teach123</strong><br/>
          <span style={{fontSize:10,opacity:.7}}>Demo build — sign in with a Firebase Authentication account.</span>
        </p>
      </div>
    </div>
  );
}

// ─── TEACHER APP ──────────────────────────────────────────────────────────────
function TeacherApp({state,accounts,upd,user,logout,isMobile}) {
  const [tab,setTab] = useState("dashboard");
  const [showMoreMenu,setShowMoreMenu] = useState(false);
  const [prefillParentFor,setPrefillParentFor] = useState(null);
  const [tourStep,setTourStep] = useState(0);
  const startTour=(fromTab)=>{
    const idx=fromTab?Math.max(0,TEACHER_TOUR.findIndex(s=>s.tab===fromTab)):0;
    setTourStep(idx);
  };
  const endTour=()=>setTourStep(-1); // studentId to pre-fill in Accounts
  const ALL_NAV_ITEMS = [
    {id:"dashboard",l:"Dashboard",i:"🏠"},{id:"students",l:"Students",i:"👥"},
    {id:"gradebook",l:"Gradebook",i:"📊"},{id:"attendance",l:"Attendance",i:"📅"},
    {id:"behavior",l:"Behavior",i:"⭐"},{id:"notes",l:"Notes",i:"📝"},
    {id:"events",l:"Events",i:"🗓️"},{id:"reports",l:"Reports",i:"📋"},
    {id:"accounts",l:"Accounts",i:"👤"},{id:"activity",l:"Activity",i:"📜"},{id:"settings",l:"Settings",i:"⚙️"},
  ];
  const pinnedIds=state.sy?.pinnedNav||["dashboard","students","gradebook","attendance"];
  // Preserve order: pinned first (in pinnedIds order), then rest
  const nav=[
    ...pinnedIds.map(id=>ALL_NAV_ITEMS.find(n=>n.id===id)).filter(Boolean),
    ...ALL_NAV_ITEMS.filter(n=>!pinnedIds.includes(n.id)),
  ];
  return isMobile ? (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:"var(--bg)",overflow:"hidden"}}>
      {/* Mobile top bar */}
      <div style={{background:"var(--c1)",borderBottom:"1px solid var(--br)",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center"}}>{LOGO?<img src={LOGO} alt="Empower Iowa" style={{height:22,display:"block"}}/>:<span style={{fontSize:15,fontWeight:700,color:"var(--acc)"}}>🏫 Empower Iowa</span>}</div>
        <div style={{fontSize:12,fontWeight:600}}>{nav.find(n=>n.id===tab)?.i} {nav.find(n=>n.id===tab)?.l}</div>
        <button className="logobtn" style={{width:"auto",padding:"5px 10px",fontSize:11}} onClick={logout}>Out</button>
      </div>
      {/* Content */}
      <div style={{flex:1,overflowY:"auto",padding:"14px 12px"}}>
        {tourStep>=0&&<TourOverlay steps={TEACHER_TOUR} stepIdx={tourStep} onNext={()=>setTourStep(s=>s+1)} onBack={()=>setTourStep(s=>Math.max(0,s-1))} onEnd={endTour} onTabChange={t=>setTab(t)}/>}
        {tab==="dashboard"&&<Dashboard state={state} upd={upd} isMobile={isMobile} onNav={setTab}/>}
        {tab==="students"&&<Students state={state} upd={upd} isMobile={isMobile} onCreateParent={sid=>{setPrefillParentFor(sid);setTab("accounts");}}/>}
        {tab==="gradebook"&&<Gradebook state={state} upd={upd} isMobile={isMobile}/>}
        {tab==="attendance"&&<Attendance state={state} upd={upd} isMobile={isMobile}/>}
        {tab==="behavior"&&<Behavior state={state} upd={upd} isMobile={isMobile}/>}
        {tab==="notes"&&<Notes state={state} upd={upd} isMobile={isMobile}/>}
        {tab==="events"&&<Events state={state} upd={upd} isMobile={isMobile}/>}
        {tab==="reports"&&<Reports state={state} upd={upd} isMobile={isMobile}/>}
        {tab==="accounts"&&<Accounts state={state} upd={upd} accounts={accounts} user={user} isMobile={isMobile} prefillStudentId={prefillParentFor} onPrefillUsed={()=>setPrefillParentFor(null)}/>}
        {tab==="activity"&&<ActivityLog state={state}/>}
        {tab==="settings"&&<Settings state={state} upd={upd} isMobile={isMobile}/>}
      </div>
      {/* Mobile bottom nav */}
      {showMoreMenu&&(
        <div style={{position:"fixed",inset:0,zIndex:300}} onClick={()=>setShowMoreMenu(false)}>
          <div style={{position:"absolute",bottom:60,left:0,right:0,background:"var(--c1)",borderTop:"1px solid var(--br2)",padding:"12px 8px",display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4}}
            onClick={e=>e.stopPropagation()}>
            {nav.slice(4).map(n=>(
              <button key={n.id} onClick={()=>{setTab(n.id);setShowMoreMenu(false);}}
                style={{background:tab===n.id?"rgba(76,175,80,.12)":"none",border:"none",borderRadius:8,padding:"10px 4px",display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:"pointer",color:tab===n.id?"var(--acc)":"var(--t1)",fontFamily:"inherit"}}>
                <span style={{fontSize:22}}>{n.i}</span>
                <span style={{fontSize:10,fontWeight:500}}>{n.l}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{background:"var(--c1)",borderTop:"1px solid var(--br)",display:"flex",flexShrink:0,paddingBottom:"env(safe-area-inset-bottom,0px)"}}>
        {[...nav.slice(0,4),{id:"more",l:"More",i:"⋯"}].map(n=>{
          const isOverflowActive=n.id==="more"&&nav.slice(4).some(x=>x.id===tab);
          const active=isOverflowActive||(n.id!=="more"&&tab===n.id);
          return (
            <button key={n.id} onClick={()=>{
              if(n.id==="more") setShowMoreMenu(m=>!m);
              else { setTab(n.id); setShowMoreMenu(false); }
            }}
            style={{flex:1,background:"none",border:"none",padding:"8px 0",display:"flex",flexDirection:"column",alignItems:"center",gap:2,cursor:"pointer",color:active?"var(--acc)":"var(--t3)",fontFamily:"inherit"}}>
              <span style={{fontSize:18}}>{isOverflowActive?nav.find(x=>x.id===tab)?.i:n.i}</span>
              <span style={{fontSize:9,fontWeight:active?600:400}}>{isOverflowActive?nav.find(x=>x.id===tab)?.l:n.l}</span>
            </button>
          );
        })}
      </div>
    </div>

  ) : (
    <div className="shell">
      <aside className="sb">
        <div className="sblogo">{LOGO?<img src={LOGO} alt="Empower Iowa" style={{width:"100%",maxWidth:150,display:"block"}}/>:<span>🏫 Empower Iowa</span>}</div>
        <nav className="sbnav">
          {nav.map(n=>(
            <button key={n.id} className={"ni"+(tab===n.id?" on":"")} onClick={()=>setTab(n.id)}>
              <span style={{fontSize:15,width:18,textAlign:"center"}}>{n.i}</span><span>{n.l}</span>
            </button>
          ))}
        </nav>
        <div className="sbfoot">
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{fontSize:22}}>👩‍🏫</span>
            <div style={{minWidth:0,overflow:"hidden"}}><div style={{fontSize:11,fontWeight:600,color:"#0f172a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.name}</div><div style={{fontSize:10,color:"var(--t3)"}}>{user.role==="admin"?"Admin":"Teacher"}</div></div>
          </div>
          <div style={{display:"flex",gap:6,marginBottom:6}}>
            <button className="bs" style={{flex:1,fontSize:10}} onClick={()=>startTour(tab)}>? Tour</button>
          </div>
          <button className="logobtn" onClick={logout}>Sign Out</button>
        </div>
      </aside>
      <main className="mc">
        {tourStep>=0&&<TourOverlay steps={TEACHER_TOUR} stepIdx={tourStep} onNext={()=>setTourStep(s=>s+1)} onBack={()=>setTourStep(s=>Math.max(0,s-1))} onEnd={endTour} onTabChange={t=>setTab(t)}/>}
        {tab==="dashboard"&&<Dashboard state={state} upd={upd} onNav={setTab}/>}
        {tab==="students"&&<Students state={state} upd={upd} onCreateParent={sid=>{setPrefillParentFor(sid);setTab("accounts");}}/>}
        {tab==="gradebook"&&<Gradebook state={state} upd={upd}/>}
        {tab==="attendance"&&<Attendance state={state} upd={upd}/>}
        {tab==="behavior"&&<Behavior state={state} upd={upd}/>}
        {tab==="notes"&&<Notes state={state} upd={upd}/>}
        {tab==="events"&&<Events state={state} upd={upd}/>}
        {tab==="reports"&&<Reports state={state} upd={upd}/>}
        {tab==="accounts"&&<Accounts state={state} upd={upd} accounts={accounts} user={user} prefillStudentId={prefillParentFor} onPrefillUsed={()=>setPrefillParentFor(null)}/>}
        {tab==="activity"&&<ActivityLog state={state}/>}
        {tab==="settings"&&<Settings state={state} upd={upd}/>}
      </main>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({state,upd,isMobile,onNav}) {
  const minHrs=state.sy?.minHrs||DEFAULT_MIN_HRS;
  // Assignments due within the next 7 days
  const sevenDaysOut=new Date(); sevenDaysOut.setDate(sevenDaysOut.getDate()+7);
  const sevenStr=sevenDaysOut.toISOString().slice(0,10);
  const upcoming=[];
  (state.students||[]).forEach(s=>{
    (state.subjects[s.id]||[]).forEach(sub=>{
      sub.assignments.filter(a=>(a.dueDate||a.date)>=(today())&&(a.dueDate||a.date)<=sevenStr&&(a.score===null||a.score===undefined||a.score==="")).forEach(a=>{
        upcoming.push({student:s.name,subject:sub.name,assignment:a.name,dueDate:a.dueDate||a.date,sid:s.id});
      });
    });
  });
  upcoming.sort((a,b)=>a.dueDate>b.dueDate?1:-1);
  const warnings = state.students.filter(s=>{
    const hrs=hrsAtt(state.attendance[s.id]||[],state.sy);
    const proj=hrs+projWithRate(state.sy,state.specialDays,state.attendance[s.id]||[]);
    return proj<minHrs-WARN_THRESHOLD;
  });

  // ── Actionable dashboard metrics ──
  const t2=today();
  const DOW={"Mon":1,"Tue":2,"Wed":3,"Thu":4,"Fri":5,"Sat":6,"Sun":0};
  // Work waiting to be graded: past due with no score (exempt counts as handled)
  const needsGrading=[];
  (state.students||[]).forEach(s=>{
    (state.subjects[s.id]||[]).forEach(sub=>{
      (sub.assignments||[]).forEach(a=>{
        const due=a.dueDate||a.date;
        const unscored=a.score===null||a.score===undefined||a.score==="";
        if(due&&due<t2&&unscored) needsGrading.push({student:s.name,subject:sub.name,name:a.name,due});
      });
    });
  });
  needsGrading.sort((a,b)=>a.due>b.due?1:-1);
  // Is today a school day, and is attendance marked?
  const inYear=(!state.sy?.startDate||t2>=state.sy.startDate)&&(!state.sy?.endDate||t2<=state.sy.endDate);
  const scheduledToday=(state.sy?.scheduledDays||DAYS).some(d=>DOW[d]===new Date(t2+"T12:00:00").getDay());
  const spToday=(state.specialDays||[]).find(s=>s.startDate&&s.endDate&&t2>=s.startDate&&t2<=s.endDate);
  const schoolToday=inYear&&scheduledToday&&(!spToday||spToday.type==="delay");
  const attMissing=(state.students||[]).filter(s=>!(state.attendance[s.id]||[]).some(r=>r.date===t2)).length;
  // Permission slips still outstanding on current/upcoming events
  let slipsOut=0;
  (state.events||[]).forEach(e=>{
    if(!e.permissionSlip||(e.endDate&&e.endDate<t2)) return;
    (e.assignedStudents||[]).forEach(sid=>{
      const r=e.responses?.[sid];
      if(!(typeof r==="string"?r:r?.status)) slipsOut++;
    });
  });
  // Where we are in the year
  const curQ=(state.sy?.quarters||[]).find(q=>q.startDate&&q.endDate&&t2>=q.startDate&&t2<=q.endDate);
  const daysLeft=curQ?Math.max(0,Math.round((new Date(curQ.endDate+"T12:00:00")-new Date(t2+"T12:00:00"))/86400000)):null;
  const attTile=!schoolToday
    ?{i:"📅",v:"—",l:spToday?(spToday.note||"No school today"):"No school today",c:"var(--t3)",nav:"attendance"}
    :((state.students||[]).length&&attMissing===0
      ?{i:"📅",v:"✓",l:"Attendance done",c:"var(--grn)",nav:"attendance"}
      :{i:"📅",v:attMissing,l:"Not marked today",c:"var(--red)",nav:"attendance"});
  const dashTiles=[
    {i:"📝",v:needsGrading.length,l:needsGrading.length?"To grade":"All graded",c:needsGrading.length?"var(--red)":"var(--grn)",nav:"gradebook"},
    attTile,
    {i:"📋",v:slipsOut,l:slipsOut?"Slips outstanding":"Slips all in",c:slipsOut?"var(--yel)":"var(--grn)",nav:"events"},
    {i:"🗓️",v:curQ?curQ.label:"—",l:curQ?(daysLeft===0?"Quarter ends today":daysLeft+" days left"):"No quarter set",c:"var(--acc)",nav:"settings"},
  ];
  return (
    <div className="pg">
      <div className="ptit" style={{marginBottom:20}}>Dashboard</div>
      <div className="dgrid">
        {dashTiles.map((c,ci)=>(
          <div key={ci} className="sc" onClick={()=>c.nav&&onNav&&onNav(c.nav)} style={c.nav&&onNav?{cursor:"pointer"}:null} title={c.nav&&onNav?("Go to "+c.nav):undefined}>
            <div style={{fontSize:26}}>{c.i}</div><div className="sv" style={{color:c.c}}>{c.v}</div><div className="sl">{c.l}</div>
          </div>
        ))}
      </div>
      {warnings.length>0&&(
        <div style={{marginBottom:20}}>
          <div className="stit">⚠️ Attendance Alerts</div>
          {warnings.map(s=>{
            const hrs=hrsAtt(state.attendance[s.id]||[],state.sy);
            const proj=hrs+projWithRate(state.sy,state.specialDays,state.attendance[s.id]||[]);
            const par=getParentsForStudent(state.users,s.id)[0];
            const email=par?.email||s.parentEmail||"";
            const teacherUser=state.users.find(u=>u.role==="teacher");
            return (
              <div key={s.id} className="warn">
                <span><strong>{s.name}</strong> — {Math.round(hrs)}h attended, projected {Math.round(proj)}/{minHrs}h required</span>
                <a className="bs o" style={{textDecoration:"none",display:"inline-block"}}
                  href={"mailto:"+email+"?subject="+encodeURIComponent("Attendance Alert - "+s.name)+"&body="+encodeURIComponent("Dear Parent/Guardian of "+s.name+",\n\nWe are writing to inform you that "+s.name+" is currently at risk of not meeting the minimum required instruction hours ("+minHrs+" hours) for the school year.\n\nCurrent hours: "+Math.round(hrs)+"\nProjected total: "+Math.round(proj)+"\n\nPlease contact us to discuss makeup hours or schedule adjustments.\n\nSincerely,\n"+TEACHER.name)}
                >{email?"📧 Email Parent":"⚠️ No parent email on file"}</a>
              </div>
            );
          })}
        </div>
      )}
      {upcoming.length>0&&<div className="card" style={{marginBottom:16}}>
        <div className="stit">📋 Assignments Due This Week</div>
        <div style={{display:"flex",flexDirection:"column",gap:0}}>
          {upcoming.map((a,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--br)",fontSize:12}}>
              <div>
                <span style={{fontWeight:500}}>{a.assignment}</span>
                <span style={{color:"var(--t3)",marginLeft:8,fontSize:10}}>{a.subject}</span>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:11,color:a.dueDate===today()?"var(--red)":a.dueDate<=new Date(Date.now()+86400000*2).toISOString().slice(0,10)?"var(--yel)":"var(--t2)"}}>{fmt(a.dueDate)}</div>
                <div style={{fontSize:10,color:"var(--t3)"}}>{a.student}</div>
              </div>
            </div>
          ))}
        </div>
      </div>}
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:16}}>
        <div className="card">
          <div className="stit">📅 Upcoming Events</div>
          {!(state.events||[]).length?<p className="emp">No events scheduled</p>:
            (state.events||[]).sort((a,b)=>a.startDate>b.startDate?1:-1).slice(0,5).map(e=>(
              <div key={e.id} style={{padding:"7px 0",borderBottom:"1px solid var(--br)"}}>
                <div style={{fontSize:12,fontWeight:500}}>{e.name}</div>
                <div style={{fontSize:10,color:"var(--t3)"}}>{fmt(e.startDate)} · {e.location}</div>
              </div>
            ))
          }
        </div>
        <div className="card">
          <div className="stit">📝 Needs Grading</div>
          {!needsGrading.length?<p className="emp" style={{color:"var(--grn)"}}>✓ Nothing overdue — all caught up</p>:
            needsGrading.slice(0,6).map((a,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:9,padding:"7px 0",borderBottom:"1px solid var(--br)"}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</div>
                  <div style={{fontSize:10,color:"var(--t3)"}}>{a.student} · {a.subject}</div>
                </div>
                <div style={{fontSize:10,color:"var(--red)",whiteSpace:"nowrap"}}>due {fmt(a.due)}</div>
              </div>
            ))
          }
          {needsGrading.length>6&&<div style={{fontSize:10,color:"var(--t3)",paddingTop:7}}>+{needsGrading.length-6} more in Gradebook</div>}
        </div>
      </div>
    </div>
  );
}

// ─── STUDENTS ─────────────────────────────────────────────────────────────────
function LinkedParent({sel,state,onCreateParent}) {
  const linked=getParentsForStudent(state.users,sel.id);
  if(linked.length>0) return <div style={{fontSize:10,color:"var(--acc)"}}>{"👤 "+linked.map(p=>p.name||p.username).join(", ")}</div>;
  return <button className="bs a" style={{fontSize:11}} onClick={()=>onCreateParent&&onCreateParent(sel.id)}>+ Create Parent Account</button>;
}

function Students({state,upd,isMobile,onCreateParent}) {
  const [sel,setSel]=useState(null);
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({name:"",gradeLevel:"1st Grade",parentEmail:"",parentPhone:""});
  const [sf,setSf]=useState({name:"",emoji:"📚"});
  const [af,setAf]=useState({name:"",maxScore:100,date:today()});
  const [selSub,setSelSub]=useState(null);
  const [showTransfer,setShowTransfer]=useState(false);
  const [transferForm,setTransferForm]=useState({date:today(),school:""});

  const addStu=()=>{
    if(!form.name.trim()) return;
    const s={id:uid(),...form};
    upd(p=>({...p,students:[...p.students,s],subjects:{...p.subjects,[s.id]:[]},attendance:{...p.attendance,[s.id]:[]},behavior:{...p.behavior,[s.id]:[]},sw:{...p.sw,[s.id]:{strengths:[],areas:[]}}}));
    setShowAdd(false); setForm({name:"",gradeLevel:"1st Grade",parentEmail:"",parentPhone:""});
  };
  const delStu=id=>{
    upd(p=>{const{[id]:_a,...subs}=p.subjects,{[id]:_b,...att}=p.attendance,{[id]:_c,...beh}=p.behavior,{[id]:_d,...sw}=p.sw;
      return {...p,students:p.students.filter(s=>s.id!==id),subjects:subs,attendance:att,behavior:beh,sw};});
    if(sel?.id===id){setSel(null);setSelSub(null);}
  };
  const doTransfer=(s)=>{
    const schoolYear=(state.sy?.startDate?.slice(0,4)||"")+"–"+(state.sy?.endDate?.slice(0,4)||"");
    const archiveEntry={
      id:uid(),studentId:s.id,studentName:s.name,
      gradeLevel:s.gradeLevel,newGradeLevel:"Transferred",
      schoolYear,archivedAt:transferForm.date,
      transferred:true,transferDate:transferForm.date,
      transferSchool:transferForm.school||"Unknown",
      snapshot:{
        students:[s],
        subjects:{[s.id]:state.subjects[s.id]||[]},
        attendance:{[s.id]:state.attendance?.[s.id]||[]},
        behavior:{[s.id]:state.behavior?.[s.id]||[]},
        sw:{[s.id]:state.sw?.[s.id]||{strengths:[],areas:[]}},
        finalizedQuarters:state.finalizedQuarters||{},
      }
    };
    upd(p=>{
      const{[s.id]:_a,...subs}=p.subjects,{[s.id]:_b,...att}=p.attendance,
            {[s.id]:_c,...beh}=p.behavior,{[s.id]:_d,...sw}=p.sw;
      return {...p,
        students:p.students.filter(x=>x.id!==s.id),
        subjects:subs,attendance:att,behavior:beh,sw,
        history:[...(p.history||[]),archiveEntry],
      };
    });
    setSel(null);setSelSub(null);setShowTransfer(false);
    setTransferForm({date:today(),school:""});
  };
  const addSub=()=>{
    if(!sf.name.trim()||!sel) return;
    const sub={id:uid(),name:sf.name,emoji:sf.emoji,assignments:[]};
    upd(p=>({...p,subjects:{...p.subjects,[sel.id]:[...(p.subjects[sel.id]||[]),sub]}}));
    setSf({name:"",emoji:"📚"});
  };
  const delSub=sid=>{
    upd(p=>({...p,subjects:{...p.subjects,[sel.id]:(p.subjects[sel.id]||[]).filter(s=>s.id!==sid)}}));
    if(selSub?.id===sid) setSelSub(null);
  };
  const addAssign=()=>{
    if(!af.name.trim()||!selSub) return;
    const a={id:uid(),name:af.name,maxScore:parseFloat(af.maxScore)||100,date:af.date,score:null};
    upd(p=>({...p,subjects:{...p.subjects,[sel.id]:(p.subjects[sel.id]||[]).map(s=>s.id===selSub.id?{...s,assignments:[...s.assignments,a]}:s)}}));
    setAf({name:"",maxScore:100,date:today()});
  };
  const delAssign=aid=>{
    upd(p=>({...p,subjects:{...p.subjects,[sel.id]:(p.subjects[sel.id]||[]).map(s=>s.id===selSub.id?{...s,assignments:s.assignments.filter(a=>a.id!==aid)}:s)}}));
  };

  const subs = sel?(state.subjects[sel.id]||[]):[];
  const curSub = selSub?subs.find(s=>s.id===selSub.id):null;

  return (
    <div className="pg">
      <div className="ph"><div className="ptit">Students</div></div>
      {showTransfer&&sel&&<div className="mo"><div className="md" style={{maxWidth:460}}>
        <div className="mdt">Transfer Out — {sel.name}</div>
        <div style={{fontSize:11,color:"var(--t2)",marginBottom:14}}>
          This will archive {sel.name}'s current year records and remove them from the active roster.
          Their history will be preserved permanently.
        </div>
        <div className="fg">
          <label>Transfer Date</label>
          <input className="inp" type="date" value={transferForm.date} onChange={e=>setTransferForm(f=>({...f,date:e.target.value}))}/>
          <label>Receiving School</label>
          <input className="inp" placeholder="School name (optional)" value={transferForm.school} onChange={e=>setTransferForm(f=>({...f,school:e.target.value}))}/>
        </div>

        <div style={{background:"rgba(248,113,113,0.07)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:7,padding:"9px 12px",fontSize:11,color:"var(--red)",marginTop:12}}>
          ⚠️ This cannot be undone from this screen. The student will be removed from the active roster immediately.
        </div>
        <div className="mda">
          <button className="bg" onClick={()=>setShowTransfer(false)}>Cancel</button>
          <button className="bp" style={{background:"rgba(251,191,36,0.15)",borderColor:"rgba(251,191,36,0.4)",color:"var(--yel)"}} onClick={()=>doTransfer(sel)}>Confirm Transfer</button>
        </div>
      </div></div>}
      <div className={"smgr"+(isMobile?" mob1col":"")}>
        <div className="slp">
          {!state.students.length&&<div style={{padding:24,textAlign:"center",color:"var(--t3)"}}>
          <div style={{fontSize:36,marginBottom:10}}>👥</div>
          <div style={{fontSize:13,fontWeight:600,color:"var(--t2)",marginBottom:4}}>No students yet</div>
          <div style={{fontSize:11}}>Your student roster is empty.</div>
        </div>}
          {state.students.map(s=>(
            <div key={s.id} className={"sli"+(sel?.id===s.id?" on":"")} onClick={()=>{setSel(s);setSelSub(null);}}>
              <div className="av">{s.name[0]}</div>
              <div style={{flex:1}}><div style={{fontSize:12,fontWeight:500}}>{s.name}</div><div style={{fontSize:10,color:"var(--t3)"}}>{s.gradeLevel}</div></div>
              <button className="ib d" onClick={e=>{e.stopPropagation();delStu(s.id);}}>🗑️</button>
            </div>
          ))}
        </div>
        {sel&&<div className="sdp">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,paddingBottom:14,borderBottom:"1px solid var(--br)"}}>
            <div>
              <div style={{fontSize:16,fontWeight:700,marginBottom:6}}>{sel.name}</div>
              <span className="bdg">{sel.gradeLevel}</span><span className="bdg">{isMDN(sel.gradeLevel,state.sy?.mdnCutoff)?"MDN Scale":"Letter Grades"}</span>
            </div>
            <div style={{fontSize:11,color:"var(--t2)",textAlign:"right"}}>
              <div>📧 {sel.parentEmail||"—"}</div><div>📞 {sel.parentPhone||"—"}</div>
            </div>
          </div>
          <div style={{fontSize:13,fontWeight:600,marginBottom:10}}>Subjects</div>
          <div style={{display:"flex",gap:7,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>
            {isMDN(sel.gradeLevel,state.sy?.mdnCutoff)&&<select className="ins" value={sf.emoji} onChange={e=>setSf(f=>({...f,emoji:e.target.value}))}>{EMOJIS.map(e=><option key={e} value={e}>{e}</option>)}</select>}
            <input className="ins" placeholder="Subject name" value={sf.name} onChange={e=>setSf(f=>({...f,name:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addSub()}/>
            <button className="bs p" onClick={addSub}>Add</button>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
            {subs.map(sub=>(
              <div key={sub.id} className={"chip"+(selSub?.id===sub.id?" on":"")} onClick={()=>setSelSub(sub)}>
                {isMDN(sel.gradeLevel,state.sy?.mdnCutoff)?sub.emoji+" ":""}{sub.name}
                <button style={{background:"none",border:"none",cursor:"pointer",color:"var(--t3)",fontSize:13,lineHeight:1}} onClick={e=>{e.stopPropagation();delSub(sub.id);}}>×</button>
              </div>
            ))}
          </div>
          {curSub&&<div style={{background:"var(--bg)",borderRadius:8,padding:14,border:"1px solid var(--br)"}}>
            <div style={{fontSize:12,fontWeight:600,marginBottom:10}}>{curSub.emoji} {curSub.name} — Assignments</div>
            <div style={{display:"flex",gap:7,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
              <input className="ins" placeholder="Assignment name" value={af.name} onChange={e=>setAf(f=>({...f,name:e.target.value}))}/>
              {!isMDN(sel.gradeLevel,state.sy?.mdnCutoff)&&<input className="ins" type="number" placeholder="Max pts" value={af.maxScore} onChange={e=>setAf(f=>({...f,maxScore:e.target.value}))} style={{width:72}}/>}
              <input className="ins" type="date" value={af.date} onChange={e=>setAf(f=>({...f,date:e.target.value}))}/>
              <button className="bs p" onClick={addAssign}>Add</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {!curSub.assignments.length&&<p className="emp">No assignments yet</p>}
              {curSub.assignments.map(a=>(
                <div key={a.id} style={{display:"flex",alignItems:"center",gap:7,padding:"5px 8px",background:"var(--c1)",borderRadius:6,fontSize:11}}>
                  <span style={{flex:1,fontWeight:500}}>{a.name}</span>
                  <span style={{color:"var(--t3)"}}>{fmt(a.date)}</span>
                  {!isMDN(sel.gradeLevel,state.sy?.mdnCutoff)&&<span style={{color:"var(--t3)"}}>/{a.maxScore}pts</span>}
                  <span style={{fontFamily:"'JetBrains Mono',monospace"}}>{a.score!==null&&a.score!==undefined&&a.score!==""?a.score:<em style={{color:"var(--t3)"}}>ungraded</em>}</span>
                  <button className="ib d" onClick={()=>delAssign(a.id)}>×</button>
                </div>
              ))}
            </div>
          </div>}
        </div>}
      </div>
    </div>
  );
}

// ─── GRADE CELL HELPER ────────────────────────────────────────────────────────
function GradeCell({a,mdn,locked,children}) {
  if(locked) return (
    <div>
      <div style={{fontSize:8,color:"var(--pur)",marginBottom:2}}>🔒 Finalized</div>
      {a.score===EXEMPT?<span className="bdg bdgy">Exempt</span>:
       a.score!==null&&a.score!==undefined&&a.score!==""?
       <span className={"sb2 "+(mdn?"m"+a.score:gColor(pctAvg([a]))+"_")}>{a.score}{!mdn?"/"+a.maxScore:""}</span>:
       <span style={{fontSize:10,color:"var(--t3)"}}>—</span>}
    </div>
  );
  return <div>{children}</div>;
}

function CalcQuarterView({results,state}) {
  const activeQ=(state.sy?.quarters||[]).find(q=>{const t=today();return q.startDate&&q.endDate&&t>=q.startDate&&t<=q.endDate;});
  if(!activeQ) return <p style={{fontSize:11,color:"var(--t3)"}}>No active quarter. Set quarter dates in Settings.</p>;
  if(!results.length) return <p style={{fontSize:11,color:"var(--t3)"}}>No subjects active this quarter.</p>;
  return (
    <div>
      <div style={{fontSize:10,color:"var(--t3)",marginBottom:8}}>Showing: <strong>{activeQ.label}</strong> — what you need on remaining ungraded items</div>
      {results.map(r=>(
        <div key={r.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid var(--br)",fontSize:12}}>
          <span>{r.emoji||""} {r.name}</span>
          {r.np===null?<span className="bdg">No remaining work</span>:r.np>100?<span className="bdg bdgr">Not achievable</span>:r.np<0?<span className="bdg bdgg">Already achieved!</span>:<span className="bdg bdgy">Need {r.np}% on {r.rem} items</span>}
        </div>
      ))}
    </div>
  );
}
function CalcFinalView({results}) {
  if(!results.length) return <p style={{fontSize:11,color:"var(--t3)"}}>No subjects with defined quarters.</p>;
  return (
    <div>
      <div style={{fontSize:10,color:"var(--t3)",marginBottom:8}}>What average you need in remaining quarters to hit your target final grade</div>
      {results.map(r=>(
        <div key={r.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid var(--br)",fontSize:12}}>
          <span>{r.emoji||""} {r.name}<span style={{fontSize:10,color:"var(--t3)",marginLeft:6}}>{r.finalizedCount}/{r.totalQ}Q done{r.fAvg!==null?" · "+r.fAvg+"% so far":""}</span></span>
          {r.remainingCount===0?<span className="bdg bdgg">All quarters finalized</span>:!r.achievable?<span className="bdg bdgr">Not achievable</span>:r.alreadyAchieved?<span className="bdg bdgg">Already on track!</span>:<span className="bdg bdgy">Need {r.needed}% avg in {r.remainingCount} quarter(s)</span>}
        </div>
      ))}
    </div>
  );
}

function GradebookPanel({stuId,state,upd,isMobile,sortBy,displayQId,selectedQId,setSelectedQId,autoQ,fqMap}) {
  const [ed,setEd]=useState(null);
  const [sv,setSv]=useState("");
  const [sc,setSc]=useState("");
  const [ct,setCt]=useState("B");
  const [showCalc,setShowCalc]=useState(false);
  const [calcMode,setCalcMode]=useState("quarter");
  const [viewMode,setViewMode]=useState("grid");
  const [showAddSub,setShowAddSub]=useState(false);
  const [newSub,setNewSub]=useState({name:"",emoji:"📚",activeQuarters:[]});
  const [addingAssign,setAddingAssign]=useState(null);
  const [newAssign,setNewAssign]=useState({name:"",maxScore:100,date:today(),dueDate:"",repeat:1,repeatInterval:7,category:"homework"});
  const [showInactiveSubs,setShowInactiveSubs]=useState(false);
  const [assignDateError,setAssignDateError]=useState("");

  const stu=state.students.find(s=>s.id===stuId);
  if(!stu) return null;
  const subs=state.subjects[stu.id]||[];
  const mdn=isMDN(stu.gradeLevel,state.sy?.mdnCutoff);
  const allQ=state.sy?.quarters||[];

  const finalizedQ=Object.entries(fqMap).map(([id,rec])=>({
    id, label:typeof rec==="string"?id:(rec.label||id),
    startDate:typeof rec==="string"?(allQ.find(q=>q.id===id)?.startDate||""):(rec.startDate||""),
    endDate:typeof rec==="string"?(allQ.find(q=>q.id===id)?.endDate||""):(rec.endDate||""),
  })).filter(q=>q.startDate&&q.endDate);

  const displayQ=allQ.find(q=>q.id===displayQId)||null;

  const addSubject=()=>{
    if(!newSub.name.trim()) return;
    const sub={id:uid(),name:newSub.name,emoji:newSub.emoji,assignments:[],activeQuarters:newSub.activeQuarters||[]};
    upd(p=>({...p,subjects:{...p.subjects,[stu.id]:[...(p.subjects[stu.id]||[]),sub]}}));
    setNewSub({name:"",emoji:"📚",activeQuarters:[]});setShowAddSub(false);
    remindYearDates(state);
  };
  const delSubject=(subId)=>{
    upd(p=>{
      const sub=(p.subjects[stu.id]||[]).find(s=>s.id===subId);
      if((sub?.assignments||[]).some(a=>isDateLocked(a.date,p.finalizedQuarters,p.sy?.quarters))){
        alert("This subject has work in a finalized quarter. Unlock that quarter in Settings before deleting the subject.");return p;
      }
      return {...p,subjects:{...p.subjects,[stu.id]:(p.subjects[stu.id]||[]).filter(s=>s.id!==subId)}};
    });
  };
  const addAssignment=(subId)=>{
    if(!newAssign.name.trim()) return;
    const sub2=subs.find(s=>s.id===subId);
    const allQ2=[...allQ,...finalizedQ];
    const range=subjectDateRange(sub2,allQ2);
    const repeat=Math.max(1,parseInt(newAssign.repeat)||1);
    const interval=Math.max(1,parseInt(newAssign.repeatInterval)||7);
    const newAssigns=[];
    for(let i=0;i<repeat;i++){
      const d=new Date(newAssign.date+"T12:00:00");
      d.setDate(d.getDate()+i*interval);
      const dateStr=d.toISOString().slice(0,10);
      const dd=newAssign.dueDate?new Date(new Date(newAssign.dueDate+"T12:00:00").getTime()+i*interval*86400000).toISOString().slice(0,10):"";
      if(range&&dateStr&&(dateStr<range.start||dateStr>range.end)){
        setAssignDateError("Instance "+(i+1)+": date "+fmt(dateStr)+" is outside this subject's active date range ("+fmt(range.start)+" – "+fmt(range.end)+"). Adjust quarter dates in Settings.");
        return;
      }
      const label=repeat>1?newAssign.name+" "+(i+1):newAssign.name;
      newAssigns.push({id:uid(),name:label,maxScore:parseFloat(newAssign.maxScore)||100,date:dateStr,dueDate:dd,score:null,category:newAssign.category||"homework"});
    }
    const lockedNew=newAssigns.find(a=>isDateLocked(a.date,state.finalizedQuarters,state.sy?.quarters));
    if(lockedNew){
      setAssignDateError("Date "+fmt(lockedNew.date)+" falls in a finalized quarter. Unlock it in Settings to add work there.");
      return;
    }
    setAssignDateError("");
    upd(p=>({...p,subjects:{...p.subjects,[stu.id]:(p.subjects[stu.id]||[]).map(s=>s.id===subId?{...s,assignments:[...s.assignments,...newAssigns]}:s)}}));
    setNewAssign({name:"",maxScore:100,date:today(),dueDate:"",repeat:1,repeatInterval:7,category:"homework"});setAddingAssign(null);
    remindYearDates(state);
  };
  const delAssignment=(subId,aid)=>{
    upd(p=>{
      const asgn=((p.subjects[stu.id]||[]).find(s=>s.id===subId)||{}).assignments?.find(a=>a.id===aid);
      if(isDateLocked(asgn?.date,p.finalizedQuarters,p.sy?.quarters)){alert(LOCK_MSG);return p;}
      return {...p,subjects:{...p.subjects,[stu.id]:(p.subjects[stu.id]||[]).map(s=>s.id===subId?{...s,assignments:s.assignments.filter(a=>a.id!==aid)}:s)}};
    });
  };
  const setExempt=(subId,aid)=>{
    upd(p=>{
      const asgn=((p.subjects[stu.id]||[]).find(s=>s.id===subId)||{}).assignments?.find(a=>a.id===aid);
      if(isDateLocked(asgn?.date,p.finalizedQuarters,p.sy?.quarters)){alert(LOCK_MSG);return p;}
      return {...p,subjects:{...p.subjects,[stu.id]:(p.subjects[stu.id]||[]).map(s=>s.id===subId?{...s,assignments:s.assignments.map(a=>a.id===aid?{...a,score:EXEMPT}:a)}:s)}};
    });
    setEd(null);
  };
  const saveScore=(subId,aid,val,comment)=>{
    upd(p=>{
      const sub3=(p.subjects[stu.id]||[]).find(s=>s.id===subId);
      const asgn=sub3?.assignments.find(a=>a.id===aid);
      if(isDateLocked(asgn?.date,p.finalizedQuarters,p.sy?.quarters)){alert(LOCK_MSG);return p;}
      const prev=asgn?.score;
      const next=val===""?null:val;
      const teacher=p.users?.find(u=>u.role==="teacher");
      let np=addAudit(p,teacher?.name,"Grade changed: "+stu.name+" / "+(sub3?.name||"")+" / "+(asgn?.name||"")+" — "+(prev||"-")+" → "+(next||"-")+(comment?" ("+comment+")":""));
      return {...np,subjects:{...np.subjects,[stu.id]:(np.subjects[stu.id]||[]).map(s=>s.id===subId?{...s,assignments:s.assignments.map(a=>a.id===aid?{...a,score:next,comment:comment||a.comment||""}:a)}:s)}};
    });
    setEd(null);
  };

  const calcQuarter=()=>{
    const tp=L2P[ct]||75;
    const activeQ3=allQ.find(q=>{const t=today();return q.startDate&&q.endDate&&t>=q.startDate&&t<=q.endDate;});
    if(!activeQ3) return [];
    return subs.map(sub=>{
      const aq=sub.activeQuarters||[];
      if(aq.length&&!aq.includes(activeQ3.id)) return null;
      const qRecs=sub.assignments.filter(a=>a.date&&a.date>=activeQ3.startDate&&a.date<=activeQ3.endDate);
      const g=qRecs.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined&&a.score!==EXEMPT);
      const u=qRecs.filter(a=>a.score===null||a.score===""||a.score===undefined);
      const ep=g.reduce((s,a)=>s+(parseFloat(a.score)||0),0);
      const mg=g.reduce((s,a)=>s+(a.maxScore||100),0);
      const mr=u.reduce((s,a)=>s+(a.maxScore||100),0);
      const tot=mg+mr; if(!tot) return null;
      const need=((tp/100)*tot-ep);
      const np=mr>0?(need/mr)*100:null;
      return {name:sub.name,emoji:sub.emoji,np:np!==null?Math.round(np):null,rem:u.length};
    }).filter(Boolean);
  };
  const calcFinal=()=>{
    const tp=L2P[ct]||75;
    const fqMap2=state.finalizedQuarters||{};
    return subs.map(sub=>{
      const aq=sub.activeQuarters||[];
      const subQ=allQ.filter(q=>q.startDate&&q.endDate&&(!aq.length||aq.includes(q.id)));
      if(!subQ.length) return null;
      const total=subQ.length;
      const finalized=subQ.filter(q=>fqMap2[q.id]);
      const remaining=subQ.filter(q=>!fqMap2[q.id]);
      const fPcts=finalized.map(q=>{
        const rec=typeof fqMap2[q.id]==="object"?fqMap2[q.id]:null;
        const start=rec?.startDate||q.startDate;
        const end=rec?.endDate||q.endDate;
        const gr=sub.assignments.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined&&a.score!==EXEMPT&&a.date>=start&&a.date<=end);
        return pctAvg(gr);
      }).filter(p=>p!==null);
      const fSum=fPcts.reduce((s,p)=>s+p,0);
      const needed=remaining.length>0?((tp*total-fSum)/remaining.length):null;
      return {
        name:sub.name,emoji:sub.emoji,
        finalizedCount:finalized.length,totalQ:total,
        fAvg:fPcts.length?Math.round(fSum/fPcts.length):null,
        needed:needed!==null?Math.round(needed):null,
        remainingCount:remaining.length,
        achievable:needed===null||needed<=100,
        alreadyAchieved:needed!==null&&needed<=0,
      };
    }).filter(Boolean);
  };

  return (
    <>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,paddingBottom:14,borderBottom:"1px solid var(--br)"}}>
        <div>
          <div style={{fontSize:16,fontWeight:700}}>{stu.name}</div>
          <span className="bdg">{mdn?"MDN Scale":"Letter Grades"}</span>
        </div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{fontSize:10,color:"var(--t3)"}}>View:</span>
            <select className="ins" style={{fontSize:11}} value={selectedQId||"projected"} onChange={e=>setSelectedQId(e.target.value)}>
              <option value="projected">Projected Final</option>
              {allQ.filter(q=>q.startDate&&q.endDate).map(q=>(
                <option key={q.id} value={q.id}>{q.label}{q.id===autoQ?.id?" ●":""}{fqMap[q.id]?" 🔒":""}</option>
              ))}
            </select>
          </div>
          {!mdn&&<button className={"bs"+(showCalc?" p":"")} onClick={()=>setShowCalc(!showCalc)}>🎯 Calculator</button>}
          <button className="bs" onClick={()=>setShowAddSub(true)}>+ Subject</button>
          <button className={"bs"+(showInactiveSubs?" p":"")} onClick={()=>setShowInactiveSubs(v=>!v)}>{showInactiveSubs?"Hide":"Show Inactive"}</button>
        </div>
      </div>
      {showAddSub&&<div style={{background:"var(--bg)",border:"1px solid var(--br2)",borderRadius:8,padding:14,marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:600,marginBottom:10}}>Add New Subject</div>
        <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
          {mdn&&<select className="ins" value={newSub.emoji} onChange={e=>setNewSub(f=>({...f,emoji:e.target.value}))}>{EMOJIS.map(e=><option key={e} value={e}>{e}</option>)}</select>}
          <input className="ins" placeholder="Subject name" value={newSub.name} onChange={e=>setNewSub(f=>({...f,name:e.target.value}))} style={{flex:1}}/>
          <div style={{display:"flex",flexDirection:"column",gap:4,width:"100%"}}>
            <div style={{fontSize:11,color:"var(--t3)"}}>Active quarters (leave blank for year-long):</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {allQ.filter(q=>q.startDate&&q.endDate).map(q=>(
                <label key={q.id} className="cl" style={{fontSize:11}}>
                  <input type="checkbox" checked={(newSub.activeQuarters||[]).includes(q.id)} onChange={()=>setNewSub(f=>({...f,activeQuarters:f.activeQuarters.includes(q.id)?f.activeQuarters.filter(x=>x!==q.id):[...f.activeQuarters,q.id]}))}/>
                  <span style={{marginLeft:4}}>{q.label}</span>
                </label>
              ))}
              {!allQ.some(q=>q.startDate&&q.endDate)&&<span style={{fontSize:10,color:"var(--t3)"}}>Define quarters in Settings first</span>}
            </div>
          </div>
          <div style={{display:"flex",gap:7}}>
            <button className="bp" style={{fontSize:11}} onClick={addSubject}>Add</button>
            <button className="bg" style={{fontSize:11}} onClick={()=>setShowAddSub(false)}>Cancel</button>
          </div>
        </div>
      </div>}
      {showCalc&&!mdn&&<div style={{background:"var(--bg)",borderRadius:8,padding:14,marginBottom:16,border:"1px solid rgba(76,175,80,.2)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",gap:6}}>
            <button className={"bs"+(calcMode==="quarter"?" p":"")} style={{fontSize:11}} onClick={()=>setCalcMode("quarter")}>📅 Quarter</button>
            <button className={"bs"+(calcMode==="final"?" p":"")} style={{fontSize:11}} onClick={()=>setCalcMode("final")}>🏁 Final</button>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <label style={{fontSize:11}}>Target:</label>
            <select className="ins" value={ct} onChange={e=>setCt(e.target.value)}>{LETTERS.filter(l=>l!=="F").map(l=><option key={l}>{l}</option>)}</select>
          </div>
        </div>
        {calcMode==="quarter"&&<CalcQuarterView results={calcQuarter()} state={state}/>}
        {calcMode==="final"&&<CalcFinalView results={calcFinal()}/>}
      </div>}
      {!subs.length&&<p className="emp">No subjects assigned. Click + Subject above to add one.</p>}
      {subs.filter(sub=>{
        if(showInactiveSubs) return true;
        if(isSubjectFullyFinalized(sub,fqMap)) return false;
        return isSubjectActiveToday(sub,finalizedQ,state.sy);
      }).map(sub=>{
        let avd=null;
        let avdLabel="Year";
        if(displayQ){
          const gradedQ=sub.assignments.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined&&a.score!==EXEMPT&&a.date&&a.date>=displayQ.startDate&&a.date<=displayQ.endDate);
          avdLabel=displayQ.label+" Avg";
          if(mdn){const avg=mdnAvg(gradedQ);avd=avg!==null?(avg.toFixed(1)+" ("+(["N","D","M"][Math.round(avg)-1]||"N")+")"):null;}
          else{const avg=pctAvg(gradedQ);avd=avg!==null?(Math.round(avg)+"% ("+getLetter(avg)+")"):null;}
        } else {
          const subQs=allQ.filter(q=>q.startDate&&q.endDate&&(!(sub.activeQuarters||[]).length||(sub.activeQuarters||[]).includes(q.id)));
          if(subQs.length>0&&!mdn){
            const qPcts=subQs.map(q=>{
              const qa=sub.assignments.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined&&a.score!==EXEMPT&&a.date&&a.date>=q.startDate&&a.date<=q.endDate);
              return pctAvg(qa);
            });
            const withGrades=qPcts.filter(p=>p!==null);
            if(withGrades.length>0){
              const projFinal=withGrades.reduce((s,p)=>s+p,0)/withGrades.length;
              avdLabel="Projected Final";
              avd=Math.round(projFinal)+"% ("+getLetter(projFinal)+")";
            }
          } else if(!mdn){
            const ga=sub.assignments.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined&&a.score!==EXEMPT);
            const avg=pctAvg(ga);
            avdLabel="Avg"; avd=avg!==null?(Math.round(avg)+"% ("+getLetter(avg)+")"):null;
          } else {
            const ga=sub.assignments.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined&&a.score!==EXEMPT);
            const avg=mdnAvg(ga);
            avdLabel="Avg"; avd=avg!==null?(avg.toFixed(1)+" ("+(["N","D","M"][Math.round(avg)-1]||"N")+")"):null;
          }
        }
        const isFinalized=Object.keys(fqMap).some(qid=>{
          const q=allQ.find(x=>x.id===qid);
          return q&&sub.assignments.some(a=>a.date&&a.date>=q.startDate&&a.date<=q.endDate);
        });
        return(
          <div key={sub.id} style={{marginBottom:20}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span style={{fontSize:13,fontWeight:600}}>{mdn?sub.emoji+" ":""}{sub.name}</span>
                {(sub.activeQuarters||[]).map(qid=>{
                  const q=allQ.find(x=>x.id===qid);
                  return q?<span key={qid} className="bdg" style={{fontSize:9}}>{q.label}</span>:null;
                })}
                {isFinalized&&<span style={{fontSize:9,color:"var(--pur)"}}>🔒 Posted</span>}
                {!isSubjectActiveToday(sub,finalizedQ,state.sy)&&!isSubjectFullyFinalized(sub,fqMap)&&<span style={{fontSize:9,color:"var(--t3)"}}>inactive</span>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:11,color:"var(--acc)",fontFamily:"'JetBrains Mono',monospace"}}>{avdLabel}: {avd||"No grades yet"}</span>
                <button className="bs" style={{fontSize:10,padding:"3px 7px"}} onClick={()=>setAddingAssign(addingAssign===sub.id?null:sub.id)}>+ Assignment</button>
                <button className="ib d" style={{fontSize:12}} onClick={()=>delSubject(sub.id)} title="Delete subject">🗑️</button>
              </div>
            </div>
            {addingAssign===sub.id&&<div style={{marginBottom:10}}>
              {assignDateError&&<div style={{background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:6,padding:"8px 10px",fontSize:11,color:"var(--red)",marginBottom:8}}>⚠️ {assignDateError}</div>}
              <div style={{background:"var(--bg)",border:"1px solid var(--br2)",borderRadius:7,padding:10,display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
                <div style={{display:"flex",gap:4,marginBottom:0}}>
                  <button className={"bs"+(newAssign.category==="homework"?" p":"")} style={{fontSize:10,padding:"4px 8px"}} onClick={()=>setNewAssign(f=>({...f,category:"homework"}))}>📝 Homework</button>
                  <button className={"bs"+(newAssign.category==="test"?" p":"")} style={{fontSize:10,padding:"4px 8px"}} onClick={()=>setNewAssign(f=>({...f,category:"test"}))}>📋 Quiz/Test</button>
                </div>
                <input className="ins" placeholder={newAssign.category==="test"?"Quiz/Test name":"Assignment name"} value={newAssign.name} onChange={e=>setNewAssign(f=>({...f,name:e.target.value}))} style={{flex:1}}/>
                {!mdn&&<input className="ins" type="number" placeholder="Max pts" value={newAssign.maxScore} onChange={e=>setNewAssign(f=>({...f,maxScore:e.target.value}))} style={{width:70}}/>}
                <input className="ins" type="date" value={newAssign.date} onChange={e=>setNewAssign(f=>({...f,date:e.target.value}))} title="Assigned date"/>
                <input className="ins" type="date" value={newAssign.dueDate} onChange={e=>setNewAssign(f=>({...f,dueDate:e.target.value}))} title="Due date"/>
                <select className="ins" style={{width:60}} value={newAssign.repeat} onChange={e=>setNewAssign(f=>({...f,repeat:parseInt(e.target.value)}))}>
                  {[1,2,3,4,5,6,7,8,9,10,12,16,18,20,24,36].map(n=><option key={n} value={n}>{n}x</option>)}
                </select>
                {newAssign.repeat>1&&<select className="ins" style={{width:80}} value={newAssign.repeatInterval} onChange={e=>setNewAssign(f=>({...f,repeatInterval:parseInt(e.target.value)}))}>
                  {[[1,"daily"],[7,"weekly"],[14,"bi-wkly"],[30,"monthly"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                </select>}
                <button className="bp" style={{fontSize:11}} onClick={()=>addAssignment(sub.id)}>{newAssign.repeat>1?"Add "+newAssign.repeat+"x":"Add"}</button>
                <button className="bg" style={{fontSize:11}} onClick={()=>{setAddingAssign(null);setAssignDateError("");}}>Cancel</button>
              </div>
            </div>}
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <button className={"bs"+(viewMode==="grid"?" p":"")} onClick={()=>setViewMode("grid")}>⊞ Grid</button>
              <button className={"bs"+(viewMode==="list"?" p":"")} onClick={()=>setViewMode("list")}>☰ List</button>
            </div>
            {viewMode==="grid"&&<div className="agrid">
              {[...sub.assignments].sort((a,b)=>sortBy==="name"?a.name.localeCompare(b.name):a.date>b.date?1:-1).map(a=>{
                const fq_gb=state.finalizedQuarters||{};
                const locked=Object.entries(fq_gb).some(([id,rec])=>{const s2=typeof rec==="string"?(allQ.find(q=>q.id===id)?.startDate):rec.startDate;const e2=typeof rec==="string"?(allQ.find(q=>q.id===id)?.endDate):rec.endDate;return s2&&e2&&a.date&&a.date>=s2&&a.date<=e2;});
                return(
                  <div key={a.id} className="gc">
                    <div className="gcn">
                      {a.dueDate&&a.dueDate<today()&&(a.score===null||a.score===undefined||a.score==="")&&<span style={{fontSize:8,color:"var(--red)",marginRight:3}}>⚠ MISSING</span>}
                      {a.category==="test"&&<span style={{fontSize:8,color:"var(--pur)",marginRight:3}}>📋</span>}
                      {a.name}
                    </div>
                    <div className="gcd">{fmt(a.date)}{a.dueDate&&a.dueDate!==a.date?" · Due: "+fmt(a.dueDate):""}</div>
                    {a.comment&&<div style={{fontSize:9,color:"var(--pur)",marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={a.comment}>💬 {a.comment}</div>}
                    <GradeCell a={a} mdn={mdn} locked={locked}>
                      {ed?.a===a.id?(
                        <div>
                          {mdn?<select className="inx" value={sv} onChange={e=>setSv(e.target.value)}><option value="">—</option>{Object.keys(MDN).map(k=><option key={k} value={k}>{k} – {MDN_LBL[k]}</option>)}</select>:<input className="inx" type="number" value={sv} onChange={e=>setSv(e.target.value)} placeholder={"/"+a.maxScore}/>}
                          <input className="inx" style={{marginTop:3}} placeholder="Comment (optional)" value={sc} onChange={e=>setSc(e.target.value)}/>
                          <div style={{display:"flex",gap:3,marginTop:4,flexWrap:"wrap"}}>
                            <button className="bx p" onClick={()=>saveScore(sub.id,a.id,sv,sc)}>✓</button>
                            <button className="bx" onClick={()=>setExempt(sub.id,a.id)} title="Mark exempt">E</button>
                            <button className="bx" onClick={()=>setEd(null)}>✗</button>
                            <button className="bx" style={{color:"var(--red)"}} onClick={()=>delAssignment(sub.id,a.id)}>🗑</button>
                          </div>
                        </div>
                      ):(
                        <div style={{cursor:"pointer"}} onClick={()=>{setEd({a:a.id});setSv(a.score===EXEMPT?"":a.score||"");setSc(a.comment||"");}}>
                          {a.score===EXEMPT?<span className="bdg bdgy">Exempt</span>:
                           a.score!==null&&a.score!==undefined&&a.score!==""?
                           <span className={"sb2 "+(mdn?"m"+a.score:gColor(pctAvg([a]))+"_")}>{a.score}{!mdn?"/"+a.maxScore:""}</span>:
                           <span style={{fontSize:10,color:"var(--t3)",fontStyle:"italic"}}>Click to grade</span>}
                        </div>
                      )}
                    </GradeCell>
                  </div>
                );
              })}
            </div>}
            {viewMode==="list"&&<div style={{display:"flex",flexDirection:"column",gap:4}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 1fr 60px",gap:6,padding:"4px 6px",fontSize:10,color:"var(--t3)",fontWeight:600,textTransform:"uppercase"}}>
                <span>Assignment</span><span>Due</span><span>Score</span><span>Comment</span><span></span>
              </div>
              {[...sub.assignments].sort((a,b)=>sortBy==="name"?a.name.localeCompare(b.name):a.date>b.date?1:-1).map(a=>{
                const fq_gb2=state.finalizedQuarters||{};
                const locked2=Object.entries(fq_gb2).some(([id,rec])=>{const s2=typeof rec==="string"?(allQ.find(q=>q.id===id)?.startDate):rec.startDate;const e2=typeof rec==="string"?(allQ.find(q=>q.id===id)?.endDate):rec.endDate;return s2&&e2&&a.date&&a.date>=s2&&a.date<=e2;});
                return(
                  <div key={a.id} style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 1fr 60px",gap:6,padding:"6px 6px",background:"var(--bg)",borderRadius:6,fontSize:11,alignItems:"center"}}>
                    <span style={{fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {a.dueDate&&a.dueDate<today()&&!a.score&&<span style={{fontSize:8,color:"var(--red)",marginRight:3}}>⚠</span>}
                      {a.name}
                    </span>
                    <span style={{color:"var(--t3)",fontSize:10}}>{fmt(a.dueDate||a.date)}</span>
                    <div>
                      {locked2?<span style={{fontSize:9,color:"var(--pur)"}}>🔒</span>:
                       ed?.a===a.id?(
                        <div style={{display:"flex",gap:3}}>
                          {mdn?<select className="inx" value={sv} onChange={e=>setSv(e.target.value)}><option value="">—</option>{Object.keys(MDN).map(k=><option key={k} value={k}>{k}</option>)}</select>:<input className="inx" style={{width:50}} type="number" value={sv} onChange={e=>setSv(e.target.value)}/>}
                          <button className="bx p" onClick={()=>saveScore(sub.id,a.id,sv,sc)}>✓</button>
                        </div>
                      ):(
                        <span style={{cursor:"pointer"}} onClick={()=>{setEd({a:a.id});setSv(a.score===EXEMPT?"":a.score||"");setSc(a.comment||"");}}>
                          {a.score===EXEMPT?<span className="bdg bdgy">Exempt</span>:
                           a.score!==null&&a.score!==undefined&&a.score!==""?
                           <span className={"sb2 "+(mdn?"m"+a.score:gColor(pctAvg([a]))+"_")}>{a.score}{!mdn?"/"+a.maxScore:""}</span>:
                           <span style={{color:"var(--t3)"}}>—</span>}
                        </span>
                      )}
                    </div>
                    <div>
                      {ed?.a===a.id?<input className="inx" style={{width:"100%"}} placeholder="Comment" value={sc} onChange={e=>setSc(e.target.value)}/>:
                       <span style={{color:"var(--pur)",fontSize:10}}>{a.comment||""}</span>}
                    </div>
                    <div style={{display:"flex",gap:3}}>
                      <button className="bx" style={{fontSize:10}} onClick={()=>setExempt(sub.id,a.id)}>E</button>
                      <button className="bx" style={{fontSize:10,color:"var(--red)"}} onClick={()=>delAssignment(sub.id,a.id)}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>}
          </div>
        );
      })}
    </>
  );
}

function Gradebook({state,upd,isMobile}) {
  const [sel,setSel]=useState(null);
  const [search,setSearch]=useState("");
  const [sortBy,setSortBy]=useState("date");
  const [selectedQId,setSelectedQId]=useState(null);

  const allQ=state.sy?.quarters||[];
  const fqMap=state.finalizedQuarters||{};
  const autoQ=allQ.find(q=>{const t=today();return q.startDate&&q.endDate&&t>=q.startDate&&t<=q.endDate;});
  const displayQId=selectedQId==="projected"?null:selectedQId;

  // Export every student's gradebook to one styled workbook:
  // a Summary sheet, an All Assignments sheet, and one sheet per student.
  const exportExcel=()=>{
    const students=state.students||[];
    if(!students.length){alert("There are no students to export.");return;}
    const syLabel=(state.sy?.startDate&&state.sy?.endDate)?(fmt(state.sy.startDate)+" – "+fmt(state.sy.endDate)):"";
    const head=(t)=>[["Empower Iowa — Elim Springs Campus"],[t+(syLabel?("  ·  School year "+syLabel):"")+"  ·  Exported "+fmt(today())],[]];

    // ── Summary: one row per student × subject ──
    const sumRows=[], sumBands=[], sumFmt=[];
    students.forEach((s,si)=>{
      const mdn=isMDN(s.gradeLevel,state.sy?.mdnCutoff);
      const subs=state.subjects[s.id]||[];
      if(!subs.length) sumRows.push([s.name,s.gradeLevel,mdn?"MDN":"Letter","(no subjects)","","","",""]);
      subs.forEach(sub=>{
        const gr=sub.assignments.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined);
        const scored=gr.filter(a=>a.score!==EXEMPT);
        const avg=mdn?mdnAvg(gr):pctAvg(gr);
        let avgCell="",gradeCell="—";
        if(avg!==null){
          if(mdn){gradeCell=(["N","D","M"][Math.round(avg)-1]||"N")+" — "+(MDN_LBL[["N","D","M"][Math.round(avg)-1]]||"");avgCell=Number(avg.toFixed(2));}
          else {gradeCell=getLetter(avg);avgCell=avg/100;}
          sumFmt.push({r:head("x").length+1+sumRows.length,c:4,z:mdn?"0.00":"0%"});
        }
        sumRows.push([s.name,s.gradeLevel,mdn?"MDN":"Letter",sub.name,avgCell,gradeCell,scored.length,sub.assignments.length]);
      });
      if(si%2===1) for(let k=0;k<((state.subjects[s.id]||[]).length||1);k++) sumBands.push(head("x").length+sumRows.length-k);
    });
    const sumHeader=["Student","Grade Level","Scale","Subject","Average","Grade","Graded","Total"];
    const summary={name:"Summary",
      aoa:[...head("Gradebook Summary"),sumHeader,...sumRows],
      cols:[{wch:20},{wch:14},{wch:8},{wch:20},{wch:10},{wch:18},{wch:9},{wch:8}],
      titleRows:[0,1],headerRow:3,bands:sumBands,formats:sumFmt,merges:[{s:{r:0,c:0},e:{r:0,c:7}},{s:{r:1,c:0},e:{r:1,c:7}}]};

    // ── Assignment rows (shared shape for the combined and per-student sheets) ──
    const rowsFor=(s)=>{
      const mdn=isMDN(s.gradeLevel,state.sy?.mdnCutoff);
      const out=[];
      (state.subjects[s.id]||[]).forEach(sub=>{
        sub.assignments.slice().sort((a,b)=>(a.date>b.date?1:-1)).forEach(a=>{
          const exempt=a.score===EXEMPT;
          const scored=a.score!==null&&a.score!==""&&a.score!==undefined&&!exempt;
          let score="",max="",pct="",grade="";
          if(exempt){score="Exempt";grade="Excused";}
          else if(scored){
            if(mdn){score=a.score;grade=MDN_LBL[a.score]||"";}
            else {score=parseFloat(a.score);max=a.maxScore||100;pct=score/max;grade=getLetter(pct*100);}
          } else {grade="Not graded";}
          out.push({mdn,row:[sub.name,a.name,a.category||"",a.date||"",a.dueDate||"",score,max,pct,grade]});
        });
      });
      return out;
    };

    // ── All Assignments (Student column first), banded per student ──
    const allRows=[],allBands=[],allFmt=[];
    const allTitle=head("All Assignments");
    students.forEach((s,si)=>{
      rowsFor(s).forEach(r=>{
        if(r.row[7]!=="") allFmt.push({r:allTitle.length+1+allRows.length,c:9,z:"0%"});
        if(si%2===1) allBands.push(allTitle.length+1+allRows.length);
        allRows.push([s.name,s.gradeLevel,...r.row]);
      });
    });
    const allHeader=["Student","Grade Level","Subject","Assignment","Category","Date","Due Date","Score","Max","Percent","Grade"];
    const allSheet={name:"All Assignments",
      aoa:[...allTitle,allHeader,...allRows],
      cols:[{wch:20},{wch:13},{wch:18},{wch:28},{wch:11},{wch:12},{wch:12},{wch:9},{wch:7},{wch:10},{wch:13}],
      titleRows:[0,1],headerRow:3,bands:allBands,formats:allFmt,merges:[{s:{r:0,c:0},e:{r:0,c:10}},{s:{r:1,c:0},e:{r:1,c:10}}]};

    // ── One sheet per student ──
    const perStudent=students.map(s=>{
      const t=head(s.name+" — "+s.gradeLevel);
      const rows=[],fmts=[],bands=[];
      let lastSub=null,band=false;
      rowsFor(s).forEach(r=>{
        if(r.row[0]!==lastSub){band=!band;lastSub=r.row[0];}
        if(band) bands.push(t.length+1+rows.length);
        if(r.row[7]!=="") fmts.push({r:t.length+1+rows.length,c:7,z:"0%"});
        rows.push(r.row);
      });
      return {name:s.name,
        aoa:[...t,["Subject","Assignment","Category","Date","Due Date","Score","Max","Percent","Grade"],...(rows.length?rows:[["(no assignments)","","","","","","","",""]])],
        cols:[{wch:18},{wch:28},{wch:11},{wch:12},{wch:12},{wch:9},{wch:7},{wch:10},{wch:13}],
        titleRows:[0,1],headerRow:3,bands:bands,formats:fmts,merges:[{s:{r:0,c:0},e:{r:0,c:8}},{s:{r:1,c:0},e:{r:1,c:8}}]};
    });

    window._exportSheets("Gradebook_All_Students.xlsx",[summary,allSheet,...perStudent])
      .catch(e=>alert("Export failed: "+((e&&e.message)||e)));
  };

  return (
    <div className="pg">
      <div className="ph">
        <div className="ptit">Gradebook</div>
        <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
          <input className="ins" placeholder="Search students..." value={search} onChange={e=>setSearch(e.target.value)}/>
          <select className="ins" value={sortBy} onChange={e=>setSortBy(e.target.value)}>
            <option value="date">Sort by Date</option>
            <option value="name">Sort by Name</option>
          </select>
          <button className="bg" onClick={exportExcel} title="Export every student's gradebook to Excel">⬇ Export All to Excel</button>
        </div>
      </div>
      <div className="gbl">
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          {state.students.filter(s=>!search||s.name.toLowerCase().includes(search.toLowerCase())).map(s=>(
            <button key={s.id} className={"ssb"+(sel===s.id?" on":"")} onClick={()=>setSel(s.id)}>
              <span>{s.name[0]}</span><div><div style={{fontSize:12}}>{s.name}</div><div style={{fontSize:10,color:"var(--t3)"}}>{s.gradeLevel}</div></div>
            </button>
          ))}
        </div>
        <div className="gbm">
          {!sel&&<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:200,color:"var(--t3)",gap:8}}>
            <div style={{fontSize:40}}>📊</div>
            <div style={{fontSize:13,color:"var(--t2)",fontWeight:600}}>Select a student</div>
          </div>}
          {sel&&<GradebookPanel
            stuId={sel} state={state} upd={upd} isMobile={isMobile}
            sortBy={sortBy}
            displayQId={displayQId} selectedQId={selectedQId}
            setSelectedQId={setSelectedQId}
            autoQ={autoQ} fqMap={fqMap}
          />}
        </div>
      </div>
    </div>
  );
}

function Attendance({state,upd,isMobile}) {
  const [date,setDate]=useState(today);
  const [showSp,setShowSp]=useState(false);
  const [editHours,setEditHours]=useState(null);
  const [showLog,setShowLog]=useState(null);
  const [showMonthly,setShowMonthly]=useState(false);
  const [showUpload,setShowUpload]=useState(false);
  const [uploadForm,setUploadForm]=useState({studentIds:[],startDate:today(),endDate:today(),note:"",file:null,fileName:"",fileType:""});
  const [uploadError,setUploadError]=useState("");
  const [reportMonth,setReportMonth]=useState(new Date().getFullYear()+"-"+String(new Date().getMonth()+1).padStart(2,"0")); // studentId
  const [sp,setSp]=useState({type:"break",note:"",startDate:today(),endDate:today()});

  const hpd=state.sy?.hoursPerDay||6;
  const minHrs=state.sy?.minHrs||DEFAULT_MIN_HRS;
  const syStart=state.sy?.startDate||"";
  const syEnd=state.sy?.endDate||"";
  const outsideYear=syStart&&syEnd&&(date<syStart||date>syEnd);

  const setAtt=(sid,status)=>{
    const hours=status==="present"||status==="excused"?hpd:status==="tardy"?hpd*0.75:0;
    upd(p=>{
      const recs=p.attendance[sid]||[];
      const idx=recs.findIndex(r=>r.date===date);
      const rec={id:uid(),date,status,hours};
      return {...p,attendance:{...p.attendance,[sid]:idx>=0?recs.map((r,i)=>i===idx?rec:r):[...recs,rec]}};
    });
  };

  const saveHours=(sid,val)=>{
    const h=parseFloat(val);
    if(isNaN(h)||h<0) return;
    upd(p=>{
      const recs=p.attendance[sid]||[];
      const idx=recs.findIndex(r=>r.date===date);
      if(idx<0) return p;
      return {...p,attendance:{...p.attendance,[sid]:recs.map((r,i)=>i===idx?{...r,hours:Math.min(h,hpd)}:r)}};
    });
    setEditHours(null);
  };

  const spDay=(state.specialDays||[]).filter(d=>d.startDate&&d.endDate&&date>=d.startDate&&date<=d.endDate);

  const handleFileSelect=(e)=>{
    const file=e.target.files[0];
    if(!file) return;
    if(!file.type.match(/^(application\/pdf|image\/(jpeg|png|gif|webp))$/)){
      setUploadError("Only PDF and image files (JPG, PNG) are accepted.");
      return;
    }
    if(file.size>5*1024*1024){
      setUploadError("File must be under 5MB. For larger files, use Firebase Storage.");
      return;
    }
    setUploadError("");
    const reader=new FileReader();
    reader.onload=ev=>setUploadForm(f=>({...f,file:ev.target.result,fileName:file.name,fileType:file.type}));
    reader.readAsDataURL(file);
  };
  const saveExcuseFile=()=>{
    if(!uploadForm.file){setUploadError("Please select a file.");return;}
    if(!uploadForm.studentIds.length){setUploadError("Select at least one student.");return;}
    // NOTE: In production with Firebase, replace uploadForm.file (base64) with a Firebase Storage URL
    const entry={id:uid(),fileName:uploadForm.fileName,fileType:uploadForm.fileType,
      dataUrl:uploadForm.file, // TODO Firebase: replace with Storage URL
      studentIds:uploadForm.studentIds,startDate:uploadForm.startDate,
      endDate:uploadForm.endDate,note:uploadForm.note,uploadedAt:today()};
    upd(p=>({...p,excuseFiles:[...(p.excuseFiles||[]),entry]}));
    setShowUpload(false);
    setUploadForm({studentIds:[],startDate:today(),endDate:today(),note:"",file:null,fileName:"",fileType:""});
    setUploadError("");
  };

  const addSpecialDay=()=>{
    upd(p=>({...p,specialDays:[...(p.specialDays||[]),{id:uid(),type:sp.type,note:sp.note,startDate:sp.startDate,endDate:sp.endDate}]}));
    setShowSp(false);
  };

  // Log modal for one student
  const logStu=showLog?state.students.find(s=>s.id===showLog):null;
  const logRecs=showLog?(state.attendance[showLog]||[]).slice().sort((a,b)=>b.date>a.date?1:-1):[];

  return (
    <div className="pg">
      <div className="ph">
        <div className="ptit">Attendance</div>
        <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
          <input className="ins" type="date" value={date}
            min={syStart||undefined} max={syEnd||undefined}
            onChange={e=>setDate(e.target.value)}/>
          <button className="bs a" onClick={()=>setShowSp(true)}>+ Break / Special Day</button>
          <button className="bs" onClick={()=>setShowMonthly(true)}>📋 Monthly Report</button>
          <button className="bs a" onClick={()=>setShowUpload(true)}>📎 Upload Excuse</button>
          <button className="bp" style={{fontSize:11}} onClick={()=>{
            const hpd=state.sy?.hoursPerDay||6;
            upd(p=>{
              const newAtt={...p.attendance};
              p.students.forEach(s=>{
                const recs=p.attendance[s.id]||[];
                const idx=recs.findIndex(r=>r.date===date);
                const rec={id:uid(),date,status:"present",hours:hpd};
                newAtt[s.id]=idx>=0?recs.map((r,i)=>i===idx?rec:r):[...recs,rec];
              });
              return {...p,attendance:newAtt};
            });
          }}>✓ Mark All Present</button>
        </div>
      </div>

      {showSp&&<div className="mo"><div className="md">
        <div className="mdt">Add Break or Special Day</div>
        <div style={{fontSize:11,color:"var(--t2)",marginBottom:14,lineHeight:1.6}}>
          Multi-day breaks (e.g. Winter Break) will appear in the Events calendar and are subtracted from attendance projections automatically.
        </div>
        <div className="fg">
          <label>Type</label>
          <select className="inp" value={sp.type} onChange={e=>setSp(f=>({...f,type:e.target.value}))}>
            <option value="break">Break / Holiday</option>
            <option value="delay">Delay (counts as half day)</option>
            <option value="cancel">Cancellation (no hours)</option>
          </select>
          <label>Start Date</label><input className="inp" type="date" value={sp.startDate} onChange={e=>setSp(f=>({...f,startDate:e.target.value}))}/>
          <label>End Date</label><input className="inp" type="date" value={sp.endDate} onChange={e=>setSp(f=>({...f,endDate:e.target.value}))}/>
          <label>Label</label><input className="inp" value={sp.note} onChange={e=>setSp(f=>({...f,note:e.target.value}))} placeholder="e.g. Winter Break, Snow Day"/>
        </div>
        <div className="mda">
          <button className="bg" onClick={()=>setShowSp(false)}>Cancel</button>
          <button className="bp" onClick={addSpecialDay}>Save</button>
        </div>
      </div></div>}

      {logStu&&<div className="mo"><div className="md" style={{maxWidth:560}}>
        <div className="mdt">📋 Attendance Log — {logStu.name}</div>
        <div style={{display:"flex",gap:20,marginBottom:14,fontSize:12}}>
          <span>✓ Present: <strong>{logRecs.filter(r=>r.status==="present").length}</strong></span>
          <span>✗ Absent: <strong>{logRecs.filter(r=>r.status==="absent").length}</strong></span>
          <span>⏰ Tardy: <strong>{logRecs.filter(r=>r.status==="tardy").length}</strong></span>
          <span>Total hrs: <strong>{Math.round(hrsAtt(logRecs,state.sy))}</strong></span>
          {(state.excuseFiles||[]).filter(f=>f.studentIds.includes(showLog)).length>0&&(
            <div style={{marginTop:10}}>
              <div style={{fontSize:11,fontWeight:600,color:"var(--acc)",marginBottom:6}}>📎 Excuse Documents</div>
              {(state.excuseFiles||[]).filter(f=>f.studentIds.includes(showLog)).map(f=>(
                <div key={f.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 8px",background:"var(--bg)",borderRadius:6,marginBottom:4,fontSize:11}}>
                  <div>
                    <div style={{fontWeight:500}}>{f.fileName}</div>
                    <div style={{color:"var(--t3)",fontSize:10}}>{fmt(f.startDate)}{f.startDate!==f.endDate?" – "+fmt(f.endDate):""}{f.note?" · "+f.note:""}</div>
                  </div>
                  <div style={{display:"flex",gap:5}}>
                    {f.dataUrl&&<a href={f.dataUrl} target="_blank" rel="noreferrer" className="bs" style={{fontSize:10,textDecoration:"none"}}>View</a>}
                    <button className="bs r" style={{fontSize:10}} onClick={()=>upd(p=>({...p,excuseFiles:(p.excuseFiles||[]).filter(x=>x.id!==f.id)}))}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{maxHeight:380,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
          {!logRecs.length&&<p className="emp">No records yet</p>}
          {logRecs.map(r=>(
            <div key={r.id} style={{display:"flex",gap:12,padding:"6px 9px",background:"var(--bg)",borderRadius:6,fontSize:11,alignItems:"center"}}>
              <span style={{width:100,color:"var(--t2)"}}>{fmt(r.date)}</span>
              <span className={"bdg"+(r.status==="present"?" bdgg":r.status==="absent"?" bdgr":" bdgy")}>{r.status}</span>
              <span style={{color:"var(--t3)"}}>{r.hours}h</span>
            </div>
          ))}
        </div>
        <div className="mda"><button className="bg" onClick={()=>setShowLog(null)}>Close</button></div>
      </div></div>}

      {showUpload&&<div className="mo"><div className="md" style={{maxWidth:500}}>
        <div className="mdt">📎 Upload Excuse Document</div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:12}}>
          Upload a PDF or image for a doctor note, parental excuse, or other documentation.
          <br/><em style={{color:"var(--yel)"}}>Demo mode: files stored in browser. Firebase required for permanent storage.</em>
        </div>
        {uploadError&&<div style={{color:"var(--red)",fontSize:12,marginBottom:10}}>⚠️ {uploadError}</div>}
        <div className="fg">
          <label>Students</label>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            <label className="cl" style={{fontSize:11,fontWeight:600,color:"var(--acc)"}}>
              <input type="checkbox"
                checked={uploadForm.studentIds.length===state.students.length&&state.students.length>0}
                onChange={e=>setUploadForm(f=>({...f,studentIds:e.target.checked?state.students.map(s=>s.id):[]}))}/>
              All Students
            </label>
            {state.students.map(s=>(
              <label key={s.id} className="cl" style={{fontSize:11}}>
                <input type="checkbox" checked={uploadForm.studentIds.includes(s.id)}
                  onChange={()=>setUploadForm(f=>({...f,studentIds:f.studentIds.includes(s.id)?f.studentIds.filter(x=>x!==s.id):[...f.studentIds,s.id]}))}/>
                <span style={{marginLeft:6}}>{s.name}</span>
              </label>
            ))}
          </div>
          <label>Absence Start Date</label>
          <input className="inp" type="date" value={uploadForm.startDate} onChange={e=>setUploadForm(f=>({...f,startDate:e.target.value}))}/>
          <label>Absence End Date</label>
          <input className="inp" type="date" value={uploadForm.endDate} onChange={e=>setUploadForm(f=>({...f,endDate:e.target.value}))}/>
          <label>Note / Reason</label>
          <input className="inp" placeholder="e.g. Doctor visit, illness" value={uploadForm.note} onChange={e=>setUploadForm(f=>({...f,note:e.target.value}))}/>
          <label>File (PDF or Image)</label>
          <div>
            <input type="file" accept=".pdf,image/*" onChange={handleFileSelect} style={{fontSize:11}}/>
            {uploadForm.fileName&&<div style={{fontSize:11,color:"var(--grn)",marginTop:4}}>✓ {uploadForm.fileName}</div>}
          </div>
        </div>
        <div className="mda">
          <button className="bg" onClick={()=>{setShowUpload(false);setUploadError("");}}>Cancel</button>
          <button className="bp" onClick={saveExcuseFile}>Save Document</button>
        </div>
      </div></div>}
      {showMonthly&&<div className="mo"><div className="md" style={{maxWidth:700}}>
        <div className="mdt">📋 Monthly Attendance Report — Iowa Compliance</div>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:14}}>
          <label style={{fontSize:11}}>Month:</label>
          <input className="ins" type="month" value={reportMonth} onChange={e=>setReportMonth(e.target.value)}/>
          <button className="bp" style={{fontSize:11}} onClick={()=>window.print()}>🖨️ Print</button>
        </div>
        <div id="monthly-report" style={{fontSize:11}}>
          <div style={{textAlign:"center",marginBottom:12,borderBottom:"1px solid var(--br)",paddingBottom:8}}>
            <div style={{fontSize:14,fontWeight:700}}>Empower Iowa - Elim Springs Campus</div>
            <div>Monthly Attendance Record — {new Date(reportMonth+"-15").toLocaleString("en-US",{month:"long",year:"numeric"})}</div>
            <div style={{fontSize:10,color:"var(--t3)"}}>Iowa Code §279.10 · SF2435 Compliance · Generated {fmt(today())}</div>
          </div>
          {state.students.map(s=>{
            const [y,m]=reportMonth.split("-").map(Number);
            const daysInMonth=new Date(y,m,0).getDate();
            const schoolDays=[];
            for(let d=1;d<=daysInMonth;d++){
              const ds=y+"-"+String(m).padStart(2,"0")+"-"+String(d).padStart(2,"0");
              const dow=new Date(ds+"T12:00:00").getDay();
              if(dow<1||dow>5) continue; // skip weekends
              const isCancelDay=(state.specialDays||[]).some(sp=>sp.type==="cancel"&&ds>=sp.startDate&&ds<=sp.endDate);
              if(isCancelDay) continue; // skip cancellations
              schoolDays.push(ds);
            }
            const recs=state.attendance[s.id]||[];
            const present=schoolDays.filter(d=>recs.find(r=>r.date===d&&(r.status==="present"||r.status==="excused"))).length;
            const absent=schoolDays.filter(d=>recs.find(r=>r.date===d&&r.status==="absent")).length;
            const excused=schoolDays.filter(d=>recs.find(r=>r.date===d&&r.status==="excused")).length;
            const tardy=schoolDays.filter(d=>recs.find(r=>r.date===d&&r.status==="tardy")).length;
            const hrs=Math.round(hrsAtt(recs.filter(r=>r.date>=reportMonth+"-01"&&r.date<=reportMonth+"-31"),state.sy));
            const nonExemptAbs=absent; // all absences non-exempt unless coded excused
            const yTDrecs=recs.filter(r=>r.date>=(state.sy?.startDate||"")&&r.date<=today());
            // Count actual school days elapsed (weekdays minus cancellations) for accurate pct
            let yTDschoolDays=0;
            {const syS=new Date((state.sy?.startDate||today())+"T12:00:00");
             const yTDend=new Date(today()+"T12:00:00");
             const syE=new Date((state.sy?.endDate||today())+"T12:00:00");
             const iter=new Date(syS);
             while(iter<=yTDend&&iter<=syE){
               const ds2=iter.toISOString().slice(0,10);
               const dow2=iter.getDay();
               const isCancel=(state.specialDays||[]).some(sp=>sp.type==="cancel"&&ds2>=sp.startDate&&ds2<=sp.endDate);
               if(dow2>=1&&dow2<=5&&!isCancel) yTDschoolDays++;
               iter.setDate(iter.getDate()+1);
             }}
            const yTDnonExempt=yTDrecs.filter(r=>r.status==="absent").length;
            const chronPct=yTDschoolDays?Math.round((yTDnonExempt/yTDschoolDays)*100):0;
            return (
              <div key={s.id} style={{marginBottom:14,padding:10,border:"1px solid var(--br)",borderRadius:7}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{fontWeight:600}}>{s.name} — {s.gradeLevel}</span>
                  <span style={{color:chronPct>=10?"var(--red)":chronPct>=8?"var(--yel)":"var(--grn)"}}>
                    YTD Non-Exempt Absences: {yTDnonExempt} ({chronPct}%){chronPct>=10?" ⚠️ CHRONIC":""}
                  </span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(28px,1fr))",gap:2,marginBottom:8}}>
                  {schoolDays.map(d=>{
                    const rec=recs.find(r=>r.date===d);
                    const st=rec?.status||"none";
                    const col=st==="present"?"var(--grn)":st==="excused"?"var(--pur)":st==="absent"?"var(--red)":st==="tardy"?"var(--yel)":"var(--br)";
                    const day=new Date(d+"T12:00:00").getDate();
                    return <div key={d} title={d+" — "+st} style={{textAlign:"center",padding:"3px 0",borderRadius:3,background:col+"22",border:"1px solid "+col,fontSize:9,color:col,fontWeight:600}}>{day}</div>;
                  })}
                </div>
                <div style={{display:"flex",gap:16,fontSize:10,color:"var(--t2)"}}>
                  <span>Present: <strong>{present}</strong></span>
                  <span>Excused: <strong>{excused}</strong></span>
                  <span>Absent: <strong>{absent}</strong></span>
                  <span>Tardy: <strong>{tardy}</strong></span>
                  <span>Hours: <strong>{hrs}</strong></span>
                </div>
              </div>
            );
          })}
          <div style={{fontSize:10,color:"var(--t3)",marginTop:8}}>Legend: <span style={{color:"var(--grn)"}}>■ Present</span>  <span style={{color:"var(--pur)"}}>■ Excused</span>  <span style={{color:"var(--red)"}}>■ Absent</span>  <span style={{color:"var(--yel)"}}>■ Tardy</span>  <span style={{color:"var(--br)"}}>■ No record</span></div>
          <div style={{fontSize:10,color:"var(--t3)",marginTop:4}}>Per Iowa SF2435: Chronic absenteeism = ≥10% non-exempt absences. Students approaching 10% are flagged. Excused absences (medical, IEP, religious, court) do not count toward chronic absenteeism threshold.</div>
        </div>
        <div className="mda"><button className="bg" onClick={()=>setShowMonthly(false)}>Close</button></div>
      </div></div>}
      {spDay.length>0&&<div className="sepbanner">{spDay.map(d=><span key={d.id}>{d.type==="break"?"🎉":"⏰"} {d.note}{d.startDate!==d.endDate?" ("+fmt(d.startDate)+" – "+fmt(d.endDate)+")":""}</span>)}</div>}

      {!syStart&&<div style={{background:"rgba(251,191,36,.1)",border:"1px solid rgba(251,191,36,.3)",borderRadius:7,padding:"9px 12px",fontSize:12,color:"var(--yel)",marginBottom:12}}>
        ⚠️ No school year dates set. Go to <strong>Settings → School Year Configuration</strong> to set start and end dates — this enables accurate attendance projections.
      </div>}
      {outsideYear&&<div style={{background:"rgba(248,113,113,.08)",border:"1px solid rgba(248,113,113,.25)",borderRadius:7,padding:"9px 12px",fontSize:12,color:"var(--red)",marginBottom:12}}>
        ⚠️ Selected date ({fmt(date)}) is outside the school year ({fmt(syStart)} – {fmt(syEnd)}).
      </div>}
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        {state.students.map(s=>{
          const recs=(state.attendance[s.id]||[]).filter(r=>r&&r.date);
          const tot=hrsAtt(recs,state.sy);
          const days=recs.filter(r=>r.date>=( state.sy?.startDate||"")&&r.date<=(state.sy?.endDate||"9999")).length;
          // Chronic absenteeism compares what has actually happened so far:
          // absences up to today over school days elapsed to date. Counting the
          // whole year's absences against zero elapsed days produced >100%.
          const t3=today();
          const absNonExempt=recs.filter(r=>r.status==="absent"&&r.date>=(state.sy?.startDate||"")&&r.date<=t3).length;
          let daysElapsed=0;
          {const DOW2={"Mon":1,"Tue":2,"Wed":3,"Thu":4,"Fri":5,"Sat":6,"Sun":0};
           const sched2=state.sy?.scheduledDays||DAYS;
           const syS2=new Date((state.sy?.startDate||t3)+"T12:00:00");
           const now2=new Date(t3+"T12:00:00");
           const syE2=new Date((state.sy?.endDate||t3)+"T12:00:00");
           const it2=new Date(syS2);
           while(it2<=now2&&it2<=syE2){
             const ds3=it2.toISOString().slice(0,10);
             const off2=(state.specialDays||[]).some(sp=>(sp.type==="cancel"||sp.type==="break")&&ds3>=sp.startDate&&ds3<=sp.endDate);
             if(sched2.some(d=>DOW2[d]===it2.getDay())&&!off2) daysElapsed++;
             it2.setDate(it2.getDate()+1);
           }}
          // Need a meaningful sample before flagging anyone.
          if(daysElapsed<10) return null;
          const chronPct=Math.min(100,Math.round((absNonExempt/daysElapsed)*100));
          if(chronPct<8) return null;
          return <div key={s.id} style={{fontSize:11,background:"rgba(248,113,113,.07)",border:"1px solid rgba(248,113,113,.2)",borderRadius:6,padding:"5px 10px",color:"var(--red)"}}>
            ⚠️ {s.name}: {chronPct}% non-exempt absences {chronPct>=10?"(CHRONICALLY ABSENT)":"(approaching 10%)"}
          </div>;
        })}
      </div>
      <div style={{fontSize:11,color:"var(--t3)",marginBottom:10,paddingLeft:2}}>
        {syStart&&syEnd&&<span>School year: <strong style={{color:"var(--t1)"}}>{fmt(syStart)} – {fmt(syEnd)}</strong> · </span>}Iowa minimum: <strong style={{color:"var(--t1)"}}>{minHrs} hrs/year</strong> · School day: <strong style={{color:"var(--t1)"}}>{hpd}h</strong> · Click hours to adjust. Click name to view log.
        <span style={{marginLeft:8,color:"var(--acc)",opacity:.7}}>· Projections update as you change the date above.</span>
      </div>

      {isMobile ? (
        // ── Mobile: card-per-student layout ──
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {state.students.map(s=>{
            const recs=(state.attendance[s.id]||[]).filter(r=>r&&r.date);
            const dr=recs.find(r=>r.date===date);
            const tot=hrsAtt(recs,state.sy);
            const perf=Math.round(tot+projPerfect(state.sy,state.specialDays));
            const rated=Math.round(tot+projWithRate(state.sy,state.specialDays,recs));
            const perfOk=perf>=minHrs, ratedOk=rated>=minHrs;
            return (
              <div key={s.id} className="card" style={{padding:12}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                  <button style={{background:"none",border:"none",cursor:"pointer",color:"var(--acc)",fontFamily:"inherit",fontSize:13,fontWeight:700,padding:0,textDecoration:"underline dotted"}}
                    onClick={()=>setShowLog(s.id)}>{s.name}</button>
                  <span style={{fontSize:10,color:"var(--t3)"}}>{s.gradeLevel}</span>
                </div>
                <div style={{display:"flex",gap:5,marginBottom:10,flexWrap:"wrap"}}>
                  {[["present","sp","✓"],["absent","sa","✗"],["excused","se","✓E"],["tardy","st","⏰"]].map(([st,cls,ico])=>(
                    <button key={st} className={"stb "+cls+(dr?.status===st?" on":"")} onClick={()=>setAtt(s.id,st)}>{ico} {st}</button>
                  ))}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,fontSize:11}}>
                  <div style={{background:"var(--bg)",borderRadius:6,padding:"6px 8px"}}>
                    <div style={{color:"var(--t3)",fontSize:9,marginBottom:2}}>TODAY</div>
                    {dr?(editHours?.sid===s.id?(
                      <span style={{display:"flex",gap:3}}>
                        <input className="inx" type="number" style={{width:36}} value={editHours.val} onChange={e=>setEditHours(h=>({...h,val:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&saveHours(s.id,editHours.val)}/>
                        <button className="bx p" onClick={()=>saveHours(s.id,editHours.val)}>✓</button>
                      </span>
                    ):(
                      <span style={{cursor:"pointer",color:"var(--acc)",textDecoration:"underline dotted"}} onClick={()=>setEditHours({sid:s.id,val:dr.hours})}>{dr.hours}h</span>
                    )):"—"}
                  </div>
                  <div style={{background:"var(--bg)",borderRadius:6,padding:"6px 8px"}}>
                    <div style={{color:"var(--t3)",fontSize:9,marginBottom:2}}>YEAR TOTAL</div>
                    <span style={{fontFamily:"monospace"}}>{Math.round(tot)}h</span>
                  </div>
                  <div style={{background:"var(--bg)",borderRadius:6,padding:"6px 8px"}}>
                    <div style={{color:"var(--t3)",fontSize:9,marginBottom:2}}>PROJ (RATE)</div>
                    <span style={{color:ratedOk?"var(--grn)":rated<minHrs-WARN_THRESHOLD?"var(--red)":"var(--yel)",fontFamily:"monospace"}}>{rated}h</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      <div className="att">
        <div className="ath"><div>Student</div><div>Status</div><div>Today's Hrs</div><div>Year Total</div><div>Proj (perfect att.)</div><div>Proj (by absence rate)</div></div>
        {state.students.map(s=>{
          const recs=(state.attendance[s.id]||[]).filter(r=>r&&r.date);
          const dr=recs.find(r=>r.date===date);
          // Only count records up to and including the selected date
          const tot=hrsAtt(recs,state.sy);
          const perf=Math.round(tot+projPerfect(state.sy,state.specialDays));
          const rated=Math.round(tot+projWithRate(state.sy,state.specialDays,recs));
          const perfOk=perf>=minHrs, ratedOk=rated>=minHrs;
          return (
            <div key={s.id} className="atr">
              <div style={{display:"flex",alignItems:"center",gap:8,fontWeight:500}}>
                <div className="av avs">{s.name[0]}</div>
                <button style={{background:"none",border:"none",cursor:"pointer",color:"var(--acc)",fontFamily:"inherit",fontSize:12,fontWeight:600,padding:0,textDecoration:"underline dotted"}}
                  onClick={()=>setShowLog(s.id)}>{s.name}</button>
              </div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {[["present","sp","✓"],["absent","sa","✗"],["tardy","st","⏰"]].map(([st,cls,ico])=>(
                  <button key={st} className={"stb "+cls+(dr?.status===st?" on":"")} onClick={()=>setAtt(s.id,st)}>{ico} {st}</button>
                ))}
              </div>
              <div style={{fontSize:11}}>
                {dr?(
                  editHours?.sid===s.id?(
                    <span style={{display:"flex",gap:4,alignItems:"center"}}>
                      <input className="inx" type="number" style={{width:44}} value={editHours.val}
                        onChange={e=>setEditHours(h=>({...h,val:e.target.value}))}
                        onKeyDown={e=>e.key==="Enter"&&saveHours(s.id,editHours.val)}/>
                      <button className="bx p" onClick={()=>saveHours(s.id,editHours.val)}>✓</button>
                      <button className="bx" onClick={()=>setEditHours(null)}>✗</button>
                    </span>
                  ):(
                    <span style={{cursor:"pointer",color:"var(--acc)",textDecoration:"underline dotted"}}
                      title="Click to edit hours" onClick={()=>setEditHours({sid:s.id,val:dr.hours})}>
                      {dr.hours}h
                    </span>
                  )
                ):"—"}
              </div>
              <div style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>{Math.round(tot)}h</div>
              <div style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:perfOk?"var(--grn)":"var(--red)"}}>{perf}h {perfOk?"✓":"⚠️"}</div>
              <div style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:ratedOk?"var(--grn)":rated<minHrs-WARN_THRESHOLD?"var(--red)":"var(--yel)"}}>{rated}h {ratedOk?"✓":rated<minHrs-WARN_THRESHOLD?"⚠️":"~"}</div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

// ─── BEHAVIOR ─────────────────────────────────────────────────────────────────
function BehaviorHistoryModal({sid,state,onClose}) {
  const hs=state.students.find(x=>x.id===sid);
  const logs=(state.behavior[sid]||[]).filter(l=>l.incident).sort((a,b)=>b.date>a.date?1:-1);
  const mdnLogs=(state.behavior[sid]||[]).filter(l=>l.score).sort((a,b)=>b.date>a.date?1:-1);
  const isMDNStu=isMDN(hs?.gradeLevel,state.sy?.mdnCutoff);
  return (
    <div className="mo"><div className="md" style={{maxWidth:520}}>
      <div className="mdt">Behavior History — {hs?.name}</div>
      {isMDNStu?(
        <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:400,overflowY:"auto"}}>
          {!mdnLogs.length&&<p className="emp">No behavior scores recorded yet.</p>}
          {mdnLogs.map(l=>(
            <div key={l.id} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 9px",background:"var(--bg)",borderRadius:6,fontSize:12}}>
              <span style={{color:"var(--t3)",width:90,flexShrink:0}}>{fmt(l.date)}</span>
              <span style={{color:"var(--yel)",WebkitTextStroke:"1px #000"}}>{Array(l.score).fill("★").join("")}{Array(5-l.score).fill("☆").join("")}</span>
              <span style={{color:"var(--t2)",flex:1,fontSize:11}}>{l.comment||""}</span>
            </div>
          ))}
        </div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:400,overflowY:"auto"}}>
          {!logs.length&&<p className="emp" style={{color:"var(--grn)"}}>✓ No incidents recorded for this student.</p>}
          {logs.map(l=>(
            <div key={l.id} style={{padding:"8px 10px",background:"var(--bg)",borderRadius:6,fontSize:12,borderLeft:"3px solid var(--red)"}}>
              <div style={{fontWeight:600,marginBottom:2}}>{fmt(l.date)}</div>
              {l.desc&&<div style={{color:"var(--t2)",fontSize:11}}>{l.desc}</div>}
            </div>
          ))}
        </div>
      )}
      <div className="mda"><button className="bg" onClick={onClose}>Close</button></div>
    </div></div>
  );
}

function Behavior({state,upd,isMobile}) {
  const [date,setDate]=useState(today);
  const [inc,setInc]=useState({sid:"",desc:"",cons:"",next:""});
  const [showInc,setShowInc]=useState(false);
  const [showHistory,setShowHistory]=useState(null); // studentId

  const saveBeh=(sid,score,comment)=>{
    upd(p=>{
      const logs=p.behavior[sid]||[];
      const idx=logs.findIndex(l=>l.date===date);
      const rec={id:uid(),date,score,comment:comment||""};
      return {...p,behavior:{...p.behavior,[sid]:idx>=0?logs.map((l,i)=>i===idx?{...l,...rec}:l):[...logs,rec]}};
    });
  };

  return (
    <div className="pg">
      <div className="ph"><div className="ptit">Behavior Log</div><input className="ins" type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
      {showInc&&<div className="mo"><div className="md">
        <div className="mdt">Incident Report</div>
        <div className="fg">
          <label>Student</label><select className="inp" value={inc.sid} onChange={e=>setInc(f=>({...f,sid:e.target.value}))}><option value="">Select student</option>{state.students.filter(s=>!isMDN(s.gradeLevel,state.sy?.mdnCutoff)).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <label>Description</label><textarea className="inp" rows={3} value={inc.desc} onChange={e=>setInc(f=>({...f,desc:e.target.value}))} placeholder="Describe the incident..."/>
          <label>Consequences</label><textarea className="inp" rows={2} value={inc.cons} onChange={e=>setInc(f=>({...f,cons:e.target.value}))}/>
          <label>Next Steps</label><textarea className="inp" rows={2} value={inc.next} onChange={e=>setInc(f=>({...f,next:e.target.value}))}/>
        </div>
        <div className="mda">
          <button className="bg" onClick={()=>setShowInc(false)}>Cancel</button>
          <button className="bp" onClick={()=>{
            const s=state.students.find(st=>st.id===inc.sid); if(!s) return;
            const par=getParentsForStudent(state.users,s.id)[0];
            const email=par?.email||s.parentEmail||"";
            const teacherUser=state.users.find(u=>u.role==="teacher");
            const m="Dear Parent/Guardian of "+s.name+",\n\nI am writing to inform you of a behavioral incident on "+fmt(date)+".\n\nIncident:\n"+inc.desc+"\n\nConsequences:\n"+inc.cons+"\n\nNext Steps:\n"+inc.next+"\n\nSincerely,\n"+TEACHER.name;
            window.open("mailto:"+email+"?subject="+encodeURIComponent("Behavior Report - "+s.name)+"&body="+encodeURIComponent(m));
            setShowInc(false);
          }}>📧 Send to Parent</button>
        </div>
      </div></div>}
      {showHistory&&<BehaviorHistoryModal sid={showHistory} state={state} onClose={()=>setShowHistory(null)}/>}
      <div className={"bgrid"+(isMobile?" mob1col":"")}>
        {state.students.map(s=>{
          const mdn=isMDN(s.gradeLevel,state.sy?.mdnCutoff);
          const dl=(state.behavior[s.id]||[]).find(l=>l.date===date);
          return (
            <div key={s.id} className="bc">
              <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:12,paddingBottom:10,borderBottom:"1px solid var(--br)"}}>
                <div className="av avs">{s.name[0]}</div>
                <div style={{flex:1}}><div style={{fontSize:12,fontWeight:500}}>{s.name}</div><div style={{fontSize:10,color:"var(--t3)"}}>{s.gradeLevel}</div></div>
                <button className="bx" style={{fontSize:10}} onClick={()=>setShowHistory(s.id)}>History</button>
              </div>
              {mdn?(
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <div style={{display:"flex",gap:3}}>
                    {[1,2,3,4,5].map(n=>(
                      <button key={n} className={"starb"+((dl?.score||0)>=n?" on":"")} onClick={()=>saveBeh(s.id,n,dl?.comment)}>★</button>
                    ))}
                  </div>
                  <input className="ins" placeholder="Comment (optional)" value={dl?.comment||""} onChange={e=>saveBeh(s.id,dl?.score||3,e.target.value)} style={{width:"100%"}}/>
                </div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:7}}>
                  <label style={{display:"flex",alignItems:"center",gap:7,fontSize:12,cursor:"pointer"}}>
                    <input type="checkbox" checked={!!dl?.incident} onChange={e=>{
                      const nl={...(dl||{}),id:uid(),date,incident:e.target.checked};
                      const l2=(state.behavior[s.id]||[]).filter(l=>l.date!==date);
                      upd(p=>({...p,behavior:{...p.behavior,[s.id]:[...l2,nl]}}));
                      if(e.target.checked){setInc(f=>({...f,sid:s.id}));setShowInc(true);}
                    }}/>
                    Negative behavior occurred
                  </label>
                  {dl?.incident&&<button className="bs o" onClick={()=>{setInc(f=>({...f,sid:s.id}));setShowInc(true);}}>📧 File Incident Report</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── NOTES ────────────────────────────────────────────────────────────────────
function Notes({state,upd,isMobile}) {
  const [sel,setSel]=useState(null);
  const [ns,setNs]=useState(""); const [na,setNa]=useState("");
  const stu=sel?state.students.find(s=>s.id===sel):null;
  const sw=stu?(state.sw[stu.id]||{strengths:[],areas:[]}):{strengths:[],areas:[]};
  const add=(type,val)=>{
    if(!val.trim()||!stu) return;
    upd(p=>({...p,sw:{...p.sw,[stu.id]:{...sw,[type]:[...(sw[type]||[]),{id:uid(),text:val,date:today()}]}}}));
    if(type==="strengths") setNs(""); else setNa("");
  };
  const del=(type,id)=>upd(p=>({...p,sw:{...p.sw,[stu.id]:{...sw,[type]:sw[type].filter(i=>i.id!==id)}}}));
  return (
    <div className="pg">
      <div className="ptit" style={{marginBottom:18}}>Strengths & Areas for Improvement</div>
      <div style={{display:"grid",gridTemplateColumns:"190px 1fr",gap:14}}>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          {state.students.map(s=>(
            <button key={s.id} className={"ssb"+(sel===s.id?" on":"")} onClick={()=>setSel(s.id)}>
              <span>{s.name[0]}</span><div style={{fontSize:12}}>{s.name}</div>
            </button>
          ))}
        </div>
        {stu?<div className={"nps"+(isMobile?" mob1col":"")}>
          {[{type:"strengths",label:"💪 Strengths",color:"var(--grn)",val:ns,setVal:setNs,icon:"✨"},{type:"areas",label:"🎯 Areas for Improvement",color:"var(--acc)",val:na,setVal:setNa,icon:"🔧"}].map(({type,label,color,val,setVal,icon})=>(
            <div key={type} className="card">
              <div style={{fontSize:13,fontWeight:600,color,marginBottom:10}}>{label}</div>
              <div style={{display:"flex",gap:6,marginBottom:10}}>
                <input className="ins" style={{flex:1}} placeholder={"Add "+(type==="strengths"?"a strength":"an area")+"..."} value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add(type,val)}/>
                <button className="bs p" onClick={()=>add(type,val)}>Add</button>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                {(sw[type]||[]).map(i=>(
                  <div key={i.id} className="nitem">
                    <span>{icon} {i.text}</span>
                    <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                      <span style={{fontSize:10,color:"var(--t3)"}}>{fmt(i.date)}</span>
                      <button className="ib d" onClick={()=>del(type,i.id)}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>:<div className="empc">Select a student</div>}
      </div>
    </div>
  );
}

// ─── EVENTS ───────────────────────────────────────────────────────────────────
// Build a map of dueDate -> [{studentName, subjectName, assignmentName}]
// Format a score for display in due items modal
function fmtScore(item) {
  const s=item.score;
  if(s===null||s===undefined||s===""||s===EXEMPT) return null; // pending
  if(item.mdn) return s+" ("+( MDN_LBL[s]||s)+")";
  const pct=Math.round((parseFloat(s)/(item.maxScore||100))*100);
  return s+"/"+item.maxScore+" · "+pct+"% ("+getLetter(pct)+")";
}

function buildDueDateMap(state, filterStudentId) {
  const map={};
  const students=filterStudentId
    ?(state.students||[]).filter(s=>s.id===filterStudentId)
    :(state.students||[]);
  students.forEach(s=>{
    (state.subjects[s.id]||[]).forEach(sub=>{
      sub.assignments.filter(a=>a.dueDate||a.date).forEach(a=>{
        const key=a.dueDate||a.date;
        if(!map[key]) map[key]=[];
        const isMDNStu=isMDN(s.gradeLevel,state?.sy?.mdnCutoff);
        map[key].push({studentName:s.name,subjectName:sub.name,assignName:a.name,score:a.score,maxScore:a.maxScore||100,sid:s.id,dueDate:key,category:a.category||"homework",mdn:isMDNStu});
      });
    });
  });
  return map;
}

// Build quarter boundary markers and next-quarter-start items for calendar/list
function buildQuarterItems(sy, finalizedQuarters) {
  const items=[];
  const quarters=sy?.quarters||[];
  const fqMap=finalizedQuarters||{};
  quarters.forEach((q,i)=>{
    if(!q.startDate||!q.endDate) return;
    const finalized=!!fqMap[q.id];
    // Quarter start marker (for list view as an event)
    items.push({
      id:"qstart_"+q.id,
      name:q.label+" Begins",
      startDate:q.startDate,endDate:q.startDate,
      _type:"quarter",qType:"start",label:q.label,finalized,
    });
    // Quarter end boundary (for calendar rendering)
    items.push({
      id:"qend_"+q.id,
      name:q.label+" Ends",
      startDate:q.endDate,endDate:q.endDate,
      _type:"quarter",qType:"end",label:q.label,finalized,
    });
  });
  return items;
}

// One source of truth for calendar dot colors. On a phone the month grid shows
// only dots and the readable list sits underneath it, so the two have to agree —
// a dot and its list row must never be different colors.
const CAL_DOT={
  event:"var(--acc)",  break:"var(--acc)", cancel:"var(--red)", delay:"var(--yel)",
  qstart:"var(--grn)", qend:"var(--yel)",
  due:"var(--pur)",
};
/** Color for a calendar event or special day (break / cancellation / delay). */
function calDotEvent(e){
  if(e._type!=="special") return CAL_DOT.event;
  return CAL_DOT[e.spType]||CAL_DOT.event;
}
/**
 * Color for schoolwork due on a day. Tests and homework share one color on
 * purpose: a 6px dot is too small to read a second purple against, and the
 * list beneath the grid names each item anyway.
 */
function calDotDue(){ return CAL_DOT.due; }
/** Color for a quarter boundary. */
function calDotQuarter(q){ return q.qType==="end"?CAL_DOT.qend:CAL_DOT.qstart; }

/**
 * Events and special days (breaks, cancellations, delays) as one display list.
 * A school that enters "Thanksgiving Break" as both an event and a break day
 * would otherwise see it twice. The special day wins on type — that is what
 * decides the color and whether school is in session — but the event's id
 * comes along so the entry stays clickable.
 */
function calendarItems(events,specialDays){
  const key=e=>String(e.name||"").trim().toLowerCase()+"|"+e.startDate+"|"+e.endDate;
  const specials=new Map((specialDays||[]).filter(d=>d.startDate&&d.endDate).map(d=>{
    const s={id:d.id,_type:"special",spType:d.type,startDate:d.startDate,endDate:d.endDate,
      name:d.note||(d.type==="break"?"Break":d.type==="cancel"?"No school":d.type==="delay"?"Late start":"Special day")};
    return [key(s),s];
  }));
  const out=[];
  (events||[]).forEach(e=>{
    const dup=specials.get(key(e));
    if(dup){ specials.delete(key(e)); out.push({...dup,eventId:e.id,location:e.location}); }
    else out.push({...e,_type:"event",eventId:e.id});
  });
  specials.forEach(s=>out.push(s));
  return out;
}

function EventCalendarGrid({calMonth,state,setViewing,showAssignments,dueDateMap,onViewDue,quarterItems,showAttendance,attStudentId,onMarkAtt,onViewAtt,portalMode,compact}) {
  const [y,m]=calMonth.split("-").map(Number);
  const firstDay=new Date(y,m-1,1).getDay();
  const daysInMonth=new Date(y,m,0).getDate();
  const allItems=calendarItems(state.events,state.specialDays);
  const cells=[];
  for(let i=0;i<firstDay;i++) cells.push(null);
  for(let d=1;d<=daysInMonth;d++) cells.push(d);
  const dayStr=d2=>y+"-"+String(m).padStart(2,"0")+"-"+String(d2).padStart(2,"0");
  return (
    <div style={{marginBottom:20}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,minmax(0,1fr))",gap:2,marginBottom:4}}>
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><div key={d} style={{textAlign:"center",fontSize:10,color:"var(--t3)",fontWeight:600,padding:"4px 0"}}>{d}</div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,minmax(0,1fr))",gap:2}}>
        {cells.map((d,i)=>{
          if(!d) return <div key={"e"+i}/>;
          const ds=dayStr(d);
          const dayItems=allItems.filter(e=>ds>=e.startDate&&ds<=e.endDate);
          const dueItems=showAssignments?(dueDateMap||{})[ds]||[]:[];
          const isToday=ds===today();
          const totalItems=dayItems.length+(dueItems.length>0?1:0);
          const dow=new Date(ds+"T12:00:00").getDay();
          const isWeekend=dow===0||dow===6;
          const isCancelled=(state.specialDays||[]).some(sp=>sp.type==="cancel"&&ds>=sp.startDate&&ds<=sp.endDate);
          const isAttDay=!isWeekend&&!isCancelled;
          const isSchoolBreak=(state.specialDays||[]).some(sp=>sp.type==="break"&&ds>=sp.startDate&&ds<=sp.endDate);
          return (
            <div key={d} onClick={showAttendance&&isAttDay?(()=>onViewAtt&&onViewAtt(ds,attStudentId||null)):undefined} style={{minWidth:0,overflow:"hidden",minHeight:compact?44:64,background:isToday?"rgba(76,175,80,0.12)":showAttendance&&(isWeekend||isCancelled)?"rgba(0,0,0,0.15)":"var(--c1)",border:"1px solid "+(isToday?"rgba(76,175,80,0.4)":showAttendance&&isAttDay?"rgba(76,175,80,0.2)":"var(--br)"),borderRadius:6,padding:"4px 5px",opacity:showAttendance&&isWeekend?0.5:1,cursor:showAttendance&&isAttDay?"pointer":"default"}}>
              <div style={{fontSize:11,fontWeight:isToday?700:400,color:isToday?"var(--acc)":"var(--t2)",marginBottom:2}}>{d}</div>
              {compact&&(()=>{
                const qm=(quarterItems||[]).filter(q=>q.startDate===ds||q.endDate===ds);
                const dots=[
                  ...qm.map(q=>({k:"q"+q.id,c:calDotQuarter(q)})),
                  ...dayItems.map(e=>({k:"e"+e.id,c:calDotEvent(e)})),
                  ...dueItems.map((x,ix)=>({k:"d"+ix,c:calDotDue()})),
                ];
                if(!dots.length) return null;
                return <div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:2}}>
                  {dots.slice(0,6).map(dt=><span key={dt.k} style={{width:6,height:6,borderRadius:"50%",background:dt.c,display:"inline-block"}}/>)}
                </div>;
              })()}
              {!compact&&(quarterItems||[]).filter(q=>q.startDate===ds||q.endDate===ds).map(q=>(
                <div key={q.id} style={{fontSize:8,padding:"1px 3px",borderRadius:2,marginBottom:1,
                  background:q.qType==="end"?"rgba(251,191,36,0.15)":"rgba(74,222,128,0.15)",
                  color:q.qType==="end"?"var(--yel)":"var(--grn)",
                  fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}
                  title={q.name}>
                  {q.qType==="end"?"⬜ "+q.label+" End":"🟩 "+q.label+" Start"}
                </div>
              ))}
              {showAttendance&&attStudentId&&isAttDay&&(()=>{
                const rec=(state.attendance[attStudentId]||[]).find(r=>r.date===ds);
                const st=rec?.status;
                const color=st==="present"?"var(--grn)":st==="excused"?"var(--pur)":st==="absent"?"var(--red)":st==="tardy"?"var(--yel)":"var(--t3)";
                const label=st?st.charAt(0).toUpperCase():"?";
                const excuse=(state.excuseFiles||[]).find(f=>f.studentIds.includes(attStudentId)&&ds>=f.startDate&&ds<=f.endDate);
                return (
                  <div style={{display:"flex",alignItems:"center",gap:2}}>
                    <div style={{fontSize:8,padding:"1px 4px",borderRadius:2,background:color+"22",color,fontWeight:700}}>
                      {label}{excuse?"📎":""}
                    </div>
                  </div>
                );
              })()}
              {showAttendance&&!attStudentId&&isAttDay&&(()=>{
                // Summary: count absences for this day
                const absCount=(state.students||[]).filter(s=>{
                  const rec=(state.attendance[s.id]||[]).find(r=>r.date===ds);
                  return rec?.status==="absent";
                }).length;
                const tardyCount=(state.students||[]).filter(s=>{
                  const rec=(state.attendance[s.id]||[]).find(r=>r.date===ds);
                  return rec?.status==="tardy";
                }).length;
                if(!absCount&&!tardyCount) return null;
                return (
                  <div style={{fontSize:8,padding:"1px 4px",borderRadius:2,background:"rgba(248,113,113,0.15)",color:"var(--red)",fontWeight:600}}>
                    {absCount>0&&absCount+"A"}{tardyCount>0&&" "+tardyCount+"T"}
                  </div>
                );
              })()}
              {!compact&&dayItems.slice(0,dueItems.length>0?1:2).map(e=>(
                <div key={e.id} style={{fontSize:9,padding:"1px 4px",borderRadius:3,marginBottom:1,
                  background:e._type==="special"?(e.spType==="break"?"rgba(76,175,80,0.2)":e.spType==="cancel"?"rgba(248,113,113,0.2)":"rgba(251,191,36,0.2)"):"rgba(76,175,80,0.15)",
                  color:e._type==="special"?(e.spType==="break"?"var(--acc)":e.spType==="cancel"?"var(--red)":"var(--yel)"):"var(--t1)",
                  cursor:e.eventId?"pointer":"default",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}
                  onClick={()=>e.eventId&&setViewing(e.eventId)}
                  title={e.name}>
                  {e.name}
                </div>
              ))}
              {!compact&&dueItems.length>0&&(()=>{
                const hw=dueItems.filter(x=>x.category!=="test");
                const tests=dueItems.filter(x=>x.category==="test");
                if(portalMode&&dueItems.length<=3){
                  // Portal: show each item as its own pill
                  return <div style={{display:"flex",flexDirection:"column",gap:1}}>
                    {dueItems.map((item,ii)=>(
                      <div key={ii} style={{fontSize:8,padding:"1px 4px",borderRadius:3,
                        background:item.category==="test"?"rgba(167,139,250,0.2)":"rgba(76,175,80,0.2)",
                        color:item.category==="test"?"var(--pur)":"var(--acc)",
                        cursor:"pointer",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}
                        onClick={()=>onViewDue&&onViewDue(ds,[item])}
                        title={item.assignName+" — "+item.subjectName}>
                        {item.category==="test"?"📋":"📝"} {item.assignName.length>8?item.assignName.slice(0,7)+"…":item.assignName}
                      </div>
                    ))}
                  </div>;
                }
                if(portalMode&&dueItems.length>=4){
                  // Portal: separate summary pills for homework vs tests
                  return <div style={{display:"flex",flexDirection:"column",gap:1}}>
                    {hw.length>0&&<div style={{fontSize:8,padding:"1px 4px",borderRadius:3,
                      background:"rgba(76,175,80,0.2)",color:"var(--acc)",
                      cursor:"pointer",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}
                      onClick={()=>onViewDue&&onViewDue(ds,hw)}
                      title={hw.length+" homework item(s)"}>
                      📝 {hw.length} assignments
                    </div>}
                    {tests.length>0&&<div style={{fontSize:8,padding:"1px 4px",borderRadius:3,
                      background:"rgba(167,139,250,0.2)",color:"var(--pur)",
                      cursor:"pointer",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}
                      onClick={()=>onViewDue&&onViewDue(ds,tests)}
                      title={tests.length+" quiz/test(s)"}>
                      📋 {tests.length} tests
                    </div>}
                  </div>;
                }
                // Teacher mode: two-color pills by category
                return <div style={{display:"flex",flexDirection:"column",gap:1}}>
                  {hw.length>0&&<div style={{fontSize:9,padding:"1px 4px",borderRadius:3,
                    background:"rgba(76,175,80,0.2)",color:"var(--acc)",
                    cursor:"pointer",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}
                    onClick={()=>onViewDue&&onViewDue(ds,hw)}
                    title={hw.length+" homework item(s)"}>
                    📝 {hw.length}
                  </div>}
                  {tests.length>0&&<div style={{fontSize:9,padding:"1px 4px",borderRadius:3,
                    background:"rgba(167,139,250,0.2)",color:"var(--pur)",
                    cursor:"pointer",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}
                    onClick={()=>onViewDue&&onViewDue(ds,tests)}
                    title={tests.length+" quiz/test(s)"}>
                    📋 {tests.length}
                  </div>}
                </div>;
              })()}
              {totalItems>2&&dayItems.length>1&&<div style={{fontSize:9,color:"var(--t3)"}}>+{totalItems-2} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AttCalModal({state,upd,viewingAtt,onClose}) {
  const {date,sid}=viewingAtt;
  const hpd=state.sy?.hoursPerDay||6;
  const isAllStudents=!sid;
  const setAtt=(studentId,status)=>{
    const hours=status==="present"||status==="excused"?hpd:status==="tardy"?hpd*0.75:0;
    upd(p=>{
      const recs=p.attendance[studentId]||[];
      const idx=recs.findIndex(r=>r.date===date);
      const rec={id:uid(),date,status,hours};
      return {...p,attendance:{...p.attendance,[studentId]:idx>=0?recs.map((r,i)=>i===idx?rec:r):[...recs,rec]}};
    });
  };
  const markAllPresent=()=>{
    upd(p=>{
      const newAtt={...p.attendance};
      p.students.forEach(s=>{
        const recs=p.attendance[s.id]||[];
        const idx=recs.findIndex(r=>r.date===date);
        const rec={id:uid(),date,status:"present",hours:hpd};
        newAtt[s.id]=idx>=0?recs.map((r,i)=>i===idx?rec:r):[...recs,rec];
      });
      return {...p,attendance:newAtt};
    });
  };
  const students=sid?state.students.filter(s=>s.id===sid):state.students;
  return (
    <div className="mo"><div className="md" style={{maxWidth:500}}>
      <div className="mdt">📅 Attendance — {fmt(date)}</div>
      {isAllStudents&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <span style={{fontSize:11,color:"var(--t3)"}}>{students.length} students</span>
          <button className="bp" style={{fontSize:11}} onClick={markAllPresent}>✓ Mark All Present</button>
        </div>
      )}
      {!isAllStudents&&<div style={{fontSize:11,color:"var(--t3)",marginBottom:12}}>
        {state.students.find(s=>s.id===sid)?.name}
      </div>}
      <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:420,overflowY:"auto"}}>
        {students.map(s=>{
          const rec=(state.attendance[s.id]||[]).find(r=>r.date===date);
          const excuse=(state.excuseFiles||[]).find(f=>f.studentIds.includes(s.id)&&date>=f.startDate&&date<=f.endDate);
          return (
            <div key={s.id} style={{padding:"10px 12px",background:"var(--bg)",borderRadius:8,border:"1px solid "+(rec?.status?"var(--br2)":"var(--br)")}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontSize:13,fontWeight:600}}>{s.name}</span>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  {rec?.status&&<span style={{fontSize:10,fontWeight:600,
                    color:rec.status==="present"?"var(--grn)":rec.status==="excused"?"var(--pur)":rec.status==="absent"?"var(--red)":"var(--yel)"}}>
                    {rec.status.charAt(0).toUpperCase()+rec.status.slice(1)}
                  </span>}
                  <span style={{fontSize:10,color:"var(--t3)"}}>{s.gradeLevel}</span>
                </div>
              </div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:excuse?7:0}}>
                {[["present","sp","✓ Present"],["absent","sa","✗ Absent"],["excused","se","✓E Excused"],["tardy","st","⏰ Tardy"]].map(([st,cls,lbl])=>(
                  <button key={st} className={"stb "+cls+(rec?.status===st?" on":"")} onClick={()=>setAtt(s.id,st)}>{lbl}</button>
                ))}
              </div>
              {excuse&&<div style={{fontSize:10,display:"flex",alignItems:"center",gap:6,padding:"5px 8px",background:"rgba(76,175,80,0.08)",borderRadius:5,color:"var(--acc)"}}>
                <span>📎</span>
                <span style={{flex:1}}>{excuse.fileName}{excuse.note?" · "+excuse.note:""}</span>
                {excuse.dataUrl&&<a href={excuse.dataUrl} target="_blank" rel="noreferrer" style={{color:"var(--acc)",fontSize:10}}>View</a>}
              </div>}
            </div>
          );
        })}
      </div>
      <div className="mda">
        <button className="bg" onClick={onClose}>Close</button>
      </div>
    </div></div>
  );
}

function Events({state,upd}) {
  const [showAdd,setShowAdd]=useState(false);
  const [viewing,setViewing]=useState(null);
  const [calMonth,setCalMonth]=useState(new Date().getFullYear()+"-"+String(new Date().getMonth()+1).padStart(2,"0"));
  const [calSearch,setCalSearch]=useState("");
  const [showAssignments,setShowAssignments]=useState(true);
  const [viewingDue,setViewingDue]=useState(null);
  const [showAttendance,setShowAttendance]=useState(false);
  const [attStudentId,setAttStudentId]=useState(""); // "" = all/summary
  const [viewingAtt,setViewingAtt]=useState(null); // {date, studentId}
  const [form,setForm]=useState({name:"",location:"",startDate:today(),endDate:today(),assignedStudents:[],permissionSlip:false,description:""});
  const tog=id=>setForm(f=>({...f,assignedStudents:f.assignedStudents.includes(id)?f.assignedStudents.filter(s=>s!==id):[...f.assignedStudents,id]}));
  const add=()=>{
    if(!form.name.trim()) return;
    upd(p=>({...p,events:[...(p.events||[]),{id:uid(),...form,responses:{}}]}));
    setShowAdd(false);setForm({name:"",location:"",startDate:today(),endDate:today(),assignedStudents:[],permissionSlip:false,description:""});
  };
  const ev2=viewing?(state.events||[]).find(e=>e.id===viewing):null;

  // All items for calendar (events + special days) — no date filter
  const allItems=[
    ...(state.events||[]).map(e=>({...e,_type:"event"})),
    ...(state.specialDays||[]).filter(d=>d.startDate&&d.endDate).map(d=>({id:d.id,name:d.note||(d.type==="break"?"Break":"Special Day"),startDate:d.startDate,endDate:d.endDate,_type:"special",spType:d.type}))
  ];

  // Upcoming = today or future, sorted chronologically
  const thirtyDays=new Date(); thirtyDays.setDate(thirtyDays.getDate()+30);
  const thirtyStr=thirtyDays.toISOString().slice(0,10);
  const quarterItems=buildQuarterItems(state.sy,state.finalizedQuarters);
  // Add next quarter starts to upcoming list
  const qStartItems=quarterItems.filter(q=>q._type==="quarter"&&q.qType==="start"&&q.startDate>=today()&&q.startDate<=thirtyStr);
  const upcoming=[
    ...allItems.filter(e=>e.endDate>=today()&&e.startDate<=thirtyStr),
    ...qStartItems,
  ].sort((a,b)=>a.startDate>b.startDate?1:-1);

  // Due assignments in next 30 days for upcoming list
  const dueDateMap=buildDueDateMap(state);
  const upcomingDues=showAssignments?Object.entries(dueDateMap)
    .filter(([d])=>d>=today()&&d<=thirtyStr)
    .sort(([a],[b])=>a>b?1:-1):[];

  return (
    <div className="pg">
      <div className="ph">
        <div className="ptit">Events</div>
        <button className="bp" onClick={()=>setShowAdd(true)}>+ Add Event</button>
      </div>

      {/* ── ADD EVENT MODAL ── */}
      {showAdd&&<div className="mo"><div className="md">
        <div className="mdt">Add Event</div>
        <div className="fg">
          <label>Name</label><input className="inp" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
          <label>Location</label><input className="inp" value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))}/>
          <label>Start Date</label><input className="inp" type="date" value={form.startDate} onChange={e=>setForm(f=>({...f,startDate:e.target.value}))}/>
          <label>End Date</label><input className="inp" type="date" value={form.endDate} onChange={e=>setForm(f=>({...f,endDate:e.target.value}))}/>
          <label>Description</label><textarea className="inp" rows={2} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/>
          <label>Permission Slip</label><input type="checkbox" checked={form.permissionSlip} onChange={e=>setForm(f=>({...f,permissionSlip:e.target.checked}))}/>
        </div>
        <label>Students</label>
        <div>
          <div style={{marginBottom:6}}>
            <label className="cl" style={{fontWeight:600,color:"var(--acc)"}}>
              <input type="checkbox"
                checked={form.assignedStudents.length===state.students.length&&state.students.length>0}
                ref={el=>{if(el) el.indeterminate=form.assignedStudents.length>0&&form.assignedStudents.length<state.students.length;}}
                onChange={e=>setForm(f=>({...f,assignedStudents:e.target.checked?state.students.map(s=>s.id):[]}))}
              />All Students
            </label>
          </div>
          <div className="cg">{state.students.map(s=><label key={s.id} className="cl"><input type="checkbox" checked={form.assignedStudents.includes(s.id)} onChange={()=>tog(s.id)}/>{s.name}</label>)}</div>
        </div>
        <div className="mda">
          <button className="bg" onClick={()=>setShowAdd(false)}>Cancel</button>
          <button className="bp" onClick={add}>Save Event</button>
        </div>
      </div></div>}

      {/* ── EVENT DETAIL MODAL ── */}
      {ev2&&<div className="mo"><div className="md mdw">
        <div className="mdt">{ev2.name}</div>
        <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:14,fontSize:13}}>
          <div><strong>📍</strong> {ev2.location}</div>
          <div><strong>📅</strong> {fmt(ev2.startDate)} — {fmt(ev2.endDate)}</div>
          {ev2.description&&<div><strong>📝</strong> {ev2.description}</div>}
          {ev2.permissionSlip&&<div>
            <strong>📋 Permission Slips:</strong>
            {(ev2.assignedStudents||[]).map(sid=>{
              const s=state.students.find(st=>st.id===sid);
              const r=ev2.responses?.[sid];
              const rs=typeof r==="string"?r:r?.status;
              const rt=r?.ts?new Date(r.ts).toLocaleDateString("en-US",{month:"short",day:"numeric"}):null;
              return <div key={sid} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid var(--br)"}}>
                <span>{s?.name||sid}</span>
                <div style={{textAlign:"right"}}>
                  <span className={"bdg"+(rs==="authorized"?" bdgg":rs==="not_authorized"?" bdgr":"")}>{rs||"Pending"}</span>
                  {rt&&<div style={{fontSize:9,color:"var(--t3)",marginTop:2}}>{rt}</div>}
                </div>
              </div>;
            })}
          </div>}
        </div>
        <div className="mda"><button className="bg" onClick={()=>setViewing(null)}>Close</button></div>
      </div></div>}

      {/* ── CALENDAR (always visible, shows all events, searchable) ── */}
      <div className="card" style={{marginBottom:18}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
          <button className="bs" onClick={()=>{const[y,m]=calMonth.split("-").map(Number);const d=new Date(y,m-2,1);setCalMonth(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"));}}>‹</button>
          <span style={{fontSize:14,fontWeight:700,minWidth:140,textAlign:"center"}}>{new Date(calMonth+"-15").toLocaleString("en-US",{month:"long",year:"numeric"})}</span>
          <button className="bs" onClick={()=>{const[y,m]=calMonth.split("-").map(Number);const d=new Date(y,m,1);setCalMonth(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"));}}>›</button>
          <button className="bs" style={{marginLeft:4,fontSize:10}} onClick={()=>setCalMonth(()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");})}>Today</button>
          <input className="ins" placeholder="Search events..." value={calSearch} onChange={e=>setCalSearch(e.target.value)} style={{flex:1,minWidth:120}}/>
          {calSearch&&<button className="bx" onClick={()=>setCalSearch("")}>×</button>}
          <button className={"bs"+(showAssignments?" p":"")} style={{fontSize:10}} onClick={()=>setShowAssignments(v=>!v)}>
            {showAssignments?"📚 Hide":"📚 Assignments"}
          </button>
          <button className={"bs"+(showAttendance?" p":"")} style={{fontSize:10}} onClick={()=>setShowAttendance(v=>!v)}>
            {showAttendance?"📅 Hide":"📅 Attendance"}
          </button>
          {showAttendance&&<select className="ins" style={{fontSize:10,padding:"3px 6px"}} value={attStudentId} onChange={e=>setAttStudentId(e.target.value)}>
            <option value="">All Students (summary)</option>
            {state.students.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>}
        </div>
        {calSearch?(
          // Search results view
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {allItems.filter(e=>e.name.toLowerCase().includes(calSearch.toLowerCase())).length===0&&<p className="emp">No events match "{calSearch}"</p>}
            {allItems.filter(e=>e.name.toLowerCase().includes(calSearch.toLowerCase())).sort((a,b)=>a.startDate>b.startDate?1:-1).map(e=>(
              <div key={e.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",background:"var(--bg)",borderRadius:7,fontSize:12}}>
                <div>
                  <span style={{fontWeight:600}}>{e.name}</span>
                  {e._type==="special"&&<span className={"bdg"+(e.spType==="cancel"?" bdgr":e.spType==="delay"?" bdgy":"")} style={{marginLeft:6,fontSize:9}}>{e.spType}</span>}
                </div>
                <div style={{textAlign:"right",color:"var(--t3)",fontSize:11}}>
                  {fmt(e.startDate)}{e.startDate!==e.endDate?" – "+fmt(e.endDate):""}
                </div>
              </div>
            ))}
          </div>
        ):(
          // Calendar grid view
          <EventCalendarGrid calMonth={calMonth} state={state} setViewing={setViewing}
            showAssignments={showAssignments} dueDateMap={dueDateMap}
            onViewDue={(date,items)=>setViewingDue({date,items})}
            quarterItems={buildQuarterItems(state.sy,state.finalizedQuarters)}
            showAttendance={showAttendance} attStudentId={attStudentId||null}
onViewAtt={(date,sid)=>setViewingAtt({date,sid})} />
        )}
      </div>

      {/* ── UPCOMING EVENTS LIST (future only, chronological) ── */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div className="stit">Upcoming Events <span style={{fontSize:10,color:"var(--t3)",fontWeight:400}}>(next 30 days)</span></div>
        <button className={"bs"+(showAssignments?" p":"")} style={{fontSize:10}} onClick={()=>setShowAssignments(v=>!v)}>
          {showAssignments?"📚 Hide Assignments":"📚 View Assignments"}
        </button>
      </div>
      {!upcoming.length&&!upcomingDues.length&&<p className="emp">No upcoming events or special days in the next 30 days</p>}
      <div style={{display:"flex",flexDirection:"column",gap:9}}>
        {upcoming.map(e=>
          e._type==="quarter"?(
            <div key={e.id} className="ecard" style={{borderColor:e.qType==="start"?"rgba(74,222,128,0.3)":"rgba(251,191,36,0.3)"}}>
              <div style={{display:"flex",alignItems:"center",gap:14}}>
                <div className="edb" style={{background:e.qType==="start"?"rgba(74,222,128,0.1)":"rgba(251,191,36,0.1)"}}>
                  <div className="edm" style={{color:e.qType==="start"?"var(--grn)":"var(--yel)"}}>{new Date(e.startDate+"T12:00:00").toLocaleString("en-US",{month:"short"})}</div>
                  <div className="edd">{new Date(e.startDate+"T12:00:00").getDate()}</div>
                </div>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:e.qType==="start"?"var(--grn)":"var(--yel)"}}>
                    {e.qType==="start"?"🟩":"⬜"} {e.name}
                  </div>
                  <div style={{fontSize:11,color:"var(--t3)"}}>{fmt(e.startDate)}</div>
                </div>
              </div>
            </div>
          ):e._type==="special"?(
            <div key={e.id} className="ecard" style={{borderColor:e.spType==="break"?"rgba(76,175,80,.3)":e.spType==="cancel"?"rgba(248,113,113,.3)":"rgba(251,191,36,.3)"}}>
              <div style={{display:"flex",alignItems:"center",gap:14}}>
                <div className="edb" style={{background:e.spType==="break"?"rgba(76,175,80,.1)":e.spType==="cancel"?"rgba(248,113,113,.1)":"rgba(251,191,36,.1)"}}>
                  <div className="edm" style={{color:e.spType==="break"?"var(--acc)":e.spType==="cancel"?"var(--red)":"var(--yel)"}}>{new Date(e.startDate+"T12:00:00").toLocaleString("en-US",{month:"short"})}</div>
                  <div className="edd">{new Date(e.startDate+"T12:00:00").getDate()}</div>
                </div>
                <div>
                  <div style={{fontSize:13,fontWeight:600}}>{e.spType==="break"?"🎉":e.spType==="cancel"?"❌":"⏰"} {e.name}</div>
                  <div style={{fontSize:11,color:"var(--t3)"}}>{e.startDate===e.endDate?fmt(e.startDate):fmt(e.startDate)+" – "+fmt(e.endDate)}</div>
                  <span className={"bdg"+(e.spType==="break"?"":e.spType==="cancel"?" bdgr":" bdgy")}>{e.spType==="break"?"School Break":e.spType==="cancel"?"Cancellation":"Delay"}</span>
                </div>
              </div>
              <button className="bs r" onClick={()=>upd(p=>({...p,specialDays:p.specialDays.filter(d=>d.id!==e.id)}))}>Delete</button>
            </div>
          ):(
            <div key={e.id} className="ecard">
              <div style={{display:"flex",alignItems:"center",gap:14}}>
                <div className="edb">
                  <div className="edm">{new Date(e.startDate+"T12:00:00").toLocaleString("en-US",{month:"short"})}</div>
                  <div className="edd">{new Date(e.startDate+"T12:00:00").getDate()}</div>
                </div>
                <div>
                  <div style={{fontSize:13,fontWeight:600}}>{e.name}</div>
                  <div style={{fontSize:11,color:"var(--t3)"}}>📍 {e.location} · {e.assignedStudents?.length||0} student(s)</div>
                  {e.permissionSlip&&(()=>{
                    const total=(e.assignedStudents||[]).length;
                    const auth=Object.values(e.responses||{}).filter(r=>(typeof r==="string"?r:r?.status)==="authorized").length;
                    const dec=Object.values(e.responses||{}).filter(r=>(typeof r==="string"?r:r?.status)==="not_authorized").length;
                    return <span className="bdg bdgy">{"📋 "+auth+"/"+total+" authorized"+(dec>0?" · "+dec+" declined":"")}</span>;
                  })()}
                </div>
              </div>
              <div style={{display:"flex",gap:7}}>
                <button className="bs" onClick={()=>setViewing(e.id)}>View</button>
                <button className="bs r" onClick={()=>upd(p=>({...p,events:p.events.filter(ev=>ev.id!==e.id)}))}>Delete</button>
              </div>
            </div>
          )
        )}
      {upcomingDues.map(([date,items])=>(
        <div key={date} className="ecard" style={{borderColor:"rgba(167,139,250,0.3)",marginTop:9,cursor:"pointer"}} onClick={()=>setViewingDue({date,items})}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div className="edb" style={{background:"rgba(167,139,250,0.1)"}}>
              <div className="edm" style={{color:"var(--pur)"}}>{new Date(date+"T12:00:00").toLocaleString("en-US",{month:"short"})}</div>
              <div className="edd">{new Date(date+"T12:00:00").getDate()}</div>
            </div>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:"var(--pur)"}}>📚 Due Assignments</div>
              <div style={{fontSize:11,color:"var(--t3)"}}>{items.length} assignment(s) due · click for details</div>
            </div>
          </div>
        </div>
      ))}
      </div>


      {viewingAtt&&<AttCalModal state={state} upd={upd} viewingAtt={viewingAtt} onClose={()=>setViewingAtt(null)}/>}
      {/* Due Assignments Detail Modal */}
      {viewingDue&&<div className="mo"><div className="md" style={{maxWidth:500}}>
        <div className="mdt">{viewingDue.items[0]?.category==="test"?"📋 Quiz/Test — ":"📝 Homework — "}{fmt(viewingDue.date)}</div>
        <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:400,overflowY:"auto"}}>
          {viewingDue.items.map((item,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",background:"var(--bg)",borderRadius:7,fontSize:12}}>
              <div>
                <div style={{fontWeight:600}}>{item.assignName}</div>
                <div style={{fontSize:10,color:"var(--t3)"}}>{item.subjectName}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:11}}>{item.studentName}</div>
                <div style={{fontSize:10,color:fmtScore(item)?"var(--grn)":"var(--yel)",fontFamily:fmtScore(item)?"'JetBrains Mono',monospace":"inherit"}}>
                  {fmtScore(item)||"⏳ Pending"}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mda"><button className="bg" onClick={()=>setViewingDue(null)}>Close</button></div>
      </div></div>}
    </div>
  );
}

// ─── REPORTS ─────────────────────────────────────────────────────────────────
function YearSelector({tsel,state,transcriptYear,setTranscriptYear}) {
  if(!tsel) return null;
  const stuHistory=(state.history||[]).filter(h=>h.studentId===tsel).sort((a,b)=>b.archivedAt>a.archivedAt?1:-1);
  if(!stuHistory.length) return null;
  return (
    <div style={{marginTop:10}}>
      <div style={{fontSize:11,color:"var(--t3)",marginBottom:6}}>School Year</div>
      <select className="inp" value={transcriptYear} onChange={e=>setTranscriptYear(e.target.value)}>
        <option value="current">{"Current Year ("+(state.sy?.startDate?.slice(0,4)||"")+"–"+(state.sy?.endDate?.slice(0,4)||"")+")"}</option>
        {stuHistory.map(h=><option key={h.id} value={h.id}>{h.gradeLevel+(h.repeated?" (Repeat)":h.transferred?" (Transfer)":"")+" — "+h.schoolYear}</option>)}
      </select>
    </div>
  );
}

function Reports({state}) {
  const [rt,setRt]=useState("progress");
  const [sel,setSel]=useState(null);
  const [periods,setPeriods]=useState([{id:uid(),label:"Period 1",startDate:"",endDate:""}]);
  const [showPrint,setShowPrint]=useState(false);
  const [rdata,setRdata]=useState(null);
  const [tsel,setTsel]=useState(null);

  const updP=(id,f,v)=>setPeriods(p=>p.map(x=>x.id===id?{...x,[f]:v}:x));

  const gen=()=>{
    if(!sel) return;
    const s=state.students.find(st=>st.id===sel); if(!s) return;
    const mdn=isMDN(s.gradeLevel,state.sy?.mdnCutoff);
    const allS=state.subjects[s.id]||[];
    const sw2=state.sw[s.id]||{strengths:[],areas:[]};
    const att=state.attendance[s.id]||[];
    const beh=state.behavior[s.id]||[];
    const pd=periods.map(p=>{
      const sd=allS.map(sub=>{
        const asgn=sub.assignments.filter(a=>!p.startDate||!p.endDate||(a.date>=p.startDate&&a.date<=p.endDate));
        const gr=asgn.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined);
        const avg=mdn?mdnAvg(gr):pctAvg(gr);
        const sorted=asgn.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined&&a.score!==EXEMPT).sort((a,b)=>a.date>b.date?1:-1);
        // All assignments in this period (graded + ungraded) for completion weighting
        const allInPeriod=sub.assignments.filter(a=>!p.startDate||!p.endDate||(a.date>=p.startDate&&a.date<=p.endDate));
        // All graded assignments across ALL periods for line graph
        const allSorted=sub.assignments.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined&&a.score!==EXEMPT).sort((a,b)=>a.date>b.date?1:-1);
        return {id:sub.id,name:sub.name,emoji:sub.emoji,avg,assignments:sorted,allAssignments:allSorted,totalInPeriod:allInPeriod.length};
      });
      const ar=att.filter(r=>!p.startDate||!p.endDate||(r.date>=p.startDate&&r.date<=p.endDate));
      const br=beh.filter(l=>!p.startDate||!p.endDate||(l.date>=p.startDate&&l.date<=p.endDate));
      const bs=br.filter(b=>b.score);
      const incidents=br.filter(b=>b.incident).length;
      return {...p,sd,abs:ar.filter(r=>r.status==="absent").length,tar:ar.filter(r=>r.status==="tardy").length,avgB:bs.length?bs.reduce((s2,b)=>s2+b.score,0)/bs.length:null,incidentCount:incidents};
    });
    const tot=hrsAtt(att,state.sy);
    const minHrsR=state.sy?.minHrs||DEFAULT_MIN_HRS; setRdata({s,mdn,pd,sw:sw2,tot,mk:tot<minHrsR?minHrsR-tot:0,minHrs:minHrsR});
    setShowPrint(true);
  };
  const [transcriptYear,setTranscriptYear]=useState("current"); // "current" or archiveEntry.id
  const genT=()=>{
    if(!tsel) return;
    const s=state.students.find(st=>st.id===tsel); if(!s) return;
    const history=state.history||[];
    const archiveEntry=transcriptYear!=="current"
      ?history.find(h=>h.id===transcriptYear)
      :null;
    const usedGradeLevel=archiveEntry?archiveEntry.gradeLevel:s.gradeLevel;
    const usedSubs=archiveEntry
      ?(archiveEntry.snapshot?.subjects?.[tsel]||[])
      :(state.subjects[tsel]||[]);
    const isMDNStudent=isMDN(usedGradeLevel,state.sy?.mdnCutoff);
    const yearLabel=archiveEntry
      ?(archiveEntry.gradeLevel+" — "+archiveEntry.schoolYear)
      :(s.gradeLevel+" — "+(state.sy?.startDate?.slice(0,4)||"")+"–"+(state.sy?.endDate?.slice(0,4)||""));
    setRdata({
      type:"transcript",s,
      subs:usedSubs,
      gradeLevel:usedGradeLevel,
      quarter:yearLabel,
      ranges:[], // no date filtering — transcript always includes full year
      mdn:isMDNStudent,
      history,
      mdnCutoff:state.sy?.mdnCutoff,
      isArchived:!!archiveEntry,
      archivedYear:archiveEntry?.schoolYear,
      archiveEntryId:archiveEntry?.id,
      finalizedQuarters:archiveEntry?(archiveEntry.snapshot?.finalizedQuarters||{}):(state.finalizedQuarters||{}),
      transferred:archiveEntry?.transferred||false,
      transferDate:archiveEntry?.transferDate||"",
      transferSchool:archiveEntry?.transferSchool||"",
    });
    setShowPrint(true);
  };

  return (
    <div className="pg">
      {showPrint&&rdata&&rdata.type==="transcript"&&<TranscriptView d={rdata} onClose={()=>{setShowPrint(false);setRdata(null);}}/>}
      {showPrint&&rdata&&rdata.type!=="transcript"&&<ProgressView d={rdata} onClose={()=>{setShowPrint(false);setRdata(null);}}/>}
      {!showPrint&&<div>
      <div className="ptit" style={{marginBottom:18}}>Reports</div>
      <div className="rtabs">
        <button className={"rtab"+(rt==="progress"?" on":"")} onClick={()=>setRt("progress")}>Progress Report</button>
        <button className={"rtab"+(rt==="transcript"?" on":"")} onClick={()=>setRt("transcript")}>Transcript</button>
      </div>
      {rt==="progress"&&<div style={{maxWidth:560,display:"flex",flexDirection:"column",gap:18}}>
        <div className="card">
          <div className="stit">Select Student</div>
          <select className="inp" value={sel||""} onChange={e=>setSel(e.target.value)}>
            <option value="">— Select Student —</option>
            {state.students.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="card">
          <div className="stit">Reporting Periods</div>
          {(state.sy?.quarters||[]).some(q=>q.startDate&&q.endDate)&&<div style={{marginBottom:10}}>
            <div style={{fontSize:11,color:"var(--t3)",marginBottom:6}}>Quick-add from defined quarters:</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {(state.sy?.quarters||[]).filter(q=>q.startDate&&q.endDate).map(q=>(
                <button key={q.id} className="bs" style={{fontSize:10}} onClick={()=>{
                  if(!periods.some(p=>p.startDate===q.startDate&&p.endDate===q.endDate))
                    setPeriods(pp=>[...pp,{id:uid(),label:q.label,startDate:q.startDate,endDate:q.endDate}]);
                }}>{q.label}</button>
              ))}
            </div>
          </div>}
          {periods.map((p,i)=>(
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:7,marginBottom:8,flexWrap:"wrap"}}>
              <input className="ins" placeholder="Label" value={p.label} onChange={e=>updP(p.id,"label",e.target.value)} style={{width:90}}/>
              <input className="ins" type="date" value={p.startDate} onChange={e=>updP(p.id,"startDate",e.target.value)}/>
              <span style={{fontSize:11,color:"var(--t3)"}}>to</span>
              <input className="ins" type="date" value={p.endDate} onChange={e=>updP(p.id,"endDate",e.target.value)}/>
              {periods.length>1&&<button className="bx" style={{color:"var(--red)"}} onClick={()=>setPeriods(p2=>p2.filter(x=>x.id!==p.id))}>x</button>}
            </div>
          ))}
          <button className="bs" style={{marginTop:4}} onClick={()=>setPeriods(p=>[...p,{id:uid(),label:"Period "+(p.length+1),startDate:"",endDate:""}])}>+ Add Period</button>
        </div>
        <button className="bp" onClick={gen}>Generate Progress Report</button>
      </div>}
      {rt==="transcript"&&<div style={{maxWidth:560,display:"flex",flexDirection:"column",gap:18}}>
        <div className="card">
          <div className="stit">Select Student</div>
          <select className="inp" value={tsel||""} onChange={e=>{setTsel(e.target.value);setTranscriptYear("current");}}>
            <option value="">— Select Student —</option>
            {state.students.map(s=><option key={s.id} value={s.id}>{s.name+" ("+(isMDN(s.gradeLevel,state.sy?.mdnCutoff)?"MDN":"Letter")+")"}</option>)}
          </select>
          <YearSelector tsel={tsel} state={state} transcriptYear={transcriptYear} setTranscriptYear={setTranscriptYear}/>
        </div>
        <div className="card" style={{background:"rgba(76,175,80,0.05)",border:"1px solid rgba(76,175,80,0.2)"}}>
          <div style={{fontSize:12,color:"var(--acc)",marginBottom:4}}>📋 Full Year Transcript</div>
          <div style={{fontSize:11,color:"var(--t3)"}}>The transcript includes all graded assignments for the selected school year. For a quarter-specific progress report, use the Progress Report tab.</div>
        </div>
        <button className="bp" onClick={genT}>Generate Transcript</button>
      </div>}
      </div>}
    </div>
  );
}

function GradeLineChart({periods,subId,mdn}) {
  const firstSD=(periods[0]?.sd||[]).find(s=>s.id===subId);
  const allAsgns=(firstSD?.allAssignments)||[];
  if(!allAsgns.length) return null;

  const COLORS=["#4caf50","#34d399","#f59e0b","#f87171","#a78bfa","#fb923c"];
  const W=340,H=130,PAD_L=32,PAD_R=24,PAD_T=8,PAD_B=24;
  const chartW=W-PAD_L-PAD_R, chartH=H-PAD_T-PAD_B;
  const yMin=50,yMax=100;
  const toX=i=>PAD_L+(allAsgns.length<=1?chartW/2:i/(allAsgns.length-1)*chartW);
  const toY=pct=>PAD_T+chartH-((Math.min(Math.max(pct,yMin),yMax)-yMin)/(yMax-yMin)*chartH);

  // For each period, get total expected assignments (graded + ungraded)
  // and running quarter average per assignment
  const periodMeta=periods.map((p,pi)=>{
    const sd=(p.sd||[]).find(s=>s.id===subId);
    const total=sd?.totalInPeriod||0;
    return {pi,total,color:COLORS[pi%COLORS.length],label:p.label,startDate:p.startDate,endDate:p.endDate};
  });

  // Build projected final at each assignment point.
  // Each quarter with at least one grade counts equally (same as gradebook Projected Final).
  // Ungraded assignments within a quarter don't reduce its weight — they just aren't counted yet.
  const pts=allAsgns.map((a,i)=>{
    const pIdx=periods.findIndex(p=>p.startDate&&p.endDate&&a.date>=p.startDate&&a.date<=p.endDate);
    const color=pIdx>=0?COLORS[pIdx%COLORS.length]:"#94a3b8";
    // Quarter percentages so far (only quarters with at least one graded assignment)
    const qPcts=[];
    periods.forEach((p)=>{
      const periodAsgns=allAsgns.slice(0,i+1).filter(x=>p.startDate&&p.endDate&&x.date>=p.startDate&&x.date<=p.endDate);
      if(!periodAsgns.length) return;
      const earned=periodAsgns.reduce((s,x)=>s+(parseFloat(x.score)||0),0);
      const possible=periodAsgns.reduce((s,x)=>s+(x.maxScore||100),0);
      qPcts.push(possible>0?(earned/possible)*100:0);
    });
    const projFinal=qPcts.length>0?qPcts.reduce((s,p)=>s+p,0)/qPcts.length:0;
    return {x:i,pct:projFinal,date:a.date,name:a.name,color,pIdx};
  });

  const gridLines=[60,70,80,90,100];
  const pathD=pts.map((p,i)=>(i===0?"M":"L")+toX(i).toFixed(1)+","+toY(p.pct).toFixed(1)).join(" ");

  return(
    <svg width="100%" viewBox={"0 0 "+W+" "+H} style={{overflow:"visible"}}>
      {gridLines.map(g=>(
        <g key={g}>
          <line x1={PAD_L} y1={toY(g)} x2={W-PAD_R} y2={toY(g)} stroke="rgba(0,0,0,0.08)" strokeWidth="1"/>
          <text x={PAD_L-4} y={toY(g)+4} fontSize="8" fill="#64748b" textAnchor="end">{g}</text>
        </g>
      ))}
      {periods.map((p,pi)=>{
        if(!p.endDate) return null;
        const lastIdx=pts.reduce((best,pt,i)=>pt.pIdx===pi?i:best,-1);
        if(lastIdx<0||lastIdx>=pts.length-1) return null;
        const x=toX(lastIdx)+(toX(lastIdx+1)-toX(lastIdx))/2;
        return <line key={p.id} x1={x} y1={PAD_T} x2={x} y2={H-PAD_B} stroke={COLORS[pi%COLORS.length]} strokeWidth="1" strokeDasharray="3,2" opacity="0.5"/>;
      })}
      <path d={pathD} fill="none" stroke="#1a6a1a" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
      {pts.map((p,i)=>(
        <circle key={i} cx={toX(i)} cy={toY(p.pct)} r="3" fill={p.color} stroke="rgba(0,0,0,0.3)" strokeWidth="1">
          <title>{(periods[p.pIdx]?.label||"?")+": "+p.name+" ("+p.date+") — Projected "+Math.round(p.pct)+"%"}</title>
        </circle>
      ))}
      {pts.length>0&&(
        <text x={toX(pts.length-1)+4} y={toY(pts[pts.length-1].pct)+4} fontSize="9" fill="#1e293b" fontWeight="600">
          {Math.round(pts[pts.length-1].pct)+"%"}
        </text>
      )}
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H-PAD_B} stroke="rgba(0,0,0,0.2)" strokeWidth="1"/>
      <line x1={PAD_L} y1={H-PAD_B} x2={W-PAD_R} y2={H-PAD_B} stroke="rgba(0,0,0,0.2)" strokeWidth="1"/>
    </svg>
  );
}

function ProgressView({d,onClose}) {
  const {s,mdn,pd,sw,tot,mk}=d;
  return (
    <div style={{padding:24,background:"var(--bg)",minHeight:"100vh"}}>
      <div className="noprint" style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        <button className="bp" onClick={()=>{
          const content=document.getElementById("print-report-content");
          if(!content) return;
          const w=window.open("","_blank","width=800,height=900");
          w.document.write("<html><head><title>Progress Report</title><style>body{font-family:-apple-system,sans-serif;background:white;color:#111;padding:24px;max-width:780px;margin:0 auto;}table{width:100%;border-collapse:collapse;}th,td{padding:7px 10px;border-bottom:1px solid #ddd;font-size:12px;text-align:left;}th{background:#f5f5f5;font-size:10px;text-transform:uppercase;}.bdg{display:inline-block;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:600;background:#e8f5e9;color:#2e7d32;}.bdgr{background:#ffebee;color:#c62828;}.bdgy{background:#fff8e1;color:#f57f17;}h1{font-size:20px;margin-bottom:4px;}h2{font-size:14px;color:#555;margin-bottom:16px;}</style></head><body>");
          w.document.write(content.innerHTML);
          w.document.write("</body></html>");
          w.document.close();
          w.focus();
          setTimeout(()=>w.print(),500);
        }}>🖨️ Print</button>
        <button className="bg" onClick={onClose}>← Back</button>
        <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:8,fontSize:11,color:"var(--t3)"}}>
          <span>Subjects per page:</span>
          <select id="subPerPage" className="ins" style={{width:60}} defaultValue="20">
            {[5,10,15,20].map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <div id="print-report-content" className="prpt">
        <div className="rh">
          <div style={{fontSize:11,color:"var(--t3)",marginBottom:6}}>🏫 Empower Iowa - Elim Springs Campus</div>
          <div style={{fontSize:22,fontWeight:700,marginBottom:6}}>Progress Report</div>
          <div style={{fontSize:14,marginBottom:3}}><strong>{s.name}</strong> · {s.gradeLevel}{d.quarter?" · "+d.quarter:""}</div>
          <div style={{fontSize:11,color:"var(--t3)"}}>Generated: {fmt(today())}</div>
        </div>
        {!mdn&&pd.length>1&&<div style={{marginBottom:22,paddingBottom:22,borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
          <div style={{fontSize:14,fontWeight:700,color:"var(--acc)",marginBottom:14}}>📊 Period Comparison</div>
          <MultiPeriodChart periods={pd}/>
        </div>}
        {!mdn&&<div style={{marginBottom:22,paddingBottom:22,borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
          <div style={{fontSize:14,fontWeight:700,color:"var(--acc)",marginBottom:14}}>📈 Grade Trajectory</div>
          <div style={{fontSize:10,color:"var(--t3)",marginBottom:12}}>
            Cumulative quarter grade after each graded assignment.{pd.length>1?" One line per period.":""}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {(pd[0].sd||[]).map(sub=>(
              <div key={sub.id}>
                <div style={{fontSize:11,color:"#94a3b8",marginBottom:4}}>{sub.emoji} {sub.name}</div>
                <GradeLineChart periods={pd} subId={sub.id} mdn={mdn}/>
              </div>
            ))}
          </div>
          {pd.length>1&&<div style={{display:"flex",gap:14,flexWrap:"wrap",marginTop:10}}>
            {pd.map((p,i)=>{
              const COLORS2=["#4caf50","#34d399","#f59e0b","#f87171","#a78bfa","#fb923c"];
              return <span key={p.id} style={{fontSize:10,color:"#94a3b8",display:"flex",alignItems:"center",gap:5}}>
                <span style={{width:16,height:2,background:COLORS2[i%COLORS2.length],display:"inline-block",borderRadius:1}}/>
                {p.label}
              </span>;
            })}
          </div>}
        </div>}
        {pd.map((p,pi)=>(
          <div key={p.id} style={{marginBottom:22,paddingBottom:22,borderBottom:pi<pd.length-1?"1px solid rgba(255,255,255,0.08)":"none"}}>
            <div style={{fontSize:14,fontWeight:700,color:"var(--acc)",marginBottom:14}}>{p.label}{p.startDate&&p.endDate?(" ("+fmt(p.startDate)+" – "+fmt(p.endDate)+")"):"" }</div>
            {mdn&&<div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:600,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".05em",marginBottom:10}}>📊 Grades</div>
              <div style={{display:"flex",alignItems:"center",gap:20,justifyContent:"center"}}>
                <Radar subs={p.sd} sz={190}/>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {p.sd.map(sub=>{
                    const lbl=sub.avg!==null?["N","D","M"][Math.round(sub.avg)-1]||"N":"—";
                    return <div key={sub.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:14,fontSize:11}}>
                      <span>{sub.emoji} {sub.name}</span>
                      <span className={"bdg"+(lbl==="M"?" bdgg":lbl==="N"?" bdgr":"")}>{sub.avg!==null?lbl+" ("+sub.avg.toFixed(1)+")":""}</span>
                    </div>;
                  })}
                </div>
              </div>
            </div>}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={{background:"rgba(255,255,255,0.04)",borderRadius:8,padding:12,fontSize:12}}>
                <div style={{fontSize:11,fontWeight:600,color:"var(--t3)",marginBottom:6}}>📅 Attendance</div>
                <div>Absences: <strong>{p.abs}</strong> &nbsp; Tardies: <strong>{p.tar}</strong></div>
              </div>
              <div style={{background:"rgba(255,255,255,0.04)",borderRadius:8,padding:12,fontSize:12}}>
                <div style={{fontSize:11,fontWeight:600,color:"var(--t3)",marginBottom:6}}>⭐ Behavior</div>
                {mdn
                  ?<div>{p.avgB!==null?<span>Average Score: <strong>{p.avgB.toFixed(1)}/5</strong></span>:<em>No behavior scores recorded</em>}</div>
                  :<div>{p.incidentCount>0?<span style={{color:"var(--red)"}}><strong>{p.incidentCount}</strong> incident(s) recorded</span>:<span style={{color:"var(--grn)"}}>No incidents recorded ✓</span>}</div>
                }
              </div>
            </div>
          </div>
        ))}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:16}}>
          {[{type:"strengths",label:"💪 Strengths",icon:"✨"},{type:"areas",label:"🎯 Areas for Improvement",icon:"🔧"}].map(({type,label,icon})=>(
            <div key={type} style={{background:"rgba(255,255,255,0.04)",borderRadius:8,padding:12}}>
              <div style={{fontSize:11,fontWeight:600,color:"var(--t3)",marginBottom:8}}>{label}</div>
              {(sw[type]||[]).length?sw[type].map(i=><div key={i.id} style={{fontSize:11,padding:"4px 0",borderBottom:"1px solid rgba(255,255,255,.06)"}}>{icon} {i.text}</div>):<em style={{fontSize:11,color:"var(--t3)"}}>None noted</em>}
            </div>
          ))}
        </div>
        {mk>0&&<div style={{background:"rgba(248,113,113,.07)",border:"1px solid rgba(248,113,113,.2)",borderRadius:8,padding:10,fontSize:12,marginTop:14,color:"#fca5a5"}}>
          ⚠️ <strong>Makeup Hours Needed:</strong> {Math.ceil(mk)} additional hours required to reach the minimum of {d.minHrs||DEFAULT_MIN_HRS} hours. Current total: {Math.round(tot)} hours.
        </div>}
      </div>
    </div>
  );
}

function TranscriptView({d,onClose}) {
  const {s,subs,mdn,history,mdnCutoff,archivedYear,archiveEntryId,finalizedQuarters}=d;
  const HS_GRADES=["9th Grade","10th Grade","11th Grade","12th Grade"];
  const effectiveGradeLevel=d.gradeLevel||s.gradeLevel;
  const isHS=HS_GRADES.includes(effectiveGradeLevel);
  const fqMap=finalizedQuarters||{};
  const fqCols=Object.entries(fqMap)
    .map(([id,rec])=>({id,label:typeof rec==="string"?id:(rec.label||id),startDate:typeof rec==="string"?"":rec.startDate||"",endDate:typeof rec==="string"?"":rec.endDate||""}))
    .filter(q=>q.startDate&&q.endDate)
    .sort((a,b)=>a.startDate>b.startDate?1:-1);
  const gradeInRange=(assignments,start,end)=>{
    const gr=assignments.filter(a=>{
      if(a.score===null||a.score===""||a.score===undefined||a.score===EXEMPT) return false;
      return (!start||a.date>=start)&&(!end||a.date<=end);
    });
    return mdn?mdnAvg(gr):pctAvg(gr);
  };
  const rows=(subs||[]).map(sub=>{
    const aq=sub.activeQuarters||[];
    // Quarter averages — only for quarters this subject is active in
    const activeQCols=fqCols.filter(q=>!aq.length||aq.includes(q.id));
    const qAvgs=activeQCols.map(q=>gradeInRange(sub.assignments,q.startDate,q.endDate));
    const qLtrs=fqCols.map(q=>{
      if(aq.length&&!aq.includes(q.id)) return null; // subject not active this quarter
      const avg=gradeInRange(sub.assignments,q.startDate,q.endDate);
      if(avg===null) return "—";
      return mdn?(["N","D","M"][Math.round(avg)-1]||"N"):getLetter(avg);
    });
    // Final = average of finalized quarter percentages (only quarters with actual grades)
    const gradedQAvgs=qAvgs.filter(a=>a!==null);
    let finalAvg=null;
    if(gradedQAvgs.length>0){
      finalAvg=gradedQAvgs.reduce((s,a)=>s+a,0)/gradedQAvgs.length;
    } else if(!fqCols.length){
      // No finalized quarters yet — fall back to all assignments
      const allGraded=sub.assignments.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined&&a.score!==EXEMPT);
      finalAvg=mdn?mdnAvg(allGraded):pctAvg(allGraded);
    }
    const finalLtr=finalAvg!==null?(mdn?(["N","D","M"][Math.round(finalAvg)-1]||"N"):getLetter(finalAvg)):"—";
    const finalPts=(!mdn&&finalAvg!==null)?(GP[finalLtr]||0):null;
    return {id:sub.id,name:sub.name,emoji:sub.emoji||"",finalLtr,finalPts,qLtrs,finalPct:finalAvg};
  });
  const graded=rows.filter(r=>r.allClosed&&r.finalPts!==null);
  const gpa=isHS&&!mdn&&graded.length?graded.reduce((s2,r)=>s2+r.finalPts,0)/graded.length:null;
  const priorHSYears=(history||[]).filter(h=>h.studentId===s.id&&!isMDN(h.gradeLevel,mdnCutoff)&&HS_GRADES.includes(h.gradeLevel)&&h.id!==archiveEntryId);
  let cumPts=gpa!==null?graded.reduce((s2,r)=>s2+r.finalPts,0):0;
  let cumCount=gpa!==null?graded.length:0;
  priorHSYears.forEach(yr=>{
    (yr.snapshot?.subjects?.[s.id]||[]).forEach(sub=>{
      const g=sub.assignments.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined&&a.score!==EXEMPT);
      const avg=pctAvg(g);
      if(avg!==null){const l=getLetter(avg);cumPts+=(GP[l]||0);cumCount++;}
    });
  });
  const cumGPA=isHS&&cumCount?cumPts/cumCount:null;
  // Store data for print button access
  if(typeof window!=="undefined"){
    window._lastTranscriptData={s,effectiveGradeLevel,mdn,fqCols,rows,isHS,gpa,cumGPA,cumCount,graded,archivedYear,finalizedQuarters};
  }
  return (
    <div style={{padding:24,background:"var(--bg)",minHeight:"100vh",color:"var(--t1)"}}>
      <div className="noprint" style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        
        <button className="bp" onClick={()=>{
          const {s,effectiveGradeLevel,mdn,fqCols,rows,isHS,gpa,cumGPA,cumCount,graded,archivedYear} = window._lastTranscriptData||{};
          if(!s) return;
          const today2=new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});
          let html="";
          html+="<div class=\"header\">";
          html+="<div class=\"school-name\">Empower Iowa &mdash; Elim Springs Campus</div>";
          html+="<div class=\"doc-title\">Official Academic Transcript</div>";
          html+="<div class=\"student-name\">"+s.name+"</div>";
          html+="<div class=\"student-meta\">"+effectiveGradeLevel+" &nbsp;&bull;&nbsp; "+(mdn?"MDN Grading Scale":"Letter Grades")+(archivedYear?" &nbsp;&bull;&nbsp; School Year "+archivedYear:"")+"</div>";
          html+="<div class=\"student-meta\" style=\"margin-top:4px\">Generated: "+today2+"</div>";
          html+="</div>";
          if((fqCols||[]).length>0&&(rows||[]).some(r=>r.finalLtr==="—")){
            html+="<div class=\"notice\">Subjects with open quarters show &ldquo;&mdash;&rdquo; in the Final column. A final grade is recorded only once all assigned quarters are closed.</div>";
          }
          html+="<table><thead><tr><th>Subject</th>";
          (fqCols||[]).forEach(q=>{html+="<th class=\"grade-cell\">"+q.label+"</th>";});
          html+="<th class=\"grade-cell\">Final</th>";
          if(isHS&&!mdn) html+="<th class=\"grade-cell\">GPA Pts</th>";
          html+="</tr></thead><tbody>";
          (rows||[]).forEach(r=>{
            html+="<tr><td>"+r.name+"</td>";
            (fqCols||[]).forEach((q,qi)=>{html+="<td class=\"grade-cell\">"+(r.qLtrs[qi]===null?"&middot;":r.qLtrs[qi])+"</td>";});
            html+="<td class=\"grade-cell\" style=\"font-weight:bold\">"+r.finalLtr+"</td>";
            if(isHS&&!mdn) html+="<td class=\"grade-cell\">"+(r.finalPts!==null?r.finalPts.toFixed(1):"&mdash;")+"</td>";
            html+="</tr>";
          });
          html+="</tbody><tfoot>";
          if(isHS&&!mdn){
            html+="<tr><td colspan=\""+(( fqCols||[]).length+2)+"\" style=\"text-align:right;padding-right:12px;\">Term GPA</td><td class=\"grade-cell\">"+(gpa!==null?gpa.toFixed(2):"&mdash;")+"</td></tr>";
            if(cumCount>( graded||[]).length){
              html+="<tr><td colspan=\""+((fqCols||[]).length+2)+"\" style=\"text-align:right;padding-right:12px;\">Cumulative GPA (9&ndash;12)</td><td class=\"grade-cell\">"+(cumGPA!==null?cumGPA.toFixed(2):"&mdash;")+"</td></tr>";
            }
          }
          if(!isHS||mdn){
            html+="<tr><td colspan=\""+((fqCols||[]).length+(isHS&&!mdn?3:2))+"\" style=\"font-size:9px;color:#666;font-weight:normal;\">"+(mdn?"M = Mastered &nbsp; D = Developing &nbsp; N = Not Yet":"GPA calculations apply to grades 9&ndash;12 only.")+"</td></tr>";
          }
          html+="</tfoot></table>";
          html+="<div class=\"signatures\">";
          html+="<div class=\"sig-block\"><div class=\"sig-line\"></div><div class=\"sig-label\">Authorized Signature</div></div>";
          html+="<div class=\"sig-block\"><div class=\"sig-line\"></div><div class=\"sig-label\">Title / Role</div></div>";
          html+="<div class=\"sig-block\"><div class=\"sig-line\"></div><div class=\"sig-label\">Date</div></div>";
          html+="</div>";
          html+="<div class=\"footer\">This is an official transcript issued by Empower Iowa &mdash; Elim Springs Campus. Alterations to this document are unauthorized and void.</div>";
          const w=window.open("","_blank");
          w.document.write(`<!DOCTYPE html><html><head><title>Official Transcript - `+s.name+`</title><style>
            @page{margin:2cm 2.5cm;}
            *{box-sizing:border-box;margin:0;padding:0;}
            body{font-family:Georgia,"Times New Roman",serif;background:white;color:#111;font-size:12px;line-height:1.6;}
            .header{text-align:center;padding-bottom:18px;margin-bottom:20px;border-bottom:3px double #333;}
            .school-name{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#555;margin-bottom:8px;}
            .doc-title{font-size:20px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;margin-bottom:12px;}
            .student-name{font-size:17px;font-weight:bold;margin-bottom:5px;}
            .student-meta{font-size:10px;color:#555;letter-spacing:.04em;}
            .notice{font-size:10px;color:#555;padding:7px 12px;border:1px solid #ccc;margin-bottom:16px;background:#fafafa;}
            table{width:100%;border-collapse:collapse;margin-top:4px;}
            thead tr{border-bottom:2px solid #333;}
            th{font-family:Arial,sans-serif;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.08em;padding:7px 10px;text-align:left;color:#333;}
            td{padding:7px 10px;border-bottom:1px solid #e0e0e0;font-size:11px;}
            tfoot td{border-top:2px solid #333;border-bottom:none;font-weight:bold;padding-top:9px;}
            .grade-cell{text-align:center;}
            .signatures{display:flex;gap:32px;margin-top:48px;padding-top:16px;}
            .sig-block{flex:1;}
            .sig-line{border-bottom:1px solid #333;height:32px;margin-bottom:6px;}
            .sig-label{font-family:Arial,sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#555;}
            .footer{text-align:center;font-size:9px;color:#777;margin-top:28px;padding-top:10px;border-top:1px solid #ccc;letter-spacing:.03em;font-style:italic;}
          </style></head><body>`+html+`</body></html>`);
          w.document.close();
          w.focus();
          setTimeout(()=>w.print(),600);
        }}>Print / Export Transcript</button>
        <button className="bg" onClick={onClose}>← Back</button>
        <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:8,fontSize:11,color:"var(--t3)"}}>
          <span>Subjects per page:</span>
          <select id="subPerPage" className="ins" style={{width:60}} defaultValue="20">
            {[5,10,15,20].map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <div id="print-transcript-content" className="prpt">
        <div className="rh">
          <div style={{fontSize:10,color:"#64748b",marginBottom:4,letterSpacing:"0.08em",textTransform:"uppercase"}}>Empower Iowa — Elim Springs Campus</div>
          <div style={{fontSize:22,fontWeight:700,marginBottom:4,color:"#0f172a"}}>Official Transcript</div>
          <div style={{fontSize:16,fontWeight:600,marginBottom:4,color:"#0f172a"}}>{s.name}</div>
          <div style={{fontSize:12,color:"#475569"}}>{effectiveGradeLevel} · {mdn?"MDN Scale":"Letter Grades"}{archivedYear?" · School Year "+archivedYear:""}</div>
        </div>
        {!fqCols.length&&<div style={{fontSize:11,color:"#92400e",padding:"8px 12px",background:"#fef3c7",borderRadius:6,marginBottom:12,border:"1px solid #fde68a"}}>No finalized quarters — finalize quarters in Settings to populate quarterly grade columns.</div>}
        {fqCols.length>0&&rows.some(r=>!r.allClosed)&&<div style={{fontSize:11,color:"#1a6a1a",padding:"8px 12px",background:"#eff6ff",borderRadius:6,marginBottom:12,border:"1px solid #bbf7d0"}}>
          ℹ Subjects with open quarters show "—" in the Final column. A final grade is only recorded once all assigned quarters are closed.
        </div>}
        <table className="tt">
          <thead>
            <tr>
              <th style={{textAlign:"left"}}>Subject</th>
              {fqCols.map(q=><th key={q.id} style={{textAlign:"center"}}>{q.label}</th>)}
              <th style={{textAlign:"center"}}>Final</th>
              {isHS&&!mdn&&<th style={{textAlign:"center"}}>GPA Pts</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r,ri)=>(
              <tr key={r.id} style={ri>0&&ri%parseInt((typeof document!=="undefined"&&document.getElementById("subPerPage")?.value)||"20")===0?{pageBreakBefore:"always"}:{}}>
                <td>{mdn?r.emoji+" ":""}{r.name}</td>
                {fqCols.map((q,qi)=>(
                  <td key={q.id} style={{textAlign:"center",color:r.qLtrs[qi]===null||r.qLtrs[qi]==="—"?"var(--t3)":"inherit"}}>
                    {r.qLtrs[qi]===null?"·":r.qLtrs[qi]}
                  </td>
                ))}
                <td style={{fontWeight:600,textAlign:"center"}}>{r.finalLtr}</td>
                {isHS&&!mdn&&<td style={{textAlign:"center"}}>{r.finalPts!==null?r.finalPts.toFixed(1):"—"}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            {isHS&&!mdn&&<tr>
              <td colSpan={fqCols.length+2} style={{fontWeight:600,textAlign:"right",paddingRight:8}}>Term GPA</td>
              <td style={{textAlign:"center"}}><strong>{gpa!==null?gpa.toFixed(2):"—"}</strong></td>
            </tr>}
            {isHS&&!mdn&&cumCount>graded.length&&<tr style={{borderTop:"2px solid var(--br)"}}>
              <td colSpan={fqCols.length+2} style={{fontWeight:600,textAlign:"right",paddingRight:8}}>Cumulative GPA (9–12)</td>
              <td style={{textAlign:"center"}}><strong>{cumGPA!==null?cumGPA.toFixed(2):"—"}</strong></td>
            </tr>}
            {(!isHS||mdn)&&<tr><td colSpan={fqCols.length+2} style={{fontSize:10,color:"var(--t3)"}}>{mdn?"M = Mastered · D = Developing · N = Not Yet":"GPA calculations apply to grades 9–12 only."}</td></tr>}
          </tfoot>
        </table>
        <div style={{marginTop:20,fontSize:10,color:"var(--t3)",textAlign:"center"}}>Official transcript — Empower Iowa - Elim Springs Campus · Generated {fmt(today())}</div>
      </div>
    </div>
  );
}

function Accounts({state,upd,accounts,user,prefillStudentId,onPrefillUsed}) {
  const isAdmin=user&&user.role==="admin";
  const roleOptions=isAdmin
    ?[["admin","Admin (teacher + user management)"],["teacher","Teacher"],["parent","Parent"],["student","Student"]]
    :[["parent","Parent"],["student","Student"]];
  const BLANK={name:"",email:"",password:"",role:"parent",studentIds:[],studentMode:"new",linkStudentId:"",gradeLevel:"1st Grade"};
  const [form,setForm]=useState(BLANK);
  const [show,setShow]=useState(false);
  const [showRoster,setShowRoster]=useState(false);
  const [rosterForm,setRosterForm]=useState({name:"",gradeLevel:"1st Grade"});
  const [rosterErr,setRosterErr]=useState("");
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [ok,setOk]=useState("");
  const [editingUser,setEditingUser]=useState(null);

  useEffect(()=>{
    if(prefillStudentId){
      setForm(f=>({...f,role:"parent",studentIds:[prefillStudentId]}));
      setErr("");setOk("");setShow(true);
      onPrefillUsed&&onPrefillUsed();
    }
  },[prefillStudentId]);

  const staffRole=(r)=>r==="admin"||r==="teacher";
  const genPw=()=>window._genStrongPassword();
  const resetForm=()=>setForm(BLANK);
  const togStudentLink=(sid)=>setForm(f=>({...f,studentIds:f.studentIds.includes(sid)?f.studentIds.filter(x=>x!==sid):[...f.studentIds,sid]}));

  const list=(accounts||[]).filter(u=>u.uid!==user.id);
  // Never allow the last admin to be removed — someone must retain full access.
  const adminCount=(accounts||[]).filter(a=>a.role==="admin").length;
  const isLastAdmin=(u)=>u.role==="admin"&&adminCount<=1;
  const canManage=(u)=>isAdmin||!staffRole(u.role);
  const roleBadge=(r)=>({admin:"🛡️ Admin",teacher:"🎓 Teacher",parent:"👨‍👩‍👧 Parent",student:"🧒 Student"}[r]||r);

  // Roster students that don't have a student login yet.
  const withLogin=new Set();
  (accounts||[]).filter(u=>u.role==="student").forEach(u=>(u.studentIds||[]).forEach(id=>withLogin.add(id)));
  const rosterNoLogin=(state.students||[]).filter(s=>!withLogin.has(s.id));

  // Add a roster record (the student entity the gradebook/attendance hang off).
  const addRosterStudent=(s)=>{
    if(!upd) return;
    upd(p=>({...p,
      students:[...(p.students||[]),s],
      subjects:{...p.subjects,[s.id]:[]},
      attendance:{...p.attendance,[s.id]:[]},
      behavior:{...p.behavior,[s.id]:[]},
      sw:{...p.sw,[s.id]:{strengths:[],areas:[]}}}));
  };

  const addRosterOnly=()=>{
    setRosterErr("");
    if(!rosterForm.name.trim()){setRosterErr("Enter the student's name.");return;}
    const s={id:uid(),name:rosterForm.name.trim(),gradeLevel:rosterForm.gradeLevel,parentEmail:"",parentPhone:""};
    addRosterStudent(s);
    window._logActivity&&window._logActivity("roster.add","Added "+s.name+" to the roster (no login)");
    setShowRoster(false);setRosterForm({name:"",gradeLevel:"1st Grade"});setErr("");
    setOk(s.name+" was added to the roster. You can create a login for them any time.");
  };

  // Open Create Account pre-set for an existing roster student.
  const startLoginFor=(s)=>{
    setErr("");setOk("");
    setForm({...BLANK,role:"student",name:s.name,studentMode:"existing",linkStudentId:s.id,gradeLevel:s.gradeLevel||"1st Grade"});
    setShow(true);
  };

  const add=()=>{
    setErr("");setOk("");
    const isStudent=form.role==="student";
    if(!form.name.trim()){setErr("Enter a full name.");return;}
    if(!form.email.trim()){setErr("Enter an email address.");return;}
    if(!isAdmin&&staffRole(form.role)){setErr("Only an admin can create teacher or admin accounts.");return;}
    if(isStudent&&form.studentMode==="existing"&&!form.linkStudentId){setErr("Choose which student this login is for.");return;}
    const pw=(form.password.trim()||genPw());
    if(window._pwIssues(pw,form.email.trim()).length){setErr("Temporary password isn't strong enough — click Generate, or meet all the requirements shown.");return;}
    // A student login is tied to one roster record: either an existing one, or
    // a new one created alongside the login.
    const newSid=(isStudent&&form.studentMode==="new")?uid():null;
    const sids=isStudent?[newSid||form.linkStudentId]:(staffRole(form.role)?[]:form.studentIds);
    const nm=form.name.trim(), em=form.email.trim(), rl=form.role, gl=form.gradeLevel;
    setBusy(true);
    window._createAccount({role:rl,name:nm,email:em,password:pw,studentIds:sids})
      .then(()=>{
        // Create the roster entry only after the login exists, so a failed
        // sign-up can't leave an orphan student record behind.
        if(newSid) addRosterStudent({id:newSid,name:nm,gradeLevel:gl,parentEmail:"",parentPhone:""});
        window._logActivity&&window._logActivity("account.create","Created "+rl+" account "+em+(newSid?" and roster entry for "+nm:""));
        setBusy(false);setShow(false);resetForm();
        setOk("Account created for "+em+(newSid?" — added to the roster as well":"")+". Temporary password: "+pw+" (a reset email was also sent so they can choose their own).");
      })
      .catch(e=>{ setBusy(false); setErr((e&&e.message)||"Could not create the account."); });
  };
  const saveLinks=(u,studentIds)=>{ window._updateAccountLinks(u.uid,studentIds).then(()=>window._logActivity&&window._logActivity("account.links","Updated linked students for "+(u.name||u.email||u.uid))).catch(e=>alert("Could not update links: "+e.message)); };
  const del=(u)=>{
    if(isLastAdmin(u)){alert("This is the last admin account. Create another admin before removing this one.");return;}
    if(!window.confirm("Remove "+(u.name||u.email)+"'s access? Their sign-in must also be deleted in the Firebase console.")) return;
    window._deleteAccount(u.uid).then(res=>{window._logActivity&&window._logActivity("account.remove","Removed "+u.role+" account "+(u.email||u.name||u.uid));setErr("");setOk((u.name||u.email)+" removed."+((res&&res.authDeleted)?" Their Firebase sign-in was deleted too.":" Their sign-in still exists in Firebase Authentication — remove it in the console."));}).catch(e=>alert("Could not remove account: "+((e&&e.message)||e)));
  };

  return (
    <div className="pg">
      <div className="ph"><div className="ptit">Accounts &amp; Roster</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button className="bg" onClick={()=>{setErr("");setOk("");setRosterErr("");setRosterForm({name:"",gradeLevel:"1st Grade"});setShowRoster(true);}}>+ Add Student to Roster</button>
          <button className="bp" onClick={()=>{setErr("");setOk("");resetForm();setShow(true);}}>+ Create Account</button>
        </div>
      </div>

      <div style={{fontSize:11,color:"var(--t3)",marginBottom:14}}>
        {isAdmin?"As an admin you can create admins, teachers, parents, and students.":"You can create parent and student accounts. Ask an admin to add teachers."} A student can be added to the roster without a login, and given one later. Logins and passwords are handled by Firebase Authentication.
      </div>
      {ok&&<div style={{background:"rgba(74,222,128,0.1)",border:"1px solid rgba(74,222,128,0.3)",color:"var(--grn)",borderRadius:8,padding:"9px 12px",fontSize:12,marginBottom:12}}>{ok}</div>}

      {editingUser&&<div className="mo"><div className="md">
        <div className="mdt">Manage Linked Students — {editingUser.name||editingUser.email}</div>
        <div style={{fontSize:11,color:"var(--t2)",marginBottom:12}}>Check all students this account should have access to.</div>
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {state.students.map(s=>{
            const linked=(editingUser.studentIds||[]).includes(s.id);
            return (
              <label key={s.id} className="cl" style={{fontSize:12,padding:"7px 9px",borderRadius:6,background:linked?"rgba(76,175,80,0.1)":"var(--bg)",border:"1px solid "+(linked?"rgba(76,175,80,0.3)":"var(--br)")}}>
                <input type="checkbox" checked={linked} onChange={()=>{
                  const cur=(editingUser.studentIds||[]);
                  const next=linked?cur.filter(id=>id!==s.id):[...cur,s.id];
                  const updated={...editingUser,studentIds:next};
                  setEditingUser(updated);
                  saveLinks(updated,next);
                }}/>
                <span style={{marginLeft:7}}><strong>{s.name}</strong> <span style={{color:"var(--t3)",fontSize:10}}>({s.gradeLevel})</span></span>
              </label>
            );
          })}
          {!state.students.length&&<span style={{fontSize:11,color:"var(--t3)"}}>No students yet</span>}
        </div>
        <div className="mda"><button className="bg" onClick={()=>setEditingUser(null)}>Done</button></div>
      </div></div>}

      {showRoster&&<div className="mo"><div className="md" style={{maxWidth:420}}>
        <div className="mdt">Add Student to Roster</div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:10}}>Adds the student to the gradebook, attendance, and reports. No login is created — you can add one for them at any time from this page.</div>
        <div className="fg">
          <label>Full Name</label><input className="inp" value={rosterForm.name} onChange={e=>setRosterForm(f=>({...f,name:e.target.value}))} placeholder="Student name"/>
          <label>Grade Level</label>
          <select className="inp" value={rosterForm.gradeLevel} onChange={e=>setRosterForm(f=>({...f,gradeLevel:e.target.value}))}>{GRADE_LEVELS.map(g=><option key={g}>{g}</option>)}</select>
        </div>
        {rosterErr&&<div style={{color:"var(--red)",fontSize:12,marginTop:8}}>{rosterErr}</div>}
        <div className="mda"><button className="bg" onClick={()=>setShowRoster(false)}>Cancel</button><button className="bp" onClick={addRosterOnly}>Add to Roster</button></div>
      </div></div>}

      {show&&<div className="mo"><div className="md">
        <div className="mdt">Create Account</div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:10}}>Creates a real Firebase sign-in. Share the temporary password with the person (or they can use “Forgot password?”). A reset email is sent automatically.</div>
        <div className="fg">
          <label>Role</label>
          <select className="inp" value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>
            {roleOptions.map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select>
          {form.role==="student"&&<>
            <label>Student Record</label>
            <select className="inp" value={form.studentMode==="new"?"__new__":form.linkStudentId}
              onChange={e=>{const v=e.target.value;
                if(v==="__new__"){setForm(f=>({...f,studentMode:"new",linkStudentId:""}));}
                else{const s=(state.students||[]).find(x=>x.id===v);setForm(f=>({...f,studentMode:"existing",linkStudentId:v,name:(s&&s.name)||f.name,gradeLevel:(s&&s.gradeLevel)||f.gradeLevel}));}
              }}>
              <option value="__new__">➕ Create a new student record</option>
              {rosterNoLogin.map(s=><option key={s.id} value={s.id}>{s.name} ({s.gradeLevel})</option>)}
            </select>
            <div style={{gridColumn:"1 / -1",fontSize:10,color:"var(--t3)",marginTop:-2,marginBottom:2}}>
              {form.studentMode==="new"?"A roster entry will be created with this name and grade level.":"This login will be tied to the existing roster entry — their grades and attendance carry over."}
            </div>
          </>}
          <label>Full Name</label><input className="inp" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
          {form.role==="student"&&form.studentMode==="new"&&<>
            <label>Grade Level</label>
            <select className="inp" value={form.gradeLevel} onChange={e=>setForm(f=>({...f,gradeLevel:e.target.value}))}>{GRADE_LEVELS.map(g=><option key={g}>{g}</option>)}</select>
          </>}
          <label>Email (this is their login)</label><input className="inp" type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))}/>
          <label>Temporary Password</label>
          <div style={{display:"flex",gap:6}}>
            <input className="inp" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} placeholder="Leave blank to auto-generate"/>
            <button className="bg" type="button" onClick={()=>setForm(f=>({...f,password:genPw()}))}>Generate</button>
          </div>
          {form.password&&<PwChecklist pw={form.password} email={form.email}/>}
          {form.role==="parent"&&<>
            <label style={{gridColumn:"1 / -1"}}>Linked Students</label>
            <div style={{gridColumn:"1 / -1",display:"flex",flexDirection:"column",gap:5}}>
              {state.students.map(s=>(
                <label key={s.id} className="cl" style={{fontSize:12}}>
                  <input type="checkbox" checked={form.studentIds.includes(s.id)} onChange={()=>togStudentLink(s.id)}/>
                  <span style={{marginLeft:6}}>{s.name} <span style={{color:"var(--t3)",fontSize:10}}>({s.gradeLevel})</span></span>
                </label>
              ))}
              {!state.students.length&&<span style={{fontSize:11,color:"var(--t3)"}}>No students yet</span>}
            </div>
          </>}
        </div>
        {err&&<div style={{color:"var(--red)",fontSize:12,marginTop:8}}>{err}</div>}
        <div className="mda"><button className="bg" onClick={()=>setShow(false)} disabled={busy}>Cancel</button><button className="bp" onClick={add} disabled={busy}>{busy?"Creating…":"Create"}</button></div>
      </div></div>}

      {rosterNoLogin.length>0&&<div style={{marginBottom:18}}>
        <div className="stit">Roster students without a login</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:10}}>
          {rosterNoLogin.map(s=>(
            <div key={s.id} className="card" style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:22}}>🧒</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.name}</div>
                <div style={{fontSize:11,color:"var(--t3)"}}>{s.gradeLevel} · no login</div>
              </div>
              <button className="bs a" style={{fontSize:10}} onClick={()=>startLoginFor(s)}>Create login</button>
            </div>
          ))}
        </div>
      </div>}

      <div className="stit">Accounts</div>
      {!list.length&&<p className="emp">No other accounts yet. Use “Create Account” to add teachers, parents, or students.</p>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:10,marginTop:8}}>
        {list.map(u=>{
          const linkedStudents=state.students.filter(s=>(u.studentIds||[]).includes(s.id));
          return (
            <div key={u.uid} className="card" style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:22}}>{u.role==="admin"?"🛡️":u.role==="teacher"?"🎓":u.role==="parent"?"👨‍👩‍👧":"🧒"}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{u.name||u.email}</div>
                <div style={{fontSize:11,color:"var(--t3)"}}>{roleBadge(u.role)} · {u.email}</div>
                {linkedStudents.length>0&&<div style={{fontSize:10,color:"var(--acc)"}}>Linked: {linkedStudents.map(s=>s.name).join(", ")}</div>}
              </div>
              <div style={{display:"flex",gap:5,flexDirection:"column"}}>
                {(u.role==="parent"||u.role==="student")&&canManage(u)&&<button className="bs a" style={{fontSize:10}} onClick={()=>setEditingUser(u)}>Edit Links</button>}
                {canManage(u)&&!isLastAdmin(u)&&<button className="bs r" style={{fontSize:10}} onClick={()=>del(u)}>Remove</button>}
                {isLastAdmin(u)&&<span style={{fontSize:9,color:"var(--t3)",textAlign:"right"}}>last admin</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────
function PwChecklist({pw,email}){
  if(!pw) return null;
  const rules=window._pwRules||[];
  return (
    <div style={{gridColumn:"1 / -1",margin:"2px 0 8px",display:"flex",flexDirection:"column",gap:2}}>
      {rules.map(r=>{const ok=r.test(pw,email||"");return (
        <div key={r.id} style={{fontSize:10,display:"flex",alignItems:"center",gap:6,color:ok?"var(--grn)":"var(--t3)"}}>
          <span style={{width:10,textAlign:"center"}}>{ok?"✓":"○"}</span><span>{r.label}</span>
        </div>
      );})}
    </div>
  );
}
function _mfaErrMsg(e){
  const c=(e&&e.code)||"";
  if(c==="auth/requires-recent-login") return "For security, sign out and back in, then set up two-factor again.";
  if(c==="auth/operation-not-allowed"||c==="auth/unsupported-first-factor"||c==="auth/admin-restricted-operation") return "Two-factor authentication isn't enabled for this app yet. An admin must turn it on in Firebase (see the setup notes).";
  if(c==="auth/invalid-verification-code"||c==="auth/invalid-otp"||c==="auth/totp-challenge-timeout") return "That code wasn't right — enter the current 6-digit code and try again.";
  if(c==="auth/second-factor-already-in-use") return "This authenticator is already enrolled.";
  if(c==="auth/maximum-second-factor-count-exceeded") return "You've reached the maximum number of authenticators.";
  return (e&&e.message)||"Something went wrong. Please try again.";
}
function MfaSection(){
  const auth=window._auth;
  const cu=auth&&auth.currentUser;
  const Totp=(window.firebase&&firebase.auth&&firebase.auth.TotpMultiFactorGenerator)||null;
  const supported=!!(Totp&&cu&&cu.multiFactor&&cu.multiFactor.getSession);
  const enrolled=(cu&&cu.multiFactor&&cu.multiFactor.enrolledFactors)||[];
  const emailOk=!cu||cu.emailVerified!==false;
  const [step,setStep]=useState("idle");
  const [secret,setSecret]=useState(null);
  const [key,setKey]=useState("");
  const [code,setCode]=useState("");
  const [name,setName]=useState("Authenticator app");
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);
  const begin=()=>{
    setErr("");
    if(!supported){setErr("Two-factor authentication isn't enabled for this app yet.");return;}
    setBusy(true);
    cu.multiFactor.getSession()
      .then(session=>Totp.generateSecret(session))
      .then(sec=>{
        setSecret(sec); setKey(sec.secretKey||"");
        let url=""; try{url=sec.generateQrCodeUrl((cu&&cu.email)||"account","Empower Iowa");}catch(e){}
        setStep("verify"); setBusy(false);
        if(url) setTimeout(()=>{window._renderQR&&window._renderQR("mfa-qr",url);},0);
      })
      .catch(e=>{setBusy(false);setErr(_mfaErrMsg(e));});
  };
  const finish=()=>{
    setErr("");
    if(!/^\d{6}$/.test((code||"").trim())){setErr("Enter the 6-digit code from your app.");return;}
    if(!secret){setErr("Please start setup again.");return;}
    setBusy(true);
    try{
      const assertion=Totp.assertionForEnrollment(secret,code.trim());
      cu.multiFactor.enroll(assertion,name.trim()||"Authenticator app")
        .then(()=>{setBusy(false);setStep("idle");setSecret(null);setCode("");alert("Two-factor authentication is now on for your account.");})
        .catch(e=>{setBusy(false);setErr(_mfaErrMsg(e));});
    }catch(e){setBusy(false);setErr(_mfaErrMsg(e));}
  };
  const disable=(factor)=>{
    if(!window.confirm("Turn off two-factor authentication? Your account will be less protected.")) return;
    cu.multiFactor.unenroll(factor).then(()=>alert("Two-factor authentication turned off.")).catch(e=>alert(_mfaErrMsg(e)));
  };
  return (
    <div className="card" style={{marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>🔒 Two-Factor Authentication</div>
      {!supported&&<div style={{fontSize:11,color:"var(--t3)"}}>Adds a one-time code from an authenticator app (Microsoft Authenticator, Google Authenticator, Authy, 1Password…) at sign-in. Not enabled for this app yet — an administrator must turn on Identity Platform + TOTP in Firebase.</div>}
      {supported&&enrolled.length>0&&<div>
        <div style={{fontSize:11,color:"var(--grn)",marginBottom:8}}>✓ Two-factor authentication is on.</div>
        {enrolled.map(f=>(
          <div key={f.uid} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,padding:"6px 0"}}>
            <span>{f.displayName||"Authenticator app"}</span>
            <button className="bs r" style={{fontSize:10}} onClick={()=>disable(f)}>Turn off</button>
          </div>
        ))}
      </div>}
      {supported&&enrolled.length===0&&step==="idle"&&(emailOk?<div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:10}}>Protect this account with a one-time code from an authenticator app. Strongly recommended for anyone who can see student records.</div>
        <button className="bp" onClick={begin} disabled={busy}>{busy?"Starting…":"Set up two-factor"}</button>
      </div>:<div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:10}}>Verify your email address before turning on two-factor authentication.</div>
        <button className="bp" onClick={()=>{try{window._auth.currentUser.sendEmailVerification().then(()=>alert("Verification email sent — click the link, then reload this page.")).catch(e=>alert("Could not send: "+e.message));}catch(e){}}}>Send verification email</button>
      </div>)}
      {supported&&step==="verify"&&<div>
        <div style={{fontSize:11,color:"var(--t2)",marginBottom:8}}>1. Scan this QR code in your authenticator app — or add it by hand with the key below.</div>
        <div id="mfa-qr" style={{marginBottom:8}}></div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:4}}>Setup key (manual entry):</div>
        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,wordBreak:"break-all",background:"var(--bg)",padding:"6px 8px",borderRadius:6,marginBottom:10}}>{key}</div>
        <div style={{fontSize:11,color:"var(--t2)",marginBottom:6}}>2. Enter the 6-digit code it shows:</div>
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          <input className="inp" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="123456" style={{maxWidth:120,letterSpacing:2}}/>
          <button className="bp" onClick={finish} disabled={busy}>{busy?"Verifying…":"Verify & turn on"}</button>
          <button className="bg" onClick={()=>{setStep("idle");setSecret(null);setCode("");setErr("");}}>Cancel</button>
        </div>
      </div>}
      {err&&<div style={{color:"var(--red)",fontSize:12,marginTop:8}}>{err}</div>}
    </div>
  );
}

function Settings({state,upd}) {
  const [sy,setSy]=useState(state.sy||{startDate:"",endDate:"",scheduledDays:DAYS,hoursPerDay:6,minHrs:DEFAULT_MIN_HRS,mdnCutoff:"5th Grade"});
  const syDirty=JSON.stringify(sy)!==JSON.stringify(state.sy);
  const [showBump,setShowBump]=useState(false);
  const [bumpConfirm,setBumpConfirm]=useState("");
  const [excluded,setExcluded]=useState({});
  const [showRepeatPrompt,setShowRepeatPrompt]=useState(false);
  const [repeating,setRepeating]=useState({}); // studentId -> true if repeating grade
  const [pendingBump,setPendingBump]=useState(null); // stored upd callback // {studentId: true}
  const [showHistory,setShowHistory]=useState(false);
  const [showYearPrompt,setShowYearPrompt]=useState(false);
  const [showAdm,setShowAdm]=useState(false);
  const [admForm,setAdmForm]=useState({name:"",email:"",password:""});
  const [admErr,setAdmErr]=useState("");
  const [admOk,setAdmOk]=useState("");
  const [admBusy,setAdmBusy]=useState(false);
  const [yearForm,setYearForm]=useState({startDate:"",endDate:""});
  const [showPw,setShowPw]=useState(false);
  const [pwF,setPwF]=useState({next:"",confirm:""});
  const [pwErr,setPwErr]=useState("");

  const toggleExclude=id=>setExcluded(e=>({...e,[id]:!e[id]}));

  // Build a plain-text summary of a student's full record for email body
  const buildStudentSummary=(p,sid)=>{
    const s=p.students.find(x=>x.id===sid);
    if(!s) return "";
    const subs=p.subjects[sid]||[];
    const att=p.attendance[sid]||[];
    const beh=p.behavior[sid]||[];
    const swn=p.sw[sid]||{strengths:[],areas:[]};
    const mdn=isMDN(s.gradeLevel,p.sy?.mdnCutoff);
    const nl="\n";
    let txt="STUDENT RECORD — "+s.name+nl;
    txt+="Grade: "+s.gradeLevel+" | System: "+(mdn?"MDN":"Letter Grades")+nl;
    txt+="Parent Email: "+(s.parentEmail||"—")+" | Phone: "+(s.parentPhone||"—")+nl+nl;
    const isHSGrade2=["9th Grade","10th Grade","11th Grade","12th Grade"].includes(s.gradeLevel);
    txt+="=== GRADES ==="+nl;
    subs.forEach(sub=>{
      const gr=sub.assignments.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined);
      const avg=mdn?mdnAvg(gr):pctAvg(gr);
      const avd=avg!==null?(mdn?(avg.toFixed(1)+" ("+(["N","D","M"][Math.round(avg)-1]||"N")+")"):
        (Math.round(avg)+"% ("+getLetter(avg)+")")):("No grades");
      txt+="  "+sub.name+": "+avd+nl;
      sub.assignments.forEach(a=>{
        const sc=a.score!==null&&a.score!==""&&a.score!==undefined?
          (mdn?(a.score+" ("+(MDN_LBL[a.score]||"")+")"):
           (a.score+"/"+a.maxScore+" ("+Math.round((parseFloat(a.score)/(a.maxScore||100))*100)+"%)")):
          "Ungraded";
        txt+="    - "+a.name+" ["+fmt(a.date)+"]: "+sc+nl;
      });
    });
    txt+=nl+"=== ATTENDANCE ==="+nl;
    const present=att.filter(r=>r.status==="present").length;
    const absent=att.filter(r=>r.status==="absent").length;
    const tardy=att.filter(r=>r.status==="tardy").length;
    const hrs=Math.round(hrsAtt(att));
    txt+="  Present: "+present+" | Absent: "+absent+" | Tardy: "+tardy+" | Total Hours: "+hrs+nl;
    txt+=nl+"=== BEHAVIOR ==="+nl;
    beh.forEach(b=>{
      if(b.score) txt+="  "+fmt(b.date)+": "+b.score+"/5 stars — "+(b.comment||"no comment")+nl;
      if(b.incident) txt+="  "+fmt(b.date)+": Incident recorded"+nl;
    });
    txt+=nl+"=== STRENGTHS ==="+nl;
    (swn.strengths||[]).forEach(i=>{txt+="  - "+i.text+" ("+fmt(i.date)+")"+nl;});
    txt+=nl+"=== AREAS FOR IMPROVEMENT ==="+nl;
    (swn.areas||[]).forEach(i=>{txt+="  - "+i.text+" ("+fmt(i.date)+")"+nl;});
    return txt;
    };

  // Build transcript text for a graduated student
  const buildTranscript=(histEntry)=>{
    const {snapshot,studentId,gradeLevel,schoolYear}=histEntry;
    const s=snapshot.students?.find(x=>x.id===studentId);
    if(!s) return "";
    const subs=snapshot.subjects?.[studentId]||[];
    const nl="\n";
    const isHSGrade=["9th Grade","10th Grade","11th Grade","12th Grade"].includes(gradeLevel);
    let txt="OFFICIAL TRANSCRIPT — Empower Iowa - Elim Springs Campus"+nl;
    txt+="Student: "+s.name+nl;
    txt+="Grade Completed: "+gradeLevel+" | School Year: "+schoolYear+nl;
    txt+="Generated: "+fmt(today())+nl+nl;
    txt+="SUBJECT                 GRADE"+(isHSGrade?"   GPA":"")+nl;
    txt+="—".repeat(50)+nl;
    let totalPts=0, count=0;
    subs.forEach(sub=>{
      const gr=sub.assignments.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined&&a.score!==EXEMPT);
      const avg=pctAvg(gr);
      if(avg!==null){
        const ltr=getLetter(avg);
        const pts=GP[ltr]||0;
        if(isHSGrade){totalPts+=pts; count++;}
        txt+=sub.name.padEnd(24)+ltr.padEnd(8)+(isHSGrade?pts.toFixed(1):"")+nl;
      } else {
        txt+=sub.name.padEnd(24)+"—".padEnd(8)+(isHSGrade?"—":"")+nl;
      }
    });
    txt+=nl+"—".repeat(50)+nl;
    if(isHSGrade) txt+="Term GPA: "+(count?((totalPts/count).toFixed(2)):"—")+nl;
    else txt+="(GPA calculations apply to grades 9–12 only)"+nl;
    return txt;
  };

  const bumpGrades=()=>{
    if(bumpConfirm!=="CONFIRM") return;
    // If any students are excluded, ask about repeating before proceeding
    const excludedList=state.students.filter(s=>excluded[s.id]);
    if(excludedList.length&&!showRepeatPrompt){
      setShowRepeatPrompt(true);
      return;
    }
    openYearPrompt();
  };
  // Suggest rolling the existing dates forward by one year.
  const plusYear=(d)=>{if(!d)return "";const dt=new Date(d+"T12:00:00");dt.setFullYear(dt.getFullYear()+1);return dt.toISOString().slice(0,10);};
  const openYearPrompt=()=>{
    setShowRepeatPrompt(false);
    setYearForm({startDate:plusYear(state.sy?.startDate),endDate:plusYear(state.sy?.endDate)});
    setShowYearPrompt(true);
  };
  const doBump=(newYear)=>{
    const mdnCutoff=sy.mdnCutoff||"5th Grade";
    const schoolYear=(state.sy?.startDate?.slice(0,4)||"")+"–"+(state.sy?.endDate?.slice(0,4)||"");
    const teacher=state.users?.find(u=>u.role==="teacher");

    upd(p=>{
      const newHistory=[...(p.history||[])];
      const newStudents=[];
      const newSubjects={...p.subjects};
      const newAttendance={...p.attendance};
      const newBehavior={...p.behavior};
      const newSw={...p.sw};

      p.students.forEach(s=>{
        if(excluded[s.id]){
          // Held-back students: archive current year's work and reset, same as promoted.
          // They stay at the same grade level. If repeating, label the year accordingly.
          const heldEntry={
            id:uid(),studentId:s.id,studentName:s.name,
            gradeLevel:s.gradeLevel,newGradeLevel:s.gradeLevel,
            schoolYear,
            archivedAt:today(),graduated:false,repeated:!!repeating[s.id],
            snapshot:{
              students:[s],
              subjects:{[s.id]:p.subjects[s.id]||[]},
              attendance:{[s.id]:p.attendance[s.id]||[]},
              behavior:{[s.id]:p.behavior[s.id]||[]},
              sw:{[s.id]:p.sw[s.id]||{strengths:[],areas:[]}},
              finalizedQuarters:p.finalizedQuarters||{},
            }
          };
          newHistory.push(heldEntry);
          // Repeating the same grade: keep the subject list (they are taking the
          // same courses again) but start with a clean slate of assignments.
          // Last year's work is preserved in the archive entry above.
          newSubjects[s.id]=(p.subjects[s.id]||[]).map(sub=>({...sub,assignments:[]}));
          newAttendance[s.id]=[];
          newBehavior[s.id]=[];
          newSw[s.id]={strengths:[],areas:[]};
          // Keep student at same grade
          newStudents.push(s);
          return;
        }
        const idx=GRADE_LEVELS.indexOf(s.gradeLevel);
        const isGrad=s.gradeLevel==="12th Grade";
        const newGrade=(!isGrad&&idx>=0&&idx<GRADE_LEVELS.length-1)?GRADE_LEVELS[idx+1]:s.gradeLevel;

        // Archive current year's data
        const archiveEntry={
          id:uid(),
          studentId:s.id,
          studentName:s.name,
          gradeLevel:s.gradeLevel,
          newGradeLevel:isGrad?"Graduated":newGrade,
          schoolYear,
          archivedAt:today(),
          graduated:isGrad,
          snapshot:{
            students:[s],
            subjects:{[s.id]:p.subjects[s.id]||[]},
            attendance:{[s.id]:p.attendance[s.id]||[]},
            behavior:{[s.id]:p.behavior[s.id]||[]},
            sw:{[s.id]:p.sw[s.id]||{strengths:[],areas:[]}},
            finalizedQuarters:p.finalizedQuarters||{},
          }
        };
        newHistory.push(archiveEntry);

        if(isGrad){
          // Graduated — send emails, remove from active roster
          const parent=getParentsForStudent(p.users,s.id)[0];
          const parentEmail=parent?.email||s.parentEmail||"";
          const teacherEmail=teacher?.email||"";
          const summary=buildStudentSummary(p,s.id);
          const transcript=buildTranscript(archiveEntry);
          const subj="Graduation \u2014 "+s.name+" \u2014 Complete Academic Record";
          const bodyTeacher="Dear "+(teacher?.name||"Teacher")+",\n\n"+s.name+" has completed 12th Grade and graduated from Empower Iowa - Elim Springs Campus.\n\nBelow is a full summary of "+s.name+"'s academic record.\n\n"+summary+"\n\n"+transcript;
          const bodyParent="Dear Parent/Guardian of "+s.name+",\n\nCongratulations! "+s.name+" has graduated from Empower Iowa - Elim Springs Campus.\n\nBelow is "+s.name+"'s official final transcript for your records.\n\n"+transcript;
          // Open emails (two tabs)
          setTimeout(()=>window.open("mailto:"+teacherEmail+"?subject="+encodeURIComponent(subj)+"&body="+encodeURIComponent(bodyTeacher)),100);
          setTimeout(()=>window.open("mailto:"+parentEmail+"?subject="+encodeURIComponent("Congratulations — Final Transcript — "+s.name)+"&body="+encodeURIComponent(bodyParent)),800);
          // Do NOT push to newStudents — graduated
        } else {
          // Promote
          newStudents.push({...s,gradeLevel:newGrade});
          // New grade level: start completely fresh — no subjects, no
          // assignments. Last year's grades are preserved in the archive entry
          // above and remain available on the transcript.
          newSubjects[s.id]=[];
          newAttendance[s.id]=[];
          newBehavior[s.id]=[];
          newSw[s.id]={strengths:[],areas:[]};
        }
      });

      // Always reset finalizedQuarters for the new year — all students start
      // with unlocked quarters. Quarter dates auto-recalculate from school year dates.
      // Archived snapshots already contain the old finalized dates so transcripts are unaffected.
      const newFQ={};
      const syStart2=(newYear&&newYear.startDate)||p.sy?.startDate;
      const syEnd2=(newYear&&newYear.endDate)||p.sy?.endDate;
      let newSyQuarters=p.sy?.quarters||[];
      if(syStart2&&syEnd2){
        const recalc=autoCalcQuarters(syStart2,syEnd2,p.sy?.numQuarters||4,newSyQuarters.map(q=>q.id));
        newSyQuarters=recalc.map((q,i)=>({...q,label:newSyQuarters[i]?.label||q.label}));
      }
      return {...p,students:newStudents,subjects:newSubjects,attendance:newAttendance,
        behavior:newBehavior,sw:newSw,history:newHistory,
        finalizedQuarters:newFQ,
        sy:{...p.sy,startDate:syStart2,endDate:syEnd2,quarters:newSyQuarters,needsYearDates:!newYear}};
    });
    // Keep the Settings form in sync with what was just written.
    if(newYear&&newYear.startDate&&newYear.endDate){
      const ids=(state.sy?.quarters||[]).map(q=>q.id);
      const recalc2=autoCalcQuarters(newYear.startDate,newYear.endDate,state.sy?.numQuarters||4,ids);
      setSy(s=>({...s,startDate:newYear.startDate,endDate:newYear.endDate,needsYearDates:false,
        quarters:recalc2.map((q,i)=>({...q,label:((state.sy?.quarters||[])[i]||{}).label||q.label}))}));
      _yearDatesReminded=false;
    } else {
      setSy(s=>({...s,needsYearDates:true}));
    }
    setShowBump(false); setBumpConfirm(""); setExcluded({}); setShowRepeatPrompt(false); setRepeating({}); setShowYearPrompt(false);
  };

  // History viewer modal
  const [histStudent,setHistStudent]=useState(null);
  const histEntries=(state.history||[]).filter(h=>h.studentId===histStudent);

  return (
    <div className="pg">
      <div className="ptit" style={{marginBottom:20}}>Settings</div>
      {syDirty&&<div style={{background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.3)",borderRadius:7,padding:"9px 14px",fontSize:12,color:"var(--yel)",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        ⚠️ You have unsaved changes to school year settings.
        <div style={{display:"flex",gap:8}}>
          <button className="bs" onClick={()=>setSy(state.sy)}>Discard</button>
          <button className="bp" style={{fontSize:11}} onClick={()=>upd(p=>({...p,sy}))}>Save Now</button>
        </div>
      </div>}

      {/* ── HISTORY MODAL ── */}
      {showHistory&&<div className="mo"><div className="md" style={{maxWidth:640}}>
        <div className="mdt">📚 Student Historical Archive</div>
        <div style={{marginBottom:12}}>
          <select className="inp" value={histStudent||""} onChange={e=>setHistStudent(e.target.value)}>
            <option value="">— Select Student —</option>
            {[...new Map((state.history||[]).map(h=>[h.studentId,h])).values()].map(h=>(
              <option key={h.studentId} value={h.studentId}>{h.studentName}</option>
            ))}
          </select>
        </div>
        {histEntries.length===0&&histStudent&&<p className="emp">No archived records for this student yet.</p>}
        {histEntries.map(entry=>(
          <div key={entry.id} style={{background:"var(--bg)",borderRadius:8,padding:12,marginBottom:10,border:"1px solid var(--br)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div>
                <span style={{fontSize:13,fontWeight:700}}>{entry.gradeLevel}</span>
                <span style={{fontSize:11,color:"var(--t3)",marginLeft:10}}>School Year {entry.schoolYear}</span>
                {entry.graduated&&<span className="bdg bdgg" style={{marginLeft:8}}>🎓 Graduated</span>}
                    {entry.transferred&&<span className="bdg bdgy" style={{marginLeft:8}}>↗ Transferred</span>}
                    {entry.repeated&&<span className="bdg" style={{marginLeft:8,background:"rgba(167,139,250,0.15)",color:"var(--pur)"}}>🔄 Repeat Year</span>}
              </div>
              <span style={{fontSize:10,color:"var(--t3)"}}>Archived {fmt(entry.archivedAt)}</span>
            </div>
            {/* Grades summary */}
            {(entry.snapshot?.subjects?.[entry.studentId]||[]).map(sub=>{
              const gr=sub.assignments.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined);
              const isMDNEntry=isMDN(entry.gradeLevel,state.sy?.mdnCutoff);
              const avg=isMDNEntry?mdnAvg(gr):pctAvg(gr);
              const avd=avg!==null?(isMDNEntry?avg.toFixed(1)+" ("+(["N","D","M"][Math.round(avg)-1]||"N")+")":
                Math.round(avg)+"% ("+getLetter(avg)+")"):"—";
              return <div key={sub.id} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"3px 0",borderBottom:"1px solid var(--br)"}}>
                <span>{sub.name}</span><span style={{color:"var(--acc)"}}>{avd}</span>
              </div>;
            })}
            <HistoryAttendanceSummary entry={entry}/>
          </div>
        ))}
        <div className="mda"><button className="bg" onClick={()=>setShowHistory(false)}>Close</button></div>
      </div></div>}

      {showYearPrompt&&<div className="mo"><div className="md" style={{maxWidth:460}}>
        <div className="mdt">📅 New School Year Dates</div>
        <div style={{fontSize:12,color:"var(--t2)",marginBottom:12,lineHeight:1.6}}>
          Set the dates for the year students are moving into — quarters are recalculated from these. You can skip this and set them later in Settings.
        </div>
        <div className="fg">
          <label>Start Date</label>
          <input className="inp" type="date" value={yearForm.startDate} onChange={e=>setYearForm(f=>({...f,startDate:e.target.value}))}/>
          <label>End Date</label>
          <input className="inp" type="date" value={yearForm.endDate} onChange={e=>setYearForm(f=>({...f,endDate:e.target.value}))}/>
        </div>
        {yearForm.startDate&&yearForm.endDate&&yearForm.endDate<=yearForm.startDate&&<div style={{color:"var(--red)",fontSize:12,marginTop:8}}>End date must be after the start date.</div>}
        <div className="mda">
          <button className="bg" onClick={()=>doBump(null)}>Skip for now</button>
          <button className="bp" style={{opacity:(yearForm.startDate&&yearForm.endDate&&yearForm.endDate>yearForm.startDate)?1:0.4}}
            onClick={()=>{if(!yearForm.startDate||!yearForm.endDate||yearForm.endDate<=yearForm.startDate)return;doBump(yearForm);}}>Save Dates &amp; Promote</button>
        </div>
      </div></div>}
      {/* ── BUMP MODAL ── */}
      {showRepeatPrompt&&<div className="mo"><div className="md" style={{maxWidth:480}}>
        <div className="mdt">Repeat Grade?</div>
        <div style={{fontSize:12,color:"var(--t2)",marginBottom:14}}>
          The following students were not promoted. Will any of them repeat their current grade level?
          They stay at the same grade and keep their subject list, with all assignments cleared. Their current year is archived to their transcript first.
        </div>
        {state.students.filter(s=>excluded[s.id]).map(s=>(
          <label key={s.id} className="cl" style={{marginBottom:8,fontSize:12,padding:"7px 10px",borderRadius:6,background:repeating[s.id]?"rgba(76,175,80,0.1)":"var(--bg)",border:"1px solid "+(repeating[s.id]?"rgba(76,175,80,0.3)":"var(--br)")}}>
            <input type="checkbox" checked={!!repeating[s.id]} onChange={()=>setRepeating(r=>({...r,[s.id]:!r[s.id]}))}/>
            <span style={{marginLeft:8}}><strong>{s.name}</strong> <span style={{color:"var(--t3)",fontSize:10}}>({s.gradeLevel})</span></span>
          </label>
        ))}
        <div style={{display:"flex",gap:8,marginTop:14,flexWrap:"wrap"}}>
          <button className="bp" onClick={()=>{setRepeating(r=>{const n={};state.students.filter(s=>excluded[s.id]).forEach(s=>{n[s.id]=true;});return n;});}}>Yes — All Repeat</button>
          <button className="bg" onClick={()=>{setRepeating({});doBump();}}>No — None Repeat</button>
          <button className="bs a" onClick={doBump}>Confirm Selected</button>
          <button className="bs" onClick={()=>setShowRepeatPrompt(false)}>Cancel</button>
        </div>
      </div></div>}
      {showBump&&<div className="mo"><div className="md" style={{maxWidth:580}}>
        <div className="mdt">⬆️ End of Year — Promote Students</div>
        <div style={{fontSize:12,color:"var(--t2)",marginBottom:14,lineHeight:1.7}}>
          Select which students to promote. Every student's current year is archived to their transcript first. Promoted students move up a grade and start completely fresh — no subjects and no assignments. Unchecked students stay at their current grade and keep their subject list, with all assignments cleared. Attendance, behavior, and notes reset for everyone. Graduating 12th graders are removed from the active roster and emails are sent automatically.
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
          {state.students.map(s=>{
            const idx=GRADE_LEVELS.indexOf(s.gradeLevel);
            const isGrad=s.gradeLevel==="12th Grade";
            const next=isGrad?"🎓 Graduated":(idx>=0&&idx<GRADE_LEVELS.length-1?GRADE_LEVELS[idx+1]:s.gradeLevel);
            const crossesCutoff=!isGrad&&isMDN(s.gradeLevel,sy.mdnCutoff)&&!isMDN(next,sy.mdnCutoff);
            const skip=!!excluded[s.id];
            return (
              <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:skip?"var(--bg)":"rgba(76,175,80,0.06)",borderRadius:7,border:"1px solid "+(skip?"var(--br)":"rgba(76,175,80,.2)")}}>
                <input type="checkbox" checked={!skip} onChange={()=>toggleExclude(s.id)} style={{width:15,height:15}}/>
                <div style={{flex:1,fontSize:12}}>
                  <strong>{s.name}</strong>
                  <span style={{color:"var(--t3)",marginLeft:8}}>{s.gradeLevel}</span>
                  {!skip&&<span style={{color:isGrad?"var(--pur)":crossesCutoff?"var(--yel)":"var(--grn)",marginLeft:8}}>→ {next}{crossesCutoff?" ⚠️ switches to Letter Grades":""}</span>}
                  {skip&&<span style={{color:"var(--t3)",marginLeft:8,fontStyle:"italic"}}>→ stays at {s.gradeLevel}</span>}
                </div>
                {isGrad&&!skip&&<span style={{fontSize:11,color:"var(--pur)"}}>📧 emails will send</span>}
              </div>
            );
          })}
        </div>
        <div style={{marginBottom:14}}>
          <label style={{fontSize:11,color:"var(--t2)"}}>Type CONFIRM to proceed:</label>
          <input className="inp" style={{marginTop:6}} value={bumpConfirm} onChange={e=>setBumpConfirm(e.target.value)} placeholder="CONFIRM"/>
        </div>
        <div className="mda">
          <button className="bg" onClick={()=>{setShowBump(false);setBumpConfirm("");setExcluded({});}}>Cancel</button>
          <button className="bp" style={{opacity:bumpConfirm==="CONFIRM"?1:0.4}} onClick={bumpGrades}>Promote Students</button>
        </div>
      </div></div>}

      <div className="card" style={{marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:14}}>School Year Configuration</div>
        <div className="fg">
          <label>Start Date</label><input className="inp" type="date" value={sy.startDate} onChange={e=>setSy(s=>({...s,startDate:e.target.value}))}/>
          <label>End Date</label><input className="inp" type="date" value={sy.endDate} onChange={e=>setSy(s=>({...s,endDate:e.target.value}))}/>
          <label>Hours/Day</label><input className="inp" type="number" value={sy.hoursPerDay} onChange={e=>setSy(s=>({...s,hoursPerDay:parseFloat(e.target.value)||6}))} style={{maxWidth:80}}/>
          <label>Min Hrs/Year</label>
          <div>
            <input className="inp" type="number" value={sy.minHrs||DEFAULT_MIN_HRS} onChange={e=>setSy(s=>({...s,minHrs:parseFloat(e.target.value)||DEFAULT_MIN_HRS}))} style={{maxWidth:100}}/>
            <div style={{fontSize:10,color:"var(--t3)",marginTop:3}}>Iowa Code §279.10(1): accredited nonpublic schools = 1,080 hrs (180 days). CPI with reporting = 148 days minimum.</div>
          </div>
          <label>MDN Cutoff</label>
          <div>
            <select className="inp" value={sy.mdnCutoff||"5th Grade"} onChange={e=>setSy(s=>({...s,mdnCutoff:e.target.value}))}>
              {GRADE_LEVELS.slice(0,-1).map(g=><option key={g} value={g}>{g}</option>)}
            </select>
            <div style={{fontSize:10,color:"var(--t3)",marginTop:3}}>Students at or below this grade use the MDN scale. Students above it use letter grades.</div>
          </div>
          <label>School Days</label>
          <div className="cg">{DAYS.map(d=><label key={d} className="cl"><input type="checkbox" checked={(sy.scheduledDays||DAYS).includes(d)} onChange={e=>setSy(s=>({...s,scheduledDays:e.target.checked?[...(s.scheduledDays||[]),d]:(s.scheduledDays||[]).filter(x=>x!==d)}))}/>{d}</label>)}</div>
        </div>
        <button className="bp" onClick={()=>{_yearDatesReminded=false;upd(p=>({...p,sy:{...sy,needsYearDates:false}}));}}>Save School Year</button>
      </div>
      <div className="card" style={{marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>📱 Mobile Bottom Nav — Pinned Pages</div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:12}}>Choose which 4 pages appear in the bottom navigation bar on mobile. The rest go into the ⋯ More menu. Settings is always accessible via More.</div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {[
            {id:"dashboard",l:"Dashboard",i:"🏠"},{id:"students",l:"Students",i:"👥"},
            {id:"gradebook",l:"Gradebook",i:"📊"},{id:"attendance",l:"Attendance",i:"📅"},
            {id:"behavior",l:"Behavior",i:"⭐"},{id:"notes",l:"Notes",i:"📝"},
            {id:"events",l:"Events",i:"🗓️"},{id:"reports",l:"Reports",i:"📋"},
            {id:"accounts",l:"Accounts",i:"👤"},
          ].map(item=>{
            const pinned=(sy.pinnedNav||["dashboard","students","gradebook","attendance"]).includes(item.id);
            const pinnedCount=(sy.pinnedNav||[]).length;
            return (
              <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 10px",borderRadius:7,background:pinned?"rgba(76,175,80,0.1)":"var(--bg)",border:"1px solid "+(pinned?"rgba(76,175,80,0.3)":"var(--br)")}}>
                <span style={{fontSize:18,width:24}}>{item.i}</span>
                <span style={{flex:1,fontSize:12,fontWeight:pinned?600:400}}>{item.l}</span>
                {pinned&&<span style={{fontSize:10,color:"var(--acc)",marginRight:4}}>Pinned #{(sy.pinnedNav||[]).indexOf(item.id)+1}</span>}
                <button className={"bs"+(pinned?" bd":"")} onClick={()=>{
                  const cur=sy.pinnedNav||["dashboard","students","gradebook","attendance"];
                  let next;
                  if(pinned){
                    if(cur.length<=1) return; // must keep at least 1
                    next=cur.filter(id=>id!==item.id);
                  } else {
                    if(cur.length>=4) return; // max 4
                    next=[...cur,item.id];
                  }
                  setSy(s=>({...s,pinnedNav:next}));
                }}
                disabled={!pinned&&(sy.pinnedNav||[]).length>=4}
                style={{opacity:(!pinned&&(sy.pinnedNav||[]).length>=4)?0.4:1}}>
                  {pinned?"Unpin":"Pin"}
                </button>
              </div>
            );
          })}
        </div>
        <div style={{fontSize:11,color:"var(--t3)",marginTop:8}}>{(sy.pinnedNav||[]).length}/4 pinned{(sy.pinnedNav||[]).length>=4?" (max reached)":""}</div>
        <button className="bp" style={{marginTop:10}} onClick={()=>upd(p=>({...p,sy}))}>Save Nav Settings</button>
      </div>
      <div className="card" style={{marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>Quarter / Reporting Period Dates</div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:10}}>Set the number of quarters then click Auto-Calculate to divide the school year evenly. Adjust individual dates manually if needed.</div>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:14,flexWrap:"wrap"}}>
          <label style={{fontSize:12}}>Quarters per year:</label>
          <select className="ins" style={{width:60}} value={sy.numQuarters||4} onChange={e=>setSy(s=>({...s,numQuarters:parseInt(e.target.value)}))}>
            {[2,3,4].map(n=><option key={n} value={n}>{n}</option>)}
          </select>
          <button className="bp" style={{fontSize:11}} onClick={()=>{
            if(!sy.startDate||!sy.endDate){alert("Set school year start and end dates first.");return;}
            const existing=(sy.quarters||[]).map(q=>q.id);
            setSy(s=>({...s,quarters:autoCalcQuarters(s.startDate,s.endDate,s.numQuarters||4,existing)}));
          }}>⟳ Auto-Calculate from School Year</button>
        </div>
        {(sy.quarters||[]).map((q,qi)=>(
          <div key={q.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
            <input className="ins" value={q.label} style={{width:48}} onChange={e=>setSy(s=>({...s,quarters:s.quarters.map((x,i)=>i===qi?{...x,label:e.target.value}:x)}))} placeholder="Q1"/>
            <input className="ins" type="date" value={q.startDate} onChange={e=>setSy(s=>({...s,quarters:s.quarters.map((x,i)=>i===qi?{...x,startDate:e.target.value}:x)}))}/> 
            <span style={{fontSize:11,color:"var(--t3)"}}>to</span>
            <input className="ins" type="date" value={q.endDate} onChange={e=>setSy(s=>({...s,quarters:s.quarters.map((x,i)=>i===qi?{...x,endDate:e.target.value}:x)}))}/> 
            {(state.finalizedQuarters||{})[q.id]&&<span style={{fontSize:9,color:"var(--pur)"}}>🔒</span>}
            {(sy.quarters||[]).length>1&&!((state.finalizedQuarters||{})[q.id])&&<button className="bx" style={{color:"var(--red)"}} onClick={()=>setSy(s=>({...s,quarters:s.quarters.filter((_,i)=>i!==qi)}))}>×</button>}
          </div>
        ))}
        <div style={{fontSize:11,color:"var(--t3)",marginTop:6,marginBottom:4}}>Finalized quarters (🔒) cannot have their dates removed. Quarters auto-recalculate each year — finalized date ranges are preserved in the transcript regardless of future changes.</div>
        <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
          <button className="bp" onClick={()=>upd(p=>({...p,sy}))}>Save Quarters</button>
        </div>
        <div style={{marginTop:12}}>
          <div style={{fontSize:12,fontWeight:600,marginBottom:8}}>Finalize Quarters</div>
          {syDirty&&<div style={{fontSize:11,color:"var(--yel)",marginBottom:8,padding:"6px 9px",background:"rgba(251,191,36,0.08)",borderRadius:6}}>⚠️ Save quarters above before finalizing.</div>}
          {(state.sy?.quarters||[]).filter(q=>q.startDate&&q.endDate).map(q=>{
            const fin=(state.finalizedQuarters||{})[q.id];
            return (
              <div key={q.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:6,padding:"6px 9px",borderRadius:6,background:fin?"rgba(74,222,128,0.08)":"var(--bg)",border:"1px solid "+(fin?"rgba(74,222,128,0.3)":"var(--br)")}}>
                <span style={{flex:1,fontSize:12}}>{q.label} <span style={{color:"var(--t3)",fontSize:10}}>{fmt(q.startDate)} – {fmt(q.endDate)}</span></span>
                {fin?<><span className="bdg bdgg">🔒 Finalized {fmt(fin)}</span>
                  <button className="bs bd" style={{fontSize:10}} onClick={()=>{if(!window.confirm("Unlock "+q.label+"?\n\nGrades in this quarter become editable again and it will no longer count as finalized on transcripts."))return;upd(p=>{const fq={...(p.finalizedQuarters||{})};delete fq[q.id];return {...p,finalizedQuarters:fq};});}}>Unlock</button>
                </>:
                <button className="bp" style={{fontSize:10}} onClick={()=>upd(p=>({...p,finalizedQuarters:{...(p.finalizedQuarters||{}),[q.id]:{date:today(),startDate:q.startDate,endDate:q.endDate,label:q.label}}}))}>🔒 Finalize</button>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="card" style={{marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>⬆️ End of Year — Promote Students</div>
        <div style={{fontSize:12,color:"var(--t2)",marginBottom:12}}>Advance eligible students up one grade level. Archived data is retained for historical review. Graduating seniors trigger automatic email records.</div>
        <div style={{display:"flex",gap:8}}>
          <button className="bp" onClick={()=>setShowBump(true)}>Promote Students</button>
          <button className="bs a" onClick={()=>setShowHistory(true)}>📚 View Archive</button>
        </div>
      </div>
      <div className="card" style={{marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>🔑 My Password</div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:12}}>Your sign-in password is managed by Firebase Authentication. Change it here, or use “Forgot password?” on the sign-in screen.</div>
        <button className="bp" onClick={()=>{setPwErr("");setPwF({next:"",confirm:""});setShowPw(true);}}>Change Password</button>
      </div>
      <MfaSection/>
      {showPw&&<div className="mo"><div className="md" style={{maxWidth:400}}>
        <div className="mdt">🔑 Change Password</div>
        <div className="fg">
          <label>New Password</label>
          <input className="inp" type="password" value={pwF.next} onChange={e=>setPwF(f=>({...f,next:e.target.value}))} placeholder="New password"/>
          <label>Confirm</label>
          <input className="inp" type="password" value={pwF.confirm} onChange={e=>setPwF(f=>({...f,confirm:e.target.value}))} placeholder="Confirm new password"/>
          <PwChecklist pw={pwF.next} email={(window._appUser||{}).email}/>
        </div>
        {pwErr&&<div style={{color:"var(--red)",fontSize:12,marginBottom:10}}>{pwErr}</div>}
        <div className="mda">
          <button className="bg" onClick={()=>setShowPw(false)}>Cancel</button>
          <button className="bp" onClick={()=>{
            if(window._pwIssues(pwF.next,(window._appUser||{}).email).length){setPwErr("Please meet all the password requirements below.");return;}
            if(pwF.next!==pwF.confirm){setPwErr("Passwords do not match.");return;}
            const a=window._auth;
            if(a&&a.currentUser){a.currentUser.updatePassword(pwF.next).then(()=>{setShowPw(false);alert("Password updated successfully!");}).catch(e=>{setPwErr(e.code==="auth/requires-recent-login"?"For security, sign out and back in, then try again.":("Error: "+e.message));});}
            else setPwErr("Not connected to Firebase.");
          }}>Update Password</button>
        </div>
      </div></div>}
      {(window._appUser||{}).role==="admin"&&<div className="card" style={{marginBottom:16,border:"1px dashed var(--br2)"}}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>🧪 Temporary — Create Admin Account</div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:12}}>Testing helper for quickly adding another admin login. Accounts → Create Account does the same thing, so this card can be deleted before going live.</div>
        <button className="bp" onClick={()=>{setAdmErr("");setAdmOk("");setAdmForm({name:"",email:"",password:""});setShowAdm(true);}}>+ Create Admin</button>
        {admOk&&<div style={{background:"rgba(74,222,128,0.1)",border:"1px solid rgba(74,222,128,0.3)",color:"var(--grn)",borderRadius:8,padding:"9px 12px",fontSize:12,marginTop:10}}>{admOk}</div>}
      </div>}
      {showAdm&&<div className="mo"><div className="md" style={{maxWidth:420}}>
        <div className="mdt">🛡️ Create Admin Account</div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:10}}>Creates a real Firebase sign-in with full admin access, including managing other accounts.</div>
        <div className="fg">
          <label>Full Name</label><input className="inp" value={admForm.name} onChange={e=>setAdmForm(f=>({...f,name:e.target.value}))}/>
          <label>Email (their login)</label><input className="inp" type="email" value={admForm.email} onChange={e=>setAdmForm(f=>({...f,email:e.target.value}))}/>
          <label>Temporary Password</label>
          <div style={{display:"flex",gap:6}}>
            <input className="inp" value={admForm.password} onChange={e=>setAdmForm(f=>({...f,password:e.target.value}))} placeholder="Leave blank to auto-generate"/>
            <button className="bg" type="button" onClick={()=>setAdmForm(f=>({...f,password:window._genStrongPassword()}))}>Generate</button>
          </div>
          {admForm.password&&<PwChecklist pw={admForm.password} email={admForm.email}/>}
        </div>
        {admErr&&<div style={{color:"var(--red)",fontSize:12,marginTop:8}}>{admErr}</div>}
        <div className="mda">
          <button className="bg" onClick={()=>setShowAdm(false)} disabled={admBusy}>Cancel</button>
          <button className="bp" disabled={admBusy} onClick={()=>{
            setAdmErr("");
            if(!admForm.name.trim()){setAdmErr("Enter a full name.");return;}
            if(!admForm.email.trim()){setAdmErr("Enter an email address.");return;}
            const pw=admForm.password.trim()||window._genStrongPassword();
            if(window._pwIssues(pw,admForm.email.trim()).length){setAdmErr("Password isn't strong enough — click Generate, or meet all the requirements shown.");return;}
            setAdmBusy(true);
            window._createAccount({role:"admin",name:admForm.name.trim(),email:admForm.email.trim(),password:pw,studentIds:[]})
              .then(()=>{
                const em=admForm.email.trim();
                window._logActivity&&window._logActivity("account.create","Created admin account "+em);
                setAdmBusy(false);setShowAdm(false);setAdmForm({name:"",email:"",password:""});
                setAdmOk("Admin account created for "+em+". Temporary password: "+pw+" (a reset email was also sent).");
              })
              .catch(e=>{setAdmBusy(false);setAdmErr((e&&e.message)||"Could not create the account.");});
          }}>{admBusy?"Creating…":"Create Admin"}</button>
        </div>
      </div></div>}
      <div className="card" style={{marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>🗄️ Demo Data</div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:12}}>Use these buttons to set up or remove demo data for testing. Clear All Data wipes every student, grade, attendance record, snapshot, portal, and account — keeping only admin accounts. Create Demo Data generates a fresh set of fake students with today-relative dates. Note: Firebase Authentication sign-ins cannot be deleted by the web app; you will be shown which ones to remove in the Firebase console.</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button className="bs r" onClick={()=>{
            if(!window.confirm("Delete ALL students, grades, attendance, snapshots, portals and every account except admin accounts?\n\nThis cannot be undone.")) return;
            replaceStateInDb(buildBlankState(),true,"Cleared all data");
          }}>🗑️ Clear All Data</button>
          <button className="bs a" onClick={()=>{
            if(!window.confirm("Replace ALL current data with a fresh set of demo data?")) return;
            replaceStateInDb(buildRelativeDemoState(),false,"Loaded demo data");
          }}>✨ Create Demo Data</button>
        </div>
      </div>
      <div className="card">
        <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>💾 Restore Points (3 most recent)</div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:12}}>
          A copy of everything is saved each time a teacher or admin signs in, taken before any
          changes are made that session. Only the three newest are kept — when a fourth is made the
          oldest is deleted for good.
        </div>
        {!(state.saves||[]).length&&<p className="emp">No restore points yet — the first is saved at the next sign-in</p>}
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          {(state.saves||[]).slice().sort((a,b)=>(b.timestamp||0)-(a.timestamp||0)).map((snap,i)=>(
            <div key={snap.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,
              padding:"8px 10px",background:"var(--bg)",borderRadius:7,fontSize:11,flexWrap:"wrap"}}>
              <span>
                📅 {fmt(snap.date)} — {new Date(snap.timestamp).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}
                {i===0&&<span className="bdg bdgg" style={{marginLeft:7}}>Most recent</span>}
              </span>
              <div style={{display:"flex",gap:5}}>
                <button className="bs o" onClick={()=>{
                  if(window.confirm("Roll everything back to "+fmt(snap.date)+" at "+new Date(snap.timestamp).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})+"?\n\nGrades, attendance and everything else recorded since then will be replaced. Your restore points and activity log are kept."))
                    window._restoreSnapshot(snap.id).catch(e=>alert("Failed to restore: "+((e&&e.message)||e)));
                }}>Restore</button>
                <button className="bs r" onClick={()=>{ if(window.confirm("Delete this restore point? Only "+((state.saves||[]).length-1)+" will be left.")) window._deleteSnapshot(snap.id); }}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── PORTAL ───────────────────────────────────────────────────────────────────
function HistoryAttendanceSummary({entry}) {
  const att=entry.snapshot?.attendance?.[entry.studentId]||[];
  const hrs=Math.round(hrsAtt(att));
  const abs=att.filter(r=>r.status==="absent").length;
  const tar=att.filter(r=>r.status==="tardy").length;
  return (
    <div style={{fontSize:11,color:"var(--t2)",padding:"8px 0",borderTop:"1px solid var(--br)"}}>
      📅 Attendance: <strong>{hrs}h</strong> attended · <strong>{abs}</strong> absences · <strong>{tar}</strong> tardies
    </div>
  );
}

function HistoryTab({state,stu}) {
  const myHistory=(state.history||[]).filter(h=>h.studentId===stu.id).sort((a,b)=>b.archivedAt>a.archivedAt?1:-1);
  return (
    <>
      <div style={{fontSize:18,fontWeight:700,marginBottom:6}}>Academic History</div>
      <div style={{fontSize:12,color:"var(--t3)",marginBottom:16}}>Completed school years for {stu.name}.</div>
      {!myHistory.length&&<p className="emp">No archived years yet. Records are saved when grades are promoted at end of year.</p>}
      {myHistory.map(entry=>{
        const isMDNEntry=isMDN(entry.gradeLevel,state.sy?.mdnCutoff);
        const entryAtt=entry.snapshot?.attendance?.[entry.studentId]||[];
        const entryHrs=Math.round(hrsAtt(entryAtt));
        const entryAbs=entryAtt.filter(r=>r.status==="absent").length;
        const entryTar=entryAtt.filter(r=>r.status==="tardy").length;
        const entrySw=entry.snapshot?.sw?.[entry.studentId]||{strengths:[],areas:[]};
        const entrySubs=entry.snapshot?.subjects?.[entry.studentId]||[];
        return (
          <div key={entry.id} className="card" style={{marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,paddingBottom:8,borderBottom:"1px solid var(--br)"}}>
              <div>
                <span style={{fontSize:14,fontWeight:700}}>{entry.gradeLevel}</span>
                <span style={{fontSize:12,color:"var(--t3)",marginLeft:10}}>School Year {entry.schoolYear}</span>
                {entry.graduated&&<span className="bdg bdgg" style={{marginLeft:8}}>🎓 Graduated</span>}
                    {entry.transferred&&<span className="bdg bdgy" style={{marginLeft:8}}>↗ Transferred</span>}
                    {entry.repeated&&<span className="bdg" style={{marginLeft:8,background:"rgba(167,139,250,0.15)",color:"var(--pur)"}}>🔄 Repeat Year</span>}
              </div>
              <span style={{fontSize:10,color:"var(--t3)"}}>Archived {fmt(entry.archivedAt)}</span>
            </div>
            <div style={{marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:600,color:"var(--t3)",marginBottom:6,textTransform:"uppercase",letterSpacing:".04em"}}>Grades</div>
              {entrySubs.map(sub=>{
                const gr=sub.assignments.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined);
                const avg=isMDNEntry?mdnAvg(gr):pctAvg(gr);
                const avd=avg!==null?(isMDNEntry?(avg.toFixed(1)+" ("+(["N","D","M"][Math.round(avg)-1]||"N")+")"):
                  (Math.round(avg)+"% — "+getLetter(avg))):"No grades recorded";
                return (
                  <div key={sub.id} style={{marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:500,marginBottom:3}}>
                      <span>{sub.name}</span><span style={{color:"var(--acc)"}}>{avd}</span>
                    </div>
                    {sub.assignments.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined).map(a=>(
                      <div key={a.id} style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--t3)",padding:"2px 8px"}}>
                        <span>{a.name}</span>
                        <span>{isMDNEntry?(a.score+" ("+(MDN_LBL[a.score]||"")+")"):
                          (a.score+"/"+a.maxScore+" ("+Math.round((parseFloat(a.score)/(a.maxScore||100))*100)+"%)")}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <div style={{fontSize:11,color:"var(--t2)",padding:"8px 0",borderTop:"1px solid var(--br)"}}>
              📅 Attendance: <strong>{entryHrs}h</strong> attended · <strong>{entryAbs}</strong> absences · <strong>{entryTar}</strong> tardies
            </div>
            {((entrySw.strengths||[]).length+(entrySw.areas||[]).length)>0&&(
              <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid var(--br)"}}>
                {(entrySw.strengths||[]).length>0&&<div style={{marginBottom:6}}>
                  <div style={{fontSize:11,fontWeight:600,color:"var(--grn)",marginBottom:3}}>💪 Strengths</div>
                  {entrySw.strengths.map(i=><div key={i.id} style={{fontSize:11,color:"var(--t2)",padding:"2px 0"}}>✨ {i.text}</div>)}
                </div>}
                {(entrySw.areas||[]).length>0&&<div>
                  <div style={{fontSize:11,fontWeight:600,color:"var(--acc)",marginBottom:3}}>🎯 Areas for Improvement</div>
                  {entrySw.areas.map(i=><div key={i.id} style={{fontSize:11,color:"var(--t2)",padding:"2px 0"}}>🔧 {i.text}</div>)}
                </div>}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function PortalSubjectCard({sub,mdn}){
  const [open,setOpen]=useState(false);
  const graded=sub.assignments.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined);
  const avg=mdn?mdnAvg(graded):pctAvg(graded);
  const ltr=avg===null?null:(mdn?(["N","D","M"][Math.round(avg)-1]||"N"):getLetter(avg));
  const col=avg===null?"var(--t3)":(mdn?(avg>=2.5?"var(--grn)":avg>=1.5?"var(--yel)":"var(--red)")
    :(avg>=90?"var(--grn)":avg>=80?"var(--acc)":avg>=70?"var(--yel)":avg>=60?"var(--org)":"var(--red)"));
  const headline=avg===null?"No grades yet":(mdn?(ltr+" — "+(MDN_LBL[ltr]||"")):(Math.round(avg)+"% · "+ltr));
  const sorted=sub.assignments.slice().sort((a,b)=>(b.date>a.date?1:-1));
  const shown=open?sorted:sorted.slice(0,3);
  const pending=sub.assignments.filter(a=>a.score===null||a.score===""||a.score===undefined).length;
  return (
    <div className="card" style={{marginBottom:14,padding:0,overflow:"hidden",borderLeft:"4px solid "+col}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"14px 16px",flexWrap:"wrap"}}>
        <div style={{minWidth:0}}>
          <div style={{fontSize:16,fontWeight:700}}>{sub.emoji?sub.emoji+" ":""}{sub.name}</div>
          <div style={{fontSize:12,color:"var(--t3)",marginTop:2}}>
            {graded.length} graded{pending?" · "+pending+" pending":""}
          </div>
        </div>
        <div style={{fontSize:17,fontWeight:700,color:col,whiteSpace:"nowrap"}}>{headline}</div>
      </div>
      <div style={{borderTop:"1px solid var(--br)"}}>
        {shown.map((a,i)=>{
          const exempt=a.score===EXEMPT;
          const scored=a.score!==null&&a.score!==""&&a.score!==undefined&&!exempt;
          const pct=(!mdn&&scored)?(parseFloat(a.score)/(a.maxScore||100))*100:null;
          const sc=exempt?"Excused":scored?(mdn?(a.score+" · "+(MDN_LBL[a.score]||"")):(a.score+"/"+a.maxScore+" · "+Math.round(pct)+"%")):"Not graded yet";
          const scCol=exempt?"var(--t3)":!scored?"var(--yel)":mdn?(MDN[a.score]>=3?"var(--grn)":MDN[a.score]>=2?"var(--yel)":"var(--red)")
            :(pct>=90?"var(--grn)":pct>=80?"var(--acc)":pct>=70?"var(--yel)":"var(--red)");
          return (
            <div key={a.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,
              padding:"11px 16px",background:i%2?"var(--bg)":"transparent",flexWrap:"wrap"}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{fontSize:14,fontWeight:500}}>{a.name}</div>
                <div style={{fontSize:11,color:"var(--t3)",marginTop:1}}>{fmt(a.dueDate||a.date)}{a.category==="test"?" · Test":""}</div>
              </div>
              <div style={{fontSize:13,fontWeight:600,color:scCol,whiteSpace:"nowrap"}}>{sc}</div>
            </div>
          );
        })}
        {sorted.length>3&&(
          <button className="bs" style={{width:"100%",borderRadius:0,border:"none",borderTop:"1px solid var(--br)",padding:"10px",fontSize:12}}
            onClick={()=>setOpen(o=>!o)}>
            {open?"Show less":"Show all "+sorted.length+" assignments"}
          </button>
        )}
        {!sorted.length&&<div style={{padding:"14px 16px",fontSize:13,color:"var(--t3)",fontStyle:"italic"}}>No assignments yet</div>}
      </div>
    </div>
  );
}

function PortalGradesTab({stu,subs,mdn,state}) {
  const [calcTarget,setCalcTarget]=useState("B");
  const [showCalc,setShowCalc]=useState(false);
  const [portalCalcMode,setPortalCalcMode]=useState("quarter");
  const [calcMode,setCalcMode]=useState("quarter"); // "quarter" | "final"

  const portalCalcQ=()=>{
    const tp=L2P[calcTarget]||75;
    const activeQ3=(state.sy?.quarters||[]).find(q=>{const t=today();return q.startDate&&q.endDate&&t>=q.startDate&&t<=q.endDate;});
    if(!activeQ3) return [];
    return subs.map(sub=>{
      const aq=sub.activeQuarters||[];
      if(aq.length&&!aq.includes(activeQ3.id)) return null;
      const qRecs=sub.assignments.filter(a=>a.date&&a.date>=activeQ3.startDate&&a.date<=activeQ3.endDate);
      const g=qRecs.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined&&a.score!==EXEMPT);
      const u=qRecs.filter(a=>a.score===null||a.score===""||a.score===undefined);
      const ep=g.reduce((s,a)=>s+(parseFloat(a.score)||0),0);
      const mg=g.reduce((s,a)=>s+(a.maxScore||100),0);
      const mr=u.reduce((s,a)=>s+(a.maxScore||100),0);
      const tot=mg+mr; if(!tot) return null;
      const need=((tp/100)*tot-ep);
      const np=mr>0?(need/mr)*100:null;
      return {name:sub.name,emoji:sub.emoji,qLabel:activeQ3.label,np:np!==null?Math.round(np):null,rem:u.length};
    }).filter(Boolean);
  };
  const portalCalcF=()=>{
    const tp=L2P[calcTarget]||75;
    const fqMap2=state.finalizedQuarters||{};
    const allQ=state.sy?.quarters||[];
    return subs.map(sub=>{
      const aq=sub.activeQuarters||[];
      const subQ=allQ.filter(q=>q.startDate&&q.endDate&&(!aq.length||aq.includes(q.id)));
      if(!subQ.length) return null;
      const finalized=subQ.filter(q=>fqMap2[q.id]);
      const remaining=subQ.filter(q=>!fqMap2[q.id]);
      const fPcts=finalized.map(q=>{
        const rec=typeof fqMap2[q.id]==="object"?fqMap2[q.id]:null;
        const start=rec?.startDate||q.startDate; const end=rec?.endDate||q.endDate;
        const gr=sub.assignments.filter(a=>a.score!==null&&a.score!==""&&a.score!==undefined&&a.score!==EXEMPT&&a.date>=start&&a.date<=end);
        return pctAvg(gr);
      }).filter(p=>p!==null);
      const fSum=fPcts.reduce((s,p)=>s+p,0);
      const needed=remaining.length>0?((tp*subQ.length-fSum)/remaining.length):null;
      return {name:sub.name,finalizedCount:finalized.length,totalQ:subQ.length,fAvg:fPcts.length?Math.round(fSum/fPcts.length):null,needed:needed!==null?Math.round(needed):null,remainingCount:remaining.length,achievable:needed===null||needed<=100,alreadyAchieved:needed!==null&&needed<=0};
    }).filter(Boolean);
  };

  return (
    <>
      <div style={{background:"linear-gradient(135deg,rgba(76,175,80,0.1),rgba(167,139,250,0.07))",borderRadius:12,padding:"16px 18px",marginBottom:18,border:"1px solid rgba(76,175,80,0.15)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:20,fontWeight:700}}>📊 Grades</div>
            <div style={{fontSize:12,color:"var(--t3)",marginTop:2}}>{subs.length} subject{subs.length!==1?"s":""} · {mdn?"MDN Scale":"Letter Grades"}</div>
          </div>
          {!mdn&&<button className={"bs"+(showCalc?" p":"")} onClick={()=>setShowCalc(!showCalc)}>🎯 Calculator</button>}
        </div>
      </div>
      {showCalc&&!mdn&&(
        <div style={{background:"var(--c1)",border:"1px solid rgba(76,175,80,.2)",borderRadius:8,padding:14,marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
            <div style={{display:"flex",gap:6}}>
              <button className={"bs"+(portalCalcMode==="quarter"?" p":"")} style={{fontSize:11}} onClick={()=>setPortalCalcMode("quarter")}>📅 Quarter</button>
              <button className={"bs"+(portalCalcMode==="final"?" p":"")} style={{fontSize:11}} onClick={()=>setPortalCalcMode("final")}>🏁 Final</button>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <label style={{fontSize:11}}>Target:</label>
              <select className="ins" value={calcTarget} onChange={e=>setCalcTarget(e.target.value)}>
                {LETTERS.filter(l=>l!=="F").map(l=><option key={l}>{l}</option>)}
              </select>
            </div>
          </div>
          {portalCalcMode==="quarter"&&<CalcQuarterView results={portalCalcQ()} state={state}/>}
          {portalCalcMode==="final"&&<CalcFinalView results={portalCalcF()}/>}
        </div>
      )}
      {!subs.length&&<p className="emp">No subjects yet.</p>}
      {subs.map(sub=><PortalSubjectCard key={sub.id} sub={sub} mdn={mdn}/>)}
    </>
  );
}

function PortalAttendance({stu,att,state}){
  const [openMonth,setOpenMonth]=useState(null);
  const present=att.filter(r=>r.status==="present").length;
  const absent=att.filter(r=>r.status==="absent").length;
  const tardy=att.filter(r=>r.status==="tardy").length;
  const hours=Math.round(hrsAtt(att,state.sy));
  // Roll the day-by-day log up by month so it reads at a glance.
  const byMonth={};
  att.forEach(r=>{ const k=(r.date||"").slice(0,7); if(!k) return; (byMonth[k]=byMonth[k]||[]).push(r); });
  const months=Object.keys(byMonth).sort().reverse();
  const label=(k)=>new Date(k+"-15T12:00:00").toLocaleString("en-US",{month:"long",year:"numeric"});
  return (
    <>
      <div style={{background:"linear-gradient(135deg,rgba(74,222,128,0.08),rgba(76,175,80,0.05))",borderRadius:12,padding:"16px 18px",marginBottom:18,border:"1px solid rgba(74,222,128,0.15)"}}>
        <div style={{fontSize:20,fontWeight:700,marginBottom:2}}>📅 Attendance</div>
        <div style={{fontSize:12,color:"var(--t3)"}}>{stu.gradeLevel} · {state.sy?.startDate?("School Year "+state.sy.startDate.slice(0,4)+"–"+state.sy.endDate.slice(0,4)):"Current Year"}</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:10,marginBottom:18}}>
        {[{l:"Present",v:present,c:"var(--grn)"},{l:"Absent",v:absent,c:"var(--red)"},{l:"Tardy",v:tardy,c:"var(--yel)"},{l:"Hours",v:hours,c:"var(--acc)"}].map(c=>(
          <div key={c.l} className="sc" style={{borderTop:"3px solid "+c.c}}><div className="sv" style={{fontSize:26,color:c.c}}>{c.v}</div><div className="sl">{c.l}</div></div>
        ))}
      </div>
      <div className="stit">By month</div>
      {!months.length&&<p className="emp">No attendance recorded yet.</p>}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {months.map(k=>{
          const recs=byMonth[k].slice().sort((a,b)=>(b.date>a.date?1:-1));
          const p=recs.filter(r=>r.status==="present").length;
          const a2=recs.filter(r=>r.status==="absent").length;
          const t=recs.filter(r=>r.status==="tardy").length;
          const h=Math.round(recs.reduce((s,r)=>s+(r.hours||0),0));
          const open=openMonth===k;
          return (
            <div key={k} className="card" style={{padding:0,overflow:"hidden"}}>
              <button onClick={()=>setOpenMonth(open?null:k)} style={{width:"100%",background:"none",border:"none",cursor:"pointer",
                display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"13px 16px",fontFamily:"inherit",textAlign:"left",flexWrap:"wrap"}}>
                <div style={{fontSize:15,fontWeight:600}}>{label(k)}</div>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",fontSize:12}}>
                  <span style={{color:"var(--grn)",fontWeight:600}}>{p} present</span>
                  {a2>0&&<span style={{color:"var(--red)",fontWeight:600}}>{a2} absent</span>}
                  {t>0&&<span style={{color:"var(--yel)",fontWeight:600}}>{t} tardy</span>}
                  <span style={{color:"var(--t3)"}}>{h}h</span>
                  <span style={{color:"var(--t3)",fontSize:11}}>{open?"▲":"▼"}</span>
                </div>
              </button>
              {open&&<div style={{borderTop:"1px solid var(--br)"}}>
                {recs.map((r,i)=>(
                  <div key={r.id} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 16px",fontSize:13,background:i%2?"var(--bg)":"transparent"}}>
                    <span style={{flex:1}}>{fmt(r.date)}</span>
                    <span className={"bdg"+(r.status==="present"?" bdgg":r.status==="absent"?" bdgr":" bdgy")}>{r.status}</span>
                    <span style={{color:"var(--t3)",width:36,textAlign:"right"}}>{r.hours}h</span>
                  </div>
                ))}
              </div>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function PortalEventsTab({stu,state,upd,user,isMobile}) {
  const [calMonth,setCalMonth]=useState(new Date().getFullYear()+"-"+String(new Date().getMonth()+1).padStart(2,"0"));
  const [calSearch,setCalSearch]=useState("");
  const [showAssignments,setShowAssignments]=useState(true);
  const [viewingDue,setViewingDue]=useState(null);
  const [viewingEvent,setViewingEvent]=useState(null);
  const [slipConfirm,setSlipConfirm]=useState(null);
  const isParent=user.role==="parent";
  const myResp=(e)=>{const r=e.responses?.[stu.id];return typeof r==="string"?r:(r&&r.status)||"";};
  // Submit (or change) a permission-slip answer for this student.
  const submitSlip=(evId,status)=>{
    const payload={status:status,ts:Date.now(),by:user.name};
    if(window._submitSlip) window._submitSlip(stu.id,evId,payload);
    else upd(p2=>({...p2,events:p2.events.map(ev=>ev.id===evId?{...ev,responses:{...ev.responses,[stu.id]:payload}}:ev)}));
    setSlipConfirm(null); setViewingEvent(null);
  };

  const events=(state.events||[]).filter(e=>e.assignedStudents?.includes(stu.id));
  const thirtyDays=new Date(); thirtyDays.setDate(thirtyDays.getDate()+30);
  const thirtyStr=thirtyDays.toISOString().slice(0,10);
  const allItems=[...events.map(e=>({...e,_type:"event"}))];
  const quarterItems=buildQuarterItems(state.sy,state.finalizedQuarters);
  const qStartItems=quarterItems.filter(q=>q.qType==="start"&&q.startDate>=today()&&q.startDate<=thirtyStr);
  const upcoming=[
    ...allItems.filter(e=>e.endDate>=today()&&e.startDate<=thirtyStr),
    ...qStartItems,
  ].sort((a,b)=>a.startDate>b.startDate?1:-1);
  // Only this student's assignments
  const dueDateMap=buildDueDateMap(state,stu.id);
  const upcomingDues=showAssignments?Object.entries(dueDateMap).filter(([d])=>d>=today()&&d<=thirtyStr).sort(([a],[b])=>a>b?1:-1):[];
  // Slips still open (event hasn't finished) split into needs-answer / answered.
  const slipAll=events.filter(e=>e.permissionSlip&&(!e.endDate||e.endDate>=today()));
  const slipPending=slipAll.filter(e=>!myResp(e)).sort((a,b)=>a.startDate>b.startDate?1:-1);
  const slipAnswered=slipAll.filter(e=>myResp(e)).map(e=>({e:e,my:myResp(e),ts:(e.responses?.[stu.id]||{}).ts}))
    .sort((a,b)=>a.e.startDate>b.e.startDate?1:-1);
  const ev2=viewingEvent?events.find(e=>e.id===viewingEvent):null;

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
        <div style={{fontSize:20,fontWeight:700}}>Events &amp; Schedule</div>
        {slipPending.length>0&&<span className="bdg bdgy" style={{fontSize:11}}>{slipPending.length} permission slip{slipPending.length!==1?"s":""} need{slipPending.length===1?"s":""} a response</span>}
      </div>
      {slipConfirm&&<div className="mo"><div className="md" style={{maxWidth:430}}>
        <div className="mdt">{slipConfirm.status==="authorized"?"Approve permission?":"Decline permission?"}</div>
        <div style={{fontSize:15,lineHeight:1.6,marginBottom:10}}>
          {slipConfirm.status==="authorized"
            ?<span>Approve <strong>{stu.name}</strong> to attend <strong>{slipConfirm.ev.name}</strong>?</span>
            :<span>Decline permission for <strong>{stu.name}</strong> to attend <strong>{slipConfirm.ev.name}</strong>?</span>}
        </div>
        <div style={{fontSize:12,color:"var(--t2)",background:"var(--bg)",borderRadius:8,padding:"9px 11px"}}>
          <div>📅 {fmt(slipConfirm.ev.startDate)}{slipConfirm.ev.endDate&&slipConfirm.ev.endDate!==slipConfirm.ev.startDate?" – "+fmt(slipConfirm.ev.endDate):""}</div>
          {slipConfirm.ev.location&&<div style={{marginTop:3}}>📍 {slipConfirm.ev.location}</div>}
          {slipConfirm.ev.description&&<div style={{marginTop:3}}>📝 {slipConfirm.ev.description}</div>}
        </div>
        <div style={{fontSize:11,color:"var(--t3)",marginTop:10}}>You can change your answer later if you need to.</div>
        <div className="mda">
          <button className="bg" onClick={()=>setSlipConfirm(null)}>Cancel</button>
          <button className={slipConfirm.status==="authorized"?"bp":"bs r"} style={slipConfirm.status==="authorized"?null:{padding:"7px 16px",fontWeight:600}}
            onClick={()=>submitSlip(slipConfirm.ev.id,slipConfirm.status)}>
            {slipConfirm.status==="authorized"?"Yes, approve":"Yes, decline"}
          </button>
        </div>
      </div></div>}

      {/* Event detail modal */}
      {ev2&&<div className="mo"><div className="md">
        <div className="mdt">{ev2.name}</div>
        <div style={{fontSize:13,marginBottom:10}}>
          <div>📍 {ev2.location}</div>
          <div>📅 {fmt(ev2.startDate)}{ev2.startDate!==ev2.endDate?" – "+fmt(ev2.endDate):""}</div>
          {ev2.description&&<div style={{marginTop:4}}>📝 {ev2.description}</div>}
        </div>
        {ev2.permissionSlip&&(()=>{
          const myR=ev2.responses?.[stu.id];
          const my=typeof myR==="string"?myR:myR?.status;
          return <div>
            {my?<div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span className={"bdg"+(my==="authorized"?" bdgg":" bdgr")}>{my==="authorized"?"✓ Approved":"✗ Declined"}</span>
                {myR?.ts&&<span style={{fontSize:10,color:"var(--t3)"}}>{new Date(myR.ts).toLocaleDateString()}</span>}
                {isParent&&<button className="bs" style={{fontSize:11}} onClick={()=>setSlipConfirm({ev:ev2,status:my==="authorized"?"not_authorized":"authorized",changing:true})}>Change to {my==="authorized"?"Declined":"Approved"}</button>}
              </div>:(
              user.role==="student"
                ?<span className="bdg bdgy">⏳ Awaiting parent authorization</span>
                :<div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <button className="bp" style={{fontSize:12}} onClick={()=>setSlipConfirm({ev:ev2,status:"authorized"})}>✓ Approve</button>
                  <button className="bs r" onClick={()=>setSlipConfirm({ev:ev2,status:"not_authorized"})}>✗ Decline</button>
                </div>
            )}
          </div>;
        })()}
        <div className="mda"><button className="bg" onClick={()=>setViewingEvent(null)}>Close</button></div>
      </div></div>}

      {/* Due detail modal */}
      {viewingDue&&<div className="mo"><div className="md" style={{maxWidth:460}}>
        <div className="mdt">{viewingDue.items[0]?.category==="test"?"📋 Quiz/Test — ":"📝 Homework — "}{fmt(viewingDue.date)}</div>
        {viewingDue.items.map((item,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",background:"var(--bg)",borderRadius:7,fontSize:12,marginBottom:5}}>
            <div><div style={{fontWeight:600}}>{item.assignName}</div><div style={{fontSize:10,color:"var(--t3)"}}>{item.subjectName}</div></div>
<span style={{fontSize:10,color:fmtScore(item)?"var(--grn)":"var(--yel)",fontFamily:fmtScore(item)?"'JetBrains Mono',monospace":"inherit"}}>
              {fmtScore(item)||"⏳ Pending"}
            </span>
          </div>
        ))}
        <div className="mda"><button className="bg" onClick={()=>setViewingDue(null)}>Close</button></div>
      </div></div>}

      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"minmax(0,1fr) 300px",gap:16,alignItems:"start"}}>
        <div>
      {/* Calendar */}
      <div className="card" style={{marginBottom:18}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
          <button className="bs" onClick={()=>{const[y,m]=calMonth.split("-").map(Number);const d=new Date(y,m-2,1);setCalMonth(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"));}}>‹</button>
          <span style={{fontSize:14,fontWeight:700,minWidth:140,textAlign:"center"}}>{new Date(calMonth+"-15").toLocaleString("en-US",{month:"long",year:"numeric"})}</span>
          <button className="bs" onClick={()=>{const[y,m]=calMonth.split("-").map(Number);const d=new Date(y,m,1);setCalMonth(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"));}}>›</button>
          <button className="bs" style={{fontSize:10}} onClick={()=>setCalMonth(()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");})}>Today</button>
          <input className="ins" placeholder="Search events..." value={calSearch} onChange={e=>setCalSearch(e.target.value)} style={{flex:1,minWidth:100}}/>
          {calSearch&&<button className="bx" onClick={()=>setCalSearch("")}>×</button>}
          <button className={"bs"+(showAssignments?" p":"")} style={{fontSize:10}} onClick={()=>setShowAssignments(v=>!v)}>📚 {showAssignments?"Hide":"Assignments"}</button>
        </div>
        {calSearch?(
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {allItems.filter(e=>e.name.toLowerCase().includes(calSearch.toLowerCase())).length===0&&<p className="emp">No events match</p>}
            {allItems.filter(e=>e.name.toLowerCase().includes(calSearch.toLowerCase())).sort((a,b)=>a.startDate>b.startDate?1:-1).map(e=>(
              <div key={e.id} style={{display:"flex",justifyContent:"space-between",padding:"7px 10px",background:"var(--bg)",borderRadius:7,fontSize:12}}>
                <span style={{fontWeight:600}}>{e.name}</span>
                <span style={{color:"var(--t3)",fontSize:11}}>{fmt(e.startDate)}</span>
              </div>
            ))}
          </div>
        ):(
          <EventCalendarGrid calMonth={calMonth} state={{...state,events}} setViewing={setViewingEvent}
            showAssignments={showAssignments} dueDateMap={dueDateMap}
            onViewDue={(date,items)=>setViewingDue({date,items})}
            quarterItems={quarterItems} portalMode={true} compact={isMobile}/>
        )}
          {isMobile&&(()=>{
            // Phone: the grid only shows dots, so list the month in full here.
            const mStart=calMonth+"-01";
            const mEnd=calMonth+"-31";
            // The grid above also dots breaks and cancellations, so list them
            // here too — every dot needs a row to explain it.
            const evs=calendarItems(events,state.specialDays)
              .filter(e=>e.endDate>=mStart&&e.startDate<=mEnd)
              .map(e=>({date:e.startDate,end:e.endDate,kind:e.eventId?"event":"special",
                name:e.name,sub:e.location||"",id:e.eventId,color:calDotEvent(e)}));
            const dues=Object.entries(dueDateMap||{}).filter(([d])=>d>=mStart&&d<=mEnd)
              .map(([d,items])=>({date:d,kind:"due",name:items.length===1?items[0].assignName:items.length+" assignments due",
                sub:items.length===1?items[0].subjectName:items.map(i=>i.subjectName).join(", "),items:items,
                color:calDotDue()}));
            const qs=(quarterItems||[]).filter(q=>(q.startDate>=mStart&&q.startDate<=mEnd)||(q.endDate>=mStart&&q.endDate<=mEnd))
              .map(q=>({date:q.qType==="end"?q.endDate:q.startDate,kind:"quarter",name:q.name,sub:"",color:calDotQuarter(q)}));
            const rows=[...evs,...(showAssignments?dues:[]),...qs].sort((a,b)=>a.date>b.date?1:-1);
            return (
              <div style={{marginTop:14,borderTop:"1px solid var(--br)",paddingTop:12}}>
                <div className="stit">This month</div>
                {!rows.length&&<p className="emp" style={{fontSize:12}}>Nothing scheduled this month.</p>}
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {rows.map((r,i)=>(
                    <div key={i} onClick={()=>{ if(r.kind==="event") setViewingEvent(r.id); else if(r.kind==="due") setViewingDue({date:r.date,items:r.items}); }}
                      style={{display:"flex",gap:10,alignItems:"flex-start",padding:"9px 10px",borderRadius:8,background:"var(--bg)",
                        cursor:r.kind==="event"||r.kind==="due"?"pointer":"default"}}>
                      <span style={{width:8,height:8,borderRadius:"50%",marginTop:5,flexShrink:0,background:r.color}}/>
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontSize:13,fontWeight:600}}>{r.name}</div>
                        <div style={{fontSize:11,color:"var(--t3)",marginTop:1}}>
                          {fmt(r.date)}{r.end&&r.end!==r.date?" – "+fmt(r.end):""}{r.sub?" · "+r.sub:""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

      </div>
        </div>

        <div>
          <div className="card" style={{marginBottom:18}}>
            <div className="stit">📋 Permission Slips</div>
            {!slipPending.length&&!slipAnswered.length&&<p className="emp" style={{fontSize:12}}>Nothing needs a response.</p>}
            {slipPending.map(e=>(
              <div key={e.id} style={{padding:"11px 12px",borderRadius:9,background:"rgba(251,191,36,0.08)",
                border:"1px solid rgba(251,191,36,0.35)",marginBottom:9}}>
                <div style={{fontSize:13,fontWeight:600}}>{e.name}</div>
                <div style={{fontSize:11,color:"var(--t3)",marginTop:2}}>{fmt(e.startDate)}{e.location?" · "+e.location:""}</div>
                {isParent?(
                  <div style={{display:"flex",gap:6,marginTop:9,flexWrap:"wrap"}}>
                    <button className="bp" style={{fontSize:11,padding:"5px 12px"}} onClick={()=>setSlipConfirm({ev:e,status:"authorized"})}>✓ Approve</button>
                    <button className="bs r" style={{fontSize:11}} onClick={()=>setSlipConfirm({ev:e,status:"not_authorized"})}>✗ Decline</button>
                  </div>
                ):<span className="bdg bdgy" style={{marginTop:8,display:"inline-block"}}>⏳ Awaiting parent</span>}
              </div>
            ))}
            {slipAnswered.map(({e,my,ts})=>(
              <div key={e.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,
                padding:"9px 12px",borderRadius:9,background:"var(--bg)",marginBottom:7,flexWrap:"wrap"}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:600}}>{e.name}</div>
                  <div style={{fontSize:10,color:"var(--t3)"}}>{fmt(e.startDate)}</div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <span className={"bdg"+(my==="authorized"?" bdgg":" bdgr")}>{my==="authorized"?"✓ Approved":"✗ Declined"}</span>
                  {isParent&&<button className="bs" style={{fontSize:10}}
                    onClick={()=>setSlipConfirm({ev:e,status:my==="authorized"?"not_authorized":"authorized",changing:true})}>Change</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Upcoming list */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div className="stit">Upcoming <span style={{fontSize:10,color:"var(--t3)",fontWeight:400}}>(next 30 days)</span></div>
        <button className={"bs"+(showAssignments?" p":"")} style={{fontSize:10}} onClick={()=>setShowAssignments(v=>!v)}>📚 {showAssignments?"Hide":"Assignments"}</button>
      </div>
      {!upcoming.length&&!upcomingDues.length&&<p className="emp">Nothing scheduled in the next 30 days</p>}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {upcoming.map(e=>
          e._type==="quarter"?(
            <div key={e.id} className="ecard" style={{borderColor:"rgba(74,222,128,0.3)"}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div className="edb" style={{background:"rgba(74,222,128,0.1)"}}>
                  <div className="edm" style={{color:"var(--grn)"}}>{new Date(e.startDate+"T12:00:00").toLocaleString("en-US",{month:"short"})}</div>
                  <div className="edd">{new Date(e.startDate+"T12:00:00").getDate()}</div>
                </div>
                <div style={{fontSize:13,fontWeight:600,color:"var(--grn)"}}>🟩 {e.name}</div>
              </div>
            </div>
          ):(
          <div key={e.id} className="ecard">
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div className="edb">
                <div className="edm">{new Date(e.startDate+"T12:00:00").toLocaleString("en-US",{month:"short"})}</div>
                <div className="edd">{new Date(e.startDate+"T12:00:00").getDate()}</div>
              </div>
              <div>
                <div style={{fontSize:13,fontWeight:600}}>{e.name}</div>
                <div style={{fontSize:11,color:"var(--t3)"}}>📍 {e.location}</div>
                {e.description&&<div style={{fontSize:11,color:"var(--t2)",marginTop:2}}>{e.description}</div>}
                {e.permissionSlip&&(()=>{
                  const myR=e.responses?.[stu.id];
                  const my=typeof myR==="string"?myR:myR?.status;
                  if(my) return <span className={"bdg"+(my==="authorized"?" bdgg":" bdgr")} style={{marginTop:4,display:"inline-block"}}>{my==="authorized"?"✓ Authorized":"✗ Not Authorized"}</span>;
                  return <span className="bdg bdgy">📋 Permission required</span>;
                })()}
              </div>
            </div>
            <button className="bs" onClick={()=>setViewingEvent(e.id)}>View</button>
          </div>
        ))}
        {upcomingDues.map(([date,items])=>(
          <div key={date} className="ecard" style={{borderColor:"rgba(167,139,250,0.3)",cursor:"pointer"}} onClick={()=>setViewingDue({date,items})}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div className="edb" style={{background:"rgba(167,139,250,0.1)"}}>
                <div className="edm" style={{color:"var(--pur)"}}>{new Date(date+"T12:00:00").toLocaleString("en-US",{month:"short"})}</div>
                <div className="edd">{new Date(date+"T12:00:00").getDate()}</div>
              </div>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:"var(--pur)"}}>📚 Due Assignments</div>
                <div style={{fontSize:11,color:"var(--t3)"}}>{items.length} assignment(s) due</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Portal({state,upd,user,logout,isMobile}) {
  const [tab,setTab]=useState("calendar");
  const tourKey="hsa3_portal_toured_"+user.id;
  const [tourStep,setTourStep]=useState(0);
  const endTour=()=>setTourStep(-1);
  const [showPwReset,setShowPwReset]=useState(false);
  const [pwForm,setPwForm]=useState({current:"",next:"",confirm:""});
  const [pwError,setPwError]=useState("");
  const [selectedStuId,setSelectedStuId]=useState(null);
  const myStudentIds=getStudentIdsForUser(user);
  const myStudents=state.students.filter(s=>myStudentIds.includes(s.id));
  const stu=selectedStuId?state.students.find(s=>s.id===selectedStuId):myStudents[0];
  if(!stu) return (
    <div className="psh">
      <div className="phdr"><span>🏫 Empower Iowa - Elim Springs Campus Portal</span><button className="bg" onClick={logout}>Sign Out</button></div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"60vh",color:"var(--t3)",fontStyle:"italic"}}>No student linked to your account. Contact your teacher.</div>
    </div>
  );
  const mdn=isMDN(stu.gradeLevel,state.sy?.mdnCutoff);
  const subs=state.subjects[stu.id]||[];
  const att=state.attendance[stu.id]||[];
  const events=(state.events||[]).filter(e=>e.assignedStudents?.includes(stu.id));
  const sw=state.sw[stu.id]||{strengths:[],areas:[]};
  return (
    <div className="psh">
      <div className="phdr">
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,var(--acc),var(--pur))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:700,color:"#0a0e1a",flexShrink:0}}>{stu.name[0]}</div>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:"#f1f5f9"}}>{stu.name}</div>
            <div style={{fontSize:10,color:"#94a3b8"}}>{stu.gradeLevel} · Empower Iowa</div>
          </div>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          {[["grades","Grades"],["calendar","Calendar"],["attendance","Attendance"],["notes","Notes"],["history","History"]].map(([t,l])=>(
            <button key={t} className={"ptab"+(tab===t?" on":"")} onClick={()=>setTab(t)}>{l}</button>
          ))}
          <button style={{fontSize:10,padding:"4px 8px",background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:7,color:"#e2e8f0",cursor:"pointer",fontFamily:"inherit"}} onClick={()=>setTourStep(0)}>? Tour</button>
          <button style={{fontSize:11,padding:"5px 10px",background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:7,color:"#e2e8f0",cursor:"pointer",fontFamily:"inherit"}} onClick={()=>setShowPwReset(true)}>🔑 Password</button>
          <button style={{fontSize:11,padding:"5px 10px",background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:7,color:"#e2e8f0",cursor:"pointer",fontFamily:"inherit"}} onClick={logout}>Sign Out</button>
        </div>
      </div>
      {showPwReset&&<div className="mo"><div className="md" style={{maxWidth:400}}>
        <div className="mdt">🔑 Change Password</div>
        <div className="fg">
          <label>New Password</label>
          <input className="inp" type="password" value={pwForm.next} onChange={e=>setPwForm(f=>({...f,next:e.target.value}))} placeholder="New password"/>
          <label>Confirm</label>
          <input className="inp" type="password" value={pwForm.confirm} onChange={e=>setPwForm(f=>({...f,confirm:e.target.value}))} placeholder="Confirm new password"/>
          <PwChecklist pw={pwForm.next} email={(user||{}).email}/>
        </div>
        {pwError&&<div style={{color:"var(--red)",fontSize:12,marginBottom:10}}>{pwError}</div>}
        <div className="mda">
          <button className="bg" onClick={()=>{setShowPwReset(false);setPwForm({current:"",next:"",confirm:""});setPwError("");}}>Cancel</button>
          <button className="bp" onClick={()=>{
            if(!pwForm.next){setPwError("Enter a new password.");return;}
            if(pwForm.next!==pwForm.confirm){setPwError("Passwords do not match.");return;}
            if(window._pwIssues(pwForm.next,(user||{}).email).length){setPwError("Please meet all the password requirements below.");return;}
            const fbAuth=window._firebaseAuth||window._auth;
            if(fbAuth&&fbAuth.currentUser){
              fbAuth.currentUser.updatePassword(pwForm.next).then(()=>{
                setShowPwReset(false);setPwForm({current:"",next:"",confirm:""});setPwError("");
                alert("Password updated successfully!");
              }).catch(e=>{
                if(e.code==="auth/requires-recent-login"){
                  setPwError("Session expired. Please sign out and sign back in, then try again.");
                } else {
                  setPwError("Error: "+e.message);
                }
              });
            } else {
              setPwError("Not connected to Firebase. Password change unavailable.");
            }
          }}>Update Password</button>
        </div>
        <MfaSection/>
      </div></div>}
      <div className="pcont">
        {tourStep>=0&&<TourOverlay steps={PORTAL_TOUR} stepIdx={tourStep} onNext={()=>setTourStep(s=>s+1)} onBack={()=>setTourStep(s=>Math.max(0,s-1))} onEnd={endTour} onTabChange={t=>setTab(t)}/>}
        {tab==="grades"&&<PortalGradesTab stu={stu} subs={subs} mdn={mdn} state={state}/>}
        {tab==="attendance"&&<PortalAttendance stu={stu} att={att} state={state}/>}
        {tab==="calendar"&&<PortalEventsTab stu={stu} state={state} upd={upd} user={user} isMobile={isMobile}/>}
        {tab==="notes"&&<>
          <div style={{background:"linear-gradient(135deg,rgba(167,139,250,0.08),rgba(76,175,80,0.05))",borderRadius:12,padding:"16px 18px",marginBottom:18,border:"1px solid rgba(167,139,250,0.15)"}}>
            <div style={{fontSize:18,fontWeight:700,marginBottom:2}}>📝 Teacher Notes</div>
            <div style={{fontSize:11,color:"var(--t3)"}}>Feedback and observations from your teacher</div>
          </div>
          <div className="nps">
            {[{type:"strengths",label:"💪 Strengths",icon:"✨"},{type:"areas",label:"🎯 Areas for Improvement",icon:"🔧"}].map(({type,label,icon})=>(
              <div key={type} className="card">
                <div style={{fontSize:13,fontWeight:600,marginBottom:10}}>{label}</div>
                {(sw[type]||[]).length?(sw[type]||[]).map(i=><div key={i.id} style={{padding:"5px 0",borderBottom:"1px solid var(--br)",fontSize:12}}>{icon} {i.text} <span style={{fontSize:10,color:"var(--t3)",marginLeft:8}}>{fmt(i.date)}</span></div>):<em style={{fontSize:12,color:"var(--t3)"}}>None noted yet</em>}
              </div>
            ))}
          </div>
        </>}
        {tab==="history"&&<HistoryTab state={state} stu={stu}/>}
      </div>
    </div>
  );
}

function _AppRoot(){
  const [state,setState]=React.useState(window._appState||{});
  const [user,setUser]=React.useState(window._appUser||{});
  const [accounts,setAccounts]=React.useState(window._accounts||[]);

  React.useEffect(()=>{
    window._renderApp=(newState,newUser)=>{
      if(newState) setState(newState);
      if(newUser) setUser(newUser);
    };
    window._renderAccounts=setAccounts;
    // If state already loaded, trigger a render update
    if(window._appState) setState(window._appState);
    if(window._appUser) setUser(window._appUser);
    if(window._accounts) setAccounts(window._accounts);
  },[]);

  const upd=fn=>{
    setState(prev=>{
      const next=typeof fn==="function"?fn(prev):fn;
      saveState(next);
      return next;
    });
  };

  const isMobile=window.innerWidth<768;

  if(!state||!state.students||!user||!user.role) return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",color:"#4caf50",fontSize:14}}>
      Loading...
    </div>
  );

  if(user.role!=="admin"&&user.role!=="teacher"&&user.role!=="parent"&&user.role!=="student") return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",color:"#94a3b8",fontSize:14,textAlign:"center",padding:"0 24px"}}>Account not set up. Please contact your teacher.</div>
  );
  if(user.role==="admin"||user.role==="teacher") return <TeacherApp state={state} accounts={accounts} upd={upd} user={user} logout={doLogout} isMobile={isMobile}/>;
  return <Portal state={state} upd={upd} user={user} logout={doLogout} isMobile={isMobile}/>;
}

ReactDOM.createRoot(document.getElementById("app-root")).render(
  React.createElement(_AppRoot, {})
);
