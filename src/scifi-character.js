import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const boneName = name => name.replace(/^mixamorig:?/, '').replace(/ToeBase$/, 'Toe');

// Keep the chosen model and materials; adapt its Mixamo rig to our controller.
export function prepareSciFiCharacter({scene:model, animations:source}) {
  model.name = 'Sci-fi humanoid · Xbot';
  const skins=[];
  model.traverse(object => {
    if (object.isBone) object.name = boneName(object.name);
    if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; }
    if (object.isSkinnedMesh) skins.push(object);
  });
  // Xbot's vertices are in metres but its armature is in centimetres. Attached
  // skinning cancels the mesh world matrix; TPC's raw-vertex bounds do not.
  // Move only meshes out of the 0.01 armature, retaining the bones/bind matrices.
  for(const skin of skins){model.add(skin);skin.position.set(0,0,0);skin.quaternion.identity();skin.scale.setScalar(1);}
  // Xbot already faces local +Z, matching the controller. World-space bone
  // directions also include capsule yaw and must not drive a model correction.
  model.rotation.y=0;
  const animations = source.map(original => {
    const clip = original.clone();
    clip.name = ({idle:'Idle', walk:'Walk', run:'Run'})[clip.name] || clip.name;
    for (const track of clip.tracks) {
      const split = track.name.lastIndexOf('.');
      track.name = boneName(track.name.slice(0, split)) + track.name.slice(split);
    }
    return clip;
  });
  const idle = animations.find(clip => clip.name === 'Idle');
  if (!idle || !animations.some(clip => clip.name === 'Walk') || !animations.some(clip => clip.name === 'Run')) {
    throw new Error('科幻人物缺少待机或移动动画');
  }
  // The capsule owns translation. Preserve vertical gait motion, remove XZ drift.
  const hips = idle.tracks.find(track => track.name === 'Hips.position');
  for (const clip of animations) for (const track of clip.tracks) {
    if (track.name === 'Hips.position') for (let i=0;i<track.values.length;i+=3) {
      track.values[i]=hips.values[0];track.values[i+2]=hips.values[2];
    }
  }
  const careful=animations.find(clip=>clip.name==='Walk').clone();
  careful.name='Careful';for(const track of careful.tracks)track.scale(1.45);careful.duration*=1.45;
  animations.push(careful);

  // Additional local poses retain a full idle skeleton, including hands/spine.
  // Xbot supplies idle/walk/run; jump/flight/driving/wave are authored here.
  function pose(name, duration, offsets, envelope=[1,1]) {
    const times=envelope.map((_,i)=>i*duration/(envelope.length-1));
    const tracks=idle.tracks.map(track=>{
      const base=Array.from(track.createInterpolant().evaluate(0));
      const joint=track.name.slice(0,track.name.lastIndexOf('.'));
      if(track.name.endsWith('.quaternion')&&offsets[joint]) {
        const delta=offsets[joint];
        const values=envelope.flatMap(weight=>new T.Quaternion().fromArray(base).multiply(
          new T.Quaternion().setFromEuler(new T.Euler(...delta.map(value=>value*weight)))
        ).normalize().toArray());
        return new T.QuaternionKeyframeTrack(track.name,times,values);
      }
      const result=track.clone();result.times=new Float32Array([0,duration]);result.values=new Float32Array([...base,...base]);return result;
    });
    return new T.AnimationClip(name,duration,tracks);
  }
  const bilateral=(arm,thigh,knee)=>Object.fromEntries(['Left','Right'].flatMap(side=>[
    [`${side}Arm`,[arm,0,0]],[`${side}UpLeg`,[thigh,0,0]],[`${side}Leg`,[knee,0,0]],
  ]));
  animations.push(
    pose('Jump',.9,bilateral(-.45,-.45,.85),[0,1,1,0]),
    pose('Hover',1,bilateral(-.25,-.12,.25)),
    pose('Fly',1,bilateral(-1.1,-.15,.3)),
    pose('Drive',1,bilateral(-.9,-1.25,1.4)),
    pose('Wave',1.8,{RightArm:[0,0,-2.1],RightForeArm:[0,-.4,-.3]},[0,1,.8,1,.8,0]),
  );
  // TPC resets weights during set registration: separate clips avoid muting
  // the default Idle/Run actions when the careful locomotion set is added.
  for(const name of ['Idle','Run','Jump','Hover','Fly']){
    const clip=animations.find(item=>item.name===name).clone();clip.name=`Careful${name}`;animations.push(clip);
  }
  return {model,animations,firstPersonCameraOffset:[0,1.5,20]};
}

export async function loadSciFiCharacter(url) {
  return prepareSciFiCharacter(await new GLTFLoader().loadAsync(url));
}
