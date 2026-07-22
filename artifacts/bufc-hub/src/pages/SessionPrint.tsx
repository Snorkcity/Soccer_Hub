import { useParams, useLocation } from "wouter";
import {
  useGetSession,
  getGetSessionQueryKey,
} from "@workspace/api-client-react";
import type { SessionDetail, SessionPartDetail } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { PracticeDiagram, type DiagramData } from "@/components/PracticeDiagram";
import { ArrowLeft, Printer } from "lucide-react";

/**
 * Print-optimised 2-page landscape session plan matching the coach's PDF
 * format (header strip; p1: Warmup / Introduction / Main part columns;
 * p2: End game, comments, squad list). "Print / Save as PDF" uses the
 * browser's print dialog.
 */

const PART_TITLES: Record<string, string> = {
  warmup: "Warmup",
  activation: "Passing activation",
  introduction: "Introduction",
  main: "Main part",
  endgame: "End game",
};

function getPart(session: SessionDetail, part: string): SessionPartDetail | undefined {
  return session.parts.find((p) => p.part === part);
}

function Lines({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <>
      {text.split("\n").map((line, i) => (
        <p key={i} className="min-h-[1em]">
          {line}
        </p>
      ))}
    </>
  );
}

function LabelledBox({ label, text }: { label: string; text?: string | null }) {
  return (
    <div className="border border-black flex-1 min-w-0 flex flex-col">
      <div className="bg-[#c6d4ec] border-b border-black text-center font-bold px-1">{label}</div>
      <div className="px-1 py-0.5 whitespace-pre-wrap flex-1">
        <Lines text={text} />
      </div>
    </div>
  );
}

function PartColumn({
  session,
  part,
  secondCol,
}: {
  session: SessionDetail;
  part: string;
  secondCol?: { label: string; slot?: SessionPartDetail };
}) {
  const slot = getPart(session, part);
  const second = secondCol ?? {
    label: part === "introduction" ? "Coaching messages" : "Tasks",
    slot,
  };
  const secondText = secondCol ? secondCol.slot?.rules : slot?.tasks;
  return (
    <div className="flex flex-col min-w-0 flex-1 gap-1">
      {slot?.practice && (
        <div className="border border-black">
          <PracticeDiagram diagram={slot.practice.diagram as DiagramData} crop={slot.practice.reviewCrop ?? null} className="w-full h-auto" />
        </div>
      )}
      <div className="text-center font-bold">{PART_TITLES[part]}</div>
      <div className="flex gap-0 flex-1">
        <LabelledBox label="Rules/explanation" text={slot?.rules} />
        <LabelledBox label={second.label} text={secondText} />
      </div>
      <div className="flex gap-0">
        <LabelledBox label="Progressions" text={slot?.progressions} />
        <LabelledBox label="Coaching points" text={slot?.coachingPoints} />
      </div>
      <table className="w-full border-collapse">
        <tbody>
          <tr>
            {["Players", "Size", "Timing"].map((h) => (
              <td key={h} className="border border-black bg-[#c6d4ec] text-center font-bold px-1 w-1/3">
                {h}
              </td>
            ))}
          </tr>
          <tr>
            <td className="border border-black px-1 align-top">{slot?.players}</td>
            <td className="border border-black px-1 align-top whitespace-pre-wrap">{slot?.size}</td>
            <td className="border border-black px-1 align-top">{slot?.timing}</td>
          </tr>
          <tr>
            <td className="border border-black bg-[#c6d4ec] text-center font-bold px-1">Scoring</td>
            <td className="border border-black bg-[#c6d4ec] text-center font-bold px-1">Intensity</td>
            <td className="border border-black" />
          </tr>
          <tr>
            <td className="border border-black px-1 align-top">{slot?.scoring}</td>
            <td className="border border-black px-1 align-top">{slot?.intensity}</td>
            <td className="border border-black" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function HeaderStrip({ session }: { session: SessionDetail }) {
  const cells: Array<[string, string | null | undefined]> = [
    ["Date", session.sessionDate],
    ["Session Title", session.title],
    ["Team", session.team],
    ["Session", session.sessionNumber],
    ["Theme", session.theme],
    ["Cycle", session.cycleCode],
    ["Location", session.location],
    ["Time", session.timeSlot],
  ];
  return (
    <table className="w-full border-collapse mb-2">
      <tbody>
        <tr>
          {cells.map(([label]) => (
            <td key={label} className="border border-black bg-[#c6d4ec] font-bold px-1">
              {label}
            </td>
          ))}
        </tr>
        <tr>
          {cells.map(([label, value]) => (
            <td key={label} className="border border-black px-1">
              {value}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

function SquadTable({ text }: { text?: string | null }) {
  const rows = (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("|").map((c) => c.trim()));
  if (rows.length === 0) return null;
  return (
    <table className="w-full border-collapse">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="border border-black bg-[#c6d4ec] px-1 w-8 text-center">{r[0] ?? ""}</td>
            <td className="border border-black px-1 w-10">{r[1] ?? ""}</td>
            <td className="border border-black px-1">{r[2] ?? ""}</td>
            <td className="border border-black px-1 w-24">{r[3] ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function SessionPrint() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const { data: session, isLoading } = useGetSession(id, {
    query: { queryKey: getGetSessionQueryKey(id), enabled: Number.isInteger(id) },
  });

  if (isLoading) return <div className="p-6">Loading…</div>;
  if (!session) return <div className="p-6">Session not found.</div>;

  const activation = getPart(session, "activation");
  const endgame = getPart(session, "endgame");

  return (
    <div className="bg-neutral-300 min-h-screen print:bg-white">
      <style>{`
        @page { size: A4 landscape; margin: 6mm; }
        @media print {
          .no-print { display: none !important; }
          .print-page { box-shadow: none !important; margin: 0 !important; page-break-after: always; }
          .print-page:last-child { page-break-after: auto; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-10 flex items-center gap-2 p-3 bg-neutral-800 text-white">
        <Button size="sm" variant="secondary" onClick={() => navigate(`/sessions/${session.id}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to editor
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1" /> Print / Save as PDF
        </Button>
        <span className="text-xs text-neutral-300">
          In the print dialog choose "Save as PDF", Landscape.
        </span>
      </div>

      {/* Page 1 */}
      <div className="print-page bg-white text-black text-[9px] leading-tight mx-auto my-4 shadow-lg p-4 w-[285mm] min-h-[196mm]">
        <HeaderStrip session={session} />
        <div className="flex gap-3">
          <PartColumn
            session={session}
            part="warmup"
            secondCol={activation ? { label: "Passing activation", slot: activation } : undefined}
          />
          <PartColumn session={session} part="introduction" />
          <PartColumn session={session} part="main" />
        </div>
      </div>

      {/* Page 2 */}
      <div className="print-page bg-white text-black text-[9px] leading-tight mx-auto my-4 shadow-lg p-4 w-[285mm] min-h-[196mm]">
        <HeaderStrip session={session} />
        <div className="flex gap-3">
          <div className="flex-1 min-w-0">
            <PartColumn session={session} part="endgame" />
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            {activation?.practice && (
              <div className="border border-black">
                <div className="bg-[#c6d4ec] border-b border-black text-center font-bold">Passing activation</div>
                <PracticeDiagram diagram={activation.practice.diagram as DiagramData} crop={activation.practice.reviewCrop ?? null} className="w-full h-auto" />
              </div>
            )}
            <LabelledBox label="Comments" text={session.comments} />
          </div>
          <div className="flex-1 min-w-0">
            <SquadTable text={session.squadText} />
          </div>
        </div>
      </div>
    </div>
  );
}
