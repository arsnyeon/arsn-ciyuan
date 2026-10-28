import type React from "react";
import { useRuntimeConfig } from "@/lib/runtime-config";

const THEME_REPOSITORY = "https://github.com/arsnyeon/arsn-ciyuan";

const Footer: React.FC = () => {
	const config = useRuntimeConfig();
	const busuanziUrl = `https://www.busuanzi.cc/count.php?search=${encodeURIComponent(window.location.host)}`;

	return (
		<footer className="mx-auto w-full max-w-5xl px-4 lg:px-0 pb-4 server-footer">
			<div className="arsn-links">
				<span className="arsn-links-label">友情链接</span>
				{config.arsnFooterLinks.map((link) => (
					<a
						key={link.link}
						href={link.link}
						target="_blank"
						rel="noopener noreferrer"
					>
						{link.name}
					</a>
				))}
			</div>
			<section className="flex flex-col">
				<section className="mt-1 flex items-center sm:flex-row flex-col justify-between gap-2 text-[13px] font-light tracking-tight text-neutral-600/50 dark:text-neutral-300/50 server-footer-name">
					<div className="flex items-center gap-1">
						&copy;2020-{new Date().getFullYear()}{" "}
						<a
							href={"https://github.com/naiba/nezha"}
							target="_blank"
							rel="noopener"
						>
							Nezha
						</a>
					</div>
					<div className="server-footer-theme flex flex-col items-center sm:items-end">
						<a
							className="arsn-footer-counter"
							href={busuanziUrl}
							target="_blank"
							rel="noopener noreferrer"
							aria-label="查看不蒜子站点统计"
						>
							<img
								src="https://www.busuanzi.cc/static/images/bsz-tongji.png"
								alt="不蒜子统计"
								width={85}
								height={25}
							/>
						</a>
						<section>
							Theme by{" "}
							<a
								className="arsn-footer-link"
								href={THEME_REPOSITORY}
								target="_blank"
								rel="noopener"
							>
								arsn-ciyuan
							</a>
							{import.meta.env.VITE_GIT_HASH && (
								<a
									href={`${THEME_REPOSITORY}/commit/${import.meta.env.VITE_GIT_HASH}`}
									className="ml-1"
								>
									({import.meta.env.VITE_GIT_HASH})
								</a>
							)}
						</section>
					</div>
				</section>
			</section>
		</footer>
	);
};

export default Footer;
