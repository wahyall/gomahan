import type { Level, MepPoint, Project, Vec3 } from "@/lib/model/types";

export type CanonicalMepRouteKind =
  | "air_bersih"
  | "air_kotor"
  | "air_hujan"
  | "listrik_lampu"
  | "listrik_kontak"
  | "listrik_ac";

export interface CanonicalMepRoute {
  id: string;
  kind: CanonicalMepRouteKind;
  label: string;
  pts: Vec3[];
}

export interface CanonicalMepSymbol {
  id: string;
  levelIndex: 0 | 1;
  kind:
    | "meter_air"
    | "panel_mcb"
    | "bio_septic"
    | "sumur_resapan"
    | "downspout"
    | "kloset"
    | "sink"
    | "stopkontak"
    | "lampu"
    | "ac_split";
  label: string;
  x: number;
  y: number;
  z: number;
}

export interface CanonicalMepNetwork {
  routesByLevel: [CanonicalMepRoute[], CanonicalMepRoute[]];
  symbolsByLevel: [CanonicalMepSymbol[], CanonicalMepSymbol[]];
}

function roundCm(v: number): number {
  return Math.round(v * 100) / 100;
}

function ptEq(a: Vec3, b: Vec3): boolean {
  return Math.abs(a.x - b.x) < 0.005 && Math.abs(a.y - b.y) < 0.005 && Math.abs(a.z - b.z) < 0.005;
}

function pushUnique(pts: Vec3[], next: Vec3) {
  const clean: Vec3 = { x: roundCm(next.x), y: roundCm(next.y), z: roundCm(next.z) };
  const prev = pts[pts.length - 1];
  if (!prev || !ptEq(prev, clean)) pts.push(clean);
}

/**
 * Connects two 3D points strictly via axis-aligned segments (never diagonal in XZ or XYZ).
 */
export function buildOrthoPath3D(from: Vec3, to: Vec3, xFirst = false, riseFirst = false): Vec3[] {
  const pts: Vec3[] = [];
  pushUnique(pts, from);

  let cur: Vec3 = { ...pts[0]! };
  if (riseFirst && Math.abs(to.y - cur.y) >= 0.005) {
    cur = { x: cur.x, y: to.y, z: cur.z };
    pushUnique(pts, cur);
  }

  if (xFirst) {
    if (Math.abs(to.x - cur.x) >= 0.005) {
      cur = { x: to.x, y: cur.y, z: cur.z };
      pushUnique(pts, cur);
    }
    if (Math.abs(to.z - cur.z) >= 0.005) {
      cur = { x: cur.x, y: cur.y, z: to.z };
      pushUnique(pts, cur);
    }
  } else {
    if (Math.abs(to.z - cur.z) >= 0.005) {
      cur = { x: cur.x, y: cur.y, z: to.z };
      pushUnique(pts, cur);
    }
    if (Math.abs(to.x - cur.x) >= 0.005) {
      cur = { x: to.x, y: cur.y, z: cur.z };
      pushUnique(pts, cur);
    }
  }

  if (Math.abs(to.y - cur.y) >= 0.005) {
    cur = { x: cur.x, y: to.y, z: cur.z };
    pushUnique(pts, cur);
  }

  return pts;
}

function findPoint(lv: Level | undefined, kind: MepPoint["kind"]): MepPoint | undefined {
  return lv?.mepPoints.find((p) => p.kind === kind);
}

/**
 * Single source of truth for all plumbing (air_bersih, air_kotor, air_hujan) and electrical
 * (listrik_lampu, listrik_kontak, listrik_ac) routes & symbols used identically by:
 * - 3D Renderer (`projectHouseBuilder.ts`)
 * - 2D CAD Floor Plans (`DrawingsWorkspace.tsx`)
 * - Quantity Takeoff (`projectModel.ts` -> `rabEngine.ts`)
 */
export function buildCanonicalMepNetwork(project: Project): CanonicalMepNetwork {
  const lv0 = project.levels[0];
  const lv1 = project.levels[1];
  const fm = project.floodMitigation;
  const lotW = project.site.width;
  const lv0HasBuilding = Boolean(lv0 && (lv0.walls.length > 0 || lv0.lights.length > 0 || lv0.hvac.length > 0 || lv0.furniture.length > 0));
  const lv1HasBuilding = Boolean(lv1 && (lv1.walls.length > 0 || lv1.lights.length > 0 || lv1.hvac.length > 0 || lv1.furniture.length > 0));

  const routes0: CanonicalMepRoute[] = [];
  const routes1: CanonicalMepRoute[] = [];
  const symbols0: CanonicalMepSymbol[] = [];
  const symbols1: CanonicalMepSymbol[] = [];

  const mtrPt = findPoint(lv0, "meter_air") ?? { id: "mtr", kind: "meter_air", label: "Meter PDAM", x: 0.35, y: -0.25, z: 0.25 };
  const mcbPt = findPoint(lv0, "panel_mcb") ?? { id: "mcb", kind: "panel_mcb", label: "Panel MCB", x: 0.35, y: fm.mcbHeightM, z: 4.15 };
  const mcbY = Math.max(fm.mcbHeightM, mcbPt.y);

  // Sanitary targets derived from mepPoints + furniture (kloset_set / kitchen_l)
  const collectWetFixtures = (lv: Level | undefined) => {
    if (!lv) return { klosets: [] as { id: string; label: string; x: number; y: number; z: number }[], sinks: [] as { id: string; label: string; x: number; y: number; z: number }[] };
    const klosets: { id: string; label: string; x: number; y: number; z: number }[] = [];
    const sinks: { id: string; label: string; x: number; y: number; z: number }[] = [];

    for (const mp of lv.mepPoints) {
      if (mp.kind === "kloset") klosets.push({ id: mp.id, label: mp.label, x: mp.x, y: mp.y, z: mp.z });
      else if (mp.kind === "sink" || mp.kind === "wastafel") sinks.push({ id: mp.id, label: mp.label, x: mp.x, y: mp.y, z: mp.z });
    }
    for (const f of lv.furniture) {
      if (f.catalogId === "kloset_set") {
        const dup = klosets.some((k) => Math.hypot(k.x - f.position.x, k.z - f.position.z) < 0.75);
        if (!dup) klosets.push({ id: f.id, label: f.name, x: f.position.x, y: f.position.y, z: f.position.z });
      } else if (f.catalogId === "kitchen_l") {
        const dup = sinks.some((s) => Math.hypot(s.x - f.position.x, s.z - f.position.z) < 1.2);
        if (!dup) sinks.push({ id: f.id, label: `Sink ${f.name}`, x: f.position.x, y: f.position.y + 0.85, z: f.position.z });
      }
    }
    return { klosets, sinks };
  };

  // ---------------- LEVEL 1 (LT1) ----------------
  if (lv0 && lv0HasBuilding) {
    symbols0.push(
      { id: mtrPt.id, levelIndex: 0, kind: "meter_air", label: mtrPt.label, x: mtrPt.x, y: mtrPt.y, z: mtrPt.z },
      { id: mcbPt.id, levelIndex: 0, kind: "panel_mcb", label: `MCB (${Math.round(mcbY * 100)} cm)`, x: mcbPt.x, y: mcbY, z: mcbPt.z },
      { id: "bio-septic", levelIndex: 0, kind: "bio_septic", label: "Bio Septic Tank", x: 2.8, y: -0.75, z: 1.6 },
    );

    for (let i = 0; i < fm.infiltrationWells; i++) {
      symbols0.push({
        id: `resapan-${i}`,
        levelIndex: 0,
        kind: "sumur_resapan",
        label: `Sumur Resapan ${i + 1}`,
        x: 0.75,
        y: -0.7,
        z: 1.2 + i * 1.1,
      });
    }

    const wet0 = collectWetFixtures(lv0);
    const wet0All = [...wet0.klosets, ...wet0.sinks];
    for (const k of wet0.klosets) symbols0.push({ ...k, levelIndex: 0, kind: "kloset" });
    for (const s of wet0.sinks) symbols0.push({ ...s, levelIndex: 0, kind: "sink" });

    // 1. Air Bersih LT1 (Trunk along left wall x = 0.35 + orthogonal branches to wet fixtures)
    const maxWetZ0 = Math.max(16.45, ...wet0All.map((w) => w.z));
    const trunkX = 0.35;
    const cleanTrunkPts = buildOrthoPath3D(
      { x: mtrPt.x, y: -0.25, z: mtrPt.z },
      { x: trunkX, y: -0.25, z: maxWetZ0 },
      true,
    );
    if (cleanTrunkPts.length >= 2) {
      routes0.push({
        id: "mr1-air-bersih-trunk",
        kind: "air_bersih",
        label: "Jalur Utama Air Bersih PDAM LT1",
        pts: cleanTrunkPts,
      });
    }
    wet0All.forEach((wf, idx) => {
      const bPts = buildOrthoPath3D(
        { x: trunkX, y: -0.25, z: wf.z },
        { x: wf.x, y: Math.max(0.35, wf.y), z: wf.z },
        true,
      );
      if (bPts.length >= 2) {
        routes0.push({
          id: `mr1-air-bersih-b-${idx}`,
          kind: "air_bersih",
          label: `Cabang Air Bersih → ${wf.label}`,
          pts: bPts,
        });
      }
    });
    if (lv1HasBuilding) {
      routes0.push({
        id: "mr1-air-bersih-riser",
        kind: "air_bersih",
        label: "Pipa Riser Air Bersih LT1 → LT2",
        pts: [
          { x: trunkX, y: -0.25, z: 16.45 },
          { x: trunkX, y: lv0.height, z: 16.45 },
        ],
      });
    }

    // 2. Air Kotor LT1 (Trunk x = 0.65 -> z=4.0 -> x=2.8 -> z=1.6 Bio Septic)
    const drainX = 0.65;
    const drainMaxZ = Math.max(16.45, ...wet0All.map((w) => w.z));
    const drainTrunk: Vec3[] = [
      { x: drainX, y: -0.45, z: drainMaxZ },
      { x: drainX, y: -0.45, z: 4.0 },
      { x: 2.8, y: -0.45, z: 4.0 },
      { x: 2.8, y: -0.45, z: 1.6 },
      { x: 2.8, y: -0.55, z: 1.6 },
    ];
    routes0.push({
      id: "mr1-air-kotor-trunk",
      kind: "air_kotor",
      label: "Saluran Limbah Utama → Bio Septic Tank",
      pts: drainTrunk,
    });
    wet0All.forEach((wf, idx) => {
      if (Math.abs(wf.x - drainX) > 0.05) {
        routes0.push({
          id: `mr1-air-kotor-b-${idx}`,
          kind: "air_kotor",
          label: `Cabang Limbah ${wf.label}`,
          pts: buildOrthoPath3D({ x: wf.x, y: -0.45, z: wf.z }, { x: drainX, y: -0.45, z: wf.z }, true),
        });
      }
    });

    // 3. Air Hujan (Downspout Atap Depan Kiri & Kanan -> Sumur Resapan / Drainase Jalan)
    const dsLeft = { x: 0.14, z: 3.04 };
    const dsRight = { x: roundCm(lotW - 0.14), z: 3.92 };
    symbols0.push(
      { id: "ds-left", levelIndex: 0, kind: "downspout", label: "Downspout Kiri", x: dsLeft.x, y: 0, z: dsLeft.z },
      { id: "ds-right", levelIndex: 0, kind: "downspout", label: "Downspout Kanan", x: dsRight.x, y: 0, z: dsRight.z },
    );
    const leftRainPts: Vec3[] = [
      { x: dsLeft.x, y: 3.6, z: dsLeft.z },
      { x: dsLeft.x, y: 0.08, z: dsLeft.z },
      { x: dsLeft.x, y: -0.32, z: dsLeft.z },
    ];
    if (fm.infiltrationWells > 0) {
      leftRainPts.push(
        { x: 0.75, y: -0.32, z: dsLeft.z },
        { x: 0.75, y: -0.32, z: 1.2 },
        { x: 0.75, y: -0.32, z: -0.25 },
      );
    } else {
      leftRainPts.push({ x: dsLeft.x, y: -0.32, z: -0.25 });
    }
    routes0.push({
      id: "mr1-hujan-kiri",
      kind: "air_hujan",
      label: fm.infiltrationWells > 0 ? "Downspout Kiri → Sumur Resapan → Parit" : "Downspout Kiri → Parit Depan",
      pts: leftRainPts,
    });
    routes0.push({
      id: "mr1-hujan-kanan",
      kind: "air_hujan",
      label: "Downspout Kanan → Parit Depan",
      pts: [
        { x: dsRight.x, y: 3.6, z: dsRight.z },
        { x: dsRight.x, y: 0.08, z: dsRight.z },
        { x: dsRight.x, y: -0.25, z: dsRight.z },
        { x: dsRight.x, y: -0.25, z: -0.25 },
      ],
    });

    // 4. Listrik Lampu LT1 (MCB -> Spine x=2.25 ceiling -> Orthogonal branches to every light)
    const ceilY = roundCm(Math.min(3.35, lv0.height - 0.32));
    if (lv0.lights.length > 0) {
      const spineX = 2.25;
      const zVals = lv0.lights.map((l) => l.position.z);
      const minLz = Math.min(mcbPt.z, ...zVals);
      const maxLz = Math.max(mcbPt.z, ...zVals);

      routes0.push({
        id: "mr1-listrik-lampu-feeder",
        kind: "listrik_lampu",
        label: "Feeder Utama Lampu LT1",
        pts: [
          { x: mcbPt.x, y: mcbY, z: mcbPt.z },
          { x: mcbPt.x, y: ceilY, z: mcbPt.z },
          { x: spineX, y: ceilY, z: mcbPt.z },
        ],
      });
      if (maxLz - minLz > 0.05) {
        routes0.push({
          id: "mr1-listrik-lampu-spine",
          kind: "listrik_lampu",
          label: "Jalur Bus Plafon Lampu LT1",
          pts: [
            { x: spineX, y: ceilY, z: roundCm(minLz) },
            { x: spineX, y: ceilY, z: roundCm(maxLz) },
          ],
        });
      }
      lv0.lights.forEach((l, idx) => {
        symbols0.push({
          id: l.id,
          levelIndex: 0,
          kind: "lampu",
          label: l.name,
          x: l.position.x,
          y: l.position.y,
          z: l.position.z,
        });
        const dropY = Math.min(ceilY, Math.max(0.3, l.position.y));
        const bPts = buildOrthoPath3D(
          { x: spineX, y: ceilY, z: l.position.z },
          { x: l.position.x, y: dropY, z: l.position.z },
          true,
        );
        if (bPts.length >= 2) {
          routes0.push({
            id: `mr1-listrik-lampu-b-${idx}`,
            kind: "listrik_lampu",
            label: `Kabel → ${l.name}`,
            pts: bPts,
          });
        }
      });
    }

    // 5. Listrik Stop Kontak LT1 (Perimeter bus along walls x=0.2 & x=4.8 + drops to outletHeightM)
    const outlets0 = lv0.mepPoints.filter((p) => p.kind === "stopkontak");
    if (outlets0.length > 0) {
      const busY = roundCm(Math.min(3.25, lv0.height - 0.38));
      const leftOutlets = outlets0.filter((o) => o.x <= lotW * 0.5);
      const rightOutlets = outlets0.filter((o) => o.x > lotW * 0.5);
      const maxLeftZ = Math.max(mcbPt.z, ...leftOutlets.map((o) => o.z));
      const maxRightZ = Math.max(mcbPt.z, ...rightOutlets.map((o) => o.z));

      routes0.push({
        id: "mr1-listrik-kontak-bus-left",
        kind: "listrik_kontak",
        label: "Sirkuit Stop Kontak Kiri LT1",
        pts: buildOrthoPath3D({ x: mcbPt.x, y: mcbY, z: mcbPt.z }, { x: 0.2, y: busY, z: maxLeftZ }, true, true),
      });
      if (rightOutlets.length > 0) {
        routes0.push({
          id: "mr1-listrik-kontak-bus-right",
          kind: "listrik_kontak",
          label: "Sirkuit Stop Kontak Kanan LT1",
          pts: buildOrthoPath3D({ x: mcbPt.x, y: busY, z: mcbPt.z }, { x: roundCm(lotW - 0.2), y: busY, z: maxRightZ }, true),
        });
      }
      outlets0.forEach((o, idx) => {
        const oy = fm.outletHeightM;
        symbols0.push({ id: o.id, levelIndex: 0, kind: "stopkontak", label: o.label, x: o.x, y: oy, z: o.z });
        const busX = o.x <= lotW * 0.5 ? 0.2 : roundCm(lotW - 0.2);
        const dropPts = buildOrthoPath3D({ x: busX, y: busY, z: o.z }, { x: o.x, y: oy, z: o.z }, true);
        if (dropPts.length >= 2) {
          routes0.push({
            id: `mr1-listrik-kontak-d-${idx}`,
            kind: "listrik_kontak",
            label: `Drop → ${o.label}`,
            pts: dropPts,
          });
        }
      });
    }

    // 6. Listrik AC LT1 (Dedicated feeder per AC split)
    const ac0 = lv0.hvac.filter((h) => h.type === "ac_split");
    if (ac0.length > 0) {
      const acBusY = roundCm(Math.min(3.15, lv0.height - 0.45));
      const acMaxZ = Math.max(mcbPt.z, ...ac0.map((a) => a.position.z));
      routes0.push({
        id: "mr1-listrik-ac-bus",
        kind: "listrik_ac",
        label: "Feeder Khusus AC LT1",
        pts: buildOrthoPath3D({ x: mcbPt.x, y: mcbY, z: mcbPt.z }, { x: roundCm(lotW - 0.18), y: acBusY, z: acMaxZ }, true, true),
      });
      ac0.forEach((a, idx) => {
        symbols0.push({ id: a.id, levelIndex: 0, kind: "ac_split", label: a.name, x: a.position.x, y: a.position.y, z: a.position.z });
        const bPts = buildOrthoPath3D(
          { x: roundCm(lotW - 0.18), y: acBusY, z: a.position.z },
          { x: a.position.x, y: a.position.y, z: a.position.z },
          true,
        );
        if (bPts.length >= 2) {
          routes0.push({
            id: `mr1-listrik-ac-b-${idx}`,
            kind: "listrik_ac",
            label: `Power AC → ${a.name}`,
            pts: bPts,
          });
        }
      });
    }
  }

  // ---------------- LEVEL 2 (LT2) ----------------
  if (lv1 && lv1HasBuilding) {
    const wet1 = collectWetFixtures(lv1);
    const wet1All = [...wet1.klosets, ...wet1.sinks];
    for (const k of wet1.klosets) symbols1.push({ ...k, levelIndex: 1, kind: "kloset" });
    for (const s of wet1.sinks) symbols1.push({ ...s, levelIndex: 1, kind: "sink" });

    // 1. Air Bersih LT2 (Shaft at x=0.35, z=16.45 -> wall-aligned orthogonal to Ensuite & Toilet Bersama)
    if (wet1All.length > 0) {
      routes1.push({
        id: "mr2-air-bersih-riser",
        kind: "air_bersih",
        label: "Riser Air Bersih Masuk LT2",
        pts: [
          { x: 0.35, y: -0.25, z: 16.45 },
          { x: 0.35, y: 0.25, z: 16.45 },
        ],
      });
      wet1All.forEach((wf, idx) => {
        // Route via wall chase z=12.50 & x=3.50 for east-side fixtures (never diagonal!)
        let pts: Vec3[];
        if (wf.x > 2.2 && wf.z < 12.5) {
          pts = [
            { x: 0.35, y: 0.25, z: 16.45 },
            { x: 0.35, y: 0.25, z: 12.5 },
            { x: 3.5, y: 0.25, z: 12.5 },
            { x: 3.5, y: 0.25, z: roundCm(wf.z) },
            { x: roundCm(wf.x), y: 0.25, z: roundCm(wf.z) },
          ];
        } else {
          pts = buildOrthoPath3D({ x: 0.35, y: 0.25, z: 16.45 }, { x: wf.x, y: 0.25, z: wf.z }, false);
        }
        if (pts.length >= 2) {
          routes1.push({
            id: `mr2-air-bersih-b-${idx}`,
            kind: "air_bersih",
            label: `Air Bersih LT2 → ${wf.label}`,
            pts,
          });
        }
      });
    }

    // 2. Air Kotor LT2 (Wall-aligned along x=3.5 & z=12.5 -> vertical stack x=0.65, z=16.45)
    if (wet1All.length > 0) {
      routes1.push({
        id: "mr2-air-kotor-stack",
        kind: "air_kotor",
        label: "Shaft Pipa Limbah LT2 → LT1",
        pts: [
          { x: 0.65, y: -0.15, z: 16.45 },
          { x: 0.65, y: -(lv0?.height ?? 3.6), z: 16.45 },
        ],
      });
      wet1All.forEach((wf, idx) => {
        let pts: Vec3[];
        if (wf.x > 2.2 && wf.z < 12.5) {
          pts = [
            { x: roundCm(wf.x), y: -0.15, z: roundCm(wf.z) },
            { x: 3.5, y: -0.15, z: roundCm(wf.z) },
            { x: 3.5, y: -0.15, z: 12.5 },
            { x: 0.65, y: -0.15, z: 12.5 },
            { x: 0.65, y: -0.15, z: 16.45 },
          ];
        } else {
          pts = buildOrthoPath3D({ x: wf.x, y: -0.15, z: wf.z }, { x: 0.65, y: -0.15, z: 16.45 }, true);
        }
        if (pts.length >= 2) {
          routes1.push({
            id: `mr2-air-kotor-b-${idx}`,
            kind: "air_kotor",
            label: `Limbah LT2 ${wf.label} → Shaft`,
            pts,
          });
        }
      });
    }

    // 3. Listrik Lampu LT2
    const ceilY2 = roundCm(Math.min(3.35, lv1.height - 0.32));
    if (lv1.lights.length > 0) {
      const spineX2 = 2.25;
      const zVals2 = lv1.lights.map((l) => l.position.z);
      const minLz2 = Math.min(mcbPt.z, ...zVals2);
      const maxLz2 = Math.max(mcbPt.z, ...zVals2);

      routes1.push({
        id: "mr2-listrik-lampu-feeder",
        kind: "listrik_lampu",
        label: "Riser Lampu LT1 → LT2",
        pts: [
          { x: mcbPt.x, y: -0.38, z: mcbPt.z },
          { x: mcbPt.x, y: ceilY2, z: mcbPt.z },
          { x: spineX2, y: ceilY2, z: mcbPt.z },
        ],
      });
      if (maxLz2 - minLz2 > 0.05) {
        routes1.push({
          id: "mr2-listrik-lampu-spine",
          kind: "listrik_lampu",
          label: "Jalur Bus Plafon Lampu LT2",
          pts: [
            { x: spineX2, y: ceilY2, z: roundCm(minLz2) },
            { x: spineX2, y: ceilY2, z: roundCm(maxLz2) },
          ],
        });
      }
      lv1.lights.forEach((l, idx) => {
        symbols1.push({
          id: l.id,
          levelIndex: 1,
          kind: "lampu",
          label: l.name,
          x: l.position.x,
          y: l.position.y,
          z: l.position.z,
        });
        const dropY = Math.min(ceilY2, Math.max(0.3, l.position.y));
        const bPts = buildOrthoPath3D(
          { x: spineX2, y: ceilY2, z: l.position.z },
          { x: l.position.x, y: dropY, z: l.position.z },
          true,
        );
        if (bPts.length >= 2) {
          routes1.push({
            id: `mr2-listrik-lampu-b-${idx}`,
            kind: "listrik_lampu",
            label: `Kabel → ${l.name}`,
            pts: bPts,
          });
        }
      });
    }

    // 4. Listrik Stop Kontak LT2
    const outlets1 = lv1.mepPoints.filter((p) => p.kind === "stopkontak");
    if (outlets1.length > 0) {
      const busY2 = roundCm(Math.min(3.25, lv1.height - 0.38));
      const leftOut1 = outlets1.filter((o) => o.x <= lotW * 0.5);
      const rightOut1 = outlets1.filter((o) => o.x > lotW * 0.5);
      const maxR1 = Math.max(mcbPt.z, ...rightOut1.map((o) => o.z));

      routes1.push({
        id: "mr2-listrik-kontak-riser",
        kind: "listrik_kontak",
        label: "Riser Stop Kontak LT2",
        pts: [
          { x: mcbPt.x, y: -0.44, z: mcbPt.z },
          { x: mcbPt.x, y: busY2, z: mcbPt.z },
          { x: roundCm(lotW - 0.2), y: busY2, z: mcbPt.z },
          { x: roundCm(lotW - 0.2), y: busY2, z: roundCm(maxR1) },
        ],
      });
      if (leftOut1.length > 0) {
        const maxL1 = Math.max(mcbPt.z, ...leftOut1.map((o) => o.z));
        routes1.push({
          id: "mr2-listrik-kontak-bus-left",
          kind: "listrik_kontak",
          label: "Jalur Stop Kontak Kiri LT2",
          pts: buildOrthoPath3D({ x: mcbPt.x, y: busY2, z: mcbPt.z }, { x: 0.2, y: busY2, z: maxL1 }, true),
        });
      }
      outlets1.forEach((o, idx) => {
        symbols1.push({ id: o.id, levelIndex: 1, kind: "stopkontak", label: o.label, x: o.x, y: o.y, z: o.z });
        const busX = o.x <= lotW * 0.5 ? 0.2 : roundCm(lotW - 0.2);
        const dropPts = buildOrthoPath3D({ x: busX, y: busY2, z: o.z }, { x: o.x, y: o.y, z: o.z }, true);
        if (dropPts.length >= 2) {
          routes1.push({
            id: `mr2-listrik-kontak-d-${idx}`,
            kind: "listrik_kontak",
            label: `Drop → ${o.label}`,
            pts: dropPts,
          });
        }
      });
    }

    // 5. Listrik AC LT2
    const ac1 = lv1.hvac.filter((h) => h.type === "ac_split");
    if (ac1.length > 0) {
      const acBusY2 = roundCm(Math.min(3.15, lv1.height - 0.45));
      const acMaxZ2 = Math.max(mcbPt.z, ...ac1.map((a) => a.position.z));
      routes1.push({
        id: "mr2-listrik-ac-feeder",
        kind: "listrik_ac",
        label: "Feeder Khusus AC LT2",
        pts: [
          { x: mcbPt.x, y: -2.05, z: mcbPt.z },
          { x: mcbPt.x, y: acBusY2, z: mcbPt.z },
          { x: roundCm(lotW - 0.18), y: acBusY2, z: mcbPt.z },
          { x: roundCm(lotW - 0.18), y: acBusY2, z: roundCm(acMaxZ2) },
        ],
      });
      ac1.forEach((a, idx) => {
        symbols1.push({ id: a.id, levelIndex: 1, kind: "ac_split", label: a.name, x: a.position.x, y: a.position.y, z: a.position.z });
        const bPts = buildOrthoPath3D(
          { x: roundCm(lotW - 0.18), y: acBusY2, z: a.position.z },
          { x: a.position.x, y: a.position.y, z: a.position.z },
          true,
        );
        if (bPts.length >= 2) {
          routes1.push({
            id: `mr2-listrik-ac-b-${idx}`,
            kind: "listrik_ac",
            label: `Power AC → ${a.name}`,
            pts: bPts,
          });
        }
      });
    }
  }

  return {
    routesByLevel: [routes0, routes1],
    symbolsByLevel: [symbols0, symbols1],
  };
}
