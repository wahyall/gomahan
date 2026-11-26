import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import { pointInPolygon } from "@/lib/geometry/rooms";
import type { HvacUnit, Vec2, Wall } from "@/lib/model/types";

function airflowBlockedByWalls(ax: number, az: number, bx: number, bz: number, walls: Wall[]): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  if (Math.hypot(dx, dz) < 0.15) return false;
  for (const w of walls) {
    if (w.height < 1.6) continue;
    const wx = w.end.x - w.start.x;
    const wz = w.end.z - w.start.z;
    const wLen = Math.hypot(wx, wz);
    if (wLen < 0.1) continue;
    const denom = dx * wz - dz * wx;
    if (Math.abs(denom) < 1e-6) continue;
    const t = ((w.start.x - ax) * wz - (w.start.z - az) * wx) / denom;
    const u = ((w.start.x - ax) * dz - (w.start.z - az) * dx) / denom;
    if (t > 0.08 && t < 0.92 && u > 0.02 && u < 0.98) {
      const hitAlong = u * wLen;
      const passesOpening = w.openings.some(
        (op) => Math.abs(hitAlong - op.offset) <= op.width * 0.5 && (op.kind === "arch" || op.openPct > 15),
      );
      if (!passesOpening) return true;
    }
  }
  return false;
}

export interface ZoneAirflowResult {
  roomId: string;
  levelIndex: number;
  roomName: string;
  program: string;
  volumeM3: number;
  ach: number; // Air Changes per Hour
  avgVelocityMs: number;
  effectiveTempC: number; // dry-bulb or fan wind-chill perceived temp
  airTempC: number;
  co2Ppm: number;
  pmv: number; // -3 (cold) .. +3 (hot)
  ppdPct: number;
  crossVentilated: boolean;
  comfortStatus: "NYAMAN" | "HANGAT" | "PENGAP" | "SEJUK AC";
}

export interface AirflowSimulationResult {
  zones: ZoneAirflowResult[];
  gridW: number;
  gridD: number;
  // 2.5D velocity vector + temp field per level for GPU particle streamlines & heatmap
  lt1VelX: Float32Array;
  lt1VelZ: Float32Array;
  lt1Temp: Float32Array;
  lt2VelX: Float32Array;
  lt2VelZ: Float32Array;
  lt2Temp: Float32Array;
  avgAch: number;
  crossVentPct: number;
  totalCoolingLoadW: number;
  totalHvacPowerW: number;
  airflowScore: number; // 0..100
  recommendations: string[];
  methodologyNote: string;
}

function distSq(a: Vec2, x: number, z: number) {
  return (a.x - x) * (a.x - x) + (a.z - z) * (a.z - z);
}

/**
 * Zonal mass/energy balance + 2.5D velocity field solver (CFD-inspired, indicative).
 * Models natural wind pressure (Cp), stair/void stack effect, openable doors/windows,
 * and movable AC Split, Ceiling Fan, Stand Fan, and Exhaust Fan units.
 */
export function runAirflowSimulation(derived: DerivedProjectModel): AirflowSimulationResult {
  const { project, floors } = derived;
  const sim = project.simulation;
  const rho = 1.16; // tropical air density kg/m3
  const windRad = (sim.windDirectionDeg * Math.PI) / 180;
  const windVx = Math.sin(windRad) * sim.windSpeedMs;
  const windVz = Math.cos(windRad) * sim.windSpeedMs; // 0 deg -> +Z from street front into house

  const gridW = 25; // 5m @ 0.2m
  const gridD = 85; // 17m @ 0.2m

  const solveLevelField = (lvIdx: number) => {
    const lv = project.levels[lvIdx];
    const velX = new Float32Array(gridW * gridD);
    const velZ = new Float32Array(gridW * gridD);
    const temp = new Float32Array(gridW * gridD);
    if (!lv) {
      temp.fill(sim.ambientTempC);
      return { velX, velZ, temp };
    }

    // Precollect open vents/windows/doors on this floor
    const openFlows: { x: number; z: number; strength: number; isRear: boolean }[] = [];
    for (const w of lv.walls) {
      const dx = w.end.x - w.start.x;
      const dz = w.end.z - w.start.z;
      const len = Math.max(0.01, Math.hypot(dx, dz));
      for (const op of w.openings) {
        if (op.openPct <= 2) continue;
        const t = op.offset / len;
        const ox = w.start.x + dx * t;
        const oz = w.start.z + dz * t;
        const effArea = op.width * op.height * (op.openPct / 100);
        const windPressure = 0.5 * rho * sim.windSpeedMs * sim.windSpeedMs * 0.65;
        openFlows.push({
          x: ox,
          z: oz,
          strength: effArea * Math.sqrt((2 * Math.max(0.1, windPressure)) / rho),
          isRear: oz > 14.5,
        });
      }
    }

    // Active HVAC units on this level
    const activeHvac: HvacUnit[] = lv.hvac.filter((h) => h.on);

    for (let gz = 0; gz < gridD; gz++) {
      for (let gx = 0; gx < gridW; gx++) {
        const px = (gx + 0.5) * 0.2;
        const pz = (gz + 0.5) * 0.2;
        const idx = gz * gridW + gx;

        // Base natural cross-ventilation vector (front Z=4 -> rear void Z=15.35, plus stack upward at void/stair)
        let vx = windVx * 0.18;
        let vz = windVz * 0.32;
        let cellTemp = sim.ambientTempC - (lvIdx === 0 ? 1.2 : 0.4); // indoor thermal mass damping

        // Outdoor / Void / Garden zones carry strong ambient wind + stack suction
        const isRearVoid = px >= 1.7 && pz >= 15.35;
        const isFrontOutdoor = lvIdx === 0 && pz <= 4.0;
        if (isFrontOutdoor || isRearVoid) {
          vx = windVx * 0.85;
          vz = windVz * 0.85;
          cellTemp = sim.ambientTempC - (isRearVoid ? 1.0 : 0);
        } else {
          // Pull air toward nearest open window/door & rear void stack
          for (const op of openFlows) {
            const d2 = distSq({ x: op.x, z: op.z }, px, pz);
            if (d2 < 14) {
              const inf = (op.strength * 0.35) / (0.6 + d2);
              const dirSign = op.isRear ? 1 : 0.7;
              vx += windVx * inf * 0.4;
              vz += (windVz >= 0 ? 1 : -1) * inf * dirSign;
            }
          }
          // Stack effect suction near central stair (X: 0..1.35, Z: 7.5..12.5) and rear void (Z=15.35)
          const dStair = Math.hypot(px - 0.75, pz - 10.0);
          if (dStair < 3.0) {
            vz += (10.0 - pz) * 0.08;
            vx += (0.75 - px) * 0.08;
          }
        }

        // Movable HVAC units contribution (AC Split, Ceiling Fan, Stand Fan, Wall Fan, Exhaust Fan)
        for (const h of activeHvac) {
          const speedMult = h.speedLevel === 1 ? 0.7 : h.speedLevel === 2 ? 1.0 : 1.3;
          const dx = px - h.position.x;
          const dz = pz - h.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 5.0) continue;
          if (airflowBlockedByWalls(h.position.x, h.position.z, px, pz, lv.walls)) continue;

          if (h.type === "ceiling_fan" && dist < 3.8) {
            // Radial downdraft + swirl
            const falloff = Math.exp(-dist * 0.6) * speedMult;
            const r = Math.max(0.2, dist);
            vx += ((dx / r) * 0.82 - (dz / r) * 0.48) * falloff;
            vz += ((dz / r) * 0.82 + (dx / r) * 0.48) * falloff;
            cellTemp -= 1.8 * falloff; // convective wind chill
          } else if ((h.type === "stand_fan" || h.type === "wall_fan") && dist < 4.6) {
            const dirX = Math.sin(h.rotationY);
            const dirZ = Math.cos(h.rotationY);
            const proj = dx * dirX + dz * dirZ;
            const perp = Math.abs(dx * -dirZ + dz * dirX);
            if (proj >= -0.25 && perp < 1.5) {
              const cone = Math.exp(-Math.max(0, proj) * 0.4) * Math.exp(-perp * 0.95) * speedMult;
              const boost = h.type === "wall_fan" ? 1.75 : 1.6;
              vx += dirX * boost * cone;
              vz += dirZ * boost * cone;
              cellTemp -= 1.6 * cone;
            }
          } else if (h.type === "ac_split" && dist < 4.8) {
            const dirX = Math.sin(h.rotationY);
            const dirZ = Math.cos(h.rotationY);
            const proj = dx * dirX + dz * dirZ;
            const perp = Math.abs(dx * -dirZ + dz * dirX);
            if (proj >= -0.45 && perp < 2.5) {
              const zoneEffect = Math.exp(-dist * 0.32) * speedMult;
              vx += dirX * 1.0 * zoneEffect;
              vz += dirZ * 1.0 * zoneEffect;
              const deltaT = Math.max(0, cellTemp - h.setpointC);
              cellTemp -= deltaT * Math.min(0.9, zoneEffect * 0.88);
            }
          } else if (h.type === "exhaust_fan" && dist < 2.6) {
            const pull = Math.exp(-dist * 0.85) * speedMult;
            const r = Math.max(0.2, dist);
            vx -= (dx / r) * 0.95 * pull;
            vz -= (dz / r) * 0.95 * pull;
          }
        }

        // Wall obstacle damping: slow near left/right party walls
        if (px < 0.2 || px > 4.8) {
          vx *= 0.2;
          vz *= 0.4;
        }

        velX[idx] = vx;
        velZ[idx] = vz;
        temp[idx] = Math.max(17, Math.min(39, cellTemp));
      }
    }

    return { velX, velZ, temp };
  };

  const lt1 = solveLevelField(0);
  const lt2 = solveLevelField(1);

  const zones: ZoneAirflowResult[] = [];
  const recommendations: string[] = [];
  let totalCoolingLoadW = 0;
  let totalHvacPowerW = 0;

  for (const lv of project.levels) {
    for (const h of lv.hvac) {
      if (h.on) {
        totalHvacPowerW += h.powerW;
        totalCoolingLoadW += h.coolingCapacityW;
      }
    }
  }

  for (const fl of floors) {
    const field = fl.levelIndex === 0 ? lt1 : lt2;
    const lv = project.levels[fl.levelIndex]!;

    for (const rm of fl.rooms) {
      if (rm.room.program === "void") continue;
      const volumeM3 = rm.netAreaM2 * rm.room.ceilingHeight;
      const { minX, maxX, minZ, maxZ } = rm.bounds;

      // Sample velocity & temperature across room bounds
      let sumSpeed = 0;
      let sumTemp = 0;
      let cnt = 0;
      const x0 = Math.max(0, Math.floor(minX / 0.2));
      const x1 = Math.min(gridW - 1, Math.floor(maxX / 0.2));
      const z0 = Math.max(0, Math.floor(minZ / 0.2));
      const z1 = Math.min(gridD - 1, Math.floor(maxZ / 0.2));

      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const cx = (x + 0.5) * 0.2;
          const cz = (z + 0.5) * 0.2;
          if (!pointInPolygon({ x: cx, z: cz }, rm.room.polygon)) continue;
          const idx = z * gridW + x;
          sumSpeed += Math.hypot(field.velX[idx] ?? 0, field.velZ[idx] ?? 0);
          sumTemp += field.temp[idx] ?? sim.ambientTempC;
          cnt++;
        }
      }

      const avgVel = cnt > 0 ? sumSpeed / cnt : 0.1;
      const avgTemp = cnt > 0 ? sumTemp / cnt : sim.ambientTempC;

      const roomHvac = lv.hvac.filter((h) => {
        if (!h.on) return false;
        if (pointInPolygon({ x: h.position.x, z: h.position.z }, rm.room.polygon)) return true;
        // Include wall-mounted units facing into this room (within 0.25m of room boundary and unblocked toward room centroid)
        const nearBbox =
          h.position.x >= minX - 0.25 &&
          h.position.x <= maxX + 0.25 &&
          h.position.z >= minZ - 0.25 &&
          h.position.z <= maxZ + 0.25;
        if (!nearBbox) return false;
        const probeX = h.position.x + Math.sin(h.rotationY) * 0.35;
        const probeZ = h.position.z + Math.cos(h.rotationY) * 0.35;
        return pointInPolygon({ x: probeX, z: probeZ }, rm.room.polygon);
      });
      const hasAc = roomHvac.some((h) => h.type === "ac_split");
      const hasFan = roomHvac.some((h) => h.type === "ceiling_fan" || h.type === "stand_fan" || h.type === "wall_fan");
      const hasExhaust = roomHvac.some((h) => h.type === "exhaust_fan");
      const mechFlowM3h = roomHvac.reduce((s, h) => s + (h.type === "ac_split" ? h.flowRateM3h * 0.28 : h.flowRateM3h * 0.48), 0);

      const isOpenProgram =
        rm.room.program === "garden" || rm.room.program === "carport" || rm.room.program === "balcony";
      const naturalFlowM3h = isOpenProgram
        ? volumeM3 * 25
        : (rm.windowAreaM2 * 0.5 + 0.25) * Math.max(0.25, avgVel) * 3600 * 0.28;

      const ach = isOpenProgram
        ? 25
        : Math.max(0.6, Math.min(20, (naturalFlowM3h + mechFlowM3h) / Math.max(4, volumeM3)));

      // Determine genuine cross-ventilation: open path on >= 2 wall directions or forced exhaust / active fan
      let openDirections = 0;
      const seenAxis = new Set<string>();
      for (const w of lv.walls) {
        for (const op of w.openings) {
          if (op.openPct <= 5 && op.kind !== "arch") continue;
          const wLen = Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z) || 1;
          const ox = w.start.x + ((w.end.x - w.start.x) * op.offset) / wLen;
          const oz = w.start.z + ((w.end.z - w.start.z) * op.offset) / wLen;
          if (ox >= minX - 0.25 && ox <= maxX + 0.25 && oz >= minZ - 0.25 && oz <= maxZ + 0.25) {
            const sideTag = Math.abs(w.end.x - w.start.x) >= Math.abs(w.end.z - w.start.z)
              ? (oz <= (minZ + maxZ) * 0.5 ? "N" : "S")
              : (ox <= (minX + maxX) * 0.5 ? "W" : "E");
            seenAxis.add(sideTag);
          }
        }
      }
      openDirections = seenAxis.size;

      const crossVentilated =
        isOpenProgram ||
        openDirections >= 2 ||
        hasExhaust ||
        (hasFan && ach >= 2.8) ||
        (rm.windowAreaM2 >= 0.8 && ach >= 3.5);

      const windChill = Math.min(2.6, Math.max(0, (avgVel - 0.15) * 2.1));
      const effectiveTemp = avgTemp - windChill;

      const occ = rm.room.program === "bedroom" ? 2 : rm.room.program === "living" ? 3 : 1;
      const freshM3h = Math.max(8, ach * volumeM3 * (hasAc ? 0.35 : 0.85));
      const co2Ppm = Math.round(420 + (occ * 18_000) / freshM3h);

      const pmv = Math.max(-2.5, Math.min(2.8, (effectiveTemp - 25.5) * 0.28 + (sim.humidityPct - 60) * 0.012));
      const ppdPct = Math.round(Math.min(99, 5 + 95 * (1 - Math.exp(-0.03353 * Math.pow(pmv, 4) - 0.2179 * Math.pow(pmv, 2)))));

      let comfortStatus: ZoneAirflowResult["comfortStatus"] = "NYAMAN";
      if (hasAc && avgTemp <= 26.2 && co2Ppm <= 1400) comfortStatus = "SEJUK AC";
      else if (ach < 2.2 || co2Ppm > 1200) comfortStatus = "PENGAP";
      else if (effectiveTemp > 29.0 || (hasAc && avgTemp > 27.2)) comfortStatus = "HANGAT";

      zones.push({
        roomId: rm.room.id,
        levelIndex: fl.levelIndex,
        roomName: rm.room.name,
        program: rm.room.program,
        volumeM3,
        ach,
        avgVelocityMs: avgVel,
        effectiveTempC: effectiveTemp,
        airTempC: avgTemp,
        co2Ppm,
        pmv,
        ppdPct,
        crossVentilated,
        comfortStatus,
      });
    }
  }

  const indoor = zones.filter(
    (z) => z.program !== "garden" && z.program !== "carport" && z.program !== "balcony",
  );
  const avgAch = indoor.length > 0 ? indoor.reduce((s, z) => s + z.ach, 0) / indoor.length : 0;
  const crossCount = indoor.filter((z) => z.crossVentilated).length;
  const crossVentPct = indoor.length > 0 ? Math.round((crossCount / indoor.length) * 100) : 0;

  const stuffy = indoor.filter((z) => z.comfortStatus === "PENGAP");
  if (stuffy.length > 0) {
    recommendations.push(
      `${stuffy.map((z) => z.roomName).join(", ")} sirkulasi udaranya lemah (< 2,2 ACH). Geser atau tambah kipas/exhaust fan, atau buka persentase jendela ke arah void/depan.`,
    );
  }
  const highCo2 = indoor.filter((z) => z.co2Ppm > 1000);
  if (highCo2.length > 0) {
    recommendations.push(
      `Estimasi CO₂ di ${highCo2.map((z) => z.roomName).join(", ")} > 1.000 ppm saat AC tertutup — buka roster/ventilasi segar minimal 10%.`,
    );
  }

  const comfortableCount = indoor.filter((z) => z.comfortStatus === "NYAMAN" || z.comfortStatus === "SEJUK AC").length;
  const avgPmvAbs = indoor.length > 0 ? indoor.reduce((s, z) => s + Math.abs(z.pmv), 0) / indoor.length : 0;
  const co2Penalty = highCo2.length * 4;
  const pmvPenalty = Math.max(0, Math.round((avgPmvAbs - 0.5) * 10));
  const airflowScore =
    indoor.length === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            100,
            Math.round((comfortableCount / indoor.length) * 65 + crossVentPct * 0.35) - co2Penalty - pmvPenalty,
          ),
        );

  return {
    zones,
    gridW,
    gridD,
    lt1VelX: lt1.velX,
    lt1VelZ: lt1.velZ,
    lt1Temp: lt1.temp,
    lt2VelX: lt2.velX,
    lt2VelZ: lt2.velZ,
    lt2Temp: lt2.temp,
    avgAch,
    crossVentPct,
    totalCoolingLoadW,
    totalHvacPowerW,
    airflowScore,
    recommendations,
    methodologyNote:
      "Simulasi zonal + grid 2.5D terinspirasi CFD untuk memproyeksikan aliran angin alami, stack effect void, kipas, dan AC yang dipindah-pindah (indikatif SNI 03-6572 & ASHRAE 55; bukan uji CFD tersertifikasi).",
  };
}
