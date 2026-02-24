(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))s(a);new MutationObserver(a=>{for(const i of a)if(i.type==="childList")for(const d of i.addedNodes)d.tagName==="LINK"&&d.rel==="modulepreload"&&s(d)}).observe(document,{childList:!0,subtree:!0});function n(a){const i={};return a.integrity&&(i.integrity=a.integrity),a.referrerPolicy&&(i.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?i.credentials="include":a.crossOrigin==="anonymous"?i.credentials="omit":i.credentials="same-origin",i}function s(a){if(a.ep)return;a.ep=!0;const i=n(a);fetch(a.href,i)}})();class we extends Error{constructor(e){super(e),this.name="LCYTError"}}class Ee extends we{constructor(e,n=null){super(e),this.name="NetworkError",this.statusCode=n}}class Se{constructor({backendUrl:e,apiKey:n,streamKey:s,domain:a,sequence:i=0,verbose:d=!1}={}){this.backendUrl=e,this.apiKey=n,this.streamKey=s,this.domain=a||(typeof globalThis.location<"u"?globalThis.location.origin:"http://localhost"),this.sequence=i,this.verbose=d,this.isStarted=!1,this.syncOffset=0,this.startedAt=0,this._token=null,this._queue=[]}async _fetch(e,{method:n="GET",body:s,auth:a=!0}={}){const i={"Content-Type":"application/json"};a&&this._token&&(i.Authorization=`Bearer ${this._token}`);const d=await fetch(`${this.backendUrl}${e}`,{method:n,headers:i,body:s?JSON.stringify(s):void 0}),c=await d.json();if(!d.ok)throw new Ee(c.error||`HTTP ${d.status}`,d.status);return c}async start(){const e=await this._fetch("/live",{method:"POST",body:{apiKey:this.apiKey,streamKey:this.streamKey,domain:this.domain,sequence:this.sequence},auth:!1});return this._token=e.token,this.sequence=e.sequence,this.syncOffset=e.syncOffset,this.startedAt=e.startedAt,this.isStarted=!0,this}async end(){return await this._fetch("/live",{method:"DELETE"}),this._token=null,this.isStarted=!1,this}async send(e,n){const s={text:e};n!==void 0&&(typeof n=="object"&&n!==null&&"time"in n?s.time=n.time:s.timestamp=n);const a=await this._fetch("/captions",{method:"POST",body:{captions:[s]}});return this.sequence=a.sequence,a}async sendBatch(e){const n=e!==void 0?e:[...this._queue];e===void 0&&(this._queue=[]);const s=await this._fetch("/captions",{method:"POST",body:{captions:n}});return this.sequence=s.sequence,s}construct(e,n){return this._queue.push({text:e,timestamp:n!==void 0?n:null}),this._queue.length}getQueue(){return[...this._queue]}clearQueue(){const e=this._queue.length;return this._queue=[],e}async sync(){const e=await this._fetch("/sync",{method:"POST"});return this.syncOffset=e.syncOffset,e}async heartbeat(){const e=await this._fetch("/live");return this.sequence=e.sequence,this.syncOffset=e.syncOffset,e}getSequence(){return this.sequence}setSequence(e){return this.sequence=e,this}getSyncOffset(){return this.syncOffset}setSyncOffset(e){return this.syncOffset=e,this}getStartedAt(){return this.startedAt}}const Z="lcyt-config",Q="lcyt-autoconnect";let _=null;const m={connected:!1,sequence:0,syncOffset:0,startedAt:null,backendUrl:"",apiKey:"",streamKey:""};function ue(){try{const t=localStorage.getItem(Z);return t?JSON.parse(t):{}}catch{return{}}}function Le(t){try{localStorage.setItem(Z,JSON.stringify(t))}catch{}}function qe(){localStorage.removeItem(Z),localStorage.removeItem(Q)}function pe(){return localStorage.getItem(Q)==="true"}function Ce(t){localStorage.setItem(Q,t?"true":"false")}function H(t,e={}){window.dispatchEvent(new CustomEvent(t,{detail:e}))}async function fe({backendUrl:t,apiKey:e,streamKey:n}){m.connected&&await ee(),_=new Se({backendUrl:t,apiKey:e,streamKey:n}),await _.start(),m.connected=!0,m.backendUrl=t,m.apiKey=e,m.streamKey=n,m.sequence=_.sequence,m.syncOffset=_.syncOffset,m.startedAt=_.startedAt,Le({backendUrl:t,apiKey:e,streamKey:n}),H("lcyt:connected",{sequence:m.sequence,syncOffset:m.syncOffset,backendUrl:t})}async function ee(){if(_){try{await _.end()}catch{}_=null,m.connected=!1,H("lcyt:disconnected")}}async function se(t){if(!_||!m.connected)throw new Error("Not connected");const e=await _.send(t);return m.sequence=_.sequence,H("lcyt:sequence-updated",{sequence:m.sequence}),e}async function ye(){if(!_||!m.connected)throw new Error("Not connected");const t=await _.sync();return m.syncOffset=_.syncOffset,H("lcyt:sync-updated",{syncOffset:m.syncOffset}),t}async function ke(){if(!_||!m.connected)throw new Error("Not connected");const t=Date.now(),e=await _.heartbeat(),n=Date.now()-t;return m.sequence=_.sequence,m.syncOffset=_.syncOffset,H("lcyt:sequence-updated",{sequence:m.sequence}),{...e,roundTripTime:n}}const me="lcyt-pointers";let L=[],x=null;function ve(){try{const t=localStorage.getItem(me);return t?JSON.parse(t):{}}catch{return{}}}function he(t,e){try{const n=ve();n[t]=e,localStorage.setItem(me,JSON.stringify(n))}catch{}}function P(t,e={}){window.dispatchEvent(new CustomEvent(t,{detail:e}))}function xe(t){return new Promise((e,n)=>{const s=new FileReader;s.onload=a=>{const d=a.target.result.split(`
`).map(h=>h.trim()).filter(h=>h.length>0),c=crypto.randomUUID(),u=ve()[t.name]??0,o=Math.min(u,Math.max(0,d.length-1)),l={id:c,name:t.name,lines:d,pointer:o};L.push(l),x||(x=c,P("lcyt:active-changed",{id:c})),P("lcyt:files-changed",{files:F()}),e(l)},s.onerror=()=>n(new Error(`Failed to read file: ${t.name}`)),s.readAsText(t)})}function F(){return L.map(t=>({...t}))}function B(){if(!x)return null;const t=L.find(e=>e.id===x);return t?{...t}:null}function Te(t){L.find(e=>e.id===t)&&(x=t,P("lcyt:active-changed",{id:t}))}function Ae(){if(L.length<=1)return;const e=(L.findIndex(n=>n.id===x)+1)%L.length;x=L[e].id,P("lcyt:active-changed",{id:x})}function U(t,e){const n=L.find(a=>a.id===t);if(!n)return;const s=Math.max(0,Math.min(e,n.lines.length-1));n.pointer=s,he(n.name,s),P("lcyt:pointer-changed",{id:t,pointer:s})}function Y(t){const e=L.find(s=>s.id===t);if(!e)return;const n=Math.min(e.pointer+1,e.lines.length-1);e.pointer=n,he(e.name,n),P("lcyt:pointer-changed",{id:t,pointer:n})}function Ne(t){const e=L.findIndex(n=>n.id===t);e!==-1&&(L.splice(e,1),x===t&&(L.length===0?x=null:x=L[Math.min(e,L.length-1)].id,P("lcyt:active-changed",{id:x})),P("lcyt:files-changed",{files:F()}))}const Ie=document.getElementById("toast-container");function A(t,e="info",n=5e3){const s=document.createElement("div");s.className=`toast toast--${e}`,s.textContent=t,Ie.appendChild(s);const a=()=>{s.style.opacity="0",s.style.transition="opacity 0.2s",setTimeout(()=>s.remove(),200)},i=setTimeout(a,n);s.addEventListener("click",()=>{clearTimeout(i),a()})}function De(t,{onSettingsOpen:e,onSyncTogglePanel:n}={}){t.innerHTML=`
    <span class="status-bar__brand">lcyt-web</span>
    <span class="status-bar__dot" id="sb-dot"></span>
    <span class="status-bar__label" id="sb-status">Disconnected</span>
    <span class="status-bar__label" style="margin-left:8px">Seq:</span>
    <span class="status-bar__value" id="sb-seq">—</span>
    <span class="status-bar__label" style="margin-left:8px">Offset:</span>
    <span class="status-bar__value" id="sb-offset">—</span>
    <span class="status-bar__error" id="sb-error" style="display:none"></span>
    <span class="status-bar__spacer"></span>
    <button class="status-bar__btn" id="sb-sync-btn" title="Clock sync">⟳ Sync</button>
    <button class="status-bar__btn status-bar__btn--icon" id="sb-panel-toggle" title="Toggle sent panel" style="display:none">▦</button>
    <button class="status-bar__btn status-bar__btn--icon" id="sb-settings-btn" title="Settings (Ctrl+,)">⚙</button>
  `;const s=t.querySelector("#sb-dot"),a=t.querySelector("#sb-status"),i=t.querySelector("#sb-seq"),d=t.querySelector("#sb-offset"),c=t.querySelector("#sb-error"),v=t.querySelector("#sb-sync-btn"),u=t.querySelector("#sb-settings-btn"),o=t.querySelector("#sb-panel-toggle");let l=null;function h(p,f={}){s.className="status-bar__dot"+(p?" status-bar__dot--connected":""),a.textContent=p?"Connected":"Disconnected",f.sequence!==void 0&&(i.textContent=f.sequence),p||(i.textContent="—",d.textContent="—")}function w(p,f=!0){c.textContent=p,c.style.display="",l&&clearTimeout(l),f&&(l=setTimeout(()=>{c.style.display="none",c.textContent=""},5e3))}function b(){l&&clearTimeout(l),c.style.display="none",c.textContent=""}window.addEventListener("lcyt:connected",p=>{h(!0,p.detail),b()}),window.addEventListener("lcyt:disconnected",()=>{h(!1)}),window.addEventListener("lcyt:sequence-updated",p=>{i.textContent=p.detail.sequence}),window.addEventListener("lcyt:sync-updated",p=>{d.textContent=`${p.detail.syncOffset}ms`}),window.addEventListener("lcyt:error",p=>{w(p.detail.message)}),v.addEventListener("click",async()=>{if(m.connected)try{const p=await ye();d.textContent=`${p.syncOffset}ms`,A("Synced","success",2e3)}catch(p){w(p.message)}}),u.addEventListener("click",()=>{e&&e()}),o.addEventListener("click",()=>{n&&n()});function E(){o.style.display=window.innerWidth<=768?"":"none"}return E(),window.addEventListener("resize",E),{showError:w,clearError:b}}function Oe(){const t=document.createElement("div");t.className="settings-modal",t.style.display="none",t.innerHTML=`
    <div class="settings-modal__backdrop" id="sm-backdrop"></div>
    <div class="settings-modal__box">
      <div class="settings-modal__header">
        <span class="settings-modal__title">Settings</span>
        <button class="settings-modal__close" id="sm-close" title="Close (Esc)">✕</button>
      </div>

      <div class="settings-modal__tabs">
        <button class="settings-tab settings-tab--active" data-tab="connection">Connection</button>
        <button class="settings-tab" data-tab="status">Status</button>
        <button class="settings-tab" data-tab="actions">Actions</button>
      </div>

      <div class="settings-modal__body">
        <!-- Connection tab -->
        <div class="settings-panel settings-panel--active" data-panel="connection">
          <div class="settings-field">
            <label class="settings-field__label" for="sm-backend-url">Backend URL</label>
            <input id="sm-backend-url" class="settings-field__input" type="url"
              placeholder="http://localhost:3000" autocomplete="off" />
          </div>

          <div class="settings-field">
            <label class="settings-field__label" for="sm-api-key">API Key</label>
            <div class="settings-field__input-wrap">
              <input id="sm-api-key" class="settings-field__input settings-field__input--has-eye"
                type="password" placeholder="••••••••" autocomplete="off" />
              <button class="settings-field__eye" id="sm-eye-api" title="Toggle visibility">👁</button>
            </div>
          </div>

          <div class="settings-field">
            <label class="settings-field__label" for="sm-stream-key">Stream Key</label>
            <div class="settings-field__input-wrap">
              <input id="sm-stream-key" class="settings-field__input settings-field__input--has-eye"
                type="password" placeholder="••••••••" autocomplete="off" />
              <button class="settings-field__eye" id="sm-eye-stream" title="Toggle visibility">👁</button>
            </div>
          </div>

          <label class="settings-checkbox">
            <input type="checkbox" id="sm-auto-connect" />
            Auto-connect on startup
          </label>

          <div class="settings-field">
            <label class="settings-field__label">Theme</label>
            <select id="sm-theme" class="settings-field__input" style="appearance:auto">
              <option value="auto">Auto (system)</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>

          <div id="sm-error" class="settings-error" style="display:none"></div>
        </div>

        <!-- Status tab -->
        <div class="settings-panel" data-panel="status">
          <div class="settings-status-row">
            <span class="settings-status-row__label">Connection</span>
            <span class="settings-status-row__value" id="sm-s-connected">—</span>
          </div>
          <div class="settings-status-row">
            <span class="settings-status-row__label">Backend URL</span>
            <span class="settings-status-row__value" id="sm-s-url">—</span>
          </div>
          <div class="settings-status-row">
            <span class="settings-status-row__label">Sequence</span>
            <span class="settings-status-row__value" id="sm-s-seq">—</span>
          </div>
          <div class="settings-status-row">
            <span class="settings-status-row__label">Sync Offset</span>
            <span class="settings-status-row__value" id="sm-s-offset">—</span>
          </div>
          <div class="settings-status-row">
            <span class="settings-status-row__label">Last connected</span>
            <span class="settings-status-row__value" id="sm-s-time">—</span>
          </div>
        </div>

        <!-- Actions tab -->
        <div class="settings-panel" data-panel="actions">
          <div class="settings-modal__actions">
            <button class="btn btn--secondary btn--sm" id="sm-sync-btn">⟳ Sync Now</button>
            <button class="btn btn--secondary btn--sm" id="sm-heartbeat-btn">♥ Heartbeat</button>
          </div>
          <div class="settings-status-row" id="sm-hb-row" style="display:none">
            <span class="settings-status-row__label">Round-trip</span>
            <span class="settings-status-row__value" id="sm-hb-rtt">—</span>
          </div>
          <div class="settings-status-row" id="sm-sync-row" style="display:none">
            <span class="settings-status-row__label">Sync offset</span>
            <span class="settings-status-row__value" id="sm-sync-result">—</span>
          </div>
          <hr style="border-color:var(--color-border);margin:8px 0" />
          <button class="btn btn--danger btn--sm" id="sm-clear-btn">🗑 Clear saved config</button>
        </div>
      </div>

      <div class="settings-modal__footer">
        <div class="settings-modal__actions">
          <button class="btn btn--primary" id="sm-connect-btn">Connect</button>
          <button class="btn btn--secondary" id="sm-disconnect-btn">Disconnect</button>
          <button class="btn btn--secondary" id="sm-cancel-btn">Close</button>
        </div>
      </div>
    </div>
  `,document.body.appendChild(t);const e=t.querySelector("#sm-backend-url"),n=t.querySelector("#sm-api-key"),s=t.querySelector("#sm-stream-key"),a=t.querySelector("#sm-auto-connect"),i=t.querySelector("#sm-theme"),d=t.querySelector("#sm-error"),c=t.querySelector("#sm-connect-btn"),v=t.querySelector("#sm-disconnect-btn"),u=t.querySelector("#sm-s-connected"),o=t.querySelector("#sm-s-url"),l=t.querySelector("#sm-s-seq"),h=t.querySelector("#sm-s-offset"),w=t.querySelector("#sm-s-time");let b=null;const E=t.querySelectorAll(".settings-tab"),p=t.querySelectorAll(".settings-panel");E.forEach(r=>{r.addEventListener("click",()=>{E.forEach(S=>S.classList.remove("settings-tab--active")),p.forEach(S=>S.classList.remove("settings-panel--active")),r.classList.add("settings-tab--active"),t.querySelector(`[data-panel="${r.dataset.tab}"]`).classList.add("settings-panel--active"),D()})}),t.querySelector("#sm-eye-api").addEventListener("click",()=>{n.type=n.type==="password"?"text":"password"}),t.querySelector("#sm-eye-stream").addEventListener("click",()=>{s.type=s.type==="password"?"text":"password"});function f(r){const S=document.documentElement;r==="dark"?S.setAttribute("data-theme","dark"):r==="light"?S.setAttribute("data-theme","light"):S.removeAttribute("data-theme");try{localStorage.setItem("lcyt-theme",r)}catch{}}i.addEventListener("change",()=>f(i.value));const q=localStorage.getItem("lcyt-theme")||"auto";i.value=q,f(q);function k(r){d.textContent=r,d.style.display=""}function g(){d.style.display="none",d.textContent=""}function D(){const r=m;u.textContent=r.connected?"● Connected":"○ Disconnected",u.style.color=r.connected?"var(--color-success)":"var(--color-text-dim)",o.textContent=r.backendUrl||"—",l.textContent=r.connected?r.sequence:"—",h.textContent=r.connected?`${r.syncOffset}ms`:"—",w.textContent=b?new Date(b).toLocaleTimeString():"—"}window.addEventListener("lcyt:connected",()=>{b=Date.now(),D()}),window.addEventListener("lcyt:disconnected",()=>D()),window.addEventListener("lcyt:sequence-updated",()=>D()),c.addEventListener("click",async()=>{g();const r=e.value.trim(),S=n.value.trim(),$=s.value.trim();if(!r){k("Backend URL is required");return}if(!S){k("API Key is required");return}if(!$){k("Stream Key is required");return}c.disabled=!0,c.textContent="Connecting…";try{await fe({backendUrl:r,apiKey:S,streamKey:$}),Ce(a.checked),A("Connected","success"),T()}catch(N){k(N.message||"Connection failed")}finally{c.disabled=!1,c.textContent="Connect"}}),v.addEventListener("click",async()=>{await ee(),A("Disconnected","info"),T()}),t.querySelector("#sm-sync-btn").addEventListener("click",async()=>{if(!m.connected){A("Not connected","warning");return}try{const r=await ye(),S=t.querySelector("#sm-sync-row");t.querySelector("#sm-sync-result").textContent=`${r.syncOffset}ms`,S.style.display=""}catch(r){A(r.message,"error")}}),t.querySelector("#sm-heartbeat-btn").addEventListener("click",async()=>{if(!m.connected){A("Not connected","warning");return}try{const r=await ke(),S=t.querySelector("#sm-hb-row");t.querySelector("#sm-hb-rtt").textContent=`${r.roundTripTime}ms`,S.style.display=""}catch(r){A(r.message,"error")}}),t.querySelector("#sm-clear-btn").addEventListener("click",()=>{qe(),e.value="",n.value="",s.value="",a.checked=!1,A("Config cleared","info")});function T(){t.style.display="none"}t.querySelector("#sm-close").addEventListener("click",T),t.querySelector("#sm-cancel-btn").addEventListener("click",T),t.querySelector("#sm-backdrop").addEventListener("click",T),window.addEventListener("keydown",r=>{r.key==="Escape"&&t.style.display!=="none"&&T()});function O(){const r=ue();r.backendUrl&&(e.value=r.backendUrl),r.apiKey&&(n.value=r.apiKey),r.streamKey&&(s.value=r.streamKey),a.checked=pe(),g(),D(),t.style.display=""}return window.addEventListener("keydown",r=>{(r.ctrlKey||r.metaKey)&&r.key===","&&(r.preventDefault(),t.style.display==="none"?O():T())}),{open:O,close:T}}function Me(t){const e=document.createElement("div");e.className="drop-zone",e.innerHTML=`
    <div class="drop-zone__inner">
      <div class="drop-zone__icon">📄</div>
      <div class="drop-zone__title">Drop text files here</div>
      <div class="drop-zone__sub">or click to browse<br>(.txt files)</div>
      <div class="drop-zone__error" id="dz-error" style="display:none"></div>
    </div>
  `;const n=e.querySelector("#dz-error"),s=document.createElement("input");s.type="file",s.accept=".txt,text/plain",s.multiple=!0,s.style.display="none",document.body.appendChild(s);function a(c){n.textContent=c,n.style.display="",setTimeout(()=>{n.style.display="none"},3e3)}async function i(c){for(const v of c){if(!v.name.endsWith(".txt")&&!v.type.startsWith("text/")){a(`Only .txt files supported (skipped: ${v.name})`);continue}try{await xe(v)}catch(u){a(u.message)}}}e.addEventListener("dragover",c=>{c.preventDefault(),e.classList.add("drop-zone--active")}),e.addEventListener("dragleave",c=>{e.contains(c.relatedTarget)||e.classList.remove("drop-zone--active")}),e.addEventListener("drop",c=>{c.preventDefault(),e.classList.remove("drop-zone--active"),i(Array.from(c.dataTransfer.files))}),e.addEventListener("click",()=>{s.value="",s.click()}),s.addEventListener("change",()=>{i(Array.from(s.files))}),t.appendChild(e);function d(){const c=F().length>0;e.style.display=c?"none":""}return window.addEventListener("lcyt:files-changed",d),d(),{element:e,triggerFilePicker:()=>{s.value="",s.click()}}}let j="captions";function ae(t){j=t,window.dispatchEvent(new CustomEvent("lcyt:view-changed",{detail:{view:t}}))}function Pe(t,{triggerFilePicker:e}={}){const n=document.createElement("div");n.className="file-tabs";function s(i,d=20){return i.length>d?i.slice(0,d-1)+"…":i}function a(){const i=F(),d=B();n.style.display="",n.innerHTML="",i.forEach(o=>{const l=j==="captions"&&d&&d.id===o.id,h=o.lines.length>0&&o.pointer>=o.lines.length-1,w=o.lines.length===0,b=document.createElement("button");b.className="file-tab"+(l?" file-tab--active":""),b.title=o.name;let E="";w?E='<span class="file-tab__badge file-tab__badge--empty">empty</span>':h&&(E='<span class="file-tab__badge file-tab__badge--end">end</span>'),b.innerHTML=`
        <span class="file-tab__name">${s(o.name)}</span>
        ${E}
        <span class="file-tab__close" title="Close">×</span>
      `,b.addEventListener("click",p=>{p.target.classList.contains("file-tab__close")||(ae("captions"),Te(o.id))}),b.querySelector(".file-tab__close").addEventListener("click",p=>{p.stopPropagation(),!(o.pointer>0&&!confirm(`Close "${o.name}"? Your position (line ${o.pointer+1}) will be remembered.`))&&Ne(o.id)}),n.appendChild(b)});const c=document.createElement("button");c.className="file-tab file-tab--add",c.title="Add file",c.textContent="+",c.addEventListener("click",()=>{e&&e()}),n.appendChild(c);const v=document.createElement("div");v.className="file-tabs__spacer",n.appendChild(v);const u=document.createElement("button");u.className="file-tab file-tab--audio"+(j==="audio"?" file-tab--active":""),u.title="Audio & STT Settings",u.innerHTML='<span class="file-tab__audio-icon">&#127908;</span> Audio',u.addEventListener("click",()=>{ae("audio")}),n.appendChild(u)}return window.addEventListener("lcyt:files-changed",a),window.addEventListener("lcyt:active-changed",a),window.addEventListener("lcyt:pointer-changed",a),window.addEventListener("lcyt:view-changed",a),t.appendChild(n),a(),{element:n}}const $e=500,ie=50;function Ue(t){const e=document.createElement("div");e.className="caption-view",e.tabIndex=0,e.style.outline="none";const n=document.createElement("ul");n.className="caption-lines",e.appendChild(n);const s=document.createElement("div");s.className="caption-view__eof",s.textContent="End of file",s.style.display="none",e.appendChild(s);let a=null,i=null;function d(u){if(n.innerHTML="",s.style.display="none",!u){const f=document.createElement("div");f.className="caption-view__empty",f.textContent="No file loaded. Drop a .txt file to begin.",n.appendChild(f);return}if(u.lines.length===0){const f=document.createElement("div");f.className="caption-view__empty",f.textContent="No caption lines found in this file.",n.appendChild(f);return}const{lines:o,pointer:l,id:h}=u,w=o.length>$e,b=w?Math.max(0,l-ie):0,E=w?Math.min(o.length,l+ie+1):o.length;for(let f=b;f<E;f++){const q=document.createElement("li");q.className="caption-line",q.dataset.index=f;const k=f===l,g=i===h&&f===a;k&&q.classList.add("caption-line--active"),g&&q.classList.add("caption-line--sent"),q.innerHTML=`
        <span class="caption-line__gutter">${k?"►":""}</span>
        <span class="caption-line__text">${c(o[f])}</span>
      `,q.addEventListener("click",()=>{U(h,f)}),n.appendChild(q)}l>=o.length-1&&(s.style.display="");const p=n.querySelector(".caption-line--active");p&&p.scrollIntoView({block:"center",behavior:"smooth"})}function c(u){return u.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function v(){const u=B();d(u)}return window.addEventListener("lcyt:active-changed",v),window.addEventListener("lcyt:files-changed",v),window.addEventListener("lcyt:pointer-changed",v),t.appendChild(e),v(),{element:e,flashSent:(u,o)=>{a=o,i=u,v(),setTimeout(()=>{n.querySelectorAll(".caption-line--sent").forEach(l=>l.classList.remove("caption-line--sent")),a=null,i=null},1500)}}}const ce=500;let R=[];function Ke(t,e={}){window.dispatchEvent(new CustomEvent(t,{detail:e}))}function oe({sequence:t,text:e}){const n={sequence:t,text:e,timestamp:new Date().toISOString()};R.unshift(n),R.length>ce&&(R.length=ce),Ke("lcyt:sent-updated",{entry:n,total:R.length})}function Be(){return[...R]}function Re(t){const e=document.createElement("div");e.className="sent-panel",e.innerHTML=`
    <div class="sent-panel__header">Sent Captions</div>
    <ul class="sent-list" id="sent-list"></ul>
  `;const n=e.querySelector("#sent-list");function s(i){try{return new Date(i).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:!1})}catch{return"—"}}function a(){const i=Be();if(i.length===0){n.innerHTML='<li class="sent-panel__empty">No captions sent yet</li>';return}n.innerHTML="",i.slice(0,500).forEach(d=>{const c=document.createElement("li");c.className="sent-item",c.innerHTML=`
        <span class="sent-item__seq">#${d.sequence}</span>
        <span class="sent-item__time">${s(d.timestamp)}</span>
        <span class="sent-item__text" title="${d.text.replace(/"/g,"&quot;")}">${d.text}</span>
      `,n.appendChild(c)}),n.scrollTop=0}return window.addEventListener("lcyt:sent-updated",a),t.appendChild(e),a(),{element:e}}function He(t,{captionView:e}={}){const n=document.createElement("div");n.className="input-bar",n.innerHTML=`
    <input
      class="input-bar__input"
      type="text"
      id="caption-input"
      placeholder="Enter: send current line | Type: send custom text"
      disabled
    />
    <button class="input-bar__send" id="send-btn" disabled>▶</button>
  `;const s=n.querySelector("#caption-input"),a=n.querySelector("#send-btn");function i(o){s.disabled=!o,a.disabled=!o}function d(){s.classList.add("input-bar__input--error"),setTimeout(()=>s.classList.remove("input-bar__input--error"),500)}function c(){a.classList.add("input-bar__send--flash"),setTimeout(()=>a.classList.remove("input-bar__send--flash"),300)}async function v(){if(!m.connected){d();return}const o=s.value;if(o.trim()===""){const l=B();if(!l||l.lines.length===0){d(),A("No file loaded or file is empty","warning");return}const h=l.lines[l.pointer],w=l.pointer;try{const b=await se(h);oe({sequence:b.sequence,text:h}),e&&e.flashSent(l.id,w),l.pointer<l.lines.length-1?Y(l.id):A("End of file reached","info",2500),c()}catch(b){u(b)}}else{const l=o.trim();try{const h=await se(l);oe({sequence:h.sequence,text:l}),s.value="",c()}catch(h){u(h)}}}function u(o){const l=o.message||"Send failed";(o.statusCode||o.status)===401?(ee(),A("Session expired — please reconnect","error",8e3)):window.dispatchEvent(new CustomEvent("lcyt:error",{detail:{message:l}}))}return s.addEventListener("keydown",o=>{if(o.key==="Enter")o.preventDefault(),v();else if(o.key==="ArrowUp"){o.preventDefault();const l=B();l&&U(l.id,l.pointer-1)}else if(o.key==="ArrowDown"){o.preventDefault();const l=B();l&&Y(l.id)}}),a.addEventListener("click",v),window.addEventListener("lcyt:connected",()=>i(!0)),window.addEventListener("lcyt:disconnected",()=>i(!1)),t.appendChild(n),{element:n,focus:()=>s.focus()}}const le="lcyt-audio-device",de="lcyt-stt-lang",be="lcyt-stt-config",Fe=[{value:"latest_long",label:"Latest Long"},{value:"latest_short",label:"Latest Short"},{value:"telephony",label:"Telephony"},{value:"video",label:"Video"},{value:"medical_dictation",label:"Medical Dictation"}],J=[{code:"en-US",label:"English (US)"},{code:"en-GB",label:"English (UK)"},{code:"es-ES",label:"Spanish (Spain)"},{code:"es-MX",label:"Spanish (Mexico)"},{code:"fr-FR",label:"French"},{code:"de-DE",label:"German"},{code:"it-IT",label:"Italian"},{code:"pt-BR",label:"Portuguese (Brazil)"},{code:"pt-PT",label:"Portuguese (Portugal)"},{code:"ja-JP",label:"Japanese"},{code:"ko-KR",label:"Korean"},{code:"zh-CN",label:"Chinese (Simplified)"},{code:"zh-TW",label:"Chinese (Traditional)"},{code:"ar-SA",label:"Arabic"},{code:"hi-IN",label:"Hindi"},{code:"ru-RU",label:"Russian"},{code:"nl-NL",label:"Dutch"},{code:"pl-PL",label:"Polish"},{code:"sv-SE",label:"Swedish"},{code:"da-DK",label:"Danish"},{code:"fi-FI",label:"Finnish"},{code:"nb-NO",label:"Norwegian"},{code:"tr-TR",label:"Turkish"},{code:"id-ID",label:"Indonesian"},{code:"th-TH",label:"Thai"},{code:"vi-VN",label:"Vietnamese"},{code:"uk-UA",label:"Ukrainian"},{code:"cs-CZ",label:"Czech"},{code:"ro-RO",label:"Romanian"},{code:"hu-HU",label:"Hungarian"}];function ge(){try{return JSON.parse(localStorage.getItem(be)||"{}")}catch{return{}}}function K(t){const e=ge();localStorage.setItem(be,JSON.stringify({...e,...t}))}function ze(t){var ne;const e=document.createElement("div");e.className="audio-panel",e.style.display="none",e.innerHTML=`
    <div class="audio-panel__scroll">

      <!-- ── Audio Source ─────────────────────────────────────── -->
      <section class="audio-section">
        <h3 class="audio-section__title">Audio Source</h3>

        <div class="audio-field">
          <label class="audio-field__label" for="ap-device-select">Microphone</label>
          <div class="audio-field__row">
            <select id="ap-device-select" class="audio-field__select">
              <option value="">— select a device —</option>
            </select>
            <button id="ap-refresh-btn" class="btn btn--secondary btn--sm" title="Refresh device list">&#8635;</button>
          </div>
        </div>

        <div class="audio-field">
          <label class="audio-field__label">Microphone Permission</label>
          <div class="audio-field__row">
            <span id="ap-perm-status" class="audio-perm-status audio-perm-status--unknown">Unknown</span>
            <button id="ap-perm-btn" class="btn btn--secondary btn--sm">Request Permission</button>
          </div>
        </div>

        <div class="audio-field">
          <label class="audio-field__label">Audio Level</label>
          <canvas id="ap-meter-canvas" class="audio-meter" width="300" height="20" title="Audio level meter (active when listening)"></canvas>
        </div>

        <div class="audio-field audio-field--actions">
          <button id="ap-start-btn" class="btn btn--primary" disabled>&#9654; Start Listening</button>
          <button id="ap-stop-btn"  class="btn btn--secondary" disabled style="display:none">&#9632; Stop Listening</button>
          <span id="ap-listen-status" class="audio-listen-status"></span>
        </div>
      </section>

      <!-- ── STT Settings ──────────────────────────────────────── -->
      <section class="audio-section">
        <h3 class="audio-section__title">Speech Recognition (STT)</h3>

        <div class="audio-field">
          <label class="audio-field__label" for="ap-lang-input">Language</label>
          <div class="audio-lang-wrap">
            <input id="ap-lang-input" class="audio-field__input" type="text"
                   placeholder="Type to filter…" autocomplete="off" spellcheck="false" />
            <div id="ap-lang-list" class="audio-lang-list" style="display:none"></div>
          </div>
          <span id="ap-lang-selected" class="audio-field__hint"></span>
        </div>

        <div class="audio-field">
          <label class="audio-field__label" for="ap-model-select">STT Model</label>
          <select id="ap-model-select" class="audio-field__select">
            ${Fe.map(y=>`<option value="${y.value}">${y.label}</option>`).join("")}
          </select>
        </div>

        <div class="audio-field">
          <label class="audio-field__label">Options</label>
          <label class="audio-checkbox">
            <input type="checkbox" id="ap-punctuation-chk" checked />
            <span>Automatic punctuation</span>
          </label>
          <label class="audio-checkbox">
            <input type="checkbox" id="ap-profanity-chk" />
            <span>Profanity filter</span>
          </label>
          <label class="audio-checkbox">
            <input type="checkbox" id="ap-autosend-chk" />
            <span>Auto-send final results</span>
          </label>
        </div>

        <div class="audio-field">
          <label class="audio-field__label" for="ap-confidence-slider">
            Confidence threshold: <span id="ap-confidence-val">0.70</span>
          </label>
          <input id="ap-confidence-slider" class="audio-field__range" type="range"
                 min="0" max="1" step="0.05" value="0.70" />
          <span class="audio-field__hint">Results below this score are shown in red and not auto-sent.</span>
        </div>

        <div class="audio-field">
          <label class="audio-field__label" for="ap-maxlen-input">
            Max caption length (chars)
          </label>
          <input id="ap-maxlen-input" class="audio-field__input audio-field__input--short" type="number"
                 min="20" max="500" step="10" value="80" />
          <span class="audio-field__hint">Long results are split at sentence boundaries then by this limit.</span>
        </div>
      </section>

    </div>
  `,t.appendChild(e);const n=e.querySelector("#ap-device-select"),s=e.querySelector("#ap-refresh-btn"),a=e.querySelector("#ap-perm-status"),i=e.querySelector("#ap-perm-btn"),d=e.querySelector("#ap-meter-canvas"),c=e.querySelector("#ap-start-btn"),v=e.querySelector("#ap-stop-btn"),u=e.querySelector("#ap-listen-status"),o=e.querySelector("#ap-lang-input"),l=e.querySelector("#ap-lang-list"),h=e.querySelector("#ap-lang-selected"),w=e.querySelector("#ap-model-select"),b=e.querySelector("#ap-punctuation-chk"),E=e.querySelector("#ap-profanity-chk"),p=e.querySelector("#ap-autosend-chk"),f=e.querySelector("#ap-confidence-slider"),q=e.querySelector("#ap-confidence-val"),k=e.querySelector("#ap-maxlen-input"),g=ge();g.model&&(w.value=g.model),g.punctuation!==void 0&&(b.checked=g.punctuation),g.profanity!==void 0&&(E.checked=g.profanity),g.autosend!==void 0&&(p.checked=g.autosend),g.confidence!==void 0&&(f.value=g.confidence,q.textContent=Number(g.confidence).toFixed(2)),g.maxLen&&(k.value=g.maxLen);const D=localStorage.getItem(de)||"en-US",T=J.find(y=>y.code===D);o.value=T?T.label:D,h.textContent=D;async function O(){var y;if(!((y=navigator.mediaDevices)!=null&&y.enumerateDevices)){n.innerHTML='<option value="">Not supported in this browser</option>';return}try{const C=(await navigator.mediaDevices.enumerateDevices()).filter(M=>M.kind==="audioinput"),z=localStorage.getItem(le)||"";n.innerHTML='<option value="">— select a device —</option>',C.forEach(M=>{const V=document.createElement("option");V.value=M.deviceId,V.textContent=M.label||`Microphone (${M.deviceId.slice(0,8)}…)`,M.deviceId===z&&(V.selected=!0),n.appendChild(V)}),r()}catch(I){n.innerHTML=`<option value="">Error: ${I.message}</option>`}}function r(){const y=n.value!=="";c.disabled=!y}n.addEventListener("change",()=>{localStorage.setItem(le,n.value),r()}),s.addEventListener("click",O),(ne=navigator.mediaDevices)!=null&&ne.addEventListener&&navigator.mediaDevices.addEventListener("devicechange",O);async function S(){if(navigator.permissions)try{const y=await navigator.permissions.query({name:"microphone"});$(y.state),y.addEventListener("change",()=>$(y.state))}catch{}}function $(y){a.textContent=y.charAt(0).toUpperCase()+y.slice(1),a.className=`audio-perm-status audio-perm-status--${y}`,y==="granted"&&O()}i.addEventListener("click",async()=>{try{(await navigator.mediaDevices.getUserMedia({audio:!0})).getTracks().forEach(I=>I.stop()),$("granted"),await O()}catch{$("denied")}});const N=d.getContext("2d");function te(){N.clearRect(0,0,d.width,d.height),N.fillStyle="var(--color-surface-elevated, #2a2a2a)",N.fillRect(0,0,d.width,d.height),N.fillStyle="var(--color-border, #444)",N.font="10px sans-serif",N.textAlign="center",N.textBaseline="middle",N.fillText("Audio level — active when listening",d.width/2,d.height/2)}return te(),c.addEventListener("click",()=>{window.dispatchEvent(new CustomEvent("lcyt:audio-start",{detail:{deviceId:n.value}})),c.style.display="none",v.style.display="",u.textContent="Listening…",u.className="audio-listen-status audio-listen-status--active"}),v.addEventListener("click",()=>{window.dispatchEvent(new CustomEvent("lcyt:audio-stop")),v.style.display="none",c.style.display="",u.textContent="",u.className="audio-listen-status",te()}),o.addEventListener("input",()=>{const y=o.value.trim().toLowerCase();if(!y){l.style.display="none";return}const I=J.filter(C=>C.label.toLowerCase().includes(y)||C.code.toLowerCase().includes(y));if(I.length===0){l.style.display="none";return}l.innerHTML=I.map(C=>`<button class="audio-lang-option" data-code="${C.code}">${C.label} <span class="audio-lang-code">${C.code}</span></button>`).join(""),l.style.display=""}),l.addEventListener("click",y=>{const I=y.target.closest("[data-code]");if(!I)return;const C=I.dataset.code,z=J.find(M=>M.code===C);o.value=z?z.label:C,h.textContent=C,l.style.display="none",localStorage.setItem(de,C)}),document.addEventListener("click",y=>{!o.contains(y.target)&&!l.contains(y.target)&&(l.style.display="none")}),f.addEventListener("input",()=>{q.textContent=Number(f.value).toFixed(2),K({confidence:f.value})}),w.addEventListener("change",()=>K({model:w.value})),b.addEventListener("change",()=>K({punctuation:b.checked})),E.addEventListener("change",()=>K({profanity:E.checked})),p.addEventListener("change",()=>K({autosend:p.checked})),k.addEventListener("change",()=>K({maxLen:k.value})),S(),O(),{element:e,show(){e.style.display=""},hide(){e.style.display="none"},getSttConfig(){return{deviceId:n.value,language:h.textContent||"en-US",model:w.value,punctuation:b.checked,profanity:E.checked,autosend:p.checked,confidence:parseFloat(f.value),maxLen:parseInt(k.value,10)||80}}}}const Ve=Oe(),Ge=document.getElementById("header"),_e=document.getElementById("right-panel");De(Ge,{onSettingsOpen:()=>Ve.open(),onSyncTogglePanel:()=>{_e.classList.toggle("panel--right-visible")}});const G=document.getElementById("left-panel"),W=Me(G),{triggerFilePicker:Je}=W;Pe(G,{triggerFilePicker:Je});const X=Ue(G),re=ze(G);window.addEventListener("lcyt:view-changed",t=>{const{view:e}=t.detail;if(e==="audio")W.element.style.display="none",X.element.style.display="none",re.show();else{const n=F().length>0;W.element.style.display=n?"none":"",X.element.style.display="",re.hide()}});Re(_e);const Ye=document.getElementById("footer");He(Ye,{captionView:X});document.addEventListener("keydown",t=>{var a,i;const e=(a=document.activeElement)==null?void 0:a.tagName;if(e==="INPUT"||e==="TEXTAREA"||e==="SELECT"||((i=document.activeElement)==null?void 0:i.closest("dialog, .settings-modal")))return;const s=B();if(s)switch(t.key){case"ArrowUp":t.preventDefault(),U(s.id,s.pointer-1);break;case"ArrowDown":t.preventDefault(),Y(s.id);break;case"PageUp":t.preventDefault(),U(s.id,s.pointer-10);break;case"PageDown":t.preventDefault(),U(s.id,s.pointer+10);break;case"Home":t.preventDefault(),U(s.id,0);break;case"End":t.preventDefault(),U(s.id,s.lines.length-1);break;case"Tab":t.preventDefault(),Ae();break}});(async()=>{if(pe()){const t=ue();if(t.backendUrl&&t.apiKey&&t.streamKey){window.dispatchEvent(new CustomEvent("lcyt:error",{detail:{message:"Connecting…"}}));try{await fe(t)}catch(e){window.dispatchEvent(new CustomEvent("lcyt:error",{detail:{message:`Auto-connect failed: ${e.message}`}}))}}}})();
