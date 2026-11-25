(() => {
  const $ = (selector) => document.querySelector(selector);
  const canvas = $('#gameCanvas');
  const ctx = canvas.getContext('2d');
  const audio = $('#audioPlayer');
  const lanes = ['D', 'F', 'J', 'K'];
  const laneColors = ['#a88bff', '#62e8e4', '#d6ff62', '#ff74ba'];
  const travel = 1.72;
  let source = 'file', chart = [], processed = new Set(), active = false, paused = false;
  let mode = '', currentName = '', localUrl = '', selectedFile = null, decodedBuffer = null;
  let audioContext = null, demoStart = 0, demoEnd = 0, demoNodes = [], youtubePlayer = null, youtubeReady = false;
  let score = 0, combo = 0, bestCombo = 0, judged = 0, weightedAccuracy = 0, lastFrame = 0, toastTimer = 0;
  let w = 0, h = 0, dpr = 1, hitFlash = [0,0,0,0];
  const heldLanes = new Set();
  const heldLongs = new Map();

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = rect.width; h = rect.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe($('#gameView'));
  resize();

  function setStatus(text) { $('#gameStatus').textContent = text; }
  function updateStats() {
    $('#scoreValue').textContent = String(score).padStart(6, '0');
    $('#accuracyValue').textContent = judged ? `${Math.round(weightedAccuracy / judged)}%` : '—';
    $('#comboValue').innerHTML = `${bestCombo}<span class="combo-x">×</span>`;
    const acc = judged ? weightedAccuracy / judged : 0;
    $('#rankValue').textContent = !judged ? '—' : acc >= 97 ? 'S · ON FIRE' : acc >= 90 ? 'A · IN FLOW' : acc >= 75 ? 'B · GROOVING' : 'C · KEEP GOING';
  }
  function clearRun() {
    score = 0; combo = 0; bestCombo = 0; judged = 0; weightedAccuracy = 0;
    processed = new Set(); heldLanes.clear(); heldLongs.clear(); updateStats();
  }
  function completeLong(note) {
    if (!heldLongs.has(note.id)) return;
    heldLongs.delete(note.id);
    if (![...heldLongs.values()].some(held => held.lane === note.lane)) heldLanes.delete(note.lane);
    score += 700; judged++; weightedAccuracy += 100; combo++; bestCombo = Math.max(bestCombo, combo);
    sayJudge('HOLD +700', '#d6ff62'); updateStats();
  }
  function releaseLane(lane) {
    heldLanes.delete(lane);
    for (const note of [...heldLongs.values()]) {
      if (note.lane !== lane) continue;
      if (gameTime() >= note.time + note.duration - .04) completeLong(note);
      else {
        heldLongs.delete(note.id); combo = 0; sayJudge('HOLD BREAK', '#ff74ba'); updateStats();
      }
    }
  }
  function updateLongNotes(time) {
    for (const note of [...heldLongs.values()]) {
      if (time < note.time + note.duration) continue;
      if (heldLanes.has(note.lane)) completeLong(note);
      else {
        heldLongs.delete(note.id); combo = 0; sayJudge('HOLD BREAK', '#ff74ba'); updateStats();
      }
    }
  }
  function chartEndTime() {
    return chart.reduce((end, note) => Math.max(end, note.time + (note.duration || 0)), 0);
  }
  function sayJudge(text, color) {
    const toast = $('#judgeToast');
    toast.textContent = text; toast.style.color = color; toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 420);
  }
  function judge(note, diff) {
    if (processed.has(note.id)) return;
    processed.add(note.id); judged++;
    if (diff <= .055) {
      score += 1000 + Math.min(combo, 100) * 10; combo++; weightedAccuracy += 100; sayJudge('PERFECT', '#d6ff62');
    } else if (diff <= .115) {
      score += 500 + Math.min(combo, 100) * 5; combo++; weightedAccuracy += 70; sayJudge('GOOD', '#62e8e4');
    } else {
      combo = 0; weightedAccuracy += 0; sayJudge('MISS', '#ff74ba');
    }
    if (note.duration && diff <= .115 && heldLanes.has(note.lane)) heldLongs.set(note.id, note);
    bestCombo = Math.max(bestCombo, combo); hitFlash[note.lane] = performance.now() + 130;
    updateStats();
  }
  function gameTime() {
    if (mode === 'file') return audio.currentTime || 0;
    if (mode === 'youtube' && youtubePlayer && youtubeReady) { try { return youtubePlayer.getCurrentTime() || 0; } catch (_) { return 0; } }
    if (mode === 'demo' && audioContext) return Math.max(0, audioContext.currentTime - demoStart);
    return 0;
  }

  function draw() {
    requestAnimationFrame(draw);
    if (!w || !h) return;
    const nowPerf = performance.now();
    const dt = Math.min(.05, (nowPerf - (lastFrame || nowPerf)) / 1000); lastFrame = nowPerf;
    const laneWidth = w / 4;
    const top = 14, bottom = h - (window.innerWidth <= 700 ? 55 : 18), hitY = bottom - 42;
    const time = active && !paused ? gameTime() : 0;
    ctx.clearRect(0, 0, w, h);

    // Luminous lane columns and subtle beat grid.
    for (let i=0;i<4;i++) {
      const x = i * laneWidth;
      const glow = hitFlash[i] > nowPerf;
      const gradient = ctx.createLinearGradient(0, 0, 0, bottom);
      gradient.addColorStop(0, laneColors[i] + '03'); gradient.addColorStop(.72, laneColors[i] + (glow ? '20' : '0b')); gradient.addColorStop(1, laneColors[i] + (glow ? '33' : '11'));
      ctx.fillStyle = gradient; ctx.fillRect(x+1, 0, laneWidth-2, bottom);
      ctx.strokeStyle = '#aaa0d00d'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, bottom); ctx.stroke();
      if (glow) { ctx.fillStyle = laneColors[i] + '16'; ctx.fillRect(x, hitY-22, laneWidth, 45); }
    }
    // Hit line
    const lineGrad = ctx.createLinearGradient(0,0,w,0);
    lineGrad.addColorStop(0,'#a88bff22'); lineGrad.addColorStop(.25,'#a88bffcc'); lineGrad.addColorStop(.5,'#d6ff62'); lineGrad.addColorStop(.75,'#62e8e4cc'); lineGrad.addColorStop(1,'#ff74ba22');
    ctx.shadowColor = '#d6ff62'; ctx.shadowBlur = 12; ctx.fillStyle = lineGrad; ctx.fillRect(0, hitY, w, 2); ctx.shadowBlur = 0;
    for(let i=0;i<4;i++) {
      const x = i*laneWidth+laneWidth/2;
      ctx.beginPath(); ctx.arc(x,hitY+1,3,0,Math.PI*2); ctx.fillStyle=laneColors[i]; ctx.shadowColor=laneColors[i]; ctx.shadowBlur=10; ctx.fill(); ctx.shadowBlur=0;
      ctx.fillStyle='#77758b'; ctx.font='9px "DM Mono", monospace'; ctx.textAlign='center'; ctx.fillText(lanes[i], x, bottom-7);
    }
    if (active && !paused) {
      updateLongNotes(time);
      for (const note of chart) {
        const isHeld = heldLongs.has(note.id);
        if (processed.has(note.id) && !isHeld) continue;
        const diff = note.time - time;
        if (!isHeld && diff < -.115) { judge(note, 1); continue; }
        if (diff > travel + .25) continue;
        const y = hitY - diff / travel * (hitY - top);
        const x = note.lane * laneWidth + 7, nw = laneWidth - 14, nh = Math.max(12, Math.min(20, laneWidth*.19));
        if (note.duration) {
          const tailDiff = note.time + note.duration - time;
          const tailY = hitY - tailDiff / travel * (hitY - top);
          const bodyTop = Math.max(top, Math.min(y, tailY));
          const bodyBottom = Math.min(hitY + 10, Math.max(y, tailY));
          if (bodyBottom > bodyTop) {
            ctx.globalAlpha = isHeld ? .9 : .55;
            ctx.shadowColor = laneColors[note.lane]; ctx.shadowBlur = 12;
            roundRect(ctx,x+nw*.3,bodyTop,nw*.4,bodyBottom-bodyTop,Math.min(7,nw*.2),laneColors[note.lane]);
            ctx.globalAlpha = 1; ctx.shadowBlur = 0;
          }
        }
        if (y < -nh || y > bottom+10 || (isHeld && diff < -travel)) continue;
        ctx.shadowColor = laneColors[note.lane]; ctx.shadowBlur = 16;
        const grad=ctx.createLinearGradient(x,y-nh/2,x+nw,y+nh/2); grad.addColorStop(0,laneColors[note.lane]); grad.addColorStop(.5,'#fff'); grad.addColorStop(1,laneColors[note.lane]);
        roundRect(ctx,x,y-nh/2,nw,nh,5,grad); ctx.shadowBlur=0;
        ctx.fillStyle='#fff9'; roundRect(ctx,x+5,y-nh/2+2,nw-10,2,2,'#ffffff8a');
      }
      if (chart.length && time > chartEndTime() + 1.1) finishRun();
      if (mode === 'file' && audio.ended) finishRun();
      if (mode === 'youtube' && youtubePlayer && youtubeReady) { try { if (youtubePlayer.getPlayerState() === 0) finishRun(); } catch (_) {} }
      if (mode === 'demo' && time > demoEnd) finishRun();
    }
  }
  function roundRect(c,x,y,width,height,r,fill){c.beginPath();c.roundRect(x,y,width,height,r);c.fillStyle=fill;c.fill();}
  requestAnimationFrame(draw);

  function pressLane(lane) {
    if (!active || paused || lane < 0 || lane > 3) return;
    heldLanes.add(lane);
    hitFlash[lane] = performance.now() + 100;
    const t = gameTime(); let nearest = null, nearestDiff = Infinity;
    for (const note of chart) {
      if (processed.has(note.id) || note.lane !== lane) continue;
      const diff = Math.abs(note.time - t);
      if (diff < nearestDiff) { nearestDiff = diff; nearest = note; }
    }
    if (nearest && nearestDiff <= .115) judge(nearest, nearestDiff);
  }
  document.addEventListener('keyup', event => {
    const lane = ({d:0,f:1,j:2,k:3,ArrowLeft:0,ArrowDown:1,ArrowUp:2,ArrowRight:3})[event.key];
    if (lane !== undefined) releaseLane(lane);
  });
  window.addEventListener('blur', () => { for (const lane of [...heldLanes]) releaseLane(lane); });
  document.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const lane = ({d:0,f:1,j:2,k:3,ArrowLeft:0,ArrowDown:1,ArrowUp:2,ArrowRight:3})[event.key];
    if (lane !== undefined) { event.preventDefault(); pressLane(lane); }
    if (event.code === 'Space' && active) { event.preventDefault(); togglePause(); }
  });
  $$('.lane-controls button').forEach(button => {
    const lane=Number(button.dataset.lane);
    button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture?.(e.pointerId); button.classList.add('active'); pressLane(lane); });
    const release = e => { e.preventDefault(); releaseLane(lane); button.classList.remove('active'); };
    button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
  });
  function $$(s){return [...document.querySelectorAll(s)];}

  function addLongNotes(notes, duration) {
    const longDuration = Math.max(.65, Math.min(1.35, duration));
    for (let i=5;i<notes.length;i+=12) {
      const note=notes[i];
      const nextSameLane=notes.slice(i+1).find(next=>next.lane===note.lane);
      const available=nextSameLane ? nextSameLane.time-note.time-.18 : longDuration;
      if (available >= .65) note.duration=Math.min(longDuration,available);
    }
    return notes;
  }
  function generateGrid(bpm, duration=90) {
    const beat = 60 / Math.max(60, Math.min(200, bpm)); const notes=[]; let i=0;
    for(let t=1.15;t<duration-.2;t+=beat/2) {
      // A playable syncopated four-lane pattern, weighted toward the main beat.
      if (i%2===0 || i%4===3) notes.push({id:notes.length,time:+t.toFixed(4),lane:Math.floor((i*3 + Math.floor(i/4))%4)});
      i++;
    }
    return addLongNotes(notes,beat*1.5);
  }
  function makeOnsetChart(buffer) {
    const sampleRate=buffer.sampleRate, channel=buffer.getChannelData(0), frameSize=Math.floor(sampleRate*.02), rms=[];
    for(let start=0;start<channel.length;start+=frameSize){let sum=0;const end=Math.min(channel.length,start+frameSize);for(let n=start;n<end;n+=2)sum+=channel[n]*channel[n];rms.push(Math.sqrt(sum/Math.max(1,Math.ceil((end-start)/2))));}
    const sorted=[...rms].sort((a,b)=>a-b), floor=sorted[Math.floor(sorted.length*.5)]||.01;
    const peaks=[]; let last=-1;
    for(let i=2;i<rms.length-2;i++){
      const rise=rms[i]-rms[i-2];
      if(rms[i]>=rms[i-1]&&rms[i]>rms[i+1]&&rise>Math.max(.006,floor*.42)&&rms[i]>floor*.65&&i-last>11){peaks.push(i*.02);last=i;}
    }
    // Remove the initial attack and stray late events; a detected transient becomes a note.
    let times=peaks.filter(t=>t>.18&&t<buffer.duration-.12);
    if(times.length<8){
      const bpm=estimateBpm(times)||120; return {notes:generateGrid(bpm,buffer.duration),bpm,detected:false};
    }
    const bpm=estimateBpm(times)||120;
    const notes=addLongNotes(times.map((t,i)=>({id:i,time:+t.toFixed(3),lane:(i*3+Math.floor(i/3))%4})),.95);
    return {notes,bpm,detected:true};
  }
  function estimateBpm(times){
    if(times.length<4)return null;
    const intervals=[]; for(let i=1;i<times.length;i++){const gap=times[i]-times[i-1];if(gap>.24&&gap<1.6)intervals.push(gap);}
    if(!intervals.length)return null;
    intervals.sort((a,b)=>a-b);let beat=intervals[Math.floor(intervals.length*.5)];
    while(60/beat>180)beat*=2; while(60/beat<70)beat/=2;
    return Math.max(70,Math.min(180,Math.round(60/beat)));
  }
  function makeWaveform(){const box=$('#waveform');box.innerHTML='';for(let i=0;i<30;i++){const bar=document.createElement('i');bar.style.setProperty('--h',`${3+Math.round(Math.abs(Math.sin(i*12.7)*Math.cos(i*3.1))*10)}px`);box.append(bar);}}
  function fileSelected(file){
    if(!file)return;
    if(!file.type.startsWith('audio/')&&!/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(file.name)){sayJudge('AUDIO FILE ONLY','#ff74ba');return;}
    selectedFile=file; if(localUrl)URL.revokeObjectURL(localUrl); localUrl=URL.createObjectURL(file); audio.src=localUrl;
    $('#trackName').textContent=file.name.replace(/\.[^.]+$/,''); $('#trackMeta').textContent=`${(file.size/1048576).toFixed(1)} MB · ready to analyze`;
    $('#trackCard').classList.remove('hidden');$('#analyzeBtn').classList.remove('hidden');$('.upload-zone').classList.add('hidden');makeWaveform();
  }
  $('#audioFile').addEventListener('change',e=>fileSelected(e.target.files[0]));
  const drop=$('#dropZone'); ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('dragging')}));['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('dragging')}));drop.addEventListener('drop',e=>fileSelected(e.dataTransfer.files[0]));
  $('#removeTrack').addEventListener('click',()=>{stopRun();selectedFile=null;decodedBuffer=null;audio.removeAttribute('src');$('#trackCard').classList.add('hidden');$('#analyzeBtn').classList.add('hidden');$('.upload-zone').classList.remove('hidden');$('#audioFile').value='';});

  async function analyzeAndPlay(){
    if(!selectedFile)return;
    const button=$('#analyzeBtn');button.disabled=true;button.innerHTML='<span>◌</span> ANALYZING YOUR TRACK…';$('#trackMeta').textContent='Listening for the beat…';
    try{
      const AudioCtx=window.AudioContext||window.webkitAudioContext;
      if(!audioContext)audioContext=new AudioCtx();
      await audioContext.resume();
      const buffer=await selectedFile.arrayBuffer();decodedBuffer=await audioContext.decodeAudioData(buffer);
      const result=makeOnsetChart(decodedBuffer);chart=result.notes;
      currentName=selectedFile.name.replace(/\.[^.]+$/,'');$('#trackMeta').textContent=`${result.bpm} BPM · ${result.detected?'auto-synced':'beat grid'} · ${chart.length} notes`;
      $('#nowPlaying').textContent=currentName.toUpperCase();mode='file';startCountdown();
    }catch(error){console.error(error);$('#trackMeta').textContent='Could not read this audio format';sayJudge('UNSUPPORTED AUDIO','#ff74ba');}
    finally{button.disabled=false;button.innerHTML='<span>✦</span> ANALYZE &amp; PLAY <span class="button-arrow">→</span>';}
  }
  $('#analyzeBtn').addEventListener('click',analyzeAndPlay);

  function startCountdown(){
    stopRun(false);clearRun();$('#gameOverlay').classList.add('hidden');$('#pauseBtn').disabled=false;$('#restartBtn').disabled=false;
    const count=$('#countdown');count.classList.remove('hidden');let n=3;count.textContent=n;
    setStatus('GET READY');
    const timer=setInterval(()=>{n--;if(n>0){count.textContent=n;}else{clearInterval(timer);count.textContent='GO';setTimeout(()=>{count.classList.add('hidden');beginRun();},350);}},700);
  }
  async function beginRun(){
    paused=false;active=true;$('.game-panel').classList.add('is-playing');$('#pauseBtn').textContent='Ⅱ';setStatus('IN THE FLOW');
    if(mode==='file'){audio.currentTime=0;try{await audio.play();}catch(e){console.warn(e);}}
    else if(mode==='youtube'&&youtubePlayer){try{youtubePlayer.seekTo(0,true);youtubePlayer.playVideo();}catch(e){}}
    else if(mode==='demo')startDemoAudio();
  }
  function stopRun(resetUi=true){
    active=false;paused=false;heldLanes.clear();heldLongs.clear();audio.pause();if(youtubePlayer&&youtubeReady){try{youtubePlayer.pauseVideo();}catch(_){}}
    if(audioContext&&audioContext.state==='running'&&mode==='demo')audioContext.suspend();
    $('.game-panel').classList.remove('is-playing');$('#pauseBtn').textContent='Ⅱ';
    if(resetUi){$('#gameOverlay').classList.remove('hidden');$('#countdown').classList.add('hidden');$('#pauseBtn').disabled=true;$('#restartBtn').disabled=true;setStatus('READY WHEN YOU ARE');}
  }
  function finishRun(){if(!active)return;active=false;paused=false;$('.game-panel').classList.remove('is-playing');audio.pause();if(youtubePlayer&&mode==='youtube'){try{youtubePlayer.pauseVideo();}catch(_){}}setStatus('RUN COMPLETE');$('#pauseBtn').disabled=true;$('#pauseBtn').textContent='Ⅱ';$('#gameOverlay').classList.remove('hidden');$('#gameOverlay').innerHTML=`<div class="overlay-orbit"><span>✦</span></div><div class="overlay-kicker">${currentName?escapeHTML(currentName.toUpperCase()):'NICE RUN'}</div><h2>That was<br/><em>a vibe.</em></h2><p>${score.toLocaleString()} points · ${judged?Math.round(weightedAccuracy/judged):0}% accuracy</p><div class="key-preview"><span>↻</span></div><small>PRESS RESTART TO GO AGAIN</small>`;}
  function escapeHTML(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function togglePause(){
    if(!active&&!paused)return;
    if(!paused){active=false;paused=true;audio.pause();if(youtubePlayer&&mode==='youtube'){try{youtubePlayer.pauseVideo();}catch(_){}}if(mode==='demo'&&audioContext)audioContext.suspend();$('#pauseBtn').textContent='▶';setStatus('PAUSED');sayJudge('PAUSED','#d6ff62');}
    else {paused=false;active=true;if(mode==='file')audio.play().catch(()=>{});if(mode==='youtube'&&youtubePlayer){try{youtubePlayer.playVideo();}catch(_){}}if(mode==='demo'&&audioContext)audioContext.resume();$('#pauseBtn').textContent='Ⅱ';setStatus('IN THE FLOW');}
  }
  $('#pauseBtn').addEventListener('click',togglePause);
  $('#restartBtn').addEventListener('click',()=>{if(!mode)return;clearRun();processed=new Set();if(mode==='file'){audio.currentTime=0;startCountdown();}else if(mode==='youtube'){try{youtubePlayer.seekTo(0,true);}catch(_){}startCountdown();}else startCountdown();});
  $('#demoBtn').addEventListener('click',async()=>{mode='demo';currentName='THE PULSE';chart=generateGrid(110,38);$('#nowPlaying').textContent='THE PULSE · 110 BPM';$('#trackMeta').textContent='Built-in rhythm · 110 BPM';if(!audioContext)audioContext=new (window.AudioContext||window.webkitAudioContext)();await audioContext.resume();startCountdown();});
  function startDemoAudio(){
    if(!audioContext)return;audioContext.resume();demoStart=audioContext.currentTime;demoEnd=38;
    const beat=60/110;
    function tone(at,freq,dur,gain,type='sine'){const osc=audioContext.createOscillator(),amp=audioContext.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,at);amp.gain.setValueAtTime(.0001,at);amp.gain.exponentialRampToValueAtTime(gain,at+.008);amp.gain.exponentialRampToValueAtTime(.0001,at+dur);osc.connect(amp);amp.connect(audioContext.destination);osc.start(at);osc.stop(at+dur+.02);demoNodes.push(osc);}
    for(let i=0;i<Math.ceil(demoEnd/beat);i++){const at=demoStart+i*beat;tone(at, i%4===0?78:95,.18,i%4===0?.34:.2,'sine');if(i%2===1){tone(at,155,.075,.09,'triangle');}tone(at+beat/2,1200,.035,.025,'square');if(i%4===2)tone(at,190,.11,.08,'triangle');}
  }

  // YouTube IFrame API is used only as a playback source; beat-grid sync stays in this page.
  window.onYouTubeIframeAPIReady=function(){youtubeReady=true;};
  const ytScript=document.createElement('script');ytScript.src='https://www.youtube.com/iframe_api';document.head.appendChild(ytScript);
  function parseYoutube(value){try{const u=new URL(value);if(u.hostname.includes('youtu.be'))return u.pathname.slice(1).split('/')[0];if(u.hostname.includes('youtube.com'))return u.searchParams.get('v')||u.pathname.match(/\/embed\/([^/?]+)/)?.[1]||u.pathname.match(/\/shorts\/([^/?]+)/)?.[1];}catch(_){}return null;}
  function loadYoutube(){
    const id=parseYoutube($('#youtubeUrl').value.trim());if(!id){sayJudge('PASTE A VALID LINK','#ff74ba');return;}
    $('#videoPreview').classList.remove('hidden');$('#youtubePlayBtn').disabled=false;currentName='YOUTUBE SESSION';$('#nowPlaying').textContent='YOUTUBE SESSION · '+$('#bpmInput').value+' BPM';
    const playerMount=$('#youtubePlayer');playerMount.innerHTML='';
    const iframe=document.createElement('iframe');iframe.id='yt-frame';iframe.src=`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?enablejsapi=1&origin=${encodeURIComponent(location.origin)}&playsinline=1&controls=1`;iframe.allow='autoplay; encrypted-media; picture-in-picture';iframe.allowFullscreen=true;playerMount.appendChild(iframe);
    const create=()=>{try{youtubePlayer=new YT.Player('yt-frame',{events:{onReady:()=>{youtubeReady=true;$('#youtubePlayBtn').disabled=false;},onError:()=>sayJudge('VIDEO UNAVAILABLE','#ff74ba')}});}catch(_){setTimeout(create,300);}};create();
  }
  $('#loadYoutube').addEventListener('click',loadYoutube);$('#youtubeUrl').addEventListener('keydown',e=>{if(e.key==='Enter')loadYoutube();});
  $('#youtubePlayBtn').addEventListener('click',()=>{const bpm=Number($('#bpmInput').value)||120;chart=generateGrid(bpm,120);mode='youtube';$('#nowPlaying').textContent=`YOUTUBE SESSION · ${bpm} BPM`;startCountdown();});
  $('#bpmDown').addEventListener('click',()=>$('#bpmInput').value=Math.max(60,(Number($('#bpmInput').value)||120)-1));$('#bpmUp').addEventListener('click',()=>$('#bpmInput').value=Math.min(200,(Number($('#bpmInput').value)||120)+1));$('#bpmInput').addEventListener('change',()=>{$('#bpmInput').value=Math.max(60,Math.min(200,Number($('#bpmInput').value)||120));if(mode==='youtube')$('#nowPlaying').textContent=`YOUTUBE SESSION · ${$('#bpmInput').value} BPM`;});
  $$('.source-tab').forEach(tab=>tab.addEventListener('click',()=>{source=tab.dataset.source;$$('.source-tab').forEach(t=>{const chosen=t===tab;t.classList.toggle('active',chosen);t.setAttribute('aria-selected',chosen);});$('#fileSource').classList.toggle('hidden',source!=='file');$('#youtubeSource').classList.toggle('hidden',source!=='youtube');}));
  $('#fullscreenBtn').addEventListener('click',()=>{const el=$('#gameView');if(document.fullscreenElement)document.exitFullscreen?.();else el.requestFullscreen?.();});
  const modal=$('#helpModal');$('#helpBtn').addEventListener('click',()=>modal.classList.remove('hidden'));$('#closeHelp').addEventListener('click',()=>modal.classList.add('hidden'));$('#gotIt').addEventListener('click',()=>modal.classList.add('hidden'));modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.add('hidden');});
})();
