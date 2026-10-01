import { getPublicSponsors } from "@/lib/organisations/sponsors";
import { SponsorStripTrack } from "./sponsor-strip-track";

/**
 * "Programme partners" band. It sits after the showroom in the page file and
 * never inside it, so the showroom's size and cards are unchanged. With no
 * eligible sponsor it renders nothing at all.
 */
export async function SponsorStrip() {
  const sponsors = (await getPublicSponsors()).filter((sponsor) => sponsor.on_strip);
  if (sponsors.length === 0) return null;

  return (
    <section
      aria-labelledby="sponsor-strip-label"
      className="relative overflow-hidden border-y border-white/10 bg-brand-green-950 text-white"
    >
      <div className="container-page flex min-h-[60px] items-center gap-3 py-2">
        <h2
          id="sponsor-strip-label"
          className="shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-gold-300"
        >
          <span className="sm:hidden">Partners</span>
          <span className="hidden sm:inline">Programme partners</span>
        </h2>
        <SponsorStripTrack
          sponsors={sponsors.map(({ id, slug, name, logo_url }) => ({ id, slug, name, logo_url }))}
        />
      </div>
    </section>
  );
}
