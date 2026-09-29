import { BoxGeometry, Matrix4 } from 'three';
import { mkdir,writeFile } from 'node:fs/promises';
const dir=new URL('../model-gs-ply/tiles-demo/',import.meta.url);await mkdir(dir,{recursive:true});
function gltf(boxes){
  const chunks=[],views=[],accessors=[],meshes=[],nodes=[];let offset=0;
  function accessor(array,type,count,componentType,min,max){const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength);const padded=Buffer.alloc(Math.ceil(bytes.length/4)*4);bytes.copy(padded);const view=views.length;views.push({buffer:0,byteOffset:offset,byteLength:bytes.length});chunks.push(padded);offset+=padded.length;const i=accessors.length;accessors.push({bufferView:view,componentType,count,type,...(min?{min,max}:{})});return i;}
  for(const {size,pos} of boxes){const g=new BoxGeometry(...size).translate(...pos);g.computeBoundingBox();const position=accessor(g.attributes.position.array,'VEC3',g.attributes.position.count,5126,g.boundingBox.min.toArray(),g.boundingBox.max.toArray());const normal=accessor(g.attributes.normal.array,'VEC3',g.attributes.normal.count,5126);const indices=accessor(g.index.array,'SCALAR',g.index.count,5123);nodes.push({mesh:meshes.length});meshes.push({primitives:[{attributes:{POSITION:position,NORMAL:normal},indices,material:0}]});}
  return {asset:{version:'2.0',generator:'PLY Explorer local collision sample'},scene:0,scenes:[{nodes:nodes.map((_,i)=>i)}],nodes,meshes,materials:[{pbrMetallicRoughness:{baseColorFactor:[.35,.58,.55,1],metallicFactor:0,roughnessFactor:.8}}],buffers:[{uri:'data:application/octet-stream;base64,'+Buffer.concat(chunks).toString('base64'),byteLength:offset}],bufferViews:views,accessors};
}
for(let i=0;i<2;i++){const x=6+i*8;await writeFile(new URL(`tile-${i}.gltf`,dir),JSON.stringify(gltf([{size:[8,.2,8],pos:[x,.1,0]},...Array.from({length:5},(_,j)=>({size:[1,.2*(j+1),3],pos:[x-2+j,.1*(j+1)+.2,0]}))])));}
const box=(x)=>[x,0,1,4,0,0,0,4,0,0,0,1];
await writeFile(new URL('tileset.json',dir),JSON.stringify({asset:{version:'1.1'},geometricError:30,root:{transform:new Matrix4().makeRotationX(-Math.PI/2).toArray(),boundingVolume:{box:[10,0,1,8,0,0,0,4,0,0,0,1]},geometricError:20,refine:'ADD',children:[0,1].map(i=>({boundingVolume:{box:box(6+i*8)},geometricError:0,content:{uri:`tile-${i}.gltf`}}))}},null,2));
