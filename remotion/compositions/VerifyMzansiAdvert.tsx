import type { ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";

const palette = {
  green: "#00833e",
  greenBright: "#1fc45d",
  gold: "#ffb81c",
  blue: "#002395",
  ink: "#090b0f",
  warm: "#f7f3e8",
  white: "#ffffff",
  textDark: "#0f172a",
  textSoft: "rgba(255,255,255,0.78)",
};

const assets = {
  logo: staticFile("images/logo-inverse.png"),
  heroVideo: staticFile("images/promo/advertiser-desktop.webm"),
  mobileVideo: staticFile("images/promo/advertiser-mobile.webm"),
  homeMobile: staticFile("images/promo/promo-1.png"),
  pricingDesktop: staticFile("images/promo/promo-2.png"),
  advertiseMobile: staticFile("images/promo/promo-3.png"),
  registerDesktop: staticFile("images/promo/promo-4.png"),
  businessDesktop: staticFile("images/promo/promo-5.png"),
  marketDesktop: staticFile("images/promo/promo-6.png"),
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
      fontWeight: 700,
      letterSpacing: 3,
      textTransform: "uppercase",
      backdropFilter: "blur(16px)",
    }}
  >
    {children}
  </div>
);

const DeviceFrame = ({
  src,
  width,
  height,
  borderRadius,
  shadow,
  rotate = 0,
  frame,
  delay = 0,
}: {
  src: string;
  width: number;
  height: number;
  borderRadius: number;
  shadow: string;
  rotate?: number;
  frame: number;
  delay?: number;
}) => {
  const enter = spring({
    fps: 30,
    frame: Math.max(0, frame - delay),
    config: {
      damping: 14,
      mass: 0.9,
      stiffness: 120,
    },
  });

  return (
    <div
      style={{
        width,
        height,
        padding: 16,
        borderRadius,
        background: "rgba(255,255,255,0.96)",
        boxShadow: shadow,
        transform: `translateY(${(1 - enter) * 90}px) rotate(${rotate}deg) scale(${0.92 + enter * 0.08})`,
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
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    </div>
  );
};

const HeroScene = () => {
  const frame = useCurrentFrame();
  const overlay = interpolate(frame, [0, 28], [0.18, 0.62], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const intro = spring({
    fps: 30,
    frame,
    config: { damping: 16, mass: 1, stiffness: 95 },
  });

  return (
    <Scene>
      <OffthreadVideo
        src={assets.heroVideo}
        muted
        style={{
          position: "absolute",
          inset: -120,
          width: 1320,
          height: 2160,
          objectFit: "cover",
          opacity: 0.95,
        }}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(9,11,15,${overlay}) 0%, rgba(9,11,15,0.82) 62%, rgba(9,11,15,0.96) 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 20% 10%, rgba(0,131,62,0.22), transparent 28%), radial-gradient(circle at 85% 85%, rgba(255,184,28,0.18), transparent 30%)",
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          height: "100%",
          padding: 88,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <FrameLabel>Live capture</FrameLabel>
          <FrameLabel>Advertiser journey</FrameLabel>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 28,
            opacity: intro,
            transform: `translateY(${(1 - intro) * 80}px)`,
            maxWidth: 860,
          }}
        >
          <Img src={assets.logo} style={{ width: 330, objectFit: "contain" }} />
          <div style={{ fontSize: 104, lineHeight: 0.94, fontWeight: 800, letterSpacing: -3 }}>
            How a real advertiser uses VerifyMzansi.
          </div>
          <div style={{ fontSize: 36, lineHeight: 1.35, color: palette.textSoft }}>
            Captured from the live production site: discover the platform, compare pricing, and move
            into account creation with trust built in.
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 18,
          }}
        >
          {["Discover", "Compare", "Create"].map((label, index) => (
            <div
              key={label}
              style={{
                borderRadius: 28,
                padding: "20px 22px",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.12)",
                fontSize: 30,
                fontWeight: 700,
                opacity: ease(frame, 20 + index * 6, 42 + index * 6),
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    </Scene>
  );
};

const DiscoveryScene = () => {
  const frame = useCurrentFrame();
  const headlineEnter = ease(frame, 0, 16);

  return (
    <Scene background={`linear-gradient(180deg, ${palette.warm} 0%, #eef7f2 100%)`}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          padding: 78,
          color: palette.textDark,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 760 }}>
          <FrameLabel light>Live public surfaces</FrameLabel>
          <div
            style={{
              fontSize: 82,
              lineHeight: 0.98,
              fontWeight: 800,
              letterSpacing: -2,
              opacity: headlineEnter,
              transform: `translateY(${(1 - headlineEnter) * 48}px)`,
            }}
          >
            Discovery starts with the real marketplace, not a mockup.
          </div>
          <div
            style={{
              fontSize: 32,
              lineHeight: 1.4,
              color: "rgba(15,23,42,0.76)",
              opacity: headlineEnter,
            }}
          >
            The refreshed assets now reflect the live homepage, the live market grid, and the live
            business surface as users see them today.
          </div>
        </div>

        <div
          style={{
            position: "relative",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            flex: 1,
            marginTop: 36,
          }}
        >
          <div style={{ position: "absolute", left: 20, bottom: 24 }}>
            <DeviceFrame
              src={assets.homeMobile}
              width={320}
              height={692}
              borderRadius={56}
              shadow="0 50px 90px rgba(15,23,42,0.24)"
              rotate={-8}
              frame={frame}
              delay={4}
            />
          </div>

          <div style={{ position: "absolute", left: 300, bottom: 130 }}>
            <DeviceFrame
              src={assets.marketDesktop}
              width={620}
              height={410}
              borderRadius={40}
              shadow="0 42px 88px rgba(15,23,42,0.2)"
              rotate={-3}
              frame={frame}
              delay={10}
            />
          </div>

          <div style={{ position: "absolute", right: 32, bottom: 40 }}>
            <DeviceFrame
              src={assets.businessDesktop}
              width={560}
              height={520}
              borderRadius={42}
              shadow="0 50px 95px rgba(15,23,42,0.26)"
              rotate={5}
              frame={frame}
              delay={16}
            />
          </div>
        </div>
      </div>
    </Scene>
  );
};

const ConversionScene = () => {
  const frame = useCurrentFrame();

  return (
    <Scene background="linear-gradient(180deg, #07141b 0%, #0f1d27 100%)">
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 15% 20%, rgba(0,131,62,0.18), transparent 28%), radial-gradient(circle at 85% 85%, rgba(255,184,28,0.16), transparent 30%)",
        }}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.05fr 0.95fr",
          gap: 26,
          padding: 84,
          height: "100%",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <FrameLabel>Advertise → pricing → account</FrameLabel>
          <div style={{ fontSize: 80, lineHeight: 0.96, fontWeight: 800, letterSpacing: -2 }}>
            The conversion path now uses captured live screens.
          </div>
          <div style={{ fontSize: 32, lineHeight: 1.42, color: palette.textSoft, maxWidth: 540 }}>
            Advertise explains the value, pricing shows the real plans, and register finishes the
            journey with the current production account flow.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
            {[
              "Advertise: verification-first visibility",
              "Pricing: real plan tabs and prices",
              "Register: current account entry screen",
            ].map((line, index) => (
              <div
                key={line}
                style={{
                  padding: "20px 24px",
                  borderRadius: 24,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  fontSize: 28,
                  fontWeight: 700,
                  opacity: ease(frame, 6 + index * 6, 22 + index * 6),
                  transform: `translateX(${(1 - ease(frame, 6 + index * 6, 22 + index * 6)) * -36}px)`,
                }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", right: 38, top: 40 }}>
            <DeviceFrame
              src={assets.pricingDesktop}
              width={540}
              height={420}
              borderRadius={42}
              shadow="0 40px 90px rgba(0,0,0,0.28)"
              rotate={4}
              frame={frame}
              delay={6}
            />
          </div>
          <div style={{ position: "absolute", left: 10, top: 290 }}>
            <DeviceFrame
              src={assets.advertiseMobile}
              width={300}
              height={650}
              borderRadius={50}
              shadow="0 42px 88px rgba(0,0,0,0.32)"
              rotate={-6}
              frame={frame}
              delay={12}
            />
          </div>
          <div style={{ position: "absolute", right: 0, bottom: 10 }}>
            <DeviceFrame
              src={assets.registerDesktop}
              width={470}
              height={392}
              borderRadius={36}
              shadow="0 46px 92px rgba(0,0,0,0.34)"
              rotate={2}
              frame={frame}
              delay={18}
            />
          </div>
        </div>
      </div>
    </Scene>
  );
};

const FinalScene = () => {
  const frame = useCurrentFrame();
  const pulse = interpolate(frame, [0, 60], [0.94, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.exp),
  });

  return (
    <Scene>
      <OffthreadVideo
        src={assets.mobileVideo}
        muted
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.38,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(9,11,15,0.72) 0%, rgba(9,11,15,0.92) 100%), radial-gradient(circle at bottom left, rgba(255,184,28,0.14), transparent 30%)",
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          height: "100%",
          padding: 88,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <FrameLabel>Updated from live production</FrameLabel>
          <div style={{ fontSize: 28, color: palette.textSoft }}>verifymzansi.com</div>
        </div>

        <div
          style={{
            borderRadius: 54,
            padding: "54px 50px",
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "0 48px 110px rgba(0,0,0,0.34)",
            backdropFilter: "blur(24px)",
            transform: `scale(${pulse})`,
            display: "flex",
            flexDirection: "column",
            gap: 26,
            maxWidth: 860,
          }}
        >
          <Img src={assets.logo} style={{ width: 300, objectFit: "contain" }} />
          <div style={{ fontSize: 92, lineHeight: 0.94, fontWeight: 800, letterSpacing: -3 }}>
            Live screens.
            <br />
            Real journey.
          </div>
          <div style={{ fontSize: 34, lineHeight: 1.4, color: palette.textSoft }}>
            The refreshed advert and image set now match the current public VerifyMzansi experience
            instead of older placeholder-style assets.
          </div>
          <div style={{ display: "flex", gap: 18 }}>
            <div
              style={{
                padding: "18px 30px",
                borderRadius: 999,
                background: `linear-gradient(135deg, ${palette.green} 0%, ${palette.greenBright} 100%)`,
                fontSize: 30,
                fontWeight: 700,
              }}
            >
              View pricing
            </div>
            <div
              style={{
                padding: "18px 30px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.16)",
                background: "rgba(255,255,255,0.06)",
                fontSize: 30,
                fontWeight: 700,
              }}
            >
              Create account
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 28,
            color: palette.textSoft,
          }}
        >
          <div>Buy. Sell. Advertise with trust.</div>
          <div style={{ color: palette.white, fontWeight: 700 }}>VerifyMzansi</div>
        </div>
      </div>
    </Scene>
  );
};

export const VerifyMzansiAdvert = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: palette.ink }}>
      <Sequence from={0} durationInFrames={110}>
        <HeroScene />
      </Sequence>
      <Sequence from={110} durationInFrames={112}>
        <DiscoveryScene />
      </Sequence>
      <Sequence from={222} durationInFrames={128}>
        <ConversionScene />
      </Sequence>
      <Sequence from={350} durationInFrames={100}>
        <FinalScene />
      </Sequence>
    </AbsoluteFill>
  );
};
