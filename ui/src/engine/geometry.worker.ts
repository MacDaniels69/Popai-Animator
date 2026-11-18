import { analyzeGeometry } from './geometry';
import type { GeometryInput } from '../domain/model';
self.onmessage=(event: MessageEvent<{id:number;input:GeometryInput}>)=>{
  const {id,input}=event.data;
  try{self.postMessage({id,result:analyzeGeometry(input)});}catch(error){self.postMessage({id,error:error instanceof Error?error.message:'Analysis failed'});}
};
