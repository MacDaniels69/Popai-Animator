import { afterEach,describe,it,expect,vi } from 'vitest';
import { ColorCompositor,gradeRGB,neutralGrade,validateGrade } from '../src/render/color-compositor';
afterEach(()=>vi.unstubAllGlobals());
describe('color compositor',()=>{
  it('keeps a neutral grade unchanged',()=>expect(gradeRGB([.2,.4,.8],neutralGrade)).toEqual([.2,.4,.8]));
  it('desaturates with luminance and clamps highlights',()=>{const result=gradeRGB([1,0,0],{brightness:1,contrast:1,saturation:0});expect(result[0]).toBeCloseTo(.2126);expect(result[1]).toEqual(result[0]);expect(gradeRGB([1,1,1],{brightness:3,contrast:3,saturation:1})).toEqual([1,1,1]);});
  it('rejects invalid effect settings',()=>expect(()=>validateGrade({brightness:Infinity,contrast:1,saturation:1})).toThrow());
  it('falls back to canvas when WebGPU is unavailable',async()=>{vi.stubGlobal('navigator',{});const calls:unknown[][]=[],context={filter:'none',clearRect:(...args:unknown[])=>calls.push(args),drawImage:(...args:unknown[])=>calls.push(args)};const output={width:0,height:0,getContext:()=>context} as unknown as HTMLCanvasElement,source={width:640,height:360} as HTMLCanvasElement;const compositor=new ColorCompositor();expect(await compositor.render(source,neutralGrade,output)).toBe('Canvas2D');expect(output.width).toBe(640);expect(context.filter).toBe('none');expect(calls.length).toBe(2);compositor.dispose();});
});
