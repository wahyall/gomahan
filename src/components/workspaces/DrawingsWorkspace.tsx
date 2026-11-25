"use client";

import { useState } from "react";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import { fmtM, fmtNum } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { BookOpenText, FileStack, Printer } from "lucide-react";

type SheetId = "denah1" | "denah2" | "potongan" | "struktur";

const SHEETS: { id: SheetId; kode: string; label: string }[] = [
  { id: "denah1", kode: "A-01", label: "Denah Lantai 1 (5×17 m)" },
  { id: "denah2", kode: "A-02", label: "Denah Lantai 2 & Void" },
  { id: "potongan", kode: "A-03", label: "Potongan Memanjang & Tampak" },
  { id: "struktur", kode: "S-01", label: "Denah Pondasi, Kolom & Balok" },
];

const S = 52; // px per meter (17m * 52 = 884px fits crisp A3 landscape viewBox)
const INK = "#22211e";
const SOFT = "#6f6a60";
const FADED = "#b8b2a6";
const DIM = "#8a6d3b";
const PAPER = "#f8f7f2";

export function DrawingsWorkspace({ derived, struct }: { derived: DerivedProjectModel; struct: StructuralReport }) {
  const [sheet, setSheet] = useState<SheetId>("denah1");
  const [showMep, setShowMep] = useState(true);

  const openingsList = derived.project.levels.flatMap((lv) =>
    lv.walls.flatMap((w) =>
      w.openings.map((o) => ({
        lv: lv.index + 1,
        kind: o.kind === "door" ? "Pintu" : o.kind === "window" ? "Jendela" : "Roster",
        label: o.label,
        w: o.width,
        h: o.height,
        sill: o.sill,
      })),
    ),
  );

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="no-print flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-[#21242a] px-2.5">
          <FileStack className="h-3.5 w-3.5 text-primary" />
          {SHEETS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSheet(s.id)}
              className={cn(
                "flex h-7 shrink-0 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium",
                sheet === s.id ? "bg-primary text-primary-foreground" : "text-stone-300 hover:bg-white/10",
              )}
            >
              <span className="rounded bg-black/25 px-1 font-mono text-[9.5px] font-bold">{s.kode}</span>
              {s.label}
            </button>
          ))}
          <label className="ml-2 flex cursor-pointer items-center gap-1 text-[11px] text-stone-300">
            <input type="checkbox" checked={showMep} onChange={(e) => setShowMep(e.target.checked)} className="accent-[#df8949]" />
            Overlay Pipa & Listrik
          </label>
          <button
            type="button"
            onClick={() => window.print()}
            className="ml-auto flex h-7 items-center gap-1 rounded border border-border bg-card px-2.5 text-[11px] font-medium hover:border-primary"
          >
            <Printer className="h-3.5 w-3.5" /> Cetak Lembar
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-[#1b1e23] p-4 sm:p-6">
          <div className="mx-auto max-w-[1060px] shadow-2xl ring-1 ring-black/50">
            {sheet === "denah1" && <DenahFloorSvg derived={derived} struct={struct} levelIndex={0} showMep={showMep} />}
            {sheet === "denah2" && <DenahFloorSvg derived={derived} struct={struct} levelIndex={1} showMep={showMep} />}
            {sheet === "potongan" && <PotonganMemanjangSvg derived={derived} struct={struct} />}
            {sheet === "struktur" && <StrukturPlanSvg derived={derived} struct={struct} />}
          </div>
        </div>
      </div>

      {/* Right Schedule Sidebar */}
      <aside className="no-print hidden min-h-0 w-[310px] shrink-0 flex-col overflow-y-auto border-l border-border bg-card/50 xl:flex">
        <div className="flex h-10 items-center gap-1.5 border-b border-border px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <BookOpenText className="h-3.5 w-3.5 text-primary" /> Jadwal Ruang & Bukaan
        </div>
        <div className="space-y-4 p-3 text-[11px]">
          <section>
            <h3 className="mb-1.5 font-bold text-foreground">Jadwal Luas Bersih Ruangan</h3>
            <div className="overflow-hidden rounded border border-border">
              <table className="w-full text-[10.5px]">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 text-left">Ruang</th>
                    <th className="px-2 py-1 text-right">Bersih</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {derived.floors.flatMap((fl) =>
                    fl.rooms.map((r) => (
                      <tr key={r.room.id}>
                        <td className="px-2 py-1">LT{fl.levelIndex + 1} · {r.room.name}</td>
                        <td className="px-2 py-1 text-right font-mono font-semibold">{fmtNum(r.netAreaM2, 2)} m²</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="mb-1.5 font-bold text-foreground">Jadwal Bukaan ({openingsList.length} item)</h3>
            <div className="overflow-hidden rounded border border-border">
              <table className="w-full text-[10.5px]">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 text-left">Bukaan</th>
                    <th className="px-2 py-1 text-right">L×T (m)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {openingsList.map((o, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1">LT{o.lv} · {o.label}</td>
                      <td className="px-2 py-1 text-right font-mono">{o.w.toFixed(2)}×{o.h.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

function DenahFloorSvg({
  derived,
  struct,
  levelIndex,
  showMep,
}: {
  derived: DerivedProjectModel;
  struct: StructuralReport;
  levelIndex: 0 | 1;
  showMep: boolean;
}) {
  const ML = 95;
  const MT = 85;
  const VW = ML + 17 * S + 80;
  const VH = MT + 5 * S + 150;
  // Horizontal axis = Z (0 front left -> 17 rear right, matching uploaded plan!), Vertical = X (0..5m)
  const px = (z: number) => ML + z * S;
  const py = (x: number) => MT + x * S;

  const lv = derived.project.levels[levelIndex]!;
  const rooms = derived.floors[levelIndex]!.rooms;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="h-auto w-full">
      <rect x={0} y={0} width={VW} height={VH} fill={PAPER} />
      <rect x={10} y={10} width={VW - 20} height={VH - 20} fill="none" stroke={INK} strokeWidth={1.6} />

      {/* Top Dimension Chains (matching uploaded 5x17 plan!) */}
      {[
        [0, 3, "3,00"],
        [3, 4, "1,00"],
        [4, 7.5, "3,50"],
        [7.5, 12.5, "5,00"],
        [12.5, 15.35, "2,85"],
        [15.35, 17, "1,65"],
      ].map(([a, b, lbl], i) => (
        <HDim key={i} x1={px(Number(a))} x2={px(Number(b))} y={58} label={String(lbl)} />
      ))}
      <HDim x1={px(0)} x2={px(17)} y={36} label="17,00 m" />
      <VDim y1={py(0)} y2={py(5)} x={55} label="5,00 m" />

      {/* Rooms */}
      {rooms.map((rm) => {
        const pts = rm.room.polygon.map((p) => `${px(p.z)},${py(p.x)}`).join(" ");
        const fill =
          rm.room.program === "garden"
            ? "#d9ead3"
            : rm.room.program === "void"
              ? "#ffffff"
              : rm.isWetRoom
                ? "#dce2e8"
                : rm.room.program === "carport"
                  ? "#e0dfdb"
                  : "#f2eee5";
        return (
          <g key={rm.room.id}>
            <polygon points={pts} fill={fill} stroke={FADED} strokeWidth={0.7} />
            {rm.room.program === "void" && (
              <>
                <line x1={px(rm.bounds.minZ)} y1={py(rm.bounds.minX)} x2={px(rm.bounds.maxZ)} y2={py(rm.bounds.maxX)} stroke={SOFT} strokeWidth={0.9} strokeDasharray="4 3" />
                <line x1={px(rm.bounds.maxZ)} y1={py(rm.bounds.minX)} x2={px(rm.bounds.minZ)} y2={py(rm.bounds.maxX)} stroke={SOFT} strokeWidth={0.9} strokeDasharray="4 3" />
              </>
            )}
            <text x={px(rm.centroid.z)} y={py(rm.centroid.x) - 2} textAnchor="middle" fontSize={8} fontWeight={700} fill={INK}>
              {rm.room.name.toUpperCase()}
            </text>
            <text x={px(rm.centroid.z)} y={py(rm.centroid.x) + 8} textAnchor="middle" fontSize={7.2} fill={SOFT}>
              {rm.room.program === "void" ? "VOID TERBUKA" : `${fmtNum(rm.netAreaM2, 2)} m²`}
            </text>
          </g>
        );
      })}

      {/* Stairs */}
      {derived.project.levels[0]!.stairs.map((st) => (
        <g key={st.id} stroke={SOFT} strokeWidth={0.8}>
          {Array.from({ length: st.riserCount }, (_, i) => {
            const z = st.start.z + ((st.end.z - st.start.z) * i) / st.riserCount;
            return <line key={i} x1={px(z)} y1={py(0.15)} x2={px(z)} y2={py(1.25)} />;
          })}
          <text x={px(10.0)} y={py(0.75)} textAnchor="middle" fontSize={7.5} fontWeight={700} fill={DIM}>
            {levelIndex === 0 ? "← NAIK" : "TURUN →"}
          </text>
        </g>
      ))}

      {/* Walls */}
      {lv.walls.map((w) => (
        <line
          key={w.id}
          x1={px(w.start.z)}
          y1={py(w.start.x)}
          x2={px(w.end.z)}
          y2={py(w.end.x)}
          stroke={w.exterior ? INK : "#555049"}
          strokeWidth={Math.max(3, w.thickness * S)}
          strokeLinecap="square"
        />
      ))}

      {/* Columns */}
      {struct.columns
        .filter((c) => c.minLevel <= levelIndex && c.maxLevel >= levelIndex)
        .map((c) => (
          <rect
            key={c.id}
            x={px(c.z) - 4}
            y={py(c.x) - 4}
            width={8}
            height={8}
            fill={c.isMain ? "#c9522e" : INK}
            stroke={PAPER}
            strokeWidth={0.7}
          />
        ))}

      {/* Openings */}
      {lv.walls.flatMap((w) => {
        const len = Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
        return w.openings.map((o) => {
          const t = len > 0 ? o.offset / len : 0;
          const x = w.start.x + (w.end.x - w.start.x) * t;
          const z = w.start.z + (w.end.z - w.start.z) * t;
          return (
            <circle
              key={o.id}
              cx={px(z)}
              cy={py(x)}
              r={o.kind === "door" ? 6 : o.kind === "window" ? 4.5 : 3}
              fill={o.kind === "door" ? "#fff" : o.kind === "window" ? "#7dd3fc" : "#a3e635"}
              stroke={INK}
              strokeWidth={1.1}
            />
          );
        });
      })}

      {/* MEP X-Ray Overlay */}
      {showMep &&
        lv.mepRoutes.map((rt) => {
          const pts = rt.pts.map((p) => `${px(p.z)},${py(p.x)}`).join(" ");
          const col =
            rt.kind === "air_bersih"
              ? "#0284c7"
              : rt.kind === "air_kotor"
                ? "#059669"
                : rt.kind === "air_hujan"
                  ? "#475569"
                  : rt.kind === "listrik_lampu"
                    ? "#d97706"
                    : "#dc2626";
          return <polyline key={rt.id} points={pts} fill="none" stroke={col} strokeWidth={1.6} strokeDasharray={rt.kind === "air_kotor" ? "5 3" : undefined} />;
        })}

      {/* Neighbor labels */}
      <text x={px(8.5)} y={py(0) - 10} textAnchor="middle" fontSize={7.5} fontWeight={700} fill={SOFT}>
        BATAS TEMBOK TETANGGA SISI KIRI (TANPA JENDELA)
      </text>
      <text x={px(8.5)} y={py(5) + 16} textAnchor="middle" fontSize={7.5} fontWeight={700} fill={SOFT}>
        BATAS TEMBOK TETANGGA SISI KANAN (TANPA JENDELA)
      </text>

      <TitleBlock
        x={VW - 290}
        y={VH - 22}
        judul={`DENAH LANTAI ${levelIndex + 1} (5×17 M — 3 KT)`}
        kode={levelIndex === 0 ? "A-01" : "A-02"}
        rev={derived.project.structuralParams.drawingRevision}
      />
      <text x={24} y={VH - 30} fontSize={8} fill={SOFT}>
        Bata: {derived.project.systems.brick.name} ({derived.project.systems.brick.lengthMm}×{derived.project.systems.brick.heightMm}×{derived.project.systems.brick.depthMm} mm, nat {derived.project.systems.brick.mortarMm} mm) · Total Luas Bersih: {fmtNum(derived.totalNetFloorM2, 2)} m²
      </text>
    </svg>
  );
}

function PotonganMemanjangSvg({ derived, struct }: { derived: DerivedProjectModel; struct: StructuralReport }) {
  const ML = 95;
  const baseY = 385;
  const VW = ML + 17 * S + 80;
  const VH = 490;
  const px = (z: number) => ML + z * S;
  const py = (elevM: number) => baseY - elevM * 30;
  const peil = derived.project.site.peil;
  const lt1Y = peil.floor1PeilM;
  const lt2Y = lt1Y + 3.6;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="h-auto w-full">
      <rect x={0} y={0} width={VW} height={VH} fill={PAPER} />
      <rect x={10} y={10} width={VW - 20} height={VH - 20} fill="none" stroke={INK} strokeWidth={1.6} />

      {/* Street & Ground datum */}
      <line x1={px(-0.8)} y1={py(0)} x2={px(17.5)} y2={py(0)} stroke={INK} strokeWidth={1.6} />
      <text x={px(-0.6)} y={py(0) - 5} fontSize={7.5} fontWeight={700} fill={DIM}>JALAN ±0,00</text>

      {/* Foundations */}
      {struct.foundations.slice(0, 7).map((f) => (
        <rect key={f.id} x={px(f.z) - 16} y={py(-0.5)} width={32} height={14} fill="#b8b4aa" stroke={INK} strokeWidth={1} />
      ))}

      {/* LT1 Plinth & Floor */}
      <rect x={px(4)} y={py(lt1Y)} width={13 * S} height={lt1Y * 30} fill="#dad6cc" stroke={INK} strokeWidth={1} />
      <text x={px(10.5)} y={py(lt1Y) - 6} fontSize={8} fontWeight={700} fill={INK}>PEIL LT1 +{Math.round(lt1Y * 100)} cm</text>

      {/* LT2 Slab */}
      <rect x={px(3)} y={py(lt2Y)} width={12.35 * S} height={5} fill="#8f9295" stroke={INK} strokeWidth={1} />
      <text x={px(9)} y={py(lt2Y) - 6} fontSize={8} fontWeight={700} fill={INK}>PELAT LT2 +{fmtM(lt2Y)} m</text>

      {/* Shed Roof 10° Forward */}
      <polygon
        points={`${px(2.4)},${py(derived.roof.heightAt(2.5, 2.4) + lt1Y)} ${px(17.4)},${py(derived.roof.heightAt(2.5, 17.4) + lt1Y)} ${px(17.4)},${py(derived.roof.heightAt(2.5, 17.4) + lt1Y + 0.2)} ${px(2.4)},${py(derived.roof.heightAt(2.5, 2.4) + lt1Y + 0.2)}`}
        fill="#363b40"
        stroke={INK}
        strokeWidth={1.2}
      />
      <text x={px(10.5)} y={py(derived.roof.ridgeElevationM + lt1Y) - 8} fontSize={8} fontWeight={700} fill={DIM}>
        ATAP SHED {derived.roof.slopeDeg}° MIRING KE DEPAN ({derived.project.systems.roofCover})
      </text>

      {/* Carport Canopy */}
      <line x1={px(-0.4)} y1={py(lt2Y - 0.8)} x2={px(4.5)} y2={py(lt2Y - 0.1)} stroke="#363b40" strokeWidth={4} />

      <TitleBlock x={VW - 290} y={VH - 20} judul="POTONGAN MEMANJANG A-A (5×17 M)" kode="A-03" rev={derived.project.structuralParams.drawingRevision} />
    </svg>
  );
}

function StrukturPlanSvg({ derived, struct }: { derived: DerivedProjectModel; struct: StructuralReport }) {
  const ML = 95;
  const MT = 80;
  const VW = ML + 17 * S + 80;
  const VH = MT + 5 * S + 150;
  const px = (z: number) => ML + z * S;
  const py = (x: number) => MT + x * S;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="h-auto w-full">
      <rect x={0} y={0} width={VW} height={VH} fill={PAPER} />
      <rect x={10} y={10} width={VW - 20} height={VH - 20} fill="none" stroke={INK} strokeWidth={1.6} />

      {/* Beams */}
      {struct.beams
        .filter((b) => b.kind === "sloof" || b.kind === "balok_induk")
        .map((b) => (
          <line
            key={b.id}
            x1={px(b.start.z)}
            y1={py(b.start.x)}
            x2={px(b.end.z)}
            y2={py(b.end.x)}
            stroke={b.kind === "sloof" ? "#94a3b8" : "#2563eb"}
            strokeWidth={b.kind === "balok_induk" ? 2.5 : 4.5}
          />
        ))}

      {/* Foundations & Columns */}
      {struct.foundations.map((f) => (
        <rect
          key={f.id}
          x={px(f.z) - 18}
          y={py(f.x) - 18}
          width={36}
          height={36}
          fill="none"
          stroke="#dc2626"
          strokeWidth={1.2}
          strokeDasharray="4 2"
        />
      ))}
      {struct.columns.map((c) => (
        <g key={c.id}>
          <rect x={px(c.z) - 5} y={py(c.x) - 5} width={10} height={10} fill={c.isMain ? "#dc2626" : INK} />
          <text x={px(c.z) + 7} y={py(c.x) - 5} fontSize={6.5} fill={INK}>
            {c.id}
          </text>
        </g>
      ))}

      <TitleBlock x={VW - 290} y={VH - 20} judul="DENAH STRUKTUR, PONDASI & BALOK SNI" kode="S-01" rev={derived.project.structuralParams.drawingRevision} />
      <text x={24} y={VH - 30} fontSize={8} fill={SOFT}>
        Sistem: {struct.systemLabel} · Total Beton {fmtNum(struct.concreteVolumes.totalConcreteM3, 2)} m³ · Total Besi {fmtNum(struct.totalRebarKg, 0)} kg
      </text>
    </svg>
  );
}

function HDim({ x1, x2, y, label }: { x1: number; x2: number; y: number; label: string }) {
  return (
    <g stroke={DIM} strokeWidth={0.9} fill={DIM}>
      <line x1={x1} y1={y} x2={x2} y2={y} />
      <line x1={x1} y1={y - 4} x2={x1} y2={y + 4} />
      <line x1={x2} y1={y - 4} x2={x2} y2={y + 4} />
      <text x={(x1 + x2) / 2} y={y - 4} textAnchor="middle" fontSize={8} fontWeight={700} stroke="none">
        {label}
      </text>
    </g>
  );
}

function VDim({ y1, y2, x, label }: { y1: number; y2: number; x: number; label: string }) {
  return (
    <g stroke={DIM} strokeWidth={0.9} fill={DIM}>
      <line x1={x} y1={y1} x2={x} y2={y2} />
      <line x1={x - 4} y1={y1} x2={x + 4} y2={y1} />
      <line x1={x - 4} y1={y2} x2={x + 4} y2={y2} />
      <text x={x - 6} y={(y1 + y2) / 2} textAnchor="middle" fontSize={8} fontWeight={700} stroke="none" transform={`rotate(-90 ${x - 6} ${(y1 + y2) / 2})`}>
        {label}
      </text>
    </g>
  );
}

function TitleBlock({ x, y, judul, kode, rev }: { x: number; y: number; judul: string; kode: string; rev: string }) {
  return (
    <g>
      <rect x={x} y={y - 54} width={270} height={54} fill={PAPER} stroke={INK} strokeWidth={1.2} />
      <text x={x + 8} y={y - 38} fontSize={7.5} fontWeight={700} fill={SOFT}>RUMAH STUDIO 3D — SURABAYA 5×17 M</text>
      <text x={x + 8} y={y - 23} fontSize={8.5} fontWeight={700} fill={INK}>{judul}</text>
      <text x={x + 8} y={y - 8} fontSize={7.5} fill={SOFT}>LEMBAR: {kode} · REVISI: {rev} · SATUAN: METER</text>
    </g>
  );
}
