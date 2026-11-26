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
  exteriorPaintAreaM2: number;
  interiorPaintAreaM2: number;
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

function unionHorizontalArea(cuts: { lo: number; hi: number; sill: number; top: number }[], maxH: number): number {
  const clamped = cuts
    .map((c) => ({
      lo: Math.max(0, c.lo),
      hi: Math.max(0, c.hi),
      sill: Math.max(0, c.sill),
      top: Math.min(maxH, c.top),
    }))
    .filter((c) => c.hi > c.lo && c.top > c.sill);
  if (clamped.length === 0) return 0;

  const yBreaks = Array.from(new Set(clamped.flatMap((c) => [c.sill, c.top]))).sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < yBreaks.length - 1; i++) {
    const y0 = yBreaks[i]!;
    const y1 = yBreaks[i + 1]!;
    const dy = y1 - y0;
    if (dy <= 1e-6) continue;
    const xInts = clamped
      .filter((c) => c.sill <= y0 + 1e-6 && c.top >= y1 - 1e-6)
      .map((c) => ({ lo: c.lo, hi: c.hi }))
      .sort((a, b) => a.lo - b.lo);
    if (xInts.length === 0) continue;
    let curLo = xInts[0]!.lo;
    let curHi = xInts[0]!.hi;
    let xUnion = 0;
    for (let k = 1; k < xInts.length; k++) {
      const iv = xInts[k]!;
      if (iv.lo <= curHi) curHi = Math.max(curHi, iv.hi);
      else {
        xUnion += curHi - curLo;
        curLo = iv.lo;
        curHi = iv.hi;
      }
    }
    xUnion += curHi - curLo;
    area += xUnion * dy;
  }
  return area;
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
  const bL = Math.max(0.05, brickSpec.lengthMm / 1000);
  const bH = Math.max(0.02, brickSpec.heightMm / 1000);
  const j = Math.max(0.001, brickSpec.mortarMm / 1000);
  const cellL = bL + j;
  const cellH = bH + j;
  const beamDeductH = 0.2; // ring balk / beam band deducted from brick courses where wall meets beam

  const bricks: BrickInstance[] = [];
  const perWall: WallMasonrySummary[] = [];

  let outerPiecesEquivalent = 0;
  let innerPiecesEquivalent = 0;
  let cutPiecesCount = 0;
  let totalNetWallArea = 0;
  let plasterAreaTotal = 0;
  let exteriorPaintAreaM2 = 0;
  let interiorPaintAreaM2 = 0;
  let totalWallBandVol = 0;
  let totalBrickVol = 0;

  for (const level of levels) {
    for (const w of level.walls) {
      if (w.kind === "fence") continue;
      const len = wallLength(w);
      if (len < 0.05) continue;
      const dx = w.end.x - w.start.x;
      const dz = w.end.z - w.start.z;
      const ux = dx / len;
      const uz = dz / len;
      const rotY = -Math.atan2(dz, dx);

      // Wall thickness follows brick spec (allows user custom brick thickness to alter floor area & volume!)
      const wallThick = Math.max(0.05, (w.exterior ? brickSpec.outerThicknessMm : brickSpec.innerThicknessMm) / 1000);
      const effBrickH = Math.max(0.3, w.height - (w.height >= 2.8 ? beamDeductH : 0));

      const openingCuts = w.openings.map((o) => openingBoundsAlongWall(w, o));
      const openingArea = unionHorizontalArea(openingCuts, effBrickH);

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

      // Accessible wall faces: party walls bordering neighbors have 1 internal face only
      const accessibleSides = w.partyWallSide ? 1 : 2;
      plasterAreaTotal += netWallArea * accessibleSides;
      if (w.exterior) {
        if (!w.partyWallSide) exteriorPaintAreaM2 += netWallArea;
        interiorPaintAreaM2 += netWallArea;
      } else {
        interiorPaintAreaM2 += netWallArea * 2;
      }

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
    plasterAreaTwoSidesM2: plasterAreaTotal,
    exteriorPaintAreaM2,
    interiorPaintAreaM2,
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
