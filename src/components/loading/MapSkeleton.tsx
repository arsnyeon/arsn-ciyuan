export default function MapSkeleton() {
	return (
		<section className="mt-8 flex flex-col gap-4" aria-hidden="true">
			<div className="h-4 w-44 animate-pulse rounded bg-muted-foreground/10 motion-reduce:animate-none" />
			<div className="relative aspect-2/1 w-full overflow-hidden rounded-lg border border-border/40 bg-muted/20">
				<div className="absolute inset-0 animate-pulse bg-muted-foreground/5 motion-reduce:animate-none" />
				<div className="absolute left-[8%] top-[38%] h-[26%] w-[24%] rounded-[45%] bg-muted-foreground/10 blur-[2px]" />
				<div className="absolute left-[38%] top-[24%] h-[34%] w-[18%] rounded-[45%] bg-muted-foreground/10 blur-[2px]" />
				<div className="absolute left-[60%] top-[42%] h-[28%] w-[30%] rounded-[45%] bg-muted-foreground/10 blur-[2px]" />
			</div>
		</section>
	);
}
