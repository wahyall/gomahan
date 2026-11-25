import type { BrickSpec, Level } from "@/lib/model/types";
import { openingBoundsAlongWall, wallLength } from "@/lib/geometry/walls";

export interface BrickInstance {
  levelIndex: number;
  wallId: string;
  outer: boolean;
  x: number; // world X center
  y: number; // base elevation relative to level floor (m)
  z: number; // world Z center
  len: number; // brick length along wall (m)
  hgt: number; // brick height (m)
  thick: number; // brick thickness (m)
  rotY: number; // Y rotation in Three.js
  isCut: boolean;
}

export interface WallMasonrySummary {
  wallId: string;
  levelIndex: number;
  outer: boolean;
  piecesPlaced: number;
  fullPieces: number;
  cutPieces: number;
  netWallAreaM2: number;
  brickVolumeM3: number;
  mortarVolumeM3: number;
}

export interface MasonryTakeoff {
  brickSpec: BrickSpec;
  bricks: BrickInstance[];
  perWall: WallMasonrySummary[];
  outerPiecesEquivalent: number;
  innerPiecesEquivalent: number;
  totalPiecesPlaced: number;
  cutPiecesCount: number;
  buyOuterBricks: number;
  buyInnerBricks: number;
  totalBuyBricks: number;
  netWallAreaM2: number;
  plasterAreaTwoSidesM2: number;
  brickVolumeM3: number;
  mortarVolumeM3: number;
  mortarWithWasteM3: number;
  thinbedKg: number;
  thinbedZak40kg: number;
  cementKg: number;
  cementZak50kg: number;
  sandM3: number;
  bricksPerM2Nominal: number;
}

interface Interval {
  lo: number;
  hi: number;
}

function subtractIntervals(base: Interval, cuts: Interval[]): Interval[] {
  let pieces: Interval[] = [{ ...base }];
  for (const c of cuts) {
    const next: Interval[] = [];
    for (const p of pieces) {
      if (c.hi <= p.lo || c.lo >= p.hi) {
        next.push(p);
        continue;
      }
      if (c.lo > p.lo) next.push({ lo: p.lo, hi: c.lo });
      if (c.hi < p.hi) next.push({ lo: c.hi, hi: p.hi });
    }
    pieces = next;
  }
  return pieces.filter((p) => p.hi - p.lo > 0.015);
}

/**
 * Analytic brick-by-brick masonry and mortar/adhesive takeoff engine.
 * Supports ANY custom brick dimensions (L × H × T in mm), mortar joint (mm),
 * bond pattern (running / stack / english), openings, and optional roof slope wall tops.
 */
export function computeMasonryTakeoff(
  levels: Level[],
  brickSpec: BrickSpec,
  extraTopHeightAt?: (levelIndex: number, x: number, z: number) => number,
): MasonryTakeoff {
  const bL = brickSpec.lengthMm / 1000;
  const bH = brickSpec.heightMm / 1000;
  const j = brickSpec.mortarMm / 1000;
  const cellL = bL + j;
  const cellH = bH + j;
  const beamDeductH = 0.2; // ring balk / beam band deducted from brick courses where wall meets beam

  const bricks: BrickInstance[] = [];
  const perWall: WallMasonrySummary[] = [];

  let outerPiecesEquivalent = 0;
  let innerPiecesEquivalent = 0;
  let cutPiecesCount = 0;
  let totalNetWallArea = 0;
  let totalWallBandVol = 0;
  let totalBrickVol = 0;

  for (const level of levels) {
    for (const w of level.walls) {
      const len = wallLength(w);
      if (len < 0.05) continue;
      const dx = w.end.x - w.start.x;
      const dz = w.end.z - w.start.z;
      const ux = dx / len;
      const uz = dz / len;
      const rotY = -Math.atan2(dz, dx);

      // Wall thickness follows brick spec (allows user custom brick thickness to alter floor area & volume!)
      const wallThick = (w.exterior ? brickSpec.outerThicknessMm : brickSpec.innerThicknessMm) / 1000;
      const effBrickH = Math.max(0.3, w.height - (w.height >= 2.8 ? beamDeductH : 0));

      const openingCuts = w.openings.map((o) => openingBoundsAlongWall(w, o));
      const openingArea = openingCuts.reduce(
        (acc, c) => acc + Math.max(0, c.hi - c.lo) * Math.max(0, Math.min(effBrickH, c.top) - c.sill),
        0,
      );

      let extraSlopeArea = 0;
      let maxExtra = 0;
      if (extraTopHeightAt && w.exterior && w.height >= 2.8) {
        const h0 = Math.max(0, extraTopHeightAt(level.index, w.start.x, w.start.z));
        const h1 = Math.max(0, extraTopHeightAt(level.index, w.end.x, w.end.z));
        extraSlopeArea = ((h0 + h1) * 0.5) * len;
        maxExtra = Math.max(h0, h1);
      }

      const netWallArea = Math.max(0, effBrickH * len + extraSlopeArea - openingArea);
      const wallBandVol = netWallArea * wallThick;
      totalNetWallArea += netWallArea;
      totalWallBandVol += wallBandVol;

      const maxH = effBrickH + maxExtra;
      const nCourses = Math.ceil(maxH / cellH);

      let wallBrickVol = 0;
      let wallPieces = 0;
      let wallFull = 0;
      let wallCut = 0;

      for (let row = 0; row < nCourses; row++) {
        const yCourse = row * cellH;
        if (yCourse >= maxH - 0.005) break;

        // Cut openings intersecting this horizontal course
        const activeCuts: Interval[] = openingCuts
          .filter((o) => o.sill < yCourse + bH - 0.005 && o.top > yCourse + 0.005)
          .map((o) => ({ lo: o.lo, hi: o.hi }));

        let phase = 0;
        if (brickSpec.bondPattern === "running") {
          phase = (row % 2) * cellL * 0.5;
        } else if (brickSpec.bondPattern === "english") {
          phase = row % 2 === 0 ? 0 : cellL * 0.25;
        }

        const effectiveLen =
          brickSpec.bondPattern === "english" && row % 2 === 1 ? Math.max(0.08, bL * 0.5) : bL;
        const effectiveStep = effectiveLen + j;

        let p = -phase;
        while (p + effectiveLen <= 0) p += effectiveStep;

        for (; p < len; p += effectiveStep) {
          const segs = subtractIntervals(
            { lo: Math.max(p, 0), hi: Math.min(p + effectiveLen, len) },
            activeCuts,
          );
          for (const seg of segs) {
            const segLen = seg.hi - seg.lo;
            const midS = (seg.lo + seg.hi) / 2;
            const wx = w.start.x + ux * midS;
            const wz = w.start.z + uz * midS;

            const topLimit =
              extraTopHeightAt && w.exterior && w.height >= 2.8
                ? effBrickH + Math.max(0, extraTopHeightAt(level.index, wx, wz))
                : effBrickH;
            const hgt = Math.min(bH, Math.max(0, topLimit - yCourse));
            if (hgt <= 0.015) continue;

            const isCut = segLen < effectiveLen - 0.01 || hgt < bH - 0.01;
            const frac = (segLen / bL) * (hgt / bH);
            if (w.exterior) outerPiecesEquivalent += frac;
            else innerPiecesEquivalent += frac;

            if (isCut) {
              wallCut++;
              cutPiecesCount++;
            } else {
              wallFull++;
            }
            wallPieces++;

            const bv = segLen * hgt * wallThick;
            wallBrickVol += bv;
            totalBrickVol += bv;

            bricks.push({
              levelIndex: level.index,
              wallId: w.id,
              outer: w.exterior,
              x: wx,
              y: yCourse,
              z: wz,
              len: segLen,
              hgt,
              thick: wallThick,
              rotY,
              isCut,
            });
          }
        }
      }

      perWall.push({
        wallId: w.id,
        levelIndex: level.index,
        outer: w.exterior,
        piecesPlaced: wallPieces,
        fullPieces: wallFull,
        cutPieces: wallCut,
        netWallAreaM2: netWallArea,
        brickVolumeM3: wallBrickVol,
        mortarVolumeM3: Math.max(0, wallBandVol - wallBrickVol),
      });
    }
  }

  const waste = brickSpec.wastePct / 100;
  const buyOuterBricks = Math.ceil(outerPiecesEquivalent * (1 + waste));
  const buyInnerBricks = Math.ceil(innerPiecesEquivalent * (1 + waste));
  const totalBuyBricks = buyOuterBricks + buyInnerBricks;

  // Analytic mortar volume = net wall volume minus solid brick volume
  const mortarVolumeM3 = Math.max(0, totalWallBandVol - totalBrickVol);
  const mortarWithWasteM3 = mortarVolumeM3 * (1 + waste);

  // Permen PUPR No. 8/2023 calibrated mortar material breakdown
  let thinbedKg = 0;
  let thinbedZak40kg = 0;
  let cementKg = 0;
  let cementZak50kg = 0;
  let sandM3 = 0;

  if (brickSpec.mortarKind === "thinbed") {
    // Thinbed mortar density ~1650 kg/m3 or ~1.2–1.5 kg/m2 per mm joint thickness (3 mm -> ~3.43–4.0 kg/m2)
    const densityAdjustedKg = mortarWithWasteM3 * 1650;
    const areaBenchmarkKg = totalNetWallArea * (brickSpec.mortarMm * 1.15);
    thinbedKg = Math.max(densityAdjustedKg, areaBenchmarkKg * 0.85);
    thinbedZak40kg = Math.ceil(thinbedKg / 40);
  } else {
    // 1:5 Portland Cement : Sand mortar (~315 kg cement and ~1.02 m3 sand per m3 wet mortar, aligned with AHSP 9.68 kg/m2 & 0.045 m3/m2 at 12 mm joint)
    cementKg = mortarWithWasteM3 * 315;
    cementZak50kg = Math.ceil(cementKg / 50);
    sandM3 = mortarWithWasteM3 * 1.05;
  }

  const bricksPerM2Nominal = 1 / ((bL + j) * (bH + j));

  return {
    brickSpec,
    bricks,
    perWall,
    outerPiecesEquivalent,
    innerPiecesEquivalent,
    totalPiecesPlaced: bricks.length,
    cutPiecesCount,
    buyOuterBricks,
    buyInnerBricks,
    totalBuyBricks,
    netWallAreaM2: totalNetWallArea,
    plasterAreaTwoSidesM2: totalNetWallArea * 2,
    brickVolumeM3: totalBrickVol,
    mortarVolumeM3,
    mortarWithWasteM3,
    thinbedKg,
    thinbedZak40kg,
    cementKg,
    cementZak50kg,
    sandM3,
    bricksPerM2Nominal,
  };
}
