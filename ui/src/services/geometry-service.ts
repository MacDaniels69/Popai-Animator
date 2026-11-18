import type { GeometryInput, GeometryResult } from '../domain/model';
export class GeometryService {
  private worker: Worker;
  private sequence=0;
  private running: {id:number;resolve:(result:GeometryResult)=>void;reject:(error:Error)=>void} | null=null;
  private queued: {input:GeometryInput;resolve:(result:GeometryResult)=>void;reject:(error:Error)=>void} | null=null;
  constructor(){
    this.worker=new Worker(new URL('../engine/geometry.worker.ts',import.meta.url),{type:'module'});
    this.worker.onmessage=(event:MessageEvent<{id:number;result?:GeometryResult;error?:string}>)=>{
      if(this.running?.id!==event.data.id)return;
      if(event.data.result)this.running.resolve(event.data.result);else this.running.reject(new Error(event.data.error||'Worker failed'));
      this.running=null;this.flush();
    };
    this.worker.onerror=()=>{this.running?.reject(new Error('Geometry worker stopped'));this.queued?.reject(new Error('Geometry worker stopped'));this.running=null;this.queued=null;};
  }
  analyze(input:GeometryInput):Promise<GeometryResult>{return new Promise((resolve,reject)=>{this.queued?.reject(new DOMException('Superseded analysis','AbortError'));this.queued={input,resolve,reject};this.flush();});}
  private flush(){if(this.running||!this.queued)return;const job=this.queued;this.queued=null;this.running={id:++this.sequence,resolve:job.resolve,reject:job.reject};this.worker.postMessage({id:this.sequence,input:job.input});}
  dispose(){this.worker.terminate();this.running?.reject(new DOMException('Worker disposed','AbortError'));this.queued?.reject(new DOMException('Worker disposed','AbortError'));this.running=null;this.queued=null;}
}
