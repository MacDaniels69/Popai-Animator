import { afterEach,it,expect,vi } from 'vitest';
import { GeometryService } from '../src/services/geometry-service';
const messages:{id:number;input:unknown}[]=[];let worker:FakeWorker;
class FakeWorker{onmessage:((e:unknown)=>void)|null=null;onerror:(()=>void)|null=null;constructor(){worker=this;}postMessage(value:{id:number;input:unknown}){messages.push(value);}terminate(){}}
afterEach(()=>{vi.unstubAllGlobals();messages.length=0;});
it('coalesces queued geometry jobs and releases the worker',async()=>{vi.stubGlobal('Worker',FakeWorker);const service=new GeometryService(),first=service.analyze({token:'first',paths:[]}),second=service.analyze({token:'second',paths:[]}).catch(error=>error.name),third=service.analyze({token:'third',paths:[]});expect(messages.length).toBe(1);expect(await second).toBe('AbortError');worker.onmessage!({data:{id:1,result:{token:'first'}}});expect((await first).token).toBe('first');expect(messages.length).toBe(2);worker.onmessage!({data:{id:2,result:{token:'third'}}});expect((await third).token).toBe('third');service.dispose();});
