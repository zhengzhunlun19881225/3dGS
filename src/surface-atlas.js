import * as T from 'three';

// Rasterize the uppermost collision surface into a small world-space atlas.
// No visible collision mesh, new BVH, or per-frame CPU raycasts are needed.
export function rasterizeSurface(root,transform=new T.Matrix4(),resolution=384){
  root.updateWorldMatrix(true,true);
  const pieces=[],bounds=new T.Box3();
  root.traverse(object=>{
    if(!object.isMesh||!object.geometry.attributes.position)return;
    const matrix=transform.clone().multiply(object.matrixWorld);
    const geometry=object.geometry;
    if(!geometry.boundingBox)geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox.clone().applyMatrix4(matrix));
    pieces.push({geometry,matrix});
  });
  if(bounds.isEmpty()||!pieces.length)throw new Error('没有可采样的地表网格');
  const size=bounds.getSize(new T.Vector3());
  if(size.x<1e-5||size.z<1e-5)throw new Error('地表覆盖范围为空');
  const width=resolution,height=resolution,data=new Float32Array(width*height*4);
  const dx=size.x/width,dz=size.z/height;
  const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),edge=new T.Vector3(),normal=new T.Vector3();
  for(const {geometry,matrix} of pieces){
    const pos=geometry.attributes.position,index=geometry.index,count=index?index.count:pos.count;
    for(let i=0;i<count;i+=3){
      a.fromBufferAttribute(pos,index?index.getX(i):i).applyMatrix4(matrix);
      b.fromBufferAttribute(pos,index?index.getX(i+1):i+1).applyMatrix4(matrix);
      c.fromBufferAttribute(pos,index?index.getX(i+2):i+2).applyMatrix4(matrix);
      normal.subVectors(b,a).cross(edge.subVectors(c,a)).normalize();
      if(Math.abs(normal.y)<.12)continue;
      if(normal.y<0)normal.negate();
      const denom=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
      if(Math.abs(denom)<1e-12)continue;
      const x0=Math.max(0,Math.ceil((Math.min(a.x,b.x,c.x)-bounds.min.x)/dx-.5));
      const x1=Math.min(width-1,Math.floor((Math.max(a.x,b.x,c.x)-bounds.min.x)/dx-.5));
      const z0=Math.max(0,Math.ceil((Math.min(a.z,b.z,c.z)-bounds.min.z)/dz-.5));
      const z1=Math.min(height-1,Math.floor((Math.max(a.z,b.z,c.z)-bounds.min.z)/dz-.5));
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
        const wx=bounds.min.x+(x+.5)*dx,wz=bounds.min.z+(z+.5)*dz;
        const u=((b.z-c.z)*(wx-c.x)+(c.x-b.x)*(wz-c.z))/denom;
        const v=((c.z-a.z)*(wx-c.x)+(a.x-c.x)*(wz-c.z))/denom;
        if(u< -1e-6||v< -1e-6||u+v>1.000001)continue;
        const y=u*a.y+v*b.y+(1-u-v)*c.y,at=(z*width+x)*4;
        if(data[at+1]===0||y>data[at]){
          data[at]=y;data[at+1]=normal.y;data[at+2]=normal.x;data[at+3]=normal.z;
        }
      }
    }
  }
  return {data,width,height,bounds,rect:new T.Vector4(bounds.min.x,bounds.min.z,1/size.x,1/size.z),tolerance:Math.max(.18,Math.max(dx,dz)*2.4)};
}

export function createSurfaceAtlas(){
  let atlas=null;
  const texture=new T.DataTexture(new Float32Array(4),1,1,T.RGBAFormat,T.FloatType);
  texture.minFilter=texture.magFilter=T.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
  const rect=new T.Vector4(0,0,1,1);
  function clear(){atlas=null;texture.dispose();texture.image={data:new Float32Array(4),width:1,height:1};texture.needsUpdate=true;}
  return {texture,rect,
    get ready(){return Boolean(atlas);},
    get tolerance(){return atlas?.tolerance??.35;},
    build(root,transform){
      const next=rasterizeSurface(root,transform);
      texture.dispose();texture.image={data:next.data,width:next.width,height:next.height};texture.needsUpdate=true;
      rect.copy(next.rect);atlas=next;return atlas;
    },
    clear,
    dispose(){texture.dispose();atlas=null;},
  };
}
