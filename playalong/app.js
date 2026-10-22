// Play along: puzzle parsing, rounds, scoring, solver. Loads puzzle.csv and words.txt.
const PUZZLE_URL='https://raw.githubusercontent.com/boringparty/countdown/refs/heads/main/puzzle_big.csv';
const CATS_URL='https://raw.githubusercontent.com/boringparty/countdown/refs/heads/main/puzzles-cats.json';
const NAMES={L:'Letters',N:'Numbers',T:'Teatime teaser',C:'Conundrum'};
const TEASER_PTS=0,CON_PTS=10;
const $=id=>document.getElementById(id);
const pad=n=>String(n).padStart(2,'0');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let meta={},rounds=[],cur=0,timer=null,words=[],dict=null,mode='daily',catsEpisodes=[];

function csv(t){const rows=[];let r=[],f='',q=false;for(let i=0;i<t.length;i++){const c=t[i];
 if(q){if(c=='"'){if(t[i+1]=='"'){f+='"';i++}else q=false}else f+=c}
 else if(c=='"')q=true;else if(c==','){r.push(f);f=''}
 else if(c=='\n'||c=='\r'){if(c=='\r'&&t[i+1]=='\n')i++;r.push(f);rows.push(r);r=[];f=''}else f+=c}
 if(f||r.length){r.push(f);rows.push(r)}return rows}

function parse(text){const m={},map=new Map();
 for(const row of csv(text)){const k=/^(\w+):\s*(.*)$/.exec(row[0]||'');
  if(row.length==1&&k){m[k[1]]=k[2];continue}
  const id=row[0],t=id&&id[0];if(!/^[LNTC]\d+$/.test(id||''))continue;
  const o=map.get(id)||{id,t,s:{pts:0}};map.set(id,o);
  if(t=='N'){o.nums=row.slice(1,7).filter(Boolean).map(Number);o.target=+row[10]}
  else if(t=='T'&&row[1].length>1)o.clue=row[1];
  else{o.tiles=row.slice(1,10).filter(Boolean).map(x=>x.toLowerCase());
   o.answers=[...new Set((row[11]||'').split(/,\s*/).filter(Boolean))]}}
 return{meta:m,rounds:[...map.values()]}}

const key=()=>mode==='cats'?'pa:cats:'+meta.CatsEpisode:'pa:'+meta.Date;
function save(){try{localStorage.setItem(key(),JSON.stringify(Object.fromEntries(rounds.map(r=>[r.id,r.s]))))}catch(e){}}
function restore(){try{const a=JSON.parse(localStorage.getItem(key())||'null');
 if(a)rounds.forEach(r=>{if(a[r.id])Object.assign(r.s,a[r.id],{timing:false})})}catch(e){}}

const canMake=(w,tiles)=>{const p={};tiles.forEach(l=>p[l]=(p[l]||0)+1);
 for(const c of w){if(!p[c])return false;p[c]--}return true};
const best=(tiles,min)=>{const have=new Set(tiles);return words.filter(w=>w.length>=min&&w.length<=tiles.length&&[...w].every(c=>have.has(c))&&canMake(w,tiles))
 .sort((a,b)=>b.length-a.length||a.localeCompare(b)).slice(0,8)};

function evalExpr(s,avail){const t=s.replace(/[x×]/g,'*').replace(/÷/g,'/').replace(/−/g,'-').match(/\d+|[-+*\/()]/g)||[];
 let i=0;const used=[],err=m=>{throw new Error(m)};
 const prim=()=>{const k=t[i++];if(k=='('){const v=add();if(t[i++]!=')')err('Missing bracket');return v}
  if(/^\d+$/.test(k)){used.push(+k);return +k}err('Unexpected '+(k||'end'))};
 const mul=()=>{let v=prim();while(t[i]=='*'||t[i]=='/'){const o=t[i++],r=prim();
  if(o=='*')v*=r;else{if(!r||v%r)err('Division must be exact');v/=r}}return v};
 const add=()=>{let v=mul();while(t[i]=='+'||t[i]=='-'){const o=t[i++],r=mul();
  if(o=='+')v+=r;else{if(v-r<=0)err('Steps can’t go negative');v-=r}}return v};
 const v=add();if(i<t.length)err('Unexpected '+t[i]);
 const pool=[...avail];for(const u of used){const x=pool.indexOf(u);if(x<0)err(u+' isn’t available');pool.splice(x,1)}
 return v}

function solve(nums,t){let best={d:1e9};
 const rec=a=>{for(const x of a){const d=Math.abs(x.v-t);if(d<best.d)best={d,v:x.v,e:x.e}}
  if(best.d==0||a.length<2)return;
  for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++){
   const x=a[i],y=a[j],rest=a.filter((_,k)=>k!=i&&k!=j),o=[];
   const add=(v,e)=>{if(v>0&&Number.isInteger(v))o.push({v,e})};
   const[h,l]=x.v>=y.v?[x,y]:[y,x];
   add(x.v+y.v,`(${x.e}+${y.e})`);
   if(x.v>1&&y.v>1)add(x.v*y.v,`(${x.e}×${y.e})`);
   if(h.v!=l.v)add(h.v-l.v,`(${h.e}−${l.e})`);
   if(l.v>1&&h.v%l.v==0)add(h.v/l.v,`(${h.e}÷${l.e})`);
   for(const z of o){rec([...rest,z]);if(best.d==0)return}}};
 rec(nums.map(n=>({v:n,e:''+n})));
 if(best.e&&best.e[0]=='(')best.e=best.e.slice(1,-1);return best}

async function grade(r,g){const s=r.s,w=g.toLowerCase().replace(/[^a-z]/g,'');let res='';
 if(r.t=='L'){
  const ws=s.words||[],good=x=>canMake(x,r.tiles)&&(!dict||dict.has(x));
  const top=ws.filter(good).sort((a,b)=>b.length-a.length)[0];
  if(!ws.length)res='No words entered. 0 points.';
  else if(!top)res=`None of your ${ws.length} word${ws.length>1?'s':''} counted. 0 points.`;
  else{s.pts=top.length==9?18:top.length;res=`${top.toUpperCase()}: ${s.pts} points${dict?'':' (no dictionary loaded, so words weren’t checked)'}.`}
  res+=`<br>On the show: ${esc(r.answers.join(', ')||'—')}`;
  const b=dict?{words:best(r.tiles,2)}:null;
  if(b&&b.words.length)res+=`<br>Longest in the dictionary: ${b.words.join(', ').toUpperCase()}`}
 else if(r.t=='N'){
  try{const v=evalExpr(g,r.nums),d=Math.abs(v-r.target);
   s.pts=d==0?10:d<=5?7:d<=10?5:0;res=`${esc(g)} = ${v}: ${s.pts} points.`}
  catch(e){res=`${esc(e.message)}. 0 points.`}
  const b=solve(r.nums,r.target);res+=`<br>Closest: ${b.e} = ${b.v}${b.d?` (off by ${b.d})`:''}`}
 else{
  const b=r.t=='C'&&dict?{words:best(r.tiles,9)}:null;
  const cands=b?b.words.filter(x=>x.length==9):[];
  const ans=r.answers.map(x=>x.toLowerCase());
  const ok=(s.words||[]).some(x=>ans.includes(x)||cands.includes(x));
  if(ok)s.pts=r.t=='C'?CON_PTS:TEASER_PTS;
  res=ok?`Correct! ${s.pts} points.`:`Not this time.`;
  const shown=[...ans,...cands.filter(x=>!ans.includes(x))];
  res+=shown.length?`<br>Answer: ${shown.join(', ').toUpperCase()}`:'<br>No answer available.'}
 s.res=res}


function truncateLabel(value,max=40){
 const text=String(value||'').replace(/\s+/g,' ').trim();
 return text.length>max?text.slice(0,max-3).trimEnd()+'...':text;
}
function loadCatsRoundData(ep){
 const out=[];
 for(const item of (ep.rounds||[])){
  if(item.type==='letters')out.push({id:'L'+item.round,t:'L',tiles:[...(item.selection||'').toLowerCase()],answers:[],s:{pts:0}});
  else if(item.type==='numbers')out.push({id:'N'+item.round,t:'N',nums:item.numbers||[],target:item.target,answers:[],s:{pts:0}});
  else if(item.type==='teaser')out.push({id:'T'+(out.length+1),t:'T',tiles:[...(item.selection||'').toLowerCase()],clue:item.clue||'',answers:item.answer?[item.answer.toLowerCase()]:[],s:{pts:0}});
  else if(item.type==='conundrum')out.push({id:'C'+(item.round||out.length+1),t:'C',tiles:[...(item.selection||'').toLowerCase()],answers:[],s:{pts:0}});
 }
 return out;
}
function populateCatsOptions(){
 const select=$('puzzle-select');
 const options=catsEpisodes.map(ep=>{
  const title=ep.tv_episode?.name||ep.title||`Cats${ep.episode}`;
  return `<option value="${esc(ep.episode)}" title="${esc(title)}">${esc(truncateLabel(title,40))}</option>`;
 }).join('');
 select.innerHTML='<option value="daily">Today’s puzzle</option><optgroup label="Cats Does Countdown episodes">'+options+'</optgroup>';
}
function selectCatsEpisode(episodeNumber){
 const ep=catsEpisodes.find(e=>String(e.episode)===String(episodeNumber));
 if(!ep)return;
 clearInterval(timer);mode='cats';cur=0;
 if($('puzzle-select'))$('puzzle-select').value=String(episodeNumber);
 const tv=ep.tv_episode||{};
 meta={CatsEpisode:ep.episode,Date:tv.airdate||'',Guest:tv.name||ep.title||`Cats${ep.episode}`,Max:''};
 rounds=loadCatsRoundData(ep);
 if(!rounds.length){$('status').textContent='This episode has no playable rounds.';return}
 restore();
 cur=Math.max(0,rounds.findIndex(r=>!r.s.done));
 $('status').textContent=tv.airdate?`Cats${ep.episode} · aired ${tv.airdate}`:`Cats${ep.episode} · TV metadata unavailable`;
 render();
}
function render(){const r=rounds[cur],s=r.s;
 $('chips').innerHTML=rounds.map((x,i)=>`<button class="chip${i==cur?' on':''}${x.s.done?' done':''}" data-i="${i}">${x.id}${x.s.done?' · '+x.s.pts:''}</button>`).join('');
 const tot=rounds.reduce((a,x)=>a+x.s.pts,0);
 $('score').textContent=`Score ${tot}`+(meta.Max?` / ${meta.Max}`:'');
 $('meta').textContent=mode==='cats'?['Cats'+meta.CatsEpisode,meta.Date,meta.Guest].filter(Boolean).join(' · '):[meta.Date,meta.Guest].filter(Boolean).join(' · ');
 let h=`<h2>${NAMES[r.t]} <small>${r.id}</small></h2>`;
 if(r.clue)h+=`<p class="clue">${esc(r.clue)}</p>`;
 h+=r.t=='N'?`<div class="tiles" id="tl"></div><div class="target">${r.target}</div>`
  :'<div class="tiles" id="tl"></div>';
 h+=`<div class="bar"><span id="clock">${pad(s.left??30)}</span><div class="track"><i id="fill" style="width:${(s.left??30)/30*100}%"></i></div><button id="go" ${s.timing||s.done?'disabled':''}>Start timer</button></div>`;
 h+=`<div class="bar"><input id="ans" ${s.done?'disabled':''} placeholder="${r.t=='N'?'type your calculation':'type a word, press Enter'}" value="${esc(s.guess||'')}" autocomplete="off" autocapitalize="off" spellcheck="false">${r.t=='N'?'':`<button id="add" ${s.done?'disabled':''}>Add</button>`}<button id="sub" ${s.done?'disabled':''}>${r.t=='N'?'Submit':'Score'}</button></div>`;
 if(r.t!='N')h+='<div id="wl" class="wl"></div>';
 h+=`<div id="res">${s.res||''}</div><div id="solution" class="solution"${s.solution?'':' hidden'}>${s.solution||''}</div><div class="actions"><button id="solve" class="ghost">Solve</button><button id="clear" class="ghost">Clear round</button></div>`;
 $('round').innerHTML=h;if(r.t!='N')list();paint()}

function clampN(v,nums){let out='',run='';const pool=[...nums];
 for(const c of v){
  if(/\d/.test(c)){if(pool.some(n=>String(n).startsWith(run+c))){run+=c;out+=c}}
  else if(/[-+*\/×÷x−() ]/.test(c)){
   if(run){const k=pool.indexOf(+run);if(k<0)continue;pool.splice(k,1);run=''}
   out+=c}}
 return out}
function clamp(){const r=rounds[cur],inp=$('ans');let out='';
 if(r.t=='N')out=clampN(inp.value,r.nums);
 else{const pool={};r.tiles.forEach(l=>pool[l]=(pool[l]||0)+1);
  for(const c of inp.value.toLowerCase())if(pool[c]>0){pool[c]--;out+=c}}
 if(inp.value!==out){const pos=inp.selectionStart,d=inp.value.length-out.length;inp.value=out;
  try{inp.setSelectionRange(Math.max(0,pos-d),Math.max(0,pos-d))}catch(e){}}}
function paint(){const r=rounds[cur];if(!$('tl'))return;const val=$('ans').value||'';
 if(r.t=='N'){const used=r.nums.map(()=>false);
  for(const m of val.match(/\d+/g)||[]){const i=r.nums.findIndex((n,k)=>n==m&&!used[k]);if(i>=0)used[i]=true}
  $('tl').innerHTML=r.nums.map((n,k)=>`<span class="tile n${used[k]?' used':''}">${n}</span>`).join('');return}
 const typed=val.toLowerCase().replace(/[^a-z]/g,''),used=r.tiles.map(()=>false);
 for(const c of typed){const i=r.tiles.findIndex((l,k)=>l==c&&!used[k]);if(i>=0)used[i]=true}
 $('tl').innerHTML=r.tiles.map((l,k)=>`<span class="tile${used[k]?' used':''}">${l}</span>`).join('')}
function list(){const r=rounds[cur],s=r.s;
 $('wl').innerHTML=(s.words||[]).map((w,i)=>({w,i})).sort((a,b)=>b.w.length-a.w.length).map(({w,i})=>{
  const why=r.t!='L'?'':!canMake(w,r.tiles)?'letters not in the round':dict&&!dict.has(w)?'not in dictionary':'';
  return `<span class="w ${why?'bad':'ok'}" ${s.done?'':`data-rm="${i}"`} title="${why||'Click to remove'}">${w}${r.t=='L'?` <small>${why||w.length}</small>`:''}</span>`}).join('')}
function addWord(){const r=rounds[cur],s=r.s,inp=$('ans'),w=inp.value.toLowerCase().replace(/[^a-z]/g,'');
 inp.value='';s.guess='';paint();if(!w||s.done)return;
 s.words=s.words||[];if(!s.words.includes(w))s.words.push(w);list();save();inp.focus()}
function solveCurrentRound(){
 const r=rounds[cur],s=r.s;
 let title='Solution',body='';
 if(r.t==='N'){
  const b=solve(r.nums,r.target);
  body=b.e?`${esc(b.e)} = ${b.v}${b.d?` (off by ${b.d})`:''}`:'No calculation found.';
 }else if(r.t==='L'){
  const matches=dict?best(r.tiles,2):[];
  const longest=matches.filter(w=>w.length===9).slice(0,8);
  const shown=longest.length?longest:matches.slice(0,8);
  body=shown.length?`Longest words in dictionary: ${shown.map(w=>`${esc(w.toUpperCase())} (${w.length})`).join(', ')}`:'No dictionary words found for these letters.';
  if(r.answers&&r.answers.length)body+=`<br>Recorded show answers: ${esc(r.answers.join(', ').toUpperCase())}`;
 }else if(r.t==='T'){
  body=r.answers&&r.answers.length?`Answer: ${esc(r.answers.join(', ').toUpperCase())}`:'No answer is available in the episode data.';
 }else if(r.t==='C'){
  const matches=dict?best(r.tiles,9).filter(w=>w.length===9):[];
  body=matches.length?`Conundrum answer(s): ${matches.map(w=>esc(w.toUpperCase())).join(', ')}`:'No conundrum answer is available in the episode data or loaded dictionary.';
  if(r.answers&&r.answers.length)body=`Conundrum answer: ${esc(r.answers.join(', ').toUpperCase())}`;
 }
 s.solution=`<strong>${title}:</strong> ${body}`;
 const box=$('solution');box.innerHTML=s.solution;box.hidden=false;
 save();
}
function clearRound(){clearInterval(timer);rounds[cur].s={pts:0};render();save()}
function startOver(){if(!confirm('Start the whole day over? This clears every round.'))return;
 clearInterval(timer);rounds.forEach(r=>r.s={pts:0});cur=0;try{localStorage.removeItem(key())}catch(e){}render()}
function start(){const s=rounds[cur].s;s.timing=true;s.end=Date.now()+30000;$('go').disabled=true;$('ans').focus();tick();timer=setInterval(tick,200)}
function tick(){const s=rounds[cur].s;s.left=Math.max(Math.ceil((s.end-Date.now())/1000),0);$('clock').textContent=pad(s.left);$('fill').style.width=s.left/30*100+'%';if(!s.left)finish()}
async function finish(){const r=rounds[cur],s=r.s;if(s.done)return;clearInterval(timer);s.timing=false;s.done=true;
 const t=($('ans').value||'').trim();
 if(r.t=='N')s.guess=t;
 else{s.guess='';const w=t.toLowerCase().replace(/[^a-z]/g,'');s.words=s.words||[];if(w&&!s.words.includes(w))s.words.push(w)}
 s.res='Checking…';render();await grade(r,s.guess);render();save()}

document.addEventListener('change',e=>{if(e.target.id==='puzzle-select'){if(e.target.value==='daily')loadDailyPuzzle();else selectCatsEpisode(e.target.value)}});
document.addEventListener('click',e=>{const t=e.target,rm=t.closest('[data-rm]');
 if(rm){rounds[cur].s.words.splice(+rm.dataset.rm,1);list();save()}
 else if(t.id=='add')addWord();
 else if(t.id=='clear')clearRound();
 else if(t.id=='solve')solveCurrentRound();
 else if(t.id=='over')startOver();
 else if(t.dataset.i!==undefined&&!rounds[cur].s.timing){cur=+t.dataset.i;render()}
 else if(t.id=='go')start();else if(t.id=='sub')finish()});
document.addEventListener('input',e=>{if(e.target.id=='ans'){clamp();rounds[cur].s.guess=e.target.value;paint()}});
document.addEventListener('keydown',e=>{if(e.key=='Enter'&&e.target.id=='ans'){if(rounds[cur].t=='N')finish();else addWord()}});

const get=u=>fetch(u,{cache:'no-cache'}).then(r=>{if(!r.ok)throw 0;return r.text()});
async function loadDailyPuzzle(){
 clearInterval(timer);mode='daily';
 if($('puzzle-select'))$('puzzle-select').value='daily';
 try{
  const t=await get(PUZZLE_URL),p=parse(t);
  if(!p.rounds.length)throw 0;
  meta=p.meta;rounds=p.rounds;restore();
  cur=Math.max(0,rounds.findIndex(r=>!r.s.done));
  $('status').textContent=dict?'':'No dictionary found: words won’t be validated.';
  render();
 }catch(e){$('status').textContent='Couldn’t load today’s puzzles.'}
}
Promise.all([
 get(PUZZLE_URL),
 get('words.txt').catch(()=>''),
 fetch(CATS_URL).then(r=>{if(!r.ok)throw 0;return r.json()}).catch(()=>null)
]).then(([t,wt,cats])=>{
 words=wt.toLowerCase().split(/\s+/).filter(w=>/^[a-z]+$/.test(w));dict=words.length?new Set(words):null;
 $('ver').textContent='build 8 · '+(dict?words.length.toLocaleString()+' words':'no dictionary');
 if(!dict)$('status').textContent='No dictionary found: words won’t be validated.';
 const p=parse(t);if(!p.rounds.length)throw 0;meta=p.meta;rounds=p.rounds;restore();
 cur=Math.max(0,rounds.findIndex(r=>!r.s.done));render();
 if(cats&&Array.isArray(cats.episodes)){catsEpisodes=cats.episodes;populateCatsOptions()}
 else $('status').textContent='Cats episode list could not be loaded.';
}).catch(()=>{$('status').textContent='Couldn’t load today’s puzzles.'});
