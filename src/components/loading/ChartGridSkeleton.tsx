import Bar from "@/components/loading/SkeletonBar";

export default function ChartGridSkeleton({
	width,
	height,
}: {
	width?: number | string;
	height?: number | string;
}) {
	return (
		<div
			aria-hidden="true"
			className="relative h-full w-full overflow-hidden"
			style={{ width: width ?? "100%", height: height ?? "100%" }}
		>
			<div className="flex h-full flex-col gap-3 px-2 pt-3 pb-1">
				<div className="flex min-h-0 flex-1 flex-col justify-between">
					{[0, 1, 2].map((tick) => (
						<div key={tick} className="flex items-center gap-3">
							<Bar className="h-2 w-5 shrink-0" />
							<div className="h-px flex-1 bg-stone-100 dark:bg-stone-800" />
						</div>
					))}
				</div>
				<div className="flex justify-between pl-8">
					{[0, 1, 2].map((tick) => (
						<Bar key={tick} className="h-2 w-7" />
					))}
				</div>
			</div>
		</div>
	);
}
