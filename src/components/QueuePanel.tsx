import { Check, Download, Loader2, X, AlertCircle, FolderOpen, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { SimonRing } from "./SimonRing";
import type { Job, JobStatus } from "@/lib/tauri";
import { cn } from "@/lib/utils";

function StatusIcon({ status }: { status: JobStatus }) {
  const base = "size-3.5";
  switch (status) {
    case "queued":
      return <Clock className={cn(base, "text-muted-foreground")} />;
    case "downloading":
      return <Download className={cn(base, "text-simon-blue")} />;
    case "merging":
      return <Loader2 className={cn(base, "animate-spin text-simon-blue")} />;
    case "done":
      return <Check className={cn(base, "text-simon-green")} />;
    case "error":
      return <AlertCircle className={cn(base, "text-simon-red")} />;
    default:
      return <X className={base} />;
  }
}

const LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  downloading: "Downloading",
  merging: "Merging",
  done: "Done",
  error: "Failed",
  canceled: "Canceled",
};

function JobRow({ job, onRemove, onOpen }: { job: Job; onRemove: (id: number) => void; onOpen: (p: string) => void }) {
  const active = job.status === "downloading" || job.status === "merging";
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted">
        <StatusIcon status={job.status} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold" title={job.title}>
          {job.title}
        </div>
        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
          {job.format_label}
          {job.detail ? ` · ${job.detail}` : ""}
        </div>
        {active && <Progress value={job.percent} className="mt-2 h-1.5" />}
      </div>
      <div className="flex flex-col items-end gap-1">
        {job.status === "downloading" ? (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {Math.round(job.percent)}%{job.speed ? ` · ${job.speed}` : ""}
            {job.eta ? ` · ${job.eta}` : ""}
          </span>
        ) : (
          <Badge
            variant={job.status === "error" ? "destructive" : "secondary"}
            className={cn(job.status === "done" && "text-simon-green")}
          >
            {LABEL[job.status]}
          </Badge>
        )}
        <div className="flex">
          {job.status === "done" && (
            <Button size="icon" variant="ghost" className="size-6" title="Open folder" onClick={() => onOpen(job.out_dir)}>
              <FolderOpen className="size-3.5" />
            </Button>
          )}
          <Button size="icon" variant="ghost" className="size-6 text-muted-foreground" title="Remove" onClick={() => onRemove(job.id)}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function QueuePanel({
  jobs,
  onRemove,
  onClearFinished,
  onOpen,
}: {
  jobs: Job[];
  onRemove: (id: number) => void;
  onClearFinished: () => void;
  onOpen: (path: string) => void;
}) {
  const finished = jobs.some((j) => j.status === "done" || j.status === "error" || j.status === "canceled");
  return (
    <section className="flex max-h-[38vh] flex-none flex-col overflow-y-auto border-t bg-muted/30 px-4 py-3">
      <div className="sticky top-0 z-10 -mt-1 flex items-center gap-2 bg-muted/30 pb-2 pt-1 backdrop-blur">
        <SimonRing size={18} />
        <h2 className="text-sm font-bold">Download Queue</h2>
        <span className="rounded-full bg-muted-foreground/80 px-2 py-0.5 font-mono text-xs text-background">{jobs.length}</span>
        <Button variant="ghost" size="sm" className="ml-auto h-7 text-muted-foreground" disabled={!finished} onClick={onClearFinished}>
          Clear finished
        </Button>
      </div>
      {jobs.length === 0 ? (
        <p className="px-1 py-3 text-sm text-muted-foreground">Nothing queued yet. Add a download above and it lands here.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} onRemove={onRemove} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}
