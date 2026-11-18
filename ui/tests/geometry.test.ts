import { describe,it,expect } from 'vitest';
import { analyzeGeometry,flattenCubic } from '../src/engine/geometry';
import type { Cubic,GeometryInput } from '../src/domain/model';
const line:Cubic=[[0,0],[30,0],[70,0],[100,0]];
const input=(q:Cubic):GeometryInput=>({token:'scene:12',paths:[{id:'path1',closed:false,segments:[q]}]});
describe('geometry engine',()=>{
  it('measures a straight cubic and its bounds',()=>{const result=analyzeGeometry(input(line));expect(result.length).toBeCloseTo(100);expect(result.bounds).toEqual([0,0,100,0]);expect(result.token).toBe('scene:12');});
  it('adaptively subdivides curved geometry',()=>{const curve:Cubic=[[0,0],[0,100],[100,100],[100,0]],points=flattenCubic(curve,.01);expect(points.length).toBeGreaterThan(10);expect(points[0]).toEqual([0,0]);expect(points.at(-1)).toEqual([100,0]);const measured=analyzeGeometry(input(curve));expect(measured.length).toBeGreaterThan(190);expect(measured.bounds![3]).toBeCloseTo(75);});
  it('returns empty geometry without infinite bounds',()=>expect(analyzeGeometry({token:'empty',paths:[]}).bounds).toBeNull());
  it('rejects non-finite coordinates and excessive work',()=>{expect(()=>analyzeGeometry(input([[NaN,0],[0,0],[0,0],[0,0]]))).toThrow();expect(()=>analyzeGeometry({token:'x',paths:[{id:'a',closed:false,segments:Array(20001).fill(line)}]})).toThrow(/limits/);});
});
