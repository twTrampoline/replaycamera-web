// Firebase web configuration is public. Never place Admin SDK credentials here.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, setPersistence, browserSessionPersistence, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
const auth = getAuth(initializeApp({apiKey:'AIzaSyAvsJ0YsGgjRP8OHwGTm0t7hzwHwPc9CXw',authDomain:'tra-sport-replay.firebaseapp.com',projectId:'tra-sport-replay',appId:'1:92485751778:web:47523153d6ad640e7f5fbb'}));
const form=document.querySelector('#login-form'), status=document.querySelector('#login-status'), button=form.querySelector('button');
let started=false;
function script(src,module=false){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;if(module)s.type='module';s.onload=resolve;s.onerror=reject;document.head.append(s);});}
async function start(user){
  await user.getIdToken(true);
  if(started)return;
  started=true;
  status.textContent='正在載入回放系統…';
  await script('webcodecs_export.js?v=09603bf',true);
  await script('tra_web_engine.js?v=tof-tracking-recovery-20261024');
  await script('tof-counter.js?v=tracking-recovery-20261024');
  await script('tof-panel.js?v=tracking-recovery-20261024');
  await script('flutter_bootstrap.js');
  document.querySelector('#login-screen').remove();
  const exit=document.createElement('button');exit.id='replay-signout';exit.textContent='登出';exit.title='登出回放系統';exit.onclick=async()=>{await signOut(auth);location.reload();};document.body.append(exit);
  // Refresh against Firebase so disabling an account ends its active session.
  setInterval(async()=>{try{await auth.currentUser?.getIdToken(true);}catch{await signOut(auth);location.reload();}},60000);
}
try{
 await setPersistence(auth,browserSessionPersistence);
 onAuthStateChanged(auth,async user=>{
  if(!user){if(started)location.reload();else{status.textContent='請使用協會批准嘅帳戶登入';button.disabled=false;}return;}
  try{await start(user);}catch{status.textContent='無法載入，請檢查網絡後重新整理。';button.disabled=true;}
 });
 form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;status.textContent='驗證中…';try{await signInWithEmailAndPassword(auth,form.email.value.trim(),form.password.value);form.password.value='';}catch(error){status.textContent=error.code==='auth/too-many-requests'?'嘗試次數太多，請稍後再試。':error.code==='auth/network-request-failed'?'網絡連線失敗，請再試。':'登入失敗，請確認帳戶密碼或聯絡協會。';button.disabled=false;}});
}catch{status.textContent='登入服務無法連線，請重新整理。';}
