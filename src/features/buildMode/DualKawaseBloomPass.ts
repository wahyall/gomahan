import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js";

/**
 * OPT-04 — Progressive Dual-Kawase HDR Bloom (Jimenez, "Call of Duty: Advanced
 * Warfare", SIGGRAPH 2014) replacing the legacy 12-pass `UnrealBloomPass`.
 *
 * The whole chain runs at half resolution and below, so the GPU cost collapses
 * from 12 full-screen passes (5 separable Gaussian blur levels + high pass +
 * composite) to **7 small passes**:
 *
 *   prefilter@1/2  (9-tap tent + Karis average — fireflies average out and the
 *                   HDR threshold is applied with a soft knee)
 *   down 1/2 → 1/4 → 1/8 → 1/16   (bilinear box downsample)
 *   up   1/16 → 1/8 → 1/4 → 1/2   (3×3 tent additive upsample)
 *
 * There is no separate composite pass: the final `FinalOutputPass` samples the
 * accumulated half-res bloom texture directly while it applies the ACES tone
 * map (OPT-03 fusion), which removes one more full-resolution pass.
 *
 * All render targets are single-purpose `HalfFloat` without depth/stencil
 * (OPT-21) and are reused across frames — zero allocation per frame.
 */
const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Raw vertex shader (explicit precision/attributes) mirroring three's OutputShader. */
const OUTPUT_VERT = /* glsl */ `
  precision highp float;

  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;

  attribute vec3 position;
  attribute vec2 uv;

  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Prefilter: luminance soft-knee threshold + Karis-weighted tent average. */
const PREFILTER_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  // Karis average: bright HDR samples ("fireflies") pull their own weight down,
  // so a single hot pixel cannot smear a glowing streak across the whole bloom.
  float karisW(vec3 c) { return 1.0 / (1.0 + luma(c)); }

  void main() {
    vec2 o = uTexel;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    vec3 c; float w;
    c = texture2D(tDiffuse, vUv).rgb;                       w = 4.0 * karisW(c); acc += c * w; wsum += w;
    c = texture2D(tDiffuse, vUv + o * vec2(-0.5,  0.0)).rgb; w = 2.0 * karisW(c); acc += c * w; wsum += w;
    c = texture2D(tDiffuse, vUv + o * vec2( 0.5,  0.0)).rgb; w = 2.0 * karisW(c); acc += c * w; wsum += w;
    c = texture2D(tDiffuse, vUv + o * vec2( 0.0, -0.5)).rgb; w = 2.0 * karisW(c); acc += c * w; wsum += w;
    c = texture2D(tDiffuse, vUv + o * vec2( 0.0,  0.5)).rgb; w = 2.0 * karisW(c); acc += c * w; wsum += w;
    c = texture2D(tDiffuse, vUv + o * vec2(-0.5, -0.5)).rgb; w = 1.0 * karisW(c); acc += c * w; wsum += w;
    c = texture2D(tDiffuse, vUv + o * vec2( 0.5, -0.5)).rgb; w = 1.0 * karisW(c); acc += c * w; wsum += w;
    c = texture2D(tDiffuse, vUv + o * vec2(-0.5,  0.5)).rgb; w = 1.0 * karisW(c); acc += c * w; wsum += w;
    c = texture2D(tDiffuse, vUv + o * vec2( 0.5,  0.5)).rgb; w = 1.0 * karisW(c); acc += c * w; wsum += w;
    vec3 avg = acc / max(wsum, 1e-4);

    // Soft-knee HDR threshold (UnrealBloom parity: linear ramp of width uKnee)
    float l = luma(avg);
    float brightness = clamp((l - uThreshold) / max(uKnee, 1e-4) + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(avg * brightness, 1.0);
  }
`;

/** Kawase bilinear box downsample (4 taps cover a 4×4 source footprint). */
const DOWNSAMPLE_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  varying vec2 vUv;

  void main() {
    vec2 o = uTexel;
    vec4 sum = texture2D(tDiffuse, vUv + o * vec2(-1.0, -1.0));
    sum += texture2D(tDiffuse, vUv + o * vec2( 1.0, -1.0));
    sum += texture2D(tDiffuse, vUv + o * vec2(-1.0,  1.0));
    sum += texture2D(tDiffuse, vUv + o * vec2( 1.0,  1.0));
    gl_FragColor = sum * 0.25;
  }
`;

/** 3×3 tent additive upsample back up the pyramid. */
const UPSAMPLE_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  varying vec2 vUv;

  void main() {
    vec2 o = uTexel;
    vec4 sum = texture2D(tDiffuse, vUv) * 4.0;
    sum += texture2D(tDiffuse, vUv + o * vec2(-1.0,  0.0)) * 2.0;
    sum += texture2D(tDiffuse, vUv + o * vec2( 1.0,  0.0)) * 2.0;
    sum += texture2D(tDiffuse, vUv + o * vec2( 0.0, -1.0)) * 2.0;
    sum += texture2D(tDiffuse, vUv + o * vec2( 0.0,  1.0)) * 2.0;
    sum += texture2D(tDiffuse, vUv + o * vec2(-1.0, -1.0));
    sum += texture2D(tDiffuse, vUv + o * vec2( 1.0, -1.0));
    sum += texture2D(tDiffuse, vUv + o * vec2(-1.0,  1.0));
    sum += texture2D(tDiffuse, vUv + o * vec2( 1.0,  1.0));
    gl_FragColor = sum / 16.0;
  }
`;

const BLOOM_LAYERS = 4; // 1/2, 1/4, 1/8, 1/16

export class DualKawaseBloomPass extends Pass {
  /** Half-res accumulated bloom texture — sampled by `FinalOutputPass`. */
  public readonly bloomTexture: THREE.Texture;

  private readonly renderTargets: THREE.WebGLRenderTarget[] = [];
  private readonly prefilterQuad: FullScreenQuad;
  private readonly downQuad: FullScreenQuad;
  private readonly upQuad: FullScreenQuad;
  private readonly rtSizes: { w: number; h: number }[] = [];

  constructor(resolution: THREE.Vector2, threshold = 1.45, knee = 0.01) {
    super();
    this.needsSwap = false; // the main chain buffer flows through untouched
    this.enabled = true;

    const rtOpts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    };
    for (let i = 0; i < BLOOM_LAYERS; i++) {
      const w = Math.max(1, Math.floor(resolution.x / (2 ** (i + 1))));
      const h = Math.max(1, Math.floor(resolution.y / (2 ** (i + 1))));
      this.renderTargets.push(new THREE.WebGLRenderTarget(w, h, rtOpts));
      this.rtSizes.push({ w, h });
    }
    this.bloomTexture = this.renderTargets[0]!.texture;

    const mkUniforms = (texel: THREE.Vector2): Record<string, THREE.IUniform> => ({
      tDiffuse: { value: null },
      uTexel: { value: texel },
    });
    const prefilterMat = new THREE.ShaderMaterial({
      uniforms: { ...mkUniforms(new THREE.Vector2()), uThreshold: { value: threshold }, uKnee: { value: knee } },
      vertexShader: QUAD_VERT,
      fragmentShader: PREFILTER_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const downMat = new THREE.ShaderMaterial({
      uniforms: mkUniforms(new THREE.Vector2()),
      vertexShader: QUAD_VERT,
      fragmentShader: DOWNSAMPLE_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const upMat = new THREE.ShaderMaterial({
      uniforms: mkUniforms(new THREE.Vector2()),
      vertexShader: QUAD_VERT,
      fragmentShader: UPSAMPLE_FRAG,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });

    this.prefilterQuad = new FullScreenQuad(prefilterMat);
    this.downQuad = new FullScreenQuad(downMat);
    this.upQuad = new FullScreenQuad(upMat);
  }

  private setTexel(mat: THREE.ShaderMaterial, w: number, h: number, scale: number): void {
    (mat.uniforms.uTexel!.value as THREE.Vector2).set((1 / Math.max(1, w)) * scale, (1 / Math.max(1, h)) * scale);
  }

  render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false; // additive upsample passes must keep the pyramid contents

    const preMat = this.prefilterQuad.material as THREE.ShaderMaterial;
    const downMat = this.downQuad.material as THREE.ShaderMaterial;
    const upMat = this.upQuad.material as THREE.ShaderMaterial;

    // Prefilter: full-res HDR chain buffer → half-res thresholded bloom.
    const halfW = this.rtSizes[0]!.w;
    const halfH = this.rtSizes[0]!.h;
    preMat.uniforms.tDiffuse!.value = readBuffer.texture;
    // uTexel = one *source* texel (full res): source res ≈ 2 × half res exactly
    // for the composer's power-friendly sizes; use the actual ratio for safety.
    this.setTexel(preMat, halfW * 2, halfH * 2, 1.0);
    renderer.setRenderTarget(this.renderTargets[0]!);
    this.prefilterQuad.render(renderer);

    // Downsample chain 1/2 → 1/16.
    for (let i = 1; i < BLOOM_LAYERS; i++) {
      const src = this.renderTargets[i - 1]!;
      const dst = this.renderTargets[i]!;
      const dstSize = this.rtSizes[i]!;
      downMat.uniforms.tDiffuse!.value = src.texture;
      this.setTexel(downMat, dstSize.w, dstSize.h, 0.5);
      renderer.setRenderTarget(dst);
      this.downQuad.render(renderer);
    }

    // Tent-filter additive upsample 1/16 → 1/2.
    for (let i = BLOOM_LAYERS - 2; i >= 0; i--) {
      const src = this.renderTargets[i + 1]!;
      const dst = this.renderTargets[i]!;
      const dstSize = this.rtSizes[i]!;
      upMat.uniforms.tDiffuse!.value = src.texture;
      this.setTexel(upMat, dstSize.w, dstSize.h, 0.5);
      renderer.setRenderTarget(dst);
      this.upQuad.render(renderer);
    }

    renderer.setRenderTarget(null);
    renderer.autoClear = oldAutoClear;
  }

  setSize(width: number, height: number): void {
    for (let i = 0; i < BLOOM_LAYERS; i++) {
      const w = Math.max(1, Math.floor(width / (2 ** (i + 1))));
      const h = Math.max(1, Math.floor(height / (2 ** (i + 1))));
      this.renderTargets[i]!.setSize(w, h);
      this.rtSizes[i] = { w, h };
    }
  }

  dispose(): void {
    // Quad geometry is module-shared in three's Pass helper; dispose materials only.
    (this.prefilterQuad.material as THREE.Material).dispose();
    (this.downQuad.material as THREE.Material).dispose();
    (this.upQuad.material as THREE.Material).dispose();
    for (const rt of this.renderTargets) rt.dispose();
  }
}

/**
 * OPT-03 + OPT-04 fused output pass: bloom composite + linear-space vignette +
 * banding dither + renderer ACES tone-map + sRGB — in ONE full-resolution pass
 * (replacing both `UnrealBloomPass`'s composite and the stock `OutputPass`).
 *
 * The vignette/dither moved here from `AtmospherePass`, so that pass can be fully
 * disabled whenever the sun is behind the camera or below the horizon.
 *
 * Mirrors three's `OutputPass` implementation (RawShaderMaterial + explicit tone
 * mapping defines synced from the renderer) so the ACES/sRGB math is identical.
 */
const FinalOutputShader = {
  name: "FinalOutputShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tBloom: { value: null as THREE.Texture | null },
    uBloomStrength: { value: 0.2 },
    uVignette: { value: 0.16 },
    uDither: { value: 0.0022 },
    uTime: { value: 0 },
    uAspect: { value: 1.777 },
    toneMappingExposure: { value: 1 },
  },
  vertexShader: OUTPUT_VERT,
  fragmentShader: /* glsl */ `
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    uniform float uBloomStrength;
    uniform float uVignette;
    uniform float uDither;
    uniform float uTime;
    uniform float uAspect;

    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>

    varying vec2 vUv;

    float hash21(vec2 p) {
      p = fract(p * vec2(234.34, 435.345));
      p += dot(p, p + 34.23);
      return fract(p.x * p.y);
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 col = base.rgb + texture2D(tBloom, vUv).rgb * uBloomStrength;

      // Gentle linear-space vignette keeps sky corners from going chalky
      float r = length((vUv - 0.5) * vec2(uAspect, 1.0));
      col *= 1.0 - uVignette * smoothstep(0.55, 1.25, r);

      // 8-bit output banding dither (decorrelates quantisation after tone map)
      col += (hash21(vUv * 913.37 + floor(uTime * 8.0) * 17.7) - 0.5) * uDither;

      gl_FragColor = vec4(col, base.a);

      // tone mapping (three OutputPass parity)
      #ifdef LINEAR_TONE_MAPPING
        gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
      #elif defined( REINHARD_TONE_MAPPING )
        gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
      #elif defined( CINEON_TONE_MAPPING )
        gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
      #elif defined( ACES_FILMIC_TONE_MAPPING )
        gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
      #elif defined( AGX_TONE_MAPPING )
        gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
      #elif defined( NEUTRAL_TONE_MAPPING )
        gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
      #elif defined( CUSTOM_TONE_MAPPING )
        gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
      #endif

      // color space (three OutputPass parity)
      #ifdef SRGB_TRANSFER
        gl_FragColor = sRGBTransferOETF( gl_FragColor );
      #endif
    }
  `,
};

export { FinalOutputShader };

/**
 * Typed `OutputPass`-style wrapper: syncs tone mapping + exposure + sRGB defines
 * from the renderer exactly like three's `OutputPass`, and exposes the fused
 * uniforms (bloom strength, vignette, dither, time, aspect) for the scene driver.
 */
export class FinalOutputPass extends Pass {
  public readonly finalUniforms: typeof FinalOutputShader.uniforms;

  private readonly fsQuad: FullScreenQuad;
  private readonly material: THREE.RawShaderMaterial;
  private outputColorSpace: string | null = null;
  private toneMapping: THREE.ToneMapping | null = null;

  constructor() {
    super();
    this.finalUniforms = FinalOutputShader.uniforms as typeof FinalOutputShader.uniforms;
    this.material = new THREE.RawShaderMaterial({
      name: FinalOutputShader.name,
      uniforms: this.finalUniforms,
      vertexShader: FinalOutputShader.vertexShader,
      fragmentShader: FinalOutputShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.finalUniforms.tDiffuse.value = readBuffer.texture;
    this.finalUniforms.toneMappingExposure.value = renderer.toneMappingExposure;

    if (this.outputColorSpace !== renderer.outputColorSpace || this.toneMapping !== renderer.toneMapping) {
      this.outputColorSpace = renderer.outputColorSpace;
      this.toneMapping = renderer.toneMapping;
      this.material.defines = {};
      if (THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer) {
        this.material.defines.SRGB_TRANSFER = "";
      }
      if (renderer.toneMapping === THREE.LinearToneMapping) this.material.defines.LINEAR_TONE_MAPPING = "";
      else if (renderer.toneMapping === THREE.ReinhardToneMapping) this.material.defines.REINHARD_TONE_MAPPING = "";
      else if (renderer.toneMapping === THREE.CineonToneMapping) this.material.defines.CINEON_TONE_MAPPING = "";
      else if (renderer.toneMapping === THREE.ACESFilmicToneMapping) this.material.defines.ACES_FILMIC_TONE_MAPPING = "";
      else if (renderer.toneMapping === THREE.AgXToneMapping) this.material.defines.AGX_TONE_MAPPING = "";
      else if (renderer.toneMapping === THREE.NeutralToneMapping) this.material.defines.NEUTRAL_TONE_MAPPING = "";
      else if (renderer.toneMapping === THREE.CustomToneMapping) this.material.defines.CUSTOM_TONE_MAPPING = "";
      this.material.needsUpdate = true;
    }

    if (this.renderToScreen === true) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
      this.fsQuad.render(renderer);
    }
  }

  dispose(): void {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
