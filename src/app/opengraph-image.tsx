/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from "next/og";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";
  const shieldSrc = `${baseUrl}/icons/icon-192.png?v=9`;

  return new ImageResponse(
    <div tw="relative flex h-full w-full bg-[#13100e] text-[#faf8f5] p-14">
      <div tw="absolute inset-6 rounded-[28px] border border-white/10" />
      <div tw="absolute right-0 top-0 h-[340px] w-[340px] rounded-full bg-[#00833e]/10 -translate-y-20 translate-x-20" />

      <div tw="relative z-10 flex h-full w-full flex-col justify-between rounded-3xl">
        <div tw="flex items-center gap-7">
          <img src={shieldSrc} width="128" height="128" alt="VerifyMzansi shield" tw="block" />

          <div tw="flex flex-col">
            <div tw="mb-3 text-[22px] font-medium uppercase tracking-[0.34em] text-white/65">
              Trusted Marketplace
            </div>
            <div tw="text-[74px] font-semibold tracking-[-0.06em] leading-none">
              <span tw="color-[#fffaf5]">Verify</span>
              <span tw="color-[#b4e2c0]">Mzansi</span>
            </div>
            <div tw="mt-[18px] h-2 w-28 rounded-full bg-gradient-to-r from-[#ffb81c] via-[#00833e] to-[#006b32]" />
          </div>
        </div>

        <div tw="flex max-w-[820px] flex-col gap-[18px]">
          <div tw="text-[64px] font-bold tracking-[-0.045em] leading-[1.05]">
            South Africa&apos;s verification-first marketplace.
          </div>
          <div tw="text-[28px] leading-[1.35] text-white/80">
            Buy, sell, and discover trusted businesses, deals, and events with more confidence.
          </div>
        </div>
      </div>
    </div>,
    size
  );
}
