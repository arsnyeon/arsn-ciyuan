import { useTranslation } from "react-i18next";
import ChartSkeleton from "@/components/loading/ChartSkeleton";
import Bar from "@/components/loading/SkeletonBar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useRuntimeConfig } from "@/lib/runtime-config";
import { cn } from "@/lib/utils";

export default function NetworkChartLoading() {
	const { t } = useTranslation();
	const { backgroundImage } = useRuntimeConfig();
	return (
		<div
			role="status"
			aria-label={t("serviceTracker.loading")}
			aria-busy="true"
		>
			<div aria-hidden="true" className="flex flex-col gap-3">
				<div className="-mt-3 flex flex-wrap items-center gap-3 sm:-mt-5">
					<Bar className="h-8 w-44 rounded-full" />
					<div className="flex items-center gap-2">
						<Bar className="h-5 w-9 rounded-full" />
						<Bar className="h-3 w-16" />
					</div>
				</div>
				<Card className={cn({ "bg-card/70": backgroundImage })}>
					<CardHeader className="flex flex-col items-stretch space-y-0 overflow-hidden rounded-t-lg p-0 sm:flex-row">
						<div className="flex flex-none flex-col justify-center gap-2 border-b px-6 py-4">
							<Bar className="h-4 w-28" />
							<Bar className="h-3 w-20" />
						</div>
						<div className="grid w-full grid-cols-3">
							{[0, 1, 2].map((index) => (
								<div
									key={index}
									className="flex min-w-0 flex-col justify-center gap-2 border-b border-l px-3 py-4 sm:px-5"
								>
									<Bar className="h-3 w-16 max-w-full" />
									<Bar className="h-5 w-20 max-w-full" />
								</div>
							))}
						</div>
					</CardHeader>
					<CardContent className="px-2 py-4 sm:p-6">
						<div className="flex h-[250px] flex-col gap-4">
							<div className="min-h-0 flex-1">
								<ChartSkeleton />
							</div>
							<div className="flex justify-center gap-4">
								{[0, 1, 2].map((index) => (
									<div key={index} className="flex items-center gap-1.5">
										<Bar className="size-2 rounded-full" />
										<Bar className="h-2 w-12" />
									</div>
								))}
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
