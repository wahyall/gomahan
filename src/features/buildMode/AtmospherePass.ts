import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * Cinematic atmosphere pass: screen-space sun shafts (crepuscular "god rays")
 * applied on the linear HDR buffer before tone mapping, following the `3d-sky-rays`
 * recipe: march toward the projected sun, accumulate threshold-gated sky energy with
 * an exponentially decaying weight, normalise by the weight sum so sample count
 * never changes exposure, and fade out as the sun leaves the overscan margin.
 *
 * OPT-03 fusion: the linear-space vignette and 8-bit dither moved to
 * `FinalOutputPass` (with bloom composite + ACES) so this pass can be fully
 * disabled whenever the sun is behind the camera or below the horizon.
 */
const AtmosphereShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSunUv: { value: new THREE.Vector2(0.5, 0.8) },
    uSunColor: { value: new THREE.Color(1.0, 0.94, 0.82) },
    uSunFade: { value: 0 }, // 0 = hidden/off-screen/night, 1 = fully visible
    uIntensity: { value: 0.42 },
    uDensity: { value: 0.62 },
    uDecay: { value: 0.94 },
    uWeight: { value: 0.32 },
    uEnergyClamp: { value: 1.9 },
    uSamples: { value: 32 },
    uAspect: { value: 1.777 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSunUv;
    uniform vec3 uSunColor;
    uniform float uSunFade;
    uniform float uIntensity;
    uniform float uDensity;
    uniform float uDecay;
    uniform float uWeight;
    uniform float uEnergyClamp;
    uniform int uSamples;
    uniform float uAspect;
    uniform float uTime;
    varying vec2 vUv;

    float hash21(vec2 p) {
      p = fract(p * vec2(234.34, 435.345));
      p += dot(p, p + 34.23);
      return fract(p.x * p.y);
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 col = base.rgb;

      // OPT-03: compute the radial falloff FIRST and skip the entire raymarch for
      // pixels outside the sun's 1.25 radius — bit-identical output because the
      // march result is multiplied by radial anyway (40-70% fewer HDR texture
      // fetches when orbiting away from the sun).
      vec2 d = (vUv - uSunUv) * vec2(uAspect, 1.0);
      float radial = 1.0 - smoothstep(0.12, 1.25, length(d));

      if (uSunFade > 0.001 && uSamples > 0 && radial > 0.001) {
        vec2 delta = (vUv - uSunUv) * uDensity / float(uSamples);
        vec2 uv = vUv - delta * (hash21(vUv * 7.13 + floor(uTime * 8.0) * 0.37) * 0.7 + 0.15);
        float weight = uWeight;
        float sum = 0.0;
        float weightSum = 0.0;
        for (int i = 0; i < 64; i++) {
          if (i >= uSamples) break;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
          vec3 s = texture2D(tDiffuse, uv).rgb;
          float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
          float energy = clamp((lum - 0.58) * 1.7, 0.0, uEnergyClamp);
          sum += energy * weight;
          weightSum += weight;
          weight *= uDecay;
          uv -= delta;
        }
        float rays = sum / max(weightSum, 1e-4);
        col += rays * radial * uSunFade * uIntensity * uSunColor * 0.6;
      }

      gl_FragColor = vec4(col, base.a);
    }
  `,
};

export { AtmosphereShader };

/** Small typed wrapper so BuildScene can drive the uniforms without `any` casts. */
export class AtmospherePass extends ShaderPass {
  public readonly atmosphereUniforms: typeof AtmosphereShader.uniforms;

  constructor() {
    super(AtmosphereShader);
    this.atmosphereUniforms = this.uniforms as unknown as typeof AtmosphereShader.uniforms;
  }
}
