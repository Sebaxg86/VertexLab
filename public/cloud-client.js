/* VertexLab Cloud Client: Supabase Auth (account) + separate Google Drive sync & range streaming. */
(function(root){
 const CONFIG_KEY='vertexlab.cloud.config.v1';
 const SESSION_KEY='vertexlab.cloud.session.v1';
 const PKCE_KEY='vertexlab.cloud.pkce.v1';
 const PENDING_USERNAME_KEY='vertexlab.cloud.pending_username.v1';
 const USERNAME_RE=/^[a-zA-Z0-9._-]{3,24}$/;
 const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
 const MAX_CACHE_BYTES=24*1024*1024;
 const DEFAULT_CONFIG={
  supabaseUrl:'https://enxifznsswmvnonvwlgc.supabase.co',
  supabaseAnonKey:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVueGlmem5zc3dtdm5vbnZ3bGdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU3Mzg5NDMsImV4cCI6MjExMTMxNDk0M30.lJVsoTxfyl5QdDCgzl2_sAyybl8bC3D6qG0Oe2DGkW0',
  googleClientId:'420866989936-dq3an1aoh0p1uqqldof2g85a8d586rrd.apps.googleusercontent.com'
 };

 let config=loadConfig();
 let auth=loadSession();
 let profile=null;
 let driveToken=null;
 let driveTokenExpiry=0;
 let cloudSessions=[];
 const rangeCache=new Map();
 const inflightRanges=new Map();
 let prefetchCount=0;
 let rangeCacheBytes=0;
 const listeners=new Set();
 const jobListeners=new Set();
 const activeJobs=new Map();
 let jobPollTimer=null;

 function loadConfig(){
  if(root.VERTEXLAB_CLOUD_CONFIG&&root.VERTEXLAB_CLOUD_CONFIG.supabaseUrl)return {...DEFAULT_CONFIG,...root.VERTEXLAB_CLOUD_CONFIG};
  try{const raw=localStorage.getItem(CONFIG_KEY);if(raw)return {...DEFAULT_CONFIG,...JSON.parse(raw)};}catch{}
  return {...DEFAULT_CONFIG};
 }
 function saveConfig(next){
  config={
   supabaseUrl:String(next.supabaseUrl||'').trim().replace(/\/+$/,''),
   supabaseAnonKey:String(next.supabaseAnonKey||'').trim(),
   googleClientId:String(next.googleClientId||'').trim()
  };
  try{localStorage.setItem(CONFIG_KEY,JSON.stringify(config));}catch{}
  emit();
 }
 function loadSession(){
  try{const raw=localStorage.getItem(SESSION_KEY);if(raw)return JSON.parse(raw);}catch{}
  return null;
 }
 function saveSession(next){
  auth=next||null;
  try{if(auth)localStorage.setItem(SESSION_KEY,JSON.stringify(auth));else localStorage.removeItem(SESSION_KEY);}catch{}
  emit();
 }
 function emit(){for(const fn of listeners)try{fn(state());}catch{}}
 function onChange(fn){listeners.add(fn);return ()=>listeners.delete(fn);}
 function emitJobs(){for(const fn of jobListeners)try{fn(activeJobs);}catch{}}
 function onJobUpdate(fn){jobListeners.add(fn);return ()=>jobListeners.delete(fn);}
 function jobFor(id){const j=activeJobs.get(id);return j&&!j.done?j:null;}

 async function pollJobs(){
  if(root.VertexBrowser?.enabled)return;
  clearTimeout(jobPollTimer);jobPollTimer=null;
  try{
   const response=await fetch('/api/cloud/jobs');
   if(!response.ok)return;
   const data=await response.json();
   const jobs=data.jobs||{};
   let hasRunning=false,finishedAny=false;
   for(const [id,job] of Object.entries(jobs)){
    const prev=activeJobs.get(id);
    activeJobs.set(id,job);
    if(!job.done){hasRunning=true;}
    else if(prev&&!prev.done){
     finishedAny=true;
     const msg=document.getElementById('message');
     if(msg)msg.textContent=job.error?('Error en nube: '+job.error):(job.phase||'Listo.');
    }
   }
   emitJobs();
   if(finishedAny){
    await refreshCloudSessions().catch(()=>{});
    if(typeof HomeLibrary!=='undefined')await HomeLibrary.refresh();
   }
   if(hasRunning)jobPollTimer=setTimeout(pollJobs,500);
  }catch{
   if([...activeJobs.values()].some(j=>!j.done))jobPollTimer=setTimeout(pollJobs,1500);
  }
 }

 function configured(){return !!(config.supabaseUrl&&config.supabaseAnonKey);}
 function signedIn(){return !!(auth?.accessToken&&auth?.user?.id);}
 function driveConnected(){return !!(signedIn()&&profile?.drive_connected);}
 function state(){
  return {
   configured:configured(),
   signedIn:signedIn(),
   user:auth?.user||null,
   username:profile?.username||null,
   driveConnected:driveConnected(),
   driveEmail:profile?.drive_email||null,
   driveRootFolderId:profile?.drive_root_folder_id||null,
   driveRootFolderName:profile?.drive_root_folder_name||null,
   googleClientId:config.googleClientId||null
  };
 }
 function actionState(){return {connected:driveConnected()};}
 function cachedSessions(){return cloudSessions;}

 function base64url(bytes){
  let bin='';for(const b of bytes)bin+=String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 }
 async function createPkce(){
  const raw=crypto.getRandomValues(new Uint8Array(32));
  const verifier=base64url(raw);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  return {verifier,challenge:base64url(new Uint8Array(digest))};
 }
 function redirectUri(){return location.origin+location.pathname;}

 async function sbFetch(path,options={}){
  if(!configured())throw Error('Configura tu proyecto de Supabase para usar la nube');
  const token=await ensureValidJwt();
  const headers={'apikey':config.supabaseAnonKey,'Content-Type':'application/json',...(options.headers||{})};
  if(token)headers.Authorization='Bearer '+token;
  const response=await fetch(config.supabaseUrl+path,{...options,headers});
  const text=await response.text();
  let data={};try{data=text?JSON.parse(text):{};}catch{}
  if(!response.ok)throw Error(data.error_description||data.error||data.message||('Error de nube HTTP '+response.status));
  return data;
 }

 async function ensureValidJwt(){
  if(!auth?.accessToken)return null;
  if(auth.expiresAt&&Date.now()<auth.expiresAt-60000)return auth.accessToken;
  if(!auth.refreshToken)return auth.accessToken;
  const response=await fetch(config.supabaseUrl+'/auth/v1/token?grant_type=refresh_token',{
   method:'POST',
   headers:{'apikey':config.supabaseAnonKey,'Content-Type':'application/json'},
   body:JSON.stringify({refresh_token:auth.refreshToken})
  });
  const data=await response.json();
  if(!response.ok||!data.access_token){saveSession(null);profile=null;cloudSessions=[];return null;}
  saveSession({
   accessToken:data.access_token,
   refreshToken:data.refresh_token||auth.refreshToken,
   expiresAt:Date.now()+(Number(data.expires_in)||3600)*1000,
   user:{id:data.user.id,email:data.user.email,displayName:data.user.user_metadata?.full_name||data.user.user_metadata?.name||data.user.email}
  });
  return auth.accessToken;
 }

 async function pushSessionToLocal(required=false){
  if(root.VertexBrowser?.enabled||!signedIn())return;
  const token=await ensureValidJwt();
  if(!token){
   if(required)throw Error('Tu sesión de VertexLab expiró. Vuelve a iniciar sesión desde el menú •••.');
   return;
  }
  try{
   const res=await fetch('/api/cloud/session',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({accessToken:token,user:auth.user})
   });
   if(required&&!res.ok){
    const err=await res.json().catch(()=>({}));
    throw Error(err.error||'No se pudo sincronizar tu sesión con el servicio local');
   }
  }catch(error){if(required)throw error;}
 }

 async function refreshProfile(){
  if(!signedIn()){profile=null;cloudSessions=[];emit();return null;}
  const rows=await sbFetch('/rest/v1/profiles?id=eq.'+encodeURIComponent(auth.user.id)+'&select=*');
  profile=Array.isArray(rows)?rows[0]||null:null;
  emit();
  return profile;
 }

 async function refreshCloudSessions(){
  if(!signedIn()){cloudSessions=[];return [];}
  const rows=await sbFetch('/rest/v1/cloud_sessions?select=*&order=created_epoch.desc,id.asc');
  cloudSessions=Array.isArray(rows)?rows.map(VertexCloudModel.cloudRowToLibraryItem).filter(Boolean):[];
  emit();
  return cloudSessions;
 }

 function normalizeUsername(raw){
  return String(raw||'').trim().replace(/^@+/,'');
 }

 async function saveUsername(raw){
  if(!signedIn())throw Error('Inicia sesión primero');
  const clean=normalizeUsername(raw);
  if(!USERNAME_RE.test(clean))throw Error('Usa entre 3 y 24 caracteres (letras, números, punto, guion o guion bajo).');
  try{
   const rows=await sbFetch('/rest/v1/profiles?id=eq.'+encodeURIComponent(auth.user.id),{
    method:'PATCH',
    headers:{Prefer:'return=representation'},
    body:JSON.stringify({username:clean})
   });
   profile=Array.isArray(rows)&&rows[0]?rows[0]:{...(profile||{}),username:clean};
   emit();renderAccountHeader();renderProfileMenu();renderMenu();
   return profile;
  }catch(error){
   if(/duplicate|unique|23505|409/i.test(error.message))throw Error('Ese nombre de usuario ya está en uso. Prueba con otro.');
   throw error;
  }
 }

 function savePendingAuth(key,value){
  try{localStorage.setItem(key,JSON.stringify({value,at:Date.now()}));}catch{}
 }
 function takePendingAuth(key){
  try{
   const raw=localStorage.getItem(key);
   localStorage.removeItem(key);
   if(!raw)return null;
   const parsed=JSON.parse(raw);
   if(!parsed?.at||Date.now()-parsed.at>10*60*1000)return null;
   return parsed.value;
  }catch{return null;}
 }

 async function signIn(desiredUsername=''){
  if(!configured())throw Error('Configura Supabase antes de iniciar sesión');
  const clean=normalizeUsername(desiredUsername);
  if(clean){
   if(!USERNAME_RE.test(clean))throw Error('Usa entre 3 y 24 caracteres (letras, números, punto, guion o guion bajo).');
   savePendingAuth(PENDING_USERNAME_KEY,clean);
  }else{
   try{localStorage.removeItem(PENDING_USERNAME_KEY);}catch{}
  }
  const pkce=await createPkce();
  savePendingAuth(PKCE_KEY,{kind:'supabase',verifier:pkce.verifier});
  const params=new URLSearchParams({
   provider:'google',
   redirect_to:redirectUri(),
   code_challenge:pkce.challenge,
   code_challenge_method:'s256'
  });
  location.assign(config.supabaseUrl+'/auth/v1/authorize?'+params.toString());
 }

 async function signOut(){
  if(signedIn()&&configured()){
   try{await sbFetch('/auth/v1/logout?scope=local',{method:'POST'});}catch{}
  }
  if(!root.VertexBrowser?.enabled){
   try{await fetch('/api/cloud/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}catch{}
  }
  saveSession(null);profile=null;driveToken=null;driveTokenExpiry=0;cloudSessions=[];clearDriveRanges();
  emit();
 }

 async function connectDrive(){
  if(!signedIn())throw Error('Primero inicia sesión en tu cuenta de VertexLab');
  if(!config.googleClientId)throw Error('Falta configurar el Client ID de Google OAuth');
  const pkce=await createPkce();
  const nonce='vl-drive:'+base64url(crypto.getRandomValues(new Uint8Array(12)));
  savePendingAuth(PKCE_KEY,{kind:'drive',verifier:pkce.verifier,state:nonce});
  const params=new URLSearchParams({
   client_id:config.googleClientId,
   redirect_uri:redirectUri(),
   response_type:'code',
   scope:DRIVE_SCOPE,
   access_type:'offline',
   prompt:'consent',
   include_granted_scopes:'true',
   state:nonce,
   code_challenge:pkce.challenge,
   code_challenge_method:'S256'
  });
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?'+params.toString());
 }

 async function disconnectDrive(){
  await sbFetch('/functions/v1/drive-auth',{method:'POST',body:JSON.stringify({action:'disconnect'})});
  driveToken=null;driveTokenExpiry=0;cloudSessions=[];clearDriveRanges();
  if(profile){profile.drive_connected=false;profile.drive_email=null;profile.drive_root_folder_id=null;profile.drive_root_folder_name=null;}
  if(!root.VertexBrowser?.enabled){
   try{await fetch('/api/cloud/drive/disconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}catch{}
  }
  emit();
 }

 async function getDriveAccessToken(force=false){
  if(!force&&driveToken&&Date.now()<driveTokenExpiry-60000)return driveToken;
  const data=await sbFetch('/functions/v1/drive-auth',{method:'POST',body:JSON.stringify({action:'token'})});
  driveToken=data.accessToken;
  driveTokenExpiry=Date.now()+(Number(data.expiresIn)||3600)*1000;
  profile={...(profile||{}),drive_connected:true,drive_email:data.driveEmail,drive_root_folder_id:data.driveRootFolderId,drive_root_folder_name:data.driveRootFolderName};
  emit();
  return driveToken;
 }

 async function listFolders(){
  const token=await getDriveAccessToken();
  const q="mimeType='application/vnd.google-apps.folder' and trashed=false";
  const params=new URLSearchParams({q,fields:'files(id,name,modifiedTime)',orderBy:'name',pageSize:'100'});
  const response=await fetch('https://www.googleapis.com/drive/v3/files?'+params,{headers:{Authorization:'Bearer '+token}});
  const data=await response.json();
  if(!response.ok)throw Error(data.error?.message||'No se pudieron listar carpetas de Google Drive');
  return data.files||[];
 }

 async function createFolder(name){
  const token=await getDriveAccessToken();
  const response=await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name',{
   method:'POST',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({name:String(name||'VertexLab').trim().slice(0,128),mimeType:'application/vnd.google-apps.folder'})
  });
  const data=await response.json();
  if(!response.ok)throw Error(data.error?.message||'No se pudo crear la carpeta en Google Drive');
  return selectFolder(data.id,data.name);
 }

 async function selectFolder(folderId,folderName){
  const data=await sbFetch('/functions/v1/drive-auth',{method:'POST',body:JSON.stringify({action:'folder',folderId,folderName})});
  profile={...(profile||{}),drive_root_folder_id:data.driveRootFolderId,drive_root_folder_name:data.driveRootFolderName};
  emit();
  return data;
 }

 async function fetchDriveBytes(fileId,range=null){
  const url=VertexCloudModel.driveMediaUrl(fileId);
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
   try{
    const token=await getDriveAccessToken(attempt>0&&lastError?.status===401);
    const headers={Authorization:'Bearer '+token};
    if(range)headers.Range=`bytes=${range.start}-${range.end}`;
    let response=await fetch(url,{headers});
    if(response.status===401){
     const refreshed=await getDriveAccessToken(true);
     response=await fetch(url,{headers:{...headers,Authorization:'Bearer '+refreshed}});
    }
    if(response.ok||response.status===206)return await response.arrayBuffer();
    lastError=Object.assign(Error('No se pudo leer el archivo desde Google Drive (HTTP '+response.status+')'),{status:response.status});
    if(![429,500,502,503,504].includes(response.status))throw lastError;
   }catch(error){
    lastError=error;
    if(attempt===2)throw error;
   }
   await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)*(attempt+1)));
  }
  throw lastError||Error('No se pudo leer el archivo desde Google Drive');
 }

 function clearDriveRanges(){
  rangeCache.clear();
  inflightRanges.clear();
  rangeCacheBytes=0;
 }

 function storeRangeCache(key,buffer){
  if(buffer.byteLength>4*1024*1024)return;
  if(rangeCache.has(key)){rangeCacheBytes-=rangeCache.get(key).byteLength;rangeCache.delete(key);}
  while(rangeCacheBytes+buffer.byteLength>MAX_CACHE_BYTES&&rangeCache.size){
   const oldest=rangeCache.keys().next().value;
   rangeCacheBytes-=rangeCache.get(oldest).byteLength;
   rangeCache.delete(oldest);
  }
  rangeCache.set(key,buffer);rangeCacheBytes+=buffer.byteLength;
 }

 function fetchRangeOnce(fileId,start,end){
  const key=`${fileId}:${start}-${end}`;
  if(rangeCache.has(key)){
   const cached=rangeCache.get(key);
   rangeCache.delete(key);rangeCache.set(key,cached);
   return Promise.resolve(cached);
  }
  if(inflightRanges.has(key))return inflightRanges.get(key);
  const task=fetchDriveBytes(fileId,{start,end}).then(buffer=>{
   if(inflightRanges.get(key)===task)storeRangeCache(key,buffer);
   return buffer;
  }).finally(()=>{if(inflightRanges.get(key)===task)inflightRanges.delete(key);});
  inflightRanges.set(key,task);
  return task;
 }

 async function fetchDriveRangeCached(fileId,start,end,totalSize){
  const {blocks,ahead}=VertexCloudModel.playbackBlocks(start,end,totalSize);
  const pending=blocks.map(part=>fetchRangeOnce(fileId,part.start,part.end));
  for(const part of ahead){
   if(prefetchCount>=2)break;
   const key=`${fileId}:${part.start}-${part.end}`;
   if(rangeCache.has(key)||inflightRanges.has(key))continue;
   prefetchCount++;
   fetchRangeOnce(fileId,part.start,part.end).catch(()=>{}).finally(()=>{prefetchCount--;});
  }
  const buffers=await Promise.all(pending);
  if(blocks.length===1)return buffers[0].slice(start-blocks[0].start,end-blocks[0].start+1);
  const output=new Uint8Array(end-start+1);
  for(const [index,part] of blocks.entries()){
   const from=Math.max(start,part.start);
   const to=Math.min(end,part.end);
   output.set(new Uint8Array(buffers[index],from-part.start,to-from+1),from-start);
  }
  return output.buffer;
 }

 async function gunzipToText(buffer){
  if(typeof DecompressionStream==='undefined')throw Error('Este navegador no soporta descompresión gzip de telemetría en la nube');
  const stream=new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
 }

 async function openCloudSession(item,progress){
  if(!item?.cloud?.driveMetaFileId||!item?.cloud?.driveTelemetryFileId)throw Error('Metadatos de nube incompletos para esta sesión');
  progress?.({phase:'Cargando sesión desde Google Drive',percent:15});
  const metaBuf=await fetchDriveBytes(item.cloud.driveMetaFileId);
  const meta=VertexBrowserCore.metadata(JSON.parse(new TextDecoder().decode(metaBuf)));
  meta.id=item.id;meta.featured=!!item.featured;meta.offset=Number(item.offset ?? meta.offset)||0;
  meta.availability=item.availability||{local:false,cloud:true};
  meta.cloud=item.cloud;
  meta.videoPath=item.cloud.driveVideoFileId?'streaming desde Google Drive':null;

  progress?.({phase:'Descargando telemetría',percent:55});
  const telBuf=await fetchDriveBytes(item.cloud.driveTelemetryFileId);
  const telText=item.cloud.telemetryEncoding==='gzip'?await gunzipToText(telBuf):new TextDecoder().decode(telBuf);
  progress?.({phase:'Procesando vueltas',percent:85});
  const builder=new VertexBrowserCore.LapBuilder();
  for(const line of telText.split('\n')){if(line.trim())builder.push(JSON.parse(line));}
  const laps=builder.finish();
  progress?.({phase:'Listo para reproducir en streaming',percent:100});
  return {
   meta,
   laps,
   cloudVideo:item.cloud.driveVideoFileId?{fileId:item.cloud.driveVideoFileId,size:item.cloud.videoSize,type:item.cloud.videoMime||'video/mp4'}:null
  };
 }

 async function syncSession(id){
  if(!root.VertexBrowser?.enabled){
   await pushSessionToLocal(true);
   const response=await fetch('/api/cloud/sync/'+encodeURIComponent(id),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'No se pudo sincronizar la sesión');
   if(data.job){activeJobs.set(id,data.job);emitJobs();pollJobs();}
   else await refreshCloudSessions();
   return data;
  }
  throw Error('La subida directa desde el visor web estará disponible en la siguiente actualización; sincroniza desde VertexLab en tu PC.');
 }

 async function downloadSession(id){
  if(!root.VertexBrowser?.enabled){
   await pushSessionToLocal(true);
   const response=await fetch('/api/cloud/download/'+encodeURIComponent(id),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'No se pudo descargar la sesión');
   if(data.job){activeJobs.set(id,data.job);emitJobs();pollJobs();}
   return data;
  }
  const existing=await root.VertexLibrary?.record?.(id);
  if(existing){return {id,alreadyLocal:true};}
  const item=cloudSessions.find(row=>row.id===id);
  if(!item?.cloud?.driveMetaFileId||!item?.cloud?.driveTelemetryFileId)throw Error('La sesión en la nube no tiene metadatos completos');
  if(activeJobs.get(id)&&!activeJobs.get(id).done)return {started:true,job:activeJobs.get(id)};
  const setProgress=(phase,percent,done=false,error=null)=>{
   activeJobs.set(id,{id,action:'download',phase,percent,done,error});
   emitJobs();
  };
  setProgress('Iniciando descarga',2);
  (async()=>{
   try{
    setProgress('Descargando metadatos',5);
    const metaText=new TextDecoder().decode(await fetchDriveBytes(item.cloud.driveMetaFileId));
    setProgress('Descargando telemetría',12);
    const telBuf=await fetchDriveBytes(item.cloud.driveTelemetryFileId);
    const telemetryText=item.cloud.telemetryEncoding==='gzip'?await gunzipToText(telBuf):new TextDecoder().decode(telBuf);
    const record=await VertexLibrary.saveComponents(
     {meta:{...item,availability:{local:true,cloud:true}},preview:item.preview},
     {
      metaText,
      telemetryText,
      videoSize:item.cloud.videoSize||0,
      videoMime:item.cloud.videoMime||'video/mp4',
      videoName:item.cloud.videoName,
      videoReader:item.cloud.driveVideoFileId?(start,end)=>fetchDriveBytes(item.cloud.driveVideoFileId,{start,end}):null
     },
     p=>setProgress(p.phase,p.percent)
    );
    root.VertexBrowser?.registerSavedRecord?.(record);
    setProgress('Descargada en este dispositivo',100,true);
    const msg=document.getElementById('message');if(msg)msg.textContent='Sesión descargada a este dispositivo.';
    if(typeof HomeLibrary!=='undefined')await HomeLibrary.refresh();
   }catch(error){
    setProgress('Error al descargar',0,true,error.message);
    const msg=document.getElementById('message');if(msg)msg.textContent='Error al descargar: '+error.message;
   }
  })();
  return {started:true,job:activeJobs.get(id)};
 }

 async function deleteCloudSession(id,driveFolderId){
  if(!root.VertexBrowser?.enabled){
   await pushSessionToLocal(true);
   const response=await fetch('/api/cloud/delete/'+encodeURIComponent(id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true,driveFolderId})});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'No se pudo eliminar de Google Drive');
   cloudSessions=cloudSessions.filter(item=>item.id!==id);
   emit();
   return data;
  }
  if(driveFolderId){
   const token=await getDriveAccessToken();
   await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(driveFolderId),{method:'DELETE',headers:{Authorization:'Bearer '+token}});
  }
  await sbFetch('/rest/v1/cloud_sessions?user_id=eq.'+encodeURIComponent(auth.user.id)+'&id=eq.'+encodeURIComponent(id),{method:'DELETE'});
  cloudSessions=cloudSessions.filter(item=>item.id!==id);
  emit();
  return {ok:true};
 }

 async function handleCallback(){
  const params=new URLSearchParams(location.search);
  const code=params.get('code');
  const cbState=params.get('state')||'';
  if(!code)return false;
  const pending=takePendingAuth(PKCE_KEY);
  history.replaceState(null,'',location.pathname+(location.hash||''));

  if(cbState.startsWith('vl-drive:')){
   if(!pending||pending.kind!=='drive'||pending.state!==cbState)throw Error('Estado de autorización de Google Drive inválido');
   const data=await sbFetch('/functions/v1/drive-auth',{
    method:'POST',
    body:JSON.stringify({action:'exchange',code,redirectUri:redirectUri(),codeVerifier:pending.verifier})
   });
   driveToken=data.accessToken;
   driveTokenExpiry=Date.now()+(Number(data.expiresIn)||3600)*1000;
   profile={...(profile||{}),drive_connected:true,drive_email:data.driveEmail,drive_root_folder_id:data.driveRootFolderId,drive_root_folder_name:data.driveRootFolderName};
   await pushSessionToLocal();
   await refreshCloudSessions();
   return true;
  }

  if(configured()&&pending?.kind==='supabase'){
   const response=await fetch(config.supabaseUrl+'/auth/v1/token?grant_type=pkce',{
    method:'POST',
    headers:{'apikey':config.supabaseAnonKey,'Content-Type':'application/json'},
    body:JSON.stringify({auth_code:code,code_verifier:pending.verifier})
   });
   const data=await response.json();
   if(!response.ok||!data.access_token)throw Error(data.error_description||data.msg||'No se pudo completar el inicio de sesión');
   saveSession({
    accessToken:data.access_token,
    refreshToken:data.refresh_token,
    expiresAt:Date.now()+(Number(data.expires_in)||3600)*1000,
    user:{id:data.user.id,email:data.user.email,displayName:data.user.user_metadata?.full_name||data.user.user_metadata?.name||data.user.email}
   });
   await refreshProfile();
   const pendingUser=takePendingAuth(PENDING_USERNAME_KEY)||'';
   if(pendingUser&&!profile?.username){
    try{await saveUsername(pendingUser);}catch(e){const msg=document.getElementById('message');if(msg)msg.textContent=e.message;}
   }
   await pushSessionToLocal();
   await refreshCloudSessions();
   if(!profile?.username)setTimeout(()=>openAuthDialog('username'),200);
   return true;
  }
  return false;
 }

 function attachServiceWorkerBridge(){
  navigator.serviceWorker?.addEventListener('message',async event=>{
   if(event.data?.type!=='vertex-cloud-media-range'||!event.ports[0])return;
   const port=event.ports[0];
   try{
    const {fileId,start,end,size}=event.data;
    const buffer=await fetchDriveRangeCached(fileId,start,end,size);
    port.postMessage({buffer},[buffer]);
   }catch(error){port.postMessage({error:error.message});}
   finally{port.close();}
  });
 }

 async function openFolderDialog(){
  let dialog=document.getElementById('cloud-folder-dialog');
  if(!dialog){
   dialog=document.createElement('dialog');
   dialog.id='cloud-folder-dialog';
   dialog.className='home-delete-dialog cloud-folder-dialog';
   dialog.innerHTML=`<span class="eyebrow">GOOGLE DRIVE / DESTINO</span><h2>Carpeta de sesiones</h2><p id="cloud-folder-current"></p><div id="cloud-folder-list" class="cloud-folder-list" role="list"></div><form id="cloud-folder-create" class="cloud-folder-create"><input id="cloud-folder-name" maxlength="120" placeholder="Nombre de nueva carpeta (ej. VertexLab)" autocomplete="off"><button type="submit">Crear y usar</button></form><p id="cloud-folder-error" class="cloud-folder-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" id="cloud-folder-close">Cerrar</button></div>`;
   document.body.append(dialog);
   dialog.querySelector('#cloud-folder-close').onclick=()=>dialog.close();
   dialog.querySelector('#cloud-folder-create').onsubmit=async event=>{
    event.preventDefault();
    const input=dialog.querySelector('#cloud-folder-name');
    const errEl=dialog.querySelector('#cloud-folder-error');
    const name=input.value.trim();
    if(!name)return;
    errEl.hidden=true;
    const submit=dialog.querySelector('#cloud-folder-create button');
    submit.disabled=true;
    try{
     await createFolder(name);
     await pushSessionToLocal();
     input.value='';
     const msg=document.getElementById('message');if(msg)msg.textContent='Carpeta de Google Drive actualizada: '+name;
     dialog.close();
    }catch(error){errEl.textContent=error.message;errEl.hidden=false;}
    finally{submit.disabled=false;}
   };
  }
  const s=state();
  dialog.querySelector('#cloud-folder-current').textContent='Carpeta actual: '+(s.driveRootFolderName||'VertexLab (se creará automáticamente al subir)');
  const listEl=dialog.querySelector('#cloud-folder-list');
  const errEl=dialog.querySelector('#cloud-folder-error');
  errEl.hidden=true;
  listEl.innerHTML='<span class="cloud-folder-loading">Buscando carpetas en Google Drive…</span>';
  dialog.showModal();
  try{
   const folders=(await listFolders()).filter(f=>!/^[0-9a-f]{32}$/.test(f.name||''));
   listEl.replaceChildren();
   if(!folders.length){
    listEl.innerHTML='<span class="cloud-folder-loading">Aún no hay carpetas de VertexLab en tu Drive. Crea una abajo o usa la predeterminada.</span>';
    return;
   }
   for(const folder of folders){
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='cloud-folder-item'+(folder.id===s.driveRootFolderId?' is-selected':'');
    btn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V4h7l2 3h9v13H3Z"/></svg><span></span>';
    btn.querySelector('span').textContent=folder.name+(folder.id===s.driveRootFolderId?' · Actual':'');
    btn.onclick=async()=>{
     btn.disabled=true;errEl.hidden=true;
     try{
      await selectFolder(folder.id,folder.name);
      await pushSessionToLocal();
      const msg=document.getElementById('message');if(msg)msg.textContent='Carpeta de Google Drive seleccionada: '+folder.name;
      dialog.close();
     }catch(error){errEl.textContent=error.message;errEl.hidden=false;btn.disabled=false;}
    };
    listEl.append(btn);
   }
  }catch(error){
   listEl.replaceChildren();
   errEl.textContent=error.message;errEl.hidden=false;
  }
 }

 const MenuIcons={
  account:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
  drive:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18a4 4 0 0 1-.3-8A6.5 6.5 0 0 1 18 8a5 5 0 0 1 0 10H6Z"/><path d="M12 11v6m-2.5-3.5L12 11l2.5 2.5"/></svg>',
  folder:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5h6l2 2h10v12H3Z"/></svg>',
  refresh:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5M20 20v-4h-4"/></svg>',
  unlink:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 6.6A6.5 6.5 0 0 0 5.7 10 4 4 0 0 0 6 18h11m3.7-2.3A5 5 0 0 0 18 8a6.5 6.5 0 0 0-8.4-3.7M3 3l18 18"/></svg>',
  logout:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2M9 12h11m-3-3 3 3-3 3"/></svg>',
  install:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 8v6m-2.5-2.5L12 14l2.5-2.5M10 18h4"/></svg>',
  sliders:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/></svg>'
 };

 function openAuthDialog(mode='login'){
  let dialog=document.getElementById('cloud-auth-dialog');
  if(!dialog){
   dialog=document.createElement('dialog');
   dialog.id='cloud-auth-dialog';
   dialog.className='cloud-auth-dialog';
   dialog.innerHTML=`<span class="eyebrow" id="cloud-auth-eyebrow">CUENTA VERTEXLAB</span><h2 id="cloud-auth-title">Iniciar sesión</h2><p id="cloud-auth-subtitle" class="auth-subtitle"></p><form id="cloud-auth-form"><div class="cloud-auth-field"><label for="cloud-auth-username">Nombre de usuario</label><div class="cloud-auth-input-wrap"><span>@</span><input id="cloud-auth-username" maxlength="24" autocomplete="username" placeholder="ej. sebaz_gt"></div><small id="cloud-auth-hint">3–24 caracteres (letras, números, . _ -). Si ya tienes cuenta puedes dejarlo vacío.</small></div><button id="cloud-auth-submit" class="cloud-google-btn" type="submit"></button><p id="cloud-auth-error" class="cloud-auth-error" role="alert" hidden></p></form><div class="cloud-auth-footer"><button type="button" id="cloud-auth-cancel" class="cloud-auth-cancel">Cancelar</button></div>`;
   document.body.append(dialog);
   dialog.querySelector('#cloud-auth-cancel').onclick=()=>dialog.close();
   dialog.addEventListener('click',event=>{
    if(event.target!==dialog)return;
    const rect=dialog.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();
   });
  }
  const googleSvg='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.3c1.9-1.8 3-4.4 3-7.5Z"/><path fill="#fff" opacity=".88" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.6c-.9.6-2.1 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3v2.6A10 10 0 0 0 12 22Z"/><path fill="#fff" opacity=".75" d="M6.4 13.9A6 6 0 0 1 6.1 12c0-.7.1-1.3.3-1.9V7.5H3a10 10 0 0 0 0 9l3.4-2.6Z"/><path fill="#fff" opacity=".92" d="M12 6c1.5 0 2.8.5 3.9 1.5l2.9-2.9A10 10 0 0 0 3 7.5l3.4 2.6C7.2 7.8 9.4 6 12 6Z"/></svg>';
  const isUsernameOnly=mode==='username';
  const input=dialog.querySelector('#cloud-auth-username');
  const submit=dialog.querySelector('#cloud-auth-submit');
  const errEl=dialog.querySelector('#cloud-auth-error');
  errEl.hidden=true;
  dialog.querySelector('#cloud-auth-title').textContent=isUsernameOnly?'Tu nombre de usuario':'Iniciar sesión';
  dialog.querySelector('#cloud-auth-subtitle').textContent=isUsernameOnly?'Elige cómo aparecerás en tu perfil de VertexLab.':'Elige tu nombre de usuario y continúa con Google para sincronizar tu biblioteca y perfil en cualquier dispositivo.';
  dialog.querySelector('#cloud-auth-hint').textContent=isUsernameOnly?'3–24 caracteres (letras, números, . _ -).':'3–24 caracteres (letras, números, . _ -). Si ya tienes cuenta puedes dejarlo vacío.';
  input.value=isUsernameOnly?(profile?.username||''):'';
  submit.innerHTML=isUsernameOnly?'<span>Guardar nombre de usuario</span>':googleSvg+'<span>Continuar con Google</span>';
  submit.disabled=false;
  dialog.querySelector('#cloud-auth-form').onsubmit=async event=>{
   event.preventDefault();
   errEl.hidden=true;
   submit.disabled=true;
   try{
    if(isUsernameOnly){
     await saveUsername(input.value);
     dialog.close();
     const msg=document.getElementById('message');if(msg)msg.textContent='Nombre de usuario actualizado: @'+profile.username;
    }else{
     await signIn(input.value);
    }
   }catch(error){
    errEl.textContent=error.message;errEl.hidden=false;submit.disabled=false;
   }
  };
  dialog.showModal();
  input.focus();
 }

 function renderAccountHeader(){
  const trigger=document.getElementById('home-account-trigger');
  const label=document.getElementById('home-account-label');
  if(!trigger||!label)return;
  const s=state();
  trigger.dataset.signedIn=String(s.signedIn);
  trigger.dataset.drive=String(s.driveConnected);
  if(!s.signedIn){
   label.textContent='Iniciar sesión';
   trigger.setAttribute('aria-label','Iniciar sesión en VertexLab');
   trigger.onclick=()=>{if(typeof closeHomeMenus==='function')closeHomeMenus();openAuthDialog('login');};
  }else{
   const handle=s.username?'@'+s.username:(s.user?.email?.split('@')[0]||'Mi cuenta');
   label.textContent=handle;
   trigger.setAttribute('aria-label','Perfil de '+handle);
   trigger.onclick=()=>{
    const open=trigger.getAttribute('aria-expanded')!=='true';
    if(typeof closeHomeMenus==='function')closeHomeMenus();
    if(open){
     renderProfileMenu();
     if(typeof setHeaderDrop==='function')setHeaderDrop('home-profile-menu','home-account-trigger',true);
     if(typeof positionHomeMenu==='function')positionHomeMenu(document.getElementById('home-profile-menu'),trigger);
    }
   };
  }
 }

 function renderProfileMenu(){
  const menu=document.getElementById('home-profile-menu');
  if(!menu)return;
  menu.replaceChildren();
  const s=state();
  if(!s.signedIn)return;
  const addButton=(label,sub,onClick,{icon=MenuIcons.drive,danger=false}={})=>{
   const btn=document.createElement('button');
   if(danger)btn.classList.add('danger-action');
   btn.innerHTML=icon;
   const span=document.createElement('span');span.textContent=label;
   if(sub){const small=document.createElement('small');small.textContent=sub;span.append(small);}
   btn.append(span);
   btn.onclick=onClick;
   menu.append(btn);
  };
  const addDivider=()=>{const hr=document.createElement('hr');hr.className='home-menu-divider';menu.append(hr);};

  const caption=document.createElement('span');
  caption.className='home-menu-caption';
  caption.textContent=(s.username?'@'+s.username+' · ':'')+(s.user?.email||'CUENTA VERTEXLAB');
  menu.append(caption);

  addButton('Nombre de usuario',s.username?'@'+s.username:'Elegir nombre de usuario',()=>{
   if(typeof closeHomeMenus==='function')closeHomeMenus();
   openAuthDialog('username');
  },{icon:MenuIcons.account});

  addDivider();
  if(!s.driveConnected){
   addButton('Vincular Google Drive','Se recordará en todos tus dispositivos',()=>{if(typeof closeHomeMenus==='function')closeHomeMenus();connectDrive().catch(e=>{const msg=document.getElementById('message');if(msg)msg.textContent=e.message;});},{icon:MenuIcons.drive});
  }else{
   addButton('Carpeta de Google Drive',s.driveRootFolderName||'VertexLab (predeterminada)',()=>{
    if(typeof closeHomeMenus==='function')closeHomeMenus();
    openFolderDialog();
   },{icon:MenuIcons.folder});
   addButton('Actualizar biblioteca en la nube',s.driveEmail||'Sincronizar índice',async()=>{
    if(typeof closeHomeMenus==='function')closeHomeMenus();
    try{await refreshCloudSessions();if(typeof HomeLibrary!=='undefined')await HomeLibrary.refresh();}
    catch(e){const msg=document.getElementById('message');if(msg)msg.textContent=e.message;}
   },{icon:MenuIcons.refresh});
   addButton('Desconectar Google Drive','Tus archivos en Drive se conservan',async()=>{
    if(typeof closeHomeMenus==='function')closeHomeMenus();
    try{await disconnectDrive();if(typeof HomeLibrary!=='undefined')await HomeLibrary.refresh();}
    catch(e){const msg=document.getElementById('message');if(msg)msg.textContent=e.message;}
   },{icon:MenuIcons.unlink,danger:true});
  }
  addDivider();
  addButton('Cerrar sesión de VertexLab','Desconecta esta cuenta en este dispositivo',async()=>{
   if(typeof closeHomeMenus==='function')closeHomeMenus();
   await signOut();
   if(typeof HomeLibrary!=='undefined')await HomeLibrary.refresh();
  },{icon:MenuIcons.logout});
 }

 function renderMenu(){
  const menu=document.getElementById('home-cloud-menu');
  if(!menu)return;
  menu.replaceChildren();
  const s=state();
  const addButton=(label,sub,onClick,{icon=MenuIcons.drive,danger=false}={})=>{
   const btn=document.createElement('button');
   if(danger)btn.classList.add('danger-action');
   btn.innerHTML=icon;
   const span=document.createElement('span');span.textContent=label;
   if(sub){const small=document.createElement('small');small.textContent=sub;span.append(small);}
   btn.append(span);
   btn.onclick=onClick;
   menu.append(btn);
  };
  const addDivider=()=>{const hr=document.createElement('hr');hr.className='home-menu-divider';menu.append(hr);};
  const addAdvanced=()=>{
   if(!root.VertexBrowser?.enabled)return;
   addDivider();
   const installKind=root.VertexBrowser.canInstall?.();
   if(installKind){
    addButton('Instalar VertexLab como app',installKind==='ios'?'Agregar a pantalla de inicio en iOS':'Acceso directo a pantalla completa',()=>{
     if(typeof closeHomeMenus==='function')closeHomeMenus();
     root.VertexBrowser.installApp?.();
    },{icon:MenuIcons.install});
   }
   addButton('Ajustes avanzados','Almacenamiento y reproducción local',()=>{
    if(typeof closeHomeMenus==='function')closeHomeMenus();
    root.VertexBrowser.openStorageSettings?.();
   },{icon:MenuIcons.sliders});
  };

  if(!s.configured){
   addButton('Configurar nube (Supabase + Drive)','Pendiente de credenciales del proyecto',()=>{
    if(typeof closeHomeMenus==='function')closeHomeMenus();
    const url=prompt('Supabase URL (https://xxxx.supabase.co):',config.supabaseUrl||'');
    if(url===null)return;
    const anon=prompt('Supabase Anon Key:',config.supabaseAnonKey||'');
    if(anon===null)return;
    const gid=prompt('Google OAuth Client ID:',config.googleClientId||'');
    if(gid===null)return;
    saveConfig({supabaseUrl:url,supabaseAnonKey:anon,googleClientId:gid});
    const msg=document.getElementById('message');if(msg)msg.textContent='Configuración de nube guardada en este navegador.';
   },{icon:MenuIcons.sliders});
   addAdvanced();
   return;
  }

  if(!s.signedIn){
   addButton('Iniciar sesión en VertexLab','Crea o abre tu cuenta con Google',()=>{if(typeof closeHomeMenus==='function')closeHomeMenus();openAuthDialog('login');},{icon:MenuIcons.account});
   addAdvanced();
   return;
  }

  const caption=document.createElement('span');
  caption.className='home-menu-caption';
  caption.textContent=(s.user.email||'CUENTA VERTEXLAB').toUpperCase();
  menu.append(caption);

  if(!s.driveConnected){
   addButton('Vincular Google Drive','Se recordará en todos tus dispositivos',()=>{if(typeof closeHomeMenus==='function')closeHomeMenus();connectDrive().catch(e=>{const msg=document.getElementById('message');if(msg)msg.textContent=e.message;});},{icon:MenuIcons.drive});
  }else{
   addButton('Carpeta de Google Drive',s.driveRootFolderName||'VertexLab (predeterminada)',()=>{
    if(typeof closeHomeMenus==='function')closeHomeMenus();
    openFolderDialog();
   },{icon:MenuIcons.folder});
   addButton('Actualizar biblioteca en la nube',s.driveEmail||'Sincronizar índice',async()=>{
    if(typeof closeHomeMenus==='function')closeHomeMenus();
    try{await refreshCloudSessions();if(typeof HomeLibrary!=='undefined')await HomeLibrary.refresh();}
    catch(e){const msg=document.getElementById('message');if(msg)msg.textContent=e.message;}
   },{icon:MenuIcons.refresh});
   addDivider();
   addButton('Desconectar Google Drive','Tus archivos en Drive se conservan',async()=>{
    if(typeof closeHomeMenus==='function')closeHomeMenus();
    try{await disconnectDrive();if(typeof HomeLibrary!=='undefined')await HomeLibrary.refresh();}
    catch(e){const msg=document.getElementById('message');if(msg)msg.textContent=e.message;}
   },{icon:MenuIcons.unlink,danger:true});
  }
  addButton('Cerrar sesión de VertexLab','Desconecta esta cuenta en este dispositivo',async()=>{
   if(typeof closeHomeMenus==='function')closeHomeMenus();
   await signOut();
   if(typeof HomeLibrary!=='undefined')await HomeLibrary.refresh();
  },{icon:MenuIcons.logout});
  addAdvanced();
 }

 async function init(){
  attachServiceWorkerBridge();
  try{
   const handled=await handleCallback();
   if(!handled&&configured()&&signedIn()){
    await refreshProfile();
    await pushSessionToLocal();
    await refreshCloudSessions();
   }
  }catch(error){
   const msg=document.getElementById('message');
   if(msg)msg.textContent=error.message;
  }
  renderAccountHeader();
  renderProfileMenu();
  renderMenu();
 }

 onChange(()=>{renderAccountHeader();renderProfileMenu();});

 root.VertexCloud={
  init,state,actionState,cachedSessions,onChange,onJobUpdate,jobFor,pollJobs,saveConfig,
  signIn,signOut,saveUsername,openAuthDialog,connectDrive,disconnectDrive,
  listFolders,createFolder,selectFolder,getDriveAccessToken,
  refreshProfile,refreshCloudSessions,openCloudSession,
  syncSession,downloadSession,deleteCloudSession,renderMenu,renderAccountHeader,renderProfileMenu
 };
})(globalThis);
