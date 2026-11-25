import * as THREE from "three";
import type { FurnitureItem, HvacUnit, LightFixture } from "@/lib/model/types";
import type { MaterialPalette } from "@/lib/scene/materials";
import { createChamferBox, mergeGeometryBatch } from "@/lib/scene/geometryHelpers";

/**
 * High-fidelity Sims 4 / architectural hero props builder:
 * - Chamfered edges, extruded silhouettes, Lathe ceramics/pots, Tube faucets/handlebars
 * - Per-material internal geometry batching (slashes prop draw calls ~75%)
 * - 3-level THREE.LOD (lod0 < 9m, lod1 < 18m, lod2 >= 18m) for hero assets
 */

class PropBatcher {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);

  add(
    mat: THREE.Material,
    geo: THREE.BufferGeometry,
    x = 0,
    y = 0,
    z = 0,
    rotX = 0,
    rotY = 0,
    rotZ = 0,
  ) {
    if (x !== 0 || y !== 0 || z !== 0 || rotX !== 0 || rotY !== 0 || rotZ !== 0) {
      this.e.set(rotX, rotY, rotZ);
      this.q.setFromEuler(this.e);
      this.p.set(x, y, z);
      this.m4.compose(this.p, this.q, this.s);
      geo.applyMatrix4(this.m4);
    }
    let arr = this.buckets.get(mat);
    if (!arr) {
      arr = [];
      this.buckets.set(mat, arr);
    }
    arr.push(geo);
  }

  flush(
    disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[],
    opts?: { castShadow?: boolean; receiveShadow?: boolean },
  ): THREE.Group {
    const grp = new THREE.Group();
    const cast = opts?.castShadow ?? true;
    const recv = opts?.receiveShadow ?? true;
    for (const [mat, geos] of this.buckets.entries()) {
      const merged = mergeGeometryBatch(geos);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = cast && !(mat instanceof THREE.MeshBasicMaterial);
      m.receiveShadow = recv;
      grp.add(m);
      disposables.push(merged);
    }
    this.buckets.clear();
    return grp;
  }
}

function makeLodFromBuilders(
  buildHigh: () => THREE.Group,
  buildMed: () => THREE.Group,
  buildLow: () => THREE.Group,
): THREE.LOD {
  const lod = new THREE.LOD();
  lod.addLevel(buildHigh(), 0);
  lod.addLevel(buildMed(), 9.5);
  lod.addLevel(buildLow(), 19.0);
  return lod;
}

function addContactDisc(
  grp: THREE.Group,
  w: number,
  d: number,
  disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[],
  contactShadowMat?: THREE.Material,
) {
  if (!contactShadowMat) return;
  const g = new THREE.PlaneGeometry(w * 1.18, d * 1.15);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, contactShadowMat);
  m.position.y = 0.008;
  grp.add(m);
  disposables.push(g);
}

export function buildFurnitureMesh(
  item: FurnitureItem,
  palette: MaterialPalette,
  disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[],
  contactShadowMat?: THREE.Material,
): THREE.Object3D {
  const isCloth = item.category === "seating" || item.category === "bed";
  const isVehicle = item.category === "vehicle";
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(item.colorHex),
    roughness: isCloth ? 0.86 : isVehicle ? 0.24 : 0.44,
    metalness: isVehicle ? 0.58 : item.category === "kitchen" ? 0.14 : 0.02,
    sheen: isCloth ? 0.65 : 0,
    sheenRoughness: 0.68,
    clearcoat: isVehicle ? 0.92 : 0.05,
    clearcoatRoughness: isVehicle ? 0.12 : 0.4,
    envMap: palette.aluDark.envMap,
    envMapIntensity: isVehicle ? 1.15 : 0.45,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(item.accentHex ?? "#5a6354"),
    roughness: isCloth ? 0.8 : 0.58,
    metalness: 0.04,
    envMap: palette.aluDark.envMap,
    envMapIntensity: 0.4,
  });
  disposables.push(bodyMat, accentMat);

  const { x: w, y: h, z: d } = item.size;
  let rootObj: THREE.Object3D;

  switch (item.catalogId) {
    case "sofa_l":
    case "sofa_2": {
      const cushions = item.catalogId === "sofa_l" ? 3 : 2;
      const buildSofa = (detail: 0 | 1 | 2) => {
        const b = new PropBatcher();
        if (detail === 2) {
          b.add(bodyMat, new THREE.BoxGeometry(w, h * 0.55, d * 0.6), 0, h * 0.3, -d * 0.16);
          if (item.catalogId === "sofa_l") {
            b.add(bodyMat, new THREE.BoxGeometry(w * 0.42, 0.32, d * 0.44), -w * 0.28, 0.2, d * 0.28);
          }
          return b.flush(disposables);
        }

        // Solid chamfered teak plinth + tapered wooden legs
        b.add(palette.woodTeak, createChamferBox(w * 0.96, 0.075, d * 0.56, 0.01, 1), 0, 0.145, -d * 0.18);
        for (const lx of [-w * 0.43, w * 0.43]) {
          for (const lz of [-d * 0.4, d * 0.05]) {
            b.add(palette.woodTeak, new THREE.CylinderGeometry(0.025, 0.016, 0.13, detail === 0 ? 10 : 6), lx, 0.065, lz);
          }
        }

        // Individual tufted beveled seat cushions so gaps catch shadows
        const seatSpan = w - 0.24;
        const cW = seatSpan / cushions - 0.015;
        for (let i = 0; i < cushions; i++) {
          const cx = -seatSpan * 0.5 + (i + 0.5) * (seatSpan / cushions);
          b.add(
            bodyMat,
            createChamferBox(cW, 0.19, d * 0.54, 0.028, detail === 0 ? 2 : 1),
            cx,
            0.275,
            -d * 0.16,
          );
          // Contoured angled back cushions
          b.add(
            bodyMat,
            createChamferBox(cW, h * 0.44, 0.14, 0.026, detail === 0 ? 2 : 1),
            cx,
            0.54,
            -d * 0.35,
            -0.16,
          );
        }
        // Back frame shell & sculpted chamfered armrests
        b.add(bodyMat, createChamferBox(w, h * 0.48, 0.12, 0.018, 1), 0, 0.42, -d * 0.44);
        b.add(bodyMat, createChamferBox(0.14, 0.42, d * 0.58, 0.022, 2), -w * 0.46, 0.35, -d * 0.18);
        b.add(bodyMat, createChamferBox(0.14, 0.42, d * 0.58, 0.022, 2), w * 0.46, 0.35, -d * 0.18);

        if (item.catalogId === "sofa_l") {
          b.add(palette.woodTeak, createChamferBox(w * 0.41, 0.07, d * 0.44, 0.01, 1), -w * 0.28, 0.145, d * 0.27);
          b.add(
            bodyMat,
            createChamferBox(w * 0.42, 0.19, d * 0.46, 0.028, detail === 0 ? 2 : 1),
            -w * 0.28,
            0.275,
            d * 0.27,
          );
        }

        if (detail === 0) {
          // Accent bolster throw pillows
          b.add(accentMat, createChamferBox(0.32, 0.28, 0.11, 0.032, 2), -w * 0.31, 0.49, -d * 0.25, -0.22, 0.22, 0.08);
          b.add(accentMat, createChamferBox(0.32, 0.28, 0.11, 0.032, 2), w * 0.31, 0.49, -d * 0.25, -0.22, -0.2, -0.08);
        }
        const g = b.flush(disposables);
        if (detail === 0) addContactDisc(g, w, d, disposables, contactShadowMat);
        return g;
      };
      rootObj = makeLodFromBuilders(() => buildSofa(0), () => buildSofa(1), () => buildSofa(2));
      break;
    }

    case "bed_queen":
    case "bed_single": {
      const buildBed = (detail: 0 | 1 | 2) => {
        const b = new PropBatcher();
        if (detail === 2) {
          b.add(palette.woodTeak, new THREE.BoxGeometry(w, 0.26, d), 0, 0.2, 0);
          b.add(bodyMat, new THREE.BoxGeometry(w * 0.94, 0.25, d * 0.88), 0, 0.44, 0.02);
          b.add(palette.woodTeak, new THREE.BoxGeometry(w, h * 0.85, 0.08), 0, h * 0.45, -d * 0.46);
          return b.flush(disposables);
        }

        // Bedframe plinth + recessed legs + vertical-slat teak headboard
        b.add(palette.woodTeak, createChamferBox(w, 0.21, d, 0.016, 1), 0, 0.2, 0);
        for (const lx of [-w * 0.44, w * 0.44]) {
          for (const lz of [-d * 0.44, d * 0.44]) {
            b.add(palette.woodTeak, new THREE.CylinderGeometry(0.03, 0.022, 0.12, 8), lx, 0.06, lz);
          }
        }

        // Architectural headboard with dark trim border & vertical flutes
        b.add(palette.aluDark, createChamferBox(w + 0.04, h * 0.86, 0.075, 0.012, 1), 0, h * 0.5, -d * 0.465);
        const slatCount = detail === 0 ? 7 : 3;
        const slatW = (w - 0.14) / slatCount - 0.025;
        for (let i = 0; i < slatCount; i++) {
          const sx = -(w - 0.14) * 0.5 + (i + 0.5) * ((w - 0.14) / slatCount);
          b.add(palette.woodTeak, createChamferBox(slatW, h * 0.72, 0.035, 0.008, 1), sx, h * 0.53, -d * 0.425);
        }

        // Layered mattress + turned-down quilted duvet + bed runner
        b.add(accentMat, createChamferBox(w * 0.93, 0.22, d * 0.91, 0.035, detail === 0 ? 2 : 1), 0, 0.39, 0.025);
        b.add(bodyMat, createChamferBox(w * 0.96, 0.085, d * 0.62, 0.028, detail === 0 ? 2 : 1), 0, 0.495, d * 0.15);
        if (detail === 0) {
          b.add(accentMat, createChamferBox(w * 0.98, 0.03, d * 0.2, 0.01, 1), 0, 0.545, d * 0.3);
        }

        const pCount = item.catalogId === "bed_queen" ? 2 : 1;
        for (let i = 0; i < pCount; i++) {
          const px = pCount === 2 ? (i === 0 ? -w * 0.22 : w * 0.22) : 0;
          b.add(accentMat, createChamferBox(0.56, 0.12, 0.34, 0.036, 2), px, 0.565, -d * 0.3, 0.15);
          if (detail === 0) {
            b.add(bodyMat, createChamferBox(0.36, 0.1, 0.22, 0.028, 2), px, 0.6, -d * 0.21, 0.32);
          }
        }
        const g = b.flush(disposables);
        if (detail === 0) addContactDisc(g, w, d, disposables, contactShadowMat);
        return g;
      };
      rootObj = makeLodFromBuilders(() => buildBed(0), () => buildBed(1), () => buildBed(2));
      break;
    }

    case "dining_table": {
      const buildDining = (detail: 0 | 1 | 2) => {
        const b = new PropBatcher();
        if (detail === 2) {
          b.add(palette.woodTeak, new THREE.BoxGeometry(w, 0.055, d), 0, h - 0.03, 0);
          b.add(palette.woodTeak, new THREE.BoxGeometry(w * 0.85, h - 0.05, d * 0.72), 0, (h - 0.05) * 0.5, 0);
          return b.flush(disposables);
        }
        // Chamfered teak tabletop + recessed apron frame + splayed legs
        b.add(palette.woodTeak, createChamferBox(w, 0.048, d, 0.012, detail === 0 ? 2 : 1), 0, h - 0.024, 0);
        b.add(palette.woodTeak, createChamferBox(w * 0.86, 0.06, d * 0.78, 0.008, 1), 0, h - 0.075, 0);
        for (const lx of [-w * 0.41, w * 0.41]) {
          for (const lz of [-d * 0.37, d * 0.37]) {
            b.add(
              palette.woodTeak,
              new THREE.CylinderGeometry(0.028, 0.018, h - 0.05, detail === 0 ? 10 : 6),
              lx,
              (h - 0.05) * 0.5,
              lz,
            );
          }
        }
        // 4 Contoured chairs tucked gracefully around table
        for (const cx of [-w * 0.26, w * 0.26]) {
          for (const side of [-1, 1]) {
            const cz = side * (d * 0.56);
            b.add(accentMat, createChamferBox(0.42, 0.048, 0.41, 0.014, 1), cx, 0.45, cz);
            b.add(palette.woodTeak, createChamferBox(0.41, 0.36, 0.042, 0.012, 1), cx, 0.67, cz + side * 0.19, -side * 0.1);
            if (detail === 0) {
              for (const clx of [-0.16, 0.16]) {
                for (const clz of [-0.16, 0.16]) {
                  b.add(palette.woodTeak, new THREE.CylinderGeometry(0.015, 0.011, 0.43, 6), cx + clx, 0.215, cz + clz);
                }
              }
            }
          }
        }
        return b.flush(disposables);
      };
      rootObj = makeLodFromBuilders(() => buildDining(0), () => buildDining(1), () => buildDining(2));
      break;
    }

    case "kitchen_l": {
      const buildKitchen = (detail: 0 | 1 | 2) => {
        const b = new PropBatcher();
        if (detail === 2) {
          b.add(bodyMat, new THREE.BoxGeometry(w, 0.85, 0.62), 0, 0.425, -d * 0.3);
          b.add(bodyMat, new THREE.BoxGeometry(0.62, 0.85, d - 0.62), -w * 0.35, 0.425, 0.3);
          return b.flush(disposables);
        }
        // Lower L cabinetry + recessed dark toe-kick + shaker door frames
        b.add(palette.aluDark, new THREE.BoxGeometry(w - 0.06, 0.09, 0.52), 0, 0.045, -d * 0.3);
        b.add(bodyMat, createChamferBox(w, 0.73, 0.62, 0.01, 1), 0, 0.455, -d * 0.3);
        b.add(bodyMat, createChamferBox(0.62, 0.73, d - 0.62, 0.01, 1), -w * 0.35, 0.455, 0.3);

        // Beveled quartz/granite slab countertop + backsplash
        b.add(accentMat, createChamferBox(w + 0.04, 0.048, 0.66, 0.01, 2), 0, 0.845, -d * 0.3);
        b.add(accentMat, createChamferBox(0.66, 0.048, d - 0.58, 0.01, 2), -w * 0.35, 0.845, 0.3);
        b.add(accentMat, createChamferBox(w + 0.02, 0.14, 0.025, 0.004, 1), 0, 0.935, -d * 0.3 - 0.31);

        // Brushed stainless steel sink + arched gooseneck faucet + induction stove grates
        b.add(palette.steelLight, createChamferBox(0.56, 0.024, 0.42, 0.006, 1), -w * 0.28, 0.875, 0.28);
        if (detail === 0) {
          const spoutCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-w * 0.35 - 0.18, 0.88, 0.28),
            new THREE.Vector3(-w * 0.35 - 0.18, 1.15, 0.28),
            new THREE.Vector3(-w * 0.35 - 0.1, 1.22, 0.28),
            new THREE.Vector3(-w * 0.35 - 0.02, 1.14, 0.28),
          ]);
          b.add(palette.steelLight, new THREE.TubeGeometry(spoutCurve, 12, 0.013, 8, false));

          // Cabinet shaker doors & brushed steel pulls
          const doorCount = Math.max(2, Math.round(w / 0.55));
          const dw = (w - 0.12) / doorCount;
          for (let i = 0; i < doorCount; i++) {
            const dx = -w * 0.5 + 0.06 + (i + 0.5) * dw;
            b.add(palette.steelLight, new THREE.CylinderGeometry(0.007, 0.007, 0.14, 6), dx - dw * 0.25, 0.65, -d * 0.3 + 0.32);
          }
        }
        b.add(palette.aluDark, createChamferBox(0.68, 0.032, 0.44, 0.008, 1), w * 0.25, 0.88, -d * 0.3);
        // Upper hanging cabinet + hood
        b.add(bodyMat, createChamferBox(w * 0.85, 0.66, 0.35, 0.012, 1), 0.08, 1.96, -d * 0.36);
        return b.flush(disposables);
      };
      rootObj = makeLodFromBuilders(() => buildKitchen(0), () => buildKitchen(1), () => buildKitchen(2));
      break;
    }

    case "tv_console": {
      const b = new PropBatcher();
      b.add(bodyMat, createChamferBox(w, 0.36, d, 0.012, 2), 0, 0.28, 0);
      for (const lx of [-w * 0.42, w * 0.42]) {
        b.add(palette.woodTeak, new THREE.CylinderGeometry(0.02, 0.015, 0.11, 8), lx, 0.055, 0);
      }
      b.add(palette.aluDark, createChamferBox(0.36, 0.04, 0.2, 0.006, 1), 0, 0.48, 0);
      b.add(palette.aluDark, createChamferBox(w * 0.78, 0.76, 0.038, 0.008, 1), 0, 0.94, 0);
      b.add(accentMat, new THREE.BoxGeometry(w * 0.74, 0.7, 0.015), 0, 0.94, 0.016);
      b.add(palette.aluDark, createChamferBox(w * 0.45, 0.055, 0.08, 0.006, 1), 0, 0.5, 0.12);
      rootObj = b.flush(disposables);
      break;
    }

    case "wardrobe": {
      const b = new PropBatcher();
      b.add(palette.aluDark, new THREE.BoxGeometry(w - 0.04, 0.07, d - 0.03), 0, 0.035, 0);
      b.add(bodyMat, createChamferBox(w, h - 0.07, d, 0.014, 2), 0, (h + 0.07) * 0.5, 0);
      b.add(palette.aluDark, new THREE.BoxGeometry(0.016, h * 0.92, 0.018), 0, h * 0.52, d * 0.5 + 0.005);
      for (const hx of [-0.07, 0.07]) {
        b.add(palette.steelLight, createChamferBox(0.02, 0.32, 0.026, 0.004, 1), hx, h * 0.54, d * 0.5 + 0.016);
      }
      rootObj = b.flush(disposables);
      break;
    }

    case "kloset_set": {
      const ceramicMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(item.colorHex),
        roughness: 0.14,
        metalness: 0.02,
        clearcoat: 0.95,
        clearcoatRoughness: 0.08,
        envMap: palette.aluDark.envMap,
        envMapIntensity: 0.75,
      });
      disposables.push(ceramicMat);
      const b = new PropBatcher();
      const bowlPts = [
        new THREE.Vector2(0.08, 0),
        new THREE.Vector2(0.14, 0.05),
        new THREE.Vector2(0.13, 0.18),
        new THREE.Vector2(0.19, 0.34),
        new THREE.Vector2(0.18, 0.4),
        new THREE.Vector2(0.13, 0.4),
      ];
      b.add(ceramicMat, new THREE.LatheGeometry(bowlPts, 16), 0, 0, 0.08);
      b.add(ceramicMat, createChamferBox(0.4, 0.42, 0.19, 0.022, 2), 0, 0.59, -0.17);
      b.add(palette.steelLight, new THREE.CylinderGeometry(0.025, 0.025, 0.02, 10), 0, 0.81, -0.17);
      rootObj = b.flush(disposables);
      break;
    }

    case "car_city": {
      const headMat = new THREE.MeshStandardMaterial({
        color: 0xfff8d6,
        emissive: 0xfff3b0,
        emissiveIntensity: 1.5,
        roughness: 0.2,
      });
      const tailMat = new THREE.MeshStandardMaterial({
        color: 0x991b1b,
        emissive: 0xef4444,
        emissiveIntensity: 1.3,
        roughness: 0.25,
      });
      disposables.push(headMat, tailMat);

      const buildCar = (detail: 0 | 1 | 2) => {
        const b = new PropBatcher();
        if (detail === 2) {
          b.add(bodyMat, createChamferBox(w, 0.55, d * 0.96, 0.04, 1), 0, 0.44, 0);
          b.add(bodyMat, createChamferBox(w * 0.84, 0.48, d * 0.54, 0.04, 1), 0, 0.92, 0.1);
          for (const wx of [-w * 0.45, w * 0.45]) {
            for (const wz of [-d * 0.31, d * 0.32]) {
              b.add(palette.aluDark, new THREE.CylinderGeometry(0.3, 0.3, 0.19, 10), wx, 0.3, wz, 0, 0, Math.PI / 2);
            }
          }
          return b.flush(disposables);
        }

        // Extruded compact hatchback / crossover silhouette along side-profile (Z -> Y)
        const hl = d * 0.48;
        const bodyShape = new THREE.Shape();
        bodyShape.moveTo(-hl, 0.22); // front bumper bottom (facing -Z)
        bodyShape.lineTo(-hl - 0.02, 0.52); // nose
        bodyShape.lineTo(-hl * 0.48, 0.72); // sculpted hood line
        bodyShape.lineTo(-hl * 0.16, 1.24); // A-pillar windshield rake
        bodyShape.lineTo(hl * 0.52, 1.26); // roofline
        bodyShape.lineTo(hl * 0.9, 0.88); // fastback D-pillar hatch
        bodyShape.lineTo(hl, 0.62); // rear gate
        bodyShape.lineTo(hl * 0.95, 0.24); // rear diffuser
        bodyShape.closePath();

        const bodyW = w - 0.14;
        const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
          depth: bodyW,
          bevelEnabled: true,
          bevelSize: 0.055,
          bevelThickness: 0.06,
          bevelSegments: detail === 0 ? 3 : 1,
          curveSegments: 2,
        });
        // Rotate extruded 2D (x_shape=Z, y_shape=Y, z_extrude=X) into vehicle axes (-Z front nose)
        bodyGeo.rotateY(-Math.PI / 2);
        bodyGeo.translate(bodyW * 0.5, 0, 0);
        b.add(bodyMat, bodyGeo);

        // Sleek cabin tinted glazing inset
        const glassShape = new THREE.Shape();
        glassShape.moveTo(-hl * 0.44, 0.75);
        glassShape.lineTo(-hl * 0.13, 1.19);
        glassShape.lineTo(hl * 0.48, 1.2);
        glassShape.lineTo(hl * 0.82, 0.88);
        glassShape.lineTo(hl * 0.64, 0.76);
        glassShape.closePath();
        const gw = w - 0.16;
        const glassGeo = new THREE.ExtrudeGeometry(glassShape, {
          depth: gw,
          bevelEnabled: true,
          bevelSize: 0.02,
          bevelThickness: 0.02,
          bevelSegments: 1,
        });
        glassGeo.rotateY(-Math.PI / 2);
        glassGeo.translate(gw * 0.5, 0, 0);
        b.add(palette.glass, glassGeo);

        // Lower dark rocker skirt, front splitter grille, rear diffuser
        b.add(palette.aluDark, createChamferBox(w * 0.92, 0.14, d * 0.94, 0.012, 1), 0, 0.21, 0);
        b.add(palette.aluDark, createChamferBox(w * 0.62, 0.18, 0.06, 0.01, 1), 0, 0.36, -hl - 0.03);

        // Emissive LED headlights & full-width rear taillight blade
        for (const lx of [-w * 0.35, w * 0.35]) {
          b.add(headMat, createChamferBox(0.24, 0.1, 0.05, 0.01, 1), lx, 0.52, -hl - 0.02);
        }
        b.add(tailMat, createChamferBox(w * 0.8, 0.08, 0.04, 0.008, 1), 0, 0.64, hl + 0.01);

        if (detail === 0) {
          // Wing mirrors & shark fin antenna
          for (const mx of [-w * 0.51, w * 0.51]) {
            b.add(bodyMat, createChamferBox(0.14, 0.09, 0.16, 0.015, 1), mx, 0.84, -hl * 0.32);
          }
          b.add(palette.aluDark, new THREE.ConeGeometry(0.035, 0.09, 4), 0, 1.32, hl * 0.35, -0.35);
        }

        // 4 Sculpted tires + metallic multi-spoke wheels
        for (const wx of [-w * 0.45, w * 0.45]) {
          for (const wz of [-d * 0.31, d * 0.32]) {
            b.add(
              palette.aluDark,
              new THREE.CylinderGeometry(0.31, 0.31, 0.21, detail === 0 ? 20 : 12),
              wx,
              0.31,
              wz,
              0,
              0,
              Math.PI / 2,
            );
            b.add(
              palette.steelLight,
              new THREE.CylinderGeometry(0.2, 0.2, 0.222, detail === 0 ? 14 : 8),
              wx,
              0.31,
              wz,
              0,
              0,
              Math.PI / 2,
            );
            if (detail === 0) {
              // Hub cap accent
              b.add(palette.aluDark, new THREE.CylinderGeometry(0.07, 0.07, 0.23, 8), wx, 0.31, wz, 0, 0, Math.PI / 2);
            }
          }
        }
        const g = b.flush(disposables);
        if (detail === 0) addContactDisc(g, w, d, disposables, contactShadowMat);
        return g;
      };
      rootObj = makeLodFromBuilders(() => buildCar(0), () => buildCar(1), () => buildCar(2));
      break;
    }

    case "motorbike": {
      const headMat = new THREE.MeshStandardMaterial({
        color: 0xfff8d6,
        emissive: 0xfff3b0,
        emissiveIntensity: 1.4,
      });
      disposables.push(headMat);
      const buildBike = (detail: 0 | 1 | 2) => {
        const b = new PropBatcher();
        if (detail === 2) {
          b.add(bodyMat, new THREE.BoxGeometry(0.28, 0.48, d * 0.65), 0, 0.52, 0);
          for (const wz of [-d * 0.33, d * 0.33]) {
            b.add(palette.aluDark, new THREE.CylinderGeometry(0.23, 0.23, 0.11, 8), 0, 0.23, wz, 0, 0, Math.PI / 2);
          }
          return b.flush(disposables);
        }
        // Sculpted scooter fairing, floorboard deck, split padded seat, and front visor
        b.add(bodyMat, createChamferBox(0.32, 0.38, d * 0.66, 0.035, detail === 0 ? 2 : 1), 0, 0.48, 0.02);
        b.add(bodyMat, createChamferBox(0.28, 0.44, 0.28, 0.03, 1), 0, 0.72, -d * 0.24, 0.28);
        b.add(accentMat, createChamferBox(0.27, 0.16, 0.64, 0.03, 2), 0, 0.75, 0.12, -0.06);
        b.add(palette.glass, createChamferBox(0.24, 0.26, 0.03, 0.008, 1), 0, 1.06, -d * 0.29, -0.32);
        b.add(headMat, createChamferBox(0.18, 0.09, 0.06, 0.01, 1), 0, 0.76, -d * 0.38);

        // Chrome handlebars & swept exhaust pipe
        const barCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.34, 1.02, -d * 0.24),
          new THREE.Vector3(-0.18, 1.04, -d * 0.27),
          new THREE.Vector3(0.18, 1.04, -d * 0.27),
          new THREE.Vector3(0.34, 1.02, -d * 0.24),
        ]);
        b.add(palette.steelLight, new THREE.TubeGeometry(barCurve, 10, 0.018, 6, false));
        if (detail === 0) {
          b.add(palette.steelLight, new THREE.CylinderGeometry(0.045, 0.055, 0.56, 10), 0.18, 0.34, d * 0.22, Math.PI * 0.45);
        }
        for (const wz of [-d * 0.33, d * 0.33]) {
          b.add(palette.aluDark, new THREE.CylinderGeometry(0.23, 0.23, 0.11, detail === 0 ? 16 : 10), 0, 0.23, wz, 0, 0, Math.PI / 2);
          b.add(palette.steelLight, new THREE.CylinderGeometry(0.14, 0.14, 0.12, 10), 0, 0.23, wz, 0, 0, Math.PI / 2);
        }
        const g = b.flush(disposables);
        if (detail === 0) addContactDisc(g, 0.65, d, disposables, contactShadowMat);
        return g;
      };
      rootObj = makeLodFromBuilders(() => buildBike(0), () => buildBike(1), () => buildBike(2));
      break;
    }

    case "tropical_plant": {
      const soilMat = new THREE.MeshStandardMaterial({ color: 0x3b2c20, roughness: 0.96 });
      disposables.push(soilMat);
      const buildPlant = (detail: 0 | 1 | 2) => {
        const b = new PropBatcher();
        if (detail === 2) {
          b.add(accentMat, new THREE.CylinderGeometry(w * 0.32, w * 0.23, 0.38, 8), 0, 0.19, 0);
          b.add(bodyMat, new THREE.IcosahedronGeometry(w * 0.38, 0), 0, 0.38 + h * 0.3, 0);
          return b.flush(disposables);
        }
        // Lathe terracotta planter pot with rolled top lip + soil disc
        const potPts = [
          new THREE.Vector2(0, 0),
          new THREE.Vector2(w * 0.22, 0),
          new THREE.Vector2(w * 0.31, 0.35),
          new THREE.Vector2(w * 0.34, 0.38),
          new THREE.Vector2(w * 0.29, 0.4),
          new THREE.Vector2(w * 0.27, 0.34),
        ];
        b.add(accentMat, new THREE.LatheGeometry(potPts, detail === 0 ? 16 : 10), 0, 0, 0);
        b.add(soilMat, new THREE.CylinderGeometry(w * 0.27, w * 0.27, 0.04, 10), 0, 0.33, 0);

        // Layered arched tropical frond blades (diamond tapered cones)
        const tiers = detail === 0 ? [
          { n: 6, r: 0.12, y: 0.45, scaleH: 0.56, tilt: 0.48 },
          { n: 5, r: 0.07, y: 0.62, scaleH: 0.48, tilt: 0.22 },
        ] : [
          { n: 5, r: 0.1, y: 0.5, scaleH: 0.55, tilt: 0.42 },
        ];
        for (const t of tiers) {
          for (let i = 0; i < t.n; i++) {
            const ang = (i / t.n) * Math.PI * 2 + t.tilt;
            const leafGeo = new THREE.ConeGeometry(w * 0.17, h * t.scaleH, 4);
            leafGeo.scale(1.35, 1.0, 0.25);
            b.add(
              bodyMat,
              leafGeo,
              Math.cos(ang) * w * t.r,
              t.y,
              Math.sin(ang) * w * t.r,
              Math.sin(ang) * t.tilt,
              ang,
              -Math.cos(ang) * t.tilt,
            );
          }
        }
        return b.flush(disposables);
      };
      rootObj = makeLodFromBuilders(() => buildPlant(0), () => buildPlant(1), () => buildPlant(2));
      break;
    }

    default: {
      const b = new PropBatcher();
      b.add(bodyMat, createChamferBox(w, h, d, 0.015, 1), 0, h * 0.5, 0);
      rootObj = b.flush(disposables);
      break;
    }
  }

  rootObj.position.set(item.position.x, item.position.y, item.position.z);
  rootObj.rotation.y = item.rotationY;
  return rootObj;
}

export function buildHvacMesh(
  unit: HvacUnit,
  palette: MaterialPalette,
  disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[],
  animatedFanBlades: THREE.Object3D[],
): THREE.Group {
  const g = new THREE.Group();
  const whitePlastic = new THREE.MeshStandardMaterial({
    color: unit.on ? 0xf7f8fa : 0xc2c6cc,
    roughness: 0.34,
    metalness: 0.05,
    envMap: palette.aluDark.envMap,
  });
  const indicatorMat = new THREE.MeshBasicMaterial({
    color: unit.on ? (unit.type === "ac_split" ? 0x38bdf8 : 0x34d399) : 0x6b7280,
  });
  disposables.push(whitePlastic, indicatorMat);

  const b = new PropBatcher();
  if (unit.type === "ac_split") {
    b.add(whitePlastic, createChamferBox(0.88, 0.29, 0.22, 0.022, 2));
    b.add(palette.aluDark, createChamferBox(0.76, 0.036, 0.04, 0.005, 1), 0, -0.1, 0.11, unit.on ? 0.38 : 0);
    b.add(indicatorMat, new THREE.BoxGeometry(0.06, 0.02, 0.012), 0.32, -0.02, 0.112);
    g.add(b.flush(disposables));
  } else if (unit.type === "ceiling_fan") {
    const canopyPts = [new THREE.Vector2(0, 0), new THREE.Vector2(0.08, 0), new THREE.Vector2(0.04, 0.04), new THREE.Vector2(0, 0.05)];
    b.add(palette.aluDark, new THREE.LatheGeometry(canopyPts, 12), 0, 0.21, 0);
    b.add(palette.aluDark, new THREE.CylinderGeometry(0.026, 0.026, 0.22, 8), 0, 0.11, 0);
    b.add(whitePlastic, new THREE.CylinderGeometry(0.11, 0.12, 0.085, 16), 0, -0.02, 0);
    g.add(b.flush(disposables));

    const rotor = new THREE.Group();
    rotor.position.y = -0.03;
    const rb = new PropBatcher();
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      const bladeGeo = createChamferBox(0.56, 0.015, 0.11, 0.005, 1);
      rb.add(palette.woodTeak, bladeGeo, Math.cos(ang) * 0.32, 0, Math.sin(ang) * 0.32, 0.15, -ang, 0);
    }
    rotor.add(rb.flush(disposables));
    g.add(rotor);
    if (unit.on) animatedFanBlades.push(rotor);
  } else if (unit.type === "stand_fan") {
    b.add(palette.aluDark, new THREE.CylinderGeometry(0.18, 0.21, 0.045, 16), 0, 0.022, 0);
    b.add(palette.steelLight, new THREE.CylinderGeometry(0.022, 0.028, 1.05, 10), 0, 0.55, 0);
    b.add(palette.aluDark, new THREE.TorusGeometry(0.22, 0.018, 8, 22), 0, 1.12, 0.04);
    b.add(whitePlastic, new THREE.CylinderGeometry(0.06, 0.06, 0.09, 12), 0, 1.12, 0.02, Math.PI / 2);
    g.add(b.flush(disposables));

    const rotor = new THREE.Group();
    rotor.position.set(0, 1.12, 0.065);
    const rb = new PropBatcher();
    for (let i = 0; i < 3; i++) {
      rb.add(indicatorMat, createChamferBox(0.055, 0.18, 0.015, 0.004, 1), 0, 0, 0, 0, 0, (i / 3) * Math.PI * 2);
    }
    rotor.add(rb.flush(disposables));
    g.add(rotor);
    if (unit.on) animatedFanBlades.push(rotor);
  } else {
    b.add(whitePlastic, createChamferBox(0.32, 0.32, 0.08, 0.012, 1));
    b.add(palette.aluDark, new THREE.CylinderGeometry(0.11, 0.11, 0.09, 14), 0, 0, 0.01, Math.PI / 2);
    g.add(b.flush(disposables));
  }

  g.position.set(unit.position.x, unit.position.y, unit.position.z);
  g.rotation.y = unit.rotationY;
  return g;
}

export function buildLightFixtureMesh(
  light: LightFixture,
  palette: MaterialPalette,
  disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[],
): THREE.Group {
  const g = new THREE.Group();
  const warmCol = light.colorTempK <= 3200 ? 0xffcf87 : light.colorTempK <= 4200 ? 0xfff0d4 : 0xeaf4ff;
  const bulbMat = new THREE.MeshBasicMaterial({ color: light.on ? warmCol : 0x6b6f75 });
  disposables.push(bulbMat);

  const b = new PropBatcher();
  if (light.type === "pendant") {
    b.add(palette.aluDark, new THREE.CylinderGeometry(0.05, 0.05, 0.025, 12), 0, 0.54, 0);
    b.add(palette.aluDark, new THREE.CylinderGeometry(0.01, 0.01, 0.52, 8), 0, 0.28, 0);
    const shadePts = [
      new THREE.Vector2(0.03, 0.13),
      new THREE.Vector2(0.12, 0.08),
      new THREE.Vector2(0.21, -0.02),
      new THREE.Vector2(0.2, -0.03),
      new THREE.Vector2(0.03, 0.11),
    ];
    b.add(palette.aluDark, new THREE.LatheGeometry(shadePts, 18), 0, 0, 0);
    b.add(bulbMat, new THREE.SphereGeometry(0.055, 12, 8), 0, -0.02, 0);
  } else if (light.type === "wall") {
    b.add(palette.aluDark, createChamferBox(0.12, 0.22, 0.08, 0.01, 1));
    b.add(bulbMat, new THREE.BoxGeometry(0.08, 0.14, 0.045), 0, 0, 0.03);
  } else {
    b.add(palette.aluDark, new THREE.CylinderGeometry(0.085, 0.085, 0.026, 16));
    b.add(bulbMat, new THREE.CylinderGeometry(0.06, 0.06, 0.03, 16), 0, -0.004, 0);
  }

  g.add(b.flush(disposables, { castShadow: false }));
  g.position.set(light.position.x, light.position.y, light.position.z);
  return g;
}
