import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { defaultKeys } from './controller-runtime.js';

export function setupControllerUI({runtime,canControl,enter,getMode,setMode,status,monitoring}) {
  const c=runtime.controller,$=id=>document.getElementById(id),held=new Set();let keyMap={...defaultKeys},drag=null;
  const panel=document.createElement('details');panel.className='controller-settings';panel.open=true;
  panel.innerHTML=`<summary>交互与物理 <span>PLAYER</span></summary>
    <div class="action-row"><button id="fly-toggle">飞行 F</button><button id="jump-action">跳跃</button><button id="wave-action">招手</button></div>
    <label class="switch-row">过肩视角<input id="shoulder" type="checkbox" checked></label>
    <label class="switch-row">弹簧相机<input id="spring" type="checkbox" checked></label>
    <label class="switch-row">脚部贴地 Foot IK<input id="foot-ik" type="checkbox" checked></label>
    <div class="field-row"><label for="locomotion">动作组</label><select id="locomotion"><option value="default">自然行走</option><option value="careful">谨慎行走</option></select></div>
    <details><summary>自定义角色与动画</summary><p class="feature-help">导入包含动画的 GLB，选择待机、行走、奔跑和跳跃。Foot IK 自动识别常见人形骨骼。</p><input id="character-file" type="file" accept=".glb" aria-label="导入带动画的 GLB 角色"><div id="animation-mapping" hidden></div><button id="apply-character" hidden>使用此角色</button></details>
    <div class="action-row"><button id="add-sphere">投放球体</button><button id="add-box">投放盒体</button></div>
    <div class="action-row"><button id="add-platform">移动平台</button><button id="clear-props">清除球 / 盒</button><button id="clear-platforms">移除平台</button></div>
    <div class="action-row"><button id="add-vehicle">放置车辆</button><button id="board-vehicle">上下车 E</button></div>
    <div class="action-row"><button id="reset-vehicle">车辆扶正</button><button id="clear-vehicles">移除车辆</button></div>
    <p class="feature-help">WASD 移动 / 转向 · Shift 奔跑 / 手刹 · 空格跳跃 / 刹车 · F 飞行（朝视线移动，空格上升）· Q 监控</p>
    <output id="physics-state">等待进入漫游</output>
    <details><summary>3DTiles 流式场景</summary><label class="feature-help" for="tiles-url">tileset.json 地址（需允许跨域）</label><input id="tiles-url" type="url" placeholder="https://…/tileset.json"><div class="action-row"><button id="load-tiles">加载瓦片</button><button id="demo-tiles">本地示例</button><button id="clear-tiles">移除</button></div><output id="tiles-state">尚未加载瓦片</output></details>
    <details><summary>键位与输入</summary><div id="key-bindings"></div><button id="reset-keys">恢复默认键位</button><label class="switch-row">显示触屏控制<input id="touch-controls" type="checkbox"></label><p class="feature-help">点击键位后按新键。支持手柄左摇杆移动、右摇杆视角，A 跳跃，B 飞行，X 上下车，Y 视角，RT 奔跑。</p></details>`;
  document.querySelector('.local-note').before(panel);
  const ensure=()=>{if(!canControl()){status('请等待场景和碰撞准备完成');return false;}if(getMode()==='orbit')setMode('third');enter();return true;};
  const run=fn=>async()=>{if(!ensure())return;try{await fn();}catch(e){console.error(e);status(e.message,true);}};
  let customCharacter=null;
  $('character-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;
    try{const gltf=await new GLTFLoader().parseAsync(await file.arrayBuffer(),'');if(!gltf.animations.length)throw new Error('此 GLB 没有动画片段');customCharacter=gltf;
      const mapping=$('animation-mapping');mapping.replaceChildren();
      for(const [action,label,pattern] of [['idleAnim','待机',/idle/i],['walkAnim','行走',/walk/i],['runAnim','奔跑',/run/i],['jumpAnim','跳跃',/jump/i]]){const row=document.createElement('label');row.className='field-row';row.textContent=label;const select=document.createElement('select');select.dataset.animation=action;select.setAttribute('aria-label',label+'动画');for(const clip of gltf.animations){const option=new Option(clip.name,clip.name);select.add(option);}select.value=gltf.animations.find(clip=>pattern.test(clip.name))?.name||gltf.animations[0].name;row.append(select);mapping.append(row);}
      mapping.hidden=false;$('apply-character').hidden=false;status(`已读取 ${gltf.animations.length} 个动画，请选择动作映射`);
    }catch(error){status(error.message,true);}
  };
  $('apply-character').onclick=run(async()=>{if(!customCharacter)return;const mapping=Object.fromEntries([...document.querySelectorAll('[data-animation]')].map(el=>[el.dataset.animation,el.value]));await runtime.setCharacter({model:customCharacter.scene,animations:customCharacter.animations,...mapping});customCharacter=null;$('apply-character').hidden=true;$('animation-mapping').hidden=true;$('wave-action').disabled=true;$('locomotion').disabled=true;runtime.ik.setEnabled($('foot-ik').checked);status('已启用自定义角色与动作；可通过外部 API 注册更多动作组');});
  $('fly-toggle').onclick=run(()=>c.setInput({toggleFly:true}));
  $('jump-action').onclick=run(()=>{c.setInput({jump:true});c.setInput({jump:false});});
  $('wave-action').onclick=run(()=>c.playAnimation('wave',{fade:.2,force:true,returnToPrev:true}));
  $('shoulder').onchange=e=>{c.setOverShoulderView(e.target.checked);if(c.getIsFirstPerson())c.cam.setOverShoulder(false);};
  $('spring').onchange=e=>{c.cam.enableSpringCamera=e.target.checked;};
  $('foot-ik').onchange=e=>runtime.ik.setEnabled(e.target.checked);
  $('locomotion').onchange=e=>c.switchLocomotionSet(e.target.value,.2);
  $('add-sphere').onclick=run(()=>runtime.addProp('sphere'));$('add-box').onclick=run(()=>runtime.addProp('box'));
  $('add-platform').onclick=run(()=>runtime.addPlatform());$('clear-platforms').onclick=()=>runtime.clearPlatforms();$('clear-props').onclick=()=>runtime.clearProps();
  $('add-vehicle').onclick=run(()=>runtime.addVehicle());$('reset-vehicle').onclick=run(()=>c.resetVehicle());
  $('clear-vehicles').onclick=()=>runtime.clearVehicles();
  $('board-vehicle').onclick=run(()=>{c.setInput({toggleVehicle:true});if(c.getControllerMode()===0)status('已下车，或请走近静止车辆再按 E');});
  $('load-tiles').onclick=run(()=>{const url=new URL($('tiles-url').value,location.href);if(!['http:','https:'].includes(url.protocol))throw new Error('仅支持 HTTP / HTTPS 地址');return runtime.loadTiles(url.href);});
  $('demo-tiles').onclick=run(()=>runtime.loadTiles(`${import.meta.env.BASE_URL}tiles-demo/tileset.json`));
  $('clear-tiles').onclick=()=>{runtime.tiles?.dispose();runtime.tiles=null;};
  const keyLabel=action=>{const code=keyMap[action];return (Array.isArray(code)?code.join('/'):(code||'未绑定')).replaceAll('Key','').replaceAll('ShiftLeft','Shift').replaceAll('ShiftRight','Shift').replaceAll('Space','空格');};
  const names={forward:'前进',backward:'后退',left:'左移',right:'右移',sprint:'奔跑 / 手刹',jump:'跳跃 / 刹车',toggleView:'切换视角',toggleFly:'飞行',toggleVehicle:'上下车'};
  let capturing=null;
  function showKeys(){const holder=$('key-bindings');holder.replaceChildren();for(const [action,label] of Object.entries(names)){const row=document.createElement('div');row.className='field-row';const name=document.createElement('span');name.textContent=label;const button=document.createElement('button');button.textContent=keyMap[action];button.onclick=()=>{capturing={action,button};button.textContent='请按新键…';release();};row.append(name,button);holder.append(row);}}
  function setKeyMap(map={}){keyMap={...defaultKeys,...map};c.setKeyMap(keyMap);release();showKeys();}
  function release(){held.clear();c.input.resetKeys();c.setInput({moveX:0,moveY:0,jump:false,shift:false});drag=null;}
  runtime.releaseInput=release;
  $('reset-keys').onclick=()=>setKeyMap();showKeys();
  const typing=target=>target.closest?.('input,select,textarea,button,[contenteditable="true"]');
  window.addEventListener('keydown',e=>{
    if(capturing){e.preventDefault();if(e.code==='Escape'){capturing=null;showKeys();return;}if(['KeyQ'].includes(e.code)||Object.entries(keyMap).some(([a,k])=>a!==capturing.action&&k===e.code)){status('此按键已被占用，请选择其他按键');return;}keyMap[capturing.action]=e.code;capturing=null;setKeyMap(keyMap);return;}
    if(typing(e.target)||monitoring.isOpen)return;
    if(e.code==='Escape'){release();return;}
    if(e.code==='KeyQ'&&!e.repeat){monitoring.openCentered();return;}
    if(!runtime.active||!canControl())return;
    if(Object.values(keyMap).some(value=>Array.isArray(value)?value.includes(e.code):value===e.code)){e.preventDefault();if(!held.has(e.code)){held.add(e.code);c.input.onKeydown(e);}}
  });
  window.addEventListener('keyup',e=>{held.delete(e.code);c.input.onKeyup(e);});
  window.addEventListener('blur',release);document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
  document.querySelectorAll('.panel, .topbar').forEach(el=>el.addEventListener('focusin',release));
  const canvas=runtime.renderer.domElement;
  canvas.addEventListener('pointerdown',e=>{if(runtime.active){enter();canvas.focus();if(c.getIsFirstPerson())drag={id:e.pointerId,x:e.clientX,y:e.clientY};}});
  canvas.addEventListener('pointermove',e=>{if(drag&&drag.id===e.pointerId&&runtime.active&&!monitoring.isOpen&&document.pointerLockElement!==canvas){c.setInput({lookDeltaX:e.clientX-drag.x,lookDeltaY:e.clientY-drag.y});drag={id:e.pointerId,x:e.clientX,y:e.clientY};}});
  window.addEventListener('pointerup',()=>{drag=null;});window.addEventListener('pointercancel',release);
  document.addEventListener('mousemove',e=>{if(runtime.active&&document.pointerLockElement===canvas&&!monitoring.isOpen)c.setInput({lookDeltaX:e.movementX*.2,lookDeltaY:e.movementY*.2});});
  // Purpose-built accessible touch controls feed the same external-input API.
  const touch=document.createElement('div');touch.className='touch-pad';touch.hidden=true;
  touch.innerHTML='<div id="move-stick" role="application" aria-label="移动摇杆"><span></span></div><div class="touch-buttons"><button data-input="jump">跳跃 / 刹车</button><button data-input="shift">奔跑 / 手刹</button><button data-input="toggleFly">飞行</button><button data-input="toggleView">视角</button><button data-input="toggleVehicle">上下车</button></div>';
  document.body.append(touch);$('touch-controls').checked=matchMedia('(pointer:coarse)').matches;
  const stick=$('move-stick');let stickId=null;
  const move=e=>{const r=stick.getBoundingClientRect(),x=(e.clientX-r.left-r.width/2)/45,y=(r.top+r.height/2-e.clientY)/45,len=Math.max(1,Math.hypot(x,y));c.setInput({moveX:x/len,moveY:y/len});stick.firstElementChild.style.transform=`translate(${x/len*36}px,${-y/len*36}px)`;};
  stick.onpointerdown=e=>{if(!ensure())return;stickId=e.pointerId;stick.setPointerCapture(e.pointerId);move(e);};stick.onpointermove=e=>{if(e.pointerId===stickId)move(e);};
  const stopStick=()=>{stickId=null;c.setInput({moveX:0,moveY:0});stick.firstElementChild.style.transform='';};stick.onpointerup=stopStick;stick.onpointercancel=stopStick;
  for(const b of touch.querySelectorAll('button')){b.onpointerdown=e=>{e.preventDefault();if(ensure()){b.setPointerCapture(e.pointerId);c.setInput({[b.dataset.input]:true});}};b.onpointerup=b.onpointercancel=()=>{if(!b.dataset.input.startsWith('toggle'))c.setInput({[b.dataset.input]:false});};}
  $('touch-controls').onchange=()=>{release();stopStick();};
  let lastButtons=[],gamepadActive=false;
  function update(){
    touch.hidden=!$('touch-controls').checked||!runtime.active||monitoring.isOpen;
    $('fly-toggle').textContent=`${c.getIsFlying()?'退出飞行':'飞行'} ${keyLabel('toggleFly')}`;
    $('board-vehicle').textContent=`上下车 ${keyLabel('toggleVehicle')}`;
    if(runtime.active)$('controls').textContent=`${['forward','left','backward','right'].map(keyLabel).join('/')} 移动 · ${keyLabel('sprint')} 奔跑 / 手刹 · ${keyLabel('jump')} 跳跃 / 刹车 · ${keyLabel('toggleView')} 视角 · ${keyLabel('toggleFly')} 飞行 · ${keyLabel('toggleVehicle')} 上下车 · Q 监控`;
    const vehicle=c.getActiveVehicle();const speed=vehicle&&c.getControllerMode()===1?Math.hypot(vehicle.chassisBody.linvel().x,vehicle.chassisBody.linvel().z)*3.6:null;
    const p=runtime.feet;
    $('physics-state').textContent=`${c.getControllerMode()===1?`驾驶 ${speed.toFixed(1)} km/h`:c.getIsFlying()?'飞行':c.getIsOnGround()?'贴地':'空中'} · 高度 ${p.y.toFixed(2)} m · 刚体 ${runtime.props.length} · IK ${runtime.ik.getFootIKWeight('left').toFixed(1)} / ${runtime.ik.getFootIKWeight('right').toFixed(1)}`;
    $('tiles-state').textContent=runtime.tiles?runtime.tiles.error||`碰撞就绪 ${runtime.tiles.readyCount||0} / 构建中 ${runtime.tiles.pendingCount||0}`:'尚未加载瓦片';
    const pad=[...(navigator.getGamepads?.()||[])].find(Boolean);
    if(pad&&runtime.active&&!monitoring.isOpen&&!typing(document.activeElement)){
      const axis=n=>Math.abs(n||0)<.15?0:n;
      const buttons=pad.buttons.map(b=>b.pressed);
      c.setInput({moveX:axis(pad.axes[0]),moveY:-axis(pad.axes[1]),lookDeltaX:axis(pad.axes[2])*2,lookDeltaY:axis(pad.axes[3])*2,jump:buttons[0],shift:buttons[7],toggleFly:buttons[1]&&!lastButtons[1],toggleVehicle:buttons[2]&&!lastButtons[2],toggleView:buttons[3]&&!lastButtons[3]});lastButtons=buttons;gamepadActive=true;
    }else if(gamepadActive){release();lastButtons=[];gamepadActive=false;}
  }
  // Documented host integration API; callers can inject AI/gamepad/remote inputs.
  window.sceneControls=Object.freeze({setCharacter:options=>runtime.setCharacter(options),setInput:input=>{if(runtime.active&&!monitoring.isOpen)c.setInput(input);},setKeyMap,registerAnimation:(...args)=>c.registerAnimation(...args),playAnimation:(...args)=>c.playAnimation(...args),registerLocomotionSet:(...args)=>c.registerLocomotionSet(...args),switchLocomotionSet:(...args)=>c.switchLocomotionSet(...args)});
  return {update,release};
}
