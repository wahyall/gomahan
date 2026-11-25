import * as THREE from "three";
import type { FurnitureItem, HvacUnit, LightFixture } from "@/lib/model/types";
import type { MaterialPalette } from "@/lib/scene/materials";

/**
 * Multi-part Sims 4-inspired procedural 3D meshes with realistic bevel proportions,
 * distinct materials (wood/cloth/metal/glass), and animated fan blades.
 */

function addPart(
  group: THREE.Group,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[],
  rotX = 0,
  rotY = 0,
  rotZ = 0,
) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rotX, rotY, rotZ);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  disposables.push(geo);
  return m;
}

export function buildFurnitureMesh(
  item: FurnitureItem,
  palette: MaterialPalette,
  disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[],
): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(item.colorHex),
    roughness:
      item.category === "seating" || item.category === "bed" ? 0.88 : 0.45,
    metalness:
      item.category === "vehicle"
        ? 0.55
        : item.category === "kitchen"
          ? 0.15
          : 0.02,
    sheen: item.category === "seating" || item.category === "bed" ? 0.6 : 0,
    sheenRoughness: 0.7,
    clearcoat: item.category === "vehicle" ? 0.8 : 0.05,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(item.accentHex ?? "#5a6354"),
    roughness: 0.72,
    metalness: 0.05,
  });
  disposables.push(bodyMat, accentMat);

  const { x: w, y: h, z: d } = item.size;

  switch (item.catalogId) {
    case "sofa_l":
    case "sofa_2": {
      // Teak legs
      const legGeo = new THREE.CylinderGeometry(0.024, 0.018, 0.14, 8);
      for (const lx of [-w * 0.43, w * 0.43]) {
        for (const lz of [-d * 0.4, d * 0.4]) {
          addPart(
            g,
            legGeo.clone(),
            palette.woodTeak,
            lx,
            0.07,
            lz,
            disposables,
          );
        }
      }
      legGeo.dispose();
      // Main seat cushion
      addPart(
        g,
        new THREE.BoxGeometry(w, 0.28, d * 0.58),
        bodyMat,
        0,
        0.28,
        -d * 0.18,
        disposables,
      );
      // Backrest
      addPart(
        g,
        new THREE.BoxGeometry(w, h * 0.52, 0.16),
        bodyMat,
        0,
        0.52,
        -d * 0.42,
        disposables,
      );
      // Armrests
      addPart(
        g,
        new THREE.BoxGeometry(0.14, 0.42, d * 0.58),
        bodyMat,
        -w * 0.46,
        0.35,
        -d * 0.18,
        disposables,
      );
      addPart(
        g,
        new THREE.BoxGeometry(0.14, 0.42, d * 0.58),
        bodyMat,
        w * 0.46,
        0.35,
        -d * 0.18,
        disposables,
      );
      if (item.catalogId === "sofa_l") {
        // Chaise extension
        addPart(
          g,
          new THREE.BoxGeometry(w * 0.42, 0.28, d * 0.44),
          bodyMat,
          -w * 0.28,
          0.28,
          d * 0.28,
          disposables,
        );
      }
      // Throw pillows
      addPart(
        g,
        new THREE.BoxGeometry(0.32, 0.28, 0.12),
        accentMat,
        -w * 0.28,
        0.5,
        -d * 0.28,
        disposables,
        -0.15,
        0.15,
        0,
      );
      addPart(
        g,
        new THREE.BoxGeometry(0.32, 0.28, 0.12),
        accentMat,
        w * 0.28,
        0.5,
        -d * 0.28,
        disposables,
        -0.15,
        -0.12,
        0,
      );
      break;
    }
    case "bed_queen":
    case "bed_single": {
      // Teak frame & legs
      addPart(
        g,
        new THREE.BoxGeometry(w, 0.24, d),
        palette.woodTeak,
        0,
        0.18,
        0,
        disposables,
      );
      addPart(
        g,
        new THREE.BoxGeometry(w, h * 0.92, 0.08),
        palette.woodTeak,
        0,
        h * 0.5,
        -d * 0.46,
        disposables,
      );
      // Mattress + duvet
      addPart(
        g,
        new THREE.BoxGeometry(w * 0.94, 0.22, d * 0.92),
        accentMat,
        0,
        0.41,
        0.02,
        disposables,
      );
      addPart(
        g,
        new THREE.BoxGeometry(w * 0.97, 0.07, d * 0.58),
        bodyMat,
        0,
        0.52,
        d * 0.18,
        disposables,
      );
      // Pillows
      const pCount = item.catalogId === "bed_queen" ? 2 : 1;
      for (let i = 0; i < pCount; i++) {
        const px = pCount === 2 ? (i === 0 ? -w * 0.22 : w * 0.22) : 0;
        addPart(
          g,
          new THREE.BoxGeometry(0.55, 0.12, 0.34),
          accentMat,
          px,
          0.58,
          -d * 0.3,
          disposables,
          0.12,
        );
      }
      break;
    }
    case "dining_table": {
      addPart(
        g,
        new THREE.BoxGeometry(w, 0.05, d),
        palette.woodTeak,
        0,
        h - 0.025,
        0,
        disposables,
      );
      for (const lx of [-w * 0.42, w * 0.42]) {
        for (const lz of [-d * 0.38, d * 0.38]) {
          addPart(
            g,
            new THREE.BoxGeometry(0.06, h - 0.05, 0.06),
            palette.woodTeak,
            lx,
            (h - 0.05) / 2,
            lz,
            disposables,
          );
        }
      }
      // 4 Chairs tucked in
      for (const cx of [-w * 0.26, w * 0.26]) {
        for (const side of [-1, 1]) {
          addPart(
            g,
            new THREE.BoxGeometry(0.42, 0.05, 0.42),
            accentMat,
            cx,
            0.44,
            side * (d * 0.55),
            disposables,
          );
          addPart(
            g,
            new THREE.BoxGeometry(0.42, 0.42, 0.05),
            palette.woodTeak,
            cx,
            0.66,
            side * (d * 0.74),
            disposables,
          );
        }
      }
      break;
    }
    case "kitchen_l": {
      // Base cabinets L
      addPart(
        g,
        new THREE.BoxGeometry(w, 0.82, 0.62),
        bodyMat,
        0,
        0.41,
        -d * 0.3,
        disposables,
      );
      addPart(
        g,
        new THREE.BoxGeometry(0.62, 0.82, d - 0.62),
        bodyMat,
        -w * 0.35,
        0.41,
        0.3,
        disposables,
      );
      // Granite countertop
      addPart(
        g,
        new THREE.BoxGeometry(w + 0.04, 0.05, 0.66),
        accentMat,
        0,
        0.845,
        -d * 0.3,
        disposables,
      );
      addPart(
        g,
        new THREE.BoxGeometry(0.66, 0.05, d - 0.58),
        accentMat,
        -w * 0.35,
        0.845,
        0.3,
        disposables,
      );
      // Stainless sink & stove burners
      addPart(
        g,
        new THREE.BoxGeometry(0.55, 0.03, 0.42),
        palette.steelLight,
        -w * 0.28,
        0.875,
        0.28,
        disposables,
      );
      addPart(
        g,
        new THREE.BoxGeometry(0.68, 0.04, 0.44),
        palette.aluDark,
        w * 0.25,
        0.88,
        -d * 0.3,
        disposables,
      );
      // Upper hanging cabinet
      addPart(
        g,
        new THREE.BoxGeometry(w * 0.85, 0.65, 0.35),
        bodyMat,
        0.08,
        1.95,
        -d * 0.36,
        disposables,
      );
      break;
    }
    case "tv_console": {
      addPart(
        g,
        new THREE.BoxGeometry(w, 0.42, d),
        bodyMat,
        0,
        0.25,
        0,
        disposables,
      );
      addPart(
        g,
        new THREE.BoxGeometry(w * 0.76, 0.75, 0.04),
        accentMat,
        0,
        0.92,
        0,
        disposables,
      );
      addPart(
        g,
        new THREE.BoxGeometry(0.35, 0.14, 0.18),
        palette.aluDark,
        0,
        0.52,
        0,
        disposables,
      );
      break;
    }
    case "wardrobe": {
      addPart(
        g,
        new THREE.BoxGeometry(w, h, d),
        bodyMat,
        0,
        h / 2,
        0,
        disposables,
      );
      // Door seam lines & brass handles
      addPart(
        g,
        new THREE.BoxGeometry(0.015, h * 0.94, 0.02),
        palette.aluDark,
        0,
        h / 2,
        d / 2 + 0.005,
        disposables,
      );
      addPart(
        g,
        new THREE.BoxGeometry(0.025, 0.24, 0.025),
        palette.steelLight,
        -0.06,
        h * 0.52,
        d / 2 + 0.02,
        disposables,
      );
      addPart(
        g,
        new THREE.BoxGeometry(0.025, 0.24, 0.025),
        palette.steelLight,
        0.06,
        h * 0.52,
        d / 2 + 0.02,
        disposables,
      );
      break;
    }
    case "kloset_set": {
      addPart(
        g,
        new THREE.CylinderGeometry(0.18, 0.14, 0.38, 14),
        bodyMat,
        0,
        0.19,
        0.08,
        disposables,
      );
      addPart(
        g,
        new THREE.CylinderGeometry(0.2, 0.2, 0.04, 14),
        bodyMat,
        0,
        0.4,
        0.08,
        disposables,
      );
      addPart(
        g,
        new THREE.BoxGeometry(0.4, 0.42, 0.2),
        bodyMat,
        0,
        0.58,
        -0.18,
        disposables,
      );
      break;
    }
    case "car_city": {
      // Chassis + Cabin + 4 wheels
      addPart(
        g,
        new THREE.BoxGeometry(w, 0.52, d * 0.96),
        bodyMat,
        0,
        0.44,
        0,
        disposables,
      );
      addPart(
        g,
        new THREE.BoxGeometry(w * 0.86, 0.58, d * 0.54),
        bodyMat,
        0,
        0.96,
        0.12,
        disposables,
      );
      addPart(
        g,
        new THREE.BoxGeometry(w * 0.82, 0.46, d * 0.52),
        palette.glass,
        0,
        0.96,
        0.12,
        disposables,
      );
      const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 16);
      for (const wx of [-w * 0.46, w * 0.46]) {
        for (const wz of [-d * 0.3, d * 0.32]) {
          addPart(
            g,
            wheelGeo.clone(),
            palette.aluDark,
            wx,
            0.3,
            wz,
            disposables,
            0,
            0,
            Math.PI / 2,
          );
        }
      }
      wheelGeo.dispose();
      break;
    }
    case "motorbike": {
      addPart(
        g,
        new THREE.BoxGeometry(0.28, 0.45, d * 0.65),
        bodyMat,
        0,
        0.52,
        0,
        disposables,
      );
      addPart(
        g,
        new THREE.BoxGeometry(0.26, 0.22, 0.52),
        accentMat,
        0,
        0.78,
        0.1,
        disposables,
      );
      addPart(
        g,
        new THREE.BoxGeometry(0.66, 0.05, 0.06),
        palette.steelLight,
        0,
        1.0,
        -d * 0.28,
        disposables,
      );
      for (const wz of [-d * 0.33, d * 0.33]) {
        addPart(
          g,
          new THREE.CylinderGeometry(0.23, 0.23, 0.11, 14),
          palette.aluDark,
          0,
          0.23,
          wz,
          disposables,
          0,
          0,
          Math.PI / 2,
        );
      }
      break;
    }
    case "tropical_plant": {
      // Terracotta pot + soil + layered tropical palm/monstera leaves
      addPart(
        g,
        new THREE.CylinderGeometry(w * 0.32, w * 0.23, 0.38, 12),
        accentMat,
        0,
        0.19,
        0,
        disposables,
      );
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        const leafGeo = new THREE.ConeGeometry(w * 0.22, h * 0.65, 5);
        addPart(
          g,
          leafGeo,
          bodyMat,
          Math.cos(ang) * w * 0.18,
          0.38 + h * 0.3,
          Math.sin(ang) * w * 0.18,
          disposables,
          Math.sin(ang) * 0.45,
          ang,
          -Math.cos(ang) * 0.45,
        );
      }
      break;
    }
    default: {
      addPart(
        g,
        new THREE.BoxGeometry(w, h, d),
        bodyMat,
        0,
        h / 2,
        0,
        disposables,
      );
      break;
    }
  }

  g.position.set(item.position.x, item.position.y, item.position.z);
  g.rotation.y = item.rotationY;
  return g;
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
    roughness: 0.35,
    metalness: 0.05,
  });
  const indicatorMat = new THREE.MeshBasicMaterial({
    color: unit.on
      ? unit.type === "ac_split"
        ? 0x38bdf8
        : 0x34d399
      : 0x6b7280,
  });
  disposables.push(whitePlastic, indicatorMat);

  if (unit.type === "ac_split") {
    // Sleek wall-mounted split AC unit with louver flap & status LED
    addPart(
      g,
      new THREE.BoxGeometry(0.86, 0.28, 0.22),
      whitePlastic,
      0,
      0,
      0,
      disposables,
    );
    addPart(
      g,
      new THREE.BoxGeometry(0.76, 0.04, 0.04),
      palette.aluDark,
      0,
      -0.1,
      0.11,
      disposables,
      unit.on ? 0.35 : 0,
    );
    addPart(
      g,
      new THREE.BoxGeometry(0.06, 0.02, 0.01),
      indicatorMat,
      0.32,
      -0.02,
      0.115,
      disposables,
    );
  } else if (unit.type === "ceiling_fan") {
    addPart(
      g,
      new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10),
      palette.aluDark,
      0,
      0.1,
      0,
      disposables,
    );
    addPart(
      g,
      new THREE.CylinderGeometry(0.11, 0.11, 0.08, 14),
      whitePlastic,
      0,
      -0.02,
      0,
      disposables,
    );
    const rotor = new THREE.Group();
    rotor.position.y = -0.03;
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.56, 0.015, 0.11),
        palette.woodTeak,
      );
      blade.position.set(Math.cos(ang) * 0.32, 0, Math.sin(ang) * 0.32);
      blade.rotation.y = -ang;
      blade.rotation.x = 0.15;
      blade.castShadow = true;
      rotor.add(blade);
      disposables.push(blade.geometry);
    }
    g.add(rotor);
    if (unit.on) animatedFanBlades.push(rotor);
  } else if (unit.type === "stand_fan") {
    addPart(
      g,
      new THREE.CylinderGeometry(0.18, 0.2, 0.04, 14),
      palette.aluDark,
      0,
      0.02,
      0,
      disposables,
    );
    addPart(
      g,
      new THREE.CylinderGeometry(0.025, 0.025, 1.05, 8),
      palette.steelLight,
      0,
      0.55,
      0,
      disposables,
    );
    addPart(
      g,
      new THREE.CylinderGeometry(0.22, 0.22, 0.08, 16),
      palette.aluDark,
      0,
      1.12,
      0.04,
      disposables,
      Math.PI / 2,
    );
    const rotor = new THREE.Group();
    rotor.position.set(0, 1.12, 0.07);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.18, 0.015),
        indicatorMat,
      );
      b.rotation.z = (i / 3) * Math.PI * 2;
      rotor.add(b);
      disposables.push(b.geometry);
    }
    g.add(rotor);
    if (unit.on) animatedFanBlades.push(rotor);
  } else {
    // Exhaust fan
    addPart(
      g,
      new THREE.BoxGeometry(0.32, 0.32, 0.08),
      whitePlastic,
      0,
      0,
      0,
      disposables,
    );
    addPart(
      g,
      new THREE.CylinderGeometry(0.11, 0.11, 0.09, 14),
      palette.aluDark,
      0,
      0,
      0.01,
      disposables,
      Math.PI / 2,
    );
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
  const warmCol =
    light.colorTempK <= 3200
      ? 0xffcf87
      : light.colorTempK <= 4200
        ? 0xfff0d4
        : 0xeaf4ff;
  const bulbMat = new THREE.MeshBasicMaterial({
    color: light.on ? warmCol : 0x6b6f75,
  });
  disposables.push(bulbMat);

  if (light.type === "pendant") {
    addPart(
      g,
      new THREE.CylinderGeometry(0.012, 0.012, 0.55, 8),
      palette.aluDark,
      0,
      0.28,
      0,
      disposables,
    );
    addPart(
      g,
      new THREE.ConeGeometry(0.2, 0.18, 16),
      palette.aluDark,
      0,
      0.04,
      0,
      disposables,
    );
    addPart(
      g,
      new THREE.SphereGeometry(0.06, 12, 8),
      bulbMat,
      0,
      -0.02,
      0,
      disposables,
    );
  } else if (light.type === "wall") {
    addPart(
      g,
      new THREE.BoxGeometry(0.12, 0.22, 0.09),
      palette.aluDark,
      0,
      0,
      0,
      disposables,
    );
    addPart(
      g,
      new THREE.BoxGeometry(0.08, 0.14, 0.05),
      bulbMat,
      0,
      0,
      0.03,
      disposables,
    );
  } else {
    addPart(
      g,
      new THREE.CylinderGeometry(0.08, 0.08, 0.03, 14),
      palette.aluDark,
      0,
      0,
      0,
      disposables,
    );
    addPart(
      g,
      new THREE.CylinderGeometry(0.06, 0.06, 0.035, 14),
      bulbMat,
      0,
      -0.005,
      0,
      disposables,
    );
  }

  g.position.set(light.position.x, light.position.y, light.position.z);
  return g;
}
