const express=require('express'),http=require('http'),path=require('path'),{Server}=require('socket.io');
const CASES=require('./cases');
const app=express(),srv=http.createServer(app),io=new Server(srv);
app.use(express.static(path.join(__dirname,'public')));
app.get('/health',(q,s)=>s.send('ok'));
const rooms={},MAX={culprit:10,motive:30,contra:15,note:5,present:20,debate:20};
const FIELDS=['culprit','motive','contra','note','opp','rebut'];
const rid=()=>Math.random().toString(36).slice(2,10);
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
const STOP=new Set(['في','من','على','الي','عن','ان','انه','هو','هي','ما','لا','او','ثم','كان','قد','مع','هذا','هذه']);
const norm=s=>String(s||'').replace(/[\u064B-\u0652\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ');
const toks=s=>[...new Set(norm(s).split(/\s+/).map(w=>w.replace(/^(وال|بال|لل|ال)/,'')).filter(w=>w.length>1&&!STOP.has(w)))];
const sim=(m,a)=>{const M=toks(m),A=new Set(toks(a));return M.length&&A.size?M.filter(w=>A.has(w)).length/M.length:0};
const sug=(c,a)=>{const m=CASES[c],f=(t,x,max,k)=>{const s=sim(t,x);return{sim:Math.round(s*100),pts:Math.round(Math.min(1,s*k)*max)}};
  return{culprit:f(m.c,a.culprit,10,2.2),motive:f(m.m,a.motive,30,1.6),contra:f(m.x,a.contra,15,1.6)}};
const tot=t=>t.scores?Object.values(t.scores).reduce((a,b)=>a+b,0):0;
function newRoom(n){let c;do{c=Math.random().toString(36).slice(2,6).toUpperCase()}while(rooms[c]);
  return rooms[c]={code:c,created:Date.now(),hostToken:rid(),phase:'lobby',minutes:10,endsAt:0,socks:new Set(),
  pool:shuffle(CASES.map((_,i)=>i)),
  teams:Array.from({length:n},(_,i)=>({id:i,name:'',players:[],caseId:null,target:null,ans:{},submitted:false,scores:null,notes:{}}))}}
const tv=t=>({id:t.id,name:t.name||('مجموعة '+(t.id+1)),named:!!t.name,players:t.players.map(p=>p.name),submitted:t.submitted});
const cs=i=>({t:CASES[i].t,e:CASES[i].e,s:CASES[i].s});
function view(r,role,ti){
  const v={code:r.code,phase:r.phase,minutes:r.minutes,endsAt:r.endsAt,now:Date.now(),role};
  if(role==='host'){
    v.pool=r.pool.map(i=>({id:i,t:CASES[i].t,e:CASES[i].e,idea:CASES[i].s.split('،')[0].split('.')[0].slice(0,70)}));
    v.teams=r.teams.map(t=>{const o=tv(t);o.caseId=t.caseId;o.target=t.target;o.ans=t.ans;o.scores=t.scores;o.notes=t.notes;o.total=tot(t);
      if(t.caseId!=null){const m=CASES[t.caseId];o.case=cs(t.caseId);o.model={c:m.c,m:m.m,x:m.x};if(t.submitted)o.sug=sug(t.caseId,t.ans)}return o});
  }else{
    const t=r.teams[ti];v.teams=r.teams.map(tv);v.me=tv(t);v.ans=t.ans;
    if(r.phase!=='lobby'&&t.caseId!=null){v.case=cs(t.caseId);const g=r.teams[t.target];v.target={name:tv(g).name,case:cs(g.caseId)}}
    if(r.phase==='final'){v.scores=t.scores||{};v.notes=t.notes;v.total=tot(t)}
  }return v}
function push(r){for(const id of r.socks){const s=io.sockets.sockets.get(id);if(!s){r.socks.delete(id);continue}s.emit('state',view(r,s.data.role,s.data.ti))}}
function lock(r){r.teams.forEach(t=>t.submitted=true);r.phase='grading';push(r)}
setInterval(()=>{for(const r of Object.values(rooms)){if(r.phase==='prep'&&Date.now()>=r.endsAt)lock(r);if(Date.now()-r.created>12*3600e3)delete rooms[r.code]}},1000);
io.on('connection',sock=>{
  const reg=(r,role,ti)=>{sock.data={code:r.code,role,ti};r.socks.add(sock.id);push(r)};
  const H=()=>{const r=rooms[sock.data&&sock.data.code];return r&&sock.data.role==='host'?r:null};
  sock.on('host:create',(n,ack)=>{const r=newRoom(Math.min(6,Math.max(2,+n||3)));reg(r,'host');ack&&ack({code:r.code,token:r.hostToken})});
  sock.on('host:auth',(d,ack)=>{const r=rooms[String(d&&d.code).toUpperCase()];if(!r||r.hostToken!==d.token)return ack&&ack(false);reg(r,'host');ack&&ack(true)});
  sock.on('player:join',(d,ack)=>{d=d||{};const r=rooms[String(d.code).toUpperCase()],t=r&&r.teams[+d.slot];
    if(!t)return ack({err:'رابط الدعوة غير صحيح'});if(r.phase!=='lobby')return ack({err:'اللعبة بدأت'});
    const name=String(d.name||'').trim().slice(0,30),tn=String(d.teamName||'').trim().slice(0,30);
    if(!name)return ack({err:'اكتب اسمك'});if(!t.name&&!tn)return ack({err:'اكتب اسم المجموعة'});
    if(!t.name)t.name=tn;const p={id:rid(),name};t.players.push(p);reg(r,'team',t.id);ack({pid:p.id})});
  sock.on('player:auth',(d,ack)=>{d=d||{};const r=rooms[String(d.code).toUpperCase()],t=r&&r.teams[+d.slot];
    if(!t||!t.players.some(p=>p.id===d.pid))return ack&&ack(false);reg(r,'team',t.id);ack&&ack(true)});
  sock.on('team:save',a=>{const r=rooms[sock.data.code];if(!r||sock.data.role!=='team'||r.phase!=='prep')return;const t=r.teams[sock.data.ti];if(t.submitted||!a)return;
    FIELDS.forEach(f=>{if(typeof a[f]==='string')t.ans[f]=a[f].slice(0,2000)});push(r)});
  sock.on('team:submit',a=>{const r=rooms[sock.data.code];if(!r||sock.data.role!=='team'||r.phase!=='prep')return;const t=r.teams[sock.data.ti];
    if(a)FIELDS.forEach(f=>{if(typeof a[f]==='string')t.ans[f]=a[f].slice(0,2000)});t.submitted=true;
    if(r.teams.every(x=>x.submitted))r.phase='grading';push(r)});
  const assign=(r,list)=>{const ids=list.map(x=>+x.caseId);if(new Set(ids).size!==ids.length||ids.some(i=>!CASES[i]))return 'اختر قضايا مختلفة لكل مجموعة';
    for(let i=0;i<list.length;i++){const g=+list[i].target;if(!r.teams[g]||g===i)return 'حدد خصماً مختلفاً لكل مجموعة'}
    list.forEach((x,i)=>{r.teams[i].caseId=+x.caseId;r.teams[i].target=+x.target});return ''};
  sock.on('host:random',ack=>{const r=H();if(!r||r.phase!=='lobby')return;r.pool=shuffle(r.pool);const n=r.teams.length;
    assign(r,r.teams.map((t,i)=>({caseId:r.pool[i],target:(i+1)%n})));push(r);ack&&ack('')});
  sock.on('host:assign',(list,ack)=>{const r=H();if(!r||r.phase!=='lobby'||!Array.isArray(list)||list.length!==r.teams.length)return;
    const e=assign(r,list);if(!e)push(r);ack&&ack(e)});
  sock.on('host:start',(m,ack)=>{const r=H();if(!r||r.phase!=='lobby')return;
    if(r.teams.some(t=>t.caseId==null))return ack&&ack('وزّع القضايا أولاً');
    const e=r.teams.find(t=>!t.players.length);if(e)return ack&&ack('لم ينضم أحد إلى '+tv(e).name);
    r.minutes=Math.min(120,Math.max(1,+m||10));r.endsAt=Date.now()+r.minutes*60000;r.phase='prep';push(r);ack&&ack('')});
  sock.on('host:endprep',()=>{const r=H();if(r&&r.phase==='prep')lock(r)});
  sock.on('host:grade',d=>{const r=H();if(!r||!d||!['grading','debate'].includes(r.phase))return;const t=r.teams[+d.team];if(!t)return;
    t.scores={};t.notes={};for(const k in MAX){t.scores[k]=Math.min(MAX[k],Math.max(0,Math.round(+(d.scores||{})[k]||0)));t.notes[k]=String((d.notes||{})[k]||'').slice(0,300)}push(r)});
  sock.on('host:debate',()=>{const r=H();if(r&&r.phase==='grading'){r.phase='debate';push(r)}});
  sock.on('host:reveal',()=>{const r=H();if(r&&r.phase==='debate'){r.teams.forEach(t=>{if(!t.scores){t.scores={};t.notes={};for(const k in MAX){t.scores[k]=0;t.notes[k]=''}}});r.phase='final';push(r)}});
  sock.on('disconnect',()=>{const r=rooms[sock.data&&sock.data.code];if(r)r.socks.delete(sock.id)});
});
srv.listen(process.env.PORT||3000,()=>console.log('running'));
