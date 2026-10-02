import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";
import browsing from "./advert-motion.json";

export type ShortSocialAdvertProps = { runwayClip: string | null };
const gold = "#f9ed32";
const ink = "#061b18";
const ease = (f: number, a: number, b: number) =>
  interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
const pop = (f: number, delay = 0) =>
  spring({ frame: f - delay, fps: 30, config: { damping: 15, stiffness: 140, mass: 0.7 } });

const Type = ({
  children,
  top,
  size = 124,
  delay = 0,
  color = "white",
  style,
}: {
  children: ReactNode;
  top: number;
  size?: number;
  delay?: number;
  color?: string;
  style?: CSSProperties;
}) => {
  const f = useCurrentFrame();
  const p = pop(f, delay);
  return (
    <div
      style={{
        position: "absolute",
        left: 72,
        right: 72,
        top,
        fontSize: size,
        fontWeight: 950,
        letterSpacing: -5,
        lineHeight: 0.96,
        color,
        whiteSpace: "pre-line",
        opacity: ease(f, delay, delay + 5),
        transform: `translateY(${(1 - p) * 110}px) rotate(${(1 - p) * -5}deg)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

const Chip = ({
  children,
  left,
  top,
  delay = 0,
  dark = false,
  rotate = -7,
}: {
  children: ReactNode;
  left: number;
  top: number;
  delay?: number;
  dark?: boolean;
  rotate?: number;
}) => {
  const f = useCurrentFrame();
  const p = pop(f, delay);
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        padding: "22px 30px",
        borderRadius: 22,
        background: dark ? ink : gold,
        color: dark ? gold : ink,
        fontSize: 36,
        fontWeight: 850,
        whiteSpace: "nowrap",
        boxShadow: "0 16px 0 rgba(0,0,0,0.12)",
        transform: `translateY(${(1 - p) * 160 + Math.sin(f / 11) * 12}px) rotate(${rotate}deg) scale(${p})`,
      }}
    >
      {children}
    </div>
  );
};

const Phone = ({
  kind,
  left,
  top,
  width = 500,
  angle = -8,
  delay = 0,
}: {
  kind: keyof typeof browsing;
  left: number;
  top: number;
  width?: number;
  angle?: number;
  delay?: number;
}) => {
  const f = useCurrentFrame();
  const p = pop(f, delay);
  const height = width * 1.83;
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        borderRadius: 58,
        border: "12px solid #12211e",
        background: "#12211e",
        boxShadow: "22px 40px 0 rgba(0,0,0,0.16), 0 55px 100px rgba(0,0,0,0.28)",
        transform: `perspective(1800px) translateY(${(1 - p) * 450 + Math.sin(f / 14) * 16}px) rotate(${angle + Math.sin(f / 20) * 3}deg) rotateY(${(1 - p) * 35 + Math.sin(f / 35) * 6}deg) scale(${0.65 + p * 0.35})`,
        opacity: ease(f, delay, delay + 6),
        overflow: "hidden",
      }}
    >
      <OffthreadVideo
        src={staticFile(`video/advert-browsing/${kind}-motion.webm`)}
        trimBefore={browsing[kind].trimBefore}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <div
        style={{
          position: "absolute",
          top: 8,
          left: "38%",
          width: "24%",
          height: 24,
          background: "#12211e",
          borderRadius: 25,
        }}
      />
    </div>
  );
};

const Arrows = ({ left, top, color = gold }: { left: number; top: number; color?: string }) => {
  const f = useCurrentFrame();
  return (
    <svg
      width="240"
      height="240"
      viewBox="0 0 240 240"
      style={{ position: "absolute", left, top, transform: `rotate(${Math.sin(f / 12) * 9}deg)` }}
    >
      <path
        d="M25 35 Q205 20 150 185 M112 151 L150 185 L187 145"
        stroke={color}
        strokeWidth="13"
        strokeLinecap="round"
        fill="none"
        strokeDasharray="420"
        strokeDashoffset={420 * (1 - ease(f, 15, 38))}
      />
    </svg>
  );
};

const Atmosphere = ({ light = false }: { light?: boolean }) => {
  const f = useCurrentFrame();
  return (
    <>
      <div
        style={{
          position: "absolute",
          width: 1700,
          height: 1700,
          top: 240,
          left: -320,
          border: `2px solid ${light ? "rgba(6,27,24,0.12)" : "rgba(255,255,255,0.13)"}`,
          borderRadius: "50%",
          transform: `rotate(${f * 0.5}deg)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 35,
            height: 35,
            borderRadius: "50%",
            left: 220,
            top: 260,
            background: gold,
          }}
        />
      </div>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: 60 + i * 9,
            height: 8,
            background: light ? "#0a8c68" : gold,
            left: ((i * 221 + f * 5) % 1300) - 120,
            top: 190 + i * 276,
            opacity: 0.35,
            transform: "rotate(-35deg)",
          }}
        />
      ))}
    </>
  );
};

const Hook = ({ runwayClip }: ShortSocialAdvertProps) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: ink }}>
      {runwayClip && (
        <OffthreadVideo
          src={/^https?:\/\//.test(runwayClip) ? runwayClip : staticFile(runwayClip)}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.35 }}
        />
      )}
      <Atmosphere />
      <div
        style={{
          position: "absolute",
          left: -240 + f * 5,
          top: 1230,
          fontSize: 300,
          color: "transparent",
          WebkitTextStroke: "2px #1a6c57",
          whiteSpace: "nowrap",
          fontWeight: 950,
          transform: "rotate(-12deg)",
        }}
      >
        MZANSI MZANSI
      </div>
      {f < 36 ? (
        <>
          <Type top={440} size={236} color={gold}>
            STOP.
          </Type>
          <Type top={710} size={134} delay={12}>
            SCROLLING.
          </Type>
          <div
            style={{
              position: "absolute",
              top: 886,
              left: 68,
              width: 940 * ease(f, 18, 28),
              height: 18,
              background: gold,
              transform: "rotate(-3deg)",
            }}
          />
        </>
      ) : (
        <>
          <Type top={330} size={146} delay={36}>
            FIND YOUR{"\n"}
            <span style={{ color: gold }}>MZANSI.</span>
          </Type>
          <Phone kind="market" left={250} top={850} width={490} angle={10} delay={42} />
          <Chip left={60} top={920} delay={52}>
            Good finds.
          </Chip>
          <Chip left={600} top={1400} delay={62} rotate={8}>
            Right here.
          </Chip>
        </>
      )}
      {f < 36 && (
        <div
          style={{
            position: "absolute",
            left: 76,
            bottom: 180,
            fontSize: 28,
            letterSpacing: 5,
            color: "white",
          }}
        >
          YOUR NEXT DISCOVERY STARTS HERE
        </div>
      )}
    </AbsoluteFill>
  );
};

const Market = () => (
  <AbsoluteFill style={{ background: "#eff6db", color: ink }}>
    <Atmosphere light />
    <Type top={250} size={111} color={ink}>
      GOOD FINDS.
    </Type>
    <Type top={375} size={96} delay={8} color="#087a57">
      GREAT CONNECTIONS.
    </Type>
    <div style={{ position: "absolute", left: 76, top: 560, fontSize: 34, fontWeight: 700 }}>
      Mzansi Market · Buy and sell locally
    </div>
    <Phone kind="market" left={270} top={740} width={505} angle={-7} delay={5} />
    <Chip left={68} top={1050} delay={20} dark>
      Find it.
    </Chip>
    <Chip left={680} top={1460} delay={36} rotate={9}>
      Love it.
    </Chip>
    <Arrows left={725} top={645} color="#087a57" />
  </AbsoluteFill>
);

const Business = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: ink }}>
      <Img
        src={staticFile("images/showrooms/business-v2-mobile.avif")}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${1.12 + f * 0.001}) translateX(${f * 0.12}px)`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(6,27,24,0.95), rgba(6,27,24,0.35) 55%, rgba(6,27,24,0.9))",
        }}
      />
      <Type top={260} size={128}>
        LOCAL TALENT.
      </Type>
      <Type top={405} size={132} color={gold} delay={8}>
        BIG ENERGY.
      </Type>
      <div style={{ position: "absolute", left: 78, top: 600, fontSize: 36 }}>
        Mzansi Business · Shops and services
      </div>
      <Phone kind="business" left={170} top={770} width={490} angle={9} delay={4} />
      <Chip left={630} top={930} delay={20} rotate={-8}>
        Discover.
      </Chip>
      <Chip left={590} top={1320} delay={34} rotate={7}>
        Connect.
      </Chip>
      <Arrows left={680} top={1060} />
    </AbsoluteFill>
  );
};

const Tourism = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#087b9d" }}>
      <Img
        src={staticFile("images/showrooms/tourism-v2-mobile.avif")}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${1.1 + f * 0.0012}) translateY(${-f * 0.16}px)`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(3,26,34,0.9), rgba(3,26,34,0.12) 60%, rgba(3,26,34,0.85))",
        }}
      />
      <Type top={260} size={165}>
        GO OUT.
      </Type>
      <Type top={440} size={149} color={gold} delay={8}>
        GO LOCAL.
      </Type>
      <div style={{ position: "absolute", left: 76, top: 640, fontSize: 35 }}>
        Tourism & Events · Places, stays, experiences
      </div>
      <Phone kind="tourism" left={330} top={850} width={490} angle={-8} delay={5} />
      <Chip left={65} top={930} delay={18} rotate={-9}>
        New places.
      </Chip>
      <Chip left={55} top={1320} delay={36} rotate={7}>
        New memories.
      </Chip>
      <Arrows left={40} top={1050} />
    </AbsoluteFill>
  );
};

const Finale = () => {
  const f = useCurrentFrame();
  const reveal = "verifymzansi.com".slice(0, Math.max(0, Math.floor((f - 16) / 1.8)));
  return (
    <AbsoluteFill style={{ background: gold, color: ink }}>
      <div
        style={{ position: "absolute", left: 540, top: 930, transform: `rotate(${f * 1.4}deg)` }}
      >
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              width: 660,
              height: 34,
              background: "rgba(6,27,24,0.065)",
              transformOrigin: "left center",
              transform: `rotate(${i * 30}deg)`,
            }}
          />
        ))}
      </div>
      <Type top={280} size={125} color={ink}>
        YOUR NEXT
      </Type>
      <Type top={425} size={114} color={ink} delay={8}>
        OPPORTUNITY.
      </Type>
      <Img
        src={staticFile("images/brand-shield.png")}
        style={{
          position: "absolute",
          width: 350,
          height: 350,
          objectFit: "contain",
          left: 365,
          top: 735,
          transform: `perspective(800px) scale(${pop(f, 8)}) rotateY(${(1 - pop(f, 8)) * 160}deg)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          top: 1160,
          textAlign: "center",
          fontSize: 88,
          fontWeight: 900,
          letterSpacing: -3,
        }}
      >
        VerifyMzansi
      </div>
      <div
        style={{
          position: "absolute",
          left: 76,
          right: 76,
          top: 1340,
          background: ink,
          color: "white",
          borderRadius: 100,
          padding: "43px 38px",
          fontSize: 61,
          fontWeight: 800,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          transform: `scale(${0.92 + pop(f, 15) * 0.08})`,
        }}
      >
        <span>
          {reveal}
          <span style={{ opacity: Math.floor(f / 7) % 2 ? 0 : 1, color: gold }}>|</span>
        </span>
        <span style={{ color: gold, transform: `translateX(${Math.sin(f / 5) * 10}px)` }}>↗</span>
      </div>
      <div
        style={{
          position: "absolute",
          top: 1560,
          left: 70,
          right: 70,
          textAlign: "center",
          fontSize: 36,
          fontWeight: 750,
        }}
      >
        Explore. List. Connect.
      </div>
    </AbsoluteFill>
  );
};

export const ShortSocialAdvert = ({ runwayClip }: ShortSocialAdvertProps) => {
  const f = useCurrentFrame();
  const phase = f % 96;
  const wipe = phase >= 88 ? ease(phase, 88, 96) : 1 - ease(phase, 0, 7);
  return (
    <AbsoluteFill
      style={{
        fontFamily: '"Segoe UI", "Arial", sans-serif',
        color: "white",
        overflow: "hidden",
        background: ink,
      }}
    >
      <Audio
        src={staticFile("audio/mzansi-discovery-beat.wav")}
        volume={(t) =>
          interpolate(t, [0, 6, 455, 479], [0, 0.7, 0.7, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        }
      />
      <Sequence from={0} durationInFrames={96}>
        <Hook runwayClip={runwayClip} />
      </Sequence>
      <Sequence from={96} durationInFrames={96}>
        <Market />
      </Sequence>
      <Sequence from={192} durationInFrames={96}>
        <Business />
      </Sequence>
      <Sequence from={288} durationInFrames={96}>
        <Tourism />
      </Sequence>
      <Sequence from={384} durationInFrames={96}>
        <Finale />
      </Sequence>
      {f < 384 && (
        <Img
          src={staticFile("images/logo-inverse.png")}
          style={{
            position: "absolute",
            top: 100,
            left: 76,
            width: 300,
            height: 95,
            objectFit: "contain",
            objectPosition: "left",
            filter: f >= 96 && f < 192 ? "brightness(0.25)" : undefined,
          }}
        />
      )}
      {f > 8 && f < 384 && wipe > 0 && (
        <div
          style={{
            position: "absolute",
            inset: -300,
            background: gold,
            transform: `translateX(${(1 - wipe) * 1800}px) rotate(-16deg)`,
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          height: 5,
          background: f >= 384 ? ink : gold,
          bottom: 65,
          left: 72,
          width: (936 * f) / 479,
        }}
      />
    </AbsoluteFill>
  );
};
