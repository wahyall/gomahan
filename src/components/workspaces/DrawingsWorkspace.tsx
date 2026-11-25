"use client";

import { useState } from "react";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import { fmtM, fmtNum } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { BookOpenText, FileStack, Printer, X, ZoomIn, ZoomOut } from "lucide-react";

type SheetId = "denah1" | "denah2" | "potongan" | "struktur";

const SHEETS: { id: SheetId; kode: string; label: string }[] = [
  { id: "denah1", kode: "A-01", label: "Denah LT1" },
  { id: "denah2", kode: "A-02", label: "Denah LT2 & Void" },
  { id: "potongan", kode: "A-03", label: "Potongan" },
  { id: "struktur", kode: "S-01", label: "Struktur SNI" },
];

const S = 52;
const INK = "#22211e";
const SOFT = "#6f6a60";
const FADED = "#b8b2a6";
const DIM = "#8a6d3b";
const PAPER = "#f8f7f2";

export function DrawingsWorkspace({ derived, struct }: { derived: DerivedProjectModel; struct: StructuralReport }) {
  const [sheet, setSheet] = useState<SheetId>("denah1");
  const [showMep, setShowMep] = useState(true);
  const [zoomPct, setZoomPct] = useState(100);
  const [scheduleOpen, setScheduleOpen] = useState(false);

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
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* CAD Drafting Toolbar */}
        <div className="no-print flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-[#151920] px-3 py-1.5">
          <div className="flex items-center gap-1 rounded-lg bg-black/30 p-0.5">
            <FileStack className="mx-1.5 h-3.5 w-3.5 text-primary" />
            {SHEETS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSheet(s.id)}
                className={cn(
                  "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition",
                  sheet === s.id
                    ? "bg-[#f2efe8] font-semibold text-[#14171c] shadow-sm"
                    : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
                )}
              >
                <span className={cn("rounded px-1 font-mono text-[9.5px] font-bold", sheet === s.id ? "bg-black/15" : "bg-black/30")}>
                  {s.kode}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowMep((v) => !v)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition",
              showMep
                ? "border-primary/45 bg-primary/15 text-[#f6ba86]"
                : "border-border bg-secondary/50 text-muted-foreground hover:text-foreground",
            )}
          >
            Overlay Pipa &amp; Listrik
          </button>

          {/* Zoom Controls */}
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-black/25 p-0.5">
            <button
              type="button"
              aria-label="Perkecil lembar"
              onClick={() => setZoomPct((z) => Math.max(70, z - 15))}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoomPct(100)}
              title="Reset zoom 100%"
              className="min-w-11 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-foreground tabular-nums hover:bg-white/[0.06]"
            >
              {zoomPct}%
            </button>
            <button
              type="button"
              aria-label="Perbesar lembar"
              onClick={() => setZoomPct((z) => Math.min(180, z + 15))}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setScheduleOpen((v) => !v)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition xl:hidden",
                scheduleOpen ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary text-foreground",
              )}
            >
              <BookOpenText className="h-3.5 w-3.5" /> Jadwal
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-[#f2efe8] px-3 text-[11px] font-semibold text-[#14171c] shadow-sm transition hover:brightness-95"
            >
              <Printer className="h-3.5 w-3.5 text-[#b9662a]" /> Cetak Lembar
            </button>
          </div>
        </div>

        {/* Drafting Table Background */}
        <div className="min-h-0 flex-1 overflow-auto bg-[#181b21] p-4 sm:p-6">
          <div
            className="mx-auto origin-top shadow-2xl ring-1 ring-black/50 transition-transform duration-150"
            style={{ maxWidth: `${(1060 * zoomPct) / 100}px` }}
          >
            {sheet === "denah1" && <DenahFloorSvg derived={derived} struct={struct} levelIndex={0} showMep={showMep} />}
            {sheet === "denah2" && <DenahFloorSvg derived={derived} struct={struct} levelIndex={1} showMep={showMep} />}
            {sheet === "potongan" && <PotonganMemanjangSvg derived={derived} struct={struct} />}
            {sheet === "struktur" && <StrukturPlanSvg derived={derived} struct={struct} />}
          </div>
        </div>
      </div>

      {/* Right Schedule Sidebar (Always visible xl+, toggleable slide-over below xl) */}
      <aside
        className={cn(
          "no-print min-h-0 w-[310px] shrink-0 flex-col overflow-y-auto border-l border-border bg-[#151920]",
          scheduleOpen ? "absolute bottom-0 right-0 top-0 z-20 flex shadow-2xl xl:static xl:shadow-none" : "hidden xl:flex",
        )}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3.5 text-xs font-semibold text-foreground">
          <span className="flex items-center gap-2">
            <BookOpenText className="h-3.5 w-3.5 text-primary" /> Jadwal Ruang &amp; Bukaan
          </span>
          <button
            type="button"
            aria-label="Tutup jadwal"
            onClick={() => setScheduleOpen(false)}
            className="rounded p-1 text-muted-foreground hover:bg-white/10 xl:hidden"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="space-y-4 p-3.5 text-[11px]">
          <section>
            <h3 className="mb-2 font-semibold text-foreground">Luas Bersih Ruangan</h3>
            <div className="studio-surface overflow-hidden rounded-xl">
              <table className="w-full text-[11px]">
                <thead className="bg-[#1b2029] text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-1.5 text-left">Ruang</th>
                    <th className="px-2.5 py-1.5 text-right">Bersih</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {derived.floors.flatMap((fl) =>
                    fl.rooms.map((r) => (
                      <tr key={r.room.id}>
                        <td className="px-2.5 py-1.5">LT{fl.levelIndex + 1} · {r.room.name}</td>
                        <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-mono font-semibold">{fmtNum(r.netAreaM2, 2)} m²</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="mb-2 font-semibold text-foreground">Jadwal Bukaan ({openingsList.length} item)</h3>
            <div className="studio-surface overflow-hidden rounded-xl">
              <table className="w-full text-[11px]">
                <thead className="bg-[#1b2029] text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-1.5 text-left">Bukaan</th>
                    <th className="px-2.5 py-1.5 text-right">L×T (m)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {openingsList.map((o, i) => (
                    <tr key={i}>
                      <td className="px-2.5 py-1.5">LT{o.lv} · {o.label}</td>
                      <td className="px-2.5 py-1.5 text-right font-mono">{o.w.toFixed(2)}×{o.h.toFixed(2)}</td>
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
  const px = (z: number) => ML + z * S;
  const py = (x: number) => MT + x * S;

  const lv = derived.project.levels[levelIndex]!;
  const rooms = derived.floors[levelIndex]!.rooms;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="h-auto w-full">
      <rect x={0} y={0} width={VW} height={VH} fill={PAPER} />
      <rect x={10} y={10} width={VW - 20} height={VH - 20} fill="none" stroke={INK} strokeWidth={1.6} />

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

      {derived.project.levels[0]!.stairs.map((st) => {
        const dx = st.end.x - st.start.x;
        const dz = st.end.z - st.start.z;
        const sLen = Math.hypot(dx, dz) || 1;
        const nx = (-dz / sLen) * (st.width * 0.48);
        const nz = (dx / sLen) * (st.width * 0.48);
        const midX = (st.start.x + st.end.x) * 0.5;
        const midZ = (st.start.z + st.end.z) * 0.5;
        return (
          <g key={st.id} stroke={SOFT} strokeWidth={0.85}>
            {Array.from({ length: st.riserCount }, (_, i) => {
              const t = i / st.riserCount;
              const cx = st.start.x + dx * t;
              const cz = st.start.z + dz * t;
              return <line key={i} x1={px(cz - nz)} y1={py(cx - nx)} x2={px(cz + nz)} y2={py(cx + nx)} />;
            })}
            <text
              x={px(midZ)}
              y={py(midX) + 3}
              textAnchor="middle"
              fontSize={7.5}
              fontWeight={700}
              fill={DIM}
              paintOrder="stroke"
              stroke={PAPER}
              strokeWidth={2.5}
            >
              {levelIndex === 0 ? "← NAIK" : "TURUN →"}
            </text>
          </g>
        );
      })}

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

      {showMep &&
        lv.mepRoutes.map((rt) => {
          const ortho: { x: number; z: number }[] = [];
          for (let i = 0; i < rt.pts.length; i++) {
            const cur = rt.pts[i]!;
            if (i > 0) {
              const prev = rt.pts[i - 1]!;
              if (Math.abs(cur.x - prev.x) > 0.08 && Math.abs(cur.z - prev.z) > 0.08) {
                ortho.push({ x: prev.x, z: cur.z });
              }
            }
            ortho.push(cur);
          }
          const pts = ortho.map((p) => `${px(p.z)},${py(p.x)}`).join(" ");
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
          const last = ortho[ortho.length - 1];
          return (
            <g key={rt.id} opacity={0.78}>
              <polyline
                points={pts}
                fill="none"
                stroke={col}
                strokeWidth={1.35}
                strokeLinejoin="round"
                strokeDasharray={rt.kind === "air_kotor" ? "5 3" : rt.kind === "listrik_lampu" ? "3 2" : undefined}
              />
              {last && <circle cx={px(last.z)} cy={py(last.x)} r={2.2} fill={col} />}
            </g>
          );
        })}

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
  const lt2Y = lt1Y + (derived.project.levels[0]?.height ?? 3.6);
  const roofSampleZ = [2.4, 6.2, 9.9, 13.7, 17.4];
  const roofTopPts = roofSampleZ.map((z) => `${px(z)},${py(derived.roof.heightAt(2.5, z) + lt1Y + 0.2)}`).join(" ");
  const roofBotPts = [...roofSampleZ].reverse().map((z) => `${px(z)},${py(derived.roof.heightAt(2.5, z) + lt1Y)}`).join(" ");
  const roofTypeName: Record<string, string> = {
    shed_front: `ATAP SHED ${derived.roof.slopeDeg}° MIRING DEPAN`,
    shed_back: `ATAP SHED ${derived.roof.slopeDeg}° MIRING BELAKANG`,
    gable: `ATAP PELANA ${derived.roof.slopeDeg}°`,
    hip: `ATAP LIMAS ${derived.roof.slopeDeg}°`,
    flat_deck: "ATAP DAK BETON DATAR",
  };
  const roofLabel = `${roofTypeName[derived.project.systems.roofType] ?? "ATAP"} (${derived.project.systems.roofCover})`;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="h-auto w-full">
      <rect x={0} y={0} width={VW} height={VH} fill={PAPER} />
      <rect x={10} y={10} width={VW - 20} height={VH - 20} fill="none" stroke={INK} strokeWidth={1.6} />

      <line x1={px(-0.8)} y1={py(0)} x2={px(17.5)} y2={py(0)} stroke={INK} strokeWidth={1.6} />
      <text x={px(-0.6)} y={py(0) - 5} fontSize={7.5} fontWeight={700} fill={DIM}>JALAN ±0,00</text>

      {struct.foundations.slice(0, 7).map((f) => (
        <rect key={f.id} x={px(f.z) - 16} y={py(-0.5)} width={32} height={14} fill="#b8b4aa" stroke={INK} strokeWidth={1} />
      ))}

      <rect x={px(4)} y={py(lt1Y)} width={13 * S} height={lt1Y * 30} fill="#dad6cc" stroke={INK} strokeWidth={1} />
      <text x={px(10.5)} y={py(lt1Y) - 6} fontSize={8} fontWeight={700} fill={INK}>PEIL LT1 +{Math.round(lt1Y * 100)} cm</text>

      <rect x={px(3)} y={py(lt2Y)} width={12.35 * S} height={5} fill="#8f9295" stroke={INK} strokeWidth={1} />
      <text x={px(9)} y={py(lt2Y) - 6} fontSize={8} fontWeight={700} fill={INK}>PELAT LT2 +{fmtM(lt2Y)} m</text>

      <polygon
        points={`${roofBotPts} ${roofTopPts}`}
        fill="#363b40"
        stroke={INK}
        strokeWidth={1.2}
      />
      <text x={px(10.5)} y={py(derived.roof.ridgeElevationM + lt1Y) - 8} textAnchor="middle" fontSize={8} fontWeight={700} fill={DIM}>
        {roofLabel}
      </text>

      <line x1={px(-0.3)} y1={py(lt2Y - 0.85)} x2={px(4.45)} y2={py(lt2Y - 0.25)} stroke="#363b40" strokeWidth={4} />

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
