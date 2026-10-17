"use strict";
/* ---------- Zettel-Erkennung ----------
   Foto vom Ausdruck der Reihenfolge -> Zeilen mit IDA, FLS-Ident, BrAus, Br, Di, Gew, Lng.
   Läuft komplett im Browser mit Tesseract.js aus ./ocr – das Foto verlässt das Gerät nicht.

   Ablauf:
   1. Bild verkleinern, dunkle (markierte) Zeilen umkehren, adaptiv schwarz/weiß, dünne Linien löschen.
   2. Erster Durchgang über die ganze Seite: liefert vor allem die Lage der Wörter.
   3. Kopfzeile suchen (BrAus, Br, Di, Gew, Lng, IDA, FLS-Ident), fehlende Spalten am Zahlenformat erkennen,
      Schräglage schätzen, Zeilen bilden, Spaltenkanten über die Höhe anpassen (Perspektive).
   4. Zweiter Durchgang je Spalte, zweimal: jede Zelle einzeln ausschneiden (weichgezeichnet gegen das
      Druckraster der grauen Hinterlegung), alle Zellen der Spalte untereinander in ein Bild, nur Ziffern erlaubt.
   5. Zahlen nach festem Spaltenformat lesen (die Nachkommastellen sind fix), aus den drei Lesarten die
      Kombination nehmen, bei der Br × Di × Lng × 7,85 zum Gewicht passt; sonst Mehrheit, sonst „unsicher“. */
(function(){
const OCR_DIR="ocr/";
const MAXSIDE=2600;          // px – längere Bildseite für die Erkennung
const BLUR=2;                // px – Radius gegen das Druckraster
const RHO=7.85;              // kg/dm³
const CHECK_TOL=0.05;        // Gewichtsprobe: ±5 %
const ID_LIST=[508,610,762];

/* Kopfzeile. Tesseract liest "Lng" gern als "Inga", "IDA" am Bildrand als "DA". */
const HEAD={
  ida:  w=>/^[I1l|]?DA\b|^[I1l|]?DA[.…]/i.test(w),
  ident:w=>/FLS|Ident/i.test(w),
  b:    w=>/^B[.…:]*$/.test(w),
  braus:w=>/^B[rt][AÄ]u?s|^BrA|rAus/i.test(w),
  br:   w=>/^Br[.…:]*$/.test(w),
  di:   w=>/^Di[.…:]*$/.test(w),
  gew:  w=>/^Gew/i.test(w),
  lng:  w=>/^[LlI1|][nm][gq]/.test(w)
};
const NUMCOLS=["ida","braus","br","di","gew","lng"];

/* ---------- Bildhilfen ---------- */
function toGray(img){
  const d=img.data,n=img.width*img.height,g=new Uint8ClampedArray(n);
  for(let i=0,j=0;i<n;i++,j+=4)g[i]=(d[j]*77+d[j+1]*150+d[j+2]*29)>>8;
  return {w:img.width,h:img.height,g};
}

/* Markierte Zeilen (weiße Schrift auf dunkel) umkehren */
function invertDarkBands(G){
  const {w,h,g}=G,x0=Math.round(w*.1),x1=Math.round(w*.9);
  const dark=new Uint8Array(h);
  for(let y=0;y<h;y++){
    let s=0;for(let x=x0;x<x1;x+=2)s+=g[y*w+x];
    dark[y]=s/((x1-x0)/2)<95?1:0;
  }
  for(let y=0;y<h;y++)if(dark[y])for(let x=0;x<w;x++)g[y*w+x]=255-g[y*w+x];
}

/* Kastenweichzeichner: macht das Punkteraster der grauen Hinterlegung zu glattem Grau */
function boxBlur(G,r){
  const {w,h,g}=G,tmp=new Float32Array(w*h),out=new Uint8ClampedArray(w*h),n=2*r+1;
  for(let y=0;y<h;y++){let s=0;for(let x=-r;x<=r;x++)s+=g[y*w+Math.min(w-1,Math.max(0,x))];
    for(let x=0;x<w;x++){tmp[y*w+x]=s/n;s+=g[y*w+Math.min(w-1,x+r+1)]-g[y*w+Math.max(0,x-r)];}}
  for(let x=0;x<w;x++){let s=0;for(let y=-r;y<=r;y++)s+=tmp[Math.min(h-1,Math.max(0,y))*w+x];
    for(let y=0;y<h;y++){out[y*w+x]=s/n;s+=tmp[Math.min(h-1,y+r+1)*w+x]-tmp[Math.max(0,y-r)*w+x];}}
  return {w,h,g:out};
}

/* Dünne waagerechte Linien (Gitter, gestrichelter Fokusrahmen) aus dem Schwarzweißbild löschen */
function removeThinLines(B){
  const {w,h,g}=B,t=Math.max(2,Math.round(w/650));
  for(let y=t+1;y<h-t-1;y++){
    let thin=0;
    for(let x=0;x<w;x++){const i=y*w+x;if(!g[i]&&g[i-(t+1)*w]&&g[i+(t+1)*w])thin++;}
    if(thin<w*.2)continue;
    for(let x=0;x<w;x++){const i=y*w+x;if(!g[i]&&g[i-(t+1)*w]&&g[i+(t+1)*w])g[i]=255;}
  }
}

/* Adaptiver Schwellwert nach Bradley: gleicht Schatten und graue Hinterlegung aus */
function bradley(G,win,t){
  const {w,h,g}=G,I=new Float64Array((w+1)*(h+1)),out=new Uint8ClampedArray(w*h);
  for(let y=0;y<h;y++){let s=0;for(let x=0;x<w;x++){s+=g[y*w+x];I[(y+1)*(w+1)+x+1]=I[y*(w+1)+x+1]+s;}}
  const r=win>>1;
  for(let y=0;y<h;y++){
    const ya=Math.max(0,y-r),yb=Math.min(h,y+r+1);
    for(let x=0;x<w;x++){
      const xa=Math.max(0,x-r),xb=Math.min(w,x+r+1);
      const sum=I[yb*(w+1)+xb]-I[ya*(w+1)+xb]-I[yb*(w+1)+xa]+I[ya*(w+1)+xa];
      out[y*w+x]=g[y*w+x]*(xb-xa)*(yb-ya)<sum*(1-t)?0:255;
    }
  }
  return {w,h,g:out};
}

/* Hintergrundhelligkeit einer Zelle: Median, damit die Schrift nicht mitzählt */
function medianIn(G,box){
  const x0=Math.max(0,Math.floor(box.x0)),x1=Math.min(G.w,Math.ceil(box.x1));
  const y0=Math.max(0,Math.floor(box.y0)),y1=Math.min(G.h,Math.ceil(box.y1));
  const hist=new Uint32Array(256);let n=0;
  for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){hist[G.g[y*G.w+x]]++;n++;}
  let c=0;for(let i=0;i<256;i++){c+=hist[i];if(c*2>=n)return i;}
  return 255;
}

function otsu(vals){
  const hist=new Uint32Array(256);for(const v of vals)hist[v]++;
  const n=vals.length;let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];
  let sB=0,wB=0,best=0,thr=128;
  for(let i=0;i<256;i++){
    wB+=hist[i];if(!wB)continue;const wF=n-wB;if(!wF)break;
    sB+=i*hist[i];const mB=sB/wB,mF=(sum-sB)/wF,v=wB*wF*(mB-mF)*(mB-mF);
    if(v>best){best=v;thr=i;}
  }
  return thr;
}

function grayToCanvas(G){
  const c=document.createElement("canvas");c.width=G.w;c.height=G.h;
  const ctx=c.getContext("2d"),im=ctx.createImageData(G.w,G.h);
  for(let i=0,j=0;i<G.g.length;i++,j+=4){im.data[j]=im.data[j+1]=im.data[j+2]=G.g[i];im.data[j+3]=255;}
  ctx.putImageData(im,0,0);return c;
}

/* Zelle ausschneiden, eigener Otsu-Schwellwert, bei Bedarf umkehren, auf Zielhöhe skalieren */
function cellImage(G,box,targetH,binary){
  const x0=Math.max(0,Math.floor(box.x0)),x1=Math.min(G.w,Math.ceil(box.x1));
  const y0=Math.max(0,Math.floor(box.y0)),y1=Math.min(G.h,Math.ceil(box.y1));
  const cw=Math.max(1,x1-x0),ch=Math.max(1,y1-y0),vals=new Uint8ClampedArray(cw*ch);
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++)vals[y*cw+x]=G.g[(y0+y)*G.w+x0+x];
  const thr=binary?127:otsu(vals);
  let dark=0;for(const v of vals)if(v<=thr)dark++;
  const inv=dark>vals.length*.5;   // weiße Schrift auf dunklem Grund
  const c=document.createElement("canvas");c.width=cw;c.height=ch;
  const ctx=c.getContext("2d"),im=ctx.createImageData(cw,ch);
  for(let i=0,j=0;i<vals.length;i++,j+=4){
    const ink=inv?vals[i]>thr:vals[i]<=thr;
    im.data[j]=im.data[j+1]=im.data[j+2]=ink?0:255;im.data[j+3]=255;
  }
  ctx.putImageData(im,0,0);
  const s=targetH/ch,out=document.createElement("canvas");
  out.width=Math.max(1,Math.round(cw*s));out.height=targetH;
  const o=out.getContext("2d");o.imageSmoothingEnabled=true;o.drawImage(c,0,0,out.width,out.height);
  return out;
}

/* ---------- Tesseract ---------- */
function simdSupported(){
  // kleinstes Wasm-Modul mit einer SIMD-Anweisung
  try{return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]));}
  catch(e){return false;}
}

function loadScript(src){
  return new Promise((res,rej)=>{const e=document.createElement("script");e.src=src;e.onload=res;
    e.onerror=()=>rej(new Error("Texterkennung konnte nicht geladen werden. Einmal mit Internet öffnen, danach geht es offline."));
    document.head.appendChild(e);});
}

async function makeWorker(onLog){
  if(typeof Tesseract==="undefined")await loadScript(OCR_DIR+"tesseract.min.js");
  if(!simdSupported())throw new Error("Dieses Gerät kann die Texterkennung nicht ausführen (WebAssembly SIMD fehlt).");
  return Tesseract.createWorker("eng",1,{
    workerPath:OCR_DIR+"worker.min.js",
    corePath:OCR_DIR+"tesseract-core-simd-lstm.js",
    langPath:OCR_DIR.replace(/\/$/,""),
    workerBlobURL:false,
    cacheMethod:"none",
    gzip:true,
    logger:m=>{if(onLog&&m&&m.status)onLog(m);}
  });
}

function wordsOf(data){
  const out=[];
  for(const b of data.blocks||[])for(const p of b.paragraphs||[])for(const l of p.lines||[])for(const w of l.words||[]){
    const t=(w.text||"").trim();if(!t)continue;
    const {x0,y0,x1,y1}=w.bbox;out.push({t,x0,y0,x1,y1,cx:(x0+x1)/2,cy:(y0+y1)/2,h:y1-y0,conf:w.confidence});
  }
  return out;
}

const median=a=>{if(!a.length)return NaN;const s=[...a].sort((p,q)=>p-q),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};

/* ---------- Tabelle aus Wortlagen ---------- */
function findHeader(words){
  // Kandidaten für die markantesten Überschriften
  const key=words.filter(w=>HEAD.gew(w.t)||HEAD.braus(w.t)||HEAD.di(w.t)||HEAD.lng(w.t));
  let best=null;
  for(const k of key){
    const line=words.filter(w=>Math.abs(w.cy-k.cy)<Math.max(k.h,12)*1.6);
    const found={};
    for(const name in HEAD)for(const w of line)if(!found[name]&&HEAD[name](w.t))found[name]=w;
    const score=Object.keys(found).length;
    if(!best||score>best.score)best={score,found,line};
  }
  return best&&best.score>=3?best:null;
}

function slopeOf(pts){
  if(pts.length<3)return 0;
  const mx=pts.reduce((s,p)=>s+p.cx,0)/pts.length,my=pts.reduce((s,p)=>s+p.cy,0)/pts.length;
  let num=0,den=0;for(const p of pts){num+=(p.cx-mx)*(p.cy-my);den+=(p.cx-mx)**2;}
  const b=den?num/den:0;
  return Math.abs(b)<.15?b:0;
}

function layout(words,head){
  const b=slopeOf(head.line);
  // entzerrte Koordinaten (kleine Drehung)
  const dx=w=>w.cx+b*w.cy, dy=w=>w.cy-b*w.cx;
  const hY=median(head.line.map(dy));
  const hH=median(head.line.map(w=>w.h))||20;

  // Anker: alle Wörter der Kopfzeile, die gesuchten mit Namen
  const anchors=head.line.map(w=>({x:dx(w),name:null,w}));
  for(const name in head.found){const a=anchors.find(a=>a.w===head.found[name]);if(a)a.name=name;}
  // "Gew kg": das "kg" gehört zur Gewichtsspalte
  for(const a of anchors)if(/^kg$/i.test(a.w.t)&&!a.name)a.name="gew";
  // Spaltenmitte der Gewichtsspalte zwischen "Gew" und "kg"
  const merged=[];
  for(const a of anchors){
    const prev=merged.find(m=>m.name&&m.name===a.name);
    if(prev)prev.x=(prev.x+a.x)/2;else merged.push({...a});
  }

  // Zeilen: Wörter unterhalb der Kopfzeile nach Höhe gruppieren
  // Punktlinien (Fokusrahmen) und Gitterreste haben keine Ziffern/Buchstaben oder die falsche Höhe
  const body=words.filter(w=>dy(w)>hY+hH*.8&&w.h>hH*.55&&w.h<hH*1.8&&/[0-9A-Za-z]/.test(w.t))
    .sort((p,q)=>dy(p)-dy(q));
  // Zeilenlage nur aus sicher gelesenen Zahlen, damit Reste von Linien keine eigene Zeile bilden
  const sure=body.filter(w=>w.conf>=60&&/^[\d.,]{3,}$/.test(w.t));
  const rows=[];
  for(const w of sure){
    const y=dy(w),r=rows[rows.length-1];
    if(r&&Math.abs(y-r.y)<hH*.65){r.ys.push(y);r.y=median(r.ys);}
    else rows.push({y,ys:[y],words:[]});
  }
  // unter der Tabelle (Detailbereich "Verwendungszweck", "Bemerkung") ist Schluss
  const foot=words.filter(w=>dy(w)>hY&&/Verwendung|Bemerkung/i.test(w.t)).map(dy);
  if(foot.length){const fy=Math.min(...foot);while(rows.length&&rows[rows.length-1].y>fy-hH*.5)rows.pop();}
  for(const w of body){
    let best=null,bd=hH*.6;
    for(const r of rows){const d=Math.abs(dy(w)-r.y);if(d<bd){bd=d;best=r;}}
    if(best)best.words.push(w);
  }

  // Spalten zuordnen; Spaltenmitten wandern mit (Perspektive)
  const cols=merged.map(a=>({name:a.name,x:a.x}));
  // Überschrift nicht gelesen: Spalte am Zahlenformat erkennen (Di hat immer zwei Nachkommastellen usw.)
  const SHAPE={di:/^\d{1,2}[.,]\d{2}$/,gew:/^\d{2}[.,]\d{3}$/,braus:/^(\d[.,])?\d{3}[.,]\d$/,b:/^[JN]$/};
  for(const name in SHAPE){
    if(cols.some(c=>c.name===name))continue;
    const xs=rows.flatMap(r=>r.words).filter(w=>SHAPE[name].test(w.t)).map(dx).sort((p,q)=>p-q);
    let best=[];
    for(let i=0;i<xs.length;i++){const grp=xs.filter(x=>Math.abs(x-xs[i])<hH*1.5);if(grp.length>best.length)best=grp;}
    if(best.length<3)continue;
    const x=median(best);
    // die nicht erkannte Überschrift darüber würde sonst die Werte an sich ziehen
    for(let i=cols.length-1;i>=0;i--)if(!cols[i].name&&Math.abs(cols[i].x-x)<hH*1.5)cols.splice(i,1);
    cols.push({name,x});
  }
  const out=[];
  for(const r of rows){
    const cells={};
    for(const w of r.words){
      let bi=-1,bd=1e9;
      cols.forEach((c,i)=>{const d=Math.abs(dx(w)-c.x);if(d<bd){bd=d;bi=i;}});
      const c=cols[bi];
      if(!c||!c.name)continue;
      (cells[c.name]=cells[c.name]||[]).push(w);
    }
    // Zeile zählt, wenn eine Zahlenspalte Ziffern hat; Reste fliegen nach dem Lesen raus
    const numHits=NUMCOLS.filter(n=>n!=="ida"&&cells[n]&&cells[n].some(w=>/\d/.test(w.t))).length;
    if(numHits<1)continue;
    for(const c of cols)if(c.name&&cells[c.name]){
      const x=median(cells[c.name].map(dx));c.x=c.x*.6+x*.4;
    }
    // eigene Gerade je Zeile (Bildkoordinaten): bei schräg fotografiertem Blatt laufen die Zeilen nicht parallel
    const ws=r.words.filter(w=>w.conf>=40);
    let m=b,c0=null;
    if(ws.length>=3){
      const mx=ws.reduce((s,w)=>s+w.cx,0)/ws.length,my=ws.reduce((s,w)=>s+w.cy,0)/ws.length;
      let num=0,den=0;for(const w of ws){num+=(w.cx-mx)*(w.cy-my);den+=(w.cx-mx)**2;}
      if(den&&Math.abs(num/den-b)<.03)m=num/den;
      c0=my-m*mx;
    }
    out.push({y:r.y,cells,line:c0===null?null:{m,c:c0}});
  }

  // Spaltengeometrie aus sauber gelesenen Wörtern: Zahlen stehen rechtsbündig, der Ident linksbündig.
  // Die Kante wird über die Höhe linear angepasst (Perspektive), die Breite reicht für die längste Zahl.
  const geo={};
  for(const c of cols)if(c.name){
    const right=c.name!=="ident";
    const ok=w=>c.name==="ident"?/^[A-Z0-9]{6,9}$/i.test(w.t):FORMAT[c.name](w.t)!=null;
    const pts=out.flatMap(r=>(r.cells[c.name]||[]).filter(ok).map(w=>({y:dy(w),e:right?w.x1+b*w.cy:w.x0+b*w.cy,w:w.x1-w.x0})));
    let k=0,a0;
    if(pts.length>=4){
      const my=pts.reduce((s,p)=>s+p.y,0)/pts.length,me=pts.reduce((s,p)=>s+p.e,0)/pts.length;
      let num=0,den=0;for(const p of pts){num+=(p.y-my)*(p.e-me);den+=(p.y-my)**2;}
      k=den?num/den:0;if(Math.abs(k)>.08)k=0;a0=me-k*my;
    }else if(pts.length){a0=median(pts.map(p=>p.e));}
    else{
      const ws=out.flatMap(r=>r.cells[c.name]||[]);
      if(!ws.length)continue;
      a0=median(ws.map(w=>right?w.x1+b*w.cy:w.x0+b*w.cy));
    }
    const widths=pts.map(p=>p.w).sort((p,q)=>p-q);
    const wmax=widths.length?widths[Math.floor(widths.length*.85)]*1.12:hH*4.5;
    geo[c.name]={right,a:a0,k,w:wmax};
  }
  // Spalte B (besäumt J/N) nicht gefunden: sie steht direkt links neben BrAus
  if(!geo.b&&geo.braus){const c=geo.braus;geo.b={right:true,a:c.a-c.w-hH*.2,k:c.k,w:hH*2.8};}
  return {b,hH,rows:out,cols:geo,dx,dy};
}

/* Zellrahmen (Bildkoordinaten) für Zeile r, Spalte name – aus der Spaltengeometrie, nicht aus den
   Wortgrenzen des ersten Durchgangs (die sind bei grauen Zellen oft nur Bruchstücke) */
function cellBox(L,r,name){
  const c=L.cols[name];if(!c)return null;
  const padX=L.hH*.45,padY=L.hH*.45;
  // Ident steht linksbündig mit wechselnder Länge: dort das gelesene Wort nehmen, wenn es eins gibt
  const ws=name==="ident"&&r.cells.ident;
  if(ws&&ws.length){
    const x0=Math.min(...ws.map(w=>w.x0)),x1=Math.max(...ws.map(w=>w.x1));
    const y0=Math.min(...ws.map(w=>w.y0)),y1=Math.max(...ws.map(w=>w.y1));
    return {x0:x0-padX,x1:x1+padX,y0:y0-padY,y1:y1+padY};
  }
  const e=c.a+c.k*r.y,xc=c.right?e-c.w/2:e+c.w/2;
  // aus entzerrten Koordinaten zurück; Höhe aus der Geraden der Zeile
  const x=xc-L.b*r.y,y=r.line?r.line.c+r.line.m*x:r.y+L.b*xc;
  return {x0:x-c.w/2-padX,x1:x+c.w/2+padX,y0:y-L.hH/2-padY,y1:y+L.hH/2+padY};
}

/* Alle Zellen einer Spalte untereinander in ein Bild, ein Erkennungsdurchgang */
async function readColumn(worker,G,L,name,whitelist){
  const H=44,GAP=34,PAD=24;
  const imgs=L.rows.map(r=>{const bx=cellBox(L,r,name);return bx?cellImage(G,bx,H,G.binary):null;});
  const W=Math.max(10,...imgs.map(c=>c?c.width:0))+2*PAD;
  const can=document.createElement("canvas");can.width=W;can.height=PAD*2+imgs.length*(H+GAP);
  const ctx=can.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,can.width,can.height);
  imgs.forEach((c,i)=>{if(c)ctx.drawImage(c,W-PAD-c.width,PAD+i*(H+GAP));});  // rechtsbündig wie im Ausdruck
  await worker.setParameters({tessedit_char_whitelist:whitelist,tessedit_pageseg_mode:"6"});
  const {data}=await worker.recognize(can,{},{blocks:true,text:false});
  if(window.BindeScanDebug)(window.BindeScanDebug[name+(G.binary?"_bin":"")]=can.toDataURL("image/png"));
  const res=imgs.map(()=>[]);
  for(const w of wordsOf(data)){
    const i=Math.floor((w.cy-PAD+GAP/2)/(H+GAP));
    if(i>=0&&i<res.length)res[i].push(w);
  }
  return res.map(ws=>ws.sort((p,q)=>p.x0-q.x0).map(w=>w.t).join(""));
}

/* ---------- Zahlen nach Spaltenformat ---------- */
const digits=s=>String(s||"").replace(/\D/g,"");
// Rand-Müll weg ("12560." -> "12560"), dann das feste Spaltenformat prüfen
const core=s=>String(s||"").replace(/^[^\d]+|[^\d]+$/g,"");
const FORMAT={
  // BrAus: "1.258,0" / "333,0" – immer eine Nachkommastelle
  braus:s=>{const c=core(s);if(!/^(\d[.,]?)?\d{2,3}[.,]?\d$/.test(c))return null;const v=+digits(c)/10;return v>=50&&v<=2100?v:null;},
  br:   s=>{const c=core(s);if(!/^\d{2,3}$|^\d[.,]?\d{3}$/.test(c))return null;const v=+digits(c);return v>=50&&v<=2100?v:null;},
  // Di: "2,36" – immer zwei Nachkommastellen
  di:   s=>{const c=core(s);if(!/^\d{1,2}[.,]?\d{2}$/.test(c))return null;const v=+digits(c)/100;return v>=0.3&&v<=20?v:null;},
  gew:  s=>{const c=core(s);if(!/^\d{1,2}[.,]?\d{3}$/.test(c))return null;const v=+digits(c);return v>=500&&v<=45000?v:null;},
  // Lng: "843" oder "1.612"; abgeschnitten ("1.6...") ist wertlos
  lng:  s=>{if(lngCut(s))return null;const c=core(s);if(!/^\d{2,3}$|^\d[.,]?\d{3}$/.test(c))return null;const v=+digits(c);return v>=50&&v<=6000?v:null;},
  // B (besäumt): J oder N
  b:    s=>{const t=String(s||"").toUpperCase();return /^\W*J\W*$/.test(t)?true:/^\W*N\W*$/.test(t)?false:null;},
  // IDA: nur die bekannten Werte; 760 steht im System für 762
  ida:  s=>{const d=digits(s);for(const v of ID_LIST)if(d.includes(String(v)))return v;return d.includes("760")?762:null;}
};
const lngCut=s=>/\.\.|…/.test(s||"")||/^\d[.,]\d{0,2}[.,]?$/.test(String(s||"").trim());

function weightRatio(r){
  if(!(r.br&&r.di&&r.lng&&r.gew))return null;
  return r.br/1000*r.di/1000*r.lng*RHO*1000/r.gew;
}

/* Geteilter Bund (1:1 (3) usw.): BrAus ist ein Bruchteil von Br */
function isSplit(r){return !!(r.braus&&r.br&&r.braus<r.br*.75);}

/* Breite, über die gebunden wird: besäumt oder geteilt -> BrAus, sonst Br (im Zweifel Br, das ist die breitere) */
function bindWidth(r){
  if(r.braus&&(r.besaeumt===true||isSplit(r)))return r.braus;
  return r.br||r.braus||null;
}

/* Prüfung einer Zeile; wird auch von der Liste nach Korrekturen benutzt.
   level: "ok" = Gewichtsprobe bestanden, "nocheck" = plausibel, aber ohne Probe (Lng fehlt), "bad" = bitte prüfen */
function checkRow(r){
  const msgs=[];let bad=false;
  for(const [k,l] of [["braus","BrAus"],["br","Br"],["di","Di"],["gew","Gew"]]){
    if(r[k])continue;
    if(k==="braus"&&r.besaeumt===false)continue;   // unbesäumt zählt Br, BrAus wird nicht gebraucht
    msgs.push(l+" fehlt");bad=true;
  }
  if(r.besaeumt==null&&!isSplit(r)){msgs.push("Besäumt J/N nicht gelesen – mit Br gerechnet");bad=true;}
  const q=weightRatio(r);
  let checked=false;
  if(q!==null){
    checked=true;
    if(Math.abs(q-1)>CHECK_TOL){msgs.push("Gewicht passt nicht zu Br × Di × Lng ("+(q>1?"+":"")+Math.round((q-1)*100)+" %)");bad=true;}
  }else if(r.br&&r.di&&r.gew)msgs.push(r.lngCut?"Lng im Ausdruck abgeschnitten – keine Gewichtsprobe":"Lng fehlt – keine Gewichtsprobe");
  if(r.braus&&r.br){
    let ok=r.braus<=r.br+0.5&&r.braus>=r.br-80;
    for(let n=2;n<=8&&!ok;n++)ok=r.braus*n<=r.br+0.5&&r.braus*n>=r.br-70;
    if(!ok){msgs.push("BrAus passt nicht zu Br");bad=true;}
  }
  const LBL={ida:"ID",b:"Besäumt",braus:"BrAus",br:"Br",di:"Di",gew:"Gew",lng:"Lng"};
  const uns=(r.unsure||[]).filter(k=>r[k]!=null);
  if(uns.length){msgs.push("unsicher gelesen: "+uns.map(k=>LBL[k]).join(", "));bad=true;}
  return {level:bad?"bad":checked?"ok":"nocheck",msgs};
}

/* Mehrheit aus mehreren Lesarten; ohne Mehrheit gilt die erste und der Wert ist unsicher */
function vote(vals){
  const n=new Map();for(const v of vals)if(v!=null)n.set(v,(n.get(v)||0)+1);
  let best=null,bc=0,second=0;for(const [v,c] of n)if(c>bc){second=bc;best=v;bc=c;}else if(c>second)second=c;
  if(bc>=2&&bc>second)return {v:best,sure:true};
  const first=vals.find(v=>v!=null);
  return {v:first==null?null:first,sure:false};
}

/* Br, Di, Lng, Gew: die Kombination der Lesarten wählen, die die Gewichtsprobe besteht.
   Bestehen mehrere, gewinnt die mit den meisten übereinstimmenden Lesarten. */
function pickWeighed(cands){
  const keys=["br","di","lng","gew"];
  const opts=keys.map(k=>{const s=[...new Set(cands[k].filter(v=>v!=null))];return s.length?s:[null];});
  const cnt=(k,v)=>cands[k].filter(x=>x===v).length;
  let best=null;
  const rec=(i,cur)=>{
    if(i===keys.length){
      const q=weightRatio(cur);if(q===null||Math.abs(q-1)>CHECK_TOL)return;
      const votes=keys.reduce((s,k)=>s+cnt(k,cur[k]),0),dev=Math.abs(q-1);
      if(!best||votes>best.votes||(votes===best.votes&&dev<best.dev))best={votes,dev,vals:{...cur}};
      return;
    }
    for(const v of opts[i]){cur[keys[i]]=v;rec(i+1,cur);}
  };
  rec(0,{});
  const out={},unsure=[];
  for(const k of keys){
    if(best){out[k]=best.vals[k];continue;}
    const r=vote(cands[k]);out[k]=r.v;if(!r.sure&&r.v!=null)unsure.push(k);
  }
  return {vals:out,unsure};
}

/* Ident: die erste Lesart mit typischer Länge (die Zellen-Lesart ist hier am zuverlässigsten) */
function readIdent(reads){
  const c=reads.map(t=>String(t||"").replace(/[^A-Z0-9]/gi,"").toUpperCase());
  return c.find(t=>t.length>=6&&t.length<=9)||c.find(Boolean)||"";
}

/* Ausschnitte der Zellen aus dem Foto, damit man jeden Wert direkt mit dem Zettel vergleichen kann */
function cellCrops(src,L,r){
  const out={};
  for(const n of ["ident","ida","b","braus","br","di","gew","lng"]){
    const bx=cellBox(L,r,n);if(!bx)continue;
    const x0=Math.max(0,bx.x0),x1=Math.min(src.width,bx.x1),y0=Math.max(0,bx.y0),y1=Math.min(src.height,bx.y1);
    if(x1-x0<4||y1-y0<4)continue;
    const s=Math.min(1,56/(y1-y0)),c=document.createElement("canvas");
    c.width=Math.round((x1-x0)*s);c.height=Math.round((y1-y0)*s);
    c.getContext("2d").drawImage(src,x0,y0,x1-x0,y1-y0,0,0,c.width,c.height);
    out[n]=c.toDataURL("image/jpeg",.75);
  }
  return out;
}

/* ---------- Hauptfunktion ---------- */
async function scan(file,progress){
  const say=(t,p)=>{if(progress)progress(t,p);};
  say("Foto laden",0);
  const bmp=await createImageBitmap(file);
  const s=Math.min(1,MAXSIDE/Math.max(bmp.width,bmp.height));
  const src=document.createElement("canvas");src.width=Math.round(bmp.width*s);src.height=Math.round(bmp.height*s);
  src.getContext("2d").drawImage(bmp,0,0,src.width,src.height);
  if(bmp.close)bmp.close();
  const G=toGray(src.getContext("2d").getImageData(0,0,src.width,src.height));
  // Seite: ungefiltert (Kopfzeile bleibt lesbar); Zellen: weichgezeichnet gegen das Druckraster
  const Gi={w:G.w,h:G.h,g:new Uint8ClampedArray(G.g)};
  invertDarkBands(Gi);
  const B=bradley(Gi,Math.round(G.w/18),.16);
  removeThinLines(B);
  const Gb=boxBlur(Gi,BLUR);
  const Bb=bradley(Gb,Math.round(G.w/18),.16);Bb.binary=true;

  say("Texterkennung starten",.05);
  const worker=await makeWorker(m=>{if(/load|initializ/i.test(m.status))say("Texterkennung starten",.05+.1*(m.progress||0));});
  try{
    say("Tabelle suchen",.15);
    await worker.setParameters({tessedit_pageseg_mode:"11",tessedit_char_whitelist:""});
    const {data}=await worker.recognize(grayToCanvas(B),{},{blocks:true,text:false});
    const words=wordsOf(data);
    if(window.BindeScanDebug){window.BindeScanDebug.words=words;window.BindeScanDebug.bin=grayToCanvas(B).toDataURL("image/png");}
    const head=findHeader(words);
    if(!head)throw new Error("Keine Kopfzeile gefunden (BrAus, Br, Di, Gew). Bitte das ganze Blatt gerade und scharf fotografieren.");
    const L=layout(words,head);
    if(!L.rows.length)throw new Error("Kopfzeile gefunden, aber keine Zeilen darunter erkannt.");

    const missing=["braus","br","di","gew"].filter(n=>!L.cols[n]);
    if(missing.length)throw new Error("Spalte nicht gefunden: "+missing.join(", ")+". Ist sie mit ausgedruckt?");

    const jobs=[["braus","0123456789.,"],["br","0123456789.,"],["di","0123456789.,"],["gew","0123456789.,"]];
    if(L.cols.lng)jobs.push(["lng","0123456789.,…"]);
    if(L.cols.ida)jobs.push(["ida","0123456789"]);
    if(L.cols.ident)jobs.push(["ident","ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"]);
    if(L.cols.b)jobs.push(["b","JN"]);
    // jede Spalte zweimal: eigener Schwellwert je Zelle und adaptives Schwarzweißbild
    const second={},third={};
    for(let i=0;i<jobs.length;i++){
      const [name,wl]=jobs[i];
      say("Spalten lesen",.25+.7*i/jobs.length);
      second[name]=await readColumn(worker,Gb,L,name,wl);
      third[name]=await readColumn(worker,Bb,L,name,wl);
    }

    say("Prüfen",.97);
    const rows=L.rows.map((r,i)=>{
      const first=n=>(r.cells[n]||[]).sort((p,q)=>p.x0-q.x0).map(w=>w.t).join("");
      const cand={};
      for(const n of NUMCOLS){
        cand[n]=L.cols[n]?[second[n][i],third[n][i],first(n)].map(FORMAT[n]):[null];
      }
      // im Ausdruck abgeschnittene Länge: keiner Lesart trauen
      const cut=!!L.cols.lng&&[second.lng[i],third.lng[i],first("lng")].some(lngCut);
      if(cut)cand.lng=[null];
      const w=pickWeighed(cand),id=vote(cand.ida);
      // BrAus: nur Lesarten, die zu Br passen; IDA: ein einziger klarer Treffer reicht
      const fits=v=>v!=null&&!checkRow({braus:v,br:w.vals.br}).msgs.some(m=>/BrAus passt/.test(m));
      const ba=w.vals.br&&cand.braus.some(fits)?vote(cand.braus.map(v=>fits(v)?v:null)):vote(cand.braus);
      if(!id.sure&&id.v!=null&&cand.ida.every(v=>v==null||v===id.v))id.sure=true;
      // Besäumt: Buchstabe aus drei Lesarten plus Hinterlegung – bei "J" ist die BrAus-Zelle im Ausdruck grau
      let bs={v:null,sure:false};
      {
        const ab=cellBox(L,r,"braus"),rb=cellBox(L,r,"br");
        let shade=null,strong=false;
        // markierte (dunkle) Zeile: Hinterlegung nicht erkennbar
        if(ab&&rb&&medianIn(G,rb)>100){const ma=medianIn(Gb,ab),mr=medianIn(Gb,rb);{const d=mr-ma;shade=d>15?true:d<7?false:null;strong=d>25||Math.abs(d)<4;}}
        const ocr=L.cols.b?[FORMAT.b(second.b[i]),FORMAT.b(third.b[i]),FORMAT.b(first("b"))].filter(v=>v!=null):[];
        const agree=ocr.every(v=>v===ocr[0]);
        if(ocr.length&&agree&&(shade===null||shade===ocr[0]))bs={v:ocr[0],sure:ocr.length>=2||shade!==null};
        else if(!ocr.length&&shade!==null)bs={v:shade,sure:strong};
        else if(shade!==null&&strong)bs={v:shade,sure:false};
        else bs=vote([...ocr,shade]);
      }
      const unsure=[...w.unsure];
      if(!bs.sure&&bs.v!=null)unsure.push("b");
      if(!ba.sure&&ba.v!=null)unsure.push("braus");
      if(!id.sure&&id.v!=null)unsure.push("ida");
      return {
        ident:readIdent(L.cols.ident?[second.ident[i],third.ident[i],first("ident")]:[]),
        ida:id.v,besaeumt:bs.v,braus:ba.v,br:w.vals.br,di:w.vals.di,gew:w.vals.gew,lng:w.vals.lng,
        lngCut:cut,
        unsure,
        crops:cellCrops(src,L,r),
        raw:window.BindeScanDebug&&Object.fromEntries(Object.keys(second).map(k=>[k,[second[k][i],third[k]?third[k][i]:"",first(k)]]))
      };
    });
    // Zeilen mit weniger als zwei lesbaren Zahlen sind keine Bunde (Fußbereich, Bildlaufleiste)
    for(let i=rows.length-1;i>=0;i--)if(["braus","br","di","gew","lng"].filter(k=>rows[i][k]!=null).length<2)rows.splice(i,1);
    // fehlende ID von den Nachbarzeilen übernehmen (gleiche IDs stehen meist zusammen), aber als unsicher
    if(L.cols.ida)rows.forEach((r,i)=>{
      if(r.ida)return;
      const p=rows.slice(0,i).reverse().find(x=>x.ida),n=rows.slice(i+1).find(x=>x.ida);
      const v=p&&n?(p.ida===n.ida?p.ida:null):(p||n||{}).ida;
      if(v){r.ida=v;r.unsure.push("ida");}
    });
    say("Fertig",1);
    return {rows,hasIda:!!L.cols.ida,hasLng:!!L.cols.lng};
  }finally{
    worker.terminate();
  }
}

window.BindeScan={scan,checkRow,bindWidth};
})();
