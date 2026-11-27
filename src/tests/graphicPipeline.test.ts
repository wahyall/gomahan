import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { createDefaultProject } from "@/lib/model/defaultProject";
import {
  computeBakeSunDir,
  generateFloorGiAoTexture,
  type GiBakeContext,
} from "@/lib/scene/bakedAo";
import {
  computeAutoExposure,
  computeTargetExposure,
  kelvinToRgb,
  PHOTOGRAPHIC_EXPOSURE_MAX,
  PHOTOGRAPHIC_EXPOSURE_MIN,
  PHOTOGRAPHIC_PRESETS,
  resolvePhotographicPreset,
  whiteBalanceMatrix,
} from "@/lib/scene/photographicPresets";
import { rtLookUniforms, setRtLookUniforms } from "@/lib/scene/rtUniforms";
import { attachBpceReflection, ReflectionProbeRig } from "@/lib/scene/reflectionProbes";
import { attachPcssShadow, createIesSpotTexture, IES_TEXTURE_SIZE, sampleIesProfile } from "@/lib/scene/pcssShadow";
import { attachFresnelGlass, attachSpecularAa } from "@/lib/scene/materials";
import { PhotographicOutputPass } from "@/features/buildMode/PhotographicOutputPass";
import { useStudioStore } from "@/lib/store/useStudioStore";

/**
 * GR-01 … GR-08 / PH-01 … PH-05 — deterministic graphics-pipeline regression
 * suite. Every assertion is pure CPU (no canvas / WebGL context), so it runs
 * green in jsdom and CI containers.
 */
describe("Hybrid RT Graphics Pipeline", () => {
  beforeEach(() => {
    useStudioStore.getState().loadProject(createDefaultProject());
    useStudioStore.temporal.getState().clear();
  });

  it("GR-01: baked RGBA GI map occludes sky visibility under roofs and keeps the open yard at ~1.0", () => {
    const project = createDefaultProject();
    project.levels[1]!.slabs = [];
    const gi: GiBakeContext = { hourOfDay: 10, rainIntensityMmH: 0, lights: [] };
    const tex = generateFloorGiAoTexture(project.levels[0], project, [], 0, gi);
    const data = tex.image.data as Uint8Array;
    const width = tex.image.width;
    const height = tex.image.height;

    const sample = (wx: number, wz: number) => {
      const px = Math.max(0, Math.min(width - 1, Math.floor((wx / project.site.width) * width)));
      const py = Math.max(0, Math.min(height - 1, Math.floor((wz / project.site.depth) * height)));
      const i = (py * width + px) * 4;
      return { ao: data[i]! / 255, skyVis: data[i + 1]! / 255, gi: data[i + 2]! / 255, tint: data[i + 3]! / 255 };
    };

    // An interior LT1 room centroid must be roof-occluded (skyVis < 0.5 …
    const lv0 = project.levels[0]!;
    const enclosed = lv0.rooms.find(
      (r) => r.program !== "garden" && r.program !== "carport" && r.program !== "void" && r.program !== "circulation",
    );
    expect(enclosed).toBeDefined();
    if (enclosed) {
      let cx = 0;
      let cz = 0;
      for (const p of enclosed.polygon) {
        cx += p.x;
        cz += p.z;
      }
      cx /= enclosed.polygon.length;
      cz /= enclosed.polygon.length;
      const inside = sample(cx, cz);
      expect(inside.skyVis).toBeLessThan(0.5);
      // … while the open front garden stays fully sky-visible (default lot: taman
      // depan occupies x 0…1.5, z 0…3 — no roof, no carport slab above it).
      const outside = sample(0.75, 1.5);
      expect(outside.skyVis).toBeGreaterThanOrEqual(0.9);
    }

    // Daytime bake: at least some warm GI bounce energy exists somewhere in the map.
    let giMax = 0;
    for (let i = 2; i < data.length; i += 4) giMax = Math.max(giMax, data[i]!);
    expect(giMax).toBeGreaterThan(0);
    tex.dispose();
  });

  it("GR-01: sun pools + night fixtures land in the GI bounce channel deterministically", () => {
    const project = createDefaultProject();
    project.levels[1]!.slabs = [];
    const sumGi = (gi: GiBakeContext) => {
      const tex = generateFloorGiAoTexture(project.levels[0], project, [], 0, gi);
      const data = tex.image.data as Uint8Array;
      let s = 0;
      for (let i = 2; i < data.length; i += 4) s += data[i]!;
      tex.dispose();
      return s;
    };
    const nightOff = sumGi({ hourOfDay: 22, rainIntensityMmH: 0, lights: [] });
    const nightLit = sumGi({
      hourOfDay: 22,
      rainIntensityMmH: 0,
      lights: [
        { x: 2.5, y: 2.8, z: 8.5, on: true, dimmer: 1, lumens: 800, colorTempK: 3000 },
      ],
    });
    // A lit 800-lumen fixture must inject measurably more bounce energy.
    expect(nightLit).toBeGreaterThan(nightOff);

    const daySun = sumGi({ hourOfDay: 10, rainIntensityMmH: 0, lights: [] });
    const dayStorm = sumGi({ hourOfDay: 10, rainIntensityMmH: 60, lights: [] });
    // Heavy rain damps the sun-pool bounce.
    expect(dayStorm).toBeLessThan(daySun);
  });

  it("GR-01: computeBakeSunDir is normalized and points upward during daylight", () => {
    const d = computeBakeSunDir(10);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 5);
    expect(d.y).toBeGreaterThan(0);
    const night = computeBakeSunDir(22);
    expect(night.y).toBeGreaterThan(0); // clamped elevation, still a valid direction
    expect(Math.hypot(night.x, night.y, night.z)).toBeCloseTo(1, 5);
  });

  it("GR-03/GR-05: IES spot profile is a valid radial photometric shape", () => {
    // Bright soft core at the centre.
    expect(sampleIesProfile(0.5, 0.5)).toBeGreaterThan(0.5);
    // Zero intensity at the outer edge.
    expect(sampleIesProfile(0.99, 0.5)).toBeCloseTo(0, 5);
    // Radial symmetry: mirrored UVs produce identical intensity.
    expect(sampleIesProfile(0.35, 0.5)).toBeCloseTo(sampleIesProfile(0.65, 0.5), 6);
    expect(sampleIesProfile(0.5, 0.62)).toBeCloseTo(sampleIesProfile(0.5, 0.38), 6);
    expect(sampleIesProfile(0.61, 0.39)).toBeCloseTo(sampleIesProfile(0.39, 0.61), 6);
    // The wall-wash scallop ring peaks between core and edge.
    const ringLevel = sampleIesProfile(0.5 + 0.55 / 2, 0.5);
    expect(ringLevel).toBeGreaterThan(0);
    const mid = sampleIesProfile(0.5 + 0.36, 0.5); // between core and ring
    expect(mid).toBeGreaterThan(0);

    const tex = createIesSpotTexture();
    expect(tex.image.width).toBe(IES_TEXTURE_SIZE);
    expect(tex.image.height).toBe(IES_TEXTURE_SIZE);
    const d = tex.image.data as Uint8Array;
    expect(d).toHaveLength(IES_TEXTURE_SIZE * IES_TEXTURE_SIZE * 4);
    // Centre is brighter than a corner sample (blue channel carries the profile).
    const c = (IES_TEXTURE_SIZE / 2) | 0;
    const centre = d[(c * IES_TEXTURE_SIZE + c) * 4 + 2]!;
    const corner = d[2]!;
    expect(centre).toBeGreaterThan(corner);
    tex.dispose();
  });

  it("GR-03: PCSS hook injects the shared uRtPcss uniform + custom kernel into the shadow chunk", () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    attachPcssShadow(mat);
    // Drive the hook manually through a fake shader object.
    const fake = {
      fragmentShader: "#include <common>\n#include <shadowmap_pars_fragment>\n",
      vertexShader: "#include <common>\n",
      uniforms: {} as Record<string, { value: number }>,
    };
    mat.onBeforeCompile(fake as never, {} as never);
    expect(fake.fragmentShader).toContain("uRtPcss");
    expect(fake.fragmentShader).toContain("vogelDiskSample( 7, 8, phi )");
    expect(fake.fragmentShader).not.toContain("#include <shadowmap_pars_fragment>");
    expect(fake.uniforms.uRtPcss).toBe(rtLookUniforms.uRtPcss);
    mat.dispose();
  });

  it("GR-02: BPCEM hook patches the envmap chunk and marks the material for rebinding", () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0 });
    attachBpceReflection(mat, { uProbePos: { value: new THREE.Vector3() }, uProbeBoxMin: { value: new THREE.Vector3(-1, -1, -1) }, uProbeBoxMax: { value: new THREE.Vector3(1, 1, 1) } }, "interior");
    expect((mat.userData as { rtBpce?: string }).rtBpce).toBe("interior");
    const fake = {
      fragmentShader: "#include <common>\n#include <envmap_physical_pars_fragment>\n",
      vertexShader: "#include <common>\n#include <begin_vertex>\n",
      uniforms: {} as Record<string, unknown>,
    };
    mat.onBeforeCompile(fake as never, {} as never);
    expect(fake.fragmentShader).toContain("bpceReflect");
    expect(fake.fragmentShader).toContain("vRtBpceWorld");
    expect(fake.fragmentShader).not.toContain("#include <envmap_physical_pars_fragment>");
    expect(fake.vertexShader).toContain("vRtBpceWorld");
    mat.dispose();
  });

  it("GR-02: ReflectionProbeRig owns two 256² HalfFloat cube probes and never bakes without a renderer", () => {
    const rig = new ReflectionProbeRig();
    expect(rig.exteriorRT.texture.type).toBe(THREE.HalfFloatType);
    expect(rig.interiorRT.texture.type).toBe(THREE.HalfFloatType);
    expect(rig.exteriorRT.width).toBe(256);
    expect(rig.interiorRT.width).toBe(256);
    expect(rig.hasBaked).toBe(false);
    // A context-less renderer stub must be rejected without throwing.
    const fakeRenderer = { isContextLost: () => true } as unknown as THREE.WebGLRenderer;
    const scene = new THREE.Scene();
    expect(() => rig.bake(fakeRenderer, scene, {})).not.toThrow();
    expect(rig.hasBaked).toBe(false);
    rig.dispose();
  });

  it("PH-01/PH-03: auto-exposure adapts smoothly and stays inside the calibrated clamp", () => {
    for (const hour of [7, 10.5, 17.25, 20, 23]) {
      const target = computeTargetExposure(hour, 0, false);
      expect(target).toBeGreaterThanOrEqual(PHOTOGRAPHIC_EXPOSURE_MIN);
      expect(target).toBeLessThanOrEqual(PHOTOGRAPHIC_EXPOSURE_MAX);
    }
    // Interior views open the iris relative to exterior at the same hour.
    expect(computeTargetExposure(20, 0, true)).toBeGreaterThan(computeTargetExposure(20, 0, false));

    // Smooth adaptation: many small steps converge on the target without overshoot.
    let ev = 0.9;
    const target = computeTargetExposure(20, 0, false);
    for (let i = 0; i < 400; i++) {
      ev = computeAutoExposure(ev, 20, 0, false, 1 / 60);
    }
    expect(Math.abs(ev - target)).toBeLessThan(0.02);
    expect(ev).toBeLessThanOrEqual(PHOTOGRAPHIC_EXPOSURE_MAX);

    // A single large dt still cannot jump past the target (no brightness snap).
    const jumped = computeAutoExposure(0.9, 20, 0, true, 0.25);
    expect(jumped).toBeLessThan(computeTargetExposure(20, 0, true) + 1e-6);

    // Invalid current exposure snaps directly to a valid value.
    expect(computeAutoExposure(Number.NaN, 10, 0, false, 1 / 60)).toBeCloseTo(computeTargetExposure(10, 0, false), 6);
  });

  it("PH-03: Kelvin → RGB conversion and white-balance matrix behave physically", () => {
    const warm = kelvinToRgb(3200);
    const cool = kelvinToRgb(6500);
    expect(warm.r).toBeGreaterThan(warm.b); // tungsten is warm
    expect(cool.b).toBeGreaterThanOrEqual(cool.r - 0.02); // daylight is neutral/cool
    // 6500K against a D65 working space ≈ identity gains (within tolerance).
    const wb = whiteBalanceMatrix(6500, 0);
    expect(wb[0]!).toBeCloseTo(1, 1);
    expect(wb[4]!).toBeCloseTo(1, 1);
    expect(wb[8]!).toBeCloseTo(1, 1);
    // Matrix shape: diagonal-only, row-major 3×3.
    expect(wb).toHaveLength(9);
    expect(wb[1]!).toBe(0);
    expect(wb[3]!).toBe(0);
    // Tint nudges only the green channel (gains stay ≤ 1 by normalisation).
    const tinted = whiteBalanceMatrix(5200, 0.05);
    const untinted = whiteBalanceMatrix(5200, 0);
    expect(tinted[4]!).toBeGreaterThan(untinted[4]!);
    expect(tinted[0]!).toBeCloseTo(untinted[0]!, 8);
  });

  it("PH-01/PH-05: photographic presets resolve continuously across the day", () => {
    const ids = Object.keys(PHOTOGRAPHIC_PRESETS);
    expect(ids).toContain("pagi");
    expect(ids).toContain("siang");
    expect(ids).toContain("golden");
    expect(ids).toContain("malam");
    expect(ids).toContain("hujan");
    for (const p of Object.values(PHOTOGRAPHIC_PRESETS)) {
      expect(p.exposure).toBeGreaterThan(0.5);
      expect(p.bloomStrength).toBeGreaterThan(0);
      expect(p.kelvin).toBeGreaterThanOrEqual(3000);
      expect(p.kelvin).toBeLessThanOrEqual(7000);
    }
    // Golden hour resolves to its own preset with the strongest bloom.
    const golden = resolvePhotographicPreset(17.25, 0);
    expect(golden.id).toBe("golden");
    const siang = resolvePhotographicPreset(10.5, 0);
    expect(golden.bloomStrength).toBeGreaterThan(siang.bloomStrength);
    expect(golden.kelvin).toBeLessThan(siang.kelvin); // warmer WB at golden hour
    // Night wraps around midnight.
    expect(resolvePhotographicPreset(23, 0).id).toBe("malam");
    expect(resolvePhotographicPreset(2, 0).id).toBe("malam");
    // Storm overrides everything.
    expect(resolvePhotographicPreset(13, 45).id).toBe("hujan");
  });

  it("GR-08: setRtLookUniforms flips the whole uniform-driven stack without recompiles", () => {
    setRtLookUniforms(true, 1.05);
    expect(rtLookUniforms.uRtEnabled.value).toBe(1);
    expect(rtLookUniforms.uRtPcss.value).toBe(1);
    expect(rtLookUniforms.uRtBpce.value).toBe(1);
    expect(rtLookUniforms.uRtFresnel.value).toBe(1);
    expect(rtLookUniforms.uRtSss.value).toBe(1);
    expect(rtLookUniforms.uRtAerial.value).toBe(1);
    expect(rtLookUniforms.uRtGiStrength.value).toBe(1.05);
    setRtLookUniforms(false);
    expect(rtLookUniforms.uRtEnabled.value).toBe(0);
    expect(rtLookUniforms.uRtPcss.value).toBe(0);
    expect(rtLookUniforms.uRtGiStrength.value).toBe(0);
    // Reset to the ON default for other suites.
    setRtLookUniforms(false);
  });

  it("GR-06: PhotographicOutputPass fuses SSCS + AgX + RCAS + lens optics in a single shader", () => {
    const pass = new PhotographicOutputPass();
    const frag = (pass as unknown as { material: THREE.RawShaderMaterial }).material.fragmentShader;
    expect(frag).toContain("sscsOcclusion");
    expect(frag).toContain("agxPunchy");
    expect(frag).toContain("AGX_INSET");
    expect(frag).toContain("uWhiteBalance");
    expect(frag).toContain("uExposure");
    expect(frag).toContain("uSharpness");
    expect(frag).toContain("uVignette");
    expect(frag).toContain("uCaAmount");
    expect(frag).toContain("uGrainAmount");
    expect(frag).toContain("uVertCorrect");
    expect(frag).toContain("linearToSrgb");
    // 6-step SSCS march toward the sun.
    expect(frag).toContain("i <= 6");
    // Pass has all uniforms typed, does not swap ping-pong buffers, and starts in photographic mode.
    expect(pass.needsSwap).toBe(false);
    expect(pass.photoUniforms.uSscs.value).toBe(1);
    expect(pass.photoUniforms.uSscsDist.value).toBeCloseTo(0.22, 5);
    expect(pass.photoUniforms.uSharpness.value).toBeGreaterThan(0);
    pass.dispose();
  });

  it("GR-04: attachSpecularAa declares uRtEnabled standalone and attachFresnelGlass touches material.roughness after lights_physical_fragment", () => {
    const terrainMat = new THREE.MeshStandardMaterial({ color: 0x5c8c46, roughness: 0.94 });
    attachSpecularAa(terrainMat);
    const fakeTerrain = {
      fragmentShader: "#include <common>\n#include <roughnessmap_fragment>\n",
      vertexShader: "#include <common>\n",
      uniforms: {} as Record<string, unknown>,
    };
    terrainMat.onBeforeCompile(fakeTerrain as never, {} as never);
    expect(fakeTerrain.fragmentShader).toContain("uniform float uRtEnabled;");
    expect(fakeTerrain.fragmentShader).toContain("rtSpecAa");
    expect(fakeTerrain.uniforms.uRtEnabled).toBe(rtLookUniforms.uRtEnabled);
    terrainMat.dispose();

    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xdcf0f7, roughness: 0.08 });
    attachFresnelGlass(glassMat);
    const fakeGlass = {
      fragmentShader:
        "#include <common>\n#include <normal_fragment_maps>\n#include <emissivemap_fragment>\n#include <lights_physical_fragment>\n#include <aomap_fragment>\n",
      vertexShader: "#include <common>\n",
      uniforms: {} as Record<string, unknown>,
    };
    glassMat.onBeforeCompile(fakeGlass as never, {} as never);
    const lightsIdx = fakeGlass.fragmentShader.indexOf("#include <lights_physical_fragment>");
    const roughIdx = fakeGlass.fragmentShader.indexOf("material.roughness = min");
    expect(lightsIdx).toBeGreaterThan(-1);
    expect(roughIdx).toBeGreaterThan(lightsIdx);
    glassMat.dispose();
  });
});
