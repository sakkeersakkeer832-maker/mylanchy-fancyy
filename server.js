const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000,DIR=process.env.DATA_DIR||path.join(__dirname,'data'),FILE=path.join(DIR,'db.json');
fs.mkdirSync(DIR,{recursive:true});
let db={users:{},reqs:[],notes:[],redeems:[],gifts:[],sessions:{},cfg:{on:true,rate:10}};
try{db=Object.assign(db,JSON.parse(fs.readFileSync(FILE,'utf8')))}catch(e){}
const save=()=>{const t=FILE+'.tmp';fs.writeFileSync(t,JSON.stringify(db));fs.renameSync(t,FILE)};
const hash=p=>{const s=crypto.randomBytes(16).toString('hex');return s+':'+crypto.scryptSync(p,s,32).toString('hex')};
const check=(p,h)=>{const[s,k]=(h||':').split(':');try{return crypto.timingSafeEqual(crypto.scryptSync(p,s,32),Buffer.from(k,'hex'))}catch(e){return false}};
if(!db.cfg.apw){const pw=process.env.ADMIN_PASSWORD||crypto.randomBytes(4).toString('hex');db.cfg.apw=hash(pw);save();if(!process.env.ADMIN_PASSWORD)console.log('ADMIN PASSWORD (first run):',pw)}
const uid=()=>crypto.randomBytes(5).toString('hex'),now=()=>Date.now();
if(!db.v5){const c=db.cfg;c.rate=c.rate||10;c.on=true;delete c.target;delete c.offer;
 Object.values(db.users).forEach(u=>{u.pts=Math.floor((u.total||0)/c.rate);u.earned=u.pts;['prog','code','target','offer','goal','goalOff','greq'].forEach(k=>delete u[k])});
 if(!db.gifts.length)db.gifts=[{name:'Hair clip',points:50},{name:'Scrunchie set',points:100},{name:'Surprise gift box',points:250}].map(g=>({id:uid(),on:true,...g}));
 db.v5=1;save()}
const note=(to,text,type='info')=>{db.notes.unshift({id:uid(),to,text,type,t:now(),read:false});db.notes=db.notes.slice(0,2000)};
const mkcode=()=>crypto.randomBytes(4).toString('hex').slice(0,6).toUpperCase();
const fails={};const limited=ip=>(fails[ip]||[]).filter(t=>now()-t<6e5).length>=8;
const fail=ip=>{(fails[ip]=(fails[ip]||[]).filter(t=>now()-t<6e5)).push(now())};
const newSession=(role,id)=>{const t=crypto.randomBytes(24).toString('hex');db.sessions[t]={role,id,exp:now()+30*864e5};
 for(const k in db.sessions)if(db.sessions[k].exp<now())delete db.sessions[k];save();return t};
const safe=u=>({id:u.id,name:u.name,phone:u.phone,pts:u.pts,earned:u.earned,total:u.total,joined:u.joined});
const cfgv=()=>({on:db.cfg.on,rate:db.cfg.rate});
function view(s){
 if(s.role==='admin'){const users={};for(const k in db.users)users[k]=safe(db.users[k]);
  return{role:'admin',id:null,state:{users,reqs:db.reqs,notes:db.notes.filter(n=>n.to==='admin').slice(0,100),redeems:db.redeems,gifts:db.gifts,cfg:cfgv()}}}
 const u=db.users[s.id];return{role:'user',id:s.id,state:{users:{[s.id]:safe(u)},reqs:db.reqs.filter(r=>r.uid===s.id),notes:db.notes.filter(n=>n.to===s.id).slice(0,100),redeems:db.redeems.filter(r=>r.uid===s.id),gifts:db.gifts.filter(g=>g.on),cfg:cfgv()}}}
const E=(m,c=400)=>{const e=new Error(m);e.c=c;return e};
const str=(v,n)=>String(v??'').trim().slice(0,n);
function need(s,r){if(!s||s.role!==r)throw E('Not allowed',403)}
const routes={
 'POST /register':(b)=>{const name=str(b.name,60),phone=str(b.phone,20).replace(/\D/g,''),pw=String(b.password||'');
  if(!name||phone.length<8||pw.length<4)throw E('Name, valid phone & 4+ char password needed');
  if(Object.values(db.users).some(u=>u.phone===phone))throw E('Phone already registered');
  const id=uid();db.users[id]={id,name,phone,pw:hash(pw),pts:0,earned:0,total:0,joined:now()};note('admin','New customer: '+name);return{token:newSession('user',id)}},
 'POST /login':(b,s,ip)=>{if(limited(ip))throw E('Too many attempts, try later',429);const phone=str(b.phone,20).replace(/\D/g,'');
  const u=Object.values(db.users).find(u=>u.phone===phone);if(!u||!check(String(b.password||''),u.pw)){fail(ip);throw E('Wrong phone or password',401)}return{token:newSession('user',u.id)}},
 'POST /admin/login':(b,s,ip)=>{if(limited(ip))throw E('Too many attempts, try later',429);
  if(str(b.username,30).toLowerCase()!=='admin'||!check(String(b.password||''),db.cfg.apw)){fail(ip);throw E('Wrong admin login',401)}return{token:newSession('admin')}},
 'GET /state':(b,s)=>view(s),
 'POST /req':(b,s)=>{need(s,'user');const amt=Math.round(+b.amt);if(!(amt>0&&amt<=1e6))throw E('Invalid amount');
  db.reqs.unshift({id:uid(),uid:s.id,amt,note:str(b.note,100),st:'p',t:now()});note('admin',db.users[s.id].name+' added a purchase of ₹'+amt,'req')},
 'DELETE /req':(b,s,ip,id)=>{need(s,'user');db.reqs=db.reqs.filter(r=>!(r.id===id&&r.uid===s.id&&r.st==='p'))},
 'POST /notes/read':(b,s)=>{const k=s.role==='admin'?'admin':s.id;db.notes.forEach(n=>{if(n.to===k&&(!b.id||n.id===b.id))n.read=true})},
 'POST /notes/clear':(b,s)=>{const k=s.role==='admin'?'admin':s.id;db.notes=db.notes.filter(n=>n.to!==k)},
 'POST /redeem':(b,s)=>{need(s,'user');const u=db.users[s.id],g=db.gifts.find(x=>x.id===b.gid&&x.on);if(!db.cfg.on)throw E('Points are paused right now');if(!g)throw E('Gift not available');
  if(u.pts<g.points)throw E('Not enough points – you need '+(g.points-u.pts)+' more');
  const r={id:uid(),uid:u.id,gid:g.id,name:g.name,points:g.points,code:mkcode(),st:'p',t:now()};u.pts-=g.points;db.redeems.unshift(r);
  note(u.id,'🎟️ You redeemed '+g.name+'. Show code '+r.code+' at the shop.','goal');note('admin',u.name+' redeemed '+g.name+' · code '+r.code,'goal')},
 'POST /admin/approve':(b,s)=>{need(s,'admin');const r=db.reqs.find(x=>x.id===b.id&&x.st==='p'),g=str(b.gift,120);if(!r)throw E('Request not found');
  const u=db.users[r.uid],p=db.cfg.on?Math.floor(r.amt/db.cfg.rate):0;r.st='a';r.gift=g;r.at=now();r.pts=p;u.total+=r.amt;u.pts+=p;u.earned+=p;
  note(u.id,'✅ Approved ₹'+r.amt+' · +'+p+' points'+(g?' · gift: '+g:'')+' · balance '+u.pts+' pts',g?'gift':'ok')},
 'POST /admin/reject':(b,s)=>{need(s,'admin');const r=db.reqs.find(x=>x.id===b.id&&x.st==='p');if(!r)throw E('Request not found');note(r.uid,'❌ Your ₹'+r.amt+' request was not approved','warn');db.reqs=db.reqs.filter(x=>x!==r)},
 'POST /admin/cfg':(b,s)=>{need(s,'admin');const c=db.cfg;if(b.rate!==undefined){const r=Math.round(+b.rate);if(!(r>=1))throw E('Invalid amount per point');c.rate=r}if(b.on!==undefined)c.on=!!b.on},
 'POST /admin/gift':(b,s)=>{need(s,'admin');const name=str(b.name,60),points=Math.round(+b.points);if(!name||!(points>0))throw E('Gift name and points needed');
  const g=db.gifts.find(x=>x.id===b.id);if(g){g.name=name;g.points=points;if(b.on!==undefined)g.on=!!b.on}else db.gifts.push({id:uid(),name,points,on:true})},
 'POST /admin/gift/delete':(b,s)=>{need(s,'admin');db.gifts=db.gifts.filter(g=>g.id!==b.id)},
 'POST /admin/rdeliver':(b,s)=>{need(s,'admin');const r=db.redeems.find(x=>x.id===b.id&&x.st==='p');if(!r)throw E('Not found or already done');r.st='d';r.at=now();note(r.uid,'🎉 Collected: '+r.name+'. Enjoy!','reward')},
 'POST /admin/rcancel':(b,s)=>{need(s,'admin');const r=db.redeems.find(x=>x.id===b.id&&x.st==='p');if(!r)throw E('Not found or already done');r.st='c';r.at=now();
  const u=db.users[r.uid];if(u)u.pts+=r.points;note(r.uid,'Redeem of '+r.name+' was cancelled. '+r.points+' points refunded.','warn')},
 'POST /admin/points':(b,s)=>{need(s,'admin');const u=db.users[b.uid],d=Math.round(+b.delta);if(!u||!d)throw E('Invalid');u.pts=Math.max(0,u.pts+d);note(u.id,'Points '+(d>0?'+':'')+d+' from the shop. Balance: '+u.pts,'info')},
 'POST /admin/pw':(b,s)=>{need(s,'admin');if(String(b.password||'').length<6)throw E('Use 6+ characters');db.cfg.apw=hash(String(b.password))}
};
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css'};
http.createServer((req,res)=>{
 const ip=req.socket.remoteAddress,u=new URL(req.url,'http://x');
 const send=(c,o,t='application/json')=>{res.writeHead(c,{'Content-Type':t,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(typeof o==='string'||Buffer.isBuffer(o)?o:JSON.stringify(o))};
 if(!u.pathname.startsWith('/api/')){const f=u.pathname==='/'?'index.html':path.normalize(u.pathname).replace(/^(\.\.[\/\\])+/,'');const p=path.join(__dirname,'public',f);
  if(!p.startsWith(path.join(__dirname,'public')))return send(403,'no','text/plain');
  return fs.readFile(p,(e,d)=>e?send(404,'not found','text/plain'):send(200,d,types[path.extname(p)]||'application/octet-stream'))}
 let body='';req.on('data',c=>{body+=c;if(body.length>1e4)req.destroy()});
 req.on('end',()=>{try{let p=u.pathname.slice(4),id;if(req.method==='DELETE'&&p.startsWith('/req/')){id=p.slice(5);p='/req'}
  const h=routes[req.method+' '+p];if(!h)throw E('Not found',404);
  const tk=(req.headers.authorization||'').slice(7),s=db.sessions[tk];const sess=s&&s.exp>now()&&(s.role==='admin'||db.users[s.id])?s:null;
  if(!sess&&!/^POST \/(register|login|admin\/login)$/.test(req.method+' '+p))throw E('Please login',401);
  const out=h(body?JSON.parse(body):{},sess,ip,id);if(req.method!=='GET')save();send(200,out||{ok:1})}catch(e){send(e.c||400,{error:e.c?e.message:'Bad request'})}})
}).listen(PORT,()=>console.log('Mylanchy Fancy running on port '+PORT));
