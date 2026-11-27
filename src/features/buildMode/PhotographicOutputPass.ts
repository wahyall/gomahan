import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js";

/**
 * GR-06 + PH-01…PH-04 — **Photographic Output Pass**: the single fused final
 * pass of the hybrid RT pipeline (replaces `FinalOutputPass` whenever the
 * cinematic stack is active). One full-resolution fragment shader performs:
 *
 * 1. Screen-Space Contact Shadows (SSCS, 6-step depth raymarch toward the sun,
 *    0.22 m) — furniture legs & mullions pin to the floor with zero Peter-Panning.
 * 2. Additive Dual-Kawase bloom composite.
 * 3. Camera EV100 auto-exposure (`uExposure`, smoothed on the CPU — iris feel).
 * 4. White-Balance Kelvin matrix (`uWhiteBalance`).
 * 5. **AgX Punchy** filmic tone mapping (deep photographic contrast, pure
 *    gold-white highlights, rich shadow saturation — no pale-yellow hue skew).
 * 6. RCAS-style contrast-adaptive micro-sharpening (5-tap) after MSAA + bloom.
 * 7. Optical lens signature: cos⁴ vignette, edge-only chromatic aberration,
 *    luminance-weighted fine film grain, blue-noise dither.
 * 8. Subtle architectural vertical correction (PH-02 tilt-shift signature).
 *
 * Everything is uniform-gated, so RT ON/OFF never triggers a recompile and the
 * toggle stays stutter-free.
 */

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

const PHOTO_FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  uniform sampler2D tDepth;

  uniform float uBloomStrength;
  uniform float uExposure;
  uniform mat3 uWhiteBalance;

  uniform float uSscs;
  uniform float uSscsDist;
  uniform vec3 uSunDirView;
  uniform mat4 uProj;
  uniform mat4 uProjInv;

  uniform float uSharpness;
  uniform float uVignette;
  uniform float uCaAmount;
  uniform float uGrainAmount;
  uniform float uDither;
  uniform float uVertCorrect;
  uniform float uTime;
  uniform float uAspect;
  uniform vec2 uResolution;

  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  // Reconstruct the view-space position of a screen pixel from its depth.
  vec3 viewPosFromDepth(vec2 uv) {
    float d = texture2D(tDepth, uv).r;
    vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 view4 = uProjInv * clip;
    return view4.xyz / view4.w;
  }

  // GR-03: 6-step screen-space contact shadow march toward the sun.
  float sscsOcclusion(vec2 uv, vec3 viewPos) {
    if (uSscs < 0.5) return 0.0;
    if (texture2D(tDepth, uv).r >= 0.9999) return 0.0; // sky never contact-shadows
    vec3 dir = normalize(uSunDirView);
    float occ = 0.0;
    for (int i = 1; i <= 6; i++) {
      float t = 0.024 + uSscsDist * (float(i) / 6.0);
      vec3 samplePos = viewPos + dir * t;
      vec4 clip = uProj * vec4(samplePos, 1.0);
      if (clip.w <= 0.0) continue;
      vec2 suv = (clip.xy / clip.w) * 0.5 + 0.5;
      if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
      vec3 sceneView = viewPosFromDepth(suv);
      float sampleDist = -samplePos.z;
      float sceneDist = -sceneView.z;
      // The surface sits between the camera and the ray point (occluder), and
      // within a thin slab so broad geometry never self-shadows.
      if (sampleDist > sceneDist + 0.028 && sampleDist < sceneDist + 0.42) {
        occ += 1.0 / 6.0;
      }
    }
    return occ;
  }

  // AgX (Filament / Blender, rec2020 primaries) with the Punchy look.
  vec3 agxDefaultContrastApprox(vec3 x) {
    vec3 x2 = x * x;
    vec3 x4 = x2 * x2;
    return + 15.5 * x4 * x2
      - 40.14 * x4 * x
      + 31.96 * x4
      - 6.868 * x2 * x
      + 0.4298 * x2
      + 0.1191 * x
      - 0.00232;
  }

  vec3 agxPunchy(vec3 color) {
    const mat3 AGX_INSET = mat3(
      vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
      vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
      vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
    );
    const mat3 AGX_OUTSET = mat3(
      vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
      vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
      vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
    );
    const mat3 SRGB_TO_REC2020 = mat3(
      vec3( 0.6274, 0.0691, 0.0164 ),
      vec3( 0.3293, 0.9195, 0.0880 ),
      vec3( 0.0433, 0.0113, 0.8956 )
    );
    const mat3 REC2020_TO_SRGB = mat3(
      vec3( 1.6605, - 0.1246, - 0.0182 ),
      vec3( - 0.5876, 1.1329, - 0.1006 ),
      vec3( - 0.0728, - 0.0083, 1.1187 )
    );

    const float AGX_MIN_EV = - 12.47393;
    const float AGX_MAX_EV = 4.026069;

    color = SRGB_TO_REC2020 * color;
    color = AGX_INSET * color;
    color = max( color, 1e-10 );
    color = log2( color );
    color = ( color - AGX_MIN_EV ) / ( AGX_MAX_EV - AGX_MIN_EV );
    color = clamp( color, 0.0, 1.0 );
    color = agxDefaultContrastApprox( color );

    // AgX "Punchy" look: boosted saturation + gentle contrast through the midtones.
    float l = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
    color = clamp( mix( vec3( l ), color, 1.29 ), 0.0, 1.0 );
    color = clamp( ( color - 0.5 ) * 1.035 + 0.5, 0.0, 1.0 );

    color = AGX_OUTSET * color;
    color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
    color = REC2020_TO_SRGB * color;
    return clamp( color, 0.0, 1.0 );
  }

  vec3 linearToSrgb(vec3 c) {
    return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( vec3( 0.0031308 ), c ) );
  }

  void main() {
    // PH-02 subtle architectural vertical correction (tilt-shift signature):
    // softly squeeze the outer columns' verticals toward parallel.
    vec2 uv = vUv;
    if ( uVertCorrect > 0.001 ) {
      float vx = vUv.x - 0.5;
      float vy = vUv.y - 0.5;
      float squeeze = 1.0 - uVertCorrect * vx * vx * 0.6;
      uv.y = 0.5 + vy * squeeze;
    }

    // Edge-only chromatic aberration: radial R/B split that vanishes at centre.
    vec2 cuv = vUv - 0.5;
    float rr = dot( cuv, cuv );
    vec2 caOff = cuv * uCaAmount * rr * 2.0;
    vec3 col;
    col.r = texture2D( tDiffuse, uv + caOff ).r;
    col.g = texture2D( tDiffuse, uv ).g;
    col.b = texture2D( tDiffuse, uv - caOff ).b;
    float baseA = texture2D( tDiffuse, uv ).a;

    // 1) Screen-space contact shadows lock contact points to the floor
    //    (only when the march is enabled — the depth fetch is not free).
    float occ = 0.0;
    if ( uSscs > 0.5 ) {
      vec3 viewPos = viewPosFromDepth( uv );
      occ = sscsOcclusion( uv, viewPos );
      col *= 1.0 - occ * 0.58;
    }

    // 2) Additive HDR bloom composite.
    col += texture2D( tBloom, uv ).rgb * uBloomStrength;

    // 6) RCAS-style contrast-adaptive sharpening (5-tap, damped in high contrast)
    //    on the LINEAR composite — same signal space as its neighbour taps.
    if ( uSharpness > 0.001 ) {
      vec2 t = 1.0 / uResolution;
      vec3 cN = texture2D( tDiffuse, uv + vec2( 0.0, t.y ) ).rgb;
      vec3 cS = texture2D( tDiffuse, uv - vec2( 0.0, t.y ) ).rgb;
      vec3 cE = texture2D( tDiffuse, uv + vec2( t.x, 0.0 ) ).rgb;
      vec3 cW = texture2D( tDiffuse, uv - vec2( t.x, 0.0 ) ).rgb;
      vec3 mn = min( col, min( min( cN, cS ), min( cE, cW ) ) );
      vec3 mx = max( col, max( max( cN, cS ), max( cE, cW ) ) );
      vec3 localRange = max( mx - mn, 1e-3 );
      // Contrast-adaptive weight: flat wood grain sharpens, hard edges stay calm.
      vec3 adapt = clamp( 0.045 / localRange, 0.0, 1.0 );
      vec3 detail = ( cN + cS + cE + cW ) * 0.25 - col;
      col += detail * adapt * uSharpness * 2.4;
    }

    // 3) EV100 exposure + 4) white balance, then 5) AgX Punchy tone map.
    col = uWhiteBalance * ( col * uExposure );
    col = agxPunchy( col );

    // 7) Optical vignette (cos⁴ falloff toward the frame corners).
    vec2 vc = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
    float rN = length( vc ) / max( 0.5 * uAspect, 0.5 );
    float vig = 1.0 - uVignette * ( rN * rN ) * ( rN * rN );
    col *= clamp( vig, 0.0, 1.0 );

    // Luminance-weighted fine film grain: mid-shadows only, never highlights.
    float lum = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
    float grainW = 1.0 - smoothstep( 0.22, 0.62, lum );
    col += ( hash21( vUv * 911.7 + floor( uTime * 12.0 ) * 19.3 ) - 0.5 ) * uGrainAmount * grainW;

    // Blue-noise-ish dither against 8-bit banding.
    col += ( hash21( vUv * 913.37 + floor( uTime * 8.0 ) * 17.7 ) - 0.5 ) * uDither;

    gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), baseA );
    gl_FragColor.rgb = linearToSrgb( gl_FragColor.rgb );
  }
`;

export interface PhotographicUniforms {
  tDiffuse: { value: THREE.Texture | null };
  tBloom: { value: THREE.Texture | null };
  tDepth: { value: THREE.Texture | null };
  uBloomStrength: { value: number };
  uExposure: { value: number };
  uWhiteBalance: { value: THREE.Matrix3 };
  uSscs: { value: number };
  uSscsDist: { value: number };
  uSunDirView: { value: THREE.Vector3 };
  uProj: { value: THREE.Matrix4 };
  uProjInv: { value: THREE.Matrix4 };
  uSharpness: { value: number };
  uVignette: { value: number };
  uCaAmount: { value: number };
  uGrainAmount: { value: number };
  uDither: { value: number };
  uVertCorrect: { value: number };
  uTime: { value: number };
  uAspect: { value: number };
  uResolution: { value: THREE.Vector2 };
}

export class PhotographicOutputPass extends Pass {
  public readonly photoUniforms: PhotographicUniforms;

  private readonly fsQuad: FullScreenQuad;
  private readonly material: THREE.RawShaderMaterial;
  private outputColorSpace: string | null = null;

  constructor() {
    super();
    this.photoUniforms = {
      tDiffuse: { value: null },
      tBloom: { value: null },
      tDepth: { value: null },
      uBloomStrength: { value: 0.28 },
      uExposure: { value: 1.0 },
      uWhiteBalance: { value: new THREE.Matrix3() },
      uSscs: { value: 1 },
      uSscsDist: { value: 0.22 },
      uSunDirView: { value: new THREE.Vector3(0.45, 0.78, -0.42) },
      uProj: { value: new THREE.Matrix4() },
      uProjInv: { value: new THREE.Matrix4() },
      uSharpness: { value: 0.2 },
      uVignette: { value: 0.18 },
      uCaAmount: { value: 0.001 },
      uGrainAmount: { value: 0.0055 },
      uDither: { value: 0.0022 },
      uVertCorrect: { value: 0 },
      uTime: { value: 0 },
      uAspect: { value: 1.777 },
      uResolution: { value: new THREE.Vector2(1920, 1080) },
    };
    this.material = new THREE.RawShaderMaterial({
      name: "PhotographicOutputShader",
      uniforms: this.photoUniforms as unknown as Record<string, THREE.IUniform>,
      vertexShader: OUTPUT_VERT,
      fragmentShader: PHOTO_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  setSize(width: number, height: number): void {
    this.photoUniforms.uResolution.value.set(Math.max(1, width), Math.max(1, height));
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.photoUniforms.tDiffuse.value = readBuffer.texture;

    if (this.outputColorSpace !== renderer.outputColorSpace) {
      // AgX + sRGB are embedded; only track the space so the shader can be
      // extended for linear workflows later without a silent colour bug.
      this.outputColorSpace = renderer.outputColorSpace;
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
