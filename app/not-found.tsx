import Link from "next/link";

/** An address that doesn't exist (a mistyped or very old link). Old screens' addresses
 *  redirect to their replacements (next.config.ts), so this is genuinely unknown. */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-16">
      <div className="bg-panel border border-border rounded-3 px-16 py-14 max-w-[460px] w-full">
        <div className="flex gap-10">
          <div className="w-3 bg-warn rounded-2 flex-none" />
          <div>
            <h1 className="text-14 font-semibold text-text m-0">There&apos;s no page at this address</h1>
            <p className="text-11.5 text-dim leading-loose mt-3 mb-0">The link may be mistyped, or what it pointed to was removed.</p>
            <Link href="/home" className="inline-block text-11.5 mt-10">
              Go to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
