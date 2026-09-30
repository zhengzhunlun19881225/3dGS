const clamp=value=>Math.max(0,Math.min(1,value));
// Analytic integration of deposition*(1-x) - removal*x. Rates are accelerated
// for a visual weather demo, independent of frame rate and of the day clock.
function integrate(value,deposit,remove,dt){
  const rate=deposit+remove;
  return rate===0?value:clamp(deposit/rate+(value-deposit/rate)*Math.exp(-rate*dt));
}
export class SurfaceState {
  constructor(){this.clear();}
  clear(){this.wetness=0;this.snow=0;this.puddles=0;}
  setWetness(value){this.wetness=clamp(value);this.puddles=this.wetness*.8;}
  setSnow(value){this.snow=clamp(value);}
  update(dt,{rain=0,snow=0,night=0}={}){
    if(!Number.isFinite(dt)||dt<0)throw new RangeError('Invalid surface delta');
    rain=clamp(rain);snow=clamp(snow);night=clamp(night);
    const melt=(1-snow)*(.012*(1-night)+.003)+rain*.055;
    const oldSnow=this.snow;
    this.snow=integrate(this.snow,snow*.17,melt,dt);
    const melting=Math.max(0,oldSnow-this.snow);
    this.wetness=integrate(this.wetness,rain*.4+melting*.5/Math.max(dt,1e-6),.018*(1-rain)*(1-.7*night),dt);
    this.puddles=integrate(this.puddles,rain*.14,.03*(1-rain),dt);
    return this;
  }
}
