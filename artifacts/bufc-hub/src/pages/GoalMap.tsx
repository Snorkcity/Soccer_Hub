import React, { useState, useRef, useEffect } from "react";
import { 
  useListMatches,
  useListGoals,
  useUpdateGoal,
  getListGoalsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Undo2, Save, MapPin } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function GoalMap() {
  const { toast } = useToast();
  const [selectedMatchId, setSelectedMatchId] = useState<number | "">("");
  const [selectedGoalId, setSelectedGoalId] = useState<number | "">("");
  
  const [snapGrid, setSnapGrid] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  
  const [coords, setCoords] = useState<{x: number, y: number} | null>(null);
  
  const { data: matches } = useListMatches({ limit: 50 });
  const goalsParams = { matchId: selectedMatchId as number };
  const { data: goals } = useListGoals(
    goalsParams,
    { query: { enabled: !!selectedMatchId, queryKey: getListGoalsQueryKey(goalsParams) } }
  );

  const updateGoal = useUpdateGoal();
  const svgRef = useRef<SVGSVGElement>(null);

  // When a goal is selected, load its coords
  useEffect(() => {
    if (selectedGoalId && goals) {
      const g = goals.find(g => g.id === selectedGoalId);
      if (g && g.goalX != null && g.goalY != null) {
        setCoords({ x: g.goalX, y: g.goalY });
      } else {
        setCoords(null);
      }
    } else {
      setCoords(null);
    }
  }, [selectedGoalId, goals]);

  const handlePitchClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || !selectedGoalId) return;
    
    const rect = svgRef.current.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    
    // SVG is 100x100 coordinate system in viewbox
    let pctX = (rawX / rect.width) * 100;
    let pctY = (rawY / rect.height) * 100; // Actually, pitch height is up to 100 in viewbox too

    if (snapGrid) {
      pctX = Math.round(pctX / 5) * 5;
      pctY = Math.round(pctY / 5) * 5;
    }

    setCoords({ x: Math.round(pctX), y: Math.round(pctY) });
  };

  const handleSave = () => {
    if (!selectedGoalId || !coords) return;
    
    updateGoal.mutate(
      { 
        id: selectedGoalId, 
        data: { goalX: coords.x, goalY: coords.y } 
      },
      {
        onSuccess: () => {
          toast({ title: "Coordinates Saved", description: `Goal mapped at (${coords.x}, ${coords.y})` });
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to save mapping", variant: "destructive" });
        }
      }
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Goal Map Tool</h1>
          <p className="text-muted-foreground mt-1">Plot goal creation and origin coordinates.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="bg-muted/50 border-b border-border">
          <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
            <div className="flex gap-2 w-full md:w-auto">
              <Select value={selectedMatchId.toString()} onValueChange={(v) => { setSelectedMatchId(Number(v)); setSelectedGoalId(""); }}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select Match" />
                </SelectTrigger>
                <SelectContent>
                  {matches?.map(m => (
                    <SelectItem key={m.id} value={m.id.toString()}>{m.opponent} ({m.matchDate?.split('T')[0]})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select value={selectedGoalId.toString()} onValueChange={(v) => setSelectedGoalId(Number(v))} disabled={!selectedMatchId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select Goal Event" />
                </SelectTrigger>
                <SelectContent>
                  {goals?.map(g => (
                    <SelectItem key={g.id} value={g.id.toString()}>
                      {g.minuteScored}' - {g.scorer || "Unknown"}
                    </SelectItem>
                  ))}
                  {goals?.length === 0 && <SelectItem value="none" disabled>No goals logged</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex gap-4 items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm">Grid</span>
                <Switch checked={showGrid} onCheckedChange={setShowGrid} className="data-[state=checked]:bg-primary" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">Snap</span>
                <Switch checked={snapGrid} onCheckedChange={setSnapGrid} className="data-[state=checked]:bg-primary" />
              </div>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="p-0">
          <div className="relative w-full aspect-[1.3] bg-[#2E8B57]/20 flex items-center justify-center p-4 overflow-hidden">
            {/* Dark background beneath pitch */}
            <div className="absolute inset-0 bg-[#0F2C44]/50 pointer-events-none" />
            
            {!selectedGoalId && (
              <div className="absolute inset-0 z-10 bg-background/60 backdrop-blur-sm flex flex-col items-center justify-center">
                <MapPin className="h-10 w-10 text-muted-foreground mb-2 opacity-50" />
                <p className="text-foreground font-medium">Select a goal event to start mapping</p>
              </div>
            )}

            <svg 
              ref={svgRef}
              viewBox="0 0 100 70" 
              className="w-full h-full max-w-[800px] cursor-crosshair relative z-0 drop-shadow-lg"
              style={{ stroke: 'rgba(255,255,255,0.4)', strokeWidth: 0.5, fill: 'none' }}
              onClick={handlePitchClick}
            >
              {/* Pitch Base - Attacking Half (Right side) */}
              <rect x="0" y="0" width="100" height="70" fill="rgba(135, 206, 235, 0.05)" />
              
              {/* Grid Lines */}
              {showGrid && (
                <g stroke="rgba(255,255,255,0.1)" strokeWidth="0.2">
                  {Array.from({length: 19}).map((_, i) => <line key={`v${i}`} x1={(i+1)*5} y1="0" x2={(i+1)*5} y2="70" />)}
                  {Array.from({length: 13}).map((_, i) => <line key={`h${i}`} x1="0" y1={(i+1)*5} x2="100" y2={(i+1)*5} />)}
                </g>
              )}

              {/* Pitch Markings */}
              <rect x="0" y="0" width="100" height="70" stroke="rgba(255,255,255,0.6)" strokeWidth="0.8" />
              {/* Halfway line */}
              <line x1="0" y1="0" x2="0" y2="70" stroke="rgba(255,255,255,0.6)" strokeWidth="0.8" />
              {/* Center Circle Arc */}
              <path d="M 0 25 A 10 10 0 0 1 0 45" stroke="rgba(255,255,255,0.6)" strokeWidth="0.8" />
              
              {/* Penalty Area */}
              <rect x="82" y="15" width="18" height="40" stroke="rgba(255,255,255,0.6)" strokeWidth="0.8" />
              {/* 6 Yard Box */}
              <rect x="94" y="27" width="6" height="16" stroke="rgba(255,255,255,0.6)" strokeWidth="0.8" />
              {/* Penalty Spot */}
              <circle cx="88" cy="35" r="0.5" fill="rgba(255,255,255,0.8)" stroke="none" />
              {/* Penalty Arc */}
              <path d="M 82 28 A 8 8 0 0 0 82 42" stroke="rgba(255,255,255,0.6)" strokeWidth="0.8" />
              {/* Goal Mouth */}
              <rect x="100" y="31" width="2" height="8" stroke="rgba(255,255,255,0.6)" strokeWidth="0.8" />

              {/* Plotted Point */}
              {coords && (
                <g transform={`translate(${coords.x}, ${coords.y})`}>
                  <circle cx="0" cy="0" r="1.5" fill="hsl(var(--chart-1))" stroke="white" strokeWidth="0.4" className="animate-pulse" />
                  <circle cx="0" cy="0" r="3" fill="hsl(var(--chart-1))" fillOpacity="0.3" stroke="none" />
                </g>
              )}
            </svg>
          </div>
          
          <div className="bg-card border-t border-border p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-sm font-mono bg-muted px-3 py-1.5 rounded-md border border-border">
                X: {coords?.x ?? '--'} | Y: {coords?.y ?? '--'}
              </div>
              <Button variant="ghost" size="icon" onClick={() => setCoords(null)} disabled={!coords}>
                <Undo2 className="h-4 w-4" />
              </Button>
            </div>
            
            <Button onClick={handleSave} disabled={!coords || !selectedGoalId} className="gap-2">
              <Save className="h-4 w-4" /> Save Position
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
