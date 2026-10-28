import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function SkeletonBar({ className }: { className: string }) {
	return (
		<Skeleton
			className={cn(
				"rounded-[5px] bg-stone-200/70 motion-reduce:animate-none dark:bg-stone-700/60",
				className,
			)}
		/>
	);
}
