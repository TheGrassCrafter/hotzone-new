import { getStore } from "@netlify/blobs";
const store = getStore({ name: "hotzone-rooms", consistency: "strong" });
const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ttl = 5 * 60 * 1000;
const now = () => Date.now();
const id = () => crypto.randomUUID();
const code = () => Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
function response(status, data) { return new Response(JSON.stringify(data), {status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}}); }
const fail = (status,error) => response(status,{ok:false,error});
const ok = data => response(200,{ok:true,...data});
function view(r,secret=false){return {createdAt:r.createdAt,updatedAt:r.updatedAt,hostPlayerId:r.hostPlayerId,players:r.players.map(p=>({id:p.id})),leftCategory:r.leftCategory,rightCategory:r.rightCategory,...((secret||r.revealed)?{secretNumber:r.secretNumber}:{}),roundStarted:r.roundStarted,cluePlayerId:r.cluePlayerId,clue:r.clue,guesses:r.guesses,scores:r.scores,revealed:r.revealed};}
async function read(c){return await store.get(c,{type:"json",consistency:"strong"});}
async function save(c,r){r.updatedAt=now();await store.setJSON(c,r);}
export default async req => {
 if(req.method!=="POST")return fail(405,"Bitte POST verwenden.");
 let b;try{b=await req.json()}catch{return fail(400,"Ungültige Anfrage.");}
 try{
  if(b.action==="create"){
   let c;for(let i=0;i<10;i++){c=code();if(!(await read(c)))break;}
   const p=id(),token=id(),t=now(),r={createdAt:t,updatedAt:t,hostPlayerId:p,hostToken:token,players:[{id:p}],leftCategory:"Schlechtes Game",rightCategory:"Gutes Game",secretNumber:5,roundStarted:false,cluePlayerId:null,clue:null,guesses:[],scores:{[p]:0},revealed:false};
   await save(c,r);return ok({roomCode:c,playerId:p,hostToken:token,room:view(r,true)});
  }
  const c=String(b.roomCode||"").toUpperCase();if(!/^[A-Z0-9]{6}$/.test(c))return fail(400,"Der Raumcode muss genau 6 Zeichen haben.");
  const r=await read(c);if(!r)return fail(404,"Raum nicht gefunden. Erstelle einen neuen Raum.");
  if(b.action==="join" && now()-r.createdAt>=ttl){return fail(410,"Die 5 Minuten zum Beitreten sind abgelaufen. Bitte den Chef um einen neuen Raumcode bitten.");}
  if(b.action==="join"){const p=id();r.players.push({id:p});r.scores[p]=0;await save(c,r);return ok({playerId:p,room:view(r)});}
  if(b.action==="state"){return ok({room:view(r,Boolean(b.hostToken&&b.hostToken===r.hostToken))});}
  const host=Boolean(b.hostToken&&b.hostToken===r.hostToken),player=r.players.find(p=>p.id===b.playerId);
  if(!player)return fail(403,"Du bist diesem Raum nicht beigetreten. Bitte tritt erneut bei.");
  if(b.action==="settings"){if(!host)return fail(403,"Nur der Chef darf die Einstellungen ändern.");r.leftCategory=String(b.leftCategory||"Linke Seite").slice(0,60);r.rightCategory=String(b.rightCategory||"Rechte Seite").slice(0,60);r.secretNumber=Math.max(1,Math.min(10,Number(b.secretNumber)||5));await save(c,r);return ok({room:view(r,true)});}
  if(b.action==="startRound"){if(!host)return fail(403,"Nur der Chef darf eine Runde starten.");if(r.players.length<2)return fail(400,"Warte, bis mindestens ein weiterer Spieler beigetreten ist.");r.roundStarted=true;r.clue=null;r.guesses=[];r.revealed=false;r.cluePlayerId=r.players[1].id;await save(c,r);return ok({room:view(r,true)});}
  if(b.action==="clue"){if(!r.roundStarted)return fail(400,"Der Chef muss zuerst eine Runde starten.");if(b.playerId!==r.cluePlayerId)return fail(403,"Du bist in dieser Runde nicht der Hinweisgeber.");const clue=String(b.clue||"").trim().slice(0,100);if(!clue)return fail(400,"Schreibe zuerst einen Hinweis.");r.clue=clue;await save(c,r);return ok({room:view(r,host)});}
  if(b.action==="guess"){if(!r.clue)return fail(400,"Es gibt noch keinen Hinweis.");if(b.playerId===r.cluePlayerId)return fail(403,"Der Hinweisgeber darf nicht selbst raten.");if(r.guesses.some(g=>g.playerId===b.playerId))return fail(409,"Du hast schon geraten.");const guess=Math.max(1,Math.min(10,Number(b.guess)||1)),diff=Math.abs(guess-r.secretNumber),points=diff===0?3:diff===1?2:diff===2?1:0;r.guesses.push({playerId:b.playerId,guess,points});r.scores[b.playerId]=(r.scores[b.playerId]||0)+points;if(r.guesses.length>=Math.max(1,r.players.length-1))r.revealed=true;await save(c,r);return ok({room:view(r,host)});}
  return fail(400,"Unbekannte Aktion.");
 }catch(e){console.error("HOTZONE function error:",e?.stack||e);return fail(500,"HOTZONE-Serverfehler. Prüfe die Function-Logs in Netlify.");}
};
