import type { ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";

const palette = {
  green: "#00833e",
  greenDeep: "#075c34",
  mint: "#dff6e9",
  gold: "#ffb81c",
  blue: "#002395",
  sky: "#dbeafe",
  ink: "#090b0f",
  slate: "#162033",
  paper: "#f7f3e8",
  white: "#ffffff",
  textDark: "#0f172a",
  textSoft: "rgba(255,255,255,0.78)",
  darkSoft: "rgba(15,23,42,0.72)",
};

const assets = {
  logo: staticFile("images/logo-inverse.png"),
  logoColor: staticFile("images/logo-transparent.png"),
  flag: staticFile("images/South African flag with confetti burst.png"),
  audioBed: staticFile("audio/verify-mzansi-launch-bed.wav"),
  heroBusiness: staticFile("images/fallbacks/hero-business.svg"),
  heroListing: staticFile("images/fallbacks/hero-listing.svg"),
  heroShop: staticFile("images/fallbacks/hero-shop.svg"),
  sideBusiness: staticFile("images/fallbacks/side-card-list-business.svg"),
  sideEvent: staticFile("images/fallbacks/side-card-promote-event.svg"),
  sideMarket: staticFile("images/fallbacks/side-card-sell-market.svg"),
  sideTrust: staticFile("images/fallbacks/side-card-trusted-marketplace.svg"),
};

const ease = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.2, 0.8, 0.2, 1),
  });

const Scene = ({ children, background }: { children: ReactNode; background?: string }) => (
  <AbsoluteFill
    style={{
      background: background ?? palette.ink,
      fontFamily: '"Segoe UI", "Trebuchet MS", system-ui, sans-serif',
      color: palette.white,
      overflow: "hidden",
    }}
  >
    {children}
  </AbsoluteFill>
);

const Grain = () => (
  <AbsoluteFill
    style={{
      backgroundImage: `url(${staticFile("noise.png")})`,
      backgroundSize: 260,
      opacity: 0.1,
      mixBlendMode: "overlay",
    }}
  />
);

const FrameLabel = ({ children, light = false }: { children: ReactNode; light?: boolean }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      padding: "14px 22px",
      borderRadius: 999,
      background: light ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.08)",
      border: light ? "1px solid rgba(15,23,42,0.08)" : "1px solid rgba(255,255,255,0.12)",
      color: light ? palette.textDark : palette.white,
      fontSize: 24,
      fontWeight: 800,
      letterSpacing: 3,
      textTransform: "uppercase",
      backdropFilter: "blur(16px)",
    }}
  >
    {children}
  </div>
);

const BigCopy = ({ children, dark = false }: { children: ReactNode; dark?: boolean }) => (
  <div
    style={{
      color: dark ? palette.textDark : palette.white,
      fontSize: 92,
      lineHeight: 0.96,
      fontWeight: 850,
      letterSpacing: 0,
    }}
  >
    {children}
  </div>
);

const BodyCopy = ({ children, dark = false }: { children: ReactNode; dark?: boolean }) => (
  <div
    style={{
      color: dark ? palette.darkSoft : palette.textSoft,
      fontSize: 34,
      lineHeight: 1.34,
      fontWeight: 500,
    }}
  >
    {children}
  </div>
);

const AccentBar = ({ light = false }: { light?: boolean }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "1.4fr 0.7fr 0.9fr 0.45fr",
      gap: 10,
      width: "100%",
      height: 10,
      opacity: light ? 0.95 : 0.9,
    }}
  >
    {[palette.green, palette.gold, palette.blue, light ? palette.greenDeep : palette.white].map(
      (color) => (
        <div key={color} style={{ borderRadius: 999, background: color }} />
      )
    )}
  </div>
);

const AudioBed = () => (
  <Audio
    src={assets.audioBed}
    volume={(frame) =>
      interpolate(frame, [0, 30, 405, 449], [0, 0.32, 0.32, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    }
  />
);

const MetricPill = ({
  label,
  value,
  frame,
  index,
  light = false,
}: {
  label: string;
  value: string;
  frame: number;
  index: number;
  light?: boolean;
}) => {
  const enter = ease(frame, 16 + index * 7, 38 + index * 7);

  return (
    <div
      style={{
        padding: "20px 22px",
        borderRadius: 24,
        background: light ? "rgba(255,255,255,0.78)" : "rgba(255,255,255,0.1)",
        border: light ? "1px solid rgba(15,23,42,0.08)" : "1px solid rgba(255,255,255,0.14)",
        color: light ? palette.textDark : palette.white,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 34}px)`,
      }}
    >
      <div style={{ fontSize: 34, lineHeight: 1, fontWeight: 900 }}>{value}</div>
      <div
        style={{
          marginTop: 8,
          fontSize: 21,
          lineHeight: 1.2,
          color: light ? palette.darkSoft : palette.textSoft,
        }}
      >
        {label}
      </div>
    </div>
  );
};

const DeviceFrame = ({
  src,
  width,
  height,
  borderRadius,
  rotate = 0,
  frame,
  delay = 0,
  fit = "cover",
}: {
  src: string;
  width: number;
  height: number;
  borderRadius: number;
  rotate?: number;
  frame: number;
  delay?: number;
  fit?: "cover" | "contain";
}) => {
  const enter = spring({
    fps: 30,
    frame: Math.max(0, frame - delay),
    config: { damping: 16, mass: 0.9, stiffness: 116 },
  });

  return (
    <div
      style={{
        width,
        height,
        padding: 16,
        borderRadius,
        background: "rgba(255,255,255,0.96)",
        boxShadow: "0 46px 98px rgba(0,0,0,0.28)",
        transform: `translateY(${(1 - enter) * 84}px) rotate(${rotate}deg) scale(${0.93 + enter * 0.07})`,
        opacity: enter,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: borderRadius - 14,
          overflow: "hidden",
          background: "#fff",
        }}
      >
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: fit }} />
      </div>
    </div>
  );
};

const StepCard = ({
  eyebrow,
  title,
  body,
  index,
  frame,
}: {
  eyebrow: string;
  title: string;
  body: string;
  index: number;
  frame: number;
}) => {
  const enter = ease(frame, 8 + index * 8, 30 + index * 8);
  const accent = [palette.green, palette.gold, palette.blue, palette.mint][index];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "72px 1fr",
        gap: 18,
        padding: "24px 26px",
        borderRadius: 28,
        background: "rgba(255,255,255,0.09)",
        border: "1px solid rgba(255,255,255,0.13)",
        boxShadow: "0 26px 68px rgba(0,0,0,0.18)",
        opacity: enter,
        transform: `translateX(${(1 - enter) * -42}px)`,
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: accent,
          color: index === 3 ? palette.textDark : palette.white,
          fontSize: 28,
          fontWeight: 950,
        }}
      >
        {eyebrow}
      </div>
      <div>
        <div style={{ fontSize: 31, fontWeight: 900, lineHeight: 1.05, marginBottom: 9 }}>
          {title}
        </div>
        <div style={{ color: palette.textSoft, fontSize: 24, lineHeight: 1.28 }}>{body}</div>
      </div>
    </div>
  );
};

const LaunchRevealIntro = () => {
  const frame = useCurrentFrame();
  const title = spring({ fps: 30, frame, config: { damping: 17, mass: 1, stiffness: 92 } });
  const drift = interpolate(frame, [0, 145], [0, -72], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Scene background={`linear-gradient(180deg, ${palette.slate} 0%, ${palette.ink} 100%)`}>
      <Img
        src={assets.heroShop}
        style={{
          position: "absolute",
          inset: -120,
          width: 1320,
          height: 2160,
          objectFit: "cover",
          opacity: 0.42,
          transform: `translateY(${drift}px) scale(1.04)`,
        }}
      />
      <Img
        src={assets.flag}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.16,
          mixBlendMode: "screen",
        }}
      />
      <AbsoluteFill
        style={{
          background: "linear-gradient(180deg, rgba(9,11,15,0.28) 0%, rgba(9,11,15,0.96) 92%)",
        }}
      />
      <Grain />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          padding: 82,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <Img src={assets.logo} style={{ width: 290, objectFit: "contain" }} />
          <FrameLabel>Launch film 01</FrameLabel>
        </div>
        <AccentBar />
        <div
          style={{ maxWidth: 850, opacity: title, transform: `translateY(${(1 - title) * 70}px)` }}
        >
          <FrameLabel>Now opening to Mzansi</FrameLabel>
          <div style={{ height: 24 }} />
          <BigCopy>One trusted place for local opportunity.</BigCopy>
          <div style={{ height: 28 }} />
          <BodyCopy>
            Buy, sell, promote, and discover businesses, events, services, and listings with
            confidence.
          </BodyCopy>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          <MetricPill frame={frame} index={0} value="Market" label="classifieds and local deals" />
          <MetricPill frame={frame} index={1} value="Business" label="profiles, shops, services" />
          <MetricPill frame={frame} index={2} value="Tourism" label="places, events, experiences" />
        </div>
      </div>
    </Scene>
  );
};

const LaunchRevealSurfaces = () => {
  const frame = useCurrentFrame();

  return (
    <Scene background={`linear-gradient(180deg, ${palette.paper} 0%, ${palette.sky} 100%)`}>
      <div style={{ height: "100%", padding: 72, color: palette.textDark }}>
        <FrameLabel light>Marketplace, business, tourism</FrameLabel>
        <div style={{ height: 20 }} />
        <BigCopy dark>Launch with a full public experience.</BigCopy>
        <div style={{ height: 20 }} />
        <BodyCopy dark>
          Real screens, real routes, and a clearer path for people to discover what is happening
          around them.
        </BodyCopy>
        <div style={{ position: "relative", height: 1040, marginTop: 24 }}>
          <div style={{ position: "absolute", left: 0, top: 80, width: 420 }}>
            <AccentBar light />
          </div>
          <div style={{ position: "absolute", left: 14, bottom: 28 }}>
            <DeviceFrame
              src={assets.sideTrust}
              width={330}
              height={710}
              borderRadius={58}
              rotate={-7}
              frame={frame}
              delay={2}
              fit="cover"
            />
          </div>
          <div style={{ position: "absolute", left: 300, bottom: 252 }}>
            <DeviceFrame
              src={assets.heroListing}
              width={670}
              height={450}
              borderRadius={38}
              rotate={-2}
              frame={frame}
              delay={10}
              fit="cover"
            />
          </div>
          <div style={{ position: "absolute", right: 8, bottom: 34 }}>
            <DeviceFrame
              src={assets.heroBusiness}
              width={548}
              height={538}
              borderRadius={40}
              rotate={4}
              frame={frame}
              delay={18}
              fit="cover"
            />
          </div>
        </div>
      </div>
    </Scene>
  );
};

const LaunchRevealClose = () => {
  const frame = useCurrentFrame();
  const logo = spring({ fps: 30, frame, config: { damping: 14, mass: 1, stiffness: 100 } });

  return (
    <Scene
      background={`linear-gradient(180deg, ${palette.greenDeep} 0%, ${palette.slate} 58%, ${palette.ink} 100%)`}
    >
      <Grain />
      <Img
        src={assets.flag}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.22,
        }}
      />
      <AbsoluteFill
        style={{
          background: "linear-gradient(180deg, rgba(9,11,15,0.24) 0%, rgba(9,11,15,0.88) 100%)",
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          padding: 86,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 30,
        }}
      >
        <Img
          src={assets.logo}
          style={{
            width: 360,
            objectFit: "contain",
            transform: `scale(${0.94 + logo * 0.06})`,
            opacity: logo,
          }}
        />
        <BigCopy>VerifyMzansi launches the new local way to be found.</BigCopy>
        <BodyCopy>
          For safer local trade, stronger business visibility, and community discovery that feels
          proudly South African.
        </BodyCopy>
        <div style={{ width: 560 }}>
          <AccentBar />
        </div>
        <div style={{ marginTop: 20, fontSize: 38, fontWeight: 850, color: palette.gold }}>
          verifymzansi.com
        </div>
      </div>
    </Scene>
  );
};

const HowItWorksIntro = () => {
  const frame = useCurrentFrame();

  return (
    <Scene background={`linear-gradient(180deg, ${palette.ink} 0%, ${palette.slate} 100%)`}>
      <Grain />
      <div
        style={{
          height: "100%",
          padding: 82,
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          gap: 36,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <Img src={assets.logo} style={{ width: 286, objectFit: "contain" }} />
          <FrameLabel>Launch film 02</FrameLabel>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "0.92fr 1.08fr",
            gap: 34,
            alignItems: "center",
          }}
        >
          <div>
            <FrameLabel>Explainer</FrameLabel>
            <div style={{ height: 22 }} />
            <BigCopy>How VerifyMzansi works in the real world.</BigCopy>
            <div style={{ height: 24 }} />
            <BodyCopy>
              People search locally, businesses publish confidently, and trust checks support every
              important step.
            </BodyCopy>
            <div style={{ height: 34 }} />
            <AccentBar />
          </div>
          <div style={{ position: "relative", height: 950 }}>
            <DeviceFrame
              src={assets.sideBusiness}
              width={370}
              height={790}
              borderRadius={58}
              rotate={-5}
              frame={frame}
              delay={4}
              fit="cover"
            />
            <div style={{ position: "absolute", right: 0, bottom: 18 }}>
              <DeviceFrame
                src={assets.heroListing}
                width={510}
                height={370}
                borderRadius={36}
                rotate={4}
                frame={frame}
                delay={16}
                fit="cover"
              />
            </div>
          </div>
        </div>
        <div style={{ color: palette.textSoft, fontSize: 28 }}>
          Browse. Check trust. Connect. Grow.
        </div>
      </div>
    </Scene>
  );
};

const HowItWorksSteps = () => {
  const frame = useCurrentFrame();

  return (
    <Scene
      background={`linear-gradient(180deg, ${palette.blue} 0%, #0a1530 52%, ${palette.ink} 100%)`}
    >
      <Grain />
      <div
        style={{
          height: "100%",
          padding: 72,
          display: "grid",
          gridTemplateRows: "auto 1fr",
          gap: 28,
        }}
      >
        <div>
          <FrameLabel>Platform flow</FrameLabel>
          <div style={{ height: 18 }} />
          <BigCopy>Four moments make the platform work.</BigCopy>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 0.95fr",
            gap: 34,
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <StepCard
              eyebrow="1"
              title="Find what is near you"
              body="Listings, businesses, promotions, places, and events are organized for quick local discovery."
              index={0}
              frame={frame}
            />
            <StepCard
              eyebrow="2"
              title="Look for trust signals"
              body="Moderation, KYC review, OTP, and audit logging support safer choices and accountable activity."
              index={1}
              frame={frame}
            />
            <StepCard
              eyebrow="3"
              title="Create your presence"
              body="Businesses and sellers can register, publish details, add media, and keep their profiles current."
              index={2}
              frame={frame}
            />
            <StepCard
              eyebrow="4"
              title="Promote when ready"
              body="Paid visibility helps active businesses and listings reach more people at launch and beyond."
              index={3}
              frame={frame}
            />
          </div>
          <div style={{ position: "relative", height: 980 }}>
            <div style={{ position: "absolute", right: 0, top: 40 }}>
              <DeviceFrame
                src={assets.heroListing}
                width={620}
                height={420}
                borderRadius={38}
                rotate={3}
                frame={frame}
                delay={6}
                fit="cover"
              />
            </div>
            <div style={{ position: "absolute", left: 24, bottom: 18 }}>
              <DeviceFrame
                src={assets.sideBusiness}
                width={312}
                height={674}
                borderRadius={56}
                rotate={-6}
                frame={frame}
                delay={20}
                fit="cover"
              />
            </div>
            <div style={{ position: "absolute", right: 16, bottom: 92 }}>
              <DeviceFrame
                src={assets.heroShop}
                width={430}
                height={332}
                borderRadius={34}
                rotate={5}
                frame={frame}
                delay={28}
                fit="cover"
              />
            </div>
          </div>
        </div>
      </div>
    </Scene>
  );
};

const HowItWorksClose = () => {
  const frame = useCurrentFrame();
  const enter = ease(frame, 4, 26);

  return (
    <Scene background={`linear-gradient(180deg, #ffffff 0%, ${palette.mint} 100%)`}>
      <div
        style={{
          height: "100%",
          padding: 86,
          color: palette.textDark,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <Img src={assets.logoColor} style={{ width: 330, objectFit: "contain" }} />
        <div style={{ opacity: enter, transform: `translateY(${(1 - enter) * 44}px)` }}>
          <FrameLabel light>Built-in trust layer</FrameLabel>
          <div style={{ height: 22 }} />
          <BigCopy dark>Clear for the public. Practical for operators.</BigCopy>
          <div style={{ height: 26 }} />
          <BodyCopy dark>
            Verification, moderation, billing, protected files, and POPIA-aware handling sit behind
            the public experience.
          </BodyCopy>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>
          {["Public discovery", "Trust controls", "Growth tools"].map((line, index) => (
            <div
              key={line}
              style={{
                padding: 24,
                borderRadius: 24,
                background: "#ffffff",
                color: palette.greenDeep,
                fontSize: 29,
                fontWeight: 850,
                opacity: ease(frame, 24 + index * 5, 42 + index * 5),
                boxShadow: "0 22px 54px rgba(15,23,42,0.1)",
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    </Scene>
  );
};

const PromoIntro = () => {
  const frame = useCurrentFrame();
  const title = spring({ fps: 30, frame, config: { damping: 15, mass: 1, stiffness: 96 } });
  const zoom = interpolate(frame, [0, 135], [1.08, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Scene background={palette.ink}>
      <Img
        src={assets.heroListing}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.76,
          transform: `scale(${zoom})`,
        }}
      />
      <AbsoluteFill
        style={{
          background: "linear-gradient(180deg, rgba(9,11,15,0.28) 0%, rgba(9,11,15,0.92) 100%)",
        }}
      />
      <Grain />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          padding: 86,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <Img src={assets.logo} style={{ width: 286, objectFit: "contain" }} />
          <FrameLabel>Launch film 03</FrameLabel>
        </div>
        <div
          style={{ opacity: title, transform: `translateY(${(1 - title) * 70}px)`, maxWidth: 850 }}
        >
          <FrameLabel>Public promotion</FrameLabel>
          <div style={{ height: 22 }} />
          <BigCopy>Mzansi, your next find starts here.</BigCopy>
          <div style={{ height: 24 }} />
          <BodyCopy>
            Discover deals, trusted businesses, promotions, places to visit, and events worth
            sharing.
          </BodyCopy>
        </div>
      </div>
    </Scene>
  );
};

const PromoPeople = () => {
  const frame = useCurrentFrame();

  return (
    <Scene background={`linear-gradient(180deg, #fffaf0 0%, #ffffff 52%, ${palette.sky} 100%)`}>
      <div style={{ height: "100%", padding: 70, color: palette.textDark }}>
        <FrameLabel light>For the public</FrameLabel>
        <div style={{ height: 18 }} />
        <BigCopy dark>Shop local, support local, explore local.</BigCopy>
        <div style={{ height: 22 }} />
        <BodyCopy dark>
          VerifyMzansi brings everyday discovery into one place, using the real marketplace screens
          people will open at launch.
        </BodyCopy>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 34 }}>
          {[
            { src: assets.sideMarket, label: "Find deals nearby", fit: "cover" as const },
            { src: assets.sideBusiness, label: "Choose local services", fit: "cover" as const },
            { src: assets.sideEvent, label: "Promote what you offer", fit: "cover" as const },
            { src: assets.sideTrust, label: "Move with more trust", fit: "cover" as const },
          ].map((item, index) => {
            const enter = ease(frame, 6 + index * 5, 26 + index * 5);
            return (
              <div
                key={item.label}
                style={{
                  height: 325,
                  borderRadius: 26,
                  overflow: "hidden",
                  position: "relative",
                  boxShadow: "0 32px 70px rgba(15,23,42,0.16)",
                  opacity: enter,
                  transform: `translateY(${(1 - enter) * 42}px)`,
                }}
              >
                <Img
                  src={item.src}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: item.fit,
                    background: "#ffffff",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "linear-gradient(180deg, transparent 34%, rgba(9,11,15,0.76) 100%)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 22,
                    right: 22,
                    bottom: 20,
                    color: palette.white,
                    fontSize: 29,
                    lineHeight: 1.05,
                    fontWeight: 900,
                  }}
                >
                  {item.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Scene>
  );
};

const PromoClose = () => {
  const frame = useCurrentFrame();
  const pulse = interpolate(frame, [0, 76], [0.96, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.exp),
  });

  return (
    <Scene
      background={`linear-gradient(180deg, ${palette.greenDeep} 0%, ${palette.blue} 48%, ${palette.ink} 100%)`}
    >
      <Img
        src={assets.heroBusiness}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.34,
        }}
      />
      <AbsoluteFill
        style={{
          background: "linear-gradient(180deg, rgba(7,92,52,0.35) 0%, rgba(9,11,15,0.94) 100%)",
        }}
      />
      <Grain />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          padding: 88,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div>
          <FrameLabel>Open to the public</FrameLabel>
          <div style={{ height: 18 }} />
          <AccentBar />
        </div>
        <div
          style={{ transform: `scale(${pulse})`, transformOrigin: "left center", maxWidth: 860 }}
        >
          <Img src={assets.logo} style={{ width: 340, objectFit: "contain", marginBottom: 34 }} />
          <BigCopy>Visit VerifyMzansi today.</BigCopy>
          <div style={{ height: 26 }} />
          <BodyCopy>
            Find what you need, support who you know, and help trusted local opportunities travel
            further.
          </BodyCopy>
          <div
            style={{
              marginTop: 38,
              display: "inline-flex",
              padding: "22px 34px",
              borderRadius: 999,
              background: palette.gold,
              color: palette.ink,
              fontSize: 34,
              fontWeight: 900,
            }}
          >
            verifymzansi.com
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <MetricPill frame={frame} index={0} value="Buy" label="local listings" />
          <MetricPill frame={frame} index={1} value="Sell" label="with better trust" />
          <MetricPill frame={frame} index={2} value="Promote" label="your business" />
        </div>
      </div>
    </Scene>
  );
};

export const VerifyMzansiLaunchReveal = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: palette.ink }}>
      <AudioBed />
      <Sequence from={0} durationInFrames={145}>
        <LaunchRevealIntro />
      </Sequence>
      <Sequence from={145} durationInFrames={175}>
        <LaunchRevealSurfaces />
      </Sequence>
      <Sequence from={320} durationInFrames={130}>
        <LaunchRevealClose />
      </Sequence>
    </AbsoluteFill>
  );
};

export const VerifyMzansiHowItWorks = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: palette.ink }}>
      <AudioBed />
      <Sequence from={0} durationInFrames={135}>
        <HowItWorksIntro />
      </Sequence>
      <Sequence from={135} durationInFrames={205}>
        <HowItWorksSteps />
      </Sequence>
      <Sequence from={340} durationInFrames={110}>
        <HowItWorksClose />
      </Sequence>
    </AbsoluteFill>
  );
};

export const VerifyMzansiPublicPromo = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: palette.ink }}>
      <AudioBed />
      <Sequence from={0} durationInFrames={135}>
        <PromoIntro />
      </Sequence>
      <Sequence from={135} durationInFrames={190}>
        <PromoPeople />
      </Sequence>
      <Sequence from={325} durationInFrames={125}>
        <PromoClose />
      </Sequence>
    </AbsoluteFill>
  );
};

export const VerifyMzansiAdvert = () => <VerifyMzansiLaunchReveal />;
