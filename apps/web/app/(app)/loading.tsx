import { PlutoMascot } from "@/components/mascot/pluto-mascot";

export default function AppLoading() {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 px-4" role="status">
      <PlutoMascot mood="thinking" size={96} />
      <p className="text-sm font-bold text-muted-foreground">Warming up…</p>
    </div>
  );
}
