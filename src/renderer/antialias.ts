import {
  type Camera,
  Mesh,
  type Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  UniformsUtils,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

/**
 * Antialiasing for a context created without MSAA. On integrated GPUs 4× MSAA
 * cost more than the whole board, so motion (pan, zoom, drag) uses one cheap
 * FXAA pass and a settled view is redrawn once with 4× MSAA for full quality.
 *
 * The board must look exactly as when drawn straight to the canvas: shaders
 * write sRGB-encoded colour and transparent layers blend in that space. three
 * only encodes for the canvas or an XR target, so the target is flagged as one
 * (it affects output colour space and tone mapping only; tone mapping is off)
 * and stored as plain RGBA8 so the GPU does not encode a second time. FXAA
 * then reads the encoded colour it is designed for and copies it through.
 */
export class AntialiasPass {
  private readonly target = encodedTarget(0);
  private readonly multisampled = encodedTarget(4);
  private readonly material = new ShaderMaterial({
    name: 'BoardFXAA',
    uniforms: UniformsUtils.clone(FXAAShader.uniforms),
    vertexShader: FXAAShader.vertexShader,
    fragmentShader: FXAAShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  private readonly copy = new ShaderMaterial({
    name: 'BoardCopy',
    uniforms: { tDiffuse: { value: this.multisampled.texture } },
    vertexShader: FXAAShader.vertexShader,
    fragmentShader:
      'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D( tDiffuse, vUv ); }',
    depthTest: false,
    depthWrite: false,
  });
  private readonly mesh: Mesh;
  private readonly quad = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new Vector2();
  constructor() {
    this.material.uniforms.tDiffuse = { value: this.target.texture };
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.quad.add(this.mesh);
  }
  /** Draw the board to the canvas; `settled` selects MSAA over FXAA. */
  public render(
    renderer: WebGLRenderer,
    scene: Object3D,
    camera: Camera,
    settled: boolean,
  ): void {
    renderer.getDrawingBufferSize(this.size);
    const target = settled ? this.multisampled : this.target;
    if (target.width !== this.size.x || target.height !== this.size.y)
      target.setSize(this.size.x, this.size.y);
    if (!settled)
      this.material.uniforms.resolution?.value.set(
        1 / this.size.x,
        1 / this.size.y,
      );
    this.mesh.material = settled ? this.copy : this.material;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
    renderer.render(this.quad, this.camera);
  }
  public dispose(): void {
    this.target.dispose();
    this.multisampled.dispose();
    this.material.dispose();
    this.copy.dispose();
    this.mesh.geometry.dispose();
  }
}
function encodedTarget(samples: number): WebGLRenderTarget {
  const target = new WebGLRenderTarget(1, 1, {
    colorSpace: SRGBColorSpace,
    internalFormat: 'RGBA8',
    depthBuffer: true,
    samples,
  });
  (target as { isXRRenderTarget?: boolean }).isXRRenderTarget = true;
  return target;
}
