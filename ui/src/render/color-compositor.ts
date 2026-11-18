export interface Grade { brightness:number;contrast:number;saturation:number }
export const neutralGrade:Grade={brightness:1,contrast:1,saturation:1};
export function validateGrade(value:Grade):Grade {
  for(const key of ['brightness','contrast','saturation'] as const)if(!Number.isFinite(value[key])||value[key]<0||value[key]>3)throw new Error('Color values must be between 0 and 3');
  return {...value};
}
export function gradeRGB(rgb:[number,number,number],grade:Grade):[number,number,number]{
  const g=validateGrade(grade),b=rgb.map(v=>(v*g.brightness-.5)*g.contrast+.5),luma=b[0]*.2126+b[1]*.7152+b[2]*.0722;
  return b.map(v=>Math.max(0,Math.min(1,luma+(v-luma)*g.saturation))) as [number,number,number];
}
const shader=`
struct Grade { values:vec4f };
@group(0) @binding(0) var image:texture_2d<f32>;
@group(0) @binding(1) var imageSampler:sampler;
@group(0) @binding(2) var<uniform> grade:Grade;
struct VertexOut { @builtin(position) position:vec4f, @location(0) uv:vec2f };
@vertex fn vertex(@builtin(vertex_index) index:u32)->VertexOut {
  let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var result:VertexOut;
  result.position=vec4f(p[index],0,1);result.uv=p[index]*vec2f(.5,-.5)+vec2f(.5,.5);return result;
}
@fragment fn fragment(input:VertexOut)->@location(0) vec4f {
  let original=textureSample(image,imageSampler,input.uv);
  let adjusted=(original.rgb*grade.values.x-vec3f(.5))*grade.values.y+vec3f(.5);
  let luma=dot(adjusted,vec3f(.2126,.7152,.0722));
  return vec4f(clamp(mix(vec3f(luma),adjusted,grade.values.z),vec3f(0),vec3f(1))*original.a,original.a);
}`;
/** Optional WebGPU effect processing. Drawing/rigging remain on the compatible canvas renderer. */
export class ColorCompositor {
  private device:GPUDevice|null=null;
  private pipeline:GPURenderPipeline|null=null;
  private canvas:HTMLCanvasElement|null=null;
  private context:GPUCanvasContext|null=null;
  private initialization:Promise<void>|null=null;
  private unavailable=false;
  private disposed=false;
  private async initialize(){
    if(this.initialization)return this.initialization;
    this.initialization=(async()=>{
      if(!navigator.gpu)throw new Error('WebGPU unavailable');const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw new Error('No GPU adapter');
      const device=await adapter.requestDevice();if(this.disposed){device.destroy();throw new Error('Compositor disposed');}this.device=device;
      this.canvas=document.createElement('canvas');this.context=this.canvas.getContext('webgpu');if(!this.context)throw new Error('GPU canvas unavailable');
      const format=navigator.gpu.getPreferredCanvasFormat();this.context.configure({device,format,alphaMode:'premultiplied'});
      this.pipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module:device.createShaderModule({code:shader}),entryPoint:'vertex'},fragment:{module:device.createShaderModule({code:shader}),entryPoint:'fragment',targets:[{format}]},primitive:{topology:'triangle-list'}});
      void device.lost.then(()=>{this.unavailable=true;});
    })();return this.initialization;
  }
  async render(source:HTMLCanvasElement,grade:Grade,output:HTMLCanvasElement):Promise<'WebGPU'|'Canvas2D'>{
    validateGrade(grade);if(this.disposed)throw new Error('Compositor disposed');output.width=source.width;output.height=source.height;
    const target=output.getContext('2d');if(!target)throw new Error('Canvas unavailable');
    if(!this.unavailable)try{
      await this.initialize();const device=this.device!,pipeline=this.pipeline!,canvas=this.canvas!,context=this.context!;
      canvas.width=source.width;canvas.height=source.height;
      const texture=device.createTexture({size:[source.width,source.height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
      const buffer=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      try{device.queue.copyExternalImageToTexture({source},{texture},[source.width,source.height]);device.queue.writeBuffer(buffer,0,new Float32Array([grade.brightness,grade.contrast,grade.saturation,0]));
        const bindings=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView()},{binding:1,resource:device.createSampler({magFilter:'linear',minFilter:'linear'})},{binding:2,resource:{buffer}}]});
        const encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
        pass.setPipeline(pipeline);pass.setBindGroup(0,bindings);pass.draw(3);pass.end();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();
        if(this.disposed)throw new Error('Compositor disposed');target.clearRect(0,0,output.width,output.height);target.drawImage(canvas,0,0);return 'WebGPU';
      }finally{buffer.destroy();texture.destroy();}
    }catch{this.unavailable=true;}
    target.clearRect(0,0,output.width,output.height);target.filter=`brightness(${grade.brightness}) contrast(${grade.contrast}) saturate(${grade.saturation})`;target.drawImage(source,0,0);target.filter='none';return 'Canvas2D';
  }
  dispose(){this.disposed=true;this.device?.destroy();this.context?.unconfigure();}
}
