(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))s(a);new MutationObserver(a=>{for(const i of a)if(i.type==="childList")for(const r of i.addedNodes)r.tagName==="LINK"&&r.rel==="modulepreload"&&s(r)}).observe(document,{childList:!0,subtree:!0});function n(a){const i={};return a.integrity&&(i.integrity=a.integrity),a.referrerPolicy&&(i.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?i.credentials="include":a.crossOrigin==="anonymous"?i.credentials="omit":i.credentials="same-origin",i}function s(a){if(a.ep)return;a.ep=!0;const i=n(a);fetch(a.href,i)}})();class ne extends Error{constructor(t){super(t),this.name="LCYTError"}}class se extends ne{constructor(t,n=null){super(t),this.name="NetworkError",this.statusCode=n}}class ae{constructor({backendUrl:t,apiKey:n,streamKey:s,domain:a,sequence:i=0,verbose:r=!1}={}){this.backendUrl=t,this.apiKey=n,this.streamKey=s,this.domain=a||(typeof globalThis.location<"u"?globalThis.location.origin:"http://localhost"),this.sequence=i,this.verbose=r,this.isStarted=!1,this.syncOffset=0,this.startedAt=0,this._token=null,this._queue=[]}async _fetch(t,{method:n="GET",body:s,auth:a=!0}={}){const i={"Content-Type":"application/json"};a&&this._token&&(i.Authorization=`Bearer ${this._token}`);const r=await fetch(`${this.backendUrl}${t}`,{method:n,headers:i,body:s?JSON.stringify(s):void 0}),c=await r.json();if(!r.ok)throw new se(c.error||`HTTP ${r.status}`,r.status);return c}async start(){const t=await this._fetch("/live",{method:"POST",body:{apiKey:this.apiKey,streamKey:this.streamKey,domain:this.domain,sequence:this.sequence},auth:!1});return this._token=t.token,this.sequence=t.sequence,this.syncOffset=t.syncOffset,this.startedAt=t.startedAt,this.isStarted=!0,this}async end(){return await this._fetch("/live",{method:"DELETE"}),this._token=null,this.isStarted=!1,this}async send(t,n){const s={text:t};n!==void 0&&(typeof n=="object"&&n!==null&&"time"in n?s.time=n.time:s.timestamp=n);const a=await this._fetch("/captions",{method:"POST",body:{captions:[s]}});return this.sequence=a.sequence,a}async sendBatch(t){const n=t!==void 0?t:[...this._queue];t===void 0&&(this._queue=[]);const s=await this._fetch("/captions",{method:"POST",body:{captions:n}});return this.sequence=s.sequence,s}construct(t,n){return this._queue.push({text:t,timestamp:n!==void 0?n:null}),this._queue.length}getQueue(){return[...this._queue]}clearQueue(){const t=this._queue.length;return this._queue=[],t}async sync(){const t=await this._fetch("/sync",{method:"POST"});return this.syncOffset=t.syncOffset,t}async heartbeat(){const t=await this._fetch("/live");return this.sequence=t.sequence,this.syncOffset=t.syncOffset,t}getSequence(){return this.sequence}setSequence(t){return this.sequence=t,this}getSyncOffset(){return this.syncOffset}setSyncOffset(t){return this.syncOffset=t,this}getStartedAt(){return this.startedAt}}const K="lcyt-config",M="lcyt-autoconnect";let g=null;const f={connected:!1,sequence:0,syncOffset:0,startedAt:null,backendUrl:"",apiKey:"",streamKey:""};function V(){try{const e=localStorage.getItem(K);return e?JSON.parse(e):{}}catch{return{}}}function ie(e){try{localStorage.setItem(K,JSON.stringify(e))}catch{}}function ce(){localStorage.removeItem(K),localStorage.removeItem(M)}function W(){return localStorage.getItem(M)==="true"}function oe(e){localStorage.setItem(M,e?"true":"false")}function I(e,t={}){window.dispatchEvent(new CustomEvent(e,{detail:t}))}async function j({backendUrl:e,apiKey:t,streamKey:n}){f.connected&&await U(),g=new ae({backendUrl:e,apiKey:t,streamKey:n}),await g.start(),f.connected=!0,f.backendUrl=e,f.apiKey=t,f.streamKey=n,f.sequence=g.sequence,f.syncOffset=g.syncOffset,f.startedAt=g.startedAt,ie({backendUrl:e,apiKey:t,streamKey:n}),I("lcyt:connected",{sequence:f.sequence,syncOffset:f.syncOffset,backendUrl:e})}async function U(){if(g){try{await g.end()}catch{}g=null,f.connected=!1,I("lcyt:disconnected")}}async function F(e){if(!g||!f.connected)throw new Error("Not connected");const t=await g.send(e);return f.sequence=g.sequence,I("lcyt:sequence-updated",{sequence:f.sequence}),t}async function G(){if(!g||!f.connected)throw new Error("Not connected");const e=await g.sync();return f.syncOffset=g.syncOffset,I("lcyt:sync-updated",{syncOffset:f.syncOffset}),e}async function re(){if(!g||!f.connected)throw new Error("Not connected");const e=Date.now(),t=await g.heartbeat(),n=Date.now()-e;return f.sequence=g.sequence,f.syncOffset=g.syncOffset,I("lcyt:sequence-updated",{sequence:f.sequence}),{...t,roundTripTime:n}}const le=document.getElementById("toast-container");function S(e,t="info",n=5e3){const s=document.createElement("div");s.className=`toast toast--${t}`,s.textContent=e,le.appendChild(s);const a=()=>{s.style.opacity="0",s.style.transition="opacity 0.2s",setTimeout(()=>s.remove(),200)},i=setTimeout(a,n);s.addEventListener("click",()=>{clearTimeout(i),a()})}function de(e,{onSettingsOpen:t,onSyncTogglePanel:n}={}){e.innerHTML=`
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
  `;const s=e.querySelector("#sb-dot"),a=e.querySelector("#sb-status"),i=e.querySelector("#sb-seq"),r=e.querySelector("#sb-offset"),c=e.querySelector("#sb-error"),u=e.querySelector("#sb-sync-btn"),y=e.querySelector("#sb-settings-btn"),d=e.querySelector("#sb-panel-toggle");let l=null;function p(h,m={}){s.className="status-bar__dot"+(h?" status-bar__dot--connected":""),a.textContent=h?"Connected":"Disconnected",m.sequence!==void 0&&(i.textContent=m.sequence),h||(i.textContent="—",r.textContent="—")}function _(h,m=!0){c.textContent=h,c.style.display="",l&&clearTimeout(l),m&&(l=setTimeout(()=>{c.style.display="none",c.textContent=""},5e3))}function b(){l&&clearTimeout(l),c.style.display="none",c.textContent=""}window.addEventListener("lcyt:connected",h=>{p(!0,h.detail),b()}),window.addEventListener("lcyt:disconnected",()=>{p(!1)}),window.addEventListener("lcyt:sequence-updated",h=>{i.textContent=h.detail.sequence}),window.addEventListener("lcyt:sync-updated",h=>{r.textContent=`${h.detail.syncOffset}ms`}),window.addEventListener("lcyt:error",h=>{_(h.detail.message)}),u.addEventListener("click",async()=>{if(f.connected)try{const h=await G();r.textContent=`${h.syncOffset}ms`,S("Synced","success",2e3)}catch(h){_(h.message)}}),y.addEventListener("click",()=>{t&&t()}),d.addEventListener("click",()=>{n&&n()});function k(){d.style.display=window.innerWidth<=768?"":"none"}return k(),window.addEventListener("resize",k),{showError:_,clearError:b}}function ue(){const e=document.createElement("div");e.className="settings-modal",e.style.display="none",e.innerHTML=`
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
  `,document.body.appendChild(e);const t=e.querySelector("#sm-backend-url"),n=e.querySelector("#sm-api-key"),s=e.querySelector("#sm-stream-key"),a=e.querySelector("#sm-auto-connect"),i=e.querySelector("#sm-theme"),r=e.querySelector("#sm-error"),c=e.querySelector("#sm-connect-btn"),u=e.querySelector("#sm-disconnect-btn"),y=e.querySelector("#sm-s-connected"),d=e.querySelector("#sm-s-url"),l=e.querySelector("#sm-s-seq"),p=e.querySelector("#sm-s-offset"),_=e.querySelector("#sm-s-time");let b=null;const k=e.querySelectorAll(".settings-tab"),h=e.querySelectorAll(".settings-panel");k.forEach(o=>{o.addEventListener("click",()=>{k.forEach(w=>w.classList.remove("settings-tab--active")),h.forEach(w=>w.classList.remove("settings-panel--active")),o.classList.add("settings-tab--active"),e.querySelector(`[data-panel="${o.dataset.tab}"]`).classList.add("settings-panel--active"),N()})}),e.querySelector("#sm-eye-api").addEventListener("click",()=>{n.type=n.type==="password"?"text":"password"}),e.querySelector("#sm-eye-stream").addEventListener("click",()=>{s.type=s.type==="password"?"text":"password"});function m(o){const w=document.documentElement;o==="dark"?w.setAttribute("data-theme","dark"):o==="light"?w.setAttribute("data-theme","light"):w.removeAttribute("data-theme");try{localStorage.setItem("lcyt-theme",o)}catch{}}i.addEventListener("change",()=>m(i.value));const q=localStorage.getItem("lcyt-theme")||"auto";i.value=q,m(q);function x(o){r.textContent=o,r.style.display=""}function D(){r.style.display="none",r.textContent=""}function N(){const o=f;y.textContent=o.connected?"● Connected":"○ Disconnected",y.style.color=o.connected?"var(--color-success)":"var(--color-text-dim)",d.textContent=o.backendUrl||"—",l.textContent=o.connected?o.sequence:"—",p.textContent=o.connected?`${o.syncOffset}ms`:"—",_.textContent=b?new Date(b).toLocaleTimeString():"—"}window.addEventListener("lcyt:connected",()=>{b=Date.now(),N()}),window.addEventListener("lcyt:disconnected",()=>N()),window.addEventListener("lcyt:sequence-updated",()=>N()),c.addEventListener("click",async()=>{D();const o=t.value.trim(),w=n.value.trim(),z=s.value.trim();if(!o){x("Backend URL is required");return}if(!w){x("API Key is required");return}if(!z){x("Stream Key is required");return}c.disabled=!0,c.textContent="Connecting…";try{await j({backendUrl:o,apiKey:w,streamKey:z}),oe(a.checked),S("Connected","success"),L()}catch(te){x(te.message||"Connection failed")}finally{c.disabled=!1,c.textContent="Connect"}}),u.addEventListener("click",async()=>{await U(),S("Disconnected","info"),L()}),e.querySelector("#sm-sync-btn").addEventListener("click",async()=>{if(!f.connected){S("Not connected","warning");return}try{const o=await G(),w=e.querySelector("#sm-sync-row");e.querySelector("#sm-sync-result").textContent=`${o.syncOffset}ms`,w.style.display=""}catch(o){S(o.message,"error")}}),e.querySelector("#sm-heartbeat-btn").addEventListener("click",async()=>{if(!f.connected){S("Not connected","warning");return}try{const o=await re(),w=e.querySelector("#sm-hb-row");e.querySelector("#sm-hb-rtt").textContent=`${o.roundTripTime}ms`,w.style.display=""}catch(o){S(o.message,"error")}}),e.querySelector("#sm-clear-btn").addEventListener("click",()=>{ce(),t.value="",n.value="",s.value="",a.checked=!1,S("Config cleared","info")});function L(){e.style.display="none"}e.querySelector("#sm-close").addEventListener("click",L),e.querySelector("#sm-cancel-btn").addEventListener("click",L),e.querySelector("#sm-backdrop").addEventListener("click",L),window.addEventListener("keydown",o=>{o.key==="Escape"&&e.style.display!=="none"&&L()});function H(){const o=V();o.backendUrl&&(t.value=o.backendUrl),o.apiKey&&(n.value=o.apiKey),o.streamKey&&(s.value=o.streamKey),a.checked=W(),D(),N(),e.style.display=""}return window.addEventListener("keydown",o=>{(o.ctrlKey||o.metaKey)&&o.key===","&&(o.preventDefault(),e.style.display==="none"?H():L())}),{open:H,close:L}}const Q="lcyt-pointers";let v=[],E=null;function X(){try{const e=localStorage.getItem(Q);return e?JSON.parse(e):{}}catch{return{}}}function Z(e,t){try{const n=X();n[e]=t,localStorage.setItem(Q,JSON.stringify(n))}catch{}}function C(e,t={}){window.dispatchEvent(new CustomEvent(e,{detail:t}))}function pe(e){return new Promise((t,n)=>{const s=new FileReader;s.onload=a=>{const r=a.target.result.split(`
`).map(p=>p.trim()).filter(p=>p.length>0),c=crypto.randomUUID(),y=X()[e.name]??0,d=Math.min(y,Math.max(0,r.length-1)),l={id:c,name:e.name,lines:r,pointer:d};v.push(l),E||(E=c,C("lcyt:active-changed",{id:c})),C("lcyt:files-changed",{files:P()}),t(l)},s.onerror=()=>n(new Error(`Failed to read file: ${e.name}`)),s.readAsText(e)})}function P(){return v.map(e=>({...e}))}function A(){if(!E)return null;const e=v.find(t=>t.id===E);return e?{...e}:null}function fe(e){v.find(t=>t.id===e)&&(E=e,C("lcyt:active-changed",{id:e}))}function ye(){if(v.length<=1)return;const t=(v.findIndex(n=>n.id===E)+1)%v.length;E=v[t].id,C("lcyt:active-changed",{id:E})}function T(e,t){const n=v.find(a=>a.id===e);if(!n)return;const s=Math.max(0,Math.min(t,n.lines.length-1));n.pointer=s,Z(n.name,s),C("lcyt:pointer-changed",{id:e,pointer:s})}function $(e){const t=v.find(s=>s.id===e);if(!t)return;const n=Math.min(t.pointer+1,t.lines.length-1);t.pointer=n,Z(t.name,n),C("lcyt:pointer-changed",{id:e,pointer:n})}function me(e){const t=v.findIndex(n=>n.id===e);t!==-1&&(v.splice(t,1),E===e&&(v.length===0?E=null:E=v[Math.min(t,v.length-1)].id,C("lcyt:active-changed",{id:E})),C("lcyt:files-changed",{files:P()}))}function he(e){const t=document.createElement("div");t.className="drop-zone",t.innerHTML=`
    <div class="drop-zone__inner">
      <div class="drop-zone__icon">📄</div>
      <div class="drop-zone__title">Drop text files here</div>
      <div class="drop-zone__sub">or click to browse<br>(.txt files)</div>
      <div class="drop-zone__error" id="dz-error" style="display:none"></div>
    </div>
  `;const n=t.querySelector("#dz-error"),s=document.createElement("input");s.type="file",s.accept=".txt,text/plain",s.multiple=!0,s.style.display="none",document.body.appendChild(s);function a(c){n.textContent=c,n.style.display="",setTimeout(()=>{n.style.display="none"},3e3)}async function i(c){for(const u of c){if(!u.name.endsWith(".txt")&&!u.type.startsWith("text/")){a(`Only .txt files supported (skipped: ${u.name})`);continue}try{await pe(u)}catch(y){a(y.message)}}}t.addEventListener("dragover",c=>{c.preventDefault(),t.classList.add("drop-zone--active")}),t.addEventListener("dragleave",c=>{t.contains(c.relatedTarget)||t.classList.remove("drop-zone--active")}),t.addEventListener("drop",c=>{c.preventDefault(),t.classList.remove("drop-zone--active"),i(Array.from(c.dataTransfer.files))}),t.addEventListener("click",()=>{s.value="",s.click()}),s.addEventListener("change",()=>{i(Array.from(s.files))}),e.appendChild(t);function r(){const c=P().length>0;t.style.display=c?"none":""}return window.addEventListener("lcyt:files-changed",r),r(),{element:t,triggerFilePicker:()=>{s.value="",s.click()}}}function ge(e,{triggerFilePicker:t}={}){const n=document.createElement("div");n.className="file-tabs",n.style.display="none";function s(i,r=20){return i.length>r?i.slice(0,r-1)+"…":i}function a(){const i=P(),r=A();n.style.display=i.length>0?"":"none",n.innerHTML="",i.forEach(u=>{const y=r&&r.id===u.id,d=u.lines.length>0&&u.pointer>=u.lines.length-1,l=u.lines.length===0,p=document.createElement("button");p.className="file-tab"+(y?" file-tab--active":""),p.title=u.name;let _="";l?_='<span class="file-tab__badge file-tab__badge--empty">empty</span>':d&&(_='<span class="file-tab__badge file-tab__badge--end">end</span>'),p.innerHTML=`
        <span class="file-tab__name">${s(u.name)}</span>
        ${_}
        <span class="file-tab__close" title="Close">×</span>
      `,p.addEventListener("click",b=>{b.target.classList.contains("file-tab__close")||fe(u.id)}),p.querySelector(".file-tab__close").addEventListener("click",b=>{b.stopPropagation(),!(u.pointer>0&&!confirm(`Close "${u.name}"? Your position (line ${u.pointer+1}) will be remembered.`))&&me(u.id)}),n.appendChild(p)});const c=document.createElement("button");c.className="file-tab file-tab--add",c.title="Add file",c.textContent="+",c.addEventListener("click",()=>{t&&t()}),n.appendChild(c)}return window.addEventListener("lcyt:files-changed",a),window.addEventListener("lcyt:active-changed",a),window.addEventListener("lcyt:pointer-changed",a),e.appendChild(n),a(),{element:n}}const be=500,R=50;function ve(e){const t=document.createElement("div");t.className="caption-view",t.tabIndex=0,t.style.outline="none";const n=document.createElement("ul");n.className="caption-lines",t.appendChild(n);const s=document.createElement("div");s.className="caption-view__eof",s.textContent="End of file",s.style.display="none",t.appendChild(s);let a=null,i=null;function r(y){if(n.innerHTML="",s.style.display="none",!y){const m=document.createElement("div");m.className="caption-view__empty",m.textContent="No file loaded. Drop a .txt file to begin.",n.appendChild(m);return}if(y.lines.length===0){const m=document.createElement("div");m.className="caption-view__empty",m.textContent="No caption lines found in this file.",n.appendChild(m);return}const{lines:d,pointer:l,id:p}=y,_=d.length>be,b=_?Math.max(0,l-R):0,k=_?Math.min(d.length,l+R+1):d.length;for(let m=b;m<k;m++){const q=document.createElement("li");q.className="caption-line",q.dataset.index=m;const x=m===l,D=i===p&&m===a;x&&q.classList.add("caption-line--active"),D&&q.classList.add("caption-line--sent"),q.innerHTML=`
        <span class="caption-line__gutter">${x?"►":""}</span>
        <span class="caption-line__text">${c(d[m])}</span>
      `,q.addEventListener("click",()=>{T(p,m)}),n.appendChild(q)}l>=d.length-1&&(s.style.display="");const h=n.querySelector(".caption-line--active");h&&h.scrollIntoView({block:"center",behavior:"smooth"})}function c(y){return y.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function u(){const y=A();r(y)}return window.addEventListener("lcyt:active-changed",u),window.addEventListener("lcyt:files-changed",u),window.addEventListener("lcyt:pointer-changed",u),e.appendChild(t),u(),{element:t,flashSent:(y,d)=>{a=d,i=y,u(),setTimeout(()=>{n.querySelectorAll(".caption-line--sent").forEach(l=>l.classList.remove("caption-line--sent")),a=null,i=null},1500)}}}const Y=500;let O=[];function _e(e,t={}){window.dispatchEvent(new CustomEvent(e,{detail:t}))}function J({sequence:e,text:t}){const n={sequence:e,text:t,timestamp:new Date().toISOString()};O.unshift(n),O.length>Y&&(O.length=Y),_e("lcyt:sent-updated",{entry:n,total:O.length})}function we(){return[...O]}function Ee(e){const t=document.createElement("div");t.className="sent-panel",t.innerHTML=`
    <div class="sent-panel__header">Sent Captions</div>
    <ul class="sent-list" id="sent-list"></ul>
  `;const n=t.querySelector("#sent-list");function s(i){try{return new Date(i).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:!1})}catch{return"—"}}function a(){const i=we();if(i.length===0){n.innerHTML='<li class="sent-panel__empty">No captions sent yet</li>';return}n.innerHTML="",i.slice(0,500).forEach(r=>{const c=document.createElement("li");c.className="sent-item",c.innerHTML=`
        <span class="sent-item__seq">#${r.sequence}</span>
        <span class="sent-item__time">${s(r.timestamp)}</span>
        <span class="sent-item__text" title="${r.text.replace(/"/g,"&quot;")}">${r.text}</span>
      `,n.appendChild(c)}),n.scrollTop=0}return window.addEventListener("lcyt:sent-updated",a),e.appendChild(t),a(),{element:t}}function Se(e,{captionView:t}={}){const n=document.createElement("div");n.className="input-bar",n.innerHTML=`
    <input
      class="input-bar__input"
      type="text"
      id="caption-input"
      placeholder="Enter: send current line | Type: send custom text"
      disabled
    />
    <button class="input-bar__send" id="send-btn" disabled>▶</button>
  `;const s=n.querySelector("#caption-input"),a=n.querySelector("#send-btn");function i(d){s.disabled=!d,a.disabled=!d}function r(){s.classList.add("input-bar__input--error"),setTimeout(()=>s.classList.remove("input-bar__input--error"),500)}function c(){a.classList.add("input-bar__send--flash"),setTimeout(()=>a.classList.remove("input-bar__send--flash"),300)}async function u(){if(!f.connected){r();return}const d=s.value;if(d.trim()===""){const l=A();if(!l||l.lines.length===0){r(),S("No file loaded or file is empty","warning");return}const p=l.lines[l.pointer],_=l.pointer;try{const b=await F(p);J({sequence:b.sequence,text:p}),t&&t.flashSent(l.id,_),l.pointer<l.lines.length-1?$(l.id):S("End of file reached","info",2500),c()}catch(b){y(b)}}else{const l=d.trim();try{const p=await F(l);J({sequence:p.sequence,text:l}),s.value="",c()}catch(p){y(p)}}}function y(d){const l=d.message||"Send failed";(d.statusCode||d.status)===401?(U(),S("Session expired — please reconnect","error",8e3)):window.dispatchEvent(new CustomEvent("lcyt:error",{detail:{message:l}}))}return s.addEventListener("keydown",d=>{if(d.key==="Enter")d.preventDefault(),u();else if(d.key==="ArrowUp"){d.preventDefault();const l=A();l&&T(l.id,l.pointer-1)}else if(d.key==="ArrowDown"){d.preventDefault();const l=A();l&&$(l.id)}}),a.addEventListener("click",u),window.addEventListener("lcyt:connected",()=>i(!0)),window.addEventListener("lcyt:disconnected",()=>i(!1)),e.appendChild(n),{element:n,focus:()=>s.focus()}}const qe=ue(),Le=document.getElementById("header"),ee=document.getElementById("right-panel");de(Le,{onSettingsOpen:()=>qe.open(),onSyncTogglePanel:()=>{ee.classList.toggle("panel--right-visible")}});const B=document.getElementById("left-panel"),{triggerFilePicker:Ce}=he(B);ge(B,{triggerFilePicker:Ce});const ke=ve(B);Ee(ee);const xe=document.getElementById("footer");Se(xe,{captionView:ke});document.addEventListener("keydown",e=>{var a,i;const t=(a=document.activeElement)==null?void 0:a.tagName;if(t==="INPUT"||t==="TEXTAREA"||t==="SELECT"||((i=document.activeElement)==null?void 0:i.closest("dialog, .settings-modal")))return;const s=A();if(s)switch(e.key){case"ArrowUp":e.preventDefault(),T(s.id,s.pointer-1);break;case"ArrowDown":e.preventDefault(),$(s.id);break;case"PageUp":e.preventDefault(),T(s.id,s.pointer-10);break;case"PageDown":e.preventDefault(),T(s.id,s.pointer+10);break;case"Home":e.preventDefault(),T(s.id,0);break;case"End":e.preventDefault(),T(s.id,s.lines.length-1);break;case"Tab":e.preventDefault(),ye();break}});(async()=>{if(W()){const e=V();if(e.backendUrl&&e.apiKey&&e.streamKey){window.dispatchEvent(new CustomEvent("lcyt:error",{detail:{message:"Connecting…"}}));try{await j(e)}catch(t){window.dispatchEvent(new CustomEvent("lcyt:error",{detail:{message:`Auto-connect failed: ${t.message}`}}))}}}})();
