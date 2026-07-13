import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Info } from "lucide-react";

export default function DataEntry() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Data Entry</h1>
        <p className="text-muted-foreground">Record match statistics, player data, and athletic test results.</p>
      </div>

      <Tabs defaultValue="match" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 lg:grid-cols-5 h-auto md:h-10">
          <TabsTrigger value="match">Match</TabsTrigger>
          <TabsTrigger value="player">Player Stats</TabsTrigger>
          <TabsTrigger value="goal">Goal Event</TabsTrigger>
          <TabsTrigger value="testing">Athletic Testing</TabsTrigger>
          <TabsTrigger value="gps" className="hidden lg:flex">GPS Import</TabsTrigger>
        </TabsList>

        <TabsContent value="match" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Match Entry</CardTitle>
              <CardDescription>Log a new fixture and overall team statistics.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-3 bg-muted/20 rounded-lg border border-dashed">
                <Info className="h-8 w-8 text-muted-foreground" />
                <p className="text-muted-foreground">Form implementation connecting to <code className="text-xs">useCreateMatch</code> goes here.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="player" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Player Match Stats</CardTitle>
              <CardDescription>Record minutes played, cards, and appearances for a specific match.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-3 bg-muted/20 rounded-lg border border-dashed">
                <Info className="h-8 w-8 text-muted-foreground" />
                <p className="text-muted-foreground">Form implementation connecting to <code className="text-xs">useCreatePlayerStat</code> goes here.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="goal" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Goal Event Entry</CardTitle>
              <CardDescription>Log detailed tactical information for a scored or conceded goal.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-3 bg-muted/20 rounded-lg border border-dashed">
                <Info className="h-8 w-8 text-muted-foreground" />
                <p className="text-muted-foreground">Form implementation using <code className="text-xs">CONSTANTS.GOAL_TYPES</code> goes here.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="testing" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Athletic Testing</CardTitle>
              <CardDescription>Input jump, sprint, and agility test results.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-3 bg-muted/20 rounded-lg border border-dashed">
                <Info className="h-8 w-8 text-muted-foreground" />
                <p className="text-muted-foreground">Form implementation connecting to <code className="text-xs">useCreateAthleticTest</code> goes here.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="gps" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Catapult GPS Import</CardTitle>
              <CardDescription>Bulk data viewer for imported Catapult session metrics.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-3 bg-muted/20 rounded-lg border border-dashed">
                <p className="text-muted-foreground">Data is imported via backend pipelines. This view displays recent imports.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}
